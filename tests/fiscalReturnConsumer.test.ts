import test from 'node:test';
import assert from 'node:assert/strict';
import { returnFixture } from './fiscalReturnConsumerFixture';
test('native RETURN commits original snapshot, enriched payments and stable events together', async (t) => {
    const f = await returnFixture();
    t.after(() => f.cleanup());
    const tx = await f.run();
    assert.equal(tx.ncfType, 'E34');
    assert.equal(tx.total, 10);
    assert.equal(tx.displayId, 'REF-000001');
    assert.equal(tx.payments[0].method, 'CASH');
    const events = f.db.prepare('SELECT event_id,event_type,payload_json FROM sync_outbox_v2 ORDER BY local_sequence').all() as any[];
    assert.deepEqual(events.map(e => e.event_type), ['SALES_CREDIT_NOTE_POSTED', 'PAYMENT_POSTED']);
    const nc = JSON.parse(events[0].payload_json), pay = JSON.parse(events[1].payload_json);
    assert.deepEqual(nc.fiscalReturnContract, pay.fiscalReturnContract);
    assert.equal(Object.keys(nc.fiscalReturnContract).length, 6);
    assert.equal(nc.fiscalWorkflowBirth.transactionId, tx.id);
    assert.deepEqual(pay.payments, tx.payments);
    assert.equal(f.documents('inventoryLedger').length, 1);
    assert.equal(f.documents('inventoryLedger')[0].qtyIn, 1);
    assert.equal((f.db.prepare('SELECT state FROM pos_fiscal_pending_numbers_v2').get() as any).state, 'CONSUMED');
});
for (const kind of ['disabled', 'denied', 'offline'] as const)
    test(`${kind} leaves a durable pending attempt and no financial or issued-number effects`, async (t) => {
        const f = await returnFixture();
        t.after(() => f.cleanup());
        if (kind === 'disabled')
            f.setCapability({ enabled: false, ready: false });
        if (kind === 'denied')
            f.setDenied(true);
        if (kind === 'offline')
            f.setOffline(true);
        await assert.rejects(f.run());
        assert.equal(f.documents('transactions').filter(d => d.documentType === 'REFUND').length, 0);
        assert.equal(f.documents('inventoryLedger').length, 0);
        assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n, 0);
        assert.equal(f.documents('internalSequences').find(s => s.documentType === 'REFUND').nextNumber, 1);
        assert.equal((f.db.prepare('SELECT count(*) n FROM pos_fiscal_return_attempts_v1').get() as any).n, 1);
        if (kind === 'denied') {
            assert.equal((f.db.prepare('SELECT state FROM pos_fiscal_pending_numbers_v2').get() as any).state, 'PREPARED');
            f.setDenied(false);
        }
        else if (kind === 'disabled')
            f.setCapability({ enabled: true, ready: true });
        else
            f.setOffline(false);
        const tx = await f.run();
        assert.equal(tx.total, 10);
        assert.equal(f.documents('inventoryLedger').length, 1);
    });
