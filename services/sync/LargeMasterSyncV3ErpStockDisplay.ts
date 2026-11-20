import type { BusinessConfig } from '../../types';
import { LargeMasterSyncV3Error, type LargeMasterSyncV3InventorySnapshot,
  type LargeMasterSyncV3RuntimeVersion } from './LargeMasterSyncV3Types';

const STOCK_FETCH_TIMEOUT_MS = 30_000;

export function v3ErpStockDisplayScope(terminal: BusinessConfig['terminals'][number], tenantId: string, binding: string,
  catalog: LargeMasterSyncV3RuntimeVersion) {
  const erp = terminal.config.erpBinding;
  const inventory = terminal.config.inventoryScope;
  const warehouseId = inventory?.defaultSalesWarehouseId;
  if (!warehouseId || !erp?.companyId || !erp.storeId || erp.tenantId !== tenantId) return undefined;
  const warehouse = inventory?.warehouses?.find(row => row.id === warehouseId)
    ?? (inventory?.defaultWarehouse?.id === warehouseId ? inventory.defaultWarehouse : undefined);
  // The snapshot normalizer can use the inventory-local alias as a fallback ERP ID.
  const mappedErpWarehouseId = warehouse?.erpWarehouseId !== warehouse?.inventoryLocalId
    ? warehouse?.erpWarehouseId : undefined;
  const erpWarehouseId = mappedErpWarehouseId || warehouse?.sourceWarehouseId || warehouse?.warehouseId || warehouseId;
  return {
    erpWarehouseId,
    key: JSON.stringify([binding, terminal.id, erp.companyId, erp.storeId, warehouseId, erpWarehouseId,
      catalog.syncId, catalog.syncVersion]),
  };
}

type Scope = NonNullable<ReturnType<typeof v3ErpStockDisplayScope>>;
type LoadInventory = (signal: AbortSignal) => Promise<LargeMasterSyncV3InventorySnapshot>;

export function createV3ErpStockDisplay(timeoutMs = STOCK_FETCH_TIMEOUT_MS) {
  let current: { scope: Scope; rows: Map<string, { stock: number; balance: number }> } | undefined;
  let pending: AbortController | undefined;

  return {
    async refresh(readScope: () => Promise<Scope>, load: LoadInventory): Promise<void> {
      const previous = pending;
      const controller = new AbortController();
      pending = controller;
      previous?.abort();
      try {
        const before = await readScope();
        if (controller.signal.aborted) throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
        let rejectAbort: () => void = () => {};
        const aborted = new Promise<never>((_, reject) => {
          rejectAbort = () => reject(new LargeMasterSyncV3Error(pending === controller
            ? 'SYNC_V3_INVENTORY_HTTP_ERROR' : 'SYNC_V3_BINDING_CHANGED'));
          controller.signal.addEventListener('abort', rejectAbort, { once: true });
        });
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let inventory: LargeMasterSyncV3InventorySnapshot;
        try {
          inventory = await Promise.race([aborted, load(controller.signal)]);
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', rejectAbort);
        }
        const rows = new Map<string, { stock: number; balance: number }>();
        for (const row of inventory.balances) {
          if (row.warehouse_id !== before.erpWarehouseId) continue;
          const balance = row.qty_on_hand - row.qty_reserved - row.qty_committed;
          if (!Number.isFinite(balance)) {
            throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_INVALID');
          }
          rows.set(row.item_id, { stock: row.qty_on_hand, balance });
        }
        const after = await readScope();
        if (controller.signal.aborted || after.key !== before.key || after.erpWarehouseId !== before.erpWarehouseId) {
          throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
        }
        // Request order is authoritative here. ERP versions can decrease when inventory rows are removed.
        current = { scope: before, rows };
      } finally {
        if (pending === controller) pending = undefined;
      }
    },
    read(scope: Scope | undefined, itemId: string) {
      return scope && current?.scope.key === scope.key && current.scope.erpWarehouseId === scope.erpWarehouseId
        ? current.rows.get(itemId) : undefined;
    },
  };
}

/** Single in-memory view of ERP balances, independent of SQLite and financial stock authority. */
export const v3ErpStockDisplay = createV3ErpStockDisplay();
