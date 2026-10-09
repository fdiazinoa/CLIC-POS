import { v3StockSource } from './LargeMasterSyncV3StockAuthority';
import type { BusinessConfig, CartItem, TaxDefinition, V3SaleAuthorityStamp } from '../../types';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

const sameAuthority = (left: V3SaleAuthorityStamp, right: V3SaleAuthorityStamp): boolean =>
  left.syncId === right.syncId
  && left.syncVersion === right.syncVersion
  && left.tariffId === right.tariffId
  && left.taxIncluded === right.taxIncluded
  && JSON.stringify(v3StockSource(left)) === JSON.stringify(v3StockSource(right))
  && left.inventoryVersion === right.inventoryVersion
  && left.inventoryCursor === right.inventoryCursor
  && left.binding === right.binding && left.warehouseId === right.warehouseId;

/**
 * Fiscal input for a V3 checkout. Legacy tax tables and global taxRate are
 * excluded even when the legacy configuration happens to use the same IDs.
 * Callers must run this before allocating an NCF or persisting a transaction.
 */
export const buildLargeMasterSyncV3CheckoutFiscalInput = (
  config: BusinessConfig,
  lines: CartItem[],
  authority: V3SaleAuthorityStamp,
  v3Taxes: TaxDefinition[],
): { config: BusinessConfig; isTaxIncluded: boolean } => {
  if (!authority.syncId || !Number.isSafeInteger(authority.syncVersion)
    || !authority.tariffId || !Number.isSafeInteger(authority.inventoryVersion)
    || !authority.inventoryCursor) {
    throw new LargeMasterSyncV3Error('SYNC_V3_SALE_AUTHORITY_INVALID');
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new LargeMasterSyncV3Error('SYNC_V3_CART_EMPTY');
  }
  const taxes = new Map<string, TaxDefinition>();
  for (const tax of v3Taxes) {
    if (!tax.id || taxes.has(tax.id) || !Number.isFinite(tax.rate)
      || tax.rate < 0 || tax.rate > 1) {
      throw new LargeMasterSyncV3Error('SYNC_V3_TAX_INVALID');
    }
    taxes.set(tax.id, tax);
  }
  for (const line of lines) {
    if (!line.v3SaleAuthority) {
      throw new LargeMasterSyncV3Error('SYNC_V3_CART_LEGACY_LINE');
    }
    if (!sameAuthority(line.v3SaleAuthority, authority)) {
      throw new LargeMasterSyncV3Error('SYNC_V3_CART_MIXED_VERSION');
    }
    if (!Number.isFinite(line.price) || line.price < 0
      || !Number.isFinite(line.quantity) || line.quantity === 0
      || !Array.isArray(line.appliedTaxIds)
      || (line.taxable === true && line.appliedTaxIds.length === 0)) {
      throw new LargeMasterSyncV3Error('SYNC_V3_LINE_INVALID');
    }
    for (const taxId of line.appliedTaxIds) {
      if (!taxes.has(taxId)) throw new LargeMasterSyncV3Error('SYNC_V3_TAX_UNAVAILABLE');
    }
  }
  return {
    config: { ...config, taxes: [...taxes.values()], taxRate: 0 },
    isTaxIncluded: authority.taxIncluded,
  };
};
