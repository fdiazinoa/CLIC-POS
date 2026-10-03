import assert from 'node:assert/strict';
import test from 'node:test';
import { RestaurantPersistenceQueue } from '../utils/restaurantPersistenceQueue';

test('a delayed scoped close cannot overwrite a newer authoritative snapshot', async () => {
  const queue = new RestaurantPersistenceQueue();
  let releaseOldWrite!: () => void;
  let storedOrder = 'initial-order';
  const oldWriteStarted = new Promise<void>(resolve => {
    void queue.run(async () => {
      resolve();
      await new Promise<void>(release => { releaseOldWrite = release; });
      storedOrder = 'closed-order';
    });
  });
  await oldWriteStarted;

  let authoritativeWriteStarted = false;
  const authoritativeWrite = queue.run(async () => {
    authoritativeWriteStarted = true;
    storedOrder = 'new-authoritative-order';
  });
  await Promise.resolve();
  assert.equal(authoritativeWriteStarted, false);

  releaseOldWrite();
  await authoritativeWrite;
  assert.equal(storedOrder, 'new-authoritative-order');
});

test('a delayed scoped Mesa 1 save completes before a newer Mesa 2 snapshot', async () => {
  const queue = new RestaurantPersistenceQueue();
  const persisted: string[] = [];
  let releaseMesa1!: () => void;
  const mesa1Started = new Promise<void>(resolve => {
    void queue.run(async () => {
      resolve();
      await new Promise<void>(release => { releaseMesa1 = release; });
      persisted.push('mesa-1-scoped');
    });
  });
  await mesa1Started;
  const snapshotWrite = queue.run(async () => {
    persisted.push('mesa-2-authoritative-snapshot');
  });
  await Promise.resolve();
  assert.deepEqual(persisted, []);
  releaseMesa1();
  await snapshotWrite;
  assert.deepEqual(persisted, ['mesa-1-scoped', 'mesa-2-authoritative-snapshot']);
});
