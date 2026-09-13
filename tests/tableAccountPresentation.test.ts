import assert from 'node:assert/strict';
import test from 'node:test';

import type { ParkedTicket } from '../types';
import { createPaymentFractionPlan } from '../utils/paymentFractions';
import {
  buildTableAccountDisplayEntries,
  renameTableAccountTicket,
  summarizeOpenTableAccounts,
} from '../utils/tableAccountPresentation';

const ticket = (overrides: Partial<ParkedTicket> = {}): ParkedTicket => ({
  id: 'mesa-4-cuenta-1',
  name: 'Mesa 4 - Cuenta 1',
  items: [{ id: 'item-1', name: 'Producto', price: 23050, quantity: 1 } as any],
  total: 23050,
  timestamp: '2026-09-12T12:41:00.000Z',
  tableId: 'mesa-4',
  ...overrides,
});

test('muestra las tres cuotas de una cuenta fraccionada sin triplicar el total', () => {
  const entries = buildTableAccountDisplayEntries([
    ticket({ paymentFraction: createPaymentFractionPlan(23050, 3) }),
  ]);

  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(entry => entry.displayLabel), [
    'Mesa 4 - Cuenta 1 · Cuota 1 de 3',
    'Mesa 4 - Cuenta 1 · Cuota 2 de 3',
    'Mesa 4 - Cuenta 1 · Cuota 3 de 3',
  ]);
  assert.deepEqual(entries.map(entry => entry.amount), [7683.34, 7683.33, 7683.33]);
  assert.deepEqual(summarizeOpenTableAccounts(entries), { count: 3, total: 23050 });
});

test('conserva visibles las cuotas cobradas y resume solo las pendientes', () => {
  const plan = createPaymentFractionPlan(300, 3);
  plan.parts[0] = { ...plan.parts[0], status: 'PAID' };
  const entries = buildTableAccountDisplayEntries([ticket({ total: 300, paymentFraction: plan })]);

  assert.deepEqual(entries.map(entry => entry.status), ['PAID', 'PENDING', 'PENDING']);
  assert.deepEqual(summarizeOpenTableAccounts(entries), { count: 2, total: 200 });
});

test('permite nombrar la primera cuenta sin perder sus datos operativos', () => {
  const original = ticket({ alias: undefined, paymentFraction: createPaymentFractionPlan(23050, 3) });
  const renamed = renameTableAccountTicket(original, 'Mesa 4', 'Familia Díaz');

  assert.equal(renamed.alias, 'Familia Díaz');
  assert.equal(renamed.name, 'Mesa 4 - Familia Díaz');
  assert.equal(renamed.id, original.id);
  assert.equal(renamed.paymentFraction, original.paymentFraction);
  assert.equal(renamed.items, original.items);
});

test('permite nombrar cada cuota de forma independiente', () => {
  const original = ticket({ alias: 'Felix', paymentFraction: createPaymentFractionPlan(23050, 3) });
  const renamedSecond = renameTableAccountTicket(original, 'Mesa 4', 'Ana', 2);
  const renamedThird = renameTableAccountTicket(renamedSecond, 'Mesa 4', 'Luis', 3);
  const entries = buildTableAccountDisplayEntries([renamedThird]);

  assert.equal(renamedThird.alias, 'Felix');
  assert.deepEqual(renamedThird.paymentFraction?.parts.map(part => part.name), [undefined, 'Ana', 'Luis']);
  assert.deepEqual(entries.map(entry => entry.displayLabel), [
    'Felix · Cuota 1 de 3',
    'Ana · Cuota 2 de 3',
    'Luis · Cuota 3 de 3',
  ]);
  assert.deepEqual(entries.map(entry => entry.editName), ['Felix', 'Ana', 'Luis']);
});

test('ignora nombres vacíos y conserva el ticket original', () => {
  const original = ticket();
  assert.equal(renameTableAccountTicket(original, 'Mesa 4', '   '), original);
});

test('ignora un índice de cuota inexistente', () => {
  const original = ticket({ paymentFraction: createPaymentFractionPlan(23050, 3) });
  assert.equal(renameTableAccountTicket(original, 'Mesa 4', 'Fuera de rango', 9), original);
});
