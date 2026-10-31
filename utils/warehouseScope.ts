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

/**
 * A restored ticket may hold articles that are only active in another warehouse of the box.
 * Naming that warehouse turns "artículo no disponible" into a decision the cashier can take.
 */
export const alternativeWarehouseForLines = (
  lines: readonly { id?: string; name?: string; activeInWarehouses?: string[] }[] | null | undefined,
  warehouses: readonly { id?: string; name?: string; code?: string }[] | null | undefined,
  sessionWarehouseId?: string | null,
): { warehouseId: string; name: string; lineName: string } | null => {
  const session = String(sessionWarehouseId || '').trim();
  if (!session) return null;
  const known = new Map((warehouses || []).map(row => [String(row?.id || ''), row]));
  for (const line of Array.isArray(lines) ? lines : []) {
    const active = Array.isArray(line?.activeInWarehouses) ? line.activeInWarehouses.map(String) : [];
    if (!active.length || active.includes(session)) continue;
    const candidate = active.find(id => known.has(id)) || active[0];
    if (!candidate) continue;
    const row = known.get(candidate);
    return { warehouseId: candidate, name: String(row?.name || row?.code || candidate).trim(), lineName: String(line?.name || line?.id || '').trim() };
  }
  return null;
};
