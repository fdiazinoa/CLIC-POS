import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canStepCartQuantity,
  isValidCartQuantity,
  isValidCartQuantityTransition,
} from '../utils/cartQuantity';

const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

test('una venta no puede cruzar a cero ni a una cantidad negativa', () => {
  assert.equal(isValidCartQuantityTransition(2, 1), true);
  assert.equal(isValidCartQuantityTransition(1, 0), false);
  assert.equal(isValidCartQuantityTransition(1, -1), false);
  assert.equal(canStepCartQuantity(1, -1), false);
});

test('una devolución autorizada conserva cantidades negativas sin cruzar a venta', () => {
  assert.equal(isValidCartQuantityTransition(-1, -2), true);
  assert.equal(isValidCartQuantityTransition(-1, 0), false);
  assert.equal(isValidCartQuantityTransition(-1, 1), false);
  assert.equal(canStepCartQuantity(-1, -1), true);
  assert.equal(canStepCartQuantity(-1, 1), false);
});

test('la validación rechaza cantidades vacías o inválidas antes del cobro', () => {
  assert.equal(isValidCartQuantity(1), true);
  assert.equal(isValidCartQuantity(-1), true);
  assert.equal(isValidCartQuantity(0), false);
  assert.equal(isValidCartQuantity(Number.NaN), false);
  assert.equal(isValidCartQuantity(Number.POSITIVE_INFINITY), false);

  assert.match(posSource, /!isValidCartQuantityTransition\(originalItem\.quantity, updatedItem\.quantity\)/);
  assert.match(posSource, /processedCart\.find\(item => !isValidCartQuantity\(item\.quantity\)\)/);
  assert.match(posSource, /item\.isReturnLine !== true/);
  assert.match(posSource, /disabled=\{isDispatchedToKds \|\| !canStepCartQuantity\(item\.quantity, -1\)\}/);
});
