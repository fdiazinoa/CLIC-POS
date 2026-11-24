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
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: `const E=globalThis.__configContext;` + (path === '../db' ? 'exports.dbAdapter=E.adapter;' : path === '../../utils/db' ? 'exports.db={get:()=>E.adapter.getCollection("config")};' : path.endsWith('Platform') ? 'exports.assertLargeMasterSyncV3NativeAndroid=()=>{};' : path.endsWith('Authority') ? 'exports.LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED=true;' : path.endsWith('Candidate') ? 'const download=()=>{E.downloads++;throw Error("network-forbidden")};exports.prepareLargeMasterSyncV3Candidate=exports.prepareLargeMasterSyncV3CatalogOnly=exports.prepareLargeMasterSyncV3UnusedBaseline=download;exports.isLargeMasterSyncV3Stale=async()=>false;' : path.endsWith('BoundTransport') ? 'exports.readLargeMasterSyncV3BoundIdentity=()=>{if(E.offline)throw Error("token-unavailable");return E.identity;};exports.validatedLargeMasterSyncV3ErpSyncBase=x=>x;' : path.endsWith('DownloadOrigin') ? 'exports.largeMasterSyncV3DownloadOrigin=()=>E.origin;' : path.endsWith('OfflineV3OperationalIdentity') ? 'exports.readOfflineV3OperationalAuthority=async()=>{if(!E.offlineAuthority)throw Error("no-offline-authority");return E.offlineAuthority;};' : 'exports.readOperationalTerminalBinding=()=>E.guard;exports.readOperationalCatalogBindingProof=()=>E.proof;') }));
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

test('cached read acquisition overlapping ordinary startup publishes only revalidated authority', async () => {
  const f = await fixture(); try {
    let startup: Promise<unknown> | undefined;
    f.env.onConnect = () => {
      f.env.onConnect = undefined;
      startup = f.module.getLargeMasterSyncV3OperationalSession();
    };
    const before = f.state();
    const session = await f.module.acquireLargeMasterSyncV3ConfigContext(f.env.config, id(4));
    await startup;
    await session.assertCurrent();
    assert.strictEqual(await f.module.getLargeMasterSyncV3OperationalSession(), session);
    assert.equal(f.env.downloads, 0);
    assert.deepEqual(f.state(), before);
  } finally { f.close(); }
});

