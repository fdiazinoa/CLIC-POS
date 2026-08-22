export type SyncMetricCounter =
    | 'polls_total'
    | 'heartbeat_total'
    | 'realtime_reconnects'
    | 'retry_count';

export type SyncMetricsSnapshot = {
    counters: Record<SyncMetricCounter, number>;
    realtime_state: string;
    outbox_pending_count: number;
    outbox_oldest_age: number;
    last_successful_sync: string | null;
    last_erp_applied: string | null;
    batch_size: number;
    updated_at: string;
};

const STORAGE_KEY = 'clic_pos_sync_metrics_v1';

const createEmpty = (): SyncMetricsSnapshot => ({
    counters: {
        polls_total: 0,
        heartbeat_total: 0,
        realtime_reconnects: 0,
        retry_count: 0,
    },
    realtime_state: 'DISABLED',
    outbox_pending_count: 0,
    outbox_oldest_age: 0,
    last_successful_sync: null,
    last_erp_applied: null,
    batch_size: 0,
    updated_at: new Date(0).toISOString(),
});

const read = (): SyncMetricsSnapshot => {
    if (typeof localStorage === 'undefined') return createEmpty();
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<SyncMetricsSnapshot> | null;
        const empty = createEmpty();
        return parsed ? {
            ...empty,
            ...parsed,
            counters: { ...empty.counters, ...(parsed.counters || {}) },
        } : empty;
    } catch {
        return createEmpty();
    }
};

const write = (snapshot: SyncMetricsSnapshot): void => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...snapshot,
        updated_at: new Date().toISOString(),
    }));
};

export const syncMetrics = {
    increment(counter: SyncMetricCounter, amount = 1): void {
        const snapshot = read();
        snapshot.counters[counter] = Math.max(0, snapshot.counters[counter] + amount);
        write(snapshot);
    },
    setRealtimeState(state: string): void {
        const snapshot = read();
        snapshot.realtime_state = state;
        write(snapshot);
    },
    markSuccessfulSync(at = new Date().toISOString()): void {
        const snapshot = read();
        snapshot.last_successful_sync = at;
        write(snapshot);
    },
    setOutboxState(pendingCount: number, oldestCreatedAt: number | null): void {
        const snapshot = read();
        snapshot.outbox_pending_count = Math.max(0, pendingCount);
        snapshot.outbox_oldest_age = oldestCreatedAt
            ? Math.max(0, Date.now() - oldestCreatedAt)
            : 0;
        write(snapshot);
    },
    markErpApplied(at = new Date().toISOString()): void {
        const snapshot = read();
        snapshot.last_erp_applied = at;
        snapshot.batch_size = 1;
        write(snapshot);
    },
    getSnapshot: read,
};
