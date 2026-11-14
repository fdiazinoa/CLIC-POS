import test from 'node:test';
import assert from 'node:assert/strict';
import { assertReturnSnapshotDigest, RETURN_DIGEST_WIRE_SCHEME, buildReturnSource, type ReturnPreparation } from '../services/fiscal/FiscalReturnV1';
import { sha256Utf8 } from '../services/sync/LargeMasterSyncV3Client';
import { returnFixture } from './fiscalReturnConsumerFixture';

const envelope = (value: string) => `{"schemaVersion":1,"source":"ERP_POS_FISCAL_RETURN_V1","value":${value}}`;
async function proof(raw: string, advertised = JSON.parse(raw).value) {
    return { returnSnapshotDigestScheme: RETURN_DIGEST_WIRE_SCHEME, returnSnapshotDigestInput: raw, returnSnapshotDigest: await sha256Utf8(raw), returnSnapshot: advertised };
}

test('digest proof hashes exact UTF-8 PostgreSQL decimals, exponent spelling, escaping and Unicode', async () => {
    const escapedName = JSON.stringify('café 🍍\n"');
    const raw = envelope(`{"zero":0.00,"decimal":12.3000,"exponent":100000000000000000000.0001,"name":${escapedName},"array":[0.00,true,null]}`);
    // An integer rounded outside the supported range remains unsupported even with valid hash.
    await assert.rejects(assertReturnSnapshotDigest(await proof(raw)), /NUMBER_UNSUPPORTED/);
    const supported = raw.replace('100000000000000000000.0001', '1000.0001');
    await assertReturnSnapshotDigest(await proof(supported));
    const dto = await proof(envelope('{"amount":0.00}'));
    assert.notEqual(await sha256Utf8(JSON.stringify(JSON.parse(dto.returnSnapshotDigestInput))), dto.returnSnapshotDigest);
    assert.notEqual(await sha256Utf8(JSON.stringify(dto.returnSnapshotDigestInput)), dto.returnSnapshotDigest);
    await assert.rejects(assertReturnSnapshotDigest({ ...dto, returnSnapshotDigestInput: dto.returnSnapshotDigestInput + ' ' }), /HASH_MISMATCH/);
    await assertReturnSnapshotDigest(await proof(' ' + supported + '\n'));
});

for (const [label, change] of [
    ['missing scheme', (p: any) => { delete p.returnSnapshotDigestScheme; }],
    ['unknown scheme', (p: any) => { p.returnSnapshotDigestScheme = 'future-scheme'; }],
    ['missing digest', (p: any) => { delete p.returnSnapshotDigest; }],
    ['non-hex digest', (p: any) => { p.returnSnapshotDigest = 'x'.repeat(64); }],
    ['missing input', (p: any) => { delete p.returnSnapshotDigestInput; }],
    ['wrong input type', (p: any) => { p.returnSnapshotDigestInput = {}; }],
    ['uppercase hash', (p: any) => { p.returnSnapshotDigest = p.returnSnapshotDigest.toUpperCase(); }],
    ['raw tamper', (p: any) => { p.returnSnapshotDigestInput = p.returnSnapshotDigestInput.replace('0.00', '1.00'); }],
    ['snapshot tamper', (p: any) => { p.returnSnapshot.amount = 1; }],
] as const) test(`digest wire holds ${label}`, async () => {
    const dto: any = await proof(envelope('{"amount":0.00}')); change(dto);
    await assert.rejects(assertReturnSnapshotDigest(dto), /FISCAL_RETURN_DIGEST_WIRE_/);
});

for (const raw of [
    '{', 'null', '[]', envelope('[]'),
    '{"schemaVersion":"1","source":"ERP_POS_FISCAL_RETURN_V1","value":{}}',
    '{"schemaVersion":1,"source":"wrong","value":{}}',
    '{"schemaVersion":1,"source":"ERP_POS_FISCAL_RETURN_V1","value":{},"extra":true}',
    '{"schemaVersion":1,"source":"ERP_POS_FISCAL_RETURN_V1"}',
]) test(`digest wire rejects malformed or unsupported envelope ${raw.slice(0, 25)}`, async () => {
    const dto = { returnSnapshotDigestScheme: RETURN_DIGEST_WIRE_SCHEME, returnSnapshotDigestInput: raw, returnSnapshotDigest: await sha256Utf8(raw), returnSnapshot: {} };
    await assert.rejects(assertReturnSnapshotDigest(dto), /ENVELOPE_INVALID/);
});

