import test from 'node:test';
import assert from 'node:assert/strict';
import { tableAccountLineFingerprint } from '../services/fiscal/OfflineTableFiscalCheckout';

const line = (overrides: Record<string, unknown> = {}) => ({
  cartId: 'C1', id: 'item-1', price: 395, quantity: 2, taxable: true, appliedTaxIds: ['ITBIS'],
  type: 'PRODUCT', isInventoriable: true, measurementUnit: 'UND', purchaseUnit: 'UND', conversionFactor: 1,
  note: 'sin sal', selected_modifiers: [{ name: 'Término medio' }],
  v3SaleAuthority: { syncId: 'S1', syncVersion: 1, tariffId: 'T1', taxIncluded: false, inventoryVersion: 4, inventoryCursor: 'C4', warehouseId: 'ALM_CENTRAL' },
  ...overrides,
});

test('the commercial identity ignores a new inventory generation or warehouse', () => {
  const before = tableAccountLineFingerprint(line());
  const after = tableAccountLineFingerprint(line({
    v3SaleAuthority: { syncId: 'S2', syncVersion: 9, tariffId: 'T1', taxIncluded: false, inventoryVersion: 5, inventoryCursor: 'C5', warehouseId: 'A01' },
  }));
  assert.equal(after, before);
});

test('any commercial change still breaks the identity', () => {
  const base = tableAccountLineFingerprint(line());
  for (const change of [
    { price: 396 }, { quantity: 3 }, { note: 'con sal' },
    { selected_modifiers: [{ name: 'Término bien cocido' }] },
    { appliedTaxIds: ['ITBIS', 'PROPINA'] },
    { inventoryPresentation: { masterRevision: 'x' } },
  ]) {
    assert.notEqual(tableAccountLineFingerprint(line(change)), base, JSON.stringify(change));
  }
});
