import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isWeightedProduct, assertWeightedCodeInput, hasV3KilogramContract } from '../utils/weightedProduct';

test('barcode and click use the explicit ERP flag and legacy SERVICE or (peso) classification', () => {
  for (const product of [{ type: 'PRODUCT', name: 'BAL-001', operationalFlags: { isWeighted: true } }, { type: 'SERVICE' }, { name: 'Arroz (peso)' }, { name: 'FRUTA (PESO)' }])
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
  assert.match(normal, /if \(isWeightedProduct\(match.product\)\) \{\s*assertWeightedCodeInput\(match.product, trimmed\);\s*handleProductClick\(match.product\);\s*return \{ success: true,[\s\S]*?\};\s*\}\s*const hasConfiguredVariant/);
  assert.ok(normal.indexOf('isWeightedProduct(match.product)') < normal.indexOf('await addToCart('));
  assert.ok(scan.indexOf('routeScannedCoupon(trimmed)') < scan.indexOf('// 2. Normal Barcode Search'));
  assert.ok(scan.indexOf('// 1. Try Scale Parser') < scan.indexOf('// 2. Normal Barcode Search'));
  assert.ok(normal.indexOf('await addToCart(') < normal.indexOf('shouldRouteInvoiceScan(trimmed)'));
  assert.match(source, /addToCart\(productForScale, isReturnMode \? -w : w\)/);
});

test('V3 weighted preflight does not demand one kilogram and mobile/card share classification', () => {
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  assert.match(source, /canAddItemToCart\(product, v3Operational && isWeighted \? 0 : 1\)/);
  assert.match(source, /const isWeighted = isWeightedProduct\(pendingProductToAdd\)/);
  assert.equal(source.match(/const isWeighted = isWeightedProduct\(product\)/g)?.length, 2);
  assert.match(source, /canAddItemToCart\(product, quantity, /);
});

test('V3 classification requires validated flags and units; names/services cannot imply weight', () => {
  const product = { type: 'PRODUCT', name: 'BAL-001', operationalFlags: { isWeighted: true, integersOnly: false },
    measurementUnit: 'Kilogramo', purchaseUnit: 'KG', conversionFactor: 1, v3SaleAuthority: {} };
  assert.equal(isWeightedProduct(product), true);
  for (const patch of [{ type: 'SERVICE' }, { measurementUnit: 'kilograms' }, { conversionFactor: 0 },
    { operationalFlags: { isWeighted: false, integersOnly: false }, name: 'Artículo (peso)' }])
    assert.equal(isWeightedProduct({ ...product, ...patch }), false);
  for (const raw of ['2*BAL-001', '0.25*BAL-001', '1*BAL-001'])
    assert.throws(() => assertWeightedCodeInput(product, raw), /no use multiplicadores/);
  assert.doesNotThrow(() => assertWeightedCodeInput(product, 'BAL-001'));
  assert.equal(hasV3KilogramContract(product), true);
});

test('Enter routes weighted match to scale before add and V3 code resolution rejects multipliers', () => {
  const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const enter = pos.slice(pos.indexOf('const resolveSubmittedCode ='), pos.indexOf('const handleSearchKeyDown ='));
  assert.match(enter, /isWeightedProduct\(match.product\)[\s\S]*assertWeightedCodeInput\(match.product, raw\)[\s\S]*handleProductClick\(match.product\)/);
  assert.ok(enter.indexOf('handleProductClick(match.product)') < enter.indexOf('await addToCart'));
  const boundary = readFileSync(new URL('../components/LargeMasterSyncV3OperationalPOS.tsx', import.meta.url), 'utf8');
  assert.match(boundary, /assertWeightedCodeInput\(product, raw\)/);
});
