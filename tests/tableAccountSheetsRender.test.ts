import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { ParkedTicket, Table } from '../types';
import TableAccountsSheetsModal from '../components/TableAccountsSheetsModal';
import { getTableOpenElapsedLabel } from '../utils/tableAccountPresentation';

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
  assert.match(html, /aria-label="Imprimir pre-cuenta de Ana" disabled=""/);
  assert.match(html, /La pre-cuenta completa no representa el saldo pendiente/);
});

test('tiempo abierto usa fecha válida de cuenta si la mesa está corrupta y nunca muestra NaN', () => {
  const now = Date.parse('2026-10-03T20:42:00Z');
  assert.equal(getTableOpenElapsedLabel('Invalid Date', ['bad', '2026-10-03T20:00:00Z'], now), 'Abierta 0h 42m');
  assert.equal(getTableOpenElapsedLabel('2026-10-03T20:10:00Z', ['2026-10-03T20:00:00Z'], now), 'Abierta 0h 32m');
  assert.equal(getTableOpenElapsedLabel('bad', ['also bad', undefined], now), 'Tiempo no disponible');
  const tickets = Array.from({ length: 4 }, (_, index) => ({
    id: `ticket-${index}`, name: `Cuenta ${index + 1}`, tableId: 'mesa-11', timestamp: 'Invalid Date', total: 100,
    items: [{ id: 'water', cartId: `line-${index}`, name: 'Agua', price: 100, quantity: 1 }],
  })) as ParkedTicket[];
  const html = renderToStaticMarkup(React.createElement(TableAccountsSheetsModal, {
    table: { id: 'mesa-11', nombre: 'Mesa 11', timeSeated: 'Invalid Date' } as Table,
    tickets, currencySymbol: 'RD$',
    onClose: () => {}, onOpenAccount: () => {}, onCreateAccount: () => {},
    onRenameAccount: () => {}, onPrint: () => true, onTransfer: async () => {},
  }));
  assert.equal((html.match(/<section\b/g) || []).length, 4);
  assert.match(html, /Tiempo no disponible/);
  assert.doesNotMatch(html, /NaN/);
});

