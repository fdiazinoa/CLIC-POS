import type { Warehouse } from '../types';

/**
 * A POS terminal only operates the warehouses of its own store. Warehouses synced from
 * other stores (and therefore other companies) must never be offered for assignment.
 * Rows without a storeId are legacy local seeds and stay visible.
 */
export const scopedWarehousesForStore = (
  warehouses: readonly Warehouse[] | null | undefined,
  storeId?: string | null,
): Warehouse[] => {
  const rows = Array.isArray(warehouses) ? warehouses.slice() : [];
  const scope = String(storeId || '').trim();
  if (!scope) return rows;
  const scoped = rows.filter(row => {
    const rowStore = String((row as { storeId?: string | null })?.storeId || '').trim();
    return !rowStore || rowStore === scope;
  });
  return scoped.length > 0 ? scoped : rows;
};
