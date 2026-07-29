import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPaymentFractionPlan,
  isPaymentFractionPlanCurrent,
  splitAmountIntoEqualParts
} from '../utils/paymentFractions';

test('divide un total exacto en partes iguales', () => {
  assert.deepEqual(splitAmountIntoEqualParts(4000, 4), [1000, 1000, 1000, 1000]);
});

test('distribuye los centavos sin alterar el total', () => {
  const parts = splitAmountIntoEqualParts(100, 3);

  assert.deepEqual(parts, [33.34, 33.33, 33.33]);
  assert.equal(Math.round(parts.reduce((sum, amount) => sum + amount, 0) * 100), 10000);
});

test('limita el fraccionamiento entre 2 y 20 cuotas', () => {
  assert.equal(splitAmountIntoEqualParts(10, 1).length, 2);
  assert.equal(splitAmountIntoEqualParts(10, 99).length, 20);
});

test('detecta cuando el total cambió después de crear el plan', () => {
  const plan = createPaymentFractionPlan(4000, 4, '2026-07-17T00:00:00.000Z');

  assert.equal(isPaymentFractionPlanCurrent(plan, 4000), true);
  assert.equal(isPaymentFractionPlanCurrent(plan, 4000.01), false);
  assert.equal(plan.parts.every(part => part.status === 'PENDING'), true);
});
