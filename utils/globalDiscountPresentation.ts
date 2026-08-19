export interface GlobalDiscountPresentationInput {
  discountAmount: number;
  subtotalBeforeDiscount: number;
  discountType?: 'PERCENT' | 'FIXED';
  discountValue?: number;
  baseLabel?: string;
}

const formatPercentage = (value: number): string => (
  Number(value.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 })
);

export const resolveGlobalDiscountPercentage = ({
  discountAmount,
  subtotalBeforeDiscount,
  discountType,
  discountValue,
}: GlobalDiscountPresentationInput): number | null => {
  const configuredPercentage = Number(discountValue);
  if (discountType === 'PERCENT' && Number.isFinite(configuredPercentage) && configuredPercentage > 0) {
    return Math.min(100, configuredPercentage);
  }

  const amount = Math.max(0, Number(discountAmount) || 0);
  const subtotal = Math.max(0, Number(subtotalBeforeDiscount) || 0);
  if (amount <= 0 || subtotal <= 0) return null;
  return Math.min(100, (amount / subtotal) * 100);
};

export const resolveGlobalDiscountLabel = (input: GlobalDiscountPresentationInput): string => {
  const percentage = resolveGlobalDiscountPercentage(input);
  const baseLabel = input.baseLabel || 'DESCUENTO';
  return percentage === null ? baseLabel : `${baseLabel} (${formatPercentage(percentage)}%)`;
};
