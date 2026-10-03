import assert from 'node:assert/strict';
import test from 'node:test';
import type { ParkedTicket, Transaction } from '../types';
import {
  collectClosedRestaurantOrderIds,
  removeClosedRestaurantTickets,
} from '../utils/tableTicketIntegrity';

const ticket = (id: string, tableId: string): ParkedTicket => ({
  id,
  tableId,
  name: tableId,
  items: [],
  timestamp: '2026-10-03T15:00:00.000Z',
});

test('a durable restaurant sale prevents its paid order from returning in a later snapshot', () => {
  const sales = [{
    id: 'TXN-1',
    documentType: 'TICKET',
    restaurantOrderId: 'ORDER-11-A',
  }] as Transaction[];
  const closedIds = collectClosedRestaurantOrderIds(sales);

  const result = removeClosedRestaurantTickets([
    ticket('ORDER-11-A', 'TABLE-11'),
    ticket('ORDER-11-B', 'TABLE-11'),
    ticket('ORDER-12-A', 'TABLE-12'),
  ], closedIds);

  assert.deepEqual(result.removedTicketIds, ['ORDER-11-A']);
  assert.deepEqual(result.tickets.map(item => item.id), ['ORDER-11-B', 'ORDER-12-A']);
});

test('refunds and transactions without an exact restaurant order never create tombstones', () => {
  const ids = collectClosedRestaurantOrderIds([
    { id: 'REF-1', documentType: 'REFUND', restaurantOrderId: 'ORDER-OPEN' },
    { id: 'TXN-2', documentType: 'TICKET' },
  ] as Transaction[]);

  assert.equal(ids.size, 0);
});

test('bar-tab aliases of a paid order are filtered without affecting other accounts', () => {
  const result = removeClosedRestaurantTickets([
    { ...ticket('ACCOUNT-1', 'TABLE-11'), barTabId: 'ORDER-PAID' },
    ticket('ACCOUNT-2', 'TABLE-11'),
  ], new Set(['ORDER-PAID']));

  assert.deepEqual(result.removedTicketIds, ['ACCOUNT-1']);
  assert.deepEqual(result.tickets.map(item => item.id), ['ACCOUNT-2']);
});
