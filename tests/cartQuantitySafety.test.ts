import { canonicalWeightQuantity, createWeightPresentation } from '../utils/scaleWeight';
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
  assert.match(posSource, /disabled=\{isDispatchedToKds \|\| !canStepCartQuantity\(item\.quantity, -canonicalWeightQuantity\(item, 1\)\)\}/);
});

test('visible weight steps validate canonical quantity boundaries while legacy unit steps stay unchanged', () => {
  const weighted = { weightPresentation: createWeightPresentation('S', 'lb', 'kg') };
  const step = canonicalWeightQuantity(weighted, 1);
  assert.equal(step, 0.45359237);
  assert.equal(canStepCartQuantity(step, -step), false);
  assert.equal(canStepCartQuantity(step * 2, -step), true);
  assert.equal(canStepCartQuantity(-step, step), false);
  assert.equal(canStepCartQuantity(-step, -step), true);
  assert.equal(canonicalWeightQuantity({}, 1), 1);
  const decrementGuard = /disabled=\{isDispatchedToKds \|\| !canStepCartQuantity\(item\.quantity, -canonicalWeightQuantity\(item, 1\)\)\}/g;
  assert.equal(posSource.match(decrementGuard)?.length, 2); // mobile and desktop use the same canonical step
  assert.equal(posSource.match(/quantity: item\.quantity - canonicalWeightQuantity\(item, 1\)/g)?.length, 2);
});
