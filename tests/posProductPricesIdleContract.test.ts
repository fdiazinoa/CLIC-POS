import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

test('the optional productPrices prop uses a stable empty reference', () => {
  assert.match(source, /const EMPTY_PRODUCT_PRICES: ProductPrice\[\] = \[\];/);
  assert.match(source, /productPrices: externalProductPrices = EMPTY_PRODUCT_PRICES/);
  assert.doesNotMatch(source, /productPrices: externalProductPrices = \[\]/);
});

test('product price state only follows the external dependency', () => {
  const dependencyEffect = source.slice(
    source.indexOf('   useEffect(() => {\n      freezeCount(\'EFFECT_PRODUCT_PRICES\');'),
    source.indexOf('   useEffect(() => {', source.indexOf('   useEffect(() => {\n      freezeCount(\'EFFECT_PRODUCT_PRICES\');') + 1),
  );
  assert.match(dependencyEffect, /freezeCount\('EFFECT_PRODUCT_PRICES'\)/);
  assert.match(dependencyEffect, /setProductPrices\(Array\.isArray\(externalProductPrices\) \? externalProductPrices : \[\]\)/);
  assert.match(dependencyEffect, /\}, \[externalProductPrices\]\);/);
});