for (const drift of [false, true]) test(`cached UI acquisition waits for an active refresh and rechecks binding (drift=${drift})`, async () => {
  const f = await fixture();
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  try {
    const current = await f.module.getLargeMasterSyncV3OperationalSession();
    // Model a completed refresh with the same durable catalog; the fixture forbids
    // network downloads. Keep the real coordinator and native authority reads.
    const open = f.module.LargeMasterSyncV3OperationalSession.open;
    f.module.LargeMasterSyncV3OperationalSession.open = (_refresh: boolean, ...args: unknown[]) =>
      open.call(f.module.LargeMasterSyncV3OperationalSession, false, ...args);
    const assertCurrent = current.assertCurrent.bind(current);
    let entered!: () => void;
    const refreshing = new Promise<void>(resolve => { entered = resolve; });
    current.assertCurrent = async () => { entered(); await hold; await assertCurrent(); };
    const refresh = f.module.getLargeMasterSyncV3OperationalSession(true);
    // Attach rejection observers immediately; a real binding drift must still fail closed.
    const refreshed = refresh.then(() => undefined, (error: Error) => error);
    await refreshing;
    let outcome = 'pending';
    const acquisition = f.module.acquireLargeMasterSyncV3ConfigContext(f.env.config, id(4));
    const acquired = acquisition.then((session: unknown) => { outcome = 'ready'; return session; }, (error: Error) => { outcome = 'failed'; return error; });
    for (let n = 0; n < 10; n++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(outcome, 'pending', 'a UI read must wait for renewal instead of exhausting immediate publication retries');
    if (drift) f.env.guard = 'changed-during-refresh';
    release();
    const result = await acquired;
    await refreshed;
    if (drift) assert.match((result as Error).message, /BINDING_CHANGED/);
    else {
      assert.equal(outcome, 'ready');
      await (result as any).assertCurrent();
      assert.strictEqual(await f.module.getLargeMasterSyncV3OperationalSession(), result);
    }
    assert.equal(f.env.downloads, 0);
    assert.deepEqual(f.documents('transactions'), []);
    assert.deepEqual(f.documents('inventoryLedger'), []);
  } finally { release(); f.close(); }
});

test('SQLite authority projection matches the full decoder and declines ambiguous storage', async () => {
  const f = await nativeFixture();
  try {
    const config = f.documents('config')[0];
    config.terminals[0].config.fiscal = { environment: 0, enabled: false, customPolicy: { order: [true, false, null] } };
    config.terminals[0].config.erpSnapshot = { masters: { items: [{ id: 'irrelevant' }] } };
    config.terminalSnapshots = { irrelevant: 'x'.repeat(20_000) };
    await f.adapter.saveCollection('config', config);
    const selector = { localTerminalId: config.terminals[0].id };
    const full = await f.adapter.getCollection('config');
    const projected = await f.adapter.readV3OperationalAuthorityConfig();
    assert.ok(projected);
    assert.equal(v3OperationalConfigContext(projected, selector).key, v3OperationalConfigContext(full, selector).key);
    assert.ok(JSON.stringify(projected).length < JSON.stringify(full).length);
    assert.deepEqual(projected.terminals[0].config.fiscal, full.terminals[0].config.fiscal);

    config.terminals[0].config.fiscal.enabled = true;
    await f.adapter.saveCollection('config', config);
    const changed = await f.adapter.readV3OperationalAuthorityConfig();
    assert.ok(changed);
    assert.notEqual(v3OperationalConfigContext(changed, selector).scope, v3OperationalConfigContext(projected, selector).scope);

    f.db.prepare("INSERT INTO documents(collection_name,doc_id,data,sort_order,updatedAt) VALUES('config','metadata',?,1,'test')").run('{"id":"config_metadata"}');
    assert.equal(await f.adapter.readV3OperationalAuthorityConfig(), null);
    assert.equal(v3OperationalConfigContext(await f.adapter.getCollection('config'), selector).key, v3OperationalConfigContext(changed, selector).key);
  } finally { f.db.close(); }
});

test('V3 session acquisition and publication read only authority fields on canonical storage', async () => {
  const f = await fixture();
  try {
    let fullReads = 0, projections = 0;
    const getCollection = f.adapter.getCollection.bind(f.adapter);
    const readProjection = f.adapter.readV3OperationalAuthorityConfig.bind(f.adapter);
    f.adapter.getCollection = (...args) => {
      if (args[0] === 'config') fullReads++;
      return getCollection(...args);
    };
    f.adapter.readV3OperationalAuthorityConfig = () => { projections++; return readProjection(); };

    const session = await f.module.acquireLargeMasterSyncV3ConfigContext(f.env.config, id(4));
    assert.ok(projections >= 4, 'the open and publication fences each read current authority');
    assert.equal(fullReads, 0);

    f.db.prepare("INSERT INTO documents(collection_name,doc_id,data,sort_order,updatedAt) VALUES('config','metadata',?,1,'test')")
      .run('{"id":"config_metadata"}');
    await session.assertCurrent();
    assert.equal(fullReads, 1, 'an ambiguous layout still uses the full decoder');

    const changed = structuredClone(f.env.config);
    changed.terminals[0].config.pricing.allowedTariffIds = [id(999)];
    f.db.prepare("UPDATE documents SET data=? WHERE collection_name='config' AND doc_id='current'").run(JSON.stringify(changed));
    await assert.rejects(session.assertCurrent(), /SYNC_V3_BINDING_CHANGED/);
    assert.equal(fullReads, 2);
  } finally { f.close(); }
});

test('adding a line still checks fresh config and inventory snapshots with the projection', async () => {
  const f = await fixture();
  try {
    const session = await f.module.acquireLargeMasterSyncV3ConfigContext(f.env.config, id(4));
    const trace = { stages: {} };
    let grouped = 0;
    const readAuthority = f.adapter.readV3OperationalAuthority.bind(f.adapter);
    f.adapter.readV3OperationalAuthority = (...args) => { grouped++; return readAuthority(...args); };
    await session.assertCurrent({ trace });
    f.db.prepare("UPDATE master_v3_inventory_state SET cursor='changed'").run();
    await assert.rejects(session.assertCurrent({ trace, recheck: true }), /SYNC_V3_RUNTIME_VERSION_CHANGED/);
    assert.equal(grouped, 2);

    const config = structuredClone(f.env.config);
    config.terminals[0].config.pricing.allowedTariffIds = [id(999)];
    await f.adapter.saveCollection('config', config);
    await assert.rejects(session.assertCurrent({ trace, recheck: true }), /SYNC_V3_BINDING_CHANGED/);
    assert.equal(grouped, 3);
    assert.deepEqual(f.documents('transactions'), []);
  } finally { f.close(); }
});


test('authority reads share one queue turn and wait for earlier config writes', async () => {
  const f = await nativeFixture();
  try {
    const original = f.documents('config')[0];
    const changed = structuredClone(original);
    changed.terminals[0].config.pricing = { defaultTariffId: 'updated', allowedTariffIds: ['updated'] };
    const selector = { localTerminalId: changed.terminals[0].id };
    const expected = v3OperationalConfigContext(changed, selector).scope;
    const runtime = { syncId: id(60), syncVersion: 32, contractVersion: 2 as const };
    const events: string[] = [];
    const earlierWrite = f.adapter.saveCollection('config', changed);
    let otherRead: Promise<unknown> | undefined;
    await f.adapter.readV3OperationalAuthority(runtime, config => {
      assert.equal(v3OperationalConfigContext(config, selector).scope, expected);
      events.push('CONFIG_CHECK');
    }, stage => {
      events.push(stage);
      if (stage === 'CONFIG_END') otherRead = f.adapter.getCollection('config').then(() => events.push('OTHER_READ'));
    });
    await earlierWrite;
    await otherRead;
    assert.deepEqual(events, [
      'QUEUE_START', 'QUEUE_END', 'CONFIG_START', 'CONFIG_CHECK', 'CONFIG_END',
      'SNAPSHOT_START', 'SNAPSHOT_END', 'OTHER_READ',
    ]);

    const rejected: string[] = [];
    await assert.rejects(f.adapter.readV3OperationalAuthority(runtime, () => { throw Error('scope changed'); },
      stage => rejected.push(stage)), /scope changed/);
    assert.deepEqual(rejected, ['QUEUE_START', 'QUEUE_END', 'CONFIG_START', 'CONFIG_END']);
  } finally { f.db.close(); }
});

test('ordinary traced add reuses the native inventory anchor but rejects a changed source on final recheck', async () => {
  const f = await fixture();
  try {
    const session = await f.module.acquireLargeMasterSyncV3ConfigContext(f.env.config, id(4));
    const authority = {
      binding: session.binding, syncId: id(60), syncVersion: 32, warehouseId: id(5), tariffId: id(6),
      taxIncluded: false, inventoryVersion: 4, inventoryCursor: 'inventory-cursor',
    };
    const product = { id: id(7), name: 'Servicio QA', type: 'SERVICE', isInventoriable: false, taxable: false,
      appliedTaxIds: [], price: 100, activeInWarehouses: [id(5)] };
    session.catalogAfterAssert = async () => ({ get: async () => ({ product, authority }) });
    const line = { ...product, v3SaleAuthority: authority, cartId: 'qa-line', quantity: 1 };
    const store = f.adapter.masterSyncV3Store;
    let separateReads = 0;
    const initialInventory = await store.getInventoryAuthority();
    store.getInventoryAuthority = async () => { separateReads++; return initialInventory; };
    const readAuthority = f.adapter.readV3OperationalAuthority.bind(f.adapter);
    let checks = 0;
    let drift = false;
    f.adapter.readV3OperationalAuthority = async (...args) => {
      const snapshot = await readAuthority(...args);
      if (++checks === 2 && drift && snapshot.inventoryAuthority) {
        return { ...snapshot, inventoryAuthority: { ...snapshot.inventoryAuthority, syncId: id(999) } };
      }
      return snapshot;
    };

    const trace = { stages: {} };
    await session.validate(f.env.config, [line], id(6), id(5), 'SALE', undefined, undefined, false, undefined, trace);
    assert.equal(separateReads, 0);
    assert.equal(checks, 2);

    checks = 0;
    drift = true;
    await assert.rejects(session.validate(f.env.config, [line], id(6), id(5), 'SALE', undefined, undefined, false, undefined, trace),
      /SYNC_V3_RUNTIME_VERSION_CHANGED/);
    assert.equal(separateReads, 0);
    assert.equal(checks, 2);

    await session.validate(f.env.config, [line], id(6), id(5));
    assert.equal(separateReads, 1);
  } finally { f.close(); }
});
