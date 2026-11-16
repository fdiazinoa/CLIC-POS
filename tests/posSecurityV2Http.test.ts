import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexedDBAdapter } from '../services/db/adapters/IndexedDBAdapter';
import { AuthenticatedPosSecurityV2Transport } from '../services/sync/PosSecurityV2Transport';
import { TerminalConfigRequestCoordinator } from '../services/sync/TerminalConfigRequestCoordinator';
import { PosSecurityV2Sync, type SecurityCarrier } from '../services/sync/PosSecurityV2Sync';
import { readPosSecurityRecords } from '../services/sync/PosSecurityV2Consumer';
import { readReturnSecurityContext, canAuthorizeReturn } from '../services/sync/PosSecurityV2Runtime';
import { requestJson } from '../services/network/httpClient';
import { securityAnnouncement, securityHash, type SecurityBinding, type SecurityControl, type SecurityReference } from '../services/sync/PosSecurityV2Contract';

const binding: SecurityBinding = { tenantId: 'tenant-http', terminalId: 'terminal-http', deviceId: 'device-http', bindingEpoch: 7 };
const role = (permissions = ['POS_RETURNS', 'CUSTOM']) => ({ id: 'R', permissionContractVersion: 2, permissions, permission_keys: permissions, maxDiscountPercent: 7, zReportConfig: { hiddenModules: ['AUDIT'] } });
function control(status: SecurityControl['negotiation']['status'] = 'ACTIVE', revision = 3, b = binding, agreementId = 'agreement-http'): SecurityControl {
  const floor = ['ACTIVE', 'SUSPENDED'].includes(status) ? 2 : 0;
  return { status: 'success', negotiation: { status, stateRevision: revision, protocolFloor: floor, binding: b,
    offer: { ...securityAnnouncement(b), offerId: 'offer-http', agreementId, expiresAt: 300001 } },
    selection: status === 'ACTIVE' ? { mode: 'V2', currentOperationsUnchanged: false, agreementId }
      : floor === 2 ? { mode: 'BLOCKED', currentOperationsUnchanged: false, reason: 'V2_REQUIRED' }
      : { mode: 'CURRENT_UNCHANGED', currentOperationsUnchanged: true, reason: status === 'ACCEPTED' ? 'WAIT_ACTIVATION' : 'WAIT_NEGOTIATION' } };
}
async function envelope(revision = 1, roles: unknown[] = [role()], users: unknown[] = [{ id: 'cashier', role_id: 'R', pin: 'synthetic-pin' }]) {
  const block = { ...securityAnnouncement(binding), agreementId: 'agreement-http', securityRevision: revision, roles, users };
  return { ...block, contentHash: await securityHash(block) };
}
function reference(block: Awaited<ReturnType<typeof envelope>>): SecurityReference {
  return { binding: block.binding, agreementId: block.agreementId, contractDigest: block.contractDigest, permissionContractVersion: 2, securityRevision: block.securityRevision, contentHash: block.contentHash };
}
async function fixture(t: test.TestContext) {
  const logs = [t.mock.method(console, 'log', () => {}), t.mock.method(console, 'warn', () => {}), t.mock.method(console, 'error', () => {})];
  t.after(() => {
    const text = JSON.stringify(logs.flatMap(log => log.mock.calls.map(call => call.arguments)));
    assert.ok(!text.includes('synthetic-http-token')); assert.ok(!text.includes('synthetic-pin'));
  });
  Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange,
    window: Object.assign(new EventTarget(), { setTimeout, clearTimeout }), localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  const adapter = new IndexedDBAdapter(); await adapter.connect(); t.after(() => adapter.disconnect());
  const f = { block: await envelope(), control: control(), token: 'synthetic-http-token', status: 200,
    calls: [] as { path: string; method: string; headers: IncomingMessage['headers']; body: unknown }[] };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    const path = new URL(req.url!, 'http://localhost').pathname;
    f.calls.push({ path, method: req.method!, headers: req.headers, body: text ? JSON.parse(text) : undefined });
    const send = (body: unknown, status = f.status) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(status === 304 ? undefined : JSON.stringify(body)); };
    if (req.headers['x-sync-token'] !== 'synthetic-http-token') return send({}, 401);
    if (req.headers['x-device-id'] !== binding.deviceId || (!path.includes(`/${binding.terminalId}/`) && !path.endsWith(`/${binding.terminalId}`))) return send({}, 403);
    if (path.endsWith('/security-contract/offer')) f.control = control('OFFERED', 1);
    if (path.endsWith('/security-contract/accept')) f.control = control('ACCEPTED', 2);
    if (path.endsWith('/security-contract/capability')) f.control = control('SUSPENDED', 4);
    if (path.includes('/security-contract')) return send(f.control);
    if (path.endsWith('/manifest')) return send({ manifest: { security_contract: reference(f.block) } });
    if (path.includes('/config-snapshots/')) return send({ domains: { catalog: { pos_security: f.block } } });
    if (path.includes('/initial-config/')) return send({ terminal_config: { pos_security: f.block } });
    if (path.endsWith('/config')) return send({ terminal_config: { pos_security: f.block } });
    send({}, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const identity = { erpSyncBaseUrl: `${base}/api/sync`, ...binding, syncToken: f.token };
  const transport = new AuthenticatedPosSecurityV2Transport(() => ({ ...identity, syncToken: f.token }));
  const sync = new PosSecurityV2Sync(adapter, transport);
  const get = async (path: string) => (await requestJson({ url: `${base}${path}`, headers: { 'X-Sync-Token': f.token, 'X-Device-Id': binding.deviceId } })).data;
  return { f, adapter, sync, transport, identity, get, base };
}

