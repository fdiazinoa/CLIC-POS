import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ParkedTicket } from '../types';
import { createPaymentFractionPlan, isFullyPaidParkedTicket } from '../utils/paymentFractions';
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

test('el cleanup identifica solo planes vigentes completamente cobrados', () => {
  const paid = createPaymentFractionPlan(100, 2);
  paid.parts = paid.parts.map(part => ({ ...part, status: 'PAID' }));
  const pending = createPaymentFractionPlan(100, 2);

  assert.equal(isFullyPaidParkedTicket(ticket({ paymentFraction: paid })), true);
  assert.equal(isFullyPaidParkedTicket(ticket({ paymentFraction: pending })), false);
  assert.equal(isFullyPaidParkedTicket(ticket({ total: 120, paymentFraction: paid })), false);

  const otherAccount = ticket({ id: 'other-account', paymentFraction: pending });
  const cleaned = [ticket({ paymentFraction: paid }), otherAccount]
    .filter(candidate => !isFullyPaidParkedTicket(candidate));
  assert.deepEqual(cleaned.map(candidate => candidate.id), ['other-account']);
});

test('TableMap limpia solo tickets totalmente cobrados y refresca la liberación', () => {
  const source = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
  const cleanupStart = source.indexOf('const nextTickets = currentTickets.filter(ticket => !isFullyPaidParkedTicket(ticket))');
  const cleanupEnd = source.indexOf('}, [onRefreshTables, onUpdateParkedTickets, parkedTickets]);', cleanupStart);
  const cleanup = source.slice(cleanupStart, cleanupEnd);

  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  assert.match(cleanup, /onUpdateParkedTickets\(nextTickets\)/);
  assert.match(cleanup, /onRefreshTables\?\.\(\)/);
  assert.doesNotMatch(cleanup, /filter\(ticket => !parkedTicketBelongsToTable/);
});
