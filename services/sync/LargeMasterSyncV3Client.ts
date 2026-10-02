import {
  LARGE_MASTER_SYNC_V3_DATASETS,
  LARGE_MASTER_SYNC_V3_SCHEMA_VERSION,
  LargeMasterSyncV3Error,
  type LargeMasterSyncV3Chunk,
  type LargeMasterSyncV3ChunkEnvelope,
  type LargeMasterSyncV3Dataset,
  type LargeMasterSyncV3DatasetManifest,
  type LargeMasterSyncV3Manifest,
  type LargeMasterSyncV3RuntimeVersion,
  type LargeMasterSyncV3Store,
} from './LargeMasterSyncV3Types';
import { waitForLargeMasterSyncV3OperationalWindow } from './LargeMasterSyncV3OperationGate';

export interface LargeMasterSyncV3HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export interface LargeMasterSyncV3Transport {
  request(path: string, init: { method: 'GET' | 'POST'; signal?: AbortSignal }): Promise<LargeMasterSyncV3HttpResponse>;
}

export interface LargeMasterSyncV3Metric {
  event: string;
  syncId?: string;
  syncVersion?: number;
  dataset?: LargeMasterSyncV3Dataset;
  chunkIndex?: number;
  downloadMs?: number;
  hashMs?: number;
  parseMs?: number;
  sqliteMs?: number;
  commitMs?: number;
  records?: number;
  rawBytes?: number;
  retryCount?: number;
  progress?: number;
  sqliteFileSize?: number;
  memoryBytes?: number;
  totalSyncMs?: number;
  recordsPerSecond?: number;
  chunksPerSecond?: number;
  pauseTimeDueToSales?: number;
  errorCode?: string;
}

export interface LargeMasterSyncV3StorageStats {
  availableBytes: number;
  totalBytes: number;
}

export interface LargeMasterSyncV3ClientOptions {
  store: LargeMasterSyncV3Store;
  transport: LargeMasterSyncV3Transport;
  storageStats?: () => Promise<LargeMasterSyncV3StorageStats>;
  metric?: (metric: LargeMasterSyncV3Metric) => void;
  maxRetries?: number;
  maxManifestPolls?: number;
  backoffMs?: (attempt: number) => number;
}

type RequestResult = {
  syncId: string;
  syncVersion: number;
  schemaVersion: number;
  status: string;
  manifestUrl: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const asObject = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const header = (headers: Record<string, string>, name: string): string => {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match ? String(match[1]) : '';
};
const parseJson = (text: string, code: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new LargeMasterSyncV3Error(code);
  }
};
const numeric = (value: unknown, field: string): number => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new LargeMasterSyncV3Error('SYNC_V3_MANIFEST_INVALID', field);
  }
  return number;
};
const hex = (buffer: ArrayBuffer): string => [...new Uint8Array(buffer)]
  .map(value => value.toString(16).padStart(2, '0')).join('');

export const sha256Utf8 = async (text: string): Promise<string> => {
  if (!globalThis.crypto?.subtle) throw new LargeMasterSyncV3Error('SYNC_V3_WEB_CRYPTO_UNAVAILABLE');
  return hex(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text)));
};

