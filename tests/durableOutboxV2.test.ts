import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import Database from 'better-sqlite3';

import type { DatabaseAdapter, FinancialCommitInput } from '../services/db/DatabaseAdapter';
import { DURABLE_OUTBOX_SCHEMA_SQL } from '../services/sync/DurableOutboxSchema';
import { DurableOutboxRepository } from '../services/sync/DurableOutboxRepository';
import { PaymentIntentService } from '../services/payments/PaymentIntentService';
import { buildSalePostedPayload } from '../services/sync/SalePostedContract';

const readCount = (row: unknown): number => Number((row as { count?: number } | undefined)?.count || 0);

class SQLiteTestAdapter implements DatabaseAdapter {
    readonly adapterType = 'local' as const;
    readonly sqlite = new Database(':memory:');

    constructor() {
        this.sqlite.exec(`
            CREATE TABLE documents (
                collection_name TEXT NOT NULL,
                doc_id TEXT NOT NULL,
                data TEXT NOT NULL,
                updatedAt TEXT NOT NULL,
                PRIMARY KEY (collection_name, doc_id)
            );
            ${DURABLE_OUTBOX_SCHEMA_SQL}
        `);
    }

    async connect() {}
    async disconnect() { this.sqlite.close(); }
    async getCollection<T>() { return [] as T[]; }
    async saveCollection<T>() {}
    async saveDocument<T extends { id: string }>() {}
    async bulkUpsert<T extends { id: string }>() {}
    async bulkUpdateProducts() {}
    async getDocument<T>() { return null as T | null; }
    async deleteDocument() {}

    async executeSQL(query: string, params: any[] = []): Promise<any> {
        const statement = this.sqlite.prepare(query);
        if (statement.reader) {
            const rows = statement.all(...params) as Record<string, any>[];
            const columns = rows[0] ? Object.keys(rows[0]) : statement.columns().map(column => column.name);
            return [{ columns, values: rows.map(row => columns.map(column => row[column])) }];
        }
        const result = statement.run(...params);
        return { changes: { changes: result.changes } };
    }

    async commitFinancialTransaction(input: FinancialCommitInput): Promise<void> {
        const commit = this.sqlite.transaction(() => {
            const now = new Date().toISOString();
            for (const mutation of input.documents) {
                this.sqlite.prepare(
                    `INSERT INTO documents (collection_name, doc_id, data, updatedAt)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(collection_name, doc_id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`
                ).run(mutation.collectionName, mutation.document.id, JSON.stringify(mutation.document), now);
            }
            const event = input.outboxEvent;
            this.sqlite.prepare(
                `INSERT INTO sync_outbox_v2 (
                    event_id, event_type, aggregate_type, aggregate_id, schema_version,
                    payload_json, status, attempt_count, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`
            ).run(event.eventId, event.eventType, event.aggregateType, event.aggregateId,
                event.schemaVersion, JSON.stringify(event.payload), event.createdAt, now);
            for (const intentId of input.paymentIntentIds || []) {
                this.sqlite.prepare(
                    `UPDATE payment_intents_v2 SET status = 'COMMITTED', transaction_id = ?, committed_at = ?, updated_at = ?
                     WHERE intent_id = ? AND status = 'AUTHORIZED'`
                ).run(event.aggregateId, now, now, intentId);
            }
        });
        commit();
    }
}

const saleTransaction = () => ({
    id: 'sale-1',
    displayId: 'TCK-1',
    documentType: 'TICKET',
    status: 'COMPLETED',
    date: '2026-08-22T17:00:00.000Z',
    total: 125,
    taxAmount: 0,
    netAmount: 125,
    discountAmount: 0,
    items: [{ id: 'item-1', price: 125, quantity: 1 }],
    payments: [{ id: 'payment-1', method: 'CASH', amount: 125 }],
    userId: 'user-1',
    userName: 'Caja Uno',
});

const financialInput = (eventId = 'event-sale-1'): FinancialCommitInput => ({
    documents: [
        { collectionName: 'transactions', document: saleTransaction() },
        { collectionName: 'inventoryLedger', document: { id: 'movement-1', qtyOut: 1 } },
    ],
    outboxEvent: {
        eventId,
        eventType: 'TRANSACTION_CREATED',
        aggregateType: 'TRANSACTION',
        aggregateId: 'sale-1',
        schemaVersion: 1,
        payload: { transaction: saleTransaction(), inventoryMovementIds: ['movement-1'] },
        createdAt: '2026-08-22T17:00:00.000Z',
    },
});

