import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveIncomingTariffs, resolveIncomingTaxIds } from '../services/sync/ProductImageCacheService';

test('an explicit empty ERP tax list clears stale local item taxes', () => {
  const local = { appliedTaxIds: ['tax-18'] };
  assert.deepEqual(resolveIncomingTaxIds({ tax_ids: [] } as any, local as any), []);
  assert.deepEqual(resolveIncomingTaxIds({ metadata: { appliedTaxIds: [] } } as any, local as any), []);
});

test('local item taxes are kept only when an older snapshot omits the field', () => {
  const local = { appliedTaxIds: ['tax-18'] };
  assert.deepEqual(resolveIncomingTaxIds({} as any, local as any), ['tax-18']);
});

test('an explicit empty ERP tariff list clears stale local particular prices', () => {
  const local = { tariffs: [{ tariffId: 'tariff-1', price: 15 }] };
  assert.deepEqual(resolveIncomingTariffs({ tariffs: [] } as any, local as any), []);
  assert.deepEqual(resolveIncomingTariffs({ metadata: { tariffs: [] } } as any, local as any), []);
  assert.deepEqual(resolveIncomingTariffs({} as any, local as any), local.tariffs);
});
