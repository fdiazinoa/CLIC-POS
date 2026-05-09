export const POS_SALE_ACTIVITY_EVENT = 'clicpos:sale-activity-changed';

interface PosSaleActivityState {
  active: boolean;
  cartCount: number;
  busyReasons: string[];
  updatedAt: string;
}

const defaultState: PosSaleActivityState = {
  active: false,
  cartCount: 0,
  busyReasons: [],
  updatedAt: new Date(0).toISOString(),
};

let currentState: PosSaleActivityState = defaultState;
let inputHoldUntil = 0;
let activityReleaseTimer: number | null = null;
const busyHoldUntilByReason = new Map<string, number>();

const normalizeReason = (reason: string): string =>
  reason.trim().replace(/\s+/g, '.').slice(0, 80) || 'pos.activity';

const pruneExpiredBusyReasons = (): void => {
  const now = Date.now();
  busyHoldUntilByReason.forEach((expiresAt, reason) => {
    if (expiresAt <= now) {
      busyHoldUntilByReason.delete(reason);
    }
  });
};

const getBusyReasons = (): string[] => {
  pruneExpiredBusyReasons();
  return Array.from(busyHoldUntilByReason.keys()).sort();
};

const computeActive = (cartCount: number = currentState.cartCount): boolean =>
  cartCount > 0 || Date.now() < inputHoldUntil || getBusyReasons().length > 0;

const publishState = (cartCount: number = currentState.cartCount): void => {
  const busyReasons = getBusyReasons();
  const nextState: PosSaleActivityState = {
    cartCount: Math.max(0, Number(cartCount || 0)),
    busyReasons,
    active: computeActive(cartCount),
    updatedAt: new Date().toISOString(),
  };

  if (
    currentState.active === nextState.active &&
    currentState.cartCount === nextState.cartCount &&
    currentState.busyReasons.join('|') === nextState.busyReasons.join('|')
  ) {
    return;
  }

  currentState = nextState;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(POS_SALE_ACTIVITY_EVENT, { detail: currentState }));
  }
};

const scheduleActivityRelease = (): void => {
  if (typeof window === 'undefined') return;
  if (activityReleaseTimer) {
    window.clearTimeout(activityReleaseTimer);
    activityReleaseTimer = null;
  }

  pruneExpiredBusyReasons();
  const activeExpirations = [
    inputHoldUntil,
    ...Array.from(busyHoldUntilByReason.values()),
  ].filter(expiresAt => expiresAt > Date.now());

  if (activeExpirations.length === 0) return;

  const nextExpiration = Math.min(...activeExpirations);
  const delay = Math.max(0, nextExpiration - Date.now() + 25);
  activityReleaseTimer = window.setTimeout(() => {
    activityReleaseTimer = null;
    publishState();
    scheduleActivityRelease();
  }, delay);
};

export const getPosSaleActivity = (): PosSaleActivityState => currentState;

export const isPosSaleActive = (): boolean => computeActive();

export const isPOSBusy = (): boolean => computeActive();

export const setPosSaleActivity = (next: { active: boolean; cartCount?: number }): void => {
  const cartCount = next.active ? Math.max(0, Number(next.cartCount || 0)) : 0;
  publishState(cartCount);
  scheduleActivityRelease();
};

export const markPOSBusy = (reason = 'pos.activity', holdMs = 2000): void => {
  if (typeof window === 'undefined') return;
  const normalizedReason = normalizeReason(reason);
  const expiresAt = Date.now() + Math.max(250, holdMs);
  busyHoldUntilByReason.set(
    normalizedReason,
    Math.max(busyHoldUntilByReason.get(normalizedReason) || 0, expiresAt)
  );
  publishState();
  scheduleActivityRelease();
};

export const markPOSIdle = (reason?: string): void => {
  if (typeof window === 'undefined') return;
  if (reason) {
    busyHoldUntilByReason.delete(normalizeReason(reason));
  } else {
    busyHoldUntilByReason.clear();
  }
  publishState();
  scheduleActivityRelease();
};

export const markPosInteractionActivity = (holdMs = 1500): void => {
  if (typeof window === 'undefined') return;
  inputHoldUntil = Math.max(inputHoldUntil, Date.now() + Math.max(250, holdMs));
  markPOSBusy('pos.input', holdMs);
  publishState();
  scheduleActivityRelease();
};