test('financial commit persists sale, essential movement and outbox event atomically', async () => {
    const adapter = new SQLiteTestAdapter();
    const repository = new DurableOutboxRepository(adapter);
    await repository.commitFinancialTransaction(financialInput());

    assert.equal(readCount(adapter.sqlite.prepare('SELECT COUNT(*) count FROM documents').get()), 2);
    assert.deepEqual(
        adapter.sqlite.prepare('SELECT status, attempt_count FROM sync_outbox_v2 WHERE event_id = ?').get('event-sale-1'),
        { status: 'PENDING', attempt_count: 0 },
    );
    await adapter.disconnect();
});

test('a failed outbox insert rolls back financial documents', async () => {
    const adapter = new SQLiteTestAdapter();
    const repository = new DurableOutboxRepository(adapter);
    await repository.commitFinancialTransaction(financialInput());

    await assert.rejects(() => repository.commitFinancialTransaction({
        ...financialInput('event-invalid'),
        documents: [{ collectionName: 'transactions', document: { id: 'sale-2', total: 999 } }],
        outboxEvent: { ...financialInput('event-invalid').outboxEvent, schemaVersion: null as unknown as number },
    }));
    assert.equal(readCount(adapter.sqlite.prepare('SELECT COUNT(*) count FROM documents WHERE doc_id = ?').get('sale-2')), 0);
    await adapter.disconnect();
});

test('online SALE_POSTED persists the canonical contract in the same financial commit', async () => {
    const adapter = new SQLiteTestAdapter();
    const repository = new DurableOutboxRepository(adapter);
    const transaction = saleTransaction();
    const input: FinancialCommitInput = {
        ...financialInput('11111111-1111-4111-8111-111111111111'),
        outboxEvent: {
            ...financialInput().outboxEvent,
            eventId: '11111111-1111-4111-8111-111111111111',
            eventType: 'SALE_POSTED',
            payload: buildSalePostedPayload(transaction, { inventoryMovementIds: ['movement-1'] }),
        },
    };

    await repository.commitFinancialTransaction(input);
    const persisted = adapter.sqlite.prepare(
        'SELECT event_id, aggregate_id, payload_json, status FROM sync_outbox_v2 WHERE event_id = ?'
    ).get(input.outboxEvent.eventId) as any;
    const payload = JSON.parse(persisted.payload_json);

    assert.equal(persisted.aggregate_id, transaction.id);
    assert.equal(persisted.status, 'PENDING');
    assert.equal(payload.summary.transaction_id, transaction.id);
    assert.equal(payload.summary.total, transaction.total);
    assert.equal(payload.occurred_at, transaction.date);
    await adapter.disconnect();
});

test('invalid SALE_POSTED is rejected before sale documents or outbox are persisted', async () => {
    const adapter = new SQLiteTestAdapter();
    const repository = new DurableOutboxRepository(adapter);
    const transaction = saleTransaction();
    const payload = buildSalePostedPayload(transaction);

    await assert.rejects(
        () => repository.commitFinancialTransaction({
            ...financialInput(),
            outboxEvent: {
                ...financialInput().outboxEvent,
                eventType: 'SALE_POSTED',
                payload: { ...payload, summary: { ...payload.summary, total: 124 } },
            },
        }),
        /contrato financiero SALE_POSTED no cuadra/,
    );
    assert.equal(readCount(adapter.sqlite.prepare('SELECT COUNT(*) count FROM documents').get()), 0);
    assert.equal(readCount(adapter.sqlite.prepare('SELECT COUNT(*) count FROM sync_outbox_v2').get()), 0);
    await adapter.disconnect();
});

test('leases are FIFO, single-owner and abandoned SENDING rows recover to RETRY_WAIT', async () => {
    const adapter = new SQLiteTestAdapter();
    const repository = new DurableOutboxRepository(adapter);
    await repository.commitFinancialTransaction(financialInput('event-1'));
    await repository.commitFinancialTransaction({
        ...financialInput('event-2'),
        outboxEvent: { ...financialInput('event-2').outboxEvent, aggregateId: 'sale-2' },
    });

    const leased = await repository.leaseDue({
        owner: 'worker-a',
        limit: 1,
        leaseMs: 5_000,
        now: new Date('2026-08-22T17:00:01.000Z'),
    });
    assert.deepEqual(leased.map(event => event.eventId), ['event-1']);
    assert.equal(leased[0].attemptCount, 1);

    const recovered = await repository.recoverExpiredLeases(new Date('2026-08-22T17:00:07.000Z'));
    assert.equal(recovered, 1);
    assert.deepEqual(
        adapter.sqlite.prepare('SELECT status, lease_owner FROM sync_outbox_v2 WHERE event_id = ?').get('event-1'),
        { status: 'RETRY_WAIT', lease_owner: null },
    );
    await adapter.disconnect();
});

