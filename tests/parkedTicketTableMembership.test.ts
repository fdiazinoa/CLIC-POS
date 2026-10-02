import assert from 'node:assert/strict';
import test from 'node:test';

import type { ParkedTicket } from '../types';
import { parkedTicketBelongsToTable } from '../utils/parkedTicketTableMembership';

const ticket = (overrides: Partial<ParkedTicket> = {}): ParkedTicket => ({
  id: 'order-primary',
  name: 'Mesa unida',
  tableId: 'primary',
  primaryTableId: 'primary',
  joinedTableIds: ['primary', 'secondary'],
  items: [{ id: 'water', price: 100, quantity: 1 } as any],
  total: 100,
  timestamp: '2026-10-02T12:00:00.000Z',
  ...overrides,
});

test('la membresía reconoce primaria y secundaria sin confundir otra mesa', () => {
  const shared = ticket();
  assert.equal(parkedTicketBelongsToTable(shared, 'primary'), true);
  assert.equal(parkedTicketBelongsToTable(shared, 'secondary'), true);
  assert.equal(parkedTicketBelongsToTable(shared, 'other'), false);
});
