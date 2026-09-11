import type { Product } from '../types';

const buildStockSyncMarker = (product?: Partial<Product> | null): string => {
  if (!product) return 'NO_STOCK';

  return Object.entries(product.stockBalances || {})
    .map(([warehouseId, quantity]) => `${warehouseId}:${Number(quantity || 0)}`)
    .sort()
    .join('|') || 'NO_STOCK';
};

export const buildProductEditorSyncMarker = (product?: Partial<Product> | null): string => {
  if (!product) return 'NO_CATALOG';

  const taxIds = [...(product.appliedTaxIds || [])].map(String).sort();
  const operationalFlags = Object.entries(product.operationalFlags || {}).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  return JSON.stringify({
    updatedAt:
      product.updatedAt ||
      (product as Product & { updated_at?: string }).updated_at ||
      (product as Product & { createdAt?: string }).createdAt ||
      (product as Product & { created_at?: string }).created_at ||
      null,
    taxIds,
    operationalFlags,
    stock: buildStockSyncMarker(product),
  });
};
