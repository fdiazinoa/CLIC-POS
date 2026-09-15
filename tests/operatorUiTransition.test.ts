import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginOperatorUiTransition,
  completeOperatorUiTransition,
  getOperatorUiTransitionSnapshot,
  waitForOperatorUiTransition,
} from '../utils/operatorUiTransition';

test('background work waits until every active operator transition completes', async () => {
  const first = beginOperatorUiTransition('first', 1_000);
  const second = beginOperatorUiTransition('second', 1_000);
  let resolved = false;
  const waiting = waitForOperatorUiTransition().then(deferred => {
    resolved = true;
    return deferred;
  });

  completeOperatorUiTransition(first);
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.deepEqual(getOperatorUiTransitionSnapshot(), { active: true, reasons: ['second'] });

  completeOperatorUiTransition(second);
  assert.equal(await waiting, true);
  assert.equal(getOperatorUiTransitionSnapshot().active, false);
});

test('background work proceeds immediately outside an operator transition', async () => {
  assert.equal(await waitForOperatorUiTransition(), false);
});

test('transition timeout prevents a missing frame from stopping sync indefinitely', async () => {
  beginOperatorUiTransition('missing-frame', 5);
  assert.equal(await waitForOperatorUiTransition(), true);
  assert.equal(getOperatorUiTransitionSnapshot().active, false);
});
