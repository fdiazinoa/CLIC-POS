import { LargeMasterSyncV3Error, type LargeMasterSyncV3InventoryAuthority } from './LargeMasterSyncV3Types';
import type { CartItem, V3SaleAuthorityStamp } from '../../types';

export const v3StockSource = (stamp: V3SaleAuthorityStamp): { syncId: string; syncVersion: number } => {
  const explicit = stamp.inventorySyncId !== undefined || stamp.inventorySyncVersion !== undefined;
  if (explicit && (!stamp.inventorySyncId || !Number.isSafeInteger(stamp.inventorySyncVersion))) {
    throw new LargeMasterSyncV3Error('SYNC_V3_STOCK_AUTHORITY_INVALID');
  }
  return explicit ? { syncId: stamp.inventorySyncId!, syncVersion: stamp.inventorySyncVersion! }
    : { syncId: stamp.syncId, syncVersion: stamp.syncVersion };
};
export const sameV3StockAuthority = (stamp: V3SaleAuthorityStamp, anchor: LargeMasterSyncV3InventoryAuthority): boolean => {
  const source = v3StockSource(stamp);
  return source.syncId === anchor.syncId && source.syncVersion === anchor.syncVersion
    && stamp.inventoryVersion === anchor.version && stamp.inventoryCursor === anchor.cursor;
};
/** A credit note reverses the document as issued: the ticket's own authority is the anchor. */
export const v3RefundAnchor = (stamp: V3SaleAuthorityStamp): LargeMasterSyncV3InventoryAuthority => {
  const source = v3StockSource(stamp);
  return { syncId: source.syncId, syncVersion: source.syncVersion, contractVersion: 2,
    version: stamp.inventoryVersion, cursor: stamp.inventoryCursor };
};

/** Descriptive/category changes do not reinterpret stock or fiscal quantities. */
export const v3ArticleSemantics = (row: Record<string, any>): string => JSON.stringify([
  row.type, row.inventoriable, row.uom ?? row.measurementUnit, row.purchaseUnit, row.conversionFactor,
  row.taxable, [...(row.taxIds ?? row.appliedTaxIds ?? [])].sort(),
  ...['isWeighted', 'trackInventory', 'integersOnly', 'usesLots', 'usesSerial'].map(key => row.operationalFlags?.[key] === true),
]);
export const v3TaxSemantics = (row: Record<string, any>): string => JSON.stringify([row.id, row.type, row.rate, row.active]);
export const v3TariffSemantics = (row: Record<string, any>): string => JSON.stringify([row.id, row.taxIncluded, row.active]);
export const v3VariantSemantics = (row: Record<string, any>): string => JSON.stringify([row.id, row.articleId, row.sku,
  row.active, row.attributeValues, row.barcodes]);

const retainedLineFields = (line: CartItem, discountAmount = line.discountAmount) => [
  line.cartId, line.id, line.v3SaleAuthority, line.price, discountAmount, line.taxable, line.appliedTaxIds,
  line.type, line.isInventoriable, line.measurementUnit, line.purchaseUnit, line.conversionFactor,
  line.variantId, line.variantSku, line.restaurantConfig, line.selected_combo_items, line.selected_modifiers,
  line.selected_fraction_parts, line.note, line.trackingData,
];

export const v3RetainedLineFingerprint = (line: CartItem): string => JSON.stringify(retainedLineFields(line));

export const sameV3RetainedLine = (original: CartItem, candidate: CartItem, refund = false): boolean => {
  if (!refund) return v3RetainedLineFingerprint(original) === v3RetainedLineFingerprint(candidate);
  // The ERP returns explicit zero for an absent discount and JSONB may reorder object keys.
  const asRefund = (line: CartItem): string => JSON.stringify(retainedLineFields(line, line.discountAmount ?? 0),
    (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
      : value);
  return asRefund(original) === asRefund(candidate);
};
