interface DiscountableLine {
  price?: number;
  originalPrice?: number;
  quantity?: number;
}

export interface LineDiscountPresentation {
  hasDiscount: boolean;
  originalUnitPrice: number;
  finalUnitPrice: number;
  originalLineTotal: number;
  finalLineTotal: number;
  discountAmount: number;
  discountPercentage: number;
  discountPercentageLabel: string;
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const formatLineDiscountPercentage = (percentage: number): string => {
  const rounded = Math.round((Number(percentage || 0) + Number.EPSILON) * 100) / 100;
  return `${rounded.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`;
};

export const resolveLineDiscountPresentation = (item: DiscountableLine): LineDiscountPresentation => {
  const finalUnitPrice = Math.max(0, Number(item.price || 0));
  const originalUnitPrice = Math.max(finalUnitPrice, Number(item.originalPrice || finalUnitPrice));
  const quantity = Math.max(0, Number(item.quantity || 0));
  const discountPerUnit = Math.max(0, originalUnitPrice - finalUnitPrice);
  const discountAmount = round2(discountPerUnit * quantity);
  const discountPercentage = originalUnitPrice > 0
    ? (discountPerUnit / originalUnitPrice) * 100
    : 0;

  return {
    hasDiscount: discountAmount > 0,
    originalUnitPrice,
    finalUnitPrice,
    originalLineTotal: round2(originalUnitPrice * quantity),
    finalLineTotal: round2(finalUnitPrice * quantity),
    discountAmount,
    discountPercentage,
    discountPercentageLabel: formatLineDiscountPercentage(discountPercentage),
  };
};
