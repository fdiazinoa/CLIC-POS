import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL } from '../services/db/LargeMasterSyncV3Schema';
import { LargeMasterSyncV3SqliteStore } from '../services/db/LargeMasterSyncV3SqliteStore';
import { LargeMasterSyncV3Runtime } from '../services/sync/LargeMasterSyncV3Runtime';
import { LargeMasterSyncV3OperationalCatalog } from '../services/sync/LargeMasterSyncV3OperationalCatalog';
import { repairLargeMasterSyncV3EmptyInventory } from '../services/sync/LargeMasterSyncV3Candidate';
import type { LargeMasterSyncV3InventorySnapshot } from '../services/sync/LargeMasterSyncV3Types';
import { resetLargeMasterSyncV3OperationGateForTests, setLargeMasterSyncV3CriticalOperation } from '../services/sync/LargeMasterSyncV3OperationGate';

const version = { syncId: 'S', syncVersion: 309, contractVersion: 2 };
const baseline = JSON.stringify(['binding', 'S', 309, 4, 'empty']);
const newSnapshot = (qty = 0): LargeMasterSyncV3InventorySnapshot => ({ version: 5, cursor: 'complete',
  balances: [{ item_id: 'P', warehouse_id: 'W', qty_on_hand: qty, qty_reserved: 0, qty_committed: 0, updated_at: '2026-10-13' }] });

function fixture(count = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'v3-empty-inventory-'));
  const path = join(dir, 'native.sqlite');
  let sql = new DatabaseSync(path);
  sql.exec('CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));');
  sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
  let onFault: (point: string) => void = () => {};
  let beforeLock: () => void = () => {};
  const bridge = {
    query: async (query: string, values: any[] = []) => ({ values: sql.prepare(query).all(...values) }),
    run: async (query: string, values: any[] = []) => sql.prepare(query).run(...values),
    execute: async (query: string) => { sql.exec(query); },
  };
  let tail: Promise<unknown> = Promise.resolve();
  const lock = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(() => { beforeLock(); return operation(); }); tail = next.catch(() => {}); return next;
  };
  const createStore = () => new LargeMasterSyncV3SqliteStore(() => bridge, lock, point => onFault(point));
  let store = createStore();
  sql.exec(`INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at)
    VALUES('S',309,3,2,'ACTIVE','{}','2020','2020');
    UPDATE master_v3_state SET active_sync_id='S',active_version=309 WHERE singleton=1;
    INSERT INTO master_v3_operational_owner VALUES(1,'S',309,'binding');
    INSERT INTO master_v3_inventory_state VALUES(1,'S',309,4,'empty','2020');
    INSERT INTO master_v3_tariffs(sync_version,tariff_id,active,record_json) VALUES(309,'T',1,'{"id":"T","active":true,"taxIncluded":false}');
    INSERT INTO master_v3_taxes(sync_version,tax_id,active,rate,record_json) VALUES(309,'TX',1,.18,'{"id":"TX","name":"ITBIS","type":"SALES","rate":0.18,"active":true}');`);
  for (let i = 0; i < count; i++) {
    const id = i === 0 ? 'P' : `P${i}`;
    const sku = i === 0 ? '2135' : `${4000 + i}`;
    const article = { id, sku, name: `MYKON ${sku}`, type: 'PRODUCT', inventoriable: true, uom: 'UN',
      taxable: true, taxIds: ['TX'], active: true, sellable: true, activeWarehouseIds: ['W'],
      category: 'Todos1', posCategoryId: 'category-id', operationalFlags: { isWeighted: false,
        trackInventory: true, allowNegativeStock: true, integersOnly: false } };
    sql.prepare(`INSERT INTO master_v3_articles(sync_version,article_id,sku,description,article_type,uom,taxable,tax_ids_json,
      active,sellable,record_json,pos_category_id,pos_category_label)
      VALUES(309,?,?,?,'PRODUCT','UN',1,'["TX"]',1,1,?,'category-id','Todos1')`).run(id, sku, article.name, JSON.stringify(article));
    sql.prepare('INSERT INTO master_v3_prices VALUES(309,?,?,85)').run(id, 'T');
  }
  const transition = async () => ({ assertIdentity: () => {}, binding: 'binding', expectedCatalog: version,
    inventory: (await store.getInventoryAuthority())! });
  const insert = (collection: string, row: any) => sql.prepare('INSERT INTO documents(collection_name,doc_id,data) VALUES(?,?,?)')
    .run(collection, row.id, JSON.stringify(row));
  const authority = () => ['master_v3_state', 'master_v3_inventory_state', 'master_v3_inventory_balances',
    'master_v3_operational_owner', 'master_v3_catalog_owners', 'documents'].map(table => JSON.stringify(sql.prepare(`SELECT * FROM ${table}`).all()));
  return { get sql() { return sql; }, get store() { return store; }, transition, insert, authority,
    onFault: (fn: (point: string) => void) => { onFault = fn; }, beforeLock: (fn: () => void) => { beforeLock = fn; },
    reopen: () => { sql.close(); sql = new DatabaseSync(path); store = createStore(); },
    close: () => { sql.close(); rmSync(dir, { recursive: true, force: true }); resetLargeMasterSyncV3OperationGateForTests(); } };
}

