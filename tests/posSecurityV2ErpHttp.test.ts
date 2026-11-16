import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexedDBAdapter } from '../services/db/adapters/IndexedDBAdapter';
import { PosSecurityV2Sync } from '../services/sync/PosSecurityV2Sync';
import { AuthenticatedPosSecurityV2Transport } from '../services/sync/PosSecurityV2Transport';
import { readPosSecurityRecords } from '../services/sync/PosSecurityV2Consumer';
import { securityAnnouncement, securityPartition } from '../services/sync/PosSecurityV2Contract';
import { originalErpFixture } from './fixtures/posSecurityV2/originalErp';

// Opt-in: an unmodified ERP210102cd export. Full routers load verbatim; infrastructure is synthetic.
const source = process.env.CLIC_SECURITY_V2_ERP_SOURCE ? realpathSync(process.env.CLIC_SECURITY_V2_ERP_SOURCE) : undefined;
test('original ERP setup/control/config/manifest/config-snapshot handlers over loopback HTTP', { skip: !source }, async t => {
  const logs = [t.mock.method(console, 'log', () => {}), t.mock.method(console, 'info', () => {}), t.mock.method(console, 'warn', () => {}), t.mock.method(console, 'error', () => {})];
  const f = await originalErpFixture(source!); t.after(() => f.close());
  const { binding } = f;
  const headers = { 'X-Sync-Token': f.token, 'X-Device-Id': binding.deviceId, 'X-POS-Device-Id': binding.deviceId, 'X-Terminal-Id': binding.terminalId };
  const identity = { ...binding, erpSyncBaseUrl: `${f.base}/api/sync`, syncToken: f.token };
  const transport = new AuthenticatedPosSecurityV2Transport(() => identity);
  const prefix = `/api/sync/terminals/${binding.terminalId}`;
  const request = async (path: string, overrides: Record<string, string> = {}, method = 'GET') => {
    const response = await fetch(`${f.base}${path}`, { method, headers: { ...headers, ...overrides } });
    const text = await response.text(); return { status: response.status, headers: response.headers, body: text && response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text || null };
  };
  Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange,
    window: Object.assign(new EventTarget(), { setTimeout, clearTimeout }), localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  const adapter = new IndexedDBAdapter(); await adapter.connect(); t.after(() => adapter.disconnect());
  const sync = new PosSecurityV2Sync(adapter, transport);
  const durable = async () => ({ records: await readPosSecurityRecords(adapter), roles: await adapter.getCollection('roles'), users: await adapter.getCollection('users') });

  await t.test('original control explicit offer/accept remains idempotent CURRENT until synthetic fixture approval', async () => {
    assert.deepEqual(await transport.authorizedBinding(), binding);
    const offered: any = await transport.offer(securityAnnouncement(binding));
    assert.equal(offered.negotiation.status, 'OFFERED');
    const body = { ...securityAnnouncement(binding), offerId: offered.negotiation.offer.offerId };
    const accepted: any = await transport.accept(body);
    assert.deepEqual(await transport.accept(body), accepted);
    assert.equal(accepted.selection.reason, 'WAIT_ACTIVATION'); assert.equal(accepted.negotiation.protocolFloor, 0);
    const before = f.cas; await transport.state(); await transport.state(); assert.equal(f.cas, before);
    for (const key of ['tenantId', 'terminalId', 'deviceId'] as const) await assert.rejects(transport.accept({ ...body, binding: { ...binding, [key]: 'foreign' } }), /BINDING_MISMATCH/);
    for (const token of ['', 'invalid']) { const result = await request(`${prefix}/security-contract`, { 'X-Sync-Token': token }); assert.ok(result.status >= 400 && result.status < 500); }
    assert.equal((await request(`${prefix}/security-contract`, { 'X-Device-Id': 'foreign' })).status, 403);
    f.context.state = f.agreementModule.activatePosPermissionClientAgreement(f.context.state, { authorizedBinding: binding, rolloutApproved: true, consumerAcceptanceVerificationId: 'synthetic-test-only', verificationBinding: binding, verificationAgreementId: accepted.negotiation.offer.agreementId, verificationContractDigest: accepted.negotiation.offer.contractDigest, nowMs: Date.now() });
    assert.equal((await transport.state()).negotiation.status, 'ACTIVE');
    assert.equal((await request(`${prefix}/security-contract/activate`, {}, 'POST')).status, 404);
  });

  await t.test('original initial-config envelope validates in the POS consumer', async () => {
    const result = await request(`/api/setup/initial-config/${binding.terminalId}`, { 'If-None-Match': '"fixture-config-version"' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(await sync.receive(result.body, 'initial-config'), 'APPLIED');
    assert.deepEqual((await adapter.getCollection<{ permissions: string[] }>('roles'))[0].permissions, ['POS_RETURNS']);
    // Original setup maps terminalOperationalAuth.status to 500; it still denies (existing ERP limitation).
    assert.equal((await request(`/api/setup/initial-config/${binding.terminalId}`, { 'X-Sync-Token': 'invalid' })).status, 500);
  });

  await t.test('original config handler emits the exact carrier and applies a complete replacement', async () => {
    f.setSource([{ id: 'R', permissions: ['ALL', 'CUSTOM'], version: 2 }], [{ id: 'u', role_id: 'R' }]);
    const result = await request(`${prefix}/config`, { 'If-None-Match': '"stale-generic"' });
    assert.equal(result.status, 200); assert.match(result.headers.get('cache-control')!, /no-store/);
    assert.ok(result.body.terminal_config.pos_security); assert.equal(result.body.pos_security, undefined);
    assert.equal(result.body.terminal_config.masters.pos_roles, undefined);
    assert.equal(await sync.receive(result.body, 'terminal-config'), 'APPLIED');
    assert.equal(await sync.receive(result.body, 'terminal-config'), 'DUPLICATE');
    assert.deepEqual((await adapter.getCollection<{ permissions: string[] }>('roles'))[0].permissions, ['ALL', 'CUSTOM']);
    const current: any = await transport.currentReference();
    const downloaded: any = await transport.download(current, await securityPartition(current));
    assert.equal(downloaded.pos_security.contentHash, current.contentHash);
  });

  await t.test('original manifest handler carries only the current reference and downloads revoked permissions', async () => {
    f.setSource([{ id: 'R', permissions: [], version: 3 }], [{ id: 'u', role_id: 'R' }]);
    const result = await request(`${prefix}/manifest`, { 'If-None-Match': '"stale-generic"' });
    assert.equal(result.status, 200); assert.match(result.headers.get('cache-control')!, /no-store/);
    assert.ok(result.body.manifest.security_contract); assert.equal(result.body.manifest.pos_security, undefined);
    assert.equal(result.body.manifest.roles, undefined); assert.equal(result.body.manifest.users, undefined);
    assert.deepEqual(await transport.currentReference(), result.body.manifest.security_contract);
    assert.equal(await sync.receive(result.body, 'manifest'), 'APPLIED');
    assert.deepEqual((await adapter.getCollection<{ permissions: string[] }>('roles'))[0].permissions, []);
    assert.equal(await sync.receive(result.body, 'manifest'), 'DUPLICATE');
  });

  await t.test('original config-snapshot handler bypasses generic304, preserves external identity and replaces with empty lists', async () => {
    f.setSource([], []); const snapshot = await f.snapshot();
    const path = `${prefix}/config-snapshots/${snapshot.id}?version_hash=${snapshot.version_hash}&current_version=${snapshot.version_hash}&scopes=catalog`;
    const result = await request(path, { 'If-None-Match': '"generic-version"' });
    assert.equal(result.status, 200); assert.match(result.headers.get('cache-control')!, /no-store/);
    assert.equal(result.body.snapshot_id, snapshot.id); assert.equal(result.body.version_hash, snapshot.version_hash);
    assert.ok(result.body.domains.catalog.pos_security); assert.equal(result.body.pos_security, undefined);
    assert.ok(!Object.hasOwn(snapshot.payload.security_contract, 'snapshotId'));
    assert.equal(await sync.receive(result.body, 'config-snapshot'), 'APPLIED');
    assert.equal(await sync.receive(result.body, 'config-snapshot'), 'DUPLICATE');
    assert.deepEqual(await adapter.getCollection('roles'), []); assert.deepEqual(await adapter.getCollection('users'), []);
    await adapter.disconnect(); await adapter.connect();
    assert.equal((await readPosSecurityRecords(adapter))[0].protocolFloor, 2);
  });

  await t.test('each real handler rejects missing/invalid token and foreign device without durable publication', async () => {
    const snapshot = await f.snapshot();
    const before = await durable();
    for (const path of [`${prefix}/config`, `${prefix}/manifest`, `${prefix}/config-snapshots/${snapshot.id}`]) {
      for (const overrides of [{ 'X-Sync-Token': '' }, { 'X-Sync-Token': 'invalid' }, { 'X-Device-Id': 'foreign', 'X-POS-Device-Id': 'foreign' }]) {
        const result = await request(path, overrides);
        assert.ok(result.status >= 400 && result.status < 500, `${path}: expected auth4xx, got ${result.status} ${JSON.stringify(result.body)}`);
        assert.deepEqual(await durable(), before);
      }
    }
  });

  await t.test('foreign terminal routes cannot expose another scope; original config/manifest canonical recovery remains bound', async () => {
    const before = await durable(); const foreignPrefix = `/api/sync/terminals/${f.otherTerminalId}`;
    for (const suffix of ['config', 'manifest']) {
      const result = await request(`${foreignPrefix}/${suffix}`);
      // Original middleware canonicalizes a stale route to the device-authorized terminal.
      assert.equal(result.status, 200);
      const reference = suffix === 'manifest' ? result.body.manifest.security_contract : result.body.terminal_config.pos_security;
      assert.deepEqual(reference.binding, binding);
      assert.equal(await sync.receive(result.body, suffix === 'manifest' ? 'manifest' : 'terminal-config'), 'DUPLICATE');
    }
    const snapshot = await f.snapshot();
    assert.equal((await request(`${foreignPrefix}/config-snapshots/${snapshot.id}`)).status, 403);
    assert.deepEqual(await durable(), before);
  });

  await t.test('real snapshot handler denies old/reference/version/scope/hash/tenant/terminal partitions before publication', async () => {
    const snapshot = await f.snapshot(); const before = await durable();
    const path = `${prefix}/config-snapshots/${snapshot.id}`;
    assert.equal((await request(`${prefix}/config-snapshots/foreign-snapshot`)).status, 404);
    assert.equal((await request(`${path}?version_hash=foreign-version`)).status, 409);
    assert.equal((await request(`${path}?scopes=fiscal`)).status, 403);
    const manifest = f.snapshots[0], catalog = f.snapshots[1];
    const savedReference = structuredClone(manifest.payload.security_contract), savedBlock = structuredClone(catalog.payload.pos_security);
    for (const patch of [
      { agreementId: 'old-agreement' }, { securityRevision: savedReference.securityRevision - 1 },
      { binding: { ...binding, tenantId: 'foreign' } }, { binding: { ...binding, terminalId: f.otherTerminalId } },
      { binding: { ...binding, deviceId: 'foreign' } },
    ]) {
      manifest.payload.security_contract = { ...savedReference, ...patch };
      assert.equal((await request(path)).status, 409);
      assert.deepEqual(await durable(), before);
    }
    manifest.payload.security_contract = savedReference;
    catalog.payload.pos_security = { ...savedBlock, contentHash: '0'.repeat(64) };
    assert.equal((await request(path)).status, 409);
    catalog.payload.pos_security = savedBlock;
    for (const key of ['tenant_id', 'terminal_id']) {
      const prior = manifest[key]; manifest[key] = 'foreign';
      assert.equal((await request(path)).status, 404); manifest[key] = prior;
      const domainPrior = catalog[key]; catalog[key] = 'foreign';
      assert.equal((await request(path)).status, 503); catalog[key] = domainPrior;
    }
    assert.ok(f.reads.some(read => read.table === 'erp_sync_snapshots' && read.filters.some(([key]) => key === 'tenant_id') && read.filters.some(([key]) => key === 'terminal_id')));
    assert.deepEqual(await durable(), before);
  });

  await t.test('old real-handler responses and tampered config bodies cannot publish a newer grant', async () => {
    const oldManifest = (await request(`${prefix}/manifest`)).body;
    f.setSource([{ id: 'R', permissions: ['POS_RETURNS'], version: 5 }], [{ id: 'u', role_id: 'R' }]);
    const before = await durable();
    await assert.rejects(sync.receive(oldManifest, 'manifest'), /REFERENCE_MISMATCH/);
    const config = (await request(`${prefix}/config`)).body;
    config.terminal_config.pos_security.contentHash = '0'.repeat(64);
    await assert.rejects(sync.receive(config, 'terminal-config'), /REFERENCE_MISMATCH|HASH_MISMATCH/);
    assert.deepEqual(await durable(), before);
  });

  const text = JSON.stringify(logs.flatMap(log => log.mock.calls.map(call => call.arguments)));
  assert.ok(!text.includes(f.token), 'fixtures must not expose their token in logs');
  assert.ok(!text.includes('Unexpected ERP dependency'), 'all invoked infrastructure ports must be declared');
});
