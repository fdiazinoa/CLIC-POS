import assert from 'node:assert/strict';
import test from 'node:test';

test('freeze counters are bounded, aggregate products, and alert only at the rate threshold', async () => {
  (globalThis as any).__POS_DIAGNOSTIC_BUILD__ = true;
  const { freezeCount, freezePhase, freezeSnapshot } = await import('../diagnostics/freezeCounters');

  for (let index = 0; index < 100; index++) freezeCount('CATALOG_APPLY_COUNT', 2430);
  for (let index = 0; index < 300; index++) freezePhase('CATALOG_APPLY_START', 2430);

  const snapshot = freezeSnapshot();
  assert.equal(snapshot.diagnostic, true);
  assert.equal(snapshot.counters.CATALOG_APPLY_COUNT.count, 100);
  assert.equal(snapshot.counters.CATALOG_APPLY_COUNT.processed, 243000);
  assert.equal(snapshot.alerts.length, 1);
  assert.equal(snapshot.alerts[0].name, 'CATALOG_APPLY_COUNT');
  assert.equal(snapshot.timeline.length, 256);
  assert.equal(snapshot.timeline.at(-1)?.products, 2430);
  assert.equal(JSON.stringify(snapshot).includes('productName'), false);
});