async function ready(f: ReturnType<typeof fixture>) {
  return { runtime: (await LargeMasterSyncV3Runtime.open(f.store))!, inventoryVersion: 4, inventoryCursor: 'empty' };
}

const dependencies = (fetchInventory: () => Promise<LargeMasterSyncV3InventorySnapshot>) => ({ enabled: true,
  assertPlatform: () => {}, createClient: () => { throw Error('No catalog or legacy download authorized for repair'); },
  fetchInventory, waitForOperationalWindow: async () => 0, openRuntime: LargeMasterSyncV3Runtime.open });

test('empty unused authority repair restores all 3010 search rows and survives actual file close/reopen', async () => {
  const f = fixture(3010); try {
    assert.equal(await f.store.readInventoryCoverageStatus(version, 'W'), 'EMPTY');
    const beforeOwner = await f.store.getOperationalOwner();
    const payload = { ...newSnapshot(), balances: Array.from({ length: 3010 }, (_, i) => ({ ...newSnapshot().balances[0], item_id: i === 0 ? 'P' : `P${i}` })) };
    const restored = await repairLargeMasterSyncV3EmptyInventory(f.store, await ready(f), 'binding', 'W', ['W'], () => {}, dependencies(async () => payload));
    assert.equal(restored.inventoryCursor, 'complete');
    assert.deepEqual(await f.store.getOperationalOwner(), beforeOwner);
    f.reopen();
    assert.deepEqual(await f.store.getActiveRuntimeVersion(), version);
    assert.deepEqual(await f.store.getOperationalOwner(), beforeOwner);
    assert.equal((await f.store.getCatalogReceipt(version, 'binding'))?.cursor, 'complete');
    assert.equal((await f.store.getInventorySnapshotVersion(version))?.cursor, 'complete');
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM master_v3_inventory_balances').get()?.n, 3010);
    const reopened = { runtime: (await LargeMasterSyncV3Runtime.open(f.store))!, inventoryVersion: 5, inventoryCursor: 'complete' };
    const catalog = await LargeMasterSyncV3OperationalCatalog.open(reopened, 'T', 'W');
    const products = await catalog.search('2135');
    assert.equal(products.length, 1); assert.equal(products[0].product.id, 'P');
    assert.equal(products[0].product.price, 85); assert.equal(products[0].taxes[0].rate, .18);
    assert.equal(products[0].product.posCategoryId, 'category-id');
    assert.equal(products[0].product.operationalFlags.allowNegativeStock, true);
    assert.equal(products[0].product.stock, 0);
    assert.equal((await catalog.search('')).length, 60);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM documents').get()?.n, 0);
  } finally { f.close(); }
});

test('negative ERP quantities are retained and healthy refresh is idempotent with zero extra requests', async () => {
  const f = fixture(); try {
    await f.store.repairEmptyUnusedInventoryBaseline(await f.transition(), newSnapshot(-3), ['W'], 'W');
    const current = { runtime: (await LargeMasterSyncV3Runtime.open(f.store))!, inventoryVersion: 5, inventoryCursor: 'complete' };
    const before = f.authority();
    const result = await repairLargeMasterSyncV3EmptyInventory(f.store, current, 'binding', 'W', ['W'], () => {},
      dependencies(async () => { throw Error('healthy baseline must not download'); }));
    assert.equal(result, current); assert.deepEqual(f.authority(), before);
    const products = await (await LargeMasterSyncV3OperationalCatalog.open(result, 'T', 'W')).search('2135');
    assert.equal(products[0].product.stock, -3); assert.equal(products[0].product.operationalFlags.allowNegativeStock, true);
  } finally { f.close(); }
});

