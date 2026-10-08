import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isWeightedProduct } from '../utils/weightedProduct';

test('barcode and click use the existing SERVICE or (peso) classification only', () => {
  for (const product of [{ type: 'SERVICE' }, { name: 'Arroz (peso)' }, { name: 'FRUTA (PESO)' }])
    assert.equal(isWeightedProduct(product), true);
  for (const product of [{}, { type: 'PRODUCT', name: 'Arroz' }, { name: 'Peso de papel' }, { name: 'Arroz kg' }])
    assert.equal(isWeightedProduct(product), false);
});

test('normal weighted barcode opens scale and returns before adding a default unit', () => {
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const click = source.slice(source.indexOf('const handleProductClick ='), source.indexOf('const handleSearchConsignments ='));
  assert.match(click, /const isWeighted = isWeightedProduct\(product\)/);
  assert.match(click, /if \(isWeighted\) setProductForScale\(product\)/);
  const scan = source.slice(source.indexOf('const performBarcode ='), source.indexOf('const processBarcode ='));
  const normal = scan.slice(scan.indexOf('// 2. Normal Barcode Search'));
  assert.match(normal, /if \(isWeightedProduct\(match.product\)\) \{\s*handleProductClick\(match.product\);\s*return \{ success: true,[\s\S]*?\};\s*\}\s*const hasConfiguredVariant/);
  assert.ok(normal.indexOf('isWeightedProduct(match.product)') < normal.indexOf('await addToCart('));
  assert.ok(scan.indexOf('routeScannedCoupon(trimmed)') < scan.indexOf('// 2. Normal Barcode Search'));
  assert.ok(scan.indexOf('// 1. Try Scale Parser') < scan.indexOf('// 2. Normal Barcode Search'));
  assert.ok(normal.indexOf('await addToCart(') < normal.indexOf('shouldRouteInvoiceScan(trimmed)'));
  assert.match(source, /addToCart\(productForScale, isReturnMode \? -w : w\)/);
});