test('two concurrent callbacks share command/payment/event identities and one native financial effect', async (t) => {
    const f = await returnFixture();
    t.after(() => f.cleanup());
    const [a, b] = await Promise.all([f.run(), f.run()]);
    assert.equal(a.id, b.id);
    assert.equal(f.documents('inventoryLedger').length, 1);
    assert.equal(f.documents('internalSequences').find(s => s.documentType === 'REFUND').nextNumber, 2);
    assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n, 2);
    assert.equal(f.preparations.size, 1);
});
test('lost prepare response repeats the byte-identical PREPARING command without new UUIDs or issued numbers', async (t) => {
    const f = await returnFixture();
    t.after(() => f.cleanup());
    f.setLosePrepare();
    await assert.rejects(f.run(), /UNAVAILABLE/);
    const a = JSON.parse((f.db.prepare('SELECT data FROM pos_fiscal_return_attempts_v1').get() as any).data);
    assert.equal(a.phase, 'PREPARING');
    assert.ok(a.paymentEventId);
    assert.equal(JSON.parse(a.commandBytes).payments[0].id, a.paymentIds[0]);
    assert.equal(f.documents('inventoryLedger').length, 0);
    const tx = await f.run();
    assert.equal(tx.id, a.checkout.transactionId);
    assert.equal(f.prepareCalls[0], f.prepareCalls[1]);
    assert.equal(f.preparations.size, 1);
});
test('failure inside the native commit rolls back source, original, stock, events and counter; retry preserves localCommittedAt', async (t) => {
    const f = await returnFixture();
    t.after(() => f.cleanup());
    let failed = false;
    f.fault.beforeRun = async (_sql, values) => { if (!failed && values[0] === 'inventoryLedger') {
        failed = true;
        throw Error('SYNTHETIC_STOCK_DISK_FAILURE');
    } };
    await assert.rejects(f.run(), /SYNTHETIC_STOCK_DISK_FAILURE/);
    const before = JSON.parse((f.db.prepare('SELECT data FROM pos_fiscal_return_attempts_v1').get() as any).data);
    assert.equal(before.phase, 'SEALED');
    assert.equal(f.documents('inventoryLedger').length, 0);
    assert.equal(f.documents('internalSequences').find(s => s.documentType === 'REFUND').nextNumber, 1);
    const tx = await f.run();
    const after = JSON.parse((f.db.prepare('SELECT data FROM pos_fiscal_return_attempts_v1').get() as any).data);
    assert.equal(after.localCommittedAt, before.localCommittedAt);
    assert.equal(tx.date, before.checkout.offlineSaleDate);
    assert.equal(f.documents('inventoryLedger').length, 1);
});
test('changed flags or authority after a historical prepare response never admits another local commit', async (t) => {
    const f = await returnFixture();
    t.after(() => f.cleanup());
    f.setLosePrepare();
    await assert.rejects(f.run());
    f.setCapability({ enabled: false });
    await assert.rejects(f.run(), /AUTHORITY/);
    assert.equal(f.documents('inventoryLedger').length, 0);
    f.setCapability({ enabled: true, authorityHash: 'f'.repeat(64) });
    await assert.rejects(f.run());
    assert.equal(f.documents('inventoryLedger').length, 0);
    assert.equal(f.preparations.size, 1);
});
test('two successive partial returns preserve ERP residual cents and replenish exactly the purchased quantity', async (t) => {
    const f = await returnFixture();
    t.after(() => f.cleanup());
    const first = await f.run(.5);
    assert.deepEqual([first.netAmount, first.taxAmount, first.total], [4.24, .76, 5]);
    const ids = f.db.prepare('SELECT event_id FROM sync_outbox_v2').all() as any[];
    f.db.prepare("UPDATE sync_outbox_v2 SET status='APPLIED_ERP'").run();
    for (const row of ids)
        await f.adapter.fiscalReturnStore.acknowledgeApplied(row.event_id);
    const second = await f.run(.5);
    assert.deepEqual([second.netAmount, second.taxAmount, second.total], [4.23, .77, 5]);
    assert.notEqual(first.id, second.id);
    assert.equal(f.documents('inventoryLedger').reduce((n, l) => n + l.qtyIn, 0), 1);
    assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n, 4);
    assert.equal(f.documents('transactionHistory').filter(d => d.documentType === 'REFUND').reduce((n, d) => n + d.total, 0), 10);
});
test('SQLite reopen after native commit response loss recovers the same partial NC while offline and does not duplicate effects', async (t) => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { default: SQLite } = await import('better-sqlite3');
    const dir = mkdtempSync(join(tmpdir(), 'clic-return-reopen-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'pos.sqlite');
    let f = await returnFixture(new SQLite(path));
    const server = { preparations: f.preparations };
    let armed = false;
    f.fault.beforeRun = async (sql) => { if (!armed && sql.includes('INSERT INTO sync_outbox_v2')) {
        armed = true;
        f.fault.loseCommitResponse = true;
    } };
    await assert.rejects(f.run(.5), /COMMIT_UNCERTAIN/);
    const data = JSON.parse((f.db.prepare('SELECT data FROM pos_fiscal_return_attempts_v1').get() as any).data);
    assert.equal(data.phase, 'COMMITTED');
    const before = f.db.prepare('SELECT event_id,payload_json FROM sync_outbox_v2 ORDER BY event_id').all();
    f.cleanup();
    f = await returnFixture(new SQLite(path), false, server);
    t.after(() => f.cleanup());
    f.setOffline(true);
    const tx = await f.run(.5);
    assert.equal(tx.id, data.checkout.transactionId);
    assert.equal(tx.ncf, data.committedSource.ncf);
    assert.deepEqual(f.db.prepare('SELECT event_id,payload_json FROM sync_outbox_v2 ORDER BY event_id').all(), before);
    assert.equal(f.documents('inventoryLedger').reduce((n, l) => n + l.qtyIn, 0), .5);
    assert.equal(f.documents('internalSequences').find(s => s.documentType === 'REFUND').nextNumber, 2);
});
test('file reopen after lost prepare response retains command bytes and payment-event identity', async (t) => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { default: SQLite } = await import('better-sqlite3');
    const dir = mkdtempSync(join(tmpdir(), 'clic-return-prepare-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'pos.sqlite');
    let f = await returnFixture(new SQLite(path));
    f.setLosePrepare();
    await assert.rejects(f.run());
    const server = { preparations: f.preparations };
    const before = JSON.parse((f.db.prepare('SELECT data FROM pos_fiscal_return_attempts_v1').get() as any).data);
    f.cleanup();
    f = await returnFixture(new SQLite(path), false, server);
    t.after(() => f.cleanup());
    const tx = await f.run();
    assert.equal(f.prepareCalls[0], before.commandBytes);
    const events = f.db.prepare('SELECT event_id FROM sync_outbox_v2').all() as any[];
    assert.ok(events.some(e => e.event_id === before.paymentEventId));
    assert.equal(tx.id, before.checkout.transactionId);
    assert.equal(server.preparations.size, 1);
});
test('native status projection distinguishes PREPARED/WORKFLOW, validates RETURN semantics and rejects regressions', async (t) => {
    const { verifyReturnStatus, returnStatusMessage } = await import('../services/fiscal/FiscalReturnStatus');
    const { returnContract, returnJSON } = await import('../services/fiscal/FiscalReturnV1');
    const { sha256Utf8 } = await import('../services/sync/LargeMasterSyncV3Client');
    const { fiscalStatusSourceChecksum } = await import('../services/fiscal/FiscalStatusProof');
    const f = await returnFixture();
    t.after(() => f.cleanup());
    const tx = await f.run();
    const a = (await f.adapter.fiscalReturnStore.byTransaction(tx.id))!;
    const p = a.preparation!;
    const pending: any = { schemaVersion: 2, source: 'ERP_POS_FISCAL_WORKFLOW_V2', sourceKind: 'RETURN_SOURCE_V1', mode: 'PREPARED', profile: p.profile, preparationId: p.preparationId, operationKind: 'RETURN', originalReference: p.originalReference, transactionId: tx.id, workflowId: null, scope: p.scope, issuerRnc: p.issuerRnc, environment: p.environment, state: 'AWAITING_APPLICATION', decision: 'PENDING', signature: null, observationVersion: 0, canCorrect: false };
    assert.equal(await verifyReturnStatus(tx, pending, a), true);
    assert.match(returnStatusMessage(pending), /sincronización/);
    await f.adapter.fiscalWorkflowStore.saveState(tx, pending, null);
    const envelope = JSON.parse((f.db.prepare("SELECT payload_json FROM sync_outbox_v2 WHERE event_type='SALES_CREDIT_NOTE_POSTED'").get() as any).payload_json);
    const workflow: any = { ...pending, mode: 'WORKFLOW', profile: undefined, preparationId: undefined, workflowId: a.checkout!.checkoutId, permitId: null, ncf: tx.ncf, ncfType: 'E34', currency: 'DOP', exchangeRate: 1, total: tx.total, buyer: tx.customerSnapshot, draftRevision: 0, saleEventId: a.financialEventId, originalSourceEnvelope: envelope, checksumV1: await fiscalStatusSourceChecksum(tx), observedAt: new Date().toISOString(), state: 'OUTCOME_UNKNOWN' };
    workflow.originalDigestV2 = await sha256Utf8(returnJSON({ schemaVersion: 2, source: 'POS_ORIGINAL_ENVELOPE_V2', scope: workflow.scope, saleEventId: workflow.saleEventId, payload: envelope }));
    assert.equal(await verifyReturnStatus(tx, workflow, a, pending), true);
    await f.adapter.fiscalWorkflowStore.saveState(tx, workflow, 0);
    assert.match(returnStatusMessage(workflow), /Sólo se consultará/);
    for (const changed of [{ ...workflow, sourceKind: 'ORDINARY_SOURCE_V2' }, { ...workflow, originalReference: { ...p.originalReference, ncf: 'E320000000099' } }, { ...workflow, preparationId: 'foreign' }, { ...workflow, profile: 'WRONG' }, { ...workflow, decision: 'ACCEPTED', state: 'ACCEPTED' }, { ...workflow, originalSourceEnvelope: { ...envelope, fiscalReturnContract: { ...returnContract(a), localCommittedAt: new Date(0).toISOString() } } }]) {
        assert.equal(await verifyReturnStatus(tx, changed, a), false);
        await assert.rejects(f.adapter.fiscalWorkflowStore.saveState(tx, changed, 0));
    }
    assert.equal(await verifyReturnStatus(tx, pending, a, workflow), false);
    assert.deepEqual(await f.adapter.fiscalWorkflowStore.readState(tx.id), JSON.parse(JSON.stringify(workflow)));
    const { fiscalCivilDate } = await import('../services/fiscal/FiscalPrintEvidence');
    const signedAt = fiscalCivilDate(tx.date) + ' 10:11:12';
    const url = new URL('https://ecf.dgii.gov.do/testecf/ConsultaTimbre');
    for (const [key, value] of Object.entries({ RncEmisor: p.issuerRnc, RncComprador: tx.customerSnapshot!.taxId, ENCF: tx.ncf, FechaEmision: fiscalCivilDate(tx.date), MontoTotal: tx.total, FechaFirma: signedAt, CodigoSeguridad: 'ABCDEF' }))
        url.searchParams.set(key, String(value));
    const signed = { ...workflow, state: 'SIGNED_PENDING', observationVersion: 1, signature: { schemaVersion: 1, qrUrl: url.href, securityCode: 'ABCDEF', signedAt } };
    assert.equal(await verifyReturnStatus(tx, signed, a, workflow), true);
    assert.match(returnStatusMessage(signed), /pendiente de aceptación/);
    await f.adapter.fiscalWorkflowStore.saveState(tx, signed, 0);
    const accepted = { ...signed, state: 'ACCEPTED', decision: 'ACCEPTED', observationVersion: 2 };
    assert.equal(await verifyReturnStatus(tx, accepted, a, signed), true);
    await f.adapter.fiscalWorkflowStore.saveState(tx, accepted, 1);
    assert.equal(await verifyReturnStatus(tx, { ...accepted, buyer: { taxId: '999999999' } }, a), false);
    assert.equal(await verifyReturnStatus(tx, signed, a, accepted), false);
    assert.match(returnStatusMessage(accepted), /aceptada por DGII/);
});
test('authenticated RETURN transport preserves the batch envelope and forbids implicit legacy fallback', async () => {
    const { createFiscalReturnTransport } = await import('../services/fiscal/FiscalReturnConsumer');
    const scope = { tenantId: 'tenant', companyId: 'company', storeId: 'store', terminalId: 'terminal', deviceId: 'device' };
    const auth: any = { base: 'https://erp.invalid/api/sync', descriptor: scope, headers: { Authorization: 'Bearer synthetic' }, assertCurrent: () => { } };
    const calls: Array<{
        url: string;
        body: any;
    }> = [];
    const event = { eventId: crypto.randomUUID(), eventType: 'SALES_CREDIT_NOTE_POSTED', payload: { tenant_id: scope.tenantId, company_id: scope.companyId, store_id: scope.storeId, terminal_id: scope.terminalId, device_id: scope.deviceId, fiscalReturnContract: { profile: 'ORDINARY_RETURN_DOP_V1' } } };
    let batch = true, compatible = true;
    const transport = createFiscalReturnTransport(() => auth, async (url, init) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
        if (String(url).endsWith('capability'))
            return Response.json({ schemaVersion: 1, version: 1, profile: 'ORDINARY_RETURN_DOP_V1', capability: 'fiscalReturnV1', scope, enabled: false, transport: { requiresPreservedOuterContract: compatible, batch: { path: '/api/sync/inbox/batch', enabled: batch }, singular: { path: '/api/sync/inbox', enabled: true } } });
        return Response.json(batch ? { results: [{ eventId: event.eventId, status: 'APPLIED' }] } : { eventId: event.eventId, status: 'APPLIED' });
    });
    await transport.deliver([event]);
    assert.deepEqual(calls[1].body, { events: [event] });
    assert.ok(calls[1].url.endsWith('/inbox/batch'));
    batch = false;
    await transport.deliver([event]);
    assert.deepEqual(calls[3].body, event);
    assert.ok(calls[3].url.endsWith('/inbox'));
    compatible = false;
    const count = calls.length;
    await assert.rejects(transport.deliver([event]), /TRANSPORT/);
    assert.equal(calls.length, count + 1, 'capability GET only; no blind POST fallback');
    assert.ok(calls.every(c => !c.url.includes('issue')));
});
// The UI must never execute the legacy gateway refund before RETURN preparation.
test('ordinary E34 routes to its consumer before legacy gateway or NCF actions', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../components/TicketHistory.tsx', import.meta.url), 'utf8');
    const flow = source.slice(source.indexOf('   const executeRefundFlow = async ('), source.indexOf('   const confirmRefund = async ('));
    const route = flow.indexOf("if (fiscalMode === 'ECF'");
    assert.ok(route >= 0);
    assert.ok(route < flow.indexOf('db.canRequestMoreNCF'));
    assert.ok(route < flow.indexOf("requestMode === 'AZUL_GATEWAY_REFUND'"));
    assert.match(flow.slice(route, flow.indexOf('let refundOptions')), /await onRefundTransaction[\s\S]*return;/);
});

