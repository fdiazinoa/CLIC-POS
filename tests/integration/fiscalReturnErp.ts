/** Opt-in: ERP_ROOT must point to the reviewed contract checkout. Only its isolated local
 * PostgreSQL/HTTP/provider fixtures are used; no production credentials are inherited. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { returnFixture } from '../fiscalReturnConsumerFixture';
import { createFiscalReturnConsumer, createFiscalReturnTransport } from '../../services/fiscal/FiscalReturnConsumer';
import { createFiscalWorkflowV2Client } from '../../services/fiscal/FiscalWorkflowV2Client';
import { offlineFiscalAuthorityFromConfig } from '../../services/fiscal/OfflineFiscalLeaseContext';
import { returnDigest, sameReturn, returnJSON } from '../../services/fiscal/FiscalReturnV1';
import { buildErpInventoryLedgerPayload } from '../../services/sync/erpOutboundPayloads';
const root = process.env.CLIC_RETURN_TEST_ERP_ROOT;
if (!root)
    throw Error('CLIC_RETURN_TEST_ERP_ROOT_REQUIRED');
const load = (file: string) => import(pathToFileURL(join(root, file)).href);
const { bootReturnFixture } = await load('server/test-support/posFiscalReturnV1PostgresFixture.mjs');
const { startReturnHttpFixture } = await load('server/test-support/posFiscalReturnV1HttpFixture.mjs');
const pg = await bootReturnFixture();
let http: any, n: any;
try {
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
            const p = result.body, snapshot = p.returnSnapshot;
            console.log('Preparation snapshot contract checks:', {schemaVersion:snapshot?.schemaVersion,profile:snapshot?.profile,currency:snapshot?.currency,exchangeRate:snapshot?.exchangeRate,loyaltyDisposition:snapshot?.loyaltyDisposition,loyaltyProofDigestValid:/^[a-f0-9]{64}$/.test(snapshot?.loyaltyProofDigest),referenceEqual:sameReturn(snapshot?.originalReference,p.originalReference),digestEqual:await returnDigest(snapshot)===p.returnSnapshotDigest});
            if (await returnDigest(snapshot) !== p.returnSnapshotDigest) {
                const sql = await pg.query("select public.erp_pos_fiscal_canonical_json_v2(jsonb_build_object('schemaVersion',1,'source','ERP_POS_FISCAL_RETURN_V1','value',snapshot)) canonical from private.pos_fiscal_return_preparations_v1 where operation_id=$1", [p.operationId]);
                const expected = sql.rows[0].canonical, actual = returnJSON({schemaVersion:1,source:'ERP_POS_FISCAL_RETURN_V1',value:snapshot});
                let index=0; while(index<expected.length && expected[index]===actual[index])index++;
                console.log('First digest canonical mismatch (synthetic fixture only):', {index,postgres:expected.slice(Math.max(0,index-60),index+100),javascript:actual.slice(Math.max(0,index-60),index+100)});
            }

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
    const events = rows.map((r: any) => ({ eventId: r.event_id, eventType: r.event_type, schemaVersion: r.schema_version, payload: JSON.parse(r.payload_json) }));
    await http.register(c, events.map((e: any) => ({ event_id: e.eventId, event_type: e.eventType, payload: e.payload })));
    const ledger = n.documents('inventoryLedger').map(buildErpInventoryLedgerPayload);
    const beforeStock = await http.request('/api/sync/inventory/movements', { method: 'POST', headers: http.headers(c), body: { items: ledger } });
    assert.notEqual(beforeStock.body?.results?.[0]?.status, 'APPLIED');
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
    const economics = await pg.query("select (select count(*) from private.pos_fiscal_return_receipts_v1 where workflow_id=$1) as receipts,(select count(*) from private.pos_fiscal_return_fences_v1 where workflow_id=$1) as fences", [first.fiscalWorkflowCheckoutId]);
    assert.equal(Number(economics.rows[0].receipts), 1);
    assert.equal(Number(economics.rows[0].fences), 1);
    console.log('PASS actual POS consumer -> native SQLite/FinancialCommit/outbox -> isolated ERP HTTP/PostgreSQL -> one commercial receipt, one ISSUE, lost response -> GET accepted; payment/stock ordering and duplicate delivery do not repeat effects.');
}
finally {
    n?.cleanup();
    await http?.close();
    await pg.cleanup();
}
