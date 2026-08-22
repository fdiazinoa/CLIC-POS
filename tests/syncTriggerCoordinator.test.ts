import assert from 'node:assert/strict';
import test from 'node:test';

import { SyncTriggerCoordinator, type SyncExecution } from '../services/sync/SyncTriggerCoordinator';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('binds timer callbacks to the browser global object', async () => {
    const strictSetTimeout = function (
        this: typeof globalThis,
        callback: TimerHandler,
        delay?: number,
        ...args: any[]
    ): number {
        assert.equal(this, globalThis);
        return globalThis.setTimeout(callback, delay, ...args);
    } as typeof setTimeout;
    const strictClearTimeout = function (this: typeof globalThis, timer?: number): void {
        assert.equal(this, globalThis);
        globalThis.clearTimeout(timer);
    } as typeof clearTimeout;
    const coordinator = new SyncTriggerCoordinator({
        debounceMs: 0,
        setTimeoutFn: strictSetTimeout,
        clearTimeoutFn: strictClearTimeout,
    });

    coordinator.configure(async () => undefined);
    await coordinator.request({ reason: 'STARTUP' });
    coordinator.clear();
});

test('coalesces triggers received during a running sync into one follow-up', async () => {
    const coordinator = new SyncTriggerCoordinator({ debounceMs: 0 });
    const executions: SyncExecution[] = [];
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });

    coordinator.configure(async (execution) => {
        executions.push(execution);
        if (executions.length === 1) {
            markStarted();
            await firstPending;
        }
    });

    const first = coordinator.request({ reason: 'STARTUP' });
    await firstStarted;
    const hints = [
        coordinator.request({ reason: 'REALTIME_HINT', domainVersions: { catalog: 2 } }),
        coordinator.request({ reason: 'REALTIME_HINT', domainVersions: { catalog: 7, prices: 3 } }),
        coordinator.request({ reason: 'RECONCILIATION' }),
    ];
    releaseFirst();
    await Promise.all([first, ...hints]);

    assert.equal(executions.length, 2);
    assert.deepEqual(new Set(executions[1].reasons), new Set(['REALTIME_HINT', 'RECONCILIATION']));
    assert.deepEqual(executions[1].domainVersions, { catalog: 7, prices: 3 });
    coordinator.clear();
});
test('debounces a realtime burst before starting work', async () => {
    const coordinator = new SyncTriggerCoordinator({ debounceMs: 10 });
    let executions = 0;
    coordinator.configure(async () => { executions += 1; });

    const requests = [
        coordinator.request({ reason: 'REALTIME_HINT' }),
        coordinator.request({ reason: 'REALTIME_HINT' }),
        coordinator.request({ reason: 'REALTIME_HINT' }),
    ];
    await flush();
    assert.equal(executions, 0);
    await Promise.all(requests);
    assert.equal(executions, 1);
    coordinator.clear();
});

test('100 simultaneous hints during one active pull produce one consolidated follow-up', async () => {
    const coordinator = new SyncTriggerCoordinator({ debounceMs: 0 });
    const executions: SyncExecution[] = [];
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });

    coordinator.configure(async (execution) => {
        executions.push(execution);
        if (executions.length === 1) {
            markStarted();
            await firstPending;
        }
    });

    const first = coordinator.request({ reason: 'STARTUP' });
    await firstStarted;
    const hints = Array.from({ length: 100 }, (_, index) => coordinator.request({
        reason: 'REALTIME_HINT',
        domainVersions: { catalog: index + 1, prices: index % 9 },
        collections: [index % 2 === 0 ? 'products' : 'productPrices'],
    }));

    assert.equal(coordinator.getSnapshot().pendingHintCount, 100);
    releaseFirst();
    await Promise.all([first, ...hints]);

    assert.equal(executions.length, 2);
    assert.equal(executions[1].pendingHintCount, 100);
    assert.deepEqual(executions[1].domainVersions, { catalog: 100, prices: 8 });
    assert.deepEqual(new Set(executions[1].collections), new Set(['products', 'productPrices']));
    coordinator.clear();
});