test('value comparison preserves JSON types, own keys, array order and supported numbers', async () => {
    const dto = await proof(envelope('{"amount":12.3000,"values":[true,null,0]}'));
    for (const value of [{ amount: '12.3', values: [true, null, 0] }, { amount: 12.3, values: [null, true, 0] }, { amount: 12.3, values: [true, null, 0], extra: 1 }, { amount: 12.3 }, { amount: Infinity, values: [true, null, 0] }, { amount: 12.3, values: [true, undefined, 0] }, new Date()])
        await assert.rejects(assertReturnSnapshotDigest({ ...dto, returnSnapshot: value }), /FISCAL_RETURN_DIGEST_WIRE_/);
    // JSON.parse duplicate-key semantics match the published verifier; no lexical rejection is claimed.
    await assertReturnSnapshotDigest(await proof(envelope('{"amount":1,"amount":0.00}'), { amount: 0 }));
    const deep = '{"nested":'.repeat(2000) + 'null' + '}'.repeat(2000);
    await assertReturnSnapshotDigest(await proof(envelope(deep)));
});

for (const kind of ['missing', 'scheme', 'hash', 'value'] as const) test(`native ${kind} proof holds before source/payment/stock/outbox/counter effects and retains command IDs`, async t => {
    const f = await returnFixture(); t.after(() => f.cleanup());
    f.setProofTransform(p => {
        if (kind === 'missing') { delete p.returnSnapshotDigestInput; delete p.returnSnapshotDigestScheme; }
        if (kind === 'scheme') p.returnSnapshotDigestScheme = 'unsupported';
        if (kind === 'hash') p.returnSnapshotDigestInput += ' ';
        if (kind === 'value') p.returnSnapshot.total = 999;
        return p;
    });
    await assert.rejects(f.run(), /DIGEST_WIRE/);
    const before = JSON.parse((f.db.prepare('SELECT data FROM pos_fiscal_return_attempts_v1').get() as any).data);
    assert.equal(f.documents('inventoryLedger').length, 0);
    assert.equal(f.documents('transactions').filter(d => d.documentType === 'REFUND').length, 0);
    assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n, 0);
    assert.equal(f.documents('internalSequences').find(s => s.documentType === 'REFUND').nextNumber, 1);
    f.setProofTransform();
    const tx = await f.run();
    assert.equal(tx.id, before.checkout.transactionId);
    assert.equal(f.prepareCalls[0], f.prepareCalls[1]);
    const events = (f.db.prepare('SELECT payload_json FROM sync_outbox_v2').all() as any[]).map(r => JSON.parse(r.payload_json));
    for (const event of events) {
        assert.equal(Object.keys(event.fiscalReturnContract).length, 6);
        assert.equal(JSON.stringify(event).includes('returnSnapshotDigestInput'), false);
        assert.equal(JSON.stringify(event).includes('returnSnapshotDigestScheme'), false);
    }
});

