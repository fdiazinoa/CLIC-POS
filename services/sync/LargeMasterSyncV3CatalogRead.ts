import type { BusinessConfig, Warehouse } from '../../types';
import { dbAdapter } from '../db';
import { LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED } from './LargeMasterSyncV3Authority';
import { readLargeMasterSyncV3BoundIdentity, type LargeMasterSyncV3BoundIdentity } from './LargeMasterSyncV3BoundTransport';
import { largeMasterSyncV3DownloadOrigin } from './LargeMasterSyncV3DownloadOrigin';
import { v3BindingKey, v3InventoryBaselineKey } from './LargeMasterSyncV3OperationalSession';
import { LargeMasterSyncV3Runtime } from './LargeMasterSyncV3Runtime';
import { LargeMasterSyncV3Error, type LargeMasterSyncV3Store, type V3CatalogPageRequest } from './LargeMasterSyncV3Types';

export const useV3CatalogBrowser = (enabled: boolean, targetKind: string): boolean => enabled && targetKind === 'ERP_ACTIVE';
export interface V3CatalogContext { config: BusinessConfig; terminalId: string; warehouses: Warehouse[] }
export interface V3CatalogReadDependencies {
  enabled: boolean; store?: LargeMasterSyncV3Store;
  readIdentity(): LargeMasterSyncV3BoundIdentity; downloadOrigin(): string;
}
const defaults = (): V3CatalogReadDependencies => ({ enabled: LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,
  store: dbAdapter.masterSyncV3Store, readIdentity: readLargeMasterSyncV3BoundIdentity,
  downloadOrigin: largeMasterSyncV3DownloadOrigin });

const configured = (context: V3CatalogContext, identity: LargeMasterSyncV3BoundIdentity) => {
  const terminal = context.config.terminals.find(row => row.id === context.terminalId);
  const tariffId = terminal?.config.pricing?.defaultTariffId;
  const warehouseId = terminal?.config.inventoryScope?.defaultSalesWarehouseId;
  const warehouse = context.warehouses.find(row => row.id === warehouseId);
  if (!terminal || terminal.config.currentDeviceId !== identity.deviceId
    || (terminal.config.erpTerminalId || terminal.id) !== identity.terminalId
    || !tariffId || !warehouseId || !warehouse) throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_CONTEXT_REQUIRED');
  return { tariffId, warehouseId, key: JSON.stringify([terminal.id, terminal.config.erpTerminalId,
    terminal.config.currentDeviceId, tariffId, warehouse]) };
};

/** Cached reads only: never connect, prepare, refresh, activate, set owner or contact ERP. */
export class LargeMasterSyncV3CatalogRead {
  private constructor(private readonly dependencies: V3CatalogReadDependencies,
    private readonly getContext: () => V3CatalogContext, private readonly runtime: LargeMasterSyncV3Runtime,
    private readonly identity: LargeMasterSyncV3BoundIdentity, private readonly origin: string,
    private readonly binding: string, private readonly scope: ReturnType<typeof configured>,
    private readonly inventory: { version: number; cursor: string }, private readonly taxIncluded: boolean) {}

  static async open(getContext: () => V3CatalogContext, dependencies = defaults()): Promise<LargeMasterSyncV3CatalogRead> {
    if (!dependencies.enabled) throw new LargeMasterSyncV3Error('SYNC_V3_CANDIDATE_DISABLED');
    const store = dependencies.store;
    if (!store?.readAdministrativeCatalogPage || !store.getAdministrativeTariff || !store.getOperationalOwner || !store.getLocalInventoryDeltas)
      throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_READ_UNAVAILABLE');
    const identity = dependencies.readIdentity(); const origin = dependencies.downloadOrigin();
    const binding = v3BindingKey(identity, origin); const scope = configured(getContext(), identity);
    const runtime = await LargeMasterSyncV3Runtime.open(store);
    if (!runtime || (runtime.version.contractVersion || 1) < 2) throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_NOT_READY');
    const inventory = await runtime.getInventorySnapshotVersion();
    if (!inventory) throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_NOT_READY');
    const tariff = await store.getAdministrativeTariff(runtime.version, scope.tariffId);
    const reader = new LargeMasterSyncV3CatalogRead(dependencies, getContext, runtime, identity, origin, binding, scope, inventory, tariff.taxIncluded);
    await reader.assertCurrent();
    return reader;
  }

  async assertCurrent(): Promise<void> {
    const current = this.dependencies.readIdentity();
    if (current.syncToken !== this.identity.syncToken || this.dependencies.downloadOrigin() !== this.origin
      || v3BindingKey(current, this.origin) !== this.binding || configured(this.getContext(), current).key !== this.scope.key)
      throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_CONTEXT_CHANGED');
    const store = this.dependencies.store!;
    const [active, owner, inventory] = await Promise.all([store.getActiveRuntimeVersion(), store.getOperationalOwner!(),
      this.runtime.getInventorySnapshotVersion()]);
    const version = this.runtime.version;
    if (active?.syncId !== version.syncId || active.syncVersion !== version.syncVersion
      || (active.contractVersion || 1) < 2 || owner?.binding !== this.binding || owner.syncId !== version.syncId
      || owner.syncVersion !== version.syncVersion || inventory?.version !== this.inventory.version
      || inventory.cursor !== this.inventory.cursor) throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_VERSION_CHANGED');
    // Configuration/identity can change while native promises are pending.
    const after = this.dependencies.readIdentity();
    if (after.syncToken !== this.identity.syncToken || v3BindingKey(after, this.dependencies.downloadOrigin()) !== this.binding
      || configured(this.getContext(), after).key !== this.scope.key) throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_CONTEXT_CHANGED');
  }

  async page(request: Pick<V3CatalogPageRequest, 'query' | 'category' | 'afterId' | 'limit' | 'departmentId' | 'sectionId' | 'familyId' | 'brandId' | 'categoryId'>) {
    await this.assertCurrent();
    const result = await this.runtime.readAdministrativeCatalogPage({ ...request, ...this.scope,
      inventoryVersion: this.inventory.version, inventoryCursor: this.inventory.cursor });
    const deltas = result.rows.length ? await this.dependencies.store!.getLocalInventoryDeltas!(
      v3InventoryBaselineKey(this.binding, { ...this.runtime.version, inventoryVersion: this.inventory.version,
        inventoryCursor: this.inventory.cursor, tariffId: this.scope.tariffId, warehouseId: this.scope.warehouseId,
        taxIncluded: this.taxIncluded }),
      result.rows.map(row => row.id), this.scope.warehouseId) : {};
    await this.assertCurrent();
    return { ...result, rows: result.rows.map(row => ({ ...row,
      stock: row.stock == null ? null : row.stock + (deltas[row.id] || 0),
      balance: row.balance === null ? null : row.balance + (deltas[row.id] || 0) })) };
  }
}