test('HTTP transport sends existing auth/device headers, exact explicit bodies, idempotent ACCEPTED and no polling negotiation', async t => {
  const s = await fixture(t); s.f.control = control('OFFERED', 1);
  await s.sync.consumer.announce(); await s.sync.consumer.accept(); await s.sync.consumer.accept();
  assert.equal((await readPosSecurityRecords(s.adapter))[0].protocolFloor, 0);
  assert.equal((await s.sync.consumer.refreshControl()).selection.mode, 'CURRENT_UNCHANGED');
  const posts = s.f.calls.filter(call => call.method === 'POST');
  assert.equal(posts.length, 3);
  assert.deepEqual(posts[0].body, securityAnnouncement(binding));
  assert.deepEqual(posts[1].body, { ...securityAnnouncement(binding), offerId: 'offer-http' });
  assert.deepEqual(posts[2].body, posts[1].body);
  for (const call of s.f.calls) {
    assert.equal(call.headers['x-sync-token'], 'synthetic-http-token');
    assert.equal(call.headers['x-device-id'], binding.deviceId); assert.equal(call.headers['x-pos-device-id'], binding.deviceId);
    assert.equal(call.headers['if-none-match'], undefined);
  }
  assert.ok(!s.f.calls.some(call => /activat/.test(call.path)));
  await assert.rejects(s.sync.receive({ terminal_config: { pos_security: s.f.block } }, 'terminal-config'), /NOT_ACTIVE/);
});

