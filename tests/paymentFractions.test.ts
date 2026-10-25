import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPaymentFractionPlan,
  createPaymentFractionPartProof,
  isPaymentFractionPlanCurrent,
  paymentFractionPlanFingerprint,
  retainCurrentPaymentFractionPlan,
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

test('el autoguardado conserva las cuotas al salir y volver a la mesa', () => {
  const plan = createPaymentFractionPlan(23050, 3, '2026-09-12T12:41:00.000Z');

  assert.equal(retainCurrentPaymentFractionPlan(plan, 23050), plan);
  assert.equal(retainCurrentPaymentFractionPlan(plan, 23050.02), undefined);
  assert.equal(retainCurrentPaymentFractionPlan(undefined, 23050), undefined);
});

test('el fingerprint del plan es determinista y cambia si se edita el plan', () => {
  const plan = createPaymentFractionPlan(4000, 4, '2026-07-17T00:00:00.000Z');
  assert.equal(paymentFractionPlanFingerprint(plan), paymentFractionPlanFingerprint(plan));

  const edited = { ...plan, parts: plan.parts.map((part, index) => index === 0 ? { ...part, amount: part.amount + 1 } : part) };
  assert.notEqual(paymentFractionPlanFingerprint(edited), paymentFractionPlanFingerprint(plan));
});

test('la prueba de cuota genera identidades estables únicas', () => {
  const first = createPaymentFractionPartProof();
  const second = createPaymentFractionPartProof();
  assert.ok(first.receiptId);
  assert.ok(first.operationId);
  assert.notEqual(first.receiptId, first.operationId);
  assert.notEqual(first.receiptId, second.receiptId);
});