test('missing or null authenticated originalReference remains pending without preparing or financial effects', async t => {
 const f = await returnFixture(); t.after(() => f.cleanup());
 for (const reference of [undefined, null, { ...f.parent.originalReference, transactionId: 'different-sale' }]) {
  f.parent.originalReference = reference;
  await assert.rejects(f.run(), /FISCAL_RETURN_ACCEPTED_ORIGINAL_REQUIRED/);
  assert.equal(f.prepareCalls.length, 0);
  assert.equal(f.documents('inventoryLedger').length, 0);
  assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n, 0);
  assert.equal(f.documents('internalSequences').find(s => s.documentType === 'REFUND').nextNumber, 1);
 }
});

test('prepare preserves the complete authenticated originalReference without reconstructing it', async t => {
 const f = await returnFixture(); t.after(() => f.cleanup());
 const reference = structuredClone(f.parent.originalReference);
 delete f.parent.documentId;
 await f.run();
 assert.deepEqual(JSON.parse(f.prepareCalls[0]).originalReference, reference);
});

async function ordinaryReferenceStatusFixture() {
    const { createFiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
    const { observeFiscalWorkflowCapability, clearFiscalWorkflowCapability } = await import('../services/fiscal/FiscalWorkflowV2Capability');
    const { fiscalStatusSourceChecksum } = await import('../services/fiscal/FiscalStatusProof');
    const { sha256Utf8 } = await import('../services/sync/LargeMasterSyncV3Client');
    const { returnJSON } = await import('../services/fiscal/FiscalReturnV1');
    const f = await returnFixture();
    Object.assign(f.original, { fiscalEnvironment: 0, fiscalIssuance: { ncf: f.original.ncf, ncfType: 'E32', issuerRnc: '101010101', tenantId: f.scope.tenantId, companyId: f.scope.companyId, terminalId: f.scope.terminalId } });
    // Seed the synthetic original with its fiscal source before exercising the client.
    // Normal retained-source upserts correctly refuse adding fiscal identity afterward.
    f.db.prepare("UPDATE documents SET data=? WHERE collection_name IN ('transactions','transactionHistory') AND doc_id=?").run(JSON.stringify(f.original), f.original.id);
    const envelope = { transaction: structuredClone(f.original) };
    const state: any = { schemaVersion: 2, source: 'ERP_POS_FISCAL_WORKFLOW_V2', sourceKind: 'ORDINARY_SOURCE_V2', operationKind: 'SALE', mode: 'WORKFLOW', transactionId: f.original.id, workflowId: '40000000-0000-4000-8000-000000000001', permitId: null, scope: f.scope, issuerRnc: '101010101', environment: 0, ncf: f.original.ncf, ncfType: 'E32', currency: 'DOP', exchangeRate: 1, total: f.original.total, saleEventId: '40000000-0000-4000-8000-000000000002', originalSourceEnvelope: envelope, checksumV1: await fiscalStatusSourceChecksum(f.original), state: 'ACCEPTED', decision: 'ACCEPTED', signature: { schemaVersion: 1, qrUrl: 'https://fc.dgii.gov.do/testecf/consultatimbrefc', securityCode: 'ABCDEF', signedAt: '12-11-2026 10:11:12' }, draftRevision: 0, buyer: f.original.customerSnapshot, projectionDigest: 'a'.repeat(64), observationVersion: 1, canCorrect: false, reason: null, history: [], observedAt: new Date().toISOString(), originalReference: null, originalReferenceReason: 'FISCAL_ORIGINAL_REFERENCE_OBSERVATION_MISMATCH' };
    state.originalDigestV2 = await sha256Utf8(returnJSON({ schemaVersion: 2, source: 'POS_ORIGINAL_ENVELOPE_V2', scope: f.scope, saleEventId: state.saleEventId, payload: envelope }));
    const reference = { documentId: '40000000-0000-4000-8000-000000000003', transactionId: f.original.id, ncf: f.original.ncf, issuerRnc: state.issuerRnc, environment: state.environment, sourceChecksum: state.checksumV1 };
    let response = structuredClone(state);
    const base = 'https://reference-fixture.invalid/api/sync', headers = { 'X-Tenant-Id': f.scope.tenantId, 'X-Terminal-Id': f.scope.terminalId, 'X-Device-Id': f.scope.deviceId, 'X-Sync-Token': 'synthetic' };
    observeFiscalWorkflowCapability(base, headers, '2');
    const workflow = createFiscalWorkflowV2Client({ store: () => f.adapter.fiscalWorkflowStore, readSource: async () => f.original, readAuth: () => ({ base, headers, descriptor: f.scope, assertCurrent() {} }), fetchImpl: async (url: any) => { assert.match(String(url), /\/status\?transactionId=/); return Response.json(response); } } as any);
    return { ...f, state, reference, workflow, setResponse: (value: any) => { response = structuredClone(value); }, cleanup: () => { clearFiscalWorkflowCapability(); f.cleanup(); } };
}

test('equal-version authenticated ordinary reference refresh is transient, and fresh null overrides a cached reference', async t => {
    const f = await ordinaryReferenceStatusFixture(); t.after(() => f.cleanup());
    await f.adapter.fiscalWorkflowStore.saveState(f.original, f.state, null);
    const before = await f.adapter.fiscalWorkflowStore.readState(f.original.id);
    f.setResponse({ ...f.state, originalReference: f.reference, originalReferenceReason: null });
    assert.deepEqual((await f.workflow.consult(f.original.id)).originalReference, f.reference);
    assert.deepEqual(await f.adapter.fiscalWorkflowStore.readState(f.original.id), before);
    // A separate native fixture starts with an already verified reference; no state deletion
    // or equal-version write bypass is needed to test its transient withdrawal.
    const g = await ordinaryReferenceStatusFixture(); t.after(() => g.cleanup());
    await g.adapter.fiscalWorkflowStore.saveState(g.original, { ...g.state, originalReference: g.reference, originalReferenceReason: null }, null);
    g.setResponse({ ...g.state, originalReference: null, originalReferenceReason: 'FISCAL_ORIGINAL_REFERENCE_STORAGE_UNAVAILABLE' });
    const fresh = await g.workflow.consult(g.original.id);
    assert.equal(fresh.originalReference, null);
    assert.equal(fresh.originalReferenceReason, 'FISCAL_ORIGINAL_REFERENCE_STORAGE_UNAVAILABLE');
    assert.deepEqual((await g.adapter.fiscalWorkflowStore.readState(g.original.id)).originalReference, g.reference);
    assert.equal(fresh.decision, 'ACCEPTED');
    assert.deepEqual(fresh.signature, g.state.signature);
});

test('equal-version altered fiscal evidence, malformed reference and older observations cannot admit a RETURN', async t => {
    const { createFiscalReturnConsumer } = await import('../services/fiscal/FiscalReturnConsumer');
    const f = await ordinaryReferenceStatusFixture(); t.after(() => f.cleanup());
    const cached = { ...f.state, originalReference: f.reference, originalReferenceReason: null };
    await f.adapter.fiscalWorkflowStore.saveState(f.original, cached, null);
    const consumer = createFiscalReturnConsumer({ adapter: f.adapter, transport: { context: () => ({ descriptor: f.scope, assertCurrent() {} } as any), capability: async () => ({ schemaVersion: 1, version: 1, capability: 'fiscalReturnV1', profile: 'ORDINARY_RETURN_DOP_V1', enabled: true, ready: true, operationKind: 'RETURN', ncfType: 'E34', birthSchemaVersion: 3, eventSchemaVersion: 1, scope: f.scope, bindingAuthorityHash: 'b'.repeat(64), authorizationId: f.grant.authorizationId, authorityHash: f.grant.authorityHash, environment: 0, issuerRnc: '101010101', requiresOnlinePreparation: true, readiness: { admission: true, recovery: true, bank: false }, transport: { requiresPreservedOuterContract: true, batch: { enabled: true, path: '/api/sync/inbox/batch' }, singular: { enabled: true, path: '/api/sync/inbox' } } }), prepare: async () => { assert.fail('no prepare from stale or contradictory evidence'); } }, workflow: { ...f.localClient, consult: (id: string) => f.workflow.consult(id) }, readOriginal: async () => f.original, commit: async () => { assert.fail('no financial effects'); } });
    for (const changed of [ { ...cached, observationVersion: 0 }, { ...cached, mode: 'STATUS_ONLY', workflowId: null, permitId: null, originalReference: null }, { ...cached, sourceKind: undefined, originalReference: null }, { ...cached, signature: { ...cached.signature, securityCode: 'CHANGED' } }, { ...cached, originalReference: { ...f.reference, documentId: 'not-a-uuid' } }, { ...cached, checksumV1: 'd'.repeat(64) }, { ...cached, scope: { ...f.scope, tenantId: 'other-tenant' } } ]) {
        f.setResponse(changed);
        await assert.rejects(consumer.process(f.original, f.original.items, new Map([['line', 'SELLABLE']]), 'Synthetic return', f.documents('internalSequences').find(s => s.documentType === 'REFUND').id, { id: 'user', name: 'User' }));
        assert.deepEqual(await f.adapter.fiscalWorkflowStore.readState(f.original.id), cached);
        assert.equal(f.documents('inventoryLedger').length, 0);
        assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n, 0);
        assert.equal(f.documents('internalSequences').find(s => s.documentType === 'REFUND').nextNumber, 1);
    }
});

