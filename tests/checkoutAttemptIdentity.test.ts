import test from 'node:test';
import assert from 'node:assert/strict';
import { stableCheckoutAttemptId } from '../utils/checkoutAttemptIdentity';

const install = () => {
  const values = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => values.has(key) ? values.get(key)! : null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(), key: () => null, get length() { return values.size; },
  };
  return values;
};

test('the same cart keeps its attempt id across restarts', () => {
  install();
  const first = stableCheckoutAttemptId('cart-A', () => 'id-1');
  assert.equal(first, 'id-1');
  assert.equal(stableCheckoutAttemptId('cart-A', () => 'id-2'), 'id-1', 'a restart resumes the same identity');
});

test('a different cart gets its own identity and the map stays bounded', () => {
  const values = install();
  stableCheckoutAttemptId('cart-A', () => 'a');
  assert.equal(stableCheckoutAttemptId('cart-B', () => 'b'), 'b');
  for (let index = 0; index < 40; index++) stableCheckoutAttemptId(`bulk-${index}`, () => `id-${index}`);
  const stored = JSON.parse(values.get('clic_checkout_attempt_ids_v1')!);
  assert.ok(Object.keys(stored).length <= 20);
});

test('an empty cart key never persists and always generates a fresh id', () => {
  install();
  assert.equal(stableCheckoutAttemptId('', () => 'x'), 'x');
  assert.equal(stableCheckoutAttemptId('   ', () => 'y'), 'y');
});
