export const POS_SALE_ACTIVITY_EVENT = 'clicpos:sale-activity-changed';

interface PosSaleActivityState {
  active: boolean;
  cartCount: number;
  updatedAt: string;
}

const defaultState: PosSaleActivityState = {
  active: false,
  cartCount: 0,
  updatedAt: new Date(0).toISOString(),
};

let currentState: PosSaleActivityState = defaultState;
let inputHoldUntil = 0;
let inputHoldTimer: number | null = null;

const computeActive = (cartCount: number = currentState.cartCount): boolean =>
  cartCount > 0 || Date.now() < inputHoldUntil;

const publishState = (cartCount: number = currentState.cartCount): void => {
  const nextState: PosSaleActivityState = {
    active: computeActive(cartCount),
    cartCount: Math.max(0, Number(cartCount || 0)),
    updatedAt: new Date().toISOString(),
  };

  if (
    currentState.active === nextState.active &&
    currentState.cartCount === nextState.cartCount
  ) {
    return;
  }

  currentState = nextState;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(POS_SALE_ACTIVITY_EVENT, { detail: currentState }));
  }
};

const scheduleInputHoldRelease = (): void => {
  if (typeof window === 'undefined') return;
  if (inputHoldTimer) {
    window.clearTimeout(inputHoldTimer);
    inputHoldTimer = null;
  }

  const delay = Math.max(0, inputHoldUntil - Date.now() + 25);
  inputHoldTimer = window.setTimeout(() => {
    inputHoldTimer = null;
    publishState();
  }, delay);
};

export const getPosSaleActivity = (): PosSaleActivityState => currentState;

export const isPosSaleActive = (): boolean => computeActive();

export const setPosSaleActivity = (next: { active: boolean; cartCount?: number }): void => {
  const cartCount = next.active ? Math.max(0, Number(next.cartCount || 0)) : 0;
  publishState(cartCount);
};

export const markPosInteractionActivity = (holdMs = 1500): void => {
  if (typeof window === 'undefined') return;
  inputHoldUntil = Math.max(inputHoldUntil, Date.now() + Math.max(250, holdMs));
  publishState();
  scheduleInputHoldRelease();
};
