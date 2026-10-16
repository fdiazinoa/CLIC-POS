import type { FiscalStatusReconciler } from './FiscalStatusReconciler';

export const FISCAL_STATUS_INTERVAL_MS = 60_000;
type Timer = ReturnType<typeof setTimeout> | number;

/** One bounded GET-only continuation, attached only after both collections hydrate. */
export function attachFiscalStatusLifecycle(worker: Pick<FiscalStatusReconciler, 'runAutomatic' | 'dispose'>, options: {
  hydrated: boolean;
  online: () => boolean;
  addOnline: (listener: () => void) => void;
  removeOnline: (listener: () => void) => void;
  addTransactionsUpdated?: (listener: () => void) => void;
  removeTransactionsUpdated?: (listener: () => void) => void;
  syncTime: string | null;
  subscribe: (listener: (state: { lastSyncTime: string | null; isSyncing: boolean; hasError: boolean }) => void) => () => void;
  setTimer?: (listener: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}): () => void {
  if (!options.hydrated) return () => {};
  let disposed = false, running = false, last = options.syncTime;
  let timer: Timer | undefined;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const cancelTimer = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };
  const schedule = () => {
    if (!disposed && timer === undefined) timer = setTimer(() => {
      timer = undefined;
      run();
    }, FISCAL_STATUS_INTERVAL_MS);
  };
  const run = () => {
    // Online, persistence and sync notifications may arrive together. Neither
    // overlap a batch nor queue unbounded work behind a slow status request.
    if (disposed || running) return;
    cancelTimer();
    if (!options.online()) { schedule(); return; }
    running = true;
    void (async () => {
      try { await worker.runAutomatic(); }
      catch { /* Retain pending evidence; the next bounded pass can consult it. */ }
      finally { running = false; schedule(); }
    })();
  };
  options.addOnline(run);
  options.addTransactionsUpdated?.(run);
  const unsubscribe = options.subscribe(state => {
    if (state.lastSyncTime && state.lastSyncTime !== last && !state.isSyncing && !state.hasError) {
      last = state.lastSyncTime;
      run();
    }
  });
  run();
  return () => {
    disposed = true;
    cancelTimer();
    options.removeOnline(run);
    options.removeTransactionsUpdated?.(run);
    unsubscribe();
    worker.dispose();
  };
}