test('SYNCED_MASTER remains distinct from APPLIED_ERP and retry preserves the event id', async () => {
    const adapter = new SQLiteTestAdapter();
    const repository = new DurableOutboxRepository(adapter);
    await repository.commitFinancialTransaction(financialInput('event-state-machine'));
    await repository.leaseDue({ owner: 'worker-a', limit: 1, leaseMs: 5_000 });
    await repository.markRetry('event-state-machine', 'temporary network error', new Date(Date.now() - 1_000));
    const retried = await repository.leaseDue({ owner: 'worker-b', limit: 1, leaseMs: 5_000 });
    assert.equal(retried[0].eventId, 'event-state-machine');
    assert.equal(retried[0].attemptCount, 2);

    await repository.markSyncedMaster('event-state-machine', new Date('2026-08-22T17:01:00.000Z'));
    assert.equal(
        (adapter.sqlite.prepare('SELECT status FROM sync_outbox_v2 WHERE event_id = ?').get('event-state-machine') as any).status,
        'SYNCED_MASTER',
    );
    await repository.markAppliedErp('event-state-machine', new Date('2026-08-22T17:02:00.000Z'));
    assert.equal(
        (adapter.sqlite.prepare('SELECT status FROM sync_outbox_v2 WHERE event_id = ?').get('event-state-machine') as any).status,
        'APPLIED_ERP',
    );
    await adapter.disconnect();
});