export const validateLargeMasterSyncV3Manifest = (input: unknown, expectedSyncId?: string): LargeMasterSyncV3Manifest => {
  const manifest = asObject(input);
  const syncId = String(manifest.syncId || '');
  if (!UUID.test(syncId) || (expectedSyncId && syncId !== expectedSyncId)
    || manifest.schemaVersion !== LARGE_MASTER_SYNC_V3_SCHEMA_VERSION
    || manifest.type !== 'FULL' || manifest.status !== 'READY'
    || !Number.isSafeInteger(manifest.syncVersion) || Number(manifest.syncVersion) < 0) {
    throw new LargeMasterSyncV3Error('SYNC_V3_MANIFEST_INVALID');
  }
  const sourceDatasets = asObject(manifest.datasets);
  const sourceKeys = Object.keys(sourceDatasets);
  if (sourceKeys.some(key => !(LARGE_MASTER_SYNC_V3_DATASETS as readonly string[]).includes(key))
    || LARGE_MASTER_SYNC_V3_DATASETS.some(dataset => !(dataset in sourceDatasets))) {
    throw new LargeMasterSyncV3Error('SYNC_V3_MANIFEST_DATASETS_INVALID');
  }
  const datasets: Partial<Record<LargeMasterSyncV3Dataset, LargeMasterSyncV3DatasetManifest>> = {};
  for (const dataset of LARGE_MASTER_SYNC_V3_DATASETS) {
    const source = asObject(sourceDatasets[dataset]);
    const count = numeric(source.count, `${dataset}.count`);
    const chunks = numeric(source.chunks, `${dataset}.chunks`);
    const bytes = numeric(source.bytes, `${dataset}.bytes`);
    const gzipBytes = numeric(source.gzipBytes, `${dataset}.gzipBytes`);
    const checksum = source.checksum == null ? null : String(source.checksum);
    if (!checksum || !SHA256.test(checksum) || (chunks === 0) !== (count === 0)) {
      throw new LargeMasterSyncV3Error('SYNC_V3_MANIFEST_DATASETS_INVALID', dataset);
    }
    datasets[dataset] = { count, chunks, bytes, gzipBytes, checksum };
  }
  return {
    syncId,
    syncVersion: Number(manifest.syncVersion),
    schemaVersion: 3,
    type: 'FULL',
    status: 'READY',
    createdAt: String(manifest.createdAt || ''),
    datasets,
  };
};

export const getNativeLargeMasterSyncV3StorageStats = async (): Promise<LargeMasterSyncV3StorageStats> => {
  const bridge = (globalThis as typeof globalThis & {
    ClicPOSAppBridge?: { getAppStorageStats?: () => string };
  }).ClicPOSAppBridge;
  if (!bridge?.getAppStorageStats) throw new LargeMasterSyncV3Error('SYNC_V3_STORAGE_UNAVAILABLE');
  const stats = asObject(parseJson(String(bridge.getAppStorageStats()), 'SYNC_V3_STORAGE_UNAVAILABLE'));
  const availableBytes = Number(stats.availableBytes);
  const totalBytes = Number(stats.totalBytes);
  if (!Number.isSafeInteger(availableBytes) || availableBytes < 0
    || !Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    throw new LargeMasterSyncV3Error('SYNC_V3_STORAGE_UNAVAILABLE');
  }
  return { availableBytes, totalBytes };
};

export class FetchLargeMasterSyncV3Transport implements LargeMasterSyncV3Transport {
  constructor(
    private readonly baseUrl: string,
    private readonly getHeaders: () => Record<string, string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request(path: string, init: { method: 'GET' | 'POST'; signal?: AbortSignal }): Promise<LargeMasterSyncV3HttpResponse> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
      method: init.method,
      headers: this.getHeaders(),
      signal: init.signal,
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      text: await response.text(),
    };
  }
}

export class LargeMasterSyncV3Client {
  private readonly maxRetries: number;
  private readonly maxManifestPolls: number;
  private readonly backoffMs: (attempt: number) => number;
  private readonly storageStats: () => Promise<LargeMasterSyncV3StorageStats>;

  constructor(private readonly options: LargeMasterSyncV3ClientOptions) {
    this.maxRetries = options.maxRetries ?? 3;
    this.maxManifestPolls = options.maxManifestPolls ?? 120;
    this.backoffMs = options.backoffMs ?? (attempt => Math.min(8000, 500 * 2 ** attempt));
    this.storageStats = options.storageStats ?? getNativeLargeMasterSyncV3StorageStats;
  }

