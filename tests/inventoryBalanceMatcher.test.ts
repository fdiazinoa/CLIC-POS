import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
  createInventoryBalanceMatcher,
  productIdMatchesInventoryReference,
} from '../utils/productReferences';

type Identity = Record<string, unknown>;

const expectLegacyMatches = (products: Identity[], balances: Identity[]): void => {
  const matchBalances = createInventoryBalanceMatcher(products, balances);
  products.forEach((product, productIndex) => {
    const expected = balances.filter((balance) =>
      productIdMatchesInventoryReference(balance, product, products)
    );
    assert.deepEqual(matchBalances(productIndex), expected, `product index ${productIndex}`);
  });
};

test('inventory balance matcher preserves exact, alias, nested and normalized identity matches', () => {
  const products: Identity[] = [
    { id: 'local-1', itemId: 'ERP-1', sku: 'SKU-1', barcode: '12345' },
    { id: 'local-2', sourceProductId: 'SRC-2', erpProductId: 'ERP-2' },
    { id: 'local-3', product: { item_id: 'NESTED-3' } },
    { id: 'local-4', barcodes: [{ value: 'BAR-4' }] },
    { id: 'unrelated', sku: 'OTHER' },
  ];
  const balances: Identity[] = [
    { id: 'local-1', warehouse_id: 'w-1' },
    { product_id: ' erp-1 ', warehouse_id: 'w-2' },
    { item_id: 'sku-1', warehouse_id: 'w-3' },
    { productId: '12345', warehouse_id: 'w-4' },
    { source_product_id: 'src-2', warehouse_id: 'w-1' },
    { erp_product_id: 'ERP-2', warehouse_id: 'w-1' },
    { product: { itemId: 'nested-3' }, warehouse_id: 'w-1' },
    { barcode: 'bar-4', warehouse_id: 'w-1' },
    { id: 'absent', warehouse_id: 'w-1' },
  ];

  expectLegacyMatches(products, balances);
  assert.deepEqual(
    createInventoryBalanceMatcher(products, balances)(0).map((balance) => balance.warehouse_id),
    ['w-1', 'w-2', 'w-3', 'w-4'],
    'matching balances retain their original order and duplicates across warehouses'
  );
});

test('inventory balance matcher preserves one-hop links without making them transitive', () => {
  const products: Identity[] = [
    { id: 'a', sku: 'shared-a-b' },
    { id: 'b', sku: 'shared-a-b', itemId: 'shared-b-c' },
    { id: 'c', itemId: 'shared-b-c', barcode: 'third-hop-only' },
  ];
  const balances: Identity[] = [
    { product_id: 'b' },
    { product_id: 'shared-b-c' },
    { product_id: 'c' },
    { product_id: 'third-hop-only' },
  ];

  expectLegacyMatches(products, balances);
  const firstMatches = createInventoryBalanceMatcher(products, balances)(0);
  assert.deepEqual(firstMatches.map((balance) => balance.product_id), ['b', 'shared-b-c']);
});

test('inventory balance matcher retains legacy behavior for collisions and empty identities', () => {
  const products: Identity[] = [
    { id: 'first', barcode: 'collision' },
    { id: 'second', barcode: 'COLLISION' },
    { id: 'third', sku: 'independent' },
    {},
  ];
  const balances: Identity[] = [
    { barcode: 'collision' },
    { product_id: 'first' },
    { product_id: 'second' },
    { product_id: 'independent' },
    { warehouse_id: 'warehouse-only' },
    {},
  ];

  expectLegacyMatches(products, balances);
  const matchBalances = createInventoryBalanceMatcher(products, balances);
  assert.deepEqual(matchBalances(3), []);
  assert.deepEqual(matchBalances(-1), []);
  assert.deepEqual(matchBalances(products.length), []);
});

test('inventory balance matcher handles 2,430 products and 56 balances without full-catalog scans per pair', () => {
  const products: Identity[] = Array.from({ length: 2_430 }, (_, index) => ({
    id: `local-${index}`,
    itemId: `erp-${index}`,
    sku: `sku-${index}`,
  }));
  const balances: Identity[] = Array.from({ length: 56 }, (_, index) => ({
    product_id: `ERP-${index * 43}`,
    warehouse_id: `warehouse-${index % 3}`,
    qty_on_hand: index,
  }));

  const startedAt = performance.now();
  const matchBalances = createInventoryBalanceMatcher(products, balances);
  let matchedCount = 0;
  products.forEach((_, index) => { matchedCount += matchBalances(index).length; });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(matchedCount, 56);
  assert.ok(elapsedMs < 5_000, `2,430 × 56 inventory matching took ${elapsedMs.toFixed(0)} ms`);
  for (const index of [0, 64, 1_215, 2_429]) {
    const expected = balances.filter((balance) =>
      productIdMatchesInventoryReference(balance, products[index], products)
    );
    assert.deepEqual(matchBalances(index), expected, `large-catalog product index ${index}`);
  }
});
