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
