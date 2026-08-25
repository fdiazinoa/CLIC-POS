import type { Transaction } from '../types';

type ReceiptCouponTransaction = Pick<Transaction, 'couponCode' | 'coupons'> & {
  coupon_code?: string;
};

export const resolveReceiptCouponCodes = (
  transaction: ReceiptCouponTransaction
): string[] => {
  const candidates = [
    transaction.couponCode,
    transaction.coupon_code,
    ...(Array.isArray(transaction.coupons)
      ? transaction.coupons.map(coupon => coupon?.code)
      : []),
  ];
  const seen = new Set<string>();

  return candidates.reduce<string[]>((codes, candidate) => {
    const code = String(candidate || '').trim();
    const normalized = code.toUpperCase();
    if (!code || seen.has(normalized)) return codes;

    seen.add(normalized);
    codes.push(code);
    return codes;
  }, []);
};

