import assert from 'node:assert/strict';
import test from 'node:test';

import { syncMetrics } from '../services/sync/SyncMetrics';

test('sync metrics remain local and expose counters, pending hints and lifecycle timestamps', () => {
    const storage = new Map<string, string>();
    const previousLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        },
    });

    try {
        syncMetrics.increment('polls_total');
        syncMetrics.increment('pulls_total');
        syncMetrics.increment('heartbeat_total');
        syncMetrics.increment('heartbeat_suppressed_total');
        syncMetrics.setRealtimeState('HEALTHY');
        syncMetrics.setPendingHints(3);
        syncMetrics.markHintReceived('2026-08-22T12:00:00.000Z');
        syncMetrics.markPullStarted('2026-08-22T12:00:01.000Z');
        syncMetrics.markPullFinished('2026-08-22T12:00:02.000Z');
        syncMetrics.markApplyFinished('2026-08-22T12:00:03.000Z');
        syncMetrics.markAckFinished('2026-08-22T12:00:04.000Z');

        const snapshot = syncMetrics.getSnapshot();
        assert.equal(snapshot.counters.polls_total, 1);
        assert.equal(snapshot.counters.pulls_total, 1);
        assert.equal(snapshot.counters.heartbeat_total, 1);
        assert.equal(snapshot.counters.heartbeat_suppressed_total, 1);
        assert.equal(snapshot.realtime_state, 'HEALTHY');
        assert.equal(snapshot.pending_hints_count, 3);
        assert.equal(snapshot.hint_received_at, '2026-08-22T12:00:00.000Z');
        assert.equal(snapshot.ack_finished_at, '2026-08-22T12:00:04.000Z');
        assert.equal(storage.size, 1);
    } finally {
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: previousLocalStorage,
        });
    }
});
