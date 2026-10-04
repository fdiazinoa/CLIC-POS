import assert from 'node:assert/strict';
import test from 'node:test';
import type { CartItem, ParkedTicket } from '../types';
import { transferTableAccountItems } from '../utils/tableAccountTransfer';

const item = (cartId: string, quantity: number): CartItem => ({ id: 'water', cartId, name: 'Agua', price: 100, quantity } as CartItem);
const ticket = (id: string, items: CartItem[]): ParkedTicket => ({ id, name: id, tableId: 'mesa-7', timestamp: '2026-10-03T19:00:00Z', items, total: items.reduce((sum, line) => sum + line.price * line.quantity, 0) });

test('transfiere cantidad entre cuentas de una misma mesa sin duplicar unidades ni tocar terceros', () => {
  const original = [ticket('a', [item('line-a', 3)]), ticket('b', [item('line-b', 1)]), ticket('c', [item('line-c', 1)])];
  const next = transferTableAccountItems(original, 'mesa-7', 'a', 'b', { 'line-a': 2 });
  assert.equal(next[0].items[0].quantity, 1);
  assert.equal(next[0].total, 100);
  assert.equal(next[1].items.reduce((sum, line) => sum + line.quantity, 0), 3);
  assert.equal(next[1].total, 300);
  assert.equal(next[2], original[2]);
  assert.equal(original[0].items[0].quantity, 3);
});

test('rechaza mesa ajena, cuota pagada, precuenta y cantidad inválida', () => {
  const base = [ticket('a', [item('line-a', 2)]), ticket('b', [])];
  assert.throws(() => transferTableAccountItems(base, 'mesa-8', 'a', 'b', { 'line-a': 1 }), /misma mesa/);
  assert.throws(() => transferTableAccountItems(base, 'mesa-7', 'a', 'b', { 'line-a': 3 }), /Cantidad inválida/);
  const fraction = { ...base[0], paymentFraction: { originalTotal: 200, count: 2, createdAt: '', parts: [{ index: 1, amount: 100, status: 'PAID' as const }] } };
  assert.throws(() => transferTableAccountItems([fraction, base[1]], 'mesa-7', 'a', 'b', { 'line-a': 1 }), /fraccionadas/);
  const printed = { ...base[0], items: [{ ...base[0].items[0], subtotalizedAt: '2026-10-03T19:10:00Z' }] };
  assert.throws(() => transferTableAccountItems([printed, base[1]], 'mesa-7', 'a', 'b', { 'line-a': 1 }), /pre-cuenta/);
});
