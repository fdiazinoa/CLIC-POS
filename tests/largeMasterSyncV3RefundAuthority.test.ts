import test from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../types';
import { buildV3RefundOriginalMutations, requiresV3SaleAvailability } from '../services/sync/LargeMasterSyncV3RefundAuthority';

const stamp = { binding: 'binding', warehouseId: 'W', syncId: 'S', syncVersion: 2,
  tariffId: 'T', taxIncluded: true, inventoryVersion: 4, inventoryCursor: 'C' };
const original = (): Transaction => ({ id: 'sale', status: 'COMPLETED', total: 118, netAmount: 100,
  taxAmount: 18, v3Binding: 'binding', v3WarehouseId: 'W',
  v3InventoryBaseline: JSON.stringify(['binding', 'S', 2, 4, 'C']), relatedTransactions: ['old-refund'],
  items: [{ id: 'P', cartId: 'line', quantity: 1, price: 118, v3SaleAuthority: { ...stamp } }],
} as Transaction);

test('refund update uses the separate original snapshot for transaction and history CAS', () => {
  const before = original();
  const history = { ...before, syncStatus: 'APPLIED_ERP' as const };
  const after = { ...before, status: 'PARTIAL_REFUND' as const,
    relatedTransactions: ['old-refund', 'refund'], syncStatus: 'PENDING' as const };
  const mutations = buildV3RefundOriginalMutations(before, after, 'refund', history);
  assert.equal(mutations[0].expectedDocument, JSON.stringify(before));
  assert.equal(mutations[1].expectedDocument, JSON.stringify(history));
  assert.equal(mutations[0].document, after);
  assert.equal(before.relatedTransactions?.includes('refund'), false);
  assert.notEqual(mutations[0].expectedDocument, JSON.stringify(mutations[0].document));
});

test('refund original update rejects changed fiscal source, foreign baseline and unrelated links', () => {
  const before = original();
  const after = { ...before, status: 'REFUNDED' as const, relatedTransactions: ['old-refund', 'refund'] };
  assert.throws(() => buildV3RefundOriginalMutations(before, { ...after, total: 120 }, 'refund', before));
  assert.throws(() => buildV3RefundOriginalMutations(before, { ...after, v3Binding: 'other' }, 'refund', before));
  assert.throws(() => buildV3RefundOriginalMutations(before, { ...after, relatedTransactions: ['old-refund', 'foreign'] }, 'refund', before));
  assert.throws(() => buildV3RefundOriginalMutations(before, after, 'refund', { ...before, v3InventoryBaseline: 'other' }));
  assert.throws(() => buildV3RefundOriginalMutations({ ...before, items: [{ ...before.items[0],
    v3SaleAuthority: { ...stamp, inventoryCursor: 'other' } }] }, after, 'refund', before));
});

test('missing history requires an absent row rather than overwriting an unknown concurrent history', () => {
  const before = original();
  const after = { ...before, status: 'REFUNDED' as const, relatedTransactions: ['old-refund', 'refund'] };
  const mutations = buildV3RefundOriginalMutations(before, after, 'refund', null);
  assert.equal(mutations[1].requireAbsent, true);
  assert.equal(mutations[1].expectedDocument, undefined);
});

test('a sold-out tracked item may be refunded but still requires sale availability for a sale', () => {
  assert.equal(requiresV3SaleAvailability('REFUND', true, false, false), false);
  assert.equal(requiresV3SaleAvailability('SALE', true, false, false), true);
  assert.equal(requiresV3SaleAvailability('SALE', true, true, false), false);
  assert.equal(requiresV3SaleAvailability('SALE', true, false, true), false);
  assert.equal(requiresV3SaleAvailability('SALE', false, false, false), false);
});
