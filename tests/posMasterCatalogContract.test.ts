import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPosMasterCatalogSnapshot,
  POS_MASTER_OPERATIONAL_CATALOGS,
} from '../utils/posMasterCatalogContract';

test('POS Master publishes production and promotion catalogs required by clients', () => {
  const collections = new Set(POS_MASTER_OPERATIONAL_CATALOGS);
  assert.equal(collections.has('productionAreas'), true);
  assert.equal(collections.has('promotions'), true);
  assert.equal(collections.has('paymentMethods'), true);
  assert.equal(collections.has('taxes'), true);
  assert.equal(collections.has('documentSeries'), true);
  assert.equal(collections.has('productPrices'), true);
});

test('catalog snapshot reads SQLite and falls back to operational config arrays', async () => {
  const stored = new Map<string, unknown[]>([
    ['productionAreas', [{ id: 'kitchen', name: 'Cocina' }]],
    ['products', [{ id: 'product-1' }]],
  ]);
  const snapshot = await buildPosMasterCatalogSnapshot(
    async (collection) => stored.get(collection) || [],
    { customers: [{ id: 'customer-live' }] },
    {
      taxes: [{ id: 'tax-18' }],
      paymentMethods: [{ id: 'cash', name: 'Efectivo', type: 'CASH', isActive: true }],
      tariffs: [{ id: 'retail', name: 'Detalle', active: true }],
      promotions: [{ id: 'promo-1' }],
    } as any,
  );

  assert.deepEqual(snapshot.productionAreas, [{ id: 'kitchen', name: 'Cocina' }]);
  assert.deepEqual(snapshot.products, [{ id: 'product-1' }]);
  assert.deepEqual(snapshot.customers, [{ id: 'customer-live' }]);
  assert.deepEqual(snapshot.promotions, [{ id: 'promo-1' }]);
  assert.deepEqual(snapshot.paymentMethods, [{ id: 'cash', name: 'Efectivo', type: 'CASH', isActive: true }]);
  assert.deepEqual(snapshot.priceLists, [{ id: 'retail', name: 'Detalle', active: true }]);
});
