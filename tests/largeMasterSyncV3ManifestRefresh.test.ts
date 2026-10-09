import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { build } from 'esbuild';
import { getInitialConfig } from '../constants';
import { LargeMasterSyncV3Error } from '../services/sync/LargeMasterSyncV3Types';
import { v3ManifestFingerprint, needsV3ManifestRefresh, isV3CatalogHint } from '../services/sync/LargeMasterSyncV3ManifestCheckpoint';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const source = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('SyncManager.ts', source, ts.ScriptTarget.Latest, true);
const cls = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'SyncManager') as ts.ClassDeclaration;
const method = (name: string) => cls.members.find(node => node.name?.getText(parsed) === name)!.getText(parsed);
// Execute actual public wrapper and private implementation; native/session/storage I/O are isolated.
const actual = ['manualCatalogSync', 'manualSyncAll', 'v3CatalogRefresh', 'refreshV3Catalog', 'reconcileTerminalManifest', 'syncTerminalManifestInBackground'].map(method).join('\n');

async function fixture() {
  const storage = new Map<string, string>(); const events: string[] = [];
  let identity = { tenantId: 'tenant', terminalId: 'erp-terminal', deviceId: 'device', syncToken: 'secret', erpSyncBaseUrl: 'https://erp.test/api/sync' };
  let config: any = getInitialConfig('Supermercado' as any);
  const localId = config.terminals[0].id;
  config.terminals[0].config.erpTerminalId = identity.terminalId;
  config.terminals[0].config.erpBinding = { terminalId: identity.terminalId, tenantId: identity.tenantId, companyId: 'company' };
  config.terminals[0].config.catalog = { allowedCategories: ['Alimentos'] };
  let manifest: any = { cursor_map: { items: 'catalog-3001', product_prices: 'prices-161', inventory: 'inventory-1' },
    changed: { items: false, product_prices: false, inventory: false }, price_version: '161', domain_hashes: { product_prices: 'price-hash' } };
  let cursors: any = clone(manifest.cursor_map); // Already consumed legacy cursors are NOT V3 proof.
  let active = { syncId: 'old', syncVersion: 47, price: 70 }; let exports = 0; let fetches = 0;
  let prepare: () => Promise<void> = async () => {}; let save: () => Promise<void> = async () => {};
  let onFetch: () => Promise<void> = async () => {}; let corrupt = false;
  const db = { get: async (name: string) => name === 'config' ? (corrupt ? {} : clone(config))
    : name === 'internalSequences' ? [{ source: 'ERP_TERMINAL_CONFIG' }] : [],
    save: async (_name: string, value: any) => { await save(); config = clone(value); } };
  const getSession = async (refresh = false) => {
    if (refresh) { exports++; await prepare(); active = { syncId: 'new', syncVersion: 102, price: 85 }; }
    const version = { syncId: active.syncId, syncVersion: active.syncVersion }; const bound = JSON.stringify(identity);
    return { ready: { runtime: { version }, inventorySyncId: 'old', inventorySyncVersion: 47, inventoryVersion: 4, inventoryCursor: 'C' }, assertCurrent: async () => {
      if (bound !== JSON.stringify(identity)) throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
      if (version.syncId !== active.syncId || version.syncVersion !== active.syncVersion) throw new LargeMasterSyncV3Error('SYNC_V3_RUNTIME_VERSION_CHANGED');
    }, projectConfig: async (value: any) => ({ ...value, taxRate: 0, taxes: [{ id: 'TX', rate: .18 }], tariffs: [{ id: 'T', name: 'General', taxIncluded: false }] }) };
  };
  Object.assign(globalThis, { __v3ManifestFixture: { db, getSession } });
  const mocks: Record<string, string> = { '../../utils/db': 'export const db=globalThis.__v3ManifestFixture.db;',
    './LargeMasterSyncV3OperationalSession': 'export const getLargeMasterSyncV3OperationalSession=globalThis.__v3ManifestFixture.getSession;' };
  const built = await build({ entryPoints: [new URL('../services/sync/LargeMasterSyncV3ConfigPush.ts', import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'manifest-boundaries', setup(b) {
      b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }] });
  const helper = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text + '\n//' + crypto.randomUUID()).toString('base64')}`);
  const context = {
    syncTriggerCoordinator: {request: async () => {}}, db, getLargeMasterSyncV3OperationalSession: getSession, v3ManifestFingerprint, needsV3ManifestRefresh,
    usesLargeMasterSyncV3Authority: () => true, syncPolicy: { resolve: () => ({ kind: 'ERP_ACTIVE' }) },
    readLargeMasterSyncV3BoundIdentity: () => ({ ...identity }),
    readOperationalTerminalBinding: () => JSON.stringify([identity, config.terminals[0].config.erpBinding.companyId]),
    readOperationalCatalogBindingProof: () => ({ companyId: config.terminals[0].config.erpBinding.companyId }),
    largeMasterSyncV3DownloadOrigin: () => 'https://download.test', LargeMasterSyncV3Error,
    persistLargeMasterSyncV3ConfigPushCatalog: helper.persistLargeMasterSyncV3ConfigPushCatalog,
    window: { dispatchEvent: (event: { type: string }) => { events.push(event.type); } }, CustomEvent: class { constructor(public type: string) {} },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    navigator: { onLine: true }, protectsLocalCatalogFromCloud: () => false, waitForBackgroundSyncWindow: async () => {},
    apiSyncAdapter: { isErpActiveOperationalTarget: () => true }, console: { warn() {}, info() {} },
    ERP_SUPPORTED_MASTER_COLLECTIONS: new Set(),
  };
  const Constructor = runInNewContext(ts.transpileModule('class Subject{' + actual + '}\nSubject;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const restart = () => {
    const instance = new Constructor(); Object.assign(instance, {
      isUsingConfigPushV2Primary: () => true, isDisabled: false, terminalManifestSyncInFlight: false, lastBackgroundTerminalManifestSyncAt: 0, readyToSellState: {},
      getActiveTerminalContext: () => ({ terminalId: identity.terminalId, tenantId: identity.tenantId, localTerminalId: localId, posDeviceId: identity.deviceId }),
      wasStartupManifestSyncCompleted: () => false, readStoredTerminalCursorMap: () => clone(cursors),
      readStoredInventoryVersion: () => null, readStoredPriceVersion: () => null,
      fetchTerminalManifest: async () => { fetches++; const reply = clone(manifest); await onFetch(); return reply; },
      persistTerminalCursorMap: (_id: string, value: any) => { cursors = clone(value); },
      markStartupManifestSyncCompleted: () => {}, recordSnapshotDiagnostics: () => {},
      normalizeVersionToken: (value: unknown) => value == null ? null : String(value),
      incrementSyncTelemetry: () => {}, publishSyncHealthUpdate: () => {}, refreshErpPaymentMethods: async () => {},
      refreshTerminalResolvedConfig: async () => clone(config),
      fetchTerminalProductPricesBlock: async () => { throw Error('Unexpected legacy prices download'); },
    }); return instance;
  };
  const marker = () => storage.get(`clic_v3_applied_manifest_${localId}`);
  return { instance: restart(), restart, manifest: () => manifest, active: () => active, events, exports: () => exports,
    fetches: () => fetches, cursors: () => cursors, marker, config: () => config,
    change: (patch: Partial<typeof identity>) => { identity = { ...identity, ...patch }; },
    onFetch: (callback: typeof onFetch) => { onFetch = callback; }, onPrepare: (callback: typeof prepare) => { prepare = callback; },
    onSave: (callback: typeof save) => { save = callback; }, corrupt: () => { corrupt = true; },
    changeGeneration: () => { active = { ...active, syncId: 'external', syncVersion: 103 }; } };
}
const sync = (f: any) => f.instance.syncTerminalManifestInBackground(f.config(), { reason: 'force_sync', throwOnError: true });

test('consumed manifest with false flags repairs BEB003 70 to 85 through V3 and survives restart', async () => {
  const f = await fixture(); assert.equal(f.active().price, 70);
  assert.ok(await sync(f)); assert.equal(f.active().price, 85); assert.equal(f.exports(), 1);
  assert.deepEqual(f.events, ['v3CatalogUpdated', 'configUpdated']);
  assert.ok(f.marker()); assert.equal(f.marker()!.includes('secret'), false);
  f.instance = f.restart(); await sync(f); assert.equal(f.active().price, 85); assert.equal(f.exports(), 1);
  f.manifest().cursor_map.inventory = 'inventory-2'; f.manifest().changed.inventory = true;
  await sync(f); assert.equal(f.exports(), 1);
  f.manifest().price_version = '162'; await sync(f); assert.equal(f.exports(), 2);
  f.manifest().cursor_map.items = 'catalog-3002'; await sync(f); assert.equal(f.exports(), 3);
  f.changeGeneration(); await sync(f); assert.equal(f.exports(), 4);
});

for (const code of ['SYNC_SNAPSHOT_NOT_READY', 'SYNC_V3_INVENTORY_COVERAGE_REQUIRED']) test(`${code} leaves marker, cursor and readiness untouched, then retries`, async () => {
  const f = await fixture(); const before = clone(f.cursors()); f.manifest().cursor_map.product_prices = 'new-price';
  f.onPrepare(async () => { throw new LargeMasterSyncV3Error(code); });
  await assert.rejects(sync(f), error => (error as any).code === code);
  assert.equal(f.active().price, 70); assert.equal(f.marker(), undefined); assert.deepEqual(f.cursors(), before);
  assert.deepEqual(f.events, []); assert.deepEqual(f.instance.readyToSellState, {});
  f.onPrepare(async () => {}); await sync(f); assert.equal(f.active().price, 85); assert.ok(f.marker());
});

test('config commit failure cannot mark native activation applied; retry recovers', async () => {
  const f = await fixture(); const before = clone(f.cursors());
  f.onSave(async () => { throw Error('DISK_WRITE_FAILED'); }); await assert.rejects(sync(f));
  assert.equal(f.marker(), undefined); assert.deepEqual(f.cursors(), before); assert.deepEqual(f.events, []);
  f.onSave(async () => {}); await sync(f); assert.ok(f.marker()); assert.equal(f.active().price, 85);
});

test('readback failure cannot advance marker or cursor', async () => {
  const f = await fixture(); const before = clone(f.cursors()); f.onSave(async () => { f.corrupt(); });
  await assert.rejects(sync(f), error => (error as any).code === 'SYNC_V3_CONFIG_READBACK_FAILED');
  assert.equal(f.marker(), undefined); assert.deepEqual(f.cursors(), before); assert.deepEqual(f.events, []);
});

for (const field of ['tenantId', 'terminalId', 'deviceId', 'syncToken', 'erpSyncBaseUrl'] as const) test(`late manifest rejects ${field} drift`, async () => {
  const f = await fixture(); const before = clone(f.cursors()); f.onFetch(async () => { f.change({ [field]: 'foreign' }); });
  await assert.rejects(sync(f), /BINDING_CHANGED/); assert.equal(f.marker(), undefined);
  assert.deepEqual(f.cursors(), before); assert.equal(f.exports(), 0); assert.deepEqual(f.events, []);
});

test('manual and manifest refresh share existing V3 flight while native activation is pending', async () => {
  const f = await fixture(); let release!: () => void; let entered = false;
  f.onPrepare(async () => { entered = true; await new Promise<void>(resolve => { release = resolve; }); });
  const first = sync(f); while (!entered) await new Promise(resolve => setImmediate(resolve));
  const manual = f.instance.refreshV3Catalog(); const concurrent = sync(f);
  assert.equal(f.marker(), undefined); assert.deepEqual(f.events, []); assert.equal(f.exports(), 1);
  release(); await Promise.all([first, manual, concurrent]); assert.equal(f.exports(), 1); assert.ok(f.marker());
});

test('relevant hint predicate excludes inventory/image churn and semantic fingerprint ignores it', () => {
  assert.equal(isV3CatalogHint(['productPrices'], {}, false), true);
  assert.equal(isV3CatalogHint([], { catalog: 2 }, false), true);
  assert.equal(isV3CatalogHint([], {}, false), true);
  assert.equal(isV3CatalogHint(['inventory'], { inventory: 2 }, false), false);
  assert.equal(isV3CatalogHint(['products'], { catalog: 2 }, true), false);
  assert.equal(v3ManifestFingerprint({ cursor_map: {} }), null);
});

test('public manual converges once and subsequent periodic manifest does not export', async () => {
  const f=await fixture(); await Promise.all([f.instance.manualSyncAll(),f.instance.manualSyncAll()]);
  assert.equal(f.exports(),1); assert.ok(f.marker()); assert.equal(f.active().price,85);
  f.instance.lastBackgroundTerminalManifestSyncAt=0;
  await f.instance.syncTerminalManifestInBackground(f.config(), {reason:'periodic_manifest',throwOnError:true});
  assert.equal(f.exports(),1);
 });

test('manual and concurrent periodic wrapper share repair and cannot publish checkpoint before commit',async()=>{
 const f=await fixture();let release!:()=>void;let entered=false;let completed=false;
 const barrier=new Promise<void>(resolve=>{release=resolve;});
 f.onPrepare(async()=>{entered=true;await barrier;});
 const manual=f.instance.manualSyncAll();void manual.then(()=>{completed=true;});
 while(!entered)await new Promise(resolve=>setImmediate(resolve));
 const periodic=f.instance.syncTerminalManifestInBackground(f.config(),{reason:'periodic_manifest',throwOnError:true});
 assert.equal(completed,false);assert.equal(f.marker(),undefined);assert.equal(f.exports(),1);
 release();await Promise.all([manual,periodic]);assert.ok(f.marker());assert.equal(f.exports(),1);
});
