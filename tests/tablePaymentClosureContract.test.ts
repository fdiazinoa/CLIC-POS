import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('el cobro de mesa es idempotente y no revive una orden cerrada', () => {
  assert.match(source, /const paymentFinalizationInFlightRef = useRef\(false\)/);
  assert.match(source, /if \(paymentFinalizationInFlightRef\.current\) \{/);
  assert.match(source, /paymentFinalizationInFlightRef\.current = true/);
  assert.match(source, /paymentFinalizationInFlightRef\.current = false/);
  assert.match(source, /closedTableOrderIdsRef\.current\.has\(String\(orderId\)\)[\s\S]*?await Promise\.resolve\(onTableOrderSaved/);
});

test('la caja maestra descarta snapshots tardíos de una orden ya cobrada', () => {
  assert.match(appSource, /closedRestaurantOrderIdsRef\.current\.add\(closedOrderId\)/);
  assert.match(appSource, /!closedRestaurantOrderIdsRef\.current\.has\(ticketId\)/);
});

test('el cleanup del autoguardado cancela el snapshot obsoleto sin enviarlo', () => {
  assert.match(source, /if \(ticketAutoSyncFlushRef\.current === flushTicketSync\) \{\s*ticketAutoSyncFlushRef\.current = null;\s*\}/);
});

test('una cuota intermedia se cobra desde el snapshot vivo y cancela el autoguardado anterior', () => {
  const start = source.indexOf('if (currentFractionPart && pendingFractionParts.length > 1)');
  const end = source.indexOf('if (currentFractionPart && pendingFractionParts.length === 1)', start);
  const branch = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(source.indexOf('const handlePaymentConfirm'), start), /parkedTicketsRef\.current\.find/);
  assert.match(branch, /cancelTicketAutoSync\(\)/);
  assert.match(branch, /const nextTickets = parkedTicketsRef\.current\.map/);
  assert.ok(branch.indexOf('parkedTicketsRef.current = nextTickets') < branch.indexOf('onUpdateParkedTicketsRef.current(nextTickets)'));
});

test('liberar una cuenta vacía invalida cualquier flush antes de publicar el cierre', () => {
  const start = source.indexOf('const releaseActiveEmptyTable');
  const end = source.indexOf('const handleParkCurrentTicket', start);
  const branch = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(branch, /cancelTicketAutoSync\(\)/);
  assert.match(branch, /closedTableOrderIdsRef\.current\.add\(releasedOrderId\)/);
  assert.match(branch, /const remaining = parkedTicketsRef\.current\.filter/);
  assert.ok(branch.indexOf('parkedTicketsRef.current = remaining') < branch.indexOf('onUpdateParkedTicketsRef.current(remaining)'));
  assert.match(branch, /parkedTicketBelongsToTable\(ticket, releasedTableId\)/);
  assert.match(branch, /expectedOrderId: String\(tableToRelease\.currentOrderId \|\| ''\)/);
  assert.ok(branch.indexOf('await ticketSync') < branch.indexOf("resolveValidatedOperationalApiUrl('/api/mesas/liberar')"));
});

test('el cierre final elimina solo la orden cobrada desde el snapshot vivo', () => {
  const start = source.indexOf('// --- CRITICAL: Ticket Closing Logic ---');
  const end = source.indexOf('// 3. Clear Active Table in UI', start);
  const branch = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(branch, /const remaining = parkedTicketsRef\.current\.filter/);
  assert.ok(branch.indexOf('parkedTicketsRef.current = remaining') < branch.indexOf('onUpdateParkedTicketsRef.current(remaining)'));
  assert.match(branch, /onTableOrderClosedRef\.current\?\./);
  assert.match(branch, /parkedTicketBelongsToTable\(ticket, activeTableId\)/);
  assert.match(branch, /expectedOrderId: closedOrderId/);
});
