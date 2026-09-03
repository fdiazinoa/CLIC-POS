import assert from 'node:assert/strict';
import test from 'node:test';
import { getInitialConfig } from '../constants';
import { allowsDefaultPaymentMethods, normalizeErpPaymentMethods, readErpPaymentMethodsSnapshot } from '../utils/erpPaymentMethods';
import { syncErpPaymentMethods, type PaymentMethodsSyncDependencies } from '../services/sync/PaymentMethodsSync';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';

const rows = [
  { id: 'erp-cash', code: 'CASH', name: 'Efectivo', type: 'cash', active: true },
  { id: 'erp-credit', code: 'CREDIT', name: 'Pendiente', type: 'credit', active: true },
  { id: 'erp-transfer', code: 'TRAN', name: 'Transferencia', type: 'cash', active: true, allowsChange: false },
  { id: 'erp-card', code: 'CARD', name: 'Tarjeta', type: 'card', active: true },
];
function fixture() {
  const state = { config: getInitialConfig('Supermercado' as any), collection: [] as unknown[], events: 0, writes: 0 };
  const dependencies: PaymentMethodsSyncDependencies = {
    fetchSnapshot: async () => rows,
    readConfig: async () => state.config,
    save: async (collection, value) => {
      state.writes++;
      if (collection === 'config') state.config = JSON.parse(JSON.stringify(value));
      else state.collection = JSON.parse(JSON.stringify(value));
    },
    notify: config => { assert.deepEqual(state.config, JSON.parse(JSON.stringify(config))); state.events++; },
  };
  return { state, dependencies };
}

test('hydrates four ERP methods into both persistent catalog and checkout configuration', async () => {
  const { state, dependencies } = fixture();
  assert.equal(await syncErpPaymentMethods(dependencies), 4);
  assert.deepEqual(state.config.paymentMethods.map(m => [m.id, m.name, m.type, m.isEnabled]), [
    ['erp-cash', 'Efectivo', 'CASH', true], ['erp-credit', 'Pendiente', 'CREDIT', true],
    ['erp-transfer', 'Transferencia', 'CASH', true], ['erp-card', 'Tarjeta', 'CARD', true],
  ]);
  assert.deepEqual(state.collection, state.config.paymentMethods);
  assert.equal((state.config.paymentMethods[2] as any).allowsChange, false);
  assert.equal(state.config.paymentMethods[2].opensDrawer, false);
  assert.equal(state.config.paymentMethods[0].opensDrawer, true, 'legacy CASH drawer setting retained');
  assert.equal(state.events, 1);
  assert.equal(allowsDefaultPaymentMethods(state.config), false);
});

test('refresh propagates renames, disables and removals; no defaults after all are disabled or removed', async () => {
  const { state, dependencies } = fixture();
  await syncErpPaymentMethods(dependencies);
  dependencies.fetchSnapshot = async () => [{ ...rows[0], name: 'Caja', active: false }];
  await syncErpPaymentMethods(dependencies);
  assert.equal(state.config.paymentMethods.length, 1);
  assert.equal(state.config.paymentMethods[0].name, 'Caja');
  assert.equal(state.config.paymentMethods[0].isEnabled, false);
  assert.equal(allowsDefaultPaymentMethods(state.config), false);
  dependencies.fetchSnapshot = async () => [];
  await syncErpPaymentMethods(dependencies);
  assert.deepEqual(state.config.paymentMethods, []);
  assert.equal(allowsDefaultPaymentMethods(state.config), false);
});

test('network failure or invalid snapshot preserves every saved method without writes or events', async () => {
  for (const failure of [async () => { throw new Error('HTTP 500'); }, async () => [{ ...rows[0], type: 'unknown-type' }]]) {
    const { state, dependencies } = fixture();
    const initial = JSON.stringify(state);
    dependencies.fetchSnapshot = failure;
    await assert.rejects(syncErpPaymentMethods(dependencies));
    assert.equal(JSON.stringify(state), initial);
  }
});

test('offline restart and later terminal snapshot keep synced configuration and source marker', async () => {
  const { state, dependencies } = fixture();
  await syncErpPaymentMethods(dependencies);
  const restored = JSON.parse(JSON.stringify(state.config));
  const applied = applyTerminalConfigSnapshot(restored, { terminalId: 'test-terminal', incomingSnapshot: { terminal_id: 'test-terminal', resolved: { company: { name: 'Updated company' } } } });
  assert.deepEqual(applied.config.paymentMethods, restored.paymentMethods);
  assert.equal(allowsDefaultPaymentMethods(applied.config), false);
});

test('unchanged refresh avoids config events and retains config edited during the download', async () => {
  const { state, dependencies } = fixture();
  dependencies.fetchSnapshot = async () => { state.config.themeColor = 'orange'; return rows; };
  await syncErpPaymentMethods(dependencies);
  await syncErpPaymentMethods(dependencies);
  assert.equal(state.config.themeColor, 'orange');
  assert.equal(state.events, 1);
});

test('preserves integration settings by identity and honors explicit false in camel/snake contracts', () => {
  const base = normalizeErpPaymentMethods(rows);
  base[3] = { ...base[3], integration: 'AZUL' as any, integrationMode: 'INTEGRATED', integrationId: 'gateway' };
  const result = normalizeErpPaymentMethods([{ ...rows[3], active: undefined, is_enabled: 'false', opens_drawer: false, requires_signature: true }], base);
  assert.equal(result[0].isEnabled, false);
  assert.equal(result[0].integrationId, 'gateway');
  assert.equal(result[0].integrationMode, 'INTEGRATED');
  assert.equal(result[0].requiresSignature, true);
  assert.equal(result[0].opensDrawer, false);
  assert.throws(() => normalizeErpPaymentMethods([rows[0], rows[0]]));
  assert.throws(() => normalizeErpPaymentMethods([{ ...rows[0], active: 'invalid' }]));
});

test('only explicit complete data/items arrays are authoritative, including empty', () => {
  assert.deepEqual(readErpPaymentMethodsSnapshot({ items: [], count: 0 }), []);
  assert.deepEqual(readErpPaymentMethodsSnapshot({ data: rows, count: 4 }), rows);
  for (const payload of [{}, { error: 'offline', items: [] }, { supported: false, items: [] }, { items: rows, count: 5 }, { items: rows, nextCursor: 'page2' }, { items: [], status: 'error' }]) {
    assert.throws(() => readErpPaymentMethodsSnapshot(payload));
  }
  assert.equal(allowsDefaultPaymentMethods(getInitialConfig('Supermercado' as any)), true);
});
