import type { CartItem } from '../../types';
import { presentationBaseQuantity, presentationFormatSnapshot, presentationUnitPrice, type InventoryPresentation, type InventoryPresentationMaster } from './contract';

export type PresentationReconcileResult =
  | { status: 'unchanged' }
  | { status: 'reconciled'; line: CartItem; repriced: { previous: number; current: number } | null }
  | { status: 'unavailable'; reason: 'FORMAT_REMOVED' | 'NOT_SELLABLE' | 'TARIFF_FORBIDDEN' | 'PRICE_CHANGED' };

/**
 * A presentation line saved on a previous day carries the master revision of the catalog of
 * that day. It cannot be validated against today's cache, so the descriptor is rebuilt from the
 * current master and the same commercial quantity. The agreed amount is never changed silently:
 * when the current presentation price differs the line is reported instead.
 */
export const reconcilePresentationLine = (
  line: CartItem,
  master: InventoryPresentationMaster,
): PresentationReconcileResult => {
  const descriptor = line.inventoryPresentation as InventoryPresentation | undefined;
  if (!descriptor) return { status: 'unchanged' };
  if (descriptor.itemId !== master.itemId) return { status: 'unavailable', reason: 'FORMAT_REMOVED' };
  const format = master.formats.find(row => row.id === descriptor.format.id && row.variantId === descriptor.variantId);
  if (!format) return { status: 'unavailable', reason: 'FORMAT_REMOVED' };
  if (format.active !== true || format.allowSale !== true) return { status: 'unavailable', reason: 'NOT_SELLABLE' };
  const tariffId = line.v3SaleAuthority?.tariffId || descriptor.tariffId;
  if (!master.basePrices.some(row => row.tariffId === tariffId)) return { status: 'unavailable', reason: 'TARIFF_FORBIDDEN' };
  const snapshot = presentationFormatSnapshot(format);
  const next: InventoryPresentation = {
    schemaVersion: 1,
    itemId: master.itemId,
    variantId: null,
    format: snapshot,
    commercialQuantity: line.quantity,
    baseQuantity: presentationBaseQuantity(line.quantity, format.factor),
    tariffId,
    masterRevision: master.masterRevision,
  };
  const current = presentationUnitPrice(format, tariffId, master);
  const agreed = Number(line.originalPrice ?? line.price);
  const repriced = Number.isFinite(agreed) && agreed !== current ? { previous: agreed, current } : null;
  if (repriced) return { status: 'unavailable', reason: 'PRICE_CHANGED' };
  return { status: 'reconciled', line: { ...line, inventoryPresentation: next }, repriced: null };
};
