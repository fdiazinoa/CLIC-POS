export type OperatorUiTransitionToken = number;

type PendingTransition = {
  reason: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

const DEFAULT_MAX_HOLD_MS = 1_500;
const pendingTransitions = new Map<OperatorUiTransitionToken, PendingTransition>();
const idleWaiters = new Set<() => void>();
let sequence = 0;

const flushIdleWaiters = () => {
  if (pendingTransitions.size > 0) return;
  const waiters = Array.from(idleWaiters);
  idleWaiters.clear();
  waiters.forEach(resolve => resolve());
};

/**
 * Briefly protects a latency-sensitive operator transition from new background
 * sync work. The timeout is a fail-safe: a missing frame must never stop sync.
 */
export const beginOperatorUiTransition = (
  reason: string,
  maxHoldMs = DEFAULT_MAX_HOLD_MS,
): OperatorUiTransitionToken => {
  const token = ++sequence;
  const timeoutId = globalThis.setTimeout(() => {
    pendingTransitions.delete(token);
    flushIdleWaiters();
  }, Math.max(0, maxHoldMs));
  pendingTransitions.set(token, { reason, timeoutId });
  return token;
};

export const completeOperatorUiTransition = (token: OperatorUiTransitionToken | null | undefined): void => {
  if (token === null || token === undefined) return;
  const pending = pendingTransitions.get(token);
  if (!pending) return;
  globalThis.clearTimeout(pending.timeoutId);
  pendingTransitions.delete(token);
  flushIdleWaiters();
};

/** Resolves true when work actually had to wait for the operator UI. */
export const waitForOperatorUiTransition = (): Promise<boolean> => {
  if (pendingTransitions.size === 0) return Promise.resolve(false);
  return new Promise(resolve => {
    idleWaiters.add(() => resolve(true));
  });
};

export const getOperatorUiTransitionSnapshot = () => ({
  active: pendingTransitions.size > 0,
  reasons: Array.from(pendingTransitions.values(), transition => transition.reason),
});
