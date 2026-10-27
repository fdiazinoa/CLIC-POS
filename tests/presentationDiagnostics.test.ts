import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePresentationScope, runPresentationDiagnostics } from '../services/inventoryPresentations/diagnostics';
import type { PresentationAuthority, PresentationAuth } from '../services/inventoryPresentations/client';

const authority: PresentationAuthority = {
  origin: 'https://erp.example.invalid',
  scope: { tenantId: 't', companyId: 'c', storeId: 's', terminalId: 'term', deviceId: 'dev', warehouseId: 'ALM_CENTRAL', localId: 'local-1' },
  tariffIds: ['T1'], categories: ['bebidas', 'café'],
};
const auth: PresentationAuth = {
  origin: authority.origin,
  scope: { tenantId: 't', companyId: 'c', storeId: 's', terminalId: 'term', deviceId: 'dev' },
  headers: {}, assertCurrent() { },
};
const remoteContext = (overrides: Record<string, any> = {}): any => ({
  schemaVersion: 1, contract: 'INVENTORY_PRESENTATIONS_V1',
  scope: { ...authority.scope }, tariffIds: ['T1'], categories: ['bebidas', 'café'],
  inventoryQuantityUnit: 'BASE', contextRevision: 'a'.repeat(64), returnPolicy: 'SOURCE_REQUIRED_NOT_YET_SUPPORTED',
  mastersUrl: '/api/sync/inventory-presentations/v1/masters', ...overrides,
});

test('a warehouse divergence is reported with both values, not as a single code', () => {
  const rows = comparePresentationScope(authority, remoteContext({ scope: { ...authority.scope, warehouseId: 'ALM_A01', localId: 'local-2' } }));
  const warehouse = rows.find(row => row.id === 'warehouse')!;
  assert.equal(warehouse.status, 'FAIL');
  assert.match(warehouse.detail, /ALM_CENTRAL/);
  assert.match(warehouse.detail, /ALM_A01/);
  assert.equal(rows.find(row => row.id === 'local')!.status, 'FAIL');
  assert.equal(rows.find(row => row.id === 'categories')!.status, 'OK', 'categories compare case insensitively');
});

test('the sweep stops at the first broken stage and names it', async () => {
  const rows = await runPresentationDiagnostics({
    config: {} as any, terminalId: 'term', auth: () => auth, authority: () => authority,
    fetchImpl: async () => new Response(JSON.stringify(remoteContext({ scope: { ...authority.scope, warehouseId: 'ALM_A01' } })), { status: 200, headers: { 'X-Clic-Inventory-Presentations': '1' } }),
  });
  assert.equal(rows[0].id, 'auth');
  assert.equal(rows.find(row => row.id === 'warehouse')!.status, 'FAIL');
  assert.equal(rows.at(-1)!.id, 'context');
  assert.match(rows.at(-1)!.detail, /no coincide/);
});

test('a non-200 negotiation is reported with its HTTP status', async () => {
  const rows = await runPresentationDiagnostics({
    config: {} as any, terminalId: 'term', auth: () => auth, authority: () => authority,
    fetchImpl: async () => new Response('{}', { status: 503 }),
  });
  const negotiate = rows.find(row => row.id === 'negotiate')!;
  assert.equal(negotiate.status, 'FAIL');
  assert.match(negotiate.detail, /503/);
});