  async requestSync(signal?: AbortSignal): Promise<RequestResult | { fallback: 'legacy' }> {
    const response = await this.requestWithRetry('/api/sync/v3/master-syncs', 'POST', signal);
    const body = asObject(parseJson(response.text, 'SYNC_V3_REQUEST_INVALID'));
    if (body.code === 'SYNC_V3_NOT_ENABLED' && body.fallback === 'legacy') return { fallback: 'legacy' };
    if (![200, 202].includes(response.status)) throw this.httpError(response.status, body);
    const result: RequestResult = {
      syncId: String(body.syncId || ''),
      syncVersion: Number(body.syncVersion),
      schemaVersion: Number(body.schemaVersion),
      status: String(body.status || ''),
      manifestUrl: String(body.manifestUrl || ''),
    };
    if (!UUID.test(result.syncId) || result.schemaVersion !== 3 || !Number.isSafeInteger(result.syncVersion)) {
      throw new LargeMasterSyncV3Error('SYNC_V3_REQUEST_INVALID');
    }
    return result;
  }

  async getManifest(syncId: string, signal?: AbortSignal): Promise<LargeMasterSyncV3Manifest | { generating: true; retryAfterMs: number }> {
    const response = await this.requestWithRetry(`/api/sync/v3/master-syncs/${syncId}/manifest`, 'GET', signal);
    const body = asObject(parseJson(response.text, 'SYNC_V3_MANIFEST_INVALID'));
    if (response.status === 202) {
      const seconds = Number(header(response.headers, 'retry-after'));
      return { generating: true, retryAfterMs: Number.isFinite(seconds) ? Math.max(1000, seconds * 1000) : 2000 };
    }
    if (response.status === 409 || body.status === 'FAILED') throw new LargeMasterSyncV3Error('SYNC_V3_FAILED');
    if (response.status !== 200) throw this.httpError(response.status, body);
    return validateLargeMasterSyncV3Manifest(body, syncId);
  }