test('HTTP config/initial-config/snapshot/manifest/push carriers replace, revoke and persist empty lists without legacy reconstruction', async t => {
  const s = await fixture(t);
  const carriers: [SecurityCarrier, string][] = [
    ['initial-config', `/api/setup/initial-config/${binding.terminalId}`],
    ['terminal-config', `/api/sync/terminals/${binding.terminalId}/config`],
    ['config-snapshot', `/api/sync/terminals/${binding.terminalId}/config-snapshots/external-id`],
    ['manifest', `/api/sync/terminals/${binding.terminalId}/manifest`],
  ];
  for (const [index, [carrier, path]] of carriers.entries()) {
    s.f.block = await envelope(index + 1, index === 2 ? [] : [role(index ? [] : undefined)], index === 2 ? [] : [{ id: 'cashier', role_id: 'R' }]);
    assert.equal(await s.sync.receive(await s.get(path), carrier), 'APPLIED');
  }
  s.f.block = await envelope(5, [], []);
  const payload = { security_contract: reference(s.f.block), snapshot_id: 'external-only', version_hash: 'transport-hash' };
  assert.equal(await s.sync.receive(payload, 'config-push'), 'APPLIED');
  assert.equal(await s.sync.receive(payload, 'config-push'), 'DUPLICATE');
  assert.ok(!Object.hasOwn(payload.security_contract, 'snapshotId'));
  await s.adapter.disconnect(); await s.adapter.connect();
  assert.deepEqual(await s.adapter.getCollection('roles'), []); assert.deepEqual(await s.adapter.getCollection('users'), []);
  assert.equal((await readPosSecurityRecords(s.adapter))[0].appliedReference!.securityRevision, 5);
  assert.equal((await readReturnSecurityContext(s.adapter, [], [], () => s.sync.authorizedBinding())).mode, 'V2');
  assert.equal(s.f.calls.filter(call => call.method === 'POST').length, 0, 'carriers and restart do not negotiate');
});

test('missing/invalid tokens, cross tenant/terminal/device, partition and 304 fail closed without publication', async t => {
  const s = await fixture(t);
  s.f.token = ''; await assert.rejects(s.transport.state(), /AUTH_REQUIRED/); assert.equal(s.f.calls.length, 0);
  s.f.token = 'invalid'; await assert.rejects(s.transport.state(), /HTTP_401/);
  s.f.token = 'synthetic-http-token';
  for (const key of ['tenantId', 'terminalId', 'deviceId'] as const) {
    s.f.control = control('ACTIVE', 3, { ...binding, [key]: 'foreign' });
    await assert.rejects(s.transport.authorizedBinding(), /BINDING_MISMATCH/);
  }
  s.f.control = control(); await s.sync.consumer.refreshControl();
  await assert.rejects(s.transport.download(reference(s.f.block), 'wrong-partition'), /PARTITION_MISMATCH/);
  s.f.status = 304; await assert.rejects(s.sync.receive({ security_contract: reference(s.f.block) }, 'config-push'), /HTTP_304/);
  assert.deepEqual(await s.adapter.getCollection('roles'), []);
});

test('HTTP old refs, hash conflicts, missing role and agreement changes never return APPLIED', async t => {
  const s = await fixture(t); await s.sync.receive(await s.get(`/api/sync/terminals/${binding.terminalId}/manifest`), 'manifest');
  const saved = await readPosSecurityRecords(s.adapter);
  const old = reference(s.f.block); s.f.block = await envelope(2, [role([])]);
  await assert.rejects(s.sync.receive({ security_contract: old }, 'config-push'), /REFERENCE_MISMATCH/);
  s.f.block = { ...s.f.block, contentHash: '0'.repeat(64) };
  await assert.rejects(s.sync.receive({ security_contract: reference(s.f.block) }, 'config-push'), /HASH_MISMATCH/);
  s.f.block = await envelope(1, [role([])]);
  await assert.rejects(s.sync.receive({ security_contract: reference(s.f.block) }, 'config-push'), /REVISION_STALE/);
  s.f.block = await envelope(3, [], [{ id: 'cashier', role_id: 'missing' }]);
  await assert.rejects(s.sync.receive({ security_contract: reference(s.f.block) }, 'config-push'), /USER_INVALID/);
  assert.deepEqual(await readPosSecurityRecords(s.adapter), saved);
  s.f.control = control('ACTIVE', 4, binding, 'agreement-new');
  await assert.rejects(s.sync.receive({ security_contract: old }, 'config-push'), /REFERENCE_INVALID/);
  assert.equal((await readReturnSecurityContext(s.adapter, [], [], () => s.sync.authorizedBinding())).mode, 'BLOCKED');
});

