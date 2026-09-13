import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(testDir, '../components/POSInterface.tsx'), 'utf8');

test('todas las rutas que reconstruyen la cuenta conservan un plan de cuotas vigente', () => {
  const expected = 'paymentFraction: retainCurrentPaymentFractionPlan(';
  const occurrences = source.split(expected).length - 1;

  assert.equal(occurrences, 3);
  assert.match(source, /existing\?\.paymentFraction, cartTotal/);
  assert.match(source, /existingParked\?\.paymentFraction, resolvedTicketTotal/);
  assert.match(source, /existingParked\?\.paymentFraction, cartTotal/);
});