for (const [collection, row] of [
  ['inventoryLedger', { id: 'ledger', v3InventoryBaseline: baseline, qtyOut: 0, qtyIn: 0, syncStatus: 'APPLIED_ERP' }],
  ['parkedTickets', { id: 'parked', items: [{ v3SaleAuthority: { inventoryCursor: 'empty' } }] }],
  ['v3RestoredTicketSources', { id: 'restored', items: [{ v3SaleAuthority: {} }] }],
  ['transactions', { id: 'sale', nested: { original: { v3InventoryBaseline: baseline } } }],
  ['transactionHistory', { id: 'history', deeply: [{ v3Binding: 'binding' }] }],
] as const) test(`retained ${collection} source denies repair without mutation or download`, async () => {
  const f = fixture(); try {
    f.insert(collection, row); const before = f.authority();
    await assert.rejects(repairLargeMasterSyncV3EmptyInventory(f.store, await ready(f), 'binding', 'W', ['W'], () => {},
      dependencies(async () => { throw Error('no fetch before source guard'); })), /MIGRATION_REQUIRED/);
    assert.deepEqual(f.authority(), before);
  } finally { f.close(); }
});

for (const point of ['inventory_repair_after_baseline', 'inventory_repair_after_receipt']) test(`half-write ${point} rolls back all authority and retries safely`, async () => {
  const f = fixture(); try {
    const transition = await f.transition(); const before = f.authority();
    f.onFault(current => { if (current === point) throw Error('disk-fault'); });
    await assert.rejects(f.store.repairEmptyUnusedInventoryBaseline(transition, newSnapshot(), ['W'], 'W'), /disk-fault/);
    assert.deepEqual(f.authority(), before); f.reopen(); assert.deepEqual(f.authority(), before);
    f.onFault(() => {}); await f.store.repairEmptyUnusedInventoryBaseline(await f.transition(), newSnapshot(), ['W'], 'W');
    assert.equal((await f.store.getInventoryAuthority())?.cursor, 'complete');
  } finally { f.close(); }
});

test('partial baseline only fails when actual controlled coverage is missing; no existing balance is replaced', async () => {
  const f = fixture(2); try {
    f.sql.exec("INSERT INTO master_v3_inventory_balances VALUES('P','W',25,3,2,'2026')");
    const before = f.authority(); assert.equal(await f.store.readInventoryCoverageStatus(version, 'W'), 'PARTIAL');
    await assert.rejects(repairLargeMasterSyncV3EmptyInventory(f.store, await ready(f), 'binding', 'W', ['W'], () => {},
      dependencies(async () => { throw Error('partial baseline must not download'); })), /MIGRATION_REQUIRED/);
    assert.deepEqual(f.authority(), before);
  } finally { f.close(); }
});

for (const fault of ['binding', 'owner', 'anchor', 'receipt', 'identity-before-commit', 'source-before-lock', 'source-before-commit']) test(`repair guards ${fault}`, async () => {
  const f = fixture(); try {
    const transition = await f.transition();
    if (fault === 'binding') transition.binding = 'other-company';
    if (fault === 'owner') f.sql.exec("UPDATE master_v3_operational_owner SET binding='other-company'");
    if (fault === 'anchor') f.sql.exec("UPDATE master_v3_inventory_state SET cursor='changed'");
    if (fault === 'receipt') f.sql.exec("INSERT INTO master_v3_catalog_owners VALUES('S',309,'other-company','S',309,4,'empty')");
    let identity = true; transition.assertIdentity = () => { if (!identity) throw Error('SYNC_V3_BINDING_CHANGED'); };
    if (fault === 'identity-before-commit') f.onFault(point => { if (point === 'inventory_repair_after_receipt') identity = false; });
    if (fault === 'source-before-lock') f.beforeLock(() => f.insert('parkedTickets', { id: 'late', items: [{ v3SaleAuthority: {} }] }));
    if (fault === 'source-before-commit') f.onFault(point => { if (point === 'inventory_repair_after_receipt') f.insert('parkedTickets', { id: 'late', nested: { v3Binding: 'binding' } }); });
    const before = f.authority();
    await assert.rejects(f.store.repairEmptyUnusedInventoryBaseline(transition, newSnapshot(), ['W'], 'W'), /CHANGED|MIGRATION_REQUIRED|OWNER_REQUIRED/);
    if (fault !== 'source-before-lock') assert.deepEqual(f.authority(), before);
    else assert.equal((await f.store.getInventoryAuthority())?.cursor, 'empty');
  } finally { f.close(); }
});

