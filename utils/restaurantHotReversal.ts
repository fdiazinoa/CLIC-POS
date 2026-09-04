export type RestaurantDraftLine = {
  dispatched?: boolean;
  subtotalizedAt?: string;
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
  && !hasKitchenDispatchEvidence(item)
);
