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

export const getPosSaleActivity = (): PosSaleActivityState => currentState;

export const isPosSaleActive = (): boolean => currentState.active;

export const setPosSaleActivity = (next: { active: boolean; cartCount?: number }): void => {
  const nextState: PosSaleActivityState = {
    active: Boolean(next.active),
    cartCount: Math.max(0, Number(next.cartCount || 0)),
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
