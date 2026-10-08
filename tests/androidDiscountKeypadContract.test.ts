import { displayWeightPrice, canonicalWeightPrice, createWeightPresentation } from '../utils/scaleWeight';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const globalDiscountSource = readFileSync(
  new URL('../components/GlobalDiscountModal.tsx', import.meta.url),
  'utf8',
);
const lineDiscountSource = readFileSync(
  new URL('../components/CartItemOptionsModal.tsx', import.meta.url),
  'utf8',
);

test('los descuentos Android usan el teclado numérico embebido y excluyen LatinIME', () => {
  for (const source of [globalDiscountSource, lineDiscountSource]) {
    assert.match(source, /Capacitor\.getPlatform\(\) === 'android'/);
    assert.match(source, /data-disable-native-soft-keyboard/);
    assert.match(source, /inputMode=\{isAndroid \? 'none' : 'decimal'\}/);
    assert.match(source, /readOnly=\{isAndroid\}/);
    assert.match(source, /<NumericKeypad/);
  }
});

test('los límites del teclado coinciden con el tipo de descuento', () => {
  assert.match(globalDiscountSource, /type === 'PERCENT' \? 100 : currentSubtotal/);
  assert.match(lineDiscountSource, /discountType === 'PERCENT' \? 100 : displayWeightPrice\(item, adjustmentBasePrice\)/);
});

test('fixed weighted discount limits convert display money back to the permitted canonical price', () => {
  for (const [canonicalUnit, displayUnit] of [['kg', 'lb'], ['lb', 'kg']] as const) {
    const item = { price: 1, weightPresentation: createWeightPresentation('S', displayUnit, canonicalUnit) };
    const limit = displayWeightPrice(item, item.price);
    assert.equal(canonicalWeightPrice(item, limit), item.price);
    assert.equal(Math.max(0, item.price - canonicalWeightPrice(item, limit)), 0);
    assert.equal(canonicalWeightPrice(item, limit / 2), 0.5);
  }
  assert.equal(displayWeightPrice({ price: 10 }, 10), 10); // unchanged legacy fixed limit
  assert.match(lineDiscountSource, /adjustmentBasePrice - canonicalWeightPrice\(item, val\)/);
  assert.match(lineDiscountSource, /canApplyDiscount \|\| canOverridePrice \? price : item.price/);
  assert.match(lineDiscountSource, /canApplyDiscount \|\| canOverridePrice/);
});
