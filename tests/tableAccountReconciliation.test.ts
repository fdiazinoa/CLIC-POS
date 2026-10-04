import assert from 'node:assert/strict';
import test from 'node:test';
import type { ParkedTicket } from '../types';
import { reconcileRejectedTableTickets } from '../utils/tableAccountReconciliation';

const ticket = (id: string, tableId: string, name: string): ParkedTicket => ({
  id, tableId, name, timestamp: '2026-10-03T19:00:00Z', items: [], total: 0,
});

test('rechazo de A/B restaura solo mesa afectada y conserva edición nueva de otra mesa', () => {
  const rejectedA = ticket('a', 'mesa-11', 'Cuenta 1QA');
  const queuedB = ticket('b', 'mesa-11', 'Cuenta 2QA');
  const newerC = ticket('c', 'mesa-12', 'Cliente nuevo');
  const current = [rejectedA, queuedB, newerC];
  const remoteA = ticket('a', 'mesa-11', 'Cuenta 1');
  const remoteC = ticket('c', 'mesa-12', 'Nombre viejo');
  const result = reconcileRejectedTableTickets(current, [remoteA, remoteC], 'mesa-11');
  assert.deepEqual(result.map(row => [row.id, row.name]), [['c', 'Cliente nuevo'], ['a', 'Cuenta 1']]);
  assert.equal(result[0], newerC);
  assert.deepEqual(current, [rejectedA, queuedB, newerC]);
});

test('reconciliación de mesa unida conserva otras mesas', () => {
  const joined = { ...ticket('joined', 'mesa-12', 'Cuenta fantasma'), primaryTableId: 'mesa-11', joinedTableIds: ['mesa-11', 'mesa-12'] };
  const unrelated = ticket('unrelated', 'mesa-13', 'No tocar');
  const result = reconcileRejectedTableTickets([joined, unrelated], [], 'mesa-11');
  assert.deepEqual(result, [unrelated]);
});
