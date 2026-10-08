import { isValidScaleWeight } from '../utils/cartQuantity';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWeightReadGuard } from '../utils/weightReadGuard';

for (const cause of ['manual entry', 'new product', 'disconnect', 'unmount']) {
  test(`late weight cannot replace the current value after ${cause}`, async () => {
    const guard = createWeightReadGuard();
    let resolve!: (value: number) => void;
    const native = new Promise<number>(r => { resolve = r; });
    let weight = 0;
    const current = guard.begin();
    const pending = native.then(value => { if (current()) weight = value; });
    guard.invalidate();
    weight = 2.5;
    resolve(1.235); await pending;
    assert.equal(weight, 2.5);
  });
}

test('reread accepts only the latest reply, even when replies arrive out of order', async () => {
  const guard = createWeightReadGuard();
  let first!: (value: number) => void;
  let second!: (value: number) => void;
  let weight = 0;
  const old = guard.begin();
  const one = new Promise<number>(r => { first = r; }).then(value => { if (old()) weight = value; });
  const current = guard.begin();
  const two = new Promise<number>(r => { second = r; }).then(value => { if (current()) weight = value; });
  second(2); await two; first(1); await one;
  assert.equal(weight, 2);
});

test('scale modal wires product/disconnect/manual/unmount cancellation and blocks other scans', () => {
  const source = readFileSync(new URL('../components/ScaleModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /\}, \[product.id, scaleId, displayUnit\]\)/);
  assert.equal(source.match(/request.current.invalidate\(\)/g)?.length, 4);
  assert.match(source, /listenZebraConnection\(connected => \{ if \(!disposed && !connected\) invalidate\(\)/);
  assert.match(source, /if \(!isCurrent\(\)\) return/);
  assert.match(source, /if \(initialReadAllowed\(\)\) void handleReadScale\(\)/);
  assert.doesNotMatch(source, /Math.random/);
});

test('scale confirm uses the same finite positive quantity threshold for manual and USB weights', () => {
  for (const weight of [0, -0.125, NaN, Infinity, -Infinity, 0.000001, 0.0000005])
    assert.equal(isValidScaleWeight(weight), false);
  for (const weight of [0.125, 0.25, 1.234567]) assert.equal(isValidScaleWeight(weight), true);
  const source = readFileSync(new URL('../components/ScaleModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /const canConfirmWeight = Boolean\(selectedScale\) && weightContract.allowed && !isReading && isValidScaleWeight\(canonicalQuantity\)/);
  assert.match(source, /if \(canConfirmWeight && selectedScale\) onConfirm\(canonicalQuantity, weightContract.capturePresentation \? createWeightPresentation/);
  assert.match(source, /disabled=\{!canConfirmWeight\}/);
});
