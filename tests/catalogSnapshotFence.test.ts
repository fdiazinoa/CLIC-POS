import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogSnapshotConfirmsMutation } from '../services/sync/catalogSnapshotFence';
import type { CatalogMutation } from '../services/sync/CatalogEditQueue';

const base = {
  id: 'mutation', recordId: 'product', actorId: 'operator',
} as const;

test('a stale tariff snapshot does not release the applied price fence', () => {
  const mutation: CatalogMutation = {
    ...base, domain: 'tariff_prices', field: 'tariff',
    before: { price: 7500, margin: 0 }, after: { price: 7600, margin: 0 },
  };
  assert.equal(catalogSnapshotConfirmsMutation('products', [{
    id: 'product', tariffs: [{ tariffId: 'tariff', price: 7500, margin: 0 }],
  }], mutation), false);
  assert.equal(catalogSnapshotConfirmsMutation('products', [{
    id: 'product', tariffs: [{ tariffId: 'tariff', price: 7600, margin: 0 }],
  }], mutation), true);
});

test('tax and operation fences release only when ERP reflects their requested values', () => {
  const tax: CatalogMutation = {
    ...base, domain: 'item_taxes', field: 'tax_ids', before: ['tax'], after: [],
  };
  const operation: CatalogMutation = {
    ...base, domain: 'item_operations', field: 'promptPrice', before: false, after: true,
  };
  const stale = [{ id: 'product', appliedTaxIds: ['tax'], operationalFlags: { promptPrice: false } }];
  const confirmed = [{ id: 'product', appliedTaxIds: [], operationalFlags: { promptPrice: true } }];
  assert.equal(catalogSnapshotConfirmsMutation('products', stale, tax), false);
  assert.equal(catalogSnapshotConfirmsMutation('products', stale, operation), false);
  assert.equal(catalogSnapshotConfirmsMutation('products', confirmed, tax), true);
  assert.equal(catalogSnapshotConfirmsMutation('products', confirmed, operation), true);
});

test('non-canonical collections cannot confirm an applied edit', () => {
  const mutation: CatalogMutation = {
    ...base, domain: 'prices', field: 'precio_venta', before: 10, after: 20,
  };
  assert.equal(catalogSnapshotConfirmsMutation('productPrices', [{ id: 'product', price: 20 }], mutation), false);
});