for (const bad of ['foreign-item', 'foreign-warehouse', 'duplicate', 'nonfinite', 'stale', 'incomplete', 'empty', 'active-payment']) test(`invalid ${bad} baseline cannot establish coverage`, async () => {
  const f = fixture(bad === 'incomplete' ? 2 : 1); try {
    const payload = newSnapshot();
    if (bad === 'foreign-item') payload.balances[0].item_id = 'foreign';
    if (bad === 'foreign-warehouse') payload.balances[0].warehouse_id = 'foreign';
    if (bad === 'duplicate') payload.balances.push({ ...payload.balances[0] });
    if (bad === 'nonfinite') payload.balances[0].qty_on_hand = NaN;
    if (bad === 'stale') payload.version = 3;
    if (bad === 'empty') payload.balances = [];
    if (bad === 'active-payment') setLargeMasterSyncV3CriticalOperation('PAYMENT', true);
    const before = f.authority();
    await assert.rejects(f.store.repairEmptyUnusedInventoryBaseline(await f.transition(), payload, ['W'], 'W'), /INVALID|STALE|NOT_READY|OPERATIONAL_WINDOW_HELD/);
    assert.deepEqual(f.authority(), before);
  } finally { f.close(); }
});

test('ERP empty and network failures do not report success or create availability', async () => {
  const f = fixture(); try {
    const before = f.authority();
    await assert.rejects(repairLargeMasterSyncV3EmptyInventory(f.store, await ready(f), 'binding', 'W', ['W'], () => {},
      dependencies(async () => ({ version: 5, cursor: 'still-empty', balances: [] }))), /INVENTORY_NOT_READY/);
    await assert.rejects(repairLargeMasterSyncV3EmptyInventory(f.store, await ready(f), 'binding', 'W', ['W'], () => {},
      dependencies(async () => { throw Error('network offline'); })), /network offline/);
    assert.deepEqual(f.authority(), before);
  } finally { f.close(); }
});

