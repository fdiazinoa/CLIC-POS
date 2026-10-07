import type { V3CategoryFilter, V3OperationalCategory } from './LargeMasterSyncV3Categories';
export const LARGE_MASTER_SYNC_V3_SCHEMA_VERSION = 3 as const;

export const LARGE_MASTER_SYNC_V3_DATASETS = [
  'taxes',
  'tariffs',
  'articles',
  'variants',
  'barcodes',
  'prices',
] as const;

export type LargeMasterSyncV3Dataset = typeof LARGE_MASTER_SYNC_V3_DATASETS[number];

export interface LargeMasterSyncV3DatasetManifest {
  count: number;
  chunks: number;
  bytes: number;
  gzipBytes: number;
  checksum: string | null;
}

export interface LargeMasterSyncV3Manifest {
  syncId: string;
  syncVersion: number;
  schemaVersion: 3;
  /** Absent on immutable laboratory sessions created before the POS catalog contract. */
  contractVersion?: number;
  type: 'FULL';
  status: 'READY';
  createdAt: string;
  datasets: Partial<Record<LargeMasterSyncV3Dataset, LargeMasterSyncV3DatasetManifest>>;
  authority?: {
    catalog: 'V3_SNAPSHOT';
    prices: 'V3_SNAPSHOT';
    taxes: 'V3_SNAPSHOT';
    inventory: 'SEPARATE_COLLECTION';
  };
  supplementalCollections?: Array<{
    collection: 'productInventory';
    domain: 'inventory';
    endpoint: '/api/sync/collections/productInventory/full';
    consistency: 'EVENTUAL_AFTER_V3_ACTIVATION';
  }>;
}

export interface LargeMasterSyncV3ChunkEnvelope {
  schemaVersion: 3;
  syncId: string;
  dataset: LargeMasterSyncV3Dataset;
  chunkIndex: number;
  records: unknown[];
}

export interface LargeMasterSyncV3Chunk {
  envelope: LargeMasterSyncV3ChunkEnvelope;
  checksum: string;
  recordCount: number;
  rawBytes: number;
  rawText: string;
}

export interface LargeMasterSyncV3Progress {
  syncId: string;
  syncVersion: number;
  status: string;
  datasets: Array<{
    dataset: LargeMasterSyncV3Dataset;
    expectedCount: number;
    expectedChunks: number;
    expectedChecksum: string | null;
    appliedCount: number;
    appliedChunks: number;
    status: string;
  }>;
  chunks: Array<{
    dataset: LargeMasterSyncV3Dataset;
    chunkIndex: number;
    checksum: string;
    recordCount: number;
  }>;
}

export interface LargeMasterSyncV3RuntimeVersion {
  syncId: string;
  syncVersion: number;
  contractVersion?: number;
}

export interface LargeMasterSyncV3InventoryBalance {
  item_id: string;
  warehouse_id: string;
  qty_on_hand: number;
  qty_reserved: number;
  qty_committed: number;
  updated_at: string;
}

export interface LargeMasterSyncV3InventorySnapshot {
  version: number;
  cursor: string;
  balances: LargeMasterSyncV3InventoryBalance[];
}

