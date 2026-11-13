/** Opt-in: ERP_ROOT must point to the reviewed contract checkout. Only its isolated local
 * PostgreSQL/HTTP/provider fixtures are used; no production credentials are inherited. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { toDurableWireEvent } from '../../services/sync/DurableOutboxBatchSender';
import { readFile } from 'node:fs/promises';
import { returnFixture } from '../fiscalReturnConsumerFixture';
import { createFiscalReturnConsumer, createFiscalReturnTransport } from '../../services/fiscal/FiscalReturnConsumer';
import { createFiscalWorkflowV2Client } from '../../services/fiscal/FiscalWorkflowV2Client';
import { offlineFiscalAuthorityFromConfig } from '../../services/fiscal/OfflineFiscalLeaseContext';
import { assertReturnSnapshotDigest } from '../../services/fiscal/FiscalReturnV1';
import { buildErpInventoryLedgerPayload } from '../../services/sync/erpOutboundPayloads';
const root = process.env.CLIC_RETURN_TEST_ERP_ROOT;
if (!root)
    throw Error('CLIC_RETURN_TEST_ERP_ROOT_REQUIRED');
const load = (file: string) => import(pathToFileURL(join(root, file)).href);
const { bootReturnFixture } = await load('server/test-support/posFiscalReturnV1PostgresFixture.mjs');
const { startReturnHttpFixture } = await load('server/test-support/posFiscalReturnV1HttpFixture.mjs');
test('actual RETURN consumer commits once and reaches accepted through ERP-owned ISSUE and query-only recovery', async () => {
const pg = await bootReturnFixture();
let http: any, n: any;
try {
    // The actual batch route requires the published indexed token lookup schema;
    // the older RETURN fixture intentionally installs only its economic prerequisites.
    await pg.query('create schema if not exists extensions; grant usage on schema extensions to service_role');
    await pg.query(await readFile(join(root, 'supabase/migrations/20260728200001_sync_terminal_token_fingerprint_lookup.sql'), 'utf8'));
    http = await startReturnHttpFixture({ fixture: pg });
    const c = await pg.createCase({ paymentMode: 'cash', monetary: { netAmount: 8.47, taxAmount: 1.53, total: 10 }, originalQuantity: 1 });
    n = await returnFixture(undefined, true, undefined, c);
    const auth: any = { base: http.baseUrl + '/api/sync', descriptor: c.scope, headers: http.headers(c), assertCurrent: () => { } };
    let latestOriginalReference: any = null;
    const fetcher: typeof fetch = async (url, options) => {
        const path = new URL(String(url)).pathname + new URL(String(url)).search;
        const result = await http.request(path, { method: options?.method || 'GET', headers: options?.headers, body: options?.body ? JSON.parse(String(options.body)) : undefined });
        if (path.startsWith('/api/sync/fiscal/workflow/v2/status?') && result.body.transactionId === n.original.id)
            latestOriginalReference = result.body.originalReference;
        if (path.endsWith('/return/prepare'))
            assert.deepEqual(JSON.parse(String(options?.body)).originalReference, latestOriginalReference,
                'prepare must preserve the complete authenticated reference without fixture UUID injection');
        if (path.endsWith('/return/prepare') && result.status === 200) {
            await assertReturnSnapshotDigest(result.body);
            console.log('Exact PostgreSQL UTF-8 snapshot proof verified:', result.body.returnSnapshotDigestScheme);
        }

        return Response.json(result.body, { status: result.status });
    };
    const credentials = { ...c.scope, erpTenantId: c.scope.tenantId, erpTerminalId: c.scope.terminalId, deviceToken: 'synthetic', authStatus: 'BOUND' };
    const workflow = createFiscalWorkflowV2Client({ store: () => n.adapter.fiscalWorkflowStore, readAuth: () => auth, readSource: async (id: string) => await n.adapter.getDocument('transactions', id) || await n.adapter.getDocument('transactionHistory', id), readOfflineAuthority: () => offlineFiscalAuthorityFromConfig(n.config, credentials, c.scope.deviceId), fetchImpl: fetcher });
    await workflow.discover();
    const originalStatus = await workflow.consult(n.original.id);
    console.log('Original authenticated reference before synthetic evidence repair:', originalStatus.originalReferenceReason);
    assert.equal(originalStatus.originalReference, null);
    assert.equal(originalStatus.originalReferenceReason, 'FISCAL_ORIGINAL_REFERENCE_OBSERVATION_MISMATCH');

    const transport = createFiscalReturnTransport(() => auth, fetcher);
    const consumer = createFiscalReturnConsumer({ adapter: n.adapter, transport, workflow, readOriginal: async () => await n.adapter.getDocument('transactions', n.original.id), commit: n.commitSource });
    const conditions = new Map<string, 'SELLABLE'>(n.original.items.map((line: any) => [line.cartId, 'SELLABLE']));
    const selected = n.original.items.map((line: any) => ({ ...line, quantity: .5 }));
    http.flags({ admission: false });
    await assert.rejects(consumer.process(n.original, selected, conditions, 'Synthetic RETURN', n.documents('internalSequences').find((s: any) => s.documentType === 'REFUND').id, { id: 'synthetic-user', name: 'Synthetic' }));
    assert.equal(n.documents('inventoryLedger').length, 0);
    assert.equal(n.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get().n, 0);
    http.flags({ admission: true });
    const run = () => consumer.process(n.original, selected, conditions, 'Synthetic RETURN', n.documents('internalSequences').find((s: any) => s.documentType === 'REFUND').id, { id: 'synthetic-user', name: 'Synthetic' });
    await assert.rejects(run(), /FISCAL_ORIGINAL_REFERENCE_OBSERVATION_MISMATCH/);
    assert.equal(n.documents('inventoryLedger').length, 0);
    assert.equal(n.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get().n, 0);
    // The old ERP RETURN fixture retained an observation trackId but omitted it on its
    // synthetic original workflow. Reconcile that evidence only; the real endpoint must
    // still validate all source/materialization/signature facts and build the reference.
    await pg.query(`update erp_pos_fiscal_workflows_v2 w set track_id=(select h.evidence->>'trackId'
        from erp_pos_fiscal_workflow_history_v2 h where h.workflow_id=w.id and h.kind='OBSERVATION'
        and h.version=w.observation_version) where w.transaction_id=$1 and w.scope=$2`,
        [n.original.id, JSON.stringify(c.scope)]);
    const verifiedOriginal = await workflow.consult(n.original.id);
    console.log('Original authenticated reference after synthetic evidence repair:', verifiedOriginal.originalReferenceReason);
    assert.ok(verifiedOriginal.originalReference, verifiedOriginal.originalReferenceReason || 'authenticated reference missing');
    assert.equal(verifiedOriginal.originalReferenceReason, null);
    assert.equal(verifiedOriginal.observationVersion, originalStatus.observationVersion);
    assert.equal((await n.adapter.fiscalWorkflowStore.readState(n.original.id)).originalReference, null,
        'same-version reference refresh must not overwrite immutable native fiscal evidence');
    const [first, duplicate] = await Promise.all([run(), run()]).catch(error => {
        assert.equal(n.documents('inventoryLedger').length, 0);
        assert.equal(n.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get().n, 0);
        assert.equal(n.documents('internalSequences').find((s: any) => s.documentType === 'REFUND').nextNumber, 1);
        console.log('HELD before local financial effects; strict preparation validation remains active.');
        throw error;
    });
    assert.equal(first.id, duplicate.id);
    const rows = n.db.prepare('SELECT * FROM sync_outbox_v2 ORDER BY local_sequence').all();
    const events = rows.map((r: any) => toDurableWireEvent({ eventId: r.event_id, localSequence: r.local_sequence, eventType: r.event_type, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, schemaVersion: r.schema_version, payload: JSON.parse(r.payload_json), createdAt: r.created_at } as any));
    await http.register(c, events.map((e: any) => ({ event_id: e.eventId, event_type: e.eventType, payload: e.payload })));
    const ledger = n.documents('inventoryLedger').map(buildErpInventoryLedgerPayload);
    const beforeStock = await http.request('/api/sync/inventory/movements', { method: 'POST', headers: http.headers(c), body: { items: ledger } });
    console.log('Stock before NC application:', beforeStock.status, beforeStock.body.results?.[0]?.status, beforeStock.body.results?.[0]?.error_code);
    assert.equal(beforeStock.status, 422);
    assert.equal(beforeStock.body.results[0].status, 'PENDING');
    assert.equal(beforeStock.body.results[0].error_code, 'FISCAL_RETURN_APPLICATION_PENDING');
    assert.equal(Number((await pg.query('select count(*) n from private.pos_fiscal_return_stock_v1 where preparation_id=$1', [(await n.adapter.fiscalReturnStore.byTransaction(first.id)).preparation.preparationId])).rows[0].n), 0);
    const paymentFirst = await transport.deliver([...events].reverse());
    assert.equal(paymentFirst.appliedCount, 1);
    const response = await transport.deliver(events);
    assert.equal(response.failedCount, 0);
    assert.ok(response.results.every((r: any) => r.inboxStatus === 'APPLIED'));
    const ackLostRetry = await transport.deliver(events);
    assert.equal(ackLostRetry.failedCount, 0);
    const afterStock = await http.request('/api/sync/inventory/movements', { method: 'POST', headers: http.headers(c), body: { items: ledger } });
    assert.equal(afterStock.body.results[0].status, 'DUPLICATE');
    http.behavior('response-loss');
    await http.worker().runRound();
    await pg.query("update erp_pos_fiscal_workflows_v2 set next_poll_at=clock_timestamp(),query_lease_until=clock_timestamp()-interval '1 second' where scope=$1 and source_kind='ORDINARY_RETURN_V1' and dispatch_fence is not null and decision='PENDING'", [JSON.stringify(c.scope)], { connection: pg.service });
    await http.worker().runRound();
    assert.equal(http.providerState(c).issues, 1);
    assert.equal(http.providerState(c).gets, 1);
    const status = await workflow.consult(first.id);
    assert.equal(status.sourceKind, 'RETURN_SOURCE_V1');
    assert.equal(status.decision, 'ACCEPTED');
    assert.ok(status.signature);
    assert.equal(n.documents('inventoryLedger').reduce((v: number, l: any) => v + l.qtyIn, 0), .5);
    assert.equal(n.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get().n, 2);
    const economics = await pg.query(`select
        (select count(*) from private.pos_fiscal_return_receipts_v1 where workflow_id=$1) receipts,
        (select count(*) from private.pos_fiscal_return_fences_v1 where workflow_id=$1) fences,
        (select count(*) from erp_journal_entries j join private.pos_fiscal_return_receipts_v1 r
            on j.id=(r.payment->>'receipt_entry_id')::uuid where r.workflow_id=$1 and j.tenant_id=$2) payment_receipts,
        (select count(*) from erp_accounting_journal_entries j join private.pos_fiscal_return_receipts_v1 r
            on j.id=(r.payment->>'accounting_entry_id')::uuid where r.workflow_id=$1 and j.source_document_type='CUSTOMER_REFUND'
            and j.tenant_id=$2 and j.status='POSTED') payment_postings,
        (select count(*) from private.pos_fiscal_return_stock_v1 s join private.pos_fiscal_return_receipts_v1 r
            on r.preparation_id=s.preparation_id join erp_inventory_movements m on m.id=s.inventory_movement_id
            where r.workflow_id=$1 and m.tenant_id=$2) inventory_effects,
        (select sum(m.cantidad) from private.pos_fiscal_return_stock_v1 s join private.pos_fiscal_return_receipts_v1 r
            on r.preparation_id=s.preparation_id join erp_inventory_movements m on m.id=s.inventory_movement_id
            where r.workflow_id=$1 and m.tenant_id=$2) inventory_quantity`, [first.fiscalWorkflowCheckoutId, c.scope.tenantId]);
    assert.equal(Number(economics.rows[0].receipts), 1);
    assert.equal(Number(economics.rows[0].fences), 1);
    assert.equal(Number(economics.rows[0].payment_receipts), 1);
    assert.equal(Number(economics.rows[0].payment_postings), 1);
    assert.equal(Number(economics.rows[0].inventory_effects), 1);
    assert.equal(Number(economics.rows[0].inventory_quantity), .5);
    console.log('PASS actual POS consumer -> native SQLite/FinancialCommit/outbox -> isolated ERP HTTP/PostgreSQL -> one commercial receipt, one ISSUE, lost response -> GET accepted; payment/stock ordering and duplicate delivery do not repeat effects.');
}
finally {
    n?.cleanup();
    await http?.close();
    await pg.cleanup();
}

});
