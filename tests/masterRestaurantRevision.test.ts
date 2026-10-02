import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAuthoritativeMasterRestaurantSnapshot,
  mergeKnownMasterRestaurantRevision,
} from '../utils/masterRestaurantRevision';

test('ACK advances known only and an equal-known poll applies the authoritative snapshot once', async () => {
  let knownRevision = 807;
  let appliedRevision = 806;
  let publishes = 0;
  let persists = 0;
  const first = await applyAuthoritativeMasterRestaurantSnapshot({
    revision: 807,
    knownRevision,
    appliedRevision,
    fenced: false,
    snapshot: { table: 'Mesa 2 OCCUPIED' },
    publish: () => { publishes += 1; },
    persist: async () => { persists += 1; },
  });
  knownRevision = first.knownRevision;
  appliedRevision = first.appliedRevision;
  assert.deepEqual(first, { knownRevision: 807, appliedRevision: 807, applied: true });

  const duplicate = await applyAuthoritativeMasterRestaurantSnapshot({
    revision: 807,
    knownRevision,
    appliedRevision,
    fenced: false,
    snapshot: { table: 'Mesa 2 OCCUPIED' },
    publish: () => { publishes += 1; },
    persist: async () => { persists += 1; },
  });
  assert.equal(duplicate.applied, false);
  assert.equal(publishes, 1);
  assert.equal(persists, 1);
});

test('a stale native revision never reverts a newer known state', async () => {
  let published = false;
  const result = await applyAuthoritativeMasterRestaurantSnapshot({
    revision: 806,
    knownRevision: 807,
    appliedRevision: 805,
    fenced: false,
    snapshot: {},
    publish: () => { published = true; },
    persist: async () => undefined,
  });
  assert.deepEqual(result, { knownRevision: 807, appliedRevision: 805, applied: false });
  assert.equal(published, false);
});

test('an active lock or pending Master save fences publication without advancing applied', async () => {
  for (const fence of ['ACTIVE_LOCK', 'PENDING_MASTER_SYNC']) {
    let published = false;
    const result = await applyAuthoritativeMasterRestaurantSnapshot({
      revision: 807,
      knownRevision: 807,
      appliedRevision: 806,
      fenced: Boolean(fence),
      snapshot: {},
      publish: () => { published = true; },
      persist: async () => undefined,
    });
    assert.deepEqual(result, { knownRevision: 807, appliedRevision: 806, applied: false });
    assert.equal(published, false);
  }
});

test('a SQLite failure keeps applied behind so the equal-known snapshot retries idempotently', async () => {
  let publishes = 0;
  await assert.rejects(applyAuthoritativeMasterRestaurantSnapshot({
    revision: 807,
    knownRevision: 807,
    appliedRevision: 806,
    fenced: false,
    snapshot: {},
    publish: () => { publishes += 1; },
    persist: async () => { throw new Error('SQLITE_WRITE_FAILED'); },
  }), /SQLITE_WRITE_FAILED/);

  const retry = await applyAuthoritativeMasterRestaurantSnapshot({
    revision: 807,
    knownRevision: 807,
    appliedRevision: 806,
    fenced: false,
    snapshot: {},
    publish: () => { publishes += 1; },
    persist: async () => undefined,
  });
  assert.equal(retry.appliedRevision, 807);
  assert.equal(publishes, 2);
});

test('completion of an older persistence never lowers a newer known revision', () => {
  const revisionObservedWhilePersistenceWasPending = 809;
  const completedSnapshotRevision = 807;
  assert.equal(
    mergeKnownMasterRestaurantRevision(revisionObservedWhilePersistenceWasPending, completedSnapshotRevision),
    809,
  );
});
