import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import type { DatabaseAdapter } from '../services/db/DatabaseAdapter';
import { DURABLE_OUTBOX_SCHEMA_SQL } from '../services/sync/DurableOutboxSchema';
import { PaymentIntentService } from '../services/payments/PaymentIntentService';
import { isUnknownCardOutcomeStatus } from '../utils/cardOutcomeException';

class MemoryAdapter implements DatabaseAdapter {
    readonly adapterType = 'local' as const;
    readonly sqlite = new Database(':memory:');

    constructor() {
        this.sqlite.exec(`
            CREATE TABLE documents (
                collection_name TEXT NOT NULL, doc_id TEXT NOT NULL, data TEXT NOT NULL, updatedAt TEXT NOT NULL,
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
}

const input = { paymentId: 'ns:payment:0', provider: 'AZUL', integrationId: 'azul-main', amount: 100, currencyCode: 'DOP' };

test('a card the terminal never answered cannot be sent twice: the retry asks for the voucher', async () => {
    const adapter = new MemoryAdapter();
    try {
        const service = new PaymentIntentService(adapter, () => true);
        const first = await service.create(input);
        // The persisted status always comes back, even for a plain (non-retained) sale.
        assert.equal(first?.status, 'CREATED');
        await service.markAuthorizing(first!.intentId);
        await service.markFailed(first!.intentId, { declined: false, error: 'timeout after terminal approval' });
        const repeated = await service.create(input);
        assert.equal(repeated?.intentId, first!.intentId);
        assert.equal(repeated?.status, 'RECONCILIATION_REQUIRED');
        assert.equal(isUnknownCardOutcomeStatus(repeated?.status), true, 'the box must stop and confirm with the voucher');
        // The database itself refuses the second authorization while the outcome is unknown.
        await assert.rejects(service.markAuthorizing(first!.intentId), /PAYMENT_INTENT_RECONCILIATION_REQUIRED/);
    } finally {
        await adapter.disconnect();
    }
});

test('an explicit decline stays retryable and an approval is reused', async () => {
    const adapter = new MemoryAdapter();
    try {
        const service = new PaymentIntentService(adapter, () => true);
        const intent = await service.create(input);
        await service.markAuthorizing(intent!.intentId);
        await service.markFailed(intent!.intentId, { declined: true, error: 'FONDOS INSUFICIENTES', responseCode: '51' });
        const afterDecline = await service.create(input);
        assert.equal(afterDecline?.status, 'DECLINED');
        assert.equal(isUnknownCardOutcomeStatus(afterDecline?.status), false);
        // The cashier may try again with another card: a declined tender is a real answer.
        await service.markAuthorizing(intent!.intentId);
        await service.markAuthorized(intent!.intentId, { providerReference: 'REF-1', authorizationCode: 'AUT-1', responseCode: '00' });
        const afterApproval = await service.create(input);
        assert.equal(afterApproval?.status, 'AUTHORIZED');
        assert.equal(afterApproval?.providerReference, 'REF-1');
        // An approved charge is reused, never authorized again.
        await assert.rejects(service.markAuthorizing(intent!.intentId), /PAYMENT_INTENT_RECONCILIATION_REQUIRED/);
    } finally {
        await adapter.disconnect();
    }
});
