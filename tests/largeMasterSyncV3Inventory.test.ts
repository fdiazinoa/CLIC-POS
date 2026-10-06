import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLargeMasterSyncV3Inventory, parseLargeMasterSyncV3Inventory } from '../services/sync/LargeMasterSyncV3Inventory';
import type { LargeMasterSyncV3BoundIdentity } from '../services/sync/LargeMasterSyncV3BoundTransport';

const binding: LargeMasterSyncV3BoundIdentity = {
  erpSyncBaseUrl: 'https://erp.example.test/api/sync', tenantId: 'tenant-1',
  terminalId: 'terminal-1', deviceId: 'device-1', syncToken: 'secret-token',
};
const empty = { status: 'success', collection: 'productInventory', supported: true,
  count: 0, version: 5, cursor: 'inventory-cursor', items: [] };

test('inventory fetch is separate from V3 catalog and accepts an empty demo snapshot', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(empty), { status: 200 });
  }) as typeof fetch;
  const result = await fetchLargeMasterSyncV3Inventory(() => binding, fetcher);
  assert.deepEqual(result, { version: 5, cursor: 'inventory-cursor', balances: [] });
  assert.equal(calls[0].url, 'https://erp.example.test/api/sync/collections/productInventory/full');
  assert.equal((calls[0].init?.headers as Record<string, string>)['X-Sync-Token'], 'secret-token');
  assert.equal(calls[0].init?.redirect, 'error');
  assert.equal(calls.length, 1);
});

test('inventory rejects unsupported, malformed and duplicate balance records', () => {
  assert.throws(() => parseLargeMasterSyncV3Inventory({ ...empty, supported: false }),
    /SYNC_V3_INVENTORY_INVALID/);
  assert.throws(() => parseLargeMasterSyncV3Inventory({ ...empty, count: 1 }),
    /SYNC_V3_INVENTORY_INVALID/);
  const row = { item_id: 'A', warehouse_id: 'W', qty_on_hand: 3,
    qty_reserved: 0, qty_committed: 0, updated_at: '2026-10-05T00:00:00Z' };
  assert.deepEqual(parseLargeMasterSyncV3Inventory({ ...empty, count: 1, items: [row] }).balances, [row]);
  assert.throws(() => parseLargeMasterSyncV3Inventory({ ...empty, count: 2, items: [row, row] }),
    /SYNC_V3_INVENTORY_INVALID/);
  assert.throws(() => parseLargeMasterSyncV3Inventory({ ...empty, count: 1,
    items: [{ ...row, qty_on_hand: Number.NaN }] }), /SYNC_V3_INVENTORY_INVALID/);
});

test('inventory response is rejected if the device binding changes in flight', async () => {
  let current = binding;
  const fetcher = (async () => {
    current = { ...binding, terminalId: 'other-terminal' };
    return new Response(JSON.stringify(empty), { status: 200 });
  }) as typeof fetch;
  await assert.rejects(fetchLargeMasterSyncV3Inventory(() => current, fetcher),
    /SYNC_V3_BINDING_CHANGED/);
});

test('candidate inventory download uses Railway while original auth binding and headers stay intact', async () => {
  const initial = structuredClone(binding);
  let calls = 0;
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls++;
    assert.equal(url, 'https://railway.example.test/api/sync/collections/productInventory/full');
    assert.equal((init?.headers as Record<string, string>)['X-Sync-Token'], binding.syncToken);
    assert.equal((init?.headers as Record<string, string>)['X-Tenant-Id'], binding.tenantId);
    assert.equal((init?.headers as Record<string, string>)['X-Terminal-Id'], binding.terminalId);
    assert.equal((init?.headers as Record<string, string>)['X-Device-Id'], binding.deviceId);
    assert.equal(init?.redirect, 'error');
    return Response.json(empty);
  }) as typeof fetch;
  await fetchLargeMasterSyncV3Inventory(() => binding, fetcher, undefined, 'https://railway.example.test');
  assert.equal(calls, 1);
  assert.deepEqual(binding, initial);
});
