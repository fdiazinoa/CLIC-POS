import type { ProductVariant } from '../types';

const toFinitePrice = (value: unknown): number | null => {
  const price = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
};

export const resolveVariantSalesPrice = (
  variant: ProductVariant | null | undefined,
  productSalesPrice: unknown,
): number => {
  const variantPrice = toFinitePrice(variant?.price);
  if (variantPrice !== null && variantPrice > 0) return variantPrice;

  return toFinitePrice(productSalesPrice) ?? 0;
};
