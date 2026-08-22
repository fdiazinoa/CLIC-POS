import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdaptivePollingScheduler, type AdaptivePollingTimerApi } from '../services/sync/AdaptivePollingScheduler';

class FakeTimers implements AdaptivePollingTimerApi {
    private now = 0;
    private nextId = 1;
    private tasks = new Map<number, { at: number; callback: () => void }>();
    readonly delays: number[] = [];

    setTimeout = (callback: () => void, delayMs: number): number => {
        const id = this.nextId++;
        this.delays.push(delayMs);
        this.tasks.set(id, { at: this.now + delayMs, callback });
        return id;
    };

    clearTimeout = (timerId: unknown): void => {
        this.tasks.delete(Number(timerId));
    };

    tick(delayMs: number): void {
        const target = this.now + delayMs;
        const due = [...this.tasks.entries()]
            .filter(([, task]) => task.at <= target)
            .sort((left, right) => left[1].at - right[1].at);
        for (const [id, task] of due) {
            this.tasks.delete(id);
            this.now = task.at;
            task.callback();
        }
        this.now = target;
    }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('uses five-minute reconciliation while Realtime is healthy', async () => {
    const timers = new FakeTimers();
    let pulls = 0;
    const scheduler = createAdaptivePollingScheduler({
        timerApi: timers,
        random: () => 0.5,
        isOnline: () => true,
        requestReconciliation: async () => { pulls += 1; },
    });

    scheduler.start('HEALTHY');
    assert.equal(timers.delays.at(-1), 300_000);
    timers.tick(300_000);
    await flush();
    assert.equal(pulls, 1);
    assert.equal(timers.delays.at(-1), 300_000);
    scheduler.stop();
});

test('backs off through 5, 10, 20, 40 and 60 seconds when Realtime is down', async () => {
    const timers = new FakeTimers();
    const scheduler = createAdaptivePollingScheduler({
        timerApi: timers,
        random: () => 0.5,
        isOnline: () => true,
        requestReconciliation: async () => undefined,
    });

    scheduler.start('DISCONNECTED');
    for (const delay of [5_000, 10_000, 20_000, 40_000, 60_000]) {
        assert.equal(timers.delays.at(-1), delay);
        timers.tick(delay);
        await flush();
    }
    assert.equal(timers.delays.at(-1), 90_000);
    scheduler.stop();
});

test('retries a failed healthy reconciliation after five seconds', async () => {
    const timers = new FakeTimers();
    let attempts = 0;
    let errors = 0;
    const scheduler = createAdaptivePollingScheduler({
        timerApi: timers,
        random: () => 0.5,
        isOnline: () => true,
        requestReconciliation: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('temporary');
        },
        onError: () => { errors += 1; },
    });

    scheduler.start('HEALTHY');
    timers.tick(300_000);
    await flush();
    assert.equal(errors, 1);
    assert.equal(timers.delays.at(-1), 5_000);

    timers.tick(5_000);
    await flush();
    assert.equal(attempts, 2);
    assert.equal(timers.delays.at(-1), 300_000);
    scheduler.stop();
});
