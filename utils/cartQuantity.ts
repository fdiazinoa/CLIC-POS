const QUANTITY_EPSILON = 0.000001;

export const isValidCartQuantity = (quantity: unknown): boolean => {
  const parsed = Number(quantity);
  return Number.isFinite(parsed) && Math.abs(parsed) > QUANTITY_EPSILON;
};

/** A sales line and a return line must never cross zero through quantity editing. */
export const isValidCartQuantityTransition = (currentQuantity: unknown, nextQuantity: unknown): boolean => {
  const current = Number(currentQuantity);
  const next = Number(nextQuantity);
  if (!isValidCartQuantity(current) || !isValidCartQuantity(next)) return false;
  return Math.sign(current) === Math.sign(next);
};

export const canStepCartQuantity = (quantity: unknown, delta: number): boolean => {
  const current = Number(quantity);
  return isValidCartQuantityTransition(current, current + delta);
};
