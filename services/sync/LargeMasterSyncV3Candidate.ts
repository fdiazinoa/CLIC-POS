import { assertLargeMasterSyncV3NativeAndroid } from './LargeMasterSyncV3Platform';
import { LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED } from './LargeMasterSyncV3Authority';
import { createLargeMasterSyncV3BoundClient,
  readLargeMasterSyncV3BoundIdentity } from './LargeMasterSyncV3BoundTransport';
import type { LargeMasterSyncV3Client, LargeMasterSyncV3Metric } from './LargeMasterSyncV3Client';
import { fetchLargeMasterSyncV3Inventory } from './LargeMasterSyncV3Inventory';
import { waitForLargeMasterSyncV3OperationalWindow } from './LargeMasterSyncV3OperationGate';
import { LargeMasterSyncV3Runtime } from './LargeMasterSyncV3Runtime';
import { largeMasterSyncV3DownloadOrigin } from './LargeMasterSyncV3DownloadOrigin';
import { LargeMasterSyncV3Error, type LargeMasterSyncV3InventorySnapshot,
  type LargeMasterSyncV3RuntimeVersion, type LargeMasterSyncV3Store } from './LargeMasterSyncV3Types';

/** Explicit candidate entry point. The production V2 APK never invokes it. */
export { LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED } from './LargeMasterSyncV3Authority';

type CandidateClient = Pick<LargeMasterSyncV3Client, 'requestSync' | 'resumeSync'>;
type CandidateDependencies = {
  enabled: boolean;
  assertPlatform: () => void;
  createClient: (store: LargeMasterSyncV3Store, v3BaseUrl: string,
    metric?: (metric: LargeMasterSyncV3Metric) => void) => CandidateClient;
  fetchInventory: (signal?: AbortSignal) => Promise<LargeMasterSyncV3InventorySnapshot>;
  waitForOperationalWindow: (signal?: AbortSignal) => Promise<number>;
  openRuntime: (store: LargeMasterSyncV3Store) => Promise<LargeMasterSyncV3Runtime | null>;
};

const defaultDependencies: CandidateDependencies = {
  enabled: LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,
  assertPlatform: assertLargeMasterSyncV3NativeAndroid,
  createClient: (store, v3BaseUrl, metric) =>
    createLargeMasterSyncV3BoundClient(store, v3BaseUrl, { metric }),
  fetchInventory: signal => fetchLargeMasterSyncV3Inventory(
    readLargeMasterSyncV3BoundIdentity, fetch, signal, largeMasterSyncV3DownloadOrigin()),
  waitForOperationalWindow: waitForLargeMasterSyncV3OperationalWindow,
  openRuntime: LargeMasterSyncV3Runtime.open,
};

export interface LargeMasterSyncV3CandidateReady {
  inventorySyncId?: string;
  inventorySyncVersion?: number;
  runtime: LargeMasterSyncV3Runtime;
  inventoryVersion: number;
  inventoryCursor: string;
}

/**
 * Prepares the candidate's complete master-data boundary without touching
 * legacy masters, pairing, sales or the V2 outbox. It does not enable sales;
 * callers must separately gate the operational POS on this ready result.
 */
