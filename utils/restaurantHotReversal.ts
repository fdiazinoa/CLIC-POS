export type RestaurantDraftLine = {
  quantity?: number;
  dispatched?: boolean;
  subtotalizedAt?: string;
  restaurantCommittedAt?: string;
  kdsStatus?: string;
  kdsOrderId?: string;
  kdsAreaId?: string;
  kdsItemIds?: string[];
  kdsReturnedAt?: string;
};

const COMMITTED_KDS_STATUSES = new Set([
  'ENVIADO',
  'PENDIENTE',
  'PENDING',
  'RETRY_PENDING',
  'DEVUELTO',
  'RETURN_PENDING',
]);

export const hasKitchenDispatchEvidence = (item?: RestaurantDraftLine | null): boolean => {
  if (!item) return false;
  const status = String(item.kdsStatus || '').trim().toUpperCase();

  return Boolean(
    item.dispatched
    || item.kdsOrderId
    || item.kdsAreaId
    || (Array.isArray(item.kdsItemIds) && item.kdsItemIds.length > 0)
    || item.kdsReturnedAt
    || COMMITTED_KDS_STATUSES.has(status)
  );
};

/**
 * A restaurant line can be corrected without supervisor approval only while it
 * remains a local draft. Returning to the table map dispatches fresh lines, so
 * reopened or kitchen-bound lines fall back to the protected void workflow.
 */
export const canReverseRestaurantDraftWithoutApproval = (
  isRestaurantMode: boolean,
  item?: RestaurantDraftLine | null,
): boolean => Boolean(
  isRestaurantMode
  && item
  && !item.subtotalizedAt
  && !item.restaurantCommittedAt
  && !hasKitchenDispatchEvidence(item)
);

export const markRestaurantLinesCommitted = <T extends RestaurantDraftLine>(
  items: T[],
  committedAt = new Date().toISOString(),
): Array<T & { restaurantCommittedAt: string }> => items.map(item => item.restaurantCommittedAt
  ? item
  : { ...item, restaurantCommittedAt: committedAt }
) as Array<T & { restaurantCommittedAt: string }>;

export const requiresRestaurantReductionApproval = (
  isRestaurantOrderContext: boolean,
  item: RestaurantDraftLine | null | undefined,
  nextQuantity: number,
): boolean => Boolean(
  isRestaurantOrderContext
  && item?.restaurantCommittedAt
  && Number.isFinite(nextQuantity)
  && nextQuantity < Number(item.quantity || 0)
);
