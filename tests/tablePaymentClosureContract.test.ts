import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

test('el cobro de mesa es idempotente y no revive una orden cerrada', () => {
  assert.match(source, /const paymentFinalizationInFlightRef = useRef\(false\)/);
  assert.match(source, /if \(paymentFinalizationInFlightRef\.current\) \{/);
  assert.match(source, /paymentFinalizationInFlightRef\.current = true/);
  assert.match(source, /paymentFinalizationInFlightRef\.current = false/);
  assert.match(source, /closedTableOrderIdsRef\.current\.has\(String\(orderId\)\)[\s\S]*?await Promise\.resolve\(onTableOrderSaved/);
});
