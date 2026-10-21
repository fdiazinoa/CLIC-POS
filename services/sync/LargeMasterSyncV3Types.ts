import type {BusinessConfig} from '../../types';
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

export interface LargeMasterSyncV3InventoryAuthority extends LargeMasterSyncV3RuntimeVersion { version: number; cursor: string }
export interface LargeMasterSyncV3IdentityReadContext { readonly readConfig: () => Promise<BusinessConfig> }
export interface LargeMasterSyncV3CatalogTransition { binding: string; expectedCatalog: LargeMasterSyncV3RuntimeVersion; inventory: LargeMasterSyncV3InventoryAuthority; assertIdentity?: (context?: LargeMasterSyncV3IdentityReadContext) => void | Promise<void> }

export interface LargeMasterSyncV3Store {
  getInventoryAuthority?(): Promise<LargeMasterSyncV3InventoryAuthority | null>;
  assertCanReplaceUnusedBaseline?(transition: LargeMasterSyncV3CatalogTransition): Promise<void>;
  activateUnusedBaseline?(syncId: string, snapshot: LargeMasterSyncV3InventorySnapshot, transition: LargeMasterSyncV3CatalogTransition): Promise<LargeMasterSyncV3RuntimeVersion>;
  prepareCatalogOnly?(manifest: LargeMasterSyncV3Manifest, transition: LargeMasterSyncV3CatalogTransition): Promise<void>;
  activateCatalogOnly?(syncId: string, transition: LargeMasterSyncV3CatalogTransition): Promise<LargeMasterSyncV3RuntimeVersion>;
  getCatalogReceipt?(runtime: LargeMasterSyncV3RuntimeVersion, binding: string): Promise<LargeMasterSyncV3InventoryAuthority | null>;
  readProductionCatalogPage?(runtime: LargeMasterSyncV3RuntimeVersion, request: V3ProductionCatalogRequest): Promise<V3ProductionCatalogPage>;
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
  /** Native-owned atomic projection: absolute reconciled availability avoids cancelling a stale floating V3 balance. */
  getOperationalStockProjection?(baseline:string,itemIds:string[],warehouseId:string):Promise<{
    mode:'RECONCILED_AVAILABLE'|'LEGACY_DELTA';quantities:Record<string,number>;
  }>;
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
  departmentId?: string | null; sectionId?: string | null; familyId?: string | null; brandId?: string | null; posCategoryId?: string | null;
  active: boolean; sellable: boolean; type: string | null; price: number | null; balance: number | null; stock?: number | null;
}
export interface V3CatalogPageRequest {
  /** Optional operational POS identity filter; legacy administrative callers are unchanged. */
  operationalCategoryKeys?: readonly string[];
  query?: string; category?: 'ALL' | 'NONE';
  departmentId?: string; sectionId?: string; familyId?: string; brandId?: string; categoryId?: string; posCategoryId?: string;
  afterId?: string | null; limit?: number;
  tariffId: string; warehouseId: string; inventoryVersion: number; inventoryCursor: string;
}
export interface V3CatalogPage { rows: V3CatalogArticle[]; total: number; filteredTotal: number; nextCursor: string | null }

export class LargeMasterSyncV3Error extends Error {
  constructor(public readonly code: string, message = code, public readonly retryable = false) {
    super(message);
    this.name = 'LargeMasterSyncV3Error';
  }
}

/** Metadata administration only: no price, inventory or sellability authority. */
export interface V3ProductionArticle { id: string; name: string; sku: string | null; categoryId: string;
  productionAreaId: string | null; productType: string; unsupported: boolean }
export interface V3ProductionCatalogRequest { query?: string; categoryId?: string; afterId?: string | null; limit?: number }
export interface V3ProductionCatalogPage { rows: V3ProductionArticle[]; total: number; filteredTotal: number;
  nextCursor: string | null; categories: Array<{id: string; label: string; count: number}>;
  assignedCounts: Record<string, number> }