  async getChunk(
    manifest: LargeMasterSyncV3Manifest,
    dataset: LargeMasterSyncV3Dataset,
    chunkIndex: number,
    signal?: AbortSignal,
  ): Promise<LargeMasterSyncV3Chunk> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const started = performance.now();
      try {
        const response = await this.options.transport.request(
          `/api/sync/v3/master-syncs/${manifest.syncId}/datasets/${dataset}/chunks/${chunkIndex}`,
          { method: 'GET', signal },
        );
        const downloadMs = performance.now() - started;
        if (response.status !== 200) throw this.httpError(response.status, asObject(parseJson(response.text || '{}', 'SYNC_V3_HTTP_ERROR')));
        const hashStarted = performance.now();
        const checksum = await sha256Utf8(response.text);
        const hashMs = performance.now() - hashStarted;
        const expectedChecksum = header(response.headers, 'x-sync-v3-checksum').replace(/^"|"$/g, '');
        const expectedRecordCount = Number(header(response.headers, 'x-sync-v3-record-count'));
        if (!SHA256.test(expectedChecksum) || checksum !== expectedChecksum) {
          throw new LargeMasterSyncV3Error('SYNC_V3_CHECKSUM_MISMATCH', undefined, true);
        }
        const parseStarted = performance.now();
        const envelope = parseJson(response.text, 'SYNC_V3_CHUNK_JSON_INVALID') as LargeMasterSyncV3ChunkEnvelope;
        const parseMs = performance.now() - parseStarted;
        this.validateChunk(envelope, manifest, dataset, chunkIndex, expectedRecordCount);
        const rawBytes = encoder.encode(response.text).byteLength;
        this.metric({ event: 'chunk_downloaded', syncId: manifest.syncId, syncVersion: manifest.syncVersion,
          dataset, chunkIndex, downloadMs, hashMs, parseMs, records: envelope.records.length,
          rawBytes, retryCount: attempt, memoryBytes: this.memoryBytes() });
        return { envelope, checksum, recordCount: expectedRecordCount, rawBytes, rawText: response.text };
      } catch (error) {
        lastError = error;
        if (!this.retryable(error) || attempt === this.maxRetries) throw error;
        await sleep(this.backoffMs(attempt));
      }
    }
    throw lastError;
  }

  validateChunk(
    envelope: LargeMasterSyncV3ChunkEnvelope,
    manifest: LargeMasterSyncV3Manifest,
    dataset: LargeMasterSyncV3Dataset,
    chunkIndex: number,
    headerRecordCount: number,
  ): void {
    if (!envelope || envelope.schemaVersion !== 3 || envelope.syncId !== manifest.syncId
      || envelope.dataset !== dataset || envelope.chunkIndex !== chunkIndex
      || !Array.isArray(envelope.records) || !Number.isSafeInteger(headerRecordCount)
      || headerRecordCount < 0 || envelope.records.length !== headerRecordCount
      || chunkIndex < 0 || chunkIndex >= Number(manifest.datasets[dataset]?.chunks)) {
      throw new LargeMasterSyncV3Error('SYNC_V3_CHUNK_ENVELOPE_MISMATCH');
    }
  }

  async applyChunk(chunk: LargeMasterSyncV3Chunk): Promise<'APPLIED' | 'ALREADY_APPLIED'> {
    const started = performance.now();
    const result = await this.options.store.applyChunk(chunk);
    const sqliteMs = performance.now() - started;
    this.metric({ event: 'chunk_applied', syncId: chunk.envelope.syncId, dataset: chunk.envelope.dataset,
      chunkIndex: chunk.envelope.chunkIndex, sqliteMs, commitMs: sqliteMs,
      records: chunk.recordCount, rawBytes: chunk.rawBytes });
    return result;
  }

  async resumeSync(syncId: string, signal?: AbortSignal): Promise<LargeMasterSyncV3RuntimeVersion> {
    const startedAt = performance.now();
    let manifest: LargeMasterSyncV3Manifest | null = null;
    for (let poll = 0; poll < this.maxManifestPolls; poll += 1) {
      const result = await this.getManifest(syncId, signal);
      if (!('generating' in result)) {
        manifest = result;
        break;
      }
      await sleep(result.retryAfterMs);
    }
    if (!manifest) throw new LargeMasterSyncV3Error('SYNC_V3_MANIFEST_POLL_EXHAUSTED', undefined, true);
    await this.assertStorageCapacity(manifest);
    await this.options.store.prepare(manifest);
    let totalPauseMs = 0;
    let appliedRecords = 0;
    let appliedChunks = 0;
    for (const dataset of LARGE_MASTER_SYNC_V3_DATASETS) {
      const expected = manifest.datasets[dataset]!;
      let progress = await this.options.store.readProgress(syncId);
      const applied = new Set(progress?.chunks.filter(chunk => chunk.dataset === dataset).map(chunk => chunk.chunkIndex));
      for (let index = 0; index < expected.chunks; index += 1) {
        if (applied.has(index)) continue;
        totalPauseMs += await waitForLargeMasterSyncV3OperationalWindow();
        const chunk = await this.getChunk(manifest, dataset, index, signal);
        const result = await this.applyChunk(chunk);
        if (result === 'APPLIED') {
          appliedRecords += chunk.recordCount;
          appliedChunks += 1;
        }
        progress = await this.options.store.readProgress(syncId);
        this.metric({ event: 'chunk_progress', syncId, syncVersion: manifest.syncVersion, dataset,
          chunkIndex: index, progress: expected.chunks ? Number(progress?.datasets.find(item => item.dataset === dataset)?.appliedChunks || 0) / expected.chunks : 1,
          sqliteFileSize: await this.options.store.getDatabaseSizeBytes() });
      }
      await this.validateDataset(manifest, dataset);
    }
    await this.validateSync(manifest);
    const runtime = await this.activateSync(syncId);
    const totalSyncMs = performance.now() - startedAt;
    this.metric({ event: 'sync_activated', syncId, syncVersion: manifest.syncVersion, totalSyncMs,
      recordsPerSecond: totalSyncMs > 0 ? appliedRecords / (totalSyncMs / 1000) : 0,
      chunksPerSecond: totalSyncMs > 0 ? appliedChunks / (totalSyncMs / 1000) : 0,
      pauseTimeDueToSales: totalPauseMs, sqliteFileSize: await this.options.store.getDatabaseSizeBytes(),
      memoryBytes: this.memoryBytes() });
    return runtime;
  }

  async validateSync(manifest: LargeMasterSyncV3Manifest): Promise<void> {
    const progress = await this.options.store.readProgress(manifest.syncId);
    if (!progress || progress.syncVersion !== manifest.syncVersion
      || progress.datasets.some(dataset => dataset.status !== 'VALIDATED')) {
      throw new LargeMasterSyncV3Error('SYNC_V3_SYNC_INCOMPLETE');
    }
    await this.options.store.validateStaging(manifest.syncId);
  }

  activateSync(syncId: string): Promise<LargeMasterSyncV3RuntimeVersion> {
    return this.options.store.activate(syncId);
  }

  rollbackSync(): Promise<LargeMasterSyncV3RuntimeVersion> {
    return this.options.store.rollback();
  }

  private async validateDataset(manifest: LargeMasterSyncV3Manifest, dataset: LargeMasterSyncV3Dataset): Promise<void> {
    const progress = await this.options.store.readProgress(manifest.syncId);
    const expected = manifest.datasets[dataset]!;
    const row = progress?.datasets.find(item => item.dataset === dataset);
    if (!row || row.appliedCount !== expected.count || row.appliedChunks !== expected.chunks) {
      throw new LargeMasterSyncV3Error('SYNC_V3_DATASET_INCOMPLETE');
    }
    const checksums = (progress?.chunks || []).filter(chunk => chunk.dataset === dataset)
      .sort((left, right) => left.chunkIndex - right.chunkIndex).map(chunk => chunk.checksum).join('');
    const checksum = await sha256Utf8(checksums);
    if (!expected.checksum || checksum !== expected.checksum) {
      throw new LargeMasterSyncV3Error('SYNC_V3_DATASET_CHECKSUM_MISMATCH');
    }
    await this.options.store.markDatasetValidated(manifest.syncId, dataset);
  }

  private async assertStorageCapacity(manifest: LargeMasterSyncV3Manifest): Promise<void> {
    const stats = await this.storageStats();
    const logicalBytes = LARGE_MASTER_SYNC_V3_DATASETS.reduce(
      (sum, dataset) => sum + Number(manifest.datasets[dataset]?.bytes || 0), 0,
    );
    const requiredBytes = Math.ceil(logicalBytes * 2.25) + 64 * 1024 * 1024;
    if (stats.availableBytes < requiredBytes) {
      throw new LargeMasterSyncV3Error('SYNC_V3_INSUFFICIENT_STORAGE');
    }
  }

  private async requestWithRetry(path: string, method: 'GET' | 'POST', signal?: AbortSignal): Promise<LargeMasterSyncV3HttpResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.options.transport.request(path, { method, signal });
        if ([408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
          throw new LargeMasterSyncV3Error('SYNC_V3_HTTP_TEMPORARY', String(response.status), true);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (!this.retryable(error) || attempt === this.maxRetries) throw error;
        await sleep(this.backoffMs(attempt));
      }
    }
    throw lastError;
  }

  private httpError(status: number, body: Record<string, unknown>): LargeMasterSyncV3Error {
    const code = String(body.code || `SYNC_V3_HTTP_${status}`);
    return new LargeMasterSyncV3Error(code, code, [408, 425, 429, 500, 502, 503, 504].includes(status));
  }

  private retryable(error: unknown): boolean {
    return error instanceof LargeMasterSyncV3Error ? error.retryable
      : !(error instanceof DOMException && error.name === 'AbortError');
  }

  private metric(metric: LargeMasterSyncV3Metric): void {
    this.options.metric?.(metric);
  }

  private memoryBytes(): number | undefined {
    return Number((performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize) || undefined;
  }
}