for (const result of ['success', 'new-catalog', 'negative-checkout', 'network-retry', 'identity-during-download', 'healthy-no-fetch', 'config-push-empty', 'config-push-retry']) test(`actual normal Session refresh empty coverage: ${result}`, async () => {
  const f = fixture(); try {
    const { build } = await import('esbuild');
    const state: any = { identity: { tenantId: 'tenant', terminalId: 'terminal', deviceId: 'device',
      syncToken: 'fixture-token', erpSyncBaseUrl: 'https://erp.test/api/sync' }, origin: 'https://download.test',
      config: { terminals: [{ id: 'local', config: { currentDeviceId: 'device', erpTerminalId: 'terminal',
        erpBinding: { companyId: 'company' }, inventoryScope: { defaultSalesWarehouseId: 'W', visibleWarehouseIds: ['W'] } } }] },
      fetches: 0, failNetwork: result === 'network-retry' || result === 'config-push-retry',
      emptyRemote: result === 'config-push-empty', changeIdentity: result === 'identity-during-download', events: [] };
    const binding = JSON.stringify([state.identity.tenantId, state.identity.terminalId, state.identity.deviceId,
      state.identity.erpSyncBaseUrl, state.origin]);
    f.sql.prepare('UPDATE master_v3_operational_owner SET binding=?').run(binding);
    f.sql.prepare("INSERT INTO master_v3_catalog_owners VALUES('S',309,?,'S',309,4,'empty')").run(binding);
    if (result === 'new-catalog') {
      f.sql.exec(`INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at)
        VALUES('N',410,3,2,'VALIDATED','{}','2020','2020');
        UPDATE master_v3_state SET staging_sync_id='N',staging_version=410 WHERE singleton=1;
        INSERT INTO master_v3_articles(sync_version,article_id,sku,description,article_type,uom,taxable,tax_ids_json,active,sellable,record_json,pos_category_id,pos_category_label)
        SELECT 410,article_id,sku,description,article_type,uom,taxable,tax_ids_json,active,sellable,record_json,pos_category_id,pos_category_label FROM master_v3_articles WHERE sync_version=309;
        INSERT INTO master_v3_tariffs(sync_version,tariff_id,active,record_json) SELECT 410,tariff_id,active,record_json FROM master_v3_tariffs WHERE sync_version=309;
        INSERT INTO master_v3_taxes(sync_version,tax_id,active,rate,record_json) SELECT 410,tax_id,active,rate,record_json FROM master_v3_taxes WHERE sync_version=309;
        INSERT INTO master_v3_prices SELECT 410,article_id,tariff_id,price FROM master_v3_prices WHERE sync_version=309;`);
    }
    if (result === 'healthy-no-fetch') f.sql.exec("INSERT INTO master_v3_inventory_balances VALUES('P','W',17,0,0,'2026')");
    const io = { state, adapter: { masterSyncV3Store: f.store, connect: async () => {} }, db: { get: async () => state.config, save: async (_name: string, value: any) => {
      state.config = value; state.events.push('CONFIG_PERSISTED'); } }, fresh: newSnapshot(result === 'negative-checkout' ? -3 : 0) };
    Object.assign(globalThis, { __emptyRepairSession: io });
    const mocks: Record<string, string> = {
      '../../utils/db': 'export const db=globalThis.__emptyRepairSession.db;',
      '../db': 'export const dbAdapter=globalThis.__emptyRepairSession.adapter;',
      './LargeMasterSyncV3Authority': 'export const LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED=true;',
      './LargeMasterSyncV3CanaryFacade': 'export const LARGE_MASTER_SYNC_V3_CANARY=false;export const validateLargeMasterSyncV3CanaryUrl=value=>value;',
      './OperationalTerminalConfig': 'export const readOperationalTerminalBinding=()=>"credentials";',
      './LargeMasterSyncV3Platform': 'export const assertLargeMasterSyncV3NativeAndroid=()=>{};',
      './LargeMasterSyncV3DownloadOrigin': 'export const largeMasterSyncV3DownloadOrigin=()=>globalThis.__emptyRepairSession.state.origin;',
      './LargeMasterSyncV3Inventory': `export const fetchLargeMasterSyncV3Inventory=async()=>{const {state,fresh}=globalThis.__emptyRepairSession;
        state.fetches++;if(state.failNetwork)throw Error('HTTP offline');if(state.changeIdentity)state.identity={...state.identity,terminalId:'foreign'};return state.emptyRemote?{...fresh,balances:[]}:fresh;};`,
      './LargeMasterSyncV3BoundTransport': `export const readLargeMasterSyncV3BoundIdentity=()=>({...globalThis.__emptyRepairSession.state.identity});
        export const validatedLargeMasterSyncV3ErpSyncBase=value=>value;
        export const createLargeMasterSyncV3BoundClient=store=>({requestSync:async()=>({syncId:'S',syncVersion:309}),resumeSync:async id=>store.activate(id)});`,
    };
    const bundled = await build({ entryPoints: [new URL(result.startsWith('config-push')
      ? '../services/sync/LargeMasterSyncV3ConfigPush.ts' : '../services/sync/LargeMasterSyncV3OperationalSession.ts', import.meta.url).pathname],
      bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'normal-sync-io', setup(b) {
        b.onResolve({ filter: /LargeMasterSyncV3Types$/ }, () => ({ path: new URL('../services/sync/LargeMasterSyncV3Types.ts', import.meta.url).href, external: true }));
        b.onResolve({ filter: /.*/ }, a => mocks[a.path] ? { path: a.path, namespace: 'fixture' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: mocks[a.path], loader: 'js' }));
      } }] });
    const helper = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text + '\n//' + result).toString('base64'));
    const before = f.authority();
    if (result.startsWith('config-push')) {
      const dispatch = async () => { await helper.persistLargeMasterSyncV3ConfigPushCatalog(() => {}); state.events.push('APPLIED'); };
      await assert.rejects(dispatch(), /HTTP offline|INVENTORY_NOT_READY/);
      assert.deepEqual(state.events, []); assert.deepEqual(f.authority(), before);
      if (result === 'config-push-retry') {
        state.failNetwork = false; await dispatch();
        assert.deepEqual(state.events, ['CONFIG_PERSISTED', 'APPLIED']);
        assert.equal((await f.store.getInventoryAuthority())?.cursor, 'complete');
      }
      return;
    }
    if (result === 'network-retry') {
      await assert.rejects(helper.LargeMasterSyncV3OperationalSession.open(true), /HTTP offline/);
      assert.deepEqual(f.authority(), before); state.failNetwork = false;
    }
    if (result === 'identity-during-download') {
      await assert.rejects(helper.LargeMasterSyncV3OperationalSession.open(true), /BINDING_CHANGED/);
      assert.deepEqual(f.authority(), before);
    } else {
      const session = await helper.LargeMasterSyncV3OperationalSession.open(true);
      const actualVersion = result === 'new-catalog' ? { syncId: 'N', syncVersion: 410, contractVersion: 2 } : version;
      assert.deepEqual(session.ready.runtime.version, actualVersion);
      assert.equal(session.ready.inventoryCursor, result === 'healthy-no-fetch' ? 'empty' : 'complete');
      assert.equal(state.fetches, result === 'healthy-no-fetch' ? 0 : result === 'network-retry' ? 2 : 1);
      if (result === 'healthy-no-fetch') assert.deepEqual(f.authority(), before);
      else assert.equal((await f.store.getCatalogReceipt(actualVersion, binding))?.cursor, 'complete');
      if (result === 'new-catalog') {
        f.reopen();
        assert.equal((await f.store.getOperationalOwner())?.syncId, 'N');
        const receipt = await f.store.getCatalogReceipt(actualVersion, binding);
        assert.equal(receipt?.syncId, 'N'); assert.equal(receipt?.syncVersion, 410); assert.equal(receipt?.cursor, 'complete');
        assert.equal((await f.store.getInventorySnapshotVersion(actualVersion))?.cursor, 'complete');
      }
      if (result === 'negative-checkout') {
        const config = await session.projectConfig(state.config);
        const found = await (await session.catalog('T', 'W')).get('P');
        assert.ok(found);
        const product = await session.withStock(found.product, 'W');
        assert.equal(product.stock, -3);
        const line = { ...product, cartId: 'readonly-fixture-line', quantity: 1 };
        await session.validate(config, [line], 'T', 'W', 'SALE');
        assert.deepEqual(await session.stockRequirements(config, [line], 'W', 'SALE'), []);
        assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM documents').get()?.n, 0);
      }
    }
  } finally { delete (globalThis as any).__emptyRepairSession; f.close(); }
});


