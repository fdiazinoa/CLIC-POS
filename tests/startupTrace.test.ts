import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartupTrace, STARTUP_STAGES } from '../utils/startupTrace';

test('release bridge receives only fixed stage names and bounded elapsed milliseconds', () => {
  const received: unknown[][] = [];
  (globalThis as any).window = { ClicPOSAppBridge: { recordStartupStage: (...args: unknown[]) => received.push(args) } };
  try {
    const mark = createStartupTrace();
    for (const stage of STARTUP_STAGES) mark(stage);
    mark('token=secret' as any);
    assert.equal(received.length, STARTUP_STAGES.length);
    received.forEach(([stage, elapsed], i) => {
      assert.equal(stage, STARTUP_STAGES[i]);
      assert.equal(typeof elapsed, 'number');
      assert.ok(Number.isInteger(elapsed) && Number(elapsed) >= 0 && Number(elapsed) <= 300_000);
    });
  } finally { delete (globalThis as any).window; }
});

test('older Android shells, browser and native diagnostic failure cannot break boot', () => {
  const mark = createStartupTrace();
  assert.doesNotThrow(() => mark('STARTED'));
  (globalThis as any).window = {};
  assert.doesNotThrow(() => mark('LOCAL_DATABASE_READY'));
  (globalThis as any).window = { ClicPOSAppBridge: { recordStartupStage: () => { throw new Error('unavailable'); } } };
  try { assert.doesNotThrow(() => mark('READY')); }
  finally { delete (globalThis as any).window; }
});