test('legacy non-UUID event ids are repaired without replacing the durable sale or sequence', async () => {
    const adapter = new SQLiteTestAdapter();
    const repository = new DurableOutboxRepository(adapter);
    await repository.commitFinancialTransaction(financialInput('OUTBOX-TXN-legacy'));
    await repository.leaseDue({ owner: 'worker-a', limit: 1, leaseMs: 5_000 });
    await repository.markRetry('OUTBOX-TXN-legacy', 'SYNC_BATCH_INVALID_EVENT_ID', new Date('2026-08-22T18:30:00.000Z'));

    assert.equal(await repository.repairLegacyEventContracts(new Date('2026-08-22T18:10:00.000Z')), 1);
    const repaired = adapter.sqlite.prepare(
        'SELECT local_sequence, event_id, event_type, aggregate_id, status, next_retry_at FROM sync_outbox_v2'
    ).get() as any;
    assert.equal(repaired.local_sequence, 1);
    assert.equal(repaired.aggregate_id, 'sale-1');
    assert.equal(repaired.event_type, 'SALE_POSTED');
    assert.equal(repaired.status, 'RETRY_WAIT');
    assert.equal(repaired.next_retry_at, '2026-08-22T18:10:00.000Z');
    assert.match(repaired.event_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(readCount(adapter.sqlite.prepare("SELECT COUNT(*) count FROM documents WHERE doc_id = 'sale-1'").get()), 1);
    const repairedPayload = JSON.parse((adapter.sqlite.prepare(
        'SELECT payload_json FROM sync_outbox_v2 WHERE local_sequence = 1'
    ).get() as any).payload_json);
    assert.equal(repairedPayload.summary.transaction_id, 'sale-1');
    assert.equal(repairedPayload.occurred_at, '2026-08-22T17:00:00.000Z');
    await adapter.disconnect();
});

test('pending SALE_POSTED is upgraded once without changing its UUID, aggregate or FIFO sequence', async () => {
    const adapter = new SQLiteTestAdapter();
    const repository = new DurableOutboxRepository(adapter);
    const eventId = '22222222-2222-4222-8222-222222222222';
    await repository.commitFinancialTransaction({
        ...financialInput(eventId),
        outboxEvent: {
            ...financialInput(eventId).outboxEvent,
            eventType: 'TRANSACTION_CREATED',
        },
    });
    adapter.sqlite.prepare(
        "UPDATE sync_outbox_v2 SET event_type = 'SALE_POSTED' WHERE event_id = ?"
    ).run(eventId);

    assert.equal(await repository.repairLegacyEventContracts(new Date('2026-08-22T17:05:00.000Z')), 1);
    const repaired = adapter.sqlite.prepare(
        'SELECT local_sequence, event_id, aggregate_id, event_type, payload_json FROM sync_outbox_v2'
    ).get() as any;
    assert.equal(repaired.local_sequence, 1);
    assert.equal(repaired.event_id, eventId);
    assert.equal(repaired.aggregate_id, 'sale-1');
    assert.equal(repaired.event_type, 'SALE_POSTED');
    const payload = JSON.parse(repaired.payload_json);
    assert.equal(payload.summary.transaction_id, 'sale-1');
    assert.equal(payload.occurred_at, '2026-08-22T17:00:00.000Z');
    assert.equal(await repository.repairLegacyEventContracts(new Date('2026-08-22T17:06:00.000Z')), 0);
    await adapter.disconnect();
});

test('invalid persisted SALE_POSTED becomes terminal REJECTED instead of entering an infinite retry', async () => {
    const adapter = new SQLiteTestAdapter();
    const repository = new DurableOutboxRepository(adapter);
    const eventId = '33333333-3333-4333-8333-333333333333';
    const payload = buildSalePostedPayload(saleTransaction());
    await repository.commitFinancialTransaction({
        ...financialInput(eventId),
        outboxEvent: {
            ...financialInput(eventId).outboxEvent,
            eventId,
            eventType: 'SALE_POSTED',
            payload,
        },
    });
    adapter.sqlite.prepare(
        'UPDATE sync_outbox_v2 SET payload_json = ? WHERE event_id = ?'
    ).run(JSON.stringify({
        ...payload,
        summary: { ...payload.summary, total: 100 },
    }), eventId);

    assert.equal(await repository.repairLegacyEventContracts(new Date('2026-08-22T17:07:00.000Z')), 1);
    assert.deepEqual(
        adapter.sqlite.prepare('SELECT status, next_retry_at FROM sync_outbox_v2 WHERE event_id = ?').get(eventId),
        { status: 'REJECTED', next_retry_at: null },
    );
    assert.deepEqual(
        await repository.leaseDue({ owner: 'worker-after-reject', limit: 1, leaseMs: 5_000 }),
        [],
    );
    await adapter.disconnect();
});

test('unselected leases return to FIFO without consuming an attempt and final rejects stop retrying', async () => {
    const adapter = new SQLiteTestAdapter();
    const repository = new DurableOutboxRepository(adapter);
    await repository.commitFinancialTransaction(financialInput('event-release'));
    await repository.commitFinancialTransaction({
        ...financialInput('event-reject'),
        outboxEvent: { ...financialInput('event-reject').outboxEvent, aggregateId: 'sale-reject' },
    });
    await repository.leaseDue({ owner: 'worker-a', limit: 2, leaseMs: 5_000 });

    await repository.releaseUnsent(['event-release']);
    assert.deepEqual(
        adapter.sqlite.prepare('SELECT status, attempt_count, lease_owner FROM sync_outbox_v2 WHERE event_id = ?').get('event-release'),
        { status: 'PENDING', attempt_count: 0, lease_owner: null },
    );

    await repository.markRejected('event-reject', 'invalid payload');
    assert.deepEqual(
        adapter.sqlite.prepare('SELECT status, last_error FROM sync_outbox_v2 WHERE event_id = ?').get('event-reject'),
        { status: 'REJECTED', last_error: 'invalid payload' },
    );
    const next = await repository.leaseDue({ owner: 'worker-b', limit: 2, leaseMs: 5_000 });
    assert.deepEqual(next.map(event => event.eventId), ['event-release']);
    await adapter.disconnect();
});

test('authorized payment intent is linked only inside the financial commit', async () => {
    const adapter = new SQLiteTestAdapter();
    const repository = new DurableOutboxRepository(adapter);
    adapter.sqlite.prepare(
        `INSERT INTO payment_intents_v2 (
            intent_id, idempotency_key, payment_id, provider, amount, currency_code,
            status, created_at, updated_at, authorized_at
         ) VALUES ('intent-1','key-1','payment-1','AZUL',125,'DOP','AUTHORIZED',?,?,?)`
    ).run('2026-08-22T17:00:00.000Z', '2026-08-22T17:00:00.000Z', '2026-08-22T17:00:00.000Z');

    await repository.commitFinancialTransaction({ ...financialInput(), paymentIntentIds: ['intent-1'] });
    assert.deepEqual(
        adapter.sqlite.prepare('SELECT status, transaction_id FROM payment_intents_v2 WHERE intent_id = ?').get('intent-1'),
        { status: 'COMMITTED', transaction_id: 'sale-1' },
    );
    await adapter.disconnect();
});

test('payment intents are idempotent and ambiguous gateway failures require reconciliation', async () => {
    const adapter = new SQLiteTestAdapter();
    const service = new PaymentIntentService(adapter, () => true);
    const input = {
        paymentId: 'payment-stable-1',
        provider: 'AZUL',
        integrationId: 'azul-main',
        amount: 125,
        currencyCode: 'DOP',
    };
    const first = await service.create(input);
    const repeated = await service.create(input);
    assert.equal(repeated?.intentId, first?.intentId);
    assert.equal(readCount(adapter.sqlite.prepare('SELECT COUNT(*) count FROM payment_intents_v2').get()), 1);

    await service.markAuthorizing(first!.intentId);
    await service.markFailed(first!.intentId, { declined: false, error: 'timeout after terminal approval' });
    assert.deepEqual(
        adapter.sqlite.prepare('SELECT status, last_error FROM payment_intents_v2 WHERE intent_id = ?').get(first!.intentId),
        { status: 'RECONCILIATION_REQUIRED', last_error: 'timeout after terminal approval' },
    );

    const abandoned = await service.create({ ...input, paymentId: 'payment-stable-2' });
    await service.markAuthorizing(abandoned!.intentId);
    adapter.sqlite.prepare('UPDATE payment_intents_v2 SET updated_at = ? WHERE intent_id = ?')
        .run('2026-08-22T16:00:00.000Z', abandoned!.intentId);
    const recovered = await service.recoverAbandoned(new Date('2026-08-22T17:00:00.000Z'));
    assert.equal(recovered, 1);
    assert.equal(
        (adapter.sqlite.prepare('SELECT status FROM payment_intents_v2 WHERE intent_id = ?').get(abandoned!.intentId) as any).status,
        'RECONCILIATION_REQUIRED',
    );
    await adapter.disconnect();
});

test('production enables POS-2A/POS-2B while the safe default remains dark', async () => {
    const [env, exampleEnv, flags, adapter, transactionService, app, paymentModal, posInterface] = await Promise.all([
        readFile(new URL('../.env.production', import.meta.url), 'utf8'),
        readFile(new URL('../.env.example', import.meta.url), 'utf8'),
        readFile(new URL('../services/sync/SyncFeatureFlags.ts', import.meta.url), 'utf8'),
        readFile(new URL('../services/db/adapters/CapacitorSQLiteAdapter.ts', import.meta.url), 'utf8'),
        readFile(new URL('../services/transactionService.ts', import.meta.url), 'utf8'),
        readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../components/PaymentModal.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8'),
    ]);
    assert.match(env, /^VITE_SQLITE_OUTBOX_V2_ENABLED=true$/m);
    assert.match(exampleEnv, /^VITE_SQLITE_OUTBOX_V2_ENABLED=false$/m);
    assert.match(flags, /sqlite_outbox_v2: false/);
    assert.match(adapter, /await this\.executeSetOrRun\(statements\)/);
    assert.match(transactionService, /options\.deferDurablePersistence === true[\s\S]*?isSyncFeatureEnabled\('sqlite_outbox_v2'\)/);
    assert.match(app, /durableOutboxRepository\.commitFinancialTransaction/);
    assert.match(app, /eventId: uuidv4\(\)/);
    assert.doesNotMatch(app, /eventId: `OUTBOX-\$\{txn\.id\}`/);
    assert.match(app, /eventType: 'SALE_POSTED'/);
    assert.match(app, /payload: buildSalePostedPayload\(txn,/);
    assert.match(app, /collectionName: 'transactions'/);
    assert.match(app, /collectionName: 'inventoryLedger'/);
    assert.match(app, /collectionName: 'customers'/);
    assert.match(paymentModal, /paymentIntentService\.create[\s\S]*?await azulMcmService\.sale/);
    assert.match(paymentModal, /paymentIntentService\.markAuthorized/);
    assert.match(transactionService, /deferDurableSalePersistence[\s\S]*?deferDurablePersistence/);
    assert.match(posInterface, /deferDurableSalePersistence: durableSplitSaleCommit/);
    assert.match(posInterface, /durableSplitSaleCommit[\s\S]*?onTransactionComplete\(result\.sale\)/);
});
