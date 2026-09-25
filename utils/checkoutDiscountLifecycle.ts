export type CheckoutDiscount = { type: 'PERCENT' | 'FIXED'; value: number };

/** Call only after the full invoice has committed and its cart is being cleared. */
export const resetCompletedSaleDiscount = (setDiscount: (discount: CheckoutDiscount) => void): void => {
  setDiscount({ type: 'PERCENT', value: 0 });
};