export const prepareLargeMasterSyncV3Candidate = async (
  store: LargeMasterSyncV3Store | undefined,
  v3BaseUrl: string,
  metric?: (metric: LargeMasterSyncV3Metric) => void,
  signal?: AbortSignal,
  dependencies: CandidateDependencies = defaultDependencies,
): Promise<LargeMasterSyncV3CandidateReady> => {
  const phase = (phase: string) => { try { metric?.({ event: 'setup_phase', phase }); } catch { /* Observer only. */ } };
  if (!dependencies.enabled) throw new LargeMasterSyncV3Error('SYNC_V3_CANDIDATE_DISABLED');
  dependencies.assertPlatform();
  if (!store) throw new LargeMasterSyncV3Error('SYNC_V3_NATIVE_STORE_UNAVAILABLE');
  await dependencies.waitForOperationalWindow(signal);
  if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
  await store.assertCanRefresh?.();
  const client = dependencies.createClient(store, v3BaseUrl, metric);
  phase('negotiation');
  const requested = await client.requestSync(signal);
  if ('fallback' in requested) throw new LargeMasterSyncV3Error('SYNC_V3_LEGACY_FALLBACK_REJECTED');
  const incomplete = await store.findIncomplete();
  if (incomplete && (incomplete.syncId !== requested.syncId
    || incomplete.syncVersion !== requested.syncVersion)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_STAGING_CONFLICT');
  }
  const version: LargeMasterSyncV3RuntimeVersion = await client.resumeSync(requested.syncId, signal);
  if (version.syncId !== requested.syncId || version.syncVersion !== requested.syncVersion
    || (version.contractVersion || 1) < 2) {
    throw new LargeMasterSyncV3Error('SYNC_V3_OPERATIONAL_CONTRACT_REQUIRED');
  }
  phase('inventory_download');
  const inventory = await dependencies.fetchInventory(signal);
  await dependencies.waitForOperationalWindow(signal);
  phase('inventory_save');
  await store.replaceInventorySnapshot(version, inventory);
  phase('inventory_readback');
  const saved = await store.getInventorySnapshotVersion(version);
  if (!saved || saved.version !== inventory.version || saved.cursor !== inventory.cursor) {
    throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_NOT_READY');
  }
  phase('runtime');
  const runtime = await dependencies.openRuntime(store);
  if (!runtime || runtime.version.syncId !== version.syncId
    || runtime.version.syncVersion !== version.syncVersion
    || (runtime.version.contractVersion || 1) < 2) {
    throw new LargeMasterSyncV3Error('SYNC_V3_RUNTIME_VERSION_CHANGED');
  }
  return { runtime, inventoryVersion: saved.version, inventoryCursor: saved.cursor };
};

/** Existing stock remains authoritative. This route never requests/replaces inventory. */
export const prepareLargeMasterSyncV3CatalogOnly = async (
  store: LargeMasterSyncV3Store, v3BaseUrl: string, binding: string,
  metric?: (metric: LargeMasterSyncV3Metric) => void,
  dependencies: CandidateDependencies = defaultDependencies,
  assertIdentity?: () => void | Promise<void>,
): Promise<LargeMasterSyncV3CandidateReady> => {
  if (!dependencies.enabled) throw new LargeMasterSyncV3Error('SYNC_V3_CANDIDATE_DISABLED');
  dependencies.assertPlatform();
  await dependencies.waitForOperationalWindow();
  const [expectedCatalog, owner, inventory] = await Promise.all([
    store.getActiveRuntimeVersion(), store.getOperationalOwner?.(), store.getInventoryAuthority?.(),
  ]);
  if (!expectedCatalog || !owner || owner.binding !== binding || owner.syncId !== expectedCatalog.syncId
    || owner.syncVersion !== expectedCatalog.syncVersion || !inventory || !store.prepareCatalogOnly || !store.activateCatalogOnly) {
    throw new LargeMasterSyncV3Error('SYNC_V3_STOCK_AUTHORITY_INVALID');
  }
  if (!assertIdentity) throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
  await assertIdentity();
  const transition = { expectedCatalog, binding, inventory, assertIdentity };
  const scopedStore = new Proxy(store, { get(target, key) {
    if (key === 'prepare') return (manifest: Parameters<LargeMasterSyncV3Store['prepare']>[0]) => target.prepareCatalogOnly!(manifest, transition);
    if (key === 'activate') return (syncId: string) => target.activateCatalogOnly!(syncId, transition);
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const client = dependencies.createClient(scopedStore, v3BaseUrl, metric);
  const requested = await client.requestSync();
  if ('fallback' in requested) throw new LargeMasterSyncV3Error('SYNC_V3_LEGACY_FALLBACK_REJECTED');
  const version = await client.resumeSync(requested.syncId);
  await store.activateCatalogOnly(requested.syncId, transition);
  const runtime = await dependencies.openRuntime(store);
  const receipt = await store.getCatalogReceipt?.(version, binding);
  if (!runtime || runtime.version.syncId !== version.syncId || runtime.version.syncVersion !== version.syncVersion
    || !receipt || receipt.syncId !== inventory.syncId || receipt.syncVersion !== inventory.syncVersion
    || receipt.version !== inventory.version || receipt.cursor !== inventory.cursor) {
    throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_TRANSITION_CHANGED');
  }
  return { runtime, inventoryVersion: inventory.version, inventoryCursor: inventory.cursor,
    inventorySyncId: inventory.syncId, inventorySyncVersion: inventory.syncVersion };
};
