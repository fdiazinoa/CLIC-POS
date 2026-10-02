import assert from 'node:assert/strict';
import test from 'node:test';
import type { ParkedTicket, Table } from '../types';
import { updateTablesAfterAccountClose } from '../utils/tableCloseState';

const table = (id: string, orderId: string): Table => ({
  id,
  roomId: 'room-1',
  nombre: id,
  name: id,
  posX: 0,
  posY: 0,
  width: 100,
  height: 100,
  shape: 'SQUARE',
  rotation: 0,
  status: 'OCCUPIED',
  currentOrderId: orderId,
  currentOrderTotal: 100,
});

const ticket = (id: string, tableId: string, overrides: Partial<ParkedTicket> = {}): ParkedTicket => ({
  id,
  tableId,
  name: id,
  items: [{ id: 'item-1', name: 'Item', price: 100, quantity: 1 } as any],
  total: 100,
  timestamp: '2026-10-02T12:00:00.000Z',
  ...overrides,
});

test('closing Mesa 1 changes only Mesa 1 when remainingTickets is partial', () => {
  const mesa1 = { ...table('mesa-1', 'order-1'), joinedTableId: 'mesa-9', joinedSourceTableId: 'mesa-1' };
  const mesa2 = table('mesa-2', 'order-2');
  const result = updateTablesAfterAccountClose({
    tables: [mesa1, mesa2],
    closedTable: mesa1,
    closedOrderId: 'order-1',
    remainingTickets: [],
  });
  assert.equal(result.tables[0].status, 'FREE');
  assert.equal(result.tables[0].joinedTableId, undefined);
  assert.equal(result.tables[0].joinedSourceTableId, undefined);
  assert.deepEqual(result.tables[1], mesa2);
});

test('a foreign ticket ID prefix never reassigns a table without explicit membership', () => {
  const mesa1 = table('mesa-1', 'order-1');
  const mesa2 = table('mesa-2', 'order-2');
  const foreign = ticket('mesa-1-looking-order', 'mesa-2');
  const result = updateTablesAfterAccountClose({
    tables: [mesa1, mesa2],
    closedTable: mesa1,
    closedOrderId: 'order-1',
    remainingTickets: [foreign],
  });
  assert.equal(result.tables[0].status, 'FREE');
  assert.deepEqual(result.tables[1], mesa2);
});

test('remaining joined membership updates only its explicit primary and secondary tables', () => {
  const mesa1 = table('mesa-1', 'closed-order');
  const mesa2 = table('mesa-2', 'closed-order');
  const mesa3 = table('mesa-3', 'order-3');
  const joined = ticket('remaining-order', 'mesa-1', {
    primaryTableId: 'mesa-1',
    joinedTableIds: ['mesa-1', 'mesa-2'],
    total: 250,
  });
  const result = updateTablesAfterAccountClose({
    tables: [mesa1, mesa2, mesa3],
    closedTable: mesa1,
    closedOrderId: 'closed-order',
    remainingTickets: [joined],
  });
  assert.equal(result.tables[0].currentOrderId, 'remaining-order');
  assert.equal(result.tables[0].currentOrderTotal, 250);
  assert.equal(result.tables[1].currentOrderId, 'remaining-order');
  assert.equal(result.tables[1].currentOrderTotal, 0);
  assert.equal(result.tables[1].joinedSourceTableId, 'mesa-1');
  assert.equal(result.tables[1].joinedTableId, 'mesa-1');
  assert.deepEqual(result.tables[2], mesa3);
});

test('closing the final shared order frees every table that owned that order', () => {
  const mesa1 = {
    ...table('mesa-1', 'shared-order'),
    joinedTableId: 'mesa-2',
    joinedSourceTableId: 'mesa-1',
  };
  const mesa2 = {
    ...table('mesa-2', 'shared-order'),
    joinedTableId: 'mesa-1',
    joinedSourceTableId: 'mesa-1',
  };
  const mesa3 = table('mesa-3', 'unrelated-order');
  const result = updateTablesAfterAccountClose({
    tables: [mesa1, mesa2, mesa3],
    closedTable: mesa1,
    closedOrderId: 'shared-order',
    remainingTickets: [],
  });
  assert.deepEqual(result.tables.slice(0, 2).map(item => ({
    id: item.id,
    status: item.status,
    currentOrderId: item.currentOrderId,
    joinedTableId: item.joinedTableId,
  })), [
    { id: 'mesa-1', status: 'FREE', currentOrderId: undefined, joinedTableId: undefined },
    { id: 'mesa-2', status: 'FREE', currentOrderId: undefined, joinedTableId: undefined },
  ]);
  assert.deepEqual(result.tables[2], mesa3);
  assert.deepEqual(result.affectedTables.map(item => item.id), ['mesa-1', 'mesa-2']);
});