test('supplemental ERP extras are validated but omitted from the bound native catalog projection', async () => {
  const f = fixture(); try {
    const payload = newSnapshot();
    payload.balances.push({ ...payload.balances[0], item_id: 'inactive-open-consignment', qty_on_hand: 30 });
    payload.balances.push({ ...payload.balances[0], warehouse_id: 'foreign-warehouse', qty_on_hand: 100 });
    await f.store.repairEmptyUnusedInventoryBaseline(await f.transition(), payload, ['W'], 'W');
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM master_v3_inventory_balances').get()?.n, 1);
    assert.equal((await f.store.getInventoryAuthority())?.cursor, payload.cursor);
    assert.equal((await f.store.getInventoryBalance(version, 'P', 'W'))?.qtyOnHand, 0);
    assert.equal(await f.store.getInventoryBalance(version, 'inactive-open-consignment', 'W'), null);
  } finally { f.close(); }
});

test('malformed supplemental extras cannot bypass full source validation', async () => {
  const f = fixture(); try {
    const payload = newSnapshot(); const before = f.authority();
    payload.balances.push({ ...payload.balances[0], item_id: 'inactive-open-consignment', qty_on_hand: Infinity });
    await assert.rejects(f.store.repairEmptyUnusedInventoryBaseline(await f.transition(), payload, ['W'], 'W'), /INVENTORY_INVALID/);
    assert.deepEqual(f.authority(), before);
  } finally { f.close(); }
});
