import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createErpHeartbeatScheduler,
  type ErpHeartbeatTimerApi,
} from '../utils/erpHeartbeatScheduler';

class FakeTimers implements ErpHeartbeatTimerApi {
  private now = 0;
  private nextId = 1;
  private tasks = new Map<number, { at: number; callback: () => void }>();
  readonly scheduledDelays: number[] = [];

  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.scheduledDelays.push(delayMs);
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  };

  clearTimeout = (timerId: unknown): void => {
    this.tasks.delete(Number(timerId));
  };

  tick(delayMs: number): void {
    const target = this.now + delayMs;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      this.now = next[1].at;
      this.tasks.delete(next[0]);
      next[1].callback();
    }
    this.now = target;
  }

  get pendingCount(): number {
    return this.tasks.size;
  }
}

const flushPromises = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

test('pairing puede emitir heartbeat inmediato y luego pulsos cada 63 segundos', async () => {
  const timers = new FakeTimers();
  let heartbeats = 0;
  const scheduler = createErpHeartbeatScheduler({
    intervalMs: 60_000,
    getJitterMs: () => 3_000,
    timerApi: timers,
    sendHeartbeat: async () => { heartbeats += 1; },
  });

  scheduler.start({ immediate: true });
  await flushPromises();
  assert.equal(heartbeats, 1);
  assert.equal(timers.scheduledDelays.at(-1), 63_000);

  timers.tick(63_000);
  await flushPromises();
  assert.equal(heartbeats, 2);

  timers.tick(63_000);
  await flushPromises();
  assert.equal(heartbeats, 3);
  scheduler.stop();
});

test('outbox y manifest pendientes no participan en el bloqueo del heartbeat', async () => {
  const timers = new FakeTimers();
  let heartbeats = 0;
  const never = new Promise<void>(() => {});
  void never; // Simula bootstrap/outbox/manifest independientes que nunca resuelven.

  const scheduler = createErpHeartbeatScheduler({
    intervalMs: 60_000,
    timerApi: timers,
    sendHeartbeat: async () => { heartbeats += 1; },
  });
  scheduler.start();

  timers.tick(60_000);
  await flushPromises();
  timers.tick(60_000);
  await flushPromises();
  assert.equal(heartbeats, 2);
  scheduler.stop();
});

test('un cambio de render detiene el timer anterior y el nuevo scheduler continúa', async () => {
  const firstTimers = new FakeTimers();
  const secondTimers = new FakeTimers();
  const sharedFlightRef = { current: null as Promise<void> | null };
  let heartbeats = 0;
  const sendHeartbeat = async () => { heartbeats += 1; };

  const first = createErpHeartbeatScheduler({
    intervalMs: 60_000,
    timerApi: firstTimers,
    flightRef: sharedFlightRef,
    sendHeartbeat,
  });
  first.start();
  first.stop();
  assert.equal(firstTimers.pendingCount, 0);

  const second = createErpHeartbeatScheduler({
    intervalMs: 60_000,
    timerApi: secondTimers,
    flightRef: sharedFlightRef,
    sendHeartbeat,
  });
  second.start();
  secondTimers.tick(60_000);
  await flushPromises();

  assert.equal(heartbeats, 1);
  second.stop();
});

test('el bloqueo dedicado evita dos heartbeats simultáneos', async () => {
  let heartbeats = 0;
  let releaseHeartbeat!: () => void;
  const pendingHeartbeat = new Promise<void>((resolve) => { releaseHeartbeat = resolve; });
  const scheduler = createErpHeartbeatScheduler({
    intervalMs: 60_000,
    sendHeartbeat: async () => {
      heartbeats += 1;
      await pendingHeartbeat;
    },
  });

  const first = scheduler.trigger();
  const second = scheduler.trigger();
  await flushPromises();
  assert.equal(heartbeats, 1);

  releaseHeartbeat();
  await Promise.all([first, second]);
});

test('un heartbeat fallido agenda el siguiente intervalo desde finally', async () => {
  const timers = new FakeTimers();
  let attempts = 0;
  let failures = 0;
  const scheduler = createErpHeartbeatScheduler({
    intervalMs: 60_000,
    timerApi: timers,
    sendHeartbeat: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('network unavailable');
    },
    onError: () => { failures += 1; },
  });

  scheduler.start({ immediate: true });
  await flushPromises();
  assert.equal(attempts, 1);
  assert.equal(failures, 1);
  assert.equal(timers.pendingCount, 1);

  timers.tick(60_000);
  await flushPromises();
  assert.equal(attempts, 2);
  scheduler.stop();
});
