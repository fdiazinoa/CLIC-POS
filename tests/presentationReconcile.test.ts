import test from 'node:test';
import assert from 'node:assert/strict';
import type { CartItem } from '../types';
import type { InventoryPresentationMaster } from '../services/inventoryPresentations/contract';
import { reconcilePresentationLine } from '../services/inventoryPresentations/reconcile';

const master = (overrides: Partial<InventoryPresentationMaster> = {}): InventoryPresentationMaster => ({
  schemaVersion: 1, contextRevision: null, itemId: 'item-1', sku: 'SKU-1', name: 'Agua',
  inventoryQuantityUnit: 'BASE', masterRevision: 'b'.repeat(64),
  formats: [{
    schemaVersion: 1, id: 'pack12', variantId: null, name: 'Paquete', abbreviation: 'PK',
    factor: 12, barcode: '', active: true, isBase: false, allowSale: true, allowPurchase: true,
    defaultSale: false, defaultPurchase: false, sortOrder: 1, prices: [],
  }],
  basePrices: [{ tariffId: 'T1', price: 20, taxIncluded: false }],
  ...overrides,
});

const line = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1', cartId: 'C1', name: 'Agua', quantity: 1, price: 240,
  v3SaleAuthority: { syncId: 'S', syncVersion: 12, tariffId: 'T1', taxIncluded: false, inventoryVersion: 5, inventoryCursor: 'C5', warehouseId: 'WH' },
  inventoryPresentation: {
    schemaVersion: 1, itemId: 'item-1', variantId: null,
    format: { schemaVersion: 1, id: 'pack12', variantId: null, name: 'Paquete', abbreviation: 'PK', factor: 12, barcode: '' },
    commercialQuantity: 1, baseQuantity: 12, tariffId: 'T1', masterRevision: 'a'.repeat(64),
  },
  ...overrides,
}) as unknown as CartItem;

test('a presentation from an older catalog adopts the current master and keeps the agreed price', () => {
  const outcome = reconcilePresentationLine(line(), master());
  assert.equal(outcome.status, 'reconciled');
  if (outcome.status !== 'reconciled') return;
  assert.equal(outcome.line.inventoryPresentation!.masterRevision, master().masterRevision);
  assert.equal(outcome.line.inventoryPresentation!.baseQuantity, 12);
  assert.equal(outcome.line.price, 240, 'the amount agreed on the table never changes');
});

test('a presentation whose current price differs is reported instead of repriced', () => {
  const outcome = reconcilePresentationLine(line(), master({ basePrices: [{ tariffId: 'T1', price: 21, taxIncluded: false }] }));
  assert.deepEqual(outcome, { status: 'unavailable', reason: 'PRICE_CHANGED' });
});

test('a removed or non-sellable format is reported', () => {
  assert.deepEqual(reconcilePresentationLine(line(), master({ formats: [] })), { status: 'unavailable', reason: 'FORMAT_REMOVED' });
  const disabled = master();
  disabled.formats[0].allowSale = false;
  assert.deepEqual(reconcilePresentationLine(line(), disabled), { status: 'unavailable', reason: 'NOT_SELLABLE' });
});

test('a tariff the presentation no longer offers is reported', () => {
  const outcome = reconcilePresentationLine(line({ v3SaleAuthority: { ...line().v3SaleAuthority!, tariffId: 'T9' } }), master());
  assert.deepEqual(outcome, { status: 'unavailable', reason: 'TARIFF_FORBIDDEN' });
});