test('a remaining account on the primary table frees old shared members only', () => {
  const mesa1 = table('mesa-1', 'shared-order');
  const mesa2 = {
    ...table('mesa-2', 'shared-order'),
    joinedTableId: 'mesa-1',
    joinedSourceTableId: 'mesa-1',
  };
  const mesa3 = table('mesa-3', 'unrelated-order');
  const remaining = ticket('next-order', 'mesa-1');
  const result = updateTablesAfterAccountClose({
    tables: [mesa1, mesa2, mesa3],
    closedTable: mesa1,
    closedOrderId: 'shared-order',
    remainingTickets: [remaining],
  });
  assert.equal(result.tables[0].currentOrderId, 'next-order');
  assert.equal(result.tables[0].status, 'OCCUPIED');
  assert.equal(result.tables[1].currentOrderId, undefined);
  assert.equal(result.tables[1].status, 'FREE');
  assert.deepEqual(result.tables[2], mesa3);
});

test('stale joined metadata never frees a table that owns another live order', () => {
  const mesa1 = table('mesa-1', 'order-a');
  const mesa2 = {
    ...table('mesa-2', 'order-b'),
    joinedTableId: 'mesa-1',
    joinedSourceTableId: 'mesa-1',
  };
  const orderB = ticket('order-b', 'mesa-2');
  const result = updateTablesAfterAccountClose({
    tables: [mesa1, mesa2],
    closedTable: mesa1,
    closedOrderId: 'order-a',
    closedTicket: ticket('order-a', 'mesa-1', {
      primaryTableId: 'mesa-1',
      joinedTableIds: ['mesa-1', 'mesa-2'],
    }),
    remainingTickets: [orderB],
  });
  assert.equal(result.tables[0].status, 'FREE');
  assert.deepEqual(result.tables[1], mesa2);
});

test('a table still pointing at closed shared order is reassigned to its remaining account', () => {
  const mesa1 = {
    ...table('mesa-1', 'order-a'),
    joinedTableId: 'mesa-2',
    joinedSourceTableId: 'mesa-1',
  };
  const mesa2 = {
    ...table('mesa-2', 'order-a'),
    joinedTableId: 'mesa-1',
    joinedSourceTableId: 'mesa-1',
  };
  const orderB = ticket('order-b', 'mesa-2', { total: 75 });
  const result = updateTablesAfterAccountClose({
    tables: [mesa1, mesa2],
    closedTable: mesa1,
    closedOrderId: 'order-a',
    closedTicket: ticket('order-a', 'mesa-1', {
      primaryTableId: 'mesa-1',
      joinedTableIds: ['mesa-1', 'mesa-2'],
    }),
    remainingTickets: [orderB],
  });
  assert.equal(result.tables[0].status, 'FREE');
  assert.deepEqual(result.tables[1], {
    ...mesa2,
    status: 'OCCUPIED',
    currentOrderId: 'order-b',
    currentOrderTotal: 75,
    timeSeated: orderB.timestamp,
    joinedTableId: undefined,
    joinedTableName: undefined,
    joinedSourceTableId: undefined,
    joinedSourceTableName: undefined,
  });
});

test('split accounts reassign each formerly joined table from its own remaining ticket', () => {
  const mesa1 = table('mesa-1', 'order-a');
  const mesa2 = table('mesa-2', 'order-a');
  const result = updateTablesAfterAccountClose({
    tables: [mesa1, mesa2],
    closedTable: mesa1,
    closedOrderId: 'order-a',
    closedTicket: ticket('order-a', 'mesa-1', {
      primaryTableId: 'mesa-1',
      joinedTableIds: ['mesa-1', 'mesa-2'],
    }),
    remainingTickets: [
      ticket('order-b', 'mesa-1', { total: 40 }),
      ticket('order-c', 'mesa-2', { total: 60 }),
    ],
  });
  assert.deepEqual(result.tables.map(item => ({ id: item.id, order: item.currentOrderId, total: item.currentOrderTotal })), [
    { id: 'mesa-1', order: 'order-b', total: 40 },
    { id: 'mesa-2', order: 'order-c', total: 60 },
  ]);
});
