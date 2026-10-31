import test from 'node:test';
import assert from 'node:assert/strict';
import { pickAuthorizedWarehouse, readErpSalesWarehouse } from '../services/inventoryPresentations/salesWarehouseAlignment';

const rows = [
  { id: 'b1f7580a', erpWarehouseId: 'c0ea489b', inventoryLocalId: 'c0ea489b', name: 'Almacén A01', code: '001' },
  { id: '950572a5', erpWarehouseId: '6b9e5df2', inventoryLocalId: '6b9e5df2', name: 'Almacén Central', code: 'ALM_CENTRAL' },
];

test('the ERP warehouse is mapped to the authorized local row by id or local id', () => {
  assert.equal(pickAuthorizedWarehouse(rows, { warehouseId: '950572a5', localId: '6b9e5df2' })?.name, 'Almacén Central');
  assert.equal(pickAuthorizedWarehouse(rows, { warehouseId: 'c0ea489b', localId: 'c0ea489b' })?.name, 'Almacén A01');
  assert.equal(pickAuthorizedWarehouse(rows, { warehouseId: 'UNKNOWN', localId: 'UNKNOWN' }), null);
  assert.equal(pickAuthorizedWarehouse([], { warehouseId: '950572a5', localId: '6b9e5df2' }), null);
  assert.equal(pickAuthorizedWarehouse(rows, null), null);
});

test('the ERP warehouse is read from the presentations negotiation without extra writes', async () => {
  let called = 0;
  const result = await readErpSalesWarehouse({
    auth: () => ({ origin: 'https://erp.example.invalid', scope: {} as any, headers: { 'X-Terminal-Id': 't' }, assertCurrent() { } }),
    fetchImpl: async (url: any, init: any) => {
      called++;
      assert.match(String(url), /\/api\/sync\/inventory-presentations\/v1\/negotiate$/);
      assert.equal(init.method, 'POST');
      assert.equal(init.credentials, 'omit');
      return new Response(JSON.stringify({ scope: { warehouseId: '950572a5', localId: '6b9e5df2' } }), { status: 200 });
    },
  });
  assert.equal(called, 1);
  assert.deepEqual(result, { warehouseId: '950572a5', localId: '6b9e5df2' });
});

test('a refused negotiation leaves the local warehouse untouched', async () => {
  const result = await readErpSalesWarehouse({
    auth: () => ({ origin: 'https://erp.example.invalid', scope: {} as any, headers: {}, assertCurrent() { } }),
    fetchImpl: async () => new Response('{}', { status: 503 }),
  });
  assert.equal(result, null);
});