test('HTTP floor2 survives network/capability loss, restart and rebind without legacy authorization', async t => {
  const s = await fixture(t); await s.sync.receive(await s.get(`/api/sync/terminals/${binding.terminalId}/manifest`), 'manifest');
  s.f.block = await envelope(2, [role([])]); await s.sync.receive({ security_contract: reference(s.f.block) }, 'config-push');
  s.f.status = 503;
  await assert.rejects(s.sync.consumer.reportLoss('CAPABILITY_LOST'), /HTTP_503/);
  await s.adapter.disconnect(); await s.adapter.connect();
  const ctx = await readReturnSecurityContext(s.adapter, [], [], () => s.sync.authorizedBinding());
  assert.equal(ctx.mode, 'BLOCKED'); assert.equal(canAuthorizeReturn(ctx, { id: 'cashier' } as never), false);
  assert.equal((await readPosSecurityRecords(s.adapter))[0].protocolFloor, 2);
  s.f.status = 200; s.f.control = control('ACTIVE', 5, { ...binding, deviceId: 'replacement', bindingEpoch: 8 });
  await assert.rejects(s.sync.receive({ security_contract: reference(s.f.block) }, 'config-push'), /BINDING_MISMATCH/);
  assert.deepEqual((await s.adapter.getCollection<{ permissions: string[] }>('roles'))[0].permissions, []);
});

test('no security publication on failed commit; concurrent HTTP consumers use the existing durable CAS', async t => {
  const s = await fixture(t); await s.sync.consumer.refreshControl();
  const original = s.adapter.saveDocumentsAtomically.bind(s.adapter);
  s.adapter.saveDocumentsAtomically = async (...args) => { if (args[2]?.length) throw new Error('SYNTHETIC_COMMIT_FAILURE'); return original(...args); };
  await assert.rejects(s.sync.receive({ security_contract: reference(s.f.block) }, 'config-push'), /COMMIT_FAILURE/);
  assert.equal((await readPosSecurityRecords(s.adapter))[0].appliedReference, null);
  assert.deepEqual(await s.adapter.getCollection('roles'), []);
  s.adapter.saveDocumentsAtomically = original;
  const results = await Promise.allSettled([s.sync.consumer.applyCarrier({ pos_security: s.f.block }), s.sync.consumer.applyCarrier({ pos_security: s.f.block })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await readPosSecurityRecords(s.adapter))[0].appliedReference!.contentHash, s.f.block.contentHash);
});


test('credential change in flight cannot publish a response from the previous scope', async () => {
  let identity = { erpSyncBaseUrl: 'http://127.0.0.1:1/api/sync', tenantId: binding.tenantId, terminalId: binding.terminalId, deviceId: binding.deviceId, syncToken: 'synthetic-only' };
  const transport = new AuthenticatedPosSecurityV2Transport(() => identity, async () => {
    identity = { ...identity, tenantId: 'replacement-tenant' };
    return { status: 200, ok: true, data: control(), headers: {}, text: '', networkEngine: 'fetch', fetchStage: 'FETCH_RESPONSE' };
  });
  await assert.rejects(transport.state(), /CONTEXT_CHANGED/);
});


test('initial-config coordinator validates security before apply/cache and rejects generic 304 after floor2', async t => {
  const s = await fixture(t);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  let applications = 0;
  const coordinator = new TerminalConfigRequestCoordinator(storage, fetch, [], undefined, {
    headers: () => ({ 'X-Sync-Token': 'synthetic-http-token' }), receive: body => s.sync.receive(body, 'initial-config'),
  });
  const input = { baseUrl: s.base, ...binding, reason: 'startup' as const, apply: async () => { applications++; assert.equal((await readPosSecurityRecords(s.adapter))[0].appliedReference!.contentHash, s.f.block.contentHash); } };
  assert.equal((await coordinator.request(input)).status, 'applied'); assert.equal(applications, 1);
  const cache = coordinator.readCache(binding.terminalId);
  s.f.status = 304;
  await assert.rejects(coordinator.request(input), /CARRIER_INVALID|HTTP_304/);
  assert.equal(applications, 1); assert.deepEqual(coordinator.readCache(binding.terminalId), cache);
});