for (const phase of ['PREPARED', 'SEALED'] as const) test(`legacy ${phase} DTO recovers by exact command replay after reopen with immutable preparation and write-once proof`, async t => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    const { default: SQLite } = await import('better-sqlite3');
    const dir = mkdtempSync(join(tmpdir(), 'clic-return-wire-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'pos.sqlite'); let f = await returnFixture(new SQLite(path));
    f.setLosePrepare(); await assert.rejects(f.run());
    let a = JSON.parse((f.db.prepare('SELECT data FROM pos_fiscal_return_attempts_v1').get() as any).data);
    const server = { preparations: f.preparations };
    const legacy = structuredClone([...f.preparations.values()][0]); delete legacy.returnSnapshotDigestInput; delete legacy.returnSnapshotDigestScheme;
    a = await f.adapter.fiscalReturnStore.save(a, { ...a, preparation: legacy, phase: 'PREPARED' });
    if (phase === 'SEALED') {
        const localCommittedAt = new Date().toISOString();
        const sealed = { ...a, localCommittedAt, phase: 'SEALED' as const };
        a = await f.adapter.fiscalReturnStore.save(a, { ...sealed, source: buildReturnSource(sealed, f.original, f.documents('internalSequences').find(s => s.documentType === 'REFUND').id, { id: 'user', name: 'User' }) });
    }
    const retained = structuredClone(a); f.cleanup();
    f = await returnFixture(new SQLite(path), false, server); t.after(() => f.cleanup());
    f.setProofTransform(p => ({ ...p, expiresAt: '2099-01-01T00:00:00Z' }));
    await assert.rejects(f.run(), /RECOVERY_CONFLICT/);
    assert.deepEqual((await f.adapter.fiscalReturnStore.get(a.id))!.preparation, legacy);
    assert.equal(f.documents('inventoryLedger').length, 0);
    f.setProofTransform();
    let injected = false;
    f.fault.beforeRun = async (_sql, values) => {
        if (!injected && values[0] === 'inventoryLedger') { injected = true; throw Error('SYNTHETIC_WIRE_COMMIT_ROLLBACK'); }
    };
    await assert.rejects(f.run(), /SYNTHETIC_WIRE_COMMIT_ROLLBACK/);
    const held = (await f.adapter.fiscalReturnStore.get(a.id))!;
    assert.equal(held.phase, 'SEALED');
    assert.ok(held.preparationDigestProof);
    await assert.rejects(f.adapter.fiscalReturnStore.save(held, { ...held, preparationDigestProof: { ...held.preparationDigestProof!, returnSnapshotDigestInput: 'tamper' } }), /DIGEST_WIRE_CONFLICT/);
    f.fault.beforeRun = undefined;
    await f.run();
    const after = (await f.adapter.fiscalReturnStore.get(a.id))!;
    assert.deepEqual(after.preparation, retained.preparation);
    assert.equal(after.commandBytes, retained.commandBytes);
    assert.equal(after.operationId, retained.operationId);
    assert.deepEqual(after.paymentIds, retained.paymentIds);
    assert.equal(after.paymentEventId, retained.paymentEventId);
    assert.equal(f.prepareCalls[0], retained.commandBytes);
    assert.equal(f.prepareCalls[1], retained.commandBytes);
    assert.ok(after.preparationDigestProof);
    if (phase === 'SEALED') assert.equal(after.localCommittedAt, retained.localCommittedAt);
    await assert.rejects(f.adapter.fiscalReturnStore.save(after, { ...after, preparationDigestProof: { ...after.preparationDigestProof!, returnSnapshotDigestInput: 'tamper' } }), /CONFLICT/);
});

test('stored unknown or partial proof is held without replay downgrade or replacing the immutable DTO', async t => {
    for (const partial of [false, true]) {
        const f = await returnFixture(); t.after(() => f.cleanup());
        f.setLosePrepare(); await assert.rejects(f.run());
        const a = JSON.parse((f.db.prepare('SELECT data FROM pos_fiscal_return_attempts_v1').get() as any).data);
        const preparation = structuredClone([...f.preparations.values()][0]);
        if (partial) delete preparation.returnSnapshotDigestInput;
        else preparation.returnSnapshotDigestScheme = 'unsupported-future';
        await f.adapter.fiscalReturnStore.save(a, { ...a, preparation, phase: 'PREPARED' });
        await assert.rejects(f.run(), /DIGEST_WIRE/);
        assert.equal(f.prepareCalls.length, 1);
        assert.deepEqual((await f.adapter.fiscalReturnStore.get(a.id))!.preparation, preparation);
        assert.equal(f.documents('inventoryLedger').length, 0);
        assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n, 0);
    }
});

test('legacy proof supplement cannot override snapshot, digest or preparation identity', async () => {
    const dto = await proof(envelope('{"amount":0.00}'));
    const { returnSnapshotDigestScheme, returnSnapshotDigestInput, ...legacy } = dto;
    const supplement = { returnSnapshotDigestScheme, returnSnapshotDigestInput };
    await assertReturnSnapshotDigest(legacy, supplement);
    for (const extra of [{ returnSnapshot: { amount: 999 } }, { returnSnapshotDigest: await sha256Utf8(envelope('{"amount":999}')) }, { preparationId: 'different' }])
        await assert.rejects(assertReturnSnapshotDigest(legacy, { ...supplement, ...extra } as any), /DIGEST_WIRE_INVALID/);
});
