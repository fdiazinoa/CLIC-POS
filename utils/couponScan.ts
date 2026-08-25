type CouponCodeSource = {
  code?: unknown;
};

const COUPON_CODE_PATTERN = /^CUPON-[A-Z0-9]+(?:-[A-Z0-9]+)+$/;

export const resolveScannedCouponCode = (
  rawCode: string,
  coupons: CouponCodeSource[] | null | undefined,
): string | null => {
  const normalizedCode = rawCode.trim().toUpperCase();
  if (!normalizedCode) return null;

  const matchesSyncedCoupon = (coupons || []).some((coupon) =>
    typeof coupon?.code === 'string' && coupon.code.trim().toUpperCase() === normalizedCode
  );

  return matchesSyncedCoupon || COUPON_CODE_PATTERN.test(normalizedCode)
    ? normalizedCode
    : null;
};
