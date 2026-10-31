import test from 'node:test';
import assert from 'node:assert/strict';
import { clearCheckoutTrace, readCheckoutTrace, recordCheckoutTrace } from '../services/audit/CheckoutTrace';
import { readFileSync } from 'node:fs';

const install = () => {
  const values = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => values.has(key) ? values.get(key)! : null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(), key: () => null, get length() { return values.size; },
  };
};

test('every automatic reconciliation leaves a readable trace, newest first', () => {
  install();
  recordCheckoutTrace('WAREHOUSE_ALIGNED', 'Almacén A01');
  recordCheckoutTrace('ATTEMPT_RELEASED', 'intento descartado');
  const rows = readCheckoutTrace();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'ATTEMPT_RELEASED', 'newest first');
  assert.equal(rows[0].severity, 'INFO');
});

test('a hold is warned, empty details are ignored and the trace is bounded', () => {
  install();
  recordCheckoutTrace('ATTEMPT_HELD', 'requiere ERP');
  assert.equal(readCheckoutTrace()[0].severity, 'WARNING');
  recordCheckoutTrace('CART_REANCHORED', '   ');
  assert.equal(readCheckoutTrace().length, 1);
  for (let index = 0; index < 260; index++) recordCheckoutTrace('CART_REANCHORED', `linea ${index}`);
  assert.ok(readCheckoutTrace().length <= 200);
});

test('the audit screen reads the real trace and can clear it', () => {
  install();
  recordCheckoutTrace('AMOUNT_CHANGED', 'total distinto');
  clearCheckoutTrace();
  assert.deepEqual(readCheckoutTrace(), []);
  const source = readFileSync(new URL('../components/ActivityLog.tsx', import.meta.url), 'utf8');
  assert.match(source, /readCheckoutTrace\(\)/);
  assert.match(source, /clearCheckoutTrace\(\)/);
  assert.doesNotMatch(source, /GENERATE_LOGS/);
});
