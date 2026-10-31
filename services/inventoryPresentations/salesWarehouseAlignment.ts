import { capturePresentationAuth, PRESENTATIONS_ROOT, type PresentationAuth } from './client';

export type ErpSalesWarehouse = { warehouseId: string; localId: string };
export type LocalWarehouseRow = { id?: string; erpWarehouseId?: string; inventoryLocalId?: string; name?: string; code?: string };

/** Reads the warehouse the ERP itself uses for this terminal (the authority behind presentations). */
export const readErpSalesWarehouse = async (ports: { auth?: () => PresentationAuth; fetchImpl?: typeof fetch } = {}): Promise<ErpSalesWarehouse | null> => {
  const auth = (ports.auth || capturePresentationAuth)();
  const response = await (ports.fetchImpl || fetch)(`${auth.origin}${PRESENTATIONS_ROOT}/negotiate`, {
    method: 'POST',
    headers: { ...auth.headers, 'X-Clic-Inventory-Presentations': '1', Accept: 'application/json', 'Content-Type': 'application/json' },
    body: '{}', credentials: 'omit', cache: 'no-store', redirect: 'error',
  });
  if (response.status !== 200) return null;
  const body = await response.json().catch(() => null);
  const scope = body?.scope || {};
  return typeof scope.warehouseId === 'string' && typeof scope.localId === 'string' && scope.warehouseId && scope.localId
    ? { warehouseId: scope.warehouseId, localId: scope.localId }
    : null;
};

/** The authorized local row that corresponds to the ERP warehouse, if this box may sell from it. */
export const pickAuthorizedWarehouse = (
  rows: readonly LocalWarehouseRow[] | null | undefined,
  erp: ErpSalesWarehouse | null,
): LocalWarehouseRow | null => {
  if (!erp) return null;
  const matches = (Array.isArray(rows) ? rows : []).filter(row => row && (
    row.id === erp.warehouseId || row.erpWarehouseId === erp.warehouseId || row.inventoryLocalId === erp.localId
  ));
  return matches.length === 1 ? matches[0] : null;
};
