import assert from 'node:assert/strict';
import test from 'node:test';

import type { ParkedTicket } from '../types';
import { createPaymentFractionPlan } from '../utils/paymentFractions';
import {
  buildTableAccountDisplayEntries,
  getTableAccountLabel,
  renameTableAccountTicket,
  sortTableAccountsForDisplay,
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

test('el orden de las hojas no cambia al seleccionar otra cuenta ni renombrarla', () => {
  const earliest = ticket({ id: 'juan', timestamp: '2026-09-12T12:40:00.000Z', alias: 'Juan', name: 'Mesa 4 - Juan' });
  const next = ticket({ id: 'cuenta-1', timestamp: '2026-09-12T12:41:00.000Z', alias: 'Cuenta 4' });
  const latest = ticket({ id: 'jose', timestamp: '2026-09-12T12:42:00.000Z', alias: 'JOSE', name: 'Mesa 4 - JOSE' });
  assert.deepEqual(sortTableAccountsForDisplay([latest, next, earliest]).map(row => row.id), ['juan', 'cuenta-1', 'jose']);
  assert.deepEqual(sortTableAccountsForDisplay([next, earliest, latest]).map(row => row.id), ['juan', 'cuenta-1', 'jose']);
});

test('muestra las tres cuotas de una cuenta fraccionada sin triplicar el total', () => {
  const entries = buildTableAccountDisplayEntries([
    ticket({ paymentFraction: createPaymentFractionPlan(23050, 3) }),
  ]);

  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(entry => entry.displayLabel), [
    'Cuenta 1 · Cuota 1 de 3',
    'Cuenta 1 · Cuota 2 de 3',
    'Cuenta 1 · Cuota 3 de 3',
  ]);
  assert.deepEqual(entries.map(entry => entry.amount), [7683.34, 7683.33, 7683.33]);
  assert.deepEqual(summarizeOpenTableAccounts(entries), { count: 3, total: 23050 });
});

test('etiquetas legacy anidadas se simplifican sin cambiar nombre personalizado ni ID', () => {
  const generated = ticket({ id: 'keep-this-id', name: 'Mesa 11 - Cuenta 1 - Cuenta 2/4', tableDisplayLabel: 'Mesa 11' });
  assert.equal(getTableAccountLabel(generated, 1), 'Cuenta 2');
  assert.equal(generated.id, 'keep-this-id');
  assert.equal(generated.name, 'Mesa 11 - Cuenta 1 - Cuenta 2/4');
  assert.equal(getTableAccountLabel(ticket({ alias: 'Familia Díaz', name: generated.name }), 1), 'Familia Díaz');
  assert.equal(getTableAccountLabel(ticket({ name: 'Mesa 11 - Ana', tableDisplayLabel: 'Mesa 11' }), 1), 'Mesa 11 - Ana');
  assert.equal(getTableAccountLabel(ticket({ alias: 'Mesa 11 - Cuenta 1 - Cuenta 2/4', name: generated.name }), 1), 'Cuenta 2');
  assert.equal(getTableAccountLabel(ticket({ alias: 'Mesa 11 - Cuenta 1 - Cuenta 3/4', name: generated.name }), 2), 'Cuenta 3');
  assert.equal(getTableAccountLabel(ticket({ alias: 'Mesa 11 - Cuenta 1 - Cuenta 4/4', name: generated.name }), 3), 'Cuenta 4');
  assert.equal(getTableAccountLabel(ticket({ alias: 'Mesa 11 - Ana', name: generated.name }), 1), 'Mesa 11 - Ana');
  assert.equal(getTableAccountLabel(ticket({ alias: 'Mesa 11 - Ana Cuenta 2', name: generated.name }), 1), 'Mesa 11 - Ana Cuenta 2');
});

test('omite del selector las cuotas cobradas sin eliminarlas del ticket persistido', () => {
  const plan = createPaymentFractionPlan(300, 3);
  plan.parts[0] = { ...plan.parts[0], status: 'PAID' };
  const persistedTicket = ticket({ total: 300, paymentFraction: plan });
  const entries = buildTableAccountDisplayEntries([persistedTicket]);

  assert.deepEqual(entries.map(entry => entry.status), ['PENDING', 'PENDING']);
  assert.deepEqual(entries.map(entry => entry.fractionIndex), [2, 3]);
  assert.deepEqual(summarizeOpenTableAccounts(entries), { count: 2, total: 200 });
  assert.equal(persistedTicket.paymentFraction?.parts.length, 3);
  assert.equal(persistedTicket.paymentFraction?.parts[0].status, 'PAID');
});

test('una cuenta completamente cobrada no vuelve a aparecer como disponible', () => {
  const plan = createPaymentFractionPlan(300, 3);
  plan.parts = plan.parts.map(part => ({ ...part, status: 'PAID' }));
  const persistedTicket = ticket({ total: 300, paymentFraction: plan });

  assert.deepEqual(buildTableAccountDisplayEntries([persistedTicket]), []);
  assert.equal(persistedTicket.paymentFraction?.parts.length, 3);
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
