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
  assert.match(lineDiscountSource, /discountType === 'PERCENT' \? 100 : adjustmentBasePrice/);
});
