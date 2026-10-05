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

export interface LargeMasterSyncV3Store {
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
  searchOperationalArticles(runtime: LargeMasterSyncV3RuntimeVersion, query: string, categoryId?: string | null, limit?: number): Promise<Record<string, unknown>[]>;
  getOperationalArticle(runtime: LargeMasterSyncV3RuntimeVersion, articleId: string): Promise<Record<string, unknown> | null>;
  getOperationalTariffs(runtime: LargeMasterSyncV3RuntimeVersion): Promise<Record<string, unknown>[]>;
  getOperationalTaxes(runtime: LargeMasterSyncV3RuntimeVersion): Promise<Record<string, unknown>[]>;
  getOperationalVariants(runtime: LargeMasterSyncV3RuntimeVersion, articleId: string): Promise<Record<string, unknown>[]>;
  getPrices(runtime: LargeMasterSyncV3RuntimeVersion, articleIds: string[], tariffId: string): Promise<Array<{ articleId: string; tariffId: string; price: number }>>;
  findBarcode(runtime: LargeMasterSyncV3RuntimeVersion, barcode: string): Promise<{ articleId: string; variantId: string | null } | null>;
  /** Explicit maintenance path; callers schedule it only while the POS is operationally idle. */
  cleanupExpiredVersions(olderThanIso: string, maxVersions?: number): Promise<number>;
}

export class LargeMasterSyncV3Error extends Error {
  constructor(public readonly code: string, message = code, public readonly retryable = false) {
    super(message);
    this.name = 'LargeMasterSyncV3Error';
  }
}
