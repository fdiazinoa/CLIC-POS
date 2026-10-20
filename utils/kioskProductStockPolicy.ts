import type { Product } from '../types';
import { requiresProductStockAvailability } from './productStockPolicy';

export function requiresKioskStockAvailability(product: Product, defaults: {
  stockTracking?: boolean;
  allowNegativeStock?: boolean;
}): boolean {
  // V3 validates these same article flags after the tap; terminal defaults
  // must not prevent a sellable article from reaching that validation.
  if (product.v3SaleAuthority) {
    return product.type !== 'SERVICE' && product.isInventoriable === true
      && requiresProductStockAvailability(product);
  }
  const tracked = product.operationalFlags?.trackInventory ?? defaults.stockTracking ?? false;
  const negative = product.operationalFlags?.allowNegativeStock === true && defaults.allowNegativeStock === true;
  return tracked && !negative;
}
