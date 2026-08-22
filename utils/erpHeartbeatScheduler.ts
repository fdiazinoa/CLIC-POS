export type ErpHeartbeatFlightRef = {
  current: Promise<void> | null;
};

export type ErpHeartbeatTimerApi = {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (timerId: unknown) => void;
};

export type ErpHeartbeatSchedulerOptions = {
  intervalMs: number;
  getIntervalMs?: () => number;
  getLastAuthenticatedActivityAt?: () => number;
  now?: () => number;
  getJitterMs?: () => number;
  shouldRun?: () => boolean;
  sendHeartbeat: () => Promise<void>;
  onError?: (error: unknown) => void;
  flightRef?: ErpHeartbeatFlightRef;
  timerApi?: ErpHeartbeatTimerApi;
};

export type ErpHeartbeatScheduler = {
  start: (options?: { immediate?: boolean }) => void;
  stop: () => void;
  trigger: () => Promise<void>;
};

const defaultTimerApi: ErpHeartbeatTimerApi = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timerId) => globalThis.clearTimeout(timerId as ReturnType<typeof setTimeout>),
};

export const createErpHeartbeatScheduler = (
  options: ErpHeartbeatSchedulerOptions,
): ErpHeartbeatScheduler => {
  const timerApi = options.timerApi || defaultTimerApi;
  const flightRef = options.flightRef || { current: null };
  const now = options.now || Date.now;
  let timerId: unknown = null;
  let stopped = true;

  const trigger = (): Promise<void> => {
    if (flightRef.current) return flightRef.current;
    if (options.shouldRun && !options.shouldRun()) return Promise.resolve();
    const intervalMs = options.getIntervalMs?.() ?? options.intervalMs;
    const lastActivityAt = options.getLastAuthenticatedActivityAt?.() || 0;
    if (lastActivityAt > 0 && now() - lastActivityAt < intervalMs) return Promise.resolve();

    const operation = Promise.resolve().then(options.sendHeartbeat);
    flightRef.current = operation;

    return operation.finally(() => {
      if (flightRef.current === operation) {
        flightRef.current = null;
      }
    });
  };

  const scheduleNext = () => {
    if (stopped) return;
    if (timerId !== null) timerApi.clearTimeout(timerId);

    const intervalMs = options.getIntervalMs?.() ?? options.intervalMs;
    const lastActivityAt = options.getLastAuthenticatedActivityAt?.() || 0;
    const remainingMs = lastActivityAt > 0
      ? Math.max(1_000, intervalMs - Math.max(0, now() - lastActivityAt))
      : intervalMs;
    const delayMs = remainingMs + Math.max(0, options.getJitterMs?.() || 0);
    timerId = timerApi.setTimeout(() => {
      timerId = null;
      void trigger()
        .catch((error) => options.onError?.(error))
        .finally(scheduleNext);
    }, delayMs);
  };

  const start = (startOptions?: { immediate?: boolean }) => {
    if (!stopped) return;
    stopped = false;
    if (startOptions?.immediate) {
      void trigger()
        .catch((error) => options.onError?.(error))
        .finally(scheduleNext);
      return;
    }
    scheduleNext();
  };

  const stop = () => {
    stopped = true;
    if (timerId !== null) {
      timerApi.clearTimeout(timerId);
      timerId = null;
    }
  };

  return { start, stop, trigger };
};
