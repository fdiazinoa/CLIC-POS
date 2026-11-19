import test from 'node:test';
import assert from 'node:assert/strict';
import { createV3ErpStockDisplay } from '../services/sync/LargeMasterSyncV3ErpStockDisplay';
import type { LargeMasterSyncV3InventorySnapshot } from '../services/sync/LargeMasterSyncV3Types';

const scope = { key: 'tenant-company-terminal-warehouse', erpWarehouseId: 'MEGA' };
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
  assert.equal(display.read({ ...scope, key: 'foreign' }, 'MS0001'), undefined);
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
