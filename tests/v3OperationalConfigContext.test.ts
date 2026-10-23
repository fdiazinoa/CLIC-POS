import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { nativeFixture, id } from './articleFormatsNativeFixture';
import { v3OperationalConfigContext } from '../services/sync/LargeMasterSyncV3OperationalConfigScope';

async function fixture() {
  const f = await nativeFixture();
  const config = f.documents('config')[0];
  config.terminals[0].config.pricing = { defaultTariffId: id(6), allowedTariffIds: [id(6)],
    tariffs: [{ id: id(6), strategy: 'BASE', scope: 'ALL', items: [] }] };
  await f.adapter.saveCollection('config', config);
  f.db.prepare("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES(?,32,3,2,'ACTIVE','{}','fixture','fixture')").run(id(60));
  let opens = 0;
  const env: any = { adapter: f.adapter, config, identity: { tenantId: id(1), terminalId: id(4), deviceId: id(50), erpSyncBaseUrl: 'https://erp.invalid', syncToken: 'synthetic' },
    proof: { tenantId: id(1), terminalId: id(4), deviceId: id(50), companyId: id(2) }, guard: 'synthetic-guard', origin: 'https://erp.invalid', downloads: 0 };
  Object.assign(f.adapter, { connect: async () => { opens++; await env.onConnect?.(); } });
  (globalThis as any).__configContext = env;
  const result = await build({ entryPoints: ['services/sync/LargeMasterSyncV3OperationalSession.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', define: { 'import.meta.env': '{}' }, plugins: [{ name: 'native-local-context', setup(b) {
    b.onResolve({ filter: /^(\.\.\/db|\.\.\/\.\.\/utils\/db|\.\/OfflineV3OperationalIdentity|\.\/LargeMasterSyncV3(?:Platform|Authority|Candidate|BoundTransport|DownloadOrigin)|\.\/OperationalTerminalConfig)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: `const E=globalThis.__configContext;` + (path === '../db' ? 'exports.dbAdapter=E.adapter;' : path === '../../utils/db' ? 'exports.db={get:()=>E.adapter.getCollection("config")};' : path.endsWith('Platform') ? 'exports.assertLargeMasterSyncV3NativeAndroid=()=>{};' : path.endsWith('Authority') ? 'exports.LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED=true;' : path.endsWith('Candidate') ? 'const download=()=>{E.downloads++;throw Error("network-forbidden")};exports.prepareLargeMasterSyncV3Candidate=exports.prepareLargeMasterSyncV3CatalogOnly=exports.prepareLargeMasterSyncV3UnusedBaseline=download;' : path.endsWith('BoundTransport') ? 'exports.readLargeMasterSyncV3BoundIdentity=()=>{if(E.offline)throw Error("token-unavailable");return E.identity;};exports.validatedLargeMasterSyncV3ErpSyncBase=x=>x;' : path.endsWith('DownloadOrigin') ? 'exports.largeMasterSyncV3DownloadOrigin=()=>E.origin;' : path.endsWith('OfflineV3OperationalIdentity') ? 'exports.readOfflineV3OperationalAuthority=async()=>{if(!E.offlineAuthority)throw Error("no-offline-authority");return E.offlineAuthority;};' : 'exports.readOperationalTerminalBinding=()=>E.guard;exports.readOperationalCatalogBindingProof=()=>E.proof;') }));
  } }] });
  const loaded = { exports: {} as any }; new Function('module', 'exports', result.outputFiles[0].text)(loaded, loaded.exports);
  return { ...f, env, module: loaded.exports, opens: () => opens, close: () => { f.db.close(); delete (globalThis as any).__configContext; } };
}

test('shared fingerprint retains complete metadata and rejects missing/ambiguous canonical terminal', () => {
  const config: any = { terminals: [{ id: 'T', config: { pricing: { tariffs: [{ isDefault: true }] } } }] };
  const a = v3OperationalConfigContext(config, { localTerminalId: 'T' }).scope;
  config.terminals[0].config.pricing.tariffs[0].strategy = 'BASE';
  assert.notEqual(v3OperationalConfigContext(config, { localTerminalId: 'T' }).scope, a);
  assert.throws(() => v3OperationalConfigContext(config, { localTerminalId: 'missing' }), /BINDING_CHANGED/);
  config.terminals.push(config.terminals[0]);
  assert.throws(() => v3OperationalConfigContext(config, { localTerminalId: 'T' }), /BINDING_CHANGED/);
});

