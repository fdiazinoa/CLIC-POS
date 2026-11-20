import type { BusinessConfig } from '../../types';
import { LargeMasterSyncV3Error, type LargeMasterSyncV3InventorySnapshot,
  type LargeMasterSyncV3RuntimeVersion } from './LargeMasterSyncV3Types';
import { readErpStockDisplaySnapshot, writeErpStockDisplaySnapshot, type ErpStockDisplaySnapshot } from './LargeMasterSyncV3ErpStockPersistence';

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
  const storageKey = JSON.stringify([binding, terminal.id, erp.companyId, erp.storeId, warehouseId, erpWarehouseId]);
  return {
    erpWarehouseId,
    storageKey,
    key: JSON.stringify([storageKey, catalog.syncId, catalog.syncVersion]),
  };
}

type Scope = NonNullable<ReturnType<typeof v3ErpStockDisplayScope>>;
type LoadInventory = (signal: AbortSignal) => Promise<LargeMasterSyncV3InventorySnapshot>;

export function createV3ErpStockDisplay(timeoutMs = STOCK_FETCH_TIMEOUT_MS) {
  let current: { storageKey: string; snapshot: ErpStockDisplaySnapshot } | undefined;
  let pending: { key: string; marker?: string; controller: AbortController; promise: Promise<boolean> } | undefined;
  let sequence = 0;
  let latestStarted = 0;
  let hydration: { storageKey: string; promise: Promise<boolean> } | undefined;
  let missingStorageKey: string | undefined;

  function hydrate(scope: Scope): Promise<boolean> {
    const { storageKey } = scope;
    if (current?.storageKey === storageKey || missingStorageKey === storageKey) return Promise.resolve(false);
    if (hydration?.storageKey === storageKey) return hydration.promise;
    const previous = current;
    const promise = readErpStockDisplaySnapshot(storageKey).then(snapshot => {
      if (hydration?.promise !== promise || current !== previous) return false;
      if (!snapshot) {
        missingStorageKey = storageKey;
        return false;
      }
      current = { storageKey, snapshot };
      return true;
    }).catch(() => false).finally(() => { if (hydration?.promise === promise) hydration = undefined; });
    hydration = { storageKey, promise };
    return promise;
  }

  return {
    hydrate,
    async refresh(readScope: () => Promise<Scope>, load: LoadInventory, marker?: string): Promise<boolean> {
      const request = ++sequence;
      const before = await readScope();
      if (request < latestStarted) throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
      latestStarted = request;
      const previous = pending;
      if (marker !== undefined && previous?.key === before.key
        && (previous.marker === marker || previous.marker === undefined)) {
        if (previous.marker === marker) await previous.promise;
        return false;
      }
      const controller = new AbortController();
      const assertScope = async () => {
        const after = await readScope();
        if (controller.signal.aborted || after.key !== before.key || after.erpWarehouseId !== before.erpWarehouseId) {
          throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
        }
      };
      const promise = (async () => {
        const hydrated = await hydrate(before);
        if (controller.signal.aborted) throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
        const previousMarker = current?.storageKey === before.storageKey ? current.snapshot.marker : undefined;
        if (marker !== undefined && previousMarker === marker) return hydrated;
        let rejectAbort: () => void = () => {};
        const aborted = new Promise<never>((_, reject) => {
          rejectAbort = () => reject(new LargeMasterSyncV3Error(pending?.controller === controller
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
        await assertScope();
        // Store the observed manifest marker with the successful display rows, not the full response's cursor.
        const snapshot = { rows, marker: marker ?? previousMarker };
        try {
          await writeErpStockDisplaySnapshot(before.storageKey, snapshot, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
          throw error;
        }
        await assertScope();
        if (missingStorageKey === before.storageKey) missingStorageKey = undefined;
        current = { storageKey: before.storageKey, snapshot };
        return true;
      })();
      pending = { key: before.key, marker, controller, promise };
      previous?.controller.abort();
      try {
        return await promise;
      } finally {
        if (pending?.controller === controller) pending = undefined;
      }
    },
    read(scope: Scope | undefined, itemId: string) {
      return scope && current?.storageKey === scope.storageKey ? current.snapshot.rows.get(itemId) : undefined;
    },
  };
}

/** Display balances cached locally, independent of SQLite and financial stock authority. */
export const v3ErpStockDisplay = createV3ErpStockDisplay();
