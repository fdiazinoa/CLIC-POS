import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const map = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const sheets = readFileSync(new URL('../components/TableAccountsSheetsModal.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

test('subtotal conserva mapa visible y exige elegir mesa', () => {
  assert.match(map, /mode: 'SUBTOTAL', step: 'SOURCE'/);
  assert.match(map, /Seleccione en el mapa la mesa para imprimir la pre-cuenta/);
  assert.doesNotMatch(map, /subtotalPickOpen/);
  assert.match(map, /onPrintPrecheck\?\.\(operationalTable, \[String\(tickets\[0\]\.id\)\]\)/);
  assert.match(map, /const allowed = await onBeforeTableOpen\?\.\(operationalTable\)/);
  assert.match(map, /await Promise\.resolve\(onTableOpenCancelled\?\.\(operationalTable\)\)/);
  assert.match(map, /subtotalPrintBusyRef\.current/);
  assert.match(map, /className="table-map-selection-cancel[^"]*"/);
  assert.match(css, /\.table-map-selection-cancel\s*\{[^}]*background-color:\s*#2563eb;[^}]*color:\s*#ffffff;/);
});

test('cuenta única normal abre POS, dividida o fraccionada muestra hojas', () => {
  assert.match(map, /tableTickets\.length > 1 \|\| tableTickets\.some\(ticket => \(ticket\.paymentFraction\?\.parts\?\.length/);
  assert.match(map, /<TableAccountsSheetsModal/);
  assert.match(map, /openPosTable\(\{ \.\.\.operationalTable, currentOrderId: ticket\.id/);
  assert.match(map, /onBeforeTableOpen\(operationalTable\)/);
  assert.match(map, /onOpenAccount=\{async \(ticket, inputTimeStamp, itemAction\) => \{/);
  assert.match(map, /currentOrderId: ticket\.id,/);
});

test('hojas muestran cuatro columnas, contenidos, acciones y pre-cuenta de todas deduplicada', () => {
  assert.match(sheets, /xl:grid-cols-4/);
  assert.match(sheets, /overflow-y-auto/);
  assert.match(sheets, /Nombre del comensal/);
  assert.match(sheets, /Pre-cuenta todas/);
  assert.match(sheets, /openSheets\.filter\(ticket => ticket\.items\?\.length\)/);
  assert.match(sheets, /openSheets\.filter\(ticket => !expandedTicket \|\| ticket\.id === expandedTicket\.id\)\.map/);
  assert.match(sheets, /ticket\.paymentFraction\.parts\.map/);
  assert.match(sheets, /partiallyPaidIds\.size > 0/);
  assert.match(sheets, /fractionDifference > 0 \|\| hasPaidParts/);
  assert.match(sheets, /aria-busy=\{busy\}/);
  assert.match(sheets, /disabled=\{busy\} onClick=\{\(\) => \{ if \(!busyRef\.current\) onClose\(\); \}\}/);
  assert.match(sheets, /Cobrar/);
  assert.match(sheets, /Transferir/);
  assert.doesNotMatch(sheets, /Agregar asiento/);
});

test('cuenta maximizada mantiene las reglas de edición en POS y despeja el encabezado', () => {
  assert.match(sheets, /Maximizar/);
  assert.match(sheets, /Restaurar/);
  assert.match(sheets, /Ajustar cantidad/);
  assert.match(sheets, /Devolver en cocina/);
  assert.match(sheets, /Retirar artículo/);
  assert.match(sheets, /onOpenAccount\(ticket, inputTimeStamp, \{ ticketId: String\(ticket\.id\), cartId, action: 'ADJUST' \}\)/);
  assert.match(sheets, /onOpenAccount\(ticket, inputTimeStamp, \{ ticketId: String\(ticket\.id\), cartId, action: 'RETURN' \}\)/);
  assert.match(map, /openPosTable\([\s\S]*?beginTableInteraction\('account-selection', inputTimeStamp\)\);\s*if \(itemAction\) onAccountItemActionRequested\?\.\(itemAction\)/);
  assert.match(sheets, /Total mesa/);
  assert.doesNotMatch(sheets, />Transferir artículos<\/div>/);
  assert.doesNotMatch(sheets, /Nuevo desde subtotal/);
  assert.match(sheets, /kitchenPending = kitchenDispatched && !item\.dispatched/);
  assert.match(sheets, /kitchenPending \? 'Pendiente en cocina'/);
  assert.match(sheets, /!canAdjustQuantity \|\| kitchenDispatched/);
  assert.match(sheets, /!item\.dispatched && !canRetireItem/);
  assert.match(map, /canAdjustQuantity=\{resolveCartItemEditCapabilities\(currentRolePermissions\)\.canEditQuantity\}/);
  assert.match(map, /canRetireItem=\{resolveCartItemEditCapabilities\(currentRolePermissions\)\.canVoidItem\}/);
  assert.match(app, /requestId: uuidv4\(\)/);
  assert.match(app, /accountItemActionRequest=\{currentView === 'POS' \? accountItemActionRequest : null\}/);
  assert.match(pos, /String\(activeTable\?\.currentOrderId \|\| ''\) !== request\.ticketId\) return/);
  assert.match(pos, /if \(!item\) \{[\s\S]*?El artículo cambió en la mesa/);
  assert.match(pos, /setEditingItem\(item\)/);
  assert.match(pos, /else if \(item\.dispatched\)/);
  assert.doesNotMatch(pos, /handleReturnDispatchedCartItem\(item\);\s*\/\/.*account/i);
});
