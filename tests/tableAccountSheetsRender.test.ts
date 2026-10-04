import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ParkedTicket, Table } from '../types';
import TableAccountsSheetsModal from '../components/TableAccountsSheetsModal';

test('una cuenta fraccionada renderiza una hoja y una sola minuta con cuotas dentro', () => {
  const ticket = {
    id: 'ticket-1', name: 'Cuenta 1', alias: 'Ana', tableId: 'mesa-7',
    timestamp: '2026-10-03T19:00:00Z', total: 200,
    items: [{ id: 'water', cartId: 'line-1', name: 'Agua', price: 100, quantity: 2 }],
    paymentFraction: { originalTotal: 200, count: 2, createdAt: '2026-10-03T19:00:00Z', parts: [
      { index: 1, amount: 100, status: 'PAID' }, { index: 2, amount: 100, status: 'PENDING' },
    ] },
  } as ParkedTicket;
  const html = renderToStaticMarkup(React.createElement(TableAccountsSheetsModal, {
    table: { id: 'mesa-7', nombre: 'Mesa 7', timeSeated: '2026-10-03T19:00:00Z' } as Table,
    tickets: [ticket], currencySymbol: 'RD$',
    onClose: () => {}, onOpenAccount: () => {}, onCreateAccount: () => {},
    onRenameAccount: () => {}, onPrint: () => true, onTransfer: async () => {},
  }));
  assert.equal((html.match(/<section\b/g) || []).length, 1);
  assert.equal((html.match(/2 × Agua/g) || []).length, 1);
  assert.match(html, /Pagada/);
  assert.match(html, /Pendiente/);
});
