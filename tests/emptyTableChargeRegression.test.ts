import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ParkedTicket } from '../types';
import { removeStaleChargedEmptyTickets } from '../utils/tableTicketIntegrity';

const ticket = (overrides: Partial<ParkedTicket> = {}): ParkedTicket => ({
  id: 'TABLE-9-ACCOUNT-1',
  name: 'Mesa 9 - Cuenta 1',
  items: [],
  total: 0,
  timestamp: '2026-09-15T11:00:00.000Z',
  tableId: '9',
  ...overrides,
});

test('elimina un ticket fantasma sin líneas que conserva un cargo anterior', () => {
  const result = removeStaleChargedEmptyTickets([
    ticket({ total: 375 }),
  ]);

  assert.deepEqual(result.tickets, []);
  assert.deepEqual(result.removedTicketIds, ['TABLE-9-ACCOUNT-1']);
});

test('conserva una cuenta nueva válida sin líneas y con total cero', () => {
  const emptyAccount = ticket();
  const result = removeStaleChargedEmptyTickets([emptyAccount]);

  assert.deepEqual(result.tickets, [emptyAccount]);
  assert.deepEqual(result.removedTicketIds, []);
});

test('conserva cuentas con artículos y las demás cuentas de la mesa', () => {
  const active = ticket({
    id: 'active',
    items: [{ id: 'shirt', name: 'Camisa', price: 375, quantity: 1 } as any],
    total: 375,
  });
  const second = ticket({ id: 'second', total: 0 });
  const result = removeStaleChargedEmptyTickets([active, second]);

  assert.deepEqual(result.tickets, [active, second]);
  assert.deepEqual(result.removedTicketIds, []);
});

test('borrar la última línea usa el cierre explícito antes de persistir un ticket vacío', () => {
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const updateStart = source.indexOf('const updateCartItem');
  const updateEnd = source.indexOf('const handleClearFreshCartItems', updateStart);
  const updateSource = source.slice(updateStart, updateEnd);
  const releaseIndex = updateSource.indexOf("await releaseActiveEmptyTable({ silent: true, force: true })");
  const genericPersistenceIndex = updateSource.indexOf('const updatedTickets = parkedTickets.map');

  assert.match(updateSource, /const isDeletingItem = Boolean\(cartIdToDelete \|\| updatedItem === null\)/);
  assert.match(updateSource, /if \(isDeletingItem && activeTable && newCart\.length === 0\)/);
  assert.ok(releaseIndex >= 0);
  assert.ok(genericPersistenceIndex > releaseIndex);
});

test('la hidratación local y los snapshots remotos reparan cargos fantasma', () => {
  const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(source, /removeStaleChargedEmptyTickets\(mergedParkedTickets\)/);
  assert.match(source, /removeStaleChargedEmptyTickets\(mergedRemoteParkedTickets\)/);
  assert.match(source, /removeStaleChargedEmptyTickets\(integrityCheckedTickets|const integrityCheckedTickets = removeStaleChargedEmptyTickets/);
});
