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
