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
