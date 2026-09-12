export const normalizeProductTaxRate = (value: unknown): number => {
  const rate = Math.max(0, Number(value) || 0);
  return rate > 1 ? rate / 100 : rate;
};

export const resolveProductSummaryStock = (
  warehouseBalances: Array<number | null | undefined>,
  fallbackStock: unknown,
): number => {
  const resolvedBalances = warehouseBalances.filter(
    (balance): balance is number => typeof balance === 'number' && Number.isFinite(balance),
  );

  return resolvedBalances.length > 0
    ? resolvedBalances.reduce((total, balance) => total + balance, 0)
    : Number(fallbackStock || 0);
};
