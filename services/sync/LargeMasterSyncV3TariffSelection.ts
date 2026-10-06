export interface V3TariffContext {
  terminalId: string;
  warehouseId: string;
  defaultTariffId: string;
  allowedTariffIds: string[];
}
export interface V3TariffSelection extends V3TariffContext { tariffId: string; mode: 'manual' | 'default' }

export const v3TariffContextKey = (context: V3TariffContext): string => JSON.stringify([
  context.terminalId, context.warehouseId, context.defaultTariffId, [...context.allowedTariffIds].sort(),
]);

/** Reconcile authority, never amounts or cart lines. An active cart is immutable. */
export const reconcileV3TariffSelection = (
  previous: V3TariffSelection | undefined, current: V3TariffContext, hasCart: boolean,
): V3TariffSelection => {
  if (!current.defaultTariffId || !current.allowedTariffIds.length
    || !current.allowedTariffIds.includes(current.defaultTariffId)) throw new Error('SYNC_V3_TERMINAL_PRICING_INVALID');
  const changed = previous && v3TariffContextKey(previous) !== v3TariffContextKey(current);
  if (hasCart && changed) throw new Error('SYNC_V3_CART_CONTEXT_CHANGED');
  const keepSelection = previous && previous.terminalId === current.terminalId
    && previous.warehouseId === current.warehouseId && current.allowedTariffIds.includes(previous.tariffId)
    && (previous.defaultTariffId === current.defaultTariffId || previous.mode === 'manual');
  return { ...current, tariffId: keepSelection ? previous.tariffId : current.defaultTariffId,
    mode: keepSelection ? previous.mode : 'default' };
};

export const isV3TariffContextCurrent = (expectedKey: string, latestKey: string, sequence: number, latestSequence: number): boolean =>
  expectedKey === latestKey && sequence === latestSequence;
