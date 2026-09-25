import assert from 'node:assert/strict';
import test from 'node:test';
import type { ParkedTicket } from '../types';
import { isDirectSaleParkedTicket } from '../utils/directSaleParkedTickets';

const ticket = (overrides: Partial<ParkedTicket> = {}): ParkedTicket => ({
  id: 'P-100', name: 'Venta directa', items: [], timestamp: '2026-09-25T18:00:00.000Z', ...overrides,
});

test('a direct sale remains recoverable even when the terminal also uses tables', () => {
  assert.equal(isDirectSaleParkedTicket(ticket()), true);
  assert.equal(isDirectSaleParkedTicket(ticket({ alias: 'Cuenta 1' })), true);
});

test('table accounts and shared/bar tabs cannot be recovered as direct sales', () => {
  for (const linked of [
    { tableId: 'M-1' },
    { tableId: 0 },
    { primaryTableId: 'M-1' },
    { joinedTableIds: ['M-2'] },
    { barTabId: 'BAR-1' },
    { barTabName: 'Minuta 1' },
    { tableDisplayLabel: 'Mesa 1' },
    { tableRoomLabel: 'Salón' },
    { id: 'TABLE-M-1-ACCOUNT-1' },
    { name: 'Mesa: Mesa 1' },
  ] satisfies Partial<ParkedTicket>[]) {
    assert.equal(isDirectSaleParkedTicket(ticket(linked)), false, JSON.stringify(linked));
  }
});
