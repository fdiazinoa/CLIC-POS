import { LargeMasterSyncV3Error, type LargeMasterSyncV3InventoryAuthority } from './LargeMasterSyncV3Types';
import type { V3SaleAuthorityStamp } from '../../types';

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

export const v3RetainedLineFingerprint = (line: import('../../types').CartItem): string => JSON.stringify([line.cartId, line.id, line.v3SaleAuthority, line.price, line.discountAmount, line.taxable, line.appliedTaxIds, line.type, line.isInventoriable, line.measurementUnit, line.purchaseUnit, line.conversionFactor, line.variantId, line.variantSku]);
