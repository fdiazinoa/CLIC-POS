import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveIncomingTaxIds } from '../services/sync/ProductImageCacheService';

test('an explicit empty ERP tax list clears stale local item taxes', () => {
  const local = { appliedTaxIds: ['tax-18'] };
  assert.deepEqual(resolveIncomingTaxIds({ tax_ids: [] } as any, local as any), []);
  assert.deepEqual(resolveIncomingTaxIds({ metadata: { appliedTaxIds: [] } } as any, local as any), []);
});

test('local item taxes are kept only when an older snapshot omits the field', () => {
  const local = { appliedTaxIds: ['tax-18'] };
  assert.deepEqual(resolveIncomingTaxIds({} as any, local as any), ['tax-18']);
});
