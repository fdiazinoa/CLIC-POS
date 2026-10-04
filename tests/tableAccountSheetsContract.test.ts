import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const map = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const sheets = readFileSync(new URL('../components/TableAccountsSheetsModal.tsx', import.meta.url), 'utf8');

test('subtotal conserva mapa visible y exige elegir mesa', () => {
  assert.match(map, /mode: 'SUBTOTAL', step: 'SOURCE'/);
  assert.match(map, /Seleccione en el mapa la mesa para imprimir la pre-cuenta/);
  assert.doesNotMatch(map, /subtotalPickOpen/);
  assert.match(map, /onPrintPrecheck\?\.\(operationalTable, \[String\(tickets\[0\]\.id\)\]\)/);
  assert.match(map, /const allowed = await onBeforeTableOpen\?\.\(operationalTable\)/);
  assert.match(map, /await Promise\.resolve\(onTableOpenCancelled\?\.\(operationalTable\)\)/);
  assert.match(map, /subtotalPrintBusyRef\.current/);
});

test('cuenta única normal abre POS, dividida o fraccionada muestra hojas', () => {
  assert.match(map, /tableTickets\.length > 1 \|\| tableTickets\.some\(ticket => \(ticket\.paymentFraction\?\.parts\?\.length/);
  assert.match(map, /<TableAccountsSheetsModal/);
  assert.match(map, /openPosTable\(\{ \.\.\.operationalTable, currentOrderId: ticket\.id/);
  assert.match(map, /onBeforeTableOpen\(operationalTable\)/);
  assert.match(map, /onOpenAccount=\{\(ticket, inputTimeStamp\) => \{/);
  assert.match(map, /currentOrderId: ticket\.id,/);
});

test('hojas muestran cuatro columnas, contenidos, acciones y pre-cuenta de todas deduplicada', () => {
  assert.match(sheets, /xl:grid-cols-4/);
  assert.match(sheets, /overflow-y-auto/);
  assert.match(sheets, /Nombre del comensal/);
  assert.match(sheets, /Pre-cuenta todas/);
  assert.match(sheets, /openSheets\.filter\(ticket => ticket\.items\?\.length\)/);
  assert.match(sheets, /openSheets\.map\(\(ticket, index\)/);
  assert.match(sheets, /ticket\.paymentFraction\.parts\.map/);
  assert.match(sheets, /partiallyPaidIds\.size > 0/);
  assert.match(sheets, /fractionDifference > 0 \|\| hasPaidParts/);
  assert.match(sheets, /aria-busy=\{busy\}/);
  assert.match(sheets, /disabled=\{busy\} onClick=\{\(\) => \{ if \(!busyRef\.current\) onClose\(\); \}\}/);
  assert.match(sheets, /Cobrar/);
  assert.match(sheets, /Transferir/);
  assert.doesNotMatch(sheets, /Agregar asiento/);
});
