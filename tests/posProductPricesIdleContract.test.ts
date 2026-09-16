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
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*setProductPrices\(Array\.isArray\(externalProductPrices\) \? externalProductPrices : \[\]\);\s*\}, \[externalProductPrices\]\)/,
  );
});
