import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL } from '../services/db/LargeMasterSyncV3Schema';
import { LargeMasterSyncV3SqliteStore } from '../services/db/LargeMasterSyncV3SqliteStore';
import {
  LargeMasterSyncV3Client,
  sha256Utf8,
  type LargeMasterSyncV3HttpResponse,
  type LargeMasterSyncV3Metric,
  type LargeMasterSyncV3Transport,
} from '../services/sync/LargeMasterSyncV3Client';
import {
  LARGE_MASTER_SYNC_V3_DATASETS,
  type LargeMasterSyncV3Dataset,
  type LargeMasterSyncV3Manifest,
} from '../services/sync/LargeMasterSyncV3Types';

const syncId = '00000000-0000-4000-8000-000000000099';
const articleCount = Number(process.argv.find(argument => argument.startsWith('--articles='))?.split('=')[1] || 10_000);
const tariffCount = 6;
const chunkRows = 1000;
if (!Number.isSafeInteger(articleCount) || articleCount < 1 || articleCount > 100_000) {
  throw new Error('Use --articles=1..100000');
}

const recordsFor = (dataset: LargeMasterSyncV3Dataset, chunkIndex: number): unknown[] => {
  if (dataset === 'taxes') return chunkIndex === 0 ? [{ id: 'ITBIS', code: '18', name: 'ITBIS', rate: 18, active: true }] : [];
  if (dataset === 'tariffs') return chunkIndex === 0
    ? Array.from({ length: tariffCount }, (_, index) => ({ id: `T${index + 1}`, code: `T${index + 1}`, name: `Tarifa ${index + 1}`, currency: 'DOP', active: true })) : [];
  if (dataset === 'variants') return [];
  const total = dataset === 'prices' ? articleCount * tariffCount : articleCount;
  const start = chunkIndex * chunkRows;
  const end = Math.min(total, start + chunkRows);
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
    const flat = start + offset;
    if (dataset === 'articles') return { id: `A${flat.toString().padStart(6, '0')}`, sku: `SKU-${flat}`,
      description: `Artículo ${flat}`, taxable: true, taxIds: ['ITBIS'], active: true };
    if (dataset === 'barcodes') return { articleId: `A${flat.toString().padStart(6, '0')}`, code: `746${flat.toString().padStart(10, '0')}` };
    const article = Math.floor(flat / tariffCount);
    const tariff = flat % tariffCount;
    return { articleId: `A${article.toString().padStart(6, '0')}`, tariffId: `T${tariff + 1}`, price: article + tariff / 10 };
  });
};

const textFor = (dataset: LargeMasterSyncV3Dataset, chunkIndex: number): string => JSON.stringify({
  schemaVersion: 3, syncId, dataset, chunkIndex, records: recordsFor(dataset, chunkIndex),
});

const buildManifest = async () => {
  const datasets: LargeMasterSyncV3Manifest['datasets'] = {};
  const metadata = new Map<string, { checksum: string; count: number }>();
  for (const dataset of LARGE_MASTER_SYNC_V3_DATASETS) {
    const count = dataset === 'prices' ? articleCount * tariffCount
      : dataset === 'variants' ? 0 : dataset === 'taxes' ? 1 : dataset === 'tariffs' ? tariffCount : articleCount;
    const chunks = count === 0 ? 0 : Math.ceil(count / chunkRows);
    let bytes = 0;
    const checksums: string[] = [];
    for (let index = 0; index < chunks; index += 1) {
      const text = textFor(dataset, index);
      const checksum = await sha256Utf8(text);
      const recordCount = recordsFor(dataset, index).length;
      metadata.set(`${dataset}:${index}`, { checksum, count: recordCount });
      checksums.push(checksum);
      bytes += Buffer.byteLength(text);
    }
    datasets[dataset] = { count, chunks, bytes, gzipBytes: 0, checksum: await sha256Utf8(checksums.join('')) };
  }
  return {
    manifest: { syncId, syncVersion: 999, schemaVersion: 3, type: 'FULL', status: 'READY',
      createdAt: new Date().toISOString(), datasets } satisfies LargeMasterSyncV3Manifest,
    metadata,
  };
};

const percentile = (values: number[], quantile: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
};

const temp = mkdtempSync(join(tmpdir(), 'clic-pos-sync-v3-'));
try {
  const { manifest, metadata } = await buildManifest();
  class SyntheticTransport implements LargeMasterSyncV3Transport {
    async request(path: string): Promise<LargeMasterSyncV3HttpResponse> {
      if (path.endsWith('/manifest')) return { status: 200, headers: {}, text: JSON.stringify(manifest) };
      const match = path.match(/datasets\/([^/]+)\/chunks\/(\d+)$/);
      if (!match) throw new Error(`Unexpected path ${path}`);
      const dataset = match[1] as LargeMasterSyncV3Dataset;
      const index = Number(match[2]);
      const item = metadata.get(`${dataset}:${index}`)!;
      return { status: 200, text: textFor(dataset, index), headers: {
        'X-Sync-V3-Checksum': item.checksum, 'X-Sync-V3-Record-Count': String(item.count),
      } };
    }
  }
  const sqlite = new Database(join(temp, 'receiver.sqlite'));
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
  const connection = {
    async execute(sql: string) { sqlite.exec(sql); },
    async query(sql: string, values: unknown[] = []) { return { values: sqlite.prepare(sql).all(...values) as Array<Record<string, unknown>> }; },
    async run(sql: string, values: unknown[] = []) {
      const info = sqlite.prepare(sql).run(...values);
      return { changes: { changes: info.changes } };
    },
  };
  let writeQueue: Promise<unknown> = Promise.resolve();
  const writeLock = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  const store = new LargeMasterSyncV3SqliteStore(() => connection, writeLock);
  const metrics: LargeMasterSyncV3Metric[] = [];
  let peakRss = process.memoryUsage().rss;
  const started = performance.now();
  const client = new LargeMasterSyncV3Client({ store, transport: new SyntheticTransport(),
    storageStats: async () => ({ availableBytes: 10e9, totalBytes: 20e9 }), maxRetries: 0,
    metric: metric => { metrics.push(metric); peakRss = Math.max(peakRss, process.memoryUsage().rss); } });
  await client.resumeSync(syncId);
  const totalMs = performance.now() - started;
  const chunkMetrics = metrics.filter(metric => metric.event === 'chunk_applied');
  const sqliteTimes = chunkMetrics.map(metric => Number(metric.sqliteMs || 0));
  const result = {
    articles: articleCount,
    prices: articleCount * tariffCount,
    chunks: chunkMetrics.length,
    totalMs: Math.round(totalMs),
    recordsPerSecond: Math.round((articleCount * (tariffCount + 2) + tariffCount + 1) / (totalMs / 1000)),
    sqliteChunkMs: { p50: percentile(sqliteTimes, 0.5), p95: percentile(sqliteTimes, 0.95),
      p99: percentile(sqliteTimes, 0.99), max: Math.max(...sqliteTimes) },
    peakRssMb: Math.round(peakRss / 1048576),
    endRssMb: Math.round(process.memoryUsage().rss / 1048576),
    databaseBytes: await store.getDatabaseSizeBytes(),
  };
  console.log(JSON.stringify(result));
  sqlite.close();
} finally {
  rmSync(temp, { recursive: true, force: true });
}
