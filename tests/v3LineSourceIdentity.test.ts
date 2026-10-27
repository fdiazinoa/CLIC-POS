import test from 'node:test';
import assert from 'node:assert/strict';
import type { CartItem, Product, V3SaleAuthorityStamp } from '../types';
import { validateV3PinnedLineSource } from '../services/sync/LargeMasterSyncV3LineSource';

const authority: V3SaleAuthorityStamp = {
  syncId: 'S1', syncVersion: 5, tariffId: 'T1', taxIncluded: false,
  inventoryVersion: 3, inventoryCursor: 'C3', warehouseId: 'WH',
};
const product = (overrides: Partial<Product> = {}) => ({
  id: 'ITEM-1', name: 'Pechuga', price: 300, type: 'PRODUCT', isInventoriable: true,
  taxable: true, appliedTaxIds: ['ITBIS'], measurementUnit: 'UND', purchaseUnit: 'UND',
  conversionFactor: 1, operationalFlags: {}, activeInWarehouses: ['WH'],
  production_area_id: 'COCINA', product_type: 'SIMPLE',
  v3SaleAuthority: authority, ...overrides,
}) as unknown as Product;
const line = (overrides: Partial<CartItem> = {}) => ({
  id: 'ITEM-1', cartId: 'C1', name: 'Pechuga', price: 300, quantity: 1,
  type: 'PRODUCT', isInventoriable: true, taxable: true, appliedTaxIds: ['ITBIS'],
  measurementUnit: 'UND', purchaseUnit: 'UND', conversionFactor: 1,
  restaurantConfig: { production_area_id: 'COCINA' },
  v3SaleAuthority: authority, ...overrides,
}) as unknown as CartItem;

test('a stale descriptive copy is corrected by the commit instead of blocking the sale', () => {
  const stale = line({
    type: 'SERVICE' as any, isInventoriable: false, taxable: false, appliedTaxIds: ['OTRO'],
  });
  assert.doesNotThrow(() => validateV3PinnedLineSource(stale, product(), authority));
});

test('the article identity, the tariff treatment, the weight contract and the variant are still enforced', () => {
  assert.throws(() => validateV3PinnedLineSource(line({ id: 'OTHER' }), product(), authority), /identity/);
  assert.throws(() => validateV3PinnedLineSource(line(), product(), { ...authority, taxIncluded: true }), /tariff/);
  assert.throws(() => validateV3PinnedLineSource(line({ operationalFlags: { isWeighted: true } as any }), product({ operationalFlags: { isWeighted: true } as any }), authority), /weight/);
  assert.throws(() => validateV3PinnedLineSource(line({ variantId: 'v-missing' }), product(), authority), /VARIANT_SOURCE_CHANGED/);
});
