import test from 'node:test';
import assert from 'node:assert/strict';
import type { BusinessConfig, CartItem, V3SaleAuthorityStamp } from '../types';
import { buildLargeMasterSyncV3CheckoutFiscalInput } from '../services/sync/LargeMasterSyncV3CheckoutAuthority';
import { calculateTaxBreakdownFromItems } from '../utils/fiscalBreakdown';

const authority: V3SaleAuthorityStamp = {
  syncId: 'S1', syncVersion: 10, tariffId: 'T1', taxIncluded: true,
  inventoryVersion: 4, inventoryCursor: 'C4',
};
const legacyConfig = {
  taxRate: 0.12,
  taxes: [{ id: 'TX', name: 'Impuesto legacy', rate: 0.07, type: 'VAT' }],
} as BusinessConfig;
const v3Taxes = [{ id: 'TX', name: 'ITBIS V3', rate: 0.18, type: 'VAT' as const }];
const line = {
  id: 'A', name: 'Agua', price: 125.5, quantity: 1, cartId: 'CART-1',
  taxable: true, appliedTaxIds: ['TX'], v3SaleAuthority: authority,
} as CartItem;

test('uses only pinned V3 taxes and tariff treatment for fiscal calculation', () => {
  const fiscal = buildLargeMasterSyncV3CheckoutFiscalInput(
    legacyConfig, [line], authority, v3Taxes,
  );
  assert.equal(fiscal.isTaxIncluded, true);
  assert.equal(fiscal.config.taxRate, 0);
  assert.deepEqual(fiscal.config.taxes, v3Taxes);
  assert.equal(legacyConfig.taxes[0].rate, 0.07);
  const breakdown = calculateTaxBreakdownFromItems([line], fiscal.config, {
    isTaxIncluded: fiscal.isTaxIncluded,
  });
  assert.equal(breakdown.length, 1);
  assert.equal(breakdown[0].id, 'TX');
  assert.equal(breakdown[0].rate, 0.18);
});

test('blocks legacy and mixed-session cart lines before checkout', () => {
  assert.throws(() => buildLargeMasterSyncV3CheckoutFiscalInput(
    legacyConfig, [{ ...line, v3SaleAuthority: undefined }], authority, v3Taxes,
  ), /SYNC_V3_CART_LEGACY_LINE/);
  assert.throws(() => buildLargeMasterSyncV3CheckoutFiscalInput(
    legacyConfig, [{ ...line, v3SaleAuthority: { ...authority, tariffId: 'T2' } }], authority, v3Taxes,
  ), /SYNC_V3_CART_MIXED_VERSION/);
  assert.throws(() => buildLargeMasterSyncV3CheckoutFiscalInput(
    legacyConfig, [{ ...line, v3SaleAuthority: { ...authority, inventoryCursor: 'C5' } }], authority, v3Taxes,
  ), /SYNC_V3_CART_MIXED_VERSION/);
});

test('blocks missing V3 taxes instead of inheriting a legacy tax or global rate', () => {
  assert.throws(() => buildLargeMasterSyncV3CheckoutFiscalInput(
    legacyConfig, [line], authority, [],
  ), /SYNC_V3_TAX_UNAVAILABLE/);
  assert.throws(() => buildLargeMasterSyncV3CheckoutFiscalInput(
    legacyConfig, [{ ...line, appliedTaxIds: [] }], authority, v3Taxes,
  ), /SYNC_V3_LINE_INVALID/);
  assert.throws(() => buildLargeMasterSyncV3CheckoutFiscalInput(
    legacyConfig, [line], authority, [{ ...v3Taxes[0], rate: 18 }],
  ), /SYNC_V3_TAX_INVALID/);
});
