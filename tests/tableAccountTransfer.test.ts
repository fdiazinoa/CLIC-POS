import assert from 'node:assert/strict';
import test from 'node:test';
import type { CartItem, ParkedTicket } from '../types';
import { getInitialConfig } from '../constants';
import { SubVertical, type Table } from '../types';
import { transferTableAccountItems } from '../utils/tableAccountTransfer';

const item = (cartId: string, quantity: number): CartItem => ({ id: 'water', cartId, name: 'Agua', price: 100, quantity } as CartItem);
const ticket = (id: string, items: CartItem[]): ParkedTicket => ({ id, name: id, tableId: 'mesa-7', timestamp: '2026-10-03T19:00:00Z', items, total: items.reduce((sum, line) => sum + line.price * line.quantity, 0) });
const table = { id: 'mesa-7', nombre: 'Mesa 7' } as Table;
const config = getInitialConfig(SubVertical.SUPERMARKET);
const transfer = (tickets: ParkedTicket[], tableArg: Table, source: string, target: string, quantities: Record<string, number>) =>
  transferTableAccountItems(tickets, tableArg, source, target, quantities, config, config.terminals[0].config, false);

test('transfiere cantidad entre cuentas de una misma mesa sin duplicar unidades ni tocar terceros', () => {
  const original = [ticket('a', [item('line-a', 3)]), ticket('b', [item('line-b', 1)]), ticket('c', [item('line-c', 1)])];
  const next = transfer(original, table, 'a', 'b', { 'line-a': 2 });
  assert.equal(next[0].items[0].quantity, 1);
  assert.equal(next[0].total, 100);
  assert.equal(next[1].items.reduce((sum, line) => sum + line.quantity, 0), 3);
  assert.equal(next[1].total, 300);
  assert.equal(next[2], original[2]);
  assert.equal(original[0].items[0].quantity, 3);
});

test('rechaza mesa ajena, cuota pagada, precuenta y cantidad inválida', () => {
  const base = [ticket('a', [item('line-a', 2)]), ticket('b', [])];
  assert.throws(() => transfer(base, { ...table, id: 'mesa-8' }, 'a', 'b', { 'line-a': 1 }), /misma mesa/);
  assert.throws(() => transfer(base, table, 'a', 'b', { 'line-a': 3 }), /Cantidad inválida/);
  const fraction = { ...base[0], paymentFraction: { originalTotal: 200, count: 2, createdAt: '', parts: [{ index: 1, amount: 100, status: 'PAID' as const }] } };
  assert.throws(() => transfer([fraction, base[1]], table, 'a', 'b', { 'line-a': 1 }), /fraccionadas/);
  const printed = { ...base[0], items: [{ ...base[0].items[0], subtotalizedAt: '2026-10-03T19:10:00Z' }] };
  assert.throws(() => transfer([printed, base[1]], table, 'a', 'b', { 'line-a': 1 }), /pre-cuenta/);
});

test('recalcula total fiscal de ambas cuentas con ITBIS tras transferir', () => {
  const taxed = { ...item('taxed-line', 2), appliedTaxIds: ['tax-18'] };
  const next = transfer([ticket('a', [taxed]), ticket('b', [])], table, 'a', 'b', { 'taxed-line': 1 });
  assert.equal(next[0].total, 118);
  assert.equal(next[1].total, 118);
});

test('permite cuentas de una mesa unida sin perder la identidad de origen', () => {
  const source = { ...ticket('a', [item('line-a', 2)]), tableId: 'mesa-8', primaryTableId: 'mesa-7', joinedTableIds: ['mesa-7', 'mesa-8'] };
  const next = transfer([source, ticket('b', [])], table, 'a', 'b', { 'line-a': 1 });
  assert.equal(next[0].tableId, 'mesa-8');
  assert.equal(next[0].items[0].quantity, 1);
  assert.equal(next[1].items[0].quantity, 1);
});

test('transferencia conserva el total promocionado del POS sin mutar líneas estacionadas', () => {
  const promoConfig = getInitialConfig(SubVertical.RESTAURANT);
  promoConfig.promotions = [{ id: 'all-20', name: '20%', type: 'DISCOUNT', priority: 10, targetType: 'ALL', benefitValue: 20 } as any];
  promoConfig.serviceTaxPolicies = { DINE_IN: { legalTip: { enabled: false, percentage: 0 } } };
  const original = [ticket('a', [item('line-a', 2)]), ticket('b', [])];
  original[0].items[0].appliedTaxIds = [];
  const next = transferTableAccountItems(original, table, 'a', 'b', { 'line-a': 1 }, promoConfig, promoConfig.terminals[0].config, false, promoConfig.terminals[0].id);
  assert.equal(next[0].total, 80);
  assert.equal(next[1].total, 80);
  assert.equal(next[0].items[0].price, 100);
  assert.equal(next[1].items[0].price, 100);
  assert.equal(original[0].items[0].quantity, 2);
});

test('transferencia total retira origen vacío, conserva tercero, impuesto y trazabilidad de minuta', () => {
  const source = { ...ticket('a', [{ ...item('line-a', 1), appliedTaxIds: ['tax-18'], dispatched: true, orderNumber: 'ORD-7' }]), orderNumber: 'ORD-7' };
  const target = ticket('b', [{ ...item('line-b', 1), appliedTaxIds: ['tax-18'] }]);
  const third = ticket('c', [item('line-c', 1)]);
  const next = transfer([source, target, third], table, 'a', 'b', { 'line-a': 1 });
  assert.deepEqual(next.map(row => row.id), ['b', 'c']);
  assert.equal(next[0].total, 236);
  assert.equal(next[0].items.length, 2);
  assert.equal(next[0].items[1].dispatched, true);
  assert.equal(next[0].items[1].orderNumber, 'ORD-7');
  assert.equal(next[0].items[1].transferredFromTicketId, 'a');
  assert.equal(next[1], third);
  assert.equal(source.items.length, 1);
});

test('transferencia total conserva membresía de mesa unida en target antes de retirar source', () => {
  const source = { ...ticket('a', [item('line-a', 1)]), primaryTableId: 'mesa-7', joinedTableIds: ['mesa-7', 'mesa-8'] };
  const target = ticket('b', []);
  const next = transfer([source, target], table, 'a', 'b', { 'line-a': 1 });
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'b');
  assert.equal(next[0].primaryTableId, 'mesa-7');
  assert.deepEqual(next[0].joinedTableIds, ['mesa-7', 'mesa-8']);
});

test('full-retire bloquea cliente/pagos y precuenta, y cuenta legacy ya vacía no se transfiere', () => {
  const source = ticket('a', [item('line-a', 1)]);
  const target = ticket('b', []);
  assert.throws(() => transfer([{ ...source, customerId: 'customer-1' }, target], table, 'a', 'b', { 'line-a': 1 }), /cliente o pagos/);
  assert.throws(() => transfer([{ ...source, payments: [{ amount: 100 }] } as any, target], table, 'a', 'b', { 'line-a': 1 }), /cliente o pagos/);
  assert.throws(() => transfer([{ ...source, items: [{ ...source.items[0], subtotalizedAt: '2026-10-03T20:00:00Z' }] }, target], table, 'a', 'b', { 'line-a': 1 }), /pre-cuenta/);
  assert.throws(() => transfer([ticket('a', []), target], table, 'a', 'b', {}), /Seleccione al menos/);
});