export interface LargeMasterSyncV3Store {
  readAdministrativeCatalogPage?(runtime: LargeMasterSyncV3RuntimeVersion, request: V3CatalogPageRequest): Promise<V3CatalogPage>;
  prepare(manifest: LargeMasterSyncV3Manifest): Promise<void>;
  readProgress(syncId: string): Promise<LargeMasterSyncV3Progress | null>;
  findIncomplete(): Promise<LargeMasterSyncV3Progress | null>;
  applyChunk(chunk: LargeMasterSyncV3Chunk): Promise<'APPLIED' | 'ALREADY_APPLIED'>;
  markDatasetValidated(syncId: string, dataset: LargeMasterSyncV3Dataset): Promise<void>;
  validateStaging(syncId: string): Promise<void>;
  activate(syncId: string): Promise<LargeMasterSyncV3RuntimeVersion>;
  rollback(): Promise<LargeMasterSyncV3RuntimeVersion>;
  getActiveRuntimeVersion(): Promise<LargeMasterSyncV3RuntimeVersion | null>;
  getPragmaSnapshot(): Promise<Record<string, string | number | null>>;
  getDatabaseSizeBytes(): Promise<number>;
  listArticlesPage(runtime: LargeMasterSyncV3RuntimeVersion, afterArticleId: string | null, limit: number): Promise<Record<string, unknown>[]>;
  searchOperationalArticles(runtime: LargeMasterSyncV3RuntimeVersion, query: string, categoryId?: V3CategoryFilter, limit?: number): Promise<Record<string, unknown>[]>;
  getOperationalCategories?(runtime: LargeMasterSyncV3RuntimeVersion, tariffId: string): Promise<V3OperationalCategory[]>;
  getOperationalArticle(runtime: LargeMasterSyncV3RuntimeVersion, articleId: string): Promise<Record<string, unknown> | null>;
  getOperationalTariffs(runtime: LargeMasterSyncV3RuntimeVersion): Promise<Record<string, unknown>[]>;
  getAdministrativeTariff?(runtime: LargeMasterSyncV3RuntimeVersion, tariffId: string): Promise<{ taxIncluded: boolean }>;
  getOperationalTaxes(runtime: LargeMasterSyncV3RuntimeVersion): Promise<Record<string, unknown>[]>;
  getOperationalVariants(runtime: LargeMasterSyncV3RuntimeVersion, articleId: string): Promise<Record<string, unknown>[]>;
  getPrices(runtime: LargeMasterSyncV3RuntimeVersion, articleIds: string[], tariffId: string): Promise<Array<{ articleId: string; tariffId: string; price: number }>>;
  findBarcode(runtime: LargeMasterSyncV3RuntimeVersion, barcode: string): Promise<{ articleId: string; variantId: string | null } | null>;
  findOperationalCode?(runtime: LargeMasterSyncV3RuntimeVersion, code: string): Promise<{ articleId: string; variantId: string | null } | null>;
  getOperationalOwner?(): Promise<{ syncId: string; syncVersion: number; binding: string } | null>;
  setOperationalOwner?(runtime: LargeMasterSyncV3RuntimeVersion, binding: string): Promise<void>;
  getLocalInventoryDelta?(baseline: string, itemId: string, warehouseId: string): Promise<number>;
  assertCanRefresh?(): Promise<void>;
  getLocalInventoryDeltas?(baseline: string, itemIds: string[], warehouseId: string): Promise<Record<string, number>>;
  getOperationalSupports?(runtime: LargeMasterSyncV3RuntimeVersion, itemIds: string[], warehouseId: string): Promise<{
    balances: Record<string, { qtyOnHand: number; qtyReserved: number; qtyCommitted: number }>;
    variants: Record<string, Record<string, unknown>[]>;
  }>;
  replaceInventorySnapshot(runtime: LargeMasterSyncV3RuntimeVersion, snapshot: LargeMasterSyncV3InventorySnapshot): Promise<void>;
  getInventorySnapshotVersion(runtime: LargeMasterSyncV3RuntimeVersion): Promise<{ version: number; cursor: string } | null>;
  getInventoryBalance(runtime: LargeMasterSyncV3RuntimeVersion, itemId: string, warehouseId: string): Promise<{
    qtyOnHand: number; qtyReserved: number; qtyCommitted: number;
  } | null>;
  /** Explicit maintenance path; callers schedule it only while the POS is operationally idle. */
  cleanupExpiredVersions(olderThanIso: string, maxVersions?: number): Promise<number>;
}

/** Administrative display only; never a sale/cart Product or availability authority. */
export interface V3CatalogArticle {
  id: string; name: string; sku: string | null; barcode: string | null; categoryId: string | null;
  active: boolean; sellable: boolean; type: string | null; price: number | null; balance: number | null;
}
export interface V3CatalogPageRequest {
  query?: string; category?: 'ALL' | 'NONE'; afterId?: string | null; limit?: number;
  tariffId: string; warehouseId: string; inventoryVersion: number; inventoryCursor: string;
}
export interface V3CatalogPage { rows: V3CatalogArticle[]; total: number; filteredTotal: number; nextCursor: string | null }

export class LargeMasterSyncV3Error extends Error {
  constructor(public readonly code: string, message = code, public readonly retryable = false) {
    super(message);
    this.name = 'LargeMasterSyncV3Error';
  }
}