test('cobrar y renombrar conservan contraste explícito sin cambiar la fila legacy', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  const sheets = readFileSync(new URL('../components/TableAccountsSheetsModal.tsx', import.meta.url), 'utf8');
  assert.match(css, /\.table-account-action\s*\{\s*background-color:\s*#ffffff/);
  assert.match(css, /\.table-account-action\.table-account-checkout\s*\{\s*background-color:\s*#2563eb;\s*color:\s*#ffffff/);
  assert.match(css, /\.table-account-action\.table-account-checkout:active\s*\{\s*background-color:\s*#1d4ed8/);
  assert.match(sheets, /className="table-account-action table-account-checkout[^"]*text-white/);
  assert.match(sheets, /aria-label="Nombre del comensal"[^\n]*className="[^"]*bg-white[^"]*text-slate-900/);
});

test('cuatro hojas legacy usan Cuenta 1–4 en cabeceras, acciones y selector sin tocar alias persistido', () => {
  const tickets = Array.from({ length: 4 }, (_, index) => ({
    id: `split-${index + 1}`, tableId: 'mesa-11', tableDisplayLabel: 'Mesa 11',
    name: `Mesa 11 - Cuenta 1 - Cuenta ${index + 1}/4`,
    alias: index === 0 ? undefined : `Mesa 11 - Cuenta 1 - Cuenta ${index + 1}/4`,
    timestamp: '2026-10-03T19:00:00Z', total: 100,
    items: [{ id: 'water', cartId: `line-${index}`, name: 'Agua', price: 100, quantity: 1 }],
  })) as ParkedTicket[];
  const html = renderToStaticMarkup(React.createElement(TableAccountsSheetsModal, {
    table: { id: 'mesa-11', nombre: 'Mesa 11' } as Table,
    tickets, currencySymbol: 'RD$', onClose: () => {}, onOpenAccount: () => {},
    onCreateAccount: () => {}, onRenameAccount: () => {}, onPrint: () => true,
    onTransfer: async () => {},
  }));
  assert.equal((html.match(/<section\b/g) || []).length, 4);
  for (let index = 1; index <= 4; index += 1) {
    assert.match(html, new RegExp(`<h3[^>]*>Cuenta ${index}<\\/h3>`));
    assert.match(html, new RegExp(`aria-label="Renombrar Cuenta ${index}"`));
  }
  assert.doesNotMatch(html, /Mesa 11 - Cuenta 1 - Cuenta/);
  assert.equal(tickets[1].alias, 'Mesa 11 - Cuenta 1 - Cuenta 2/4');
  const sheetsSource = readFileSync(new URL('../components/TableAccountsSheetsModal.tsx', import.meta.url), 'utf8');
  assert.match(sheetsSource, /transferDestinations\.map\(ticket => <option[^>]*>\{getTableAccountLabel\(ticket, openSheets\.indexOf\(ticket\)\)\}/);
});

test('las hojas mantienen el mismo orden aun si la cuenta activa llega primero del mapa', () => {
  const rows = [
    { id: 'first', alias: 'Ana', timestamp: '2026-10-03T19:00:00Z' },
    { id: 'second', alias: 'Juan', timestamp: '2026-10-03T19:01:00Z' },
    { id: 'third', alias: 'José', timestamp: '2026-10-03T19:02:00Z' },
  ].map(row => ({ ...row, name: row.alias, tableId: 'mesa-7', total: 100,
    items: [{ id: row.id, cartId: row.id, name: 'Agua', price: 100, quantity: 1 }],
  })) as ParkedTicket[];
  const html = renderToStaticMarkup(React.createElement(TableAccountsSheetsModal, {
    table: { id: 'mesa-7', nombre: 'Mesa 7', currentOrderId: 'third' } as Table,
    tickets: [rows[2], rows[0], rows[1]], currencySymbol: 'RD$',
    onClose: () => {}, onOpenAccount: () => {}, onCreateAccount: () => {},
    onRenameAccount: () => {}, onPrint: () => true, onTransfer: async () => {},
  }));
  assert.ok(html.indexOf('>Ana</h3>') < html.indexOf('>Juan</h3>'));
  assert.ok(html.indexOf('>Juan</h3>') < html.indexOf('>José</h3>'));
});

test('pre-cuenta solicitada distingue solo artículos nuevos de la misma cuenta', () => {
  const tickets = [{
    id: 'printed', name: 'Cuenta 1', tableId: 'mesa-7', timestamp: '2026-10-03T19:00:00Z', total: 150,
    items: [
      { id: 'old', cartId: 'old', name: 'Artículo impreso', price: 100, quantity: 1, subtotalizedAt: '2026-10-03T19:10:00Z' },
      { id: 'new', cartId: 'new', name: 'Artículo agregado', price: 50, quantity: 1 },
    ],
  }, {
    id: 'plain', name: 'Cuenta 2', tableId: 'mesa-7', timestamp: '2026-10-03T19:00:00Z', total: 70,
    items: [{ id: 'plain-item', cartId: 'plain-item', name: 'Otra cuenta', price: 70, quantity: 1 }],
  }] as ParkedTicket[];
  const render = () => renderToStaticMarkup(React.createElement(TableAccountsSheetsModal, {
    table: { id: 'mesa-7', nombre: 'Mesa 7' } as Table,
    tickets, currencySymbol: 'RD$', onClose: () => {}, onOpenAccount: () => {},
    onCreateAccount: () => {}, onRenameAccount: () => {}, onPrint: () => true,
    onTransfer: async () => {},
  }));
  for (const html of [render(), render()]) {
    assert.equal((html.match(/Pre-cuenta solicitada/g) || []).length, 1);
    assert.equal((html.match(/Nuevo desde subtotal/g) || []).length, 1);
    assert.match(html, /Artículo impreso/);
    assert.match(html, /Artículo agregado/);
    assert.match(html, /border-emerald-200 bg-emerald-50[^>]*>[^<]*<div[^>]*>[^<]*<span[^>]*>1 × Artículo agregado/);
    assert.doesNotMatch(html, /Otra cuenta<\/span><span[^>]*>Nuevo desde subtotal/);
  }
});

test('cuenta nueva vacía conserva la acción de abrir POS y cada hoja muestra una sola fila total', () => {
  const tickets = [{
    id: 'empty', name: 'Cuenta 1', tableId: 'mesa-7', timestamp: '2026-10-03T19:00:00Z', total: 0, items: [],
  }, {
    id: 'filled', name: 'Cuenta 2', tableId: 'mesa-7', timestamp: '2026-10-03T19:00:00Z', total: 118,
    items: [{ id: 'item', cartId: 'line-1', name: 'Artículo', price: 100, quantity: 1 }],
  }] as ParkedTicket[];
  const html = renderToStaticMarkup(React.createElement(TableAccountsSheetsModal, {
    table: { id: 'mesa-7', nombre: 'Mesa 7' } as Table,
    tickets, currencySymbol: 'RD$', onClose: () => {}, onOpenAccount: () => {},
    onCreateAccount: () => {}, onRenameAccount: () => {}, onPrint: () => true,
    onTransfer: async () => {},
  }));
  assert.equal((html.match(/>Total cuenta/g) || []).length, 2);
  assert.match(html, /Abrir cuenta/);
  assert.match(html, /Cobrar en POS/);
  assert.doesNotMatch(html, /Subtotal neto|Total fiscal|Impuesto Ley/);
});
