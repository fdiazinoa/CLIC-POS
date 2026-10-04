import assert from 'node:assert/strict';
import test from 'node:test';

import type { ParkedTicket } from '../types';
import { assignTableSeller, getTableSellerId, hasPaidTableFraction } from '../utils/tableSellerAssignment';

const account = (id: string, tableId: string, sellerId?: string): ParkedTicket => ({
  id,
  name: id,
  tableId,
  tableSellerId: sellerId,
  timestamp: '2026-10-04T12:00:00.000Z',
  items: [{ id: `item-${id}`, name: 'Agua', price: 100, quantity: 1, salespersonId: sellerId } as any],
});

test('asignar vendedor actualiza todas las cuentas de la mesa sin tocar otra mesa', () => {
  const original = [account('uno', 'mesa-11'), account('dos', 'mesa-11'), account('otra', 'mesa-12', 'otro')];
  const assigned = assignTableSeller(original, 'mesa-11', 'juan');
  assert.deepEqual(assigned.slice(0, 2).map(ticket => ticket.tableSellerId), ['juan', 'juan']);
  assert.deepEqual(assigned.slice(0, 2).map(ticket => ticket.items[0].salespersonId), ['juan', 'juan']);
  assert.equal(assigned[2], original[2]);
  assert.equal(original[0].items[0].salespersonId, undefined);
  assert.equal(getTableSellerId(assigned, 'mesa-11'), 'juan');
});

test('detecta una cuota pagada para impedir reasignar ventas ya cobradas', () => {
  const tickets = [account('uno', 'mesa-11'), account('otra', 'mesa-12')];
  tickets[0].paymentFraction = {
    originalTotal: 100,
    count: 2,
    createdAt: '2026-10-04T12:00:00.000Z',
    parts: [{ index: 1, amount: 50, status: 'PAID' }, { index: 2, amount: 50, status: 'PENDING' }],
  };
  assert.equal(hasPaidTableFraction(tickets, 'mesa-11'), true);
  assert.equal(hasPaidTableFraction(tickets, 'mesa-12'), false);
});
