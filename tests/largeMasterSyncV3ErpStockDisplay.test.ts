import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createV3ErpStockDisplay } from '../services/sync/LargeMasterSyncV3ErpStockDisplay';
import type { LargeMasterSyncV3InventorySnapshot } from '../services/sync/LargeMasterSyncV3Types';

const scope = { key: 'generation-1', storageKey: 'tenant-company-terminal-warehouse', erpWarehouseId: 'MEGA' };
const snapshot = (quantity: number, version = 10): LargeMasterSyncV3InventorySnapshot => ({
  version, cursor: String(version), balances: [
    {item_id: 'MS0001', warehouse_id: 'MEGA', qty_on_hand: quantity,
      qty_reserved: quantity ? 2 : 0, qty_committed: quantity ? 3 : 0, updated_at: 'fixture'},
    {item_id: 'MS0001', warehouse_id: 'OTHER', qty_on_hand: 999,
      qty_reserved: 0, qty_committed: 0, updated_at: 'fixture'},
  ],
});

test('ERP stock and availability remain scoped; explicit zero survives a smaller ERP version', async () => {
  const display = createV3ErpStockDisplay();
  await display.refresh(async () => scope, async () => snapshot(50));
  assert.deepEqual(display.read(scope, 'MS0001'), { stock: 50, balance: 45 });
  assert.equal(display.read({ ...scope, storageKey: 'foreign' }, 'MS0001'), undefined);
  assert.equal(display.read(scope, 'UNKNOWN'), undefined);
  await display.refresh(async () => scope, async () => snapshot(0, 9));
  assert.deepEqual(display.read(scope, 'MS0001'), { stock: 0, balance: 0 });
});

test('changed warehouse or terminal scope and a failed fetch preserve only the last successful publication', async () => {
  const display = createV3ErpStockDisplay();
  await display.refresh(async () => scope, async () => snapshot(50));
  for (const next of [{ ...scope, key: 'different-terminal' }, { ...scope, erpWarehouseId: 'OTHER' }]) {
    let current = scope;
    await assert.rejects(display.refresh(async () => current, async () => {
      current = next;
      return snapshot(20);
    }), { code: 'SYNC_V3_BINDING_CHANGED' });
  }
  await assert.rejects(display.refresh(async () => scope, async () => { throw Error('offline'); }), /offline/);
  assert.deepEqual(display.read(scope, 'MS0001'), { stock: 50, balance: 45 });
});

test('older in-flight response and fetches that ignore abort cannot hold or publish over the current result', async () => {
  const display = createV3ErpStockDisplay(25);
  let finishOld!: (value: LargeMasterSyncV3InventorySnapshot) => void;
  let started!: () => void;
  const oldStarted = new Promise<void>(resolve => { started = resolve; });
  const old = display.refresh(async () => scope, async () => new Promise(resolve => {
    finishOld = resolve;
    started();
  }));
  const rejected = assert.rejects(old, { code: 'SYNC_V3_BINDING_CHANGED' });
  await oldStarted;
  await display.refresh(async () => scope, async () => snapshot(50));
  await rejected;
  finishOld(snapshot(60));
  assert.deepEqual(display.read(scope, 'MS0001'), { stock: 50, balance: 45 });
  await assert.rejects(display.refresh(async () => scope, async () => new Promise(() => {})),
    { code: 'SYNC_V3_INVENTORY_HTTP_ERROR' });
  assert.deepEqual(display.read(scope, 'MS0001'), { stock: 50, balance: 45 });
});

test('restart hydrates exact zero, unchanged manifest skips transport, and failures leave the durable marker retryable', async t => {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  t.after(() => { globalThis.indexedDB = previous; });
  const first = createV3ErpStockDisplay();
  const marker = JSON.stringify(['inventory-manifest-1', 'version-1']);
  await first.refresh(async () => scope, async () => snapshot(0), marker);

  const restarted = createV3ErpStockDisplay();
  const activeScope = { ...scope, key: 'generation-2' };
  assert.equal(await restarted.hydrate(activeScope), true);
  assert.deepEqual(restarted.read(activeScope, 'MS0001'), { stock: 0, balance: 0 });
  assert.equal(await restarted.hydrate({ ...activeScope, storageKey: 'foreign' }), false);
  assert.equal(restarted.read({ ...activeScope, storageKey: 'foreign' }, 'MS0001'), undefined);
  assert.equal(await restarted.refresh(async () => activeScope, async () => {
    throw Error('unchanged manifest must not fetch');
  }, marker), false);

  const changed = JSON.stringify(['inventory-manifest-2', 'version-2']);
  await assert.rejects(restarted.refresh(async () => activeScope, async () => { throw Error('offline'); }, changed), /offline/);
  const rejected = t.mock.method(IDBObjectStore.prototype, 'put', () => { throw new DOMException('storage failure', 'QuotaExceededError'); });
  await assert.rejects(restarted.refresh(async () => activeScope, async () => snapshot(50), changed), { name: 'QuotaExceededError' });
  rejected.mock.restore();

  const next = createV3ErpStockDisplay();
  await next.hydrate(activeScope);
  assert.deepEqual(next.read(activeScope, 'MS0001'), { stock: 0, balance: 0 });
  assert.equal(await next.refresh(async () => activeScope, async () => snapshot(50), changed), true);
  assert.deepEqual(next.read(activeScope, 'MS0001'), { stock: 50, balance: 45 });
});

test('overlapping automatic refreshes join, and a pending manual request wins without publishing twice', async () => {
  const display = createV3ErpStockDisplay();
  let release!: (value: LargeMasterSyncV3InventorySnapshot) => void;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const first = display.refresh(async () => scope, async () => new Promise(resolve => { release = resolve; started(); }), 'marker-a');
  await start;
  const joined = display.refresh(async () => scope, async () => { throw Error('duplicate transport'); }, 'marker-a');
  release(snapshot(10));
  assert.deepEqual(await Promise.all([first, joined]), [true, false]);

  const manualStarted = new Promise<void>(resolve => { started = resolve; });
  const manual = display.refresh(async () => scope, async () => new Promise(resolve => { release = resolve; started(); }));
  await manualStarted;
  assert.equal(await display.refresh(async () => scope, async () => { throw Error('interrupted manual refresh'); }, 'marker-b'), false);
  release(snapshot(50));
  assert.equal(await manual, true);
  assert.deepEqual(display.read(scope, 'MS0001'), { stock: 50, balance: 45 });
});

test('the active display remains unchanged if the scope changes while persisting', async () => {
  const display = createV3ErpStockDisplay();
  await display.refresh(async () => scope, async () => snapshot(50), 'first');
  const foreign = { ...scope, storageKey: 'other-company', key: 'foreign-generation' };
  let checks = 0;
  await assert.rejects(display.refresh(async () => ++checks < 3 ? scope : foreign,
    async () => snapshot(20), 'second'), { code: 'SYNC_V3_BINDING_CHANGED' });
  assert.equal(checks, 3);
  assert.deepEqual(display.read(scope, 'MS0001'), { stock: 50, balance: 45 });
  assert.equal(display.read(foreign, 'MS0001'), undefined);
});