test('actual native session renews normalized metadata once; old session rejects, no downloads or financial writes', async () => {
  const f = await fixture(); try {
    const old = await f.module.getLargeMasterSyncV3OperationalSession();
    const next = structuredClone(f.env.config); next.terminals[0].config.pricing.tariffs = [{ id: id(6), isDefault: true }];
    await f.adapter.saveCollection('config', next);
    const before = f.state(), opens = f.opens();
    const sessions = await Promise.all([f.module.acquireLargeMasterSyncV3ConfigContext(next, id(4)), f.module.acquireLargeMasterSyncV3ConfigContext(next, id(4))]);
    assert.strictEqual(sessions[0], sessions[1]); assert.equal(f.opens() - opens, 2);
    await sessions[0].assertCurrent(); await assert.rejects(old.assertCurrent(), /BINDING_CHANGED/);
    assert.strictEqual(await f.module.getLargeMasterSyncV3OperationalSession(), sessions[0], 'first ordinary financial getter observes published B');
    await assert.rejects(old.assertCurrent(), /BINDING_CHANGED/);
    assert.deepEqual(f.state(), before); assert.equal(f.env.downloads, 0);
  } finally { f.close(); }
});

for (const problem of ['requested-scope', 'company', 'proof-tenant', 'proof-device', 'proof-terminal', 'proof-company', 'config-tenant', 'missing-owner', 'missing-runtime', 'missing-inventory', 'token-drift', 'guard-drift', 'origin-drift', 'owner-drift', 'inventory-drift', 'runtime-drift', 'authority-mode-drift', 'token-unavailable-no-lease'] as const) test(`cached context rejects ${problem} without network or financial writes`, async () => {
  const f = await fixture(); try {
    const request = structuredClone(f.env.config);
    if (problem === 'requested-scope') request.terminals[0].config.pricing.tariffs = [];
    if (problem === 'company') request.terminals[0].config.erpBinding.companyId = id(999);
    if (problem === 'proof-tenant') f.env.proof.tenantId = id(999);
    if (problem === 'proof-device') f.env.proof.deviceId = id(999);
    if (problem === 'proof-company') f.env.proof.companyId = id(999);
    if (problem === 'config-tenant') request.terminals[0].config.erpBinding.tenantId = id(999);
    if (problem === 'token-unavailable-no-lease') f.env.offline = true;
    if (problem === 'proof-terminal') f.env.proof.terminalId = id(999);
    if (problem === 'missing-owner') f.db.prepare('DELETE FROM master_v3_operational_owner').run();
    if (problem === 'missing-runtime') f.db.prepare('DELETE FROM sync_v3_sessions').run();
    if (problem === 'missing-inventory') f.db.prepare('DELETE FROM master_v3_inventory_state').run();
    let connects = 0;
    if (problem.endsWith('-drift')) f.env.onConnect = () => {
      if (++connects !== 2) return;
      if (problem === 'runtime-drift') f.db.prepare('UPDATE master_v3_state SET active_version=33').run();
      if (problem === 'authority-mode-drift') { f.env.offline = true; const {syncToken: _, ...identity} = f.env.identity; f.env.offlineAuthority = {identity}; }
      if (problem === 'token-drift') f.env.identity = { ...f.env.identity, syncToken: 'changed' };
      if (problem === 'guard-drift') f.env.guard = 'changed';
      if (problem === 'origin-drift') f.env.origin = 'https://other.invalid';
      if (problem === 'owner-drift') f.db.prepare("UPDATE master_v3_operational_owner SET binding='foreign'").run();
      if (problem === 'inventory-drift') f.db.prepare("UPDATE master_v3_inventory_state SET cursor='foreign'").run();
    };
    await assert.rejects(f.module.acquireLargeMasterSyncV3ConfigContext(request, id(4)));
    assert.equal(f.env.downloads, 0); assert.deepEqual(f.documents('transactions'), []); assert.deepEqual(f.documents('inventoryLedger'), []);
  } finally { f.close(); }
});

test('validated cached offline authority can acquire without live token; reconnect keeps old offline session validation', async () => {
  const f = await fixture(); try {
    f.env.offline = true; const { syncToken: _, ...identity } = f.env.identity; f.env.offlineAuthority = { identity };
    const session = await f.module.acquireLargeMasterSyncV3ConfigContext(f.env.config, id(4)); await session.assertCurrent();
    f.env.offline = false; await session.assertCurrent(); assert.equal(f.env.downloads, 0);
  } finally { f.close(); }
});
