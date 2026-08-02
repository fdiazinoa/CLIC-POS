import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const typesSource = readFileSync(new URL('../types.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../constants.ts', import.meta.url), 'utf8');
const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const mapSource = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('roles ofrece permisos separados para modificar y eliminar tickets subtotalizados', () => {
  assert.match(typesSource, /'POS_EDIT_SUBTOTALIZED_TICKET'/);
  assert.match(typesSource, /'POS_VOID_SUBTOTALIZED_TICKET'/);
  assert.match(constantsSource, /label: 'Modificar Ticket Subtotalizado'/);
  assert.match(constantsSource, /label: 'Eliminar Ticket Subtotalizado'/);
  assert.match(posSource, /permission: 'POS_EDIT_SUBTOTALIZED_TICKET'/);
  assert.match(posSource, /permission: 'POS_VOID_SUBTOTALIZED_TICKET'/);
});

test('modificar invalida el subtotal anterior y eliminar libera la mesa', () => {
  assert.match(posSource, /const clearCartSubtotalization/);
  assert.match(posSource, /authorizeSubtotalizedEdit\('Agregar artículo a ticket subtotalizado'\)/);
  assert.match(posSource, /authorizeSubtotalizedEdit\('Modificar artículo o cantidad de ticket subtotalizado'\)/);
  assert.match(posSource, /authorizeSubtotalizedEdit\('Modificar descuento de ticket subtotalizado'\)/);
  assert.match(posSource, /releaseActiveEmptyTable\(\{ force: true \}\)/);
});

test('la pre-cuenta se persiste y la mesa muestra estado subtotalizado', () => {
  assert.match(appSource, /subtotalizedAt: item\.subtotalizedAt \|\| subtotalizedAt/);
  assert.match(appSource, /await handleUpdateParkedTickets\(nextTickets, \{ reason: 'explicit' \}\)/);
  assert.match(mapSource, /type SmartStatus = [^;]*'SUBTOTALIZED'/);
  assert.match(mapSource, /label: 'Subtotalizada'/);
  assert.match(mapSource, />\s*Subtotal\s*</);
});

test('una mesa dividida distingue subtotal total y parcial por ticket', () => {
  assert.match(mapSource, /items\.every\(item => Boolean\(item\.subtotalizedAt\)\)/);
  assert.match(mapSource, /subtotalizedTicketCount: existing\.subtotalizedTicketCount \+ summary\.subtotalizedTicketCount/);
  assert.match(mapSource, /const isSubtotalized = ticketCount > 0 && subtotalizedTicketCount === ticketCount/);
  assert.match(mapSource, /const isPartiallySubtotalized = subtotalizedTicketCount > 0 && subtotalizedTicketCount < ticketCount/);
  assert.match(mapSource, /\{model\.subtotalizedTicketCount\} de \{model\.ticketCount\} subtotalizados/);
});

test('el selector identifica la cuenta subtotalizada con hora, usuario y monto', () => {
  assert.match(mapSource, /const subtotalState = getTicketSubtotalization\(ticket\)/);
  assert.match(mapSource, />\s*Subtotalizado\s*</);
  assert.match(mapSource, /subtotalState\.subtotalizedBy/);
  assert.match(posSource, /subtotalizedBy: item\.subtotalizedBy \|\| currentUser\?\.name \|\| currentUser\?\.id/);
  assert.match(posSource, /Cuenta \{activeTableAccountIndex \+ 1\} de \{activeTableAccounts\.length\}/);
  assert.match(posSource, /isActiveTableAccountSubtotalized/);
  assert.match(posSource, /await Promise\.resolve\(onUpdateParkedTickets\(nextTickets\)\)/);
});