test('null original reference propagates safe ERP reason without interpreting it as a fiscal decision', async t => {
    const { returnOperatorMessage } = await import('../services/fiscal/FiscalReturnV1');
    const f = await returnFixture(); t.after(() => f.cleanup());
    f.parent.originalReference = null;
    f.parent.originalReferenceReason = 'FISCAL_ORIGINAL_REFERENCE_STORAGE_UNAVAILABLE';
    await assert.rejects(f.run(), /FISCAL_ORIGINAL_REFERENCE_STORAGE_UNAVAILABLE/);
    assert.match(returnOperatorMessage(Error(f.parent.originalReferenceReason)), /ERP.*pendiente/);
    f.parent.originalReferenceReason = 'database password=SECRET';
    await assert.rejects(f.run(), /FISCAL_RETURN_ACCEPTED_ORIGINAL_REQUIRED/);
    assert.equal(f.parent.decision, 'ACCEPTED');
    assert.equal(f.prepareCalls.length, 0);
    assert.equal(f.documents('inventoryLedger').length, 0);
    assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n, 0);
});

// Referenced VOID carries the affected sale identity, not the current transaction identity.
// The new SALE metadata contract must not reinterpret that pre-existing profile.
test('non-SALE ordinary reference semantics remain unchanged by SALE metadata refresh', async t => {
    const { verifyFiscalWorkflowState } = await import('../services/fiscal/FiscalWorkflowV2Client');
    for (const operationKind of ['VOID', undefined]) {
        const f = await ordinaryReferenceStatusFixture(); t.after(() => f.cleanup());
        const state = { ...f.state, operationKind, originalReference: { ...f.reference, transactionId: '40000000-0000-4000-8000-000000000099' }, originalReferenceReason: null };
        if (operationKind === undefined) delete state.operationKind;
        assert.equal(await verifyFiscalWorkflowState(f.original, state), true);
        await f.adapter.fiscalWorkflowStore.saveState(f.original, state, null);
        f.setResponse(state);
        assert.deepEqual(await f.workflow.consult(f.original.id), state);
        assert.deepEqual(await f.adapter.fiscalWorkflowStore.readState(f.original.id), state);
    }
});
