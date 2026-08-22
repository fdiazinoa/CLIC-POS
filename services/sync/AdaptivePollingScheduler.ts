import type { RealtimeConnectionState } from './RealtimeNotificationService';

export type AdaptivePollingTimerApi = {
    setTimeout: (callback: () => void, delayMs: number) => unknown;
    clearTimeout: (timerId: unknown) => void;
};

export type AdaptivePollingSchedulerOptions = {
    requestReconciliation: () => Promise<void>;
    isOnline: () => boolean;
    random?: () => number;
    timerApi?: AdaptivePollingTimerApi;
    healthyIntervalMs?: number;
    onError?: (error: unknown) => void;
};

const DEGRADED_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

const defaultTimerApi: AdaptivePollingTimerApi = {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (timerId) => globalThis.clearTimeout(timerId as ReturnType<typeof setTimeout>),
};

export const createAdaptivePollingScheduler = (options: AdaptivePollingSchedulerOptions) => {
    const timerApi = options.timerApi || defaultTimerApi;
    const random = options.random || Math.random;
    const healthyIntervalMs = options.healthyIntervalMs ?? 5 * 60 * 1000;
    let realtimeState: RealtimeConnectionState = 'DISABLED';
    let timerId: unknown = null;
    let stopped = true;
    let degradedAttempt = 0;
    let requestFailureAttempt = 0;

    const nextDelay = (): number => {
        if (realtimeState === 'HEALTHY') return healthyIntervalMs;
        if (realtimeState === 'CONNECTING') return 20_000;
        if (degradedAttempt < DEGRADED_DELAYS_MS.length) {
            return DEGRADED_DELAYS_MS[degradedAttempt++];
        }
        return 60_000 + Math.round(random() * 60_000);
    };

    const schedule = (delayMs = nextDelay()) => {
        if (stopped) return;
        if (timerId !== null) timerApi.clearTimeout(timerId);
        timerId = timerApi.setTimeout(() => {
            timerId = null;
            if (!options.isOnline()) {
                schedule();
                return;
            }
            void options.requestReconciliation().then(() => {
                requestFailureAttempt = 0;
                schedule();
            }, (error) => {
                options.onError?.(error);
                const retryIndex = Math.min(requestFailureAttempt++, DEGRADED_DELAYS_MS.length - 1);
                schedule(DEGRADED_DELAYS_MS[retryIndex]);
            });
        }, delayMs);
    };

    return {
        start(initialState: RealtimeConnectionState) {
            if (!stopped) return;
            stopped = false;
            realtimeState = initialState;
            degradedAttempt = 0;
            requestFailureAttempt = 0;
            schedule();
        },
        stop() {
            stopped = true;
            if (timerId !== null) timerApi.clearTimeout(timerId);
            timerId = null;
        },
        updateRealtimeState(nextState: RealtimeConnectionState) {
            const recovered = realtimeState !== 'HEALTHY' && nextState === 'HEALTHY';
            realtimeState = nextState;
            if (nextState === 'HEALTHY') degradedAttempt = 0;
            if (!stopped) schedule(nextDelay());
            return recovered;
        },
        notifyOnline() {
            degradedAttempt = 0;
            requestFailureAttempt = 0;
            if (!stopped) schedule(nextDelay());
        },
        getState() {
            return { realtimeState, degradedAttempt };
        },
    };
};
