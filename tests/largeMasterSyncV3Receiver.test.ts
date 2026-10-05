import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL } from '../services/db/LargeMasterSyncV3Schema';
import {
  LargeMasterSyncV3SqliteStore,
  type LargeMasterSyncV3SqliteFaultHook,
} from '../services/db/LargeMasterSyncV3SqliteStore';
import {
  LargeMasterSyncV3Client,
  sha256Utf8,
  validateLargeMasterSyncV3Manifest,
  validateOperationalLargeMasterSyncV3Manifest,
  type LargeMasterSyncV3HttpResponse,
  type LargeMasterSyncV3Transport,
} from '../services/sync/LargeMasterSyncV3Client';
import {
  LARGE_MASTER_SYNC_V3_DATASETS,
  LargeMasterSyncV3Error,
  type LargeMasterSyncV3Dataset,
  type LargeMasterSyncV3Manifest,
} from '../services/sync/LargeMasterSyncV3Types';
import { LargeMasterSyncV3Runtime } from '../services/sync/LargeMasterSyncV3Runtime';
import {
  bootstrapLargeMasterSyncV3Lifecycle,
  getLargeMasterSyncV3Runtime,
  resetLargeMasterSyncV3LifecycleForTests,
} from '../services/sync/LargeMasterSyncV3Lifecycle';
import {
  resetLargeMasterSyncV3OperationGateForTests,
  setLargeMasterSyncV3CriticalOperation,
  waitForLargeMasterSyncV3OperationalWindow,
} from '../services/sync/LargeMasterSyncV3OperationGate';
import { setPosSaleActivity } from '../utils/posSaleActivity';
import { readFileSync } from 'node:fs';

const SYNC_ID = '00000000-0000-4000-8000-000000000001';
const queryCount = (sqlite: Database.Database, table: string): number =>
  Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);

const serialWriteLock = () => {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
};

const sqliteStore = (fault?: LargeMasterSyncV3SqliteFaultHook, nativeBatch = false) => {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
  const executeSetCalls: number[] = [];
  const baseConnection = {
    async execute(sql: string) { sqlite.exec(sql); },
    async query(sql: string, values: unknown[] = []) {
      return { values: sqlite.prepare(sql).all(...values) as Array<Record<string, unknown>> };
    },
    async run(sql: string, values: unknown[] = []) {
      const info = sqlite.prepare(sql).run(...values);
      return { changes: { changes: info.changes } };
    },
  };
  const connection = nativeBatch ? {
    ...baseConnection,
    async executeSet(statements: Array<{ statement: string; values: unknown[] }>, transaction = true, returnMode = '') {
      assert.equal(transaction, false);
      assert.equal(returnMode, 'no');
      executeSetCalls.push(statements.length);
      for (const entry of statements) sqlite.prepare(entry.statement).run(...entry.values);
      return { changes: { changes: statements.length } };
    },
  } : baseConnection;
  const writeLock = serialWriteLock();
  return { sqlite, connection, executeSetCalls, writeLock,
    store: new LargeMasterSyncV3SqliteStore(() => connection, writeLock, fault) };
};

const chunkText = (dataset: LargeMasterSyncV3Dataset, chunkIndex: number, records: unknown[], syncId = SYNC_ID) =>
  JSON.stringify({ schemaVersion: 3, syncId, dataset, chunkIndex, records });

const manifestAndResponses = async (
  input: Partial<Record<LargeMasterSyncV3Dataset, unknown[][]>>,
  version = 186,
  syncId = SYNC_ID,
  declaredDatasets: readonly LargeMasterSyncV3Dataset[] = LARGE_MASTER_SYNC_V3_DATASETS,
) => {
  const responses = new Map<string, LargeMasterSyncV3HttpResponse>();
  const datasets: LargeMasterSyncV3Manifest['datasets'] = {};
  for (const dataset of LARGE_MASTER_SYNC_V3_DATASETS.filter(candidate => declaredDatasets.includes(candidate))) {
    const chunks = input[dataset] || [];
    const texts = chunks.map((records, index) => chunkText(dataset, index, records, syncId));
    const checksums = await Promise.all(texts.map(sha256Utf8));
    datasets[dataset] = {
      count: chunks.reduce((sum, records) => sum + records.length, 0),
      chunks: chunks.length,
      bytes: texts.reduce((sum, text) => sum + new TextEncoder().encode(text).byteLength, 0),
      gzipBytes: 0,
      checksum: await sha256Utf8(checksums.join('')),
    };
    texts.forEach((text, index) => responses.set(
      `/api/sync/v3/master-syncs/${syncId}/datasets/${dataset}/chunks/${index}`,
      { status: 200, text, headers: {
        'X-Sync-V3-Checksum': checksums[index],
        'X-Sync-V3-Record-Count': String(chunks[index].length),
      } },
    ));
  }
  const manifest: LargeMasterSyncV3Manifest = {
    syncId,
    syncVersion: version,
    schemaVersion: 3,
    type: 'FULL',
    status: 'READY',
    createdAt: '2026-10-01T00:00:00.000Z',
    datasets,
  };
  responses.set(`/api/sync/v3/master-syncs/${syncId}/manifest`, {
    status: 200, headers: {}, text: JSON.stringify(manifest),
  });
  return { manifest, responses };
};

class MapTransport implements LargeMasterSyncV3Transport {
  readonly requests: string[] = [];
  constructor(private readonly responses: Map<string, LargeMasterSyncV3HttpResponse>) {}
  async request(path: string): Promise<LargeMasterSyncV3HttpResponse> {
    this.requests.push(path);
    const response = this.responses.get(path);
    if (!response) throw new Error(`Missing fake response: ${path}`);
    return response;
  }
}

test('hashes the exact ERP UTF-8 fixture before parsing', async () => {
  const article = '{"schemaVersion":3,"syncId":"00000000-0000-4000-8000-000000000001","dataset":"articles","chunkIndex":0,"records":[{"id":"0001","sku":"SKU-1","description":"Artículo demo","type":null,"uom":null,"taxable":true,"taxIds":[],"familyId":null,"categoryId":null,"active":true}]}';
  const price = '{"schemaVersion":3,"syncId":"00000000-0000-4000-8000-000000000001","dataset":"prices","chunkIndex":0,"records":[{"articleId":"0001","tariffId":"T1","price":100}]}';
  assert.equal(await sha256Utf8(article), '3d1f97225f2a1ad3b585616e91e68539316799c21a3eedb686d790723e90c9fd');
  assert.equal(await sha256Utf8(price), '8a27d8960256ccbc6d1a580aa293a094b1d53f60ac5e130d4d4aa3087ca772db');
  assert.notEqual(await sha256Utf8(`${article}\n`), await sha256Utf8(article));
});

test('rejects unsupported schemas, empty manifests, corrupt bytes and mismatched envelopes', async () => {
  const { manifest, responses } = await manifestAndResponses({ articles: [[{ id: 'A', taxable: true, taxIds: [], active: true }]] });
  assert.throws(() => validateLargeMasterSyncV3Manifest({ ...manifest, schemaVersion: 4 }), /SYNC_V3_MANIFEST_INVALID/);
  assert.throws(() => validateLargeMasterSyncV3Manifest({ ...manifest, datasets: {} }), /SYNC_V3_MANIFEST_DATASETS_INVALID/);
  assert.throws(() => validateLargeMasterSyncV3Manifest({
    ...manifest,
    datasets: { ...manifest.datasets, customers: manifest.datasets.articles },
  }), /SYNC_V3_MANIFEST_DATASETS_INVALID/);
  const path = `/api/sync/v3/master-syncs/${SYNC_ID}/datasets/articles/chunks/0`;
  responses.get(path)!.text += ' ';
  const { store } = sqliteStore();
  const client = new LargeMasterSyncV3Client({ store, transport: new MapTransport(responses),
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  await assert.rejects(() => client.getChunk(manifest, 'articles', 0), /SYNC_V3_CHECKSUM_MISMATCH/);

  const correct = chunkText('articles', 0, [{ id: 'A', taxable: true, taxIds: [], active: true }]);
  for (const invalidRecordCount of ['', '-1', '1.0', '9007199254740992']) {
    responses.set(path, { status: 200, text: correct, headers: {
      'X-Sync-V3-Checksum': await sha256Utf8(correct),
      ...(invalidRecordCount ? { 'X-Sync-V3-Record-Count': invalidRecordCount } : {}),
    } });
    await assert.rejects(() => client.getChunk(manifest, 'articles', 0), (error: unknown) =>
      error instanceof LargeMasterSyncV3Error && error.code === 'SYNC_V3_RECORD_COUNT_INVALID');
  }

  const wrongSync = chunkText('articles', 0, [{ id: 'A' }], '10000000-0000-4000-8000-000000000001');
  responses.set(path, { status: 200, text: wrongSync, headers: {
    'X-Sync-V3-Checksum': await sha256Utf8(wrongSync), 'X-Sync-V3-Record-Count': '1',
  } });
  await assert.rejects(() => client.getChunk(manifest, 'articles', 0), /SYNC_V3_CHUNK_ENVELOPE_MISMATCH/);

  const valid = JSON.parse(chunkText('articles', 0, [{ id: 'A' }], SYNC_ID));
  for (const invalid of [
    { ...valid, dataset: 'prices' },
    { ...valid, chunkIndex: 1 },
    { ...valid, schemaVersion: 2 },
    { ...valid, records: {} },
  ]) {
    assert.throws(() => client.validateChunk(invalid, manifest, 'articles', 0, 1), /SYNC_V3_CHUNK_ENVELOPE_MISMATCH/);
  }
  assert.throws(() => client.validateChunk(valid, manifest, 'articles', 0, 2), /SYNC_V3_CHUNK_ENVELOPE_MISMATCH/);
});

test('operational catalog requires contract v2 authority and separate inventory', async () => {
  const { manifest } = await manifestAndResponses({ articles: [[{ id: 'A', taxable: true, taxIds: [], active: true }]] });
  assert.throws(() => validateOperationalLargeMasterSyncV3Manifest(manifest),
    /SYNC_V3_OPERATIONAL_CONTRACT_REQUIRED/);
  const operational = {
    ...manifest,
    contractVersion: 2,
    authority: {
      catalog: 'V3_SNAPSHOT', prices: 'V3_SNAPSHOT', taxes: 'V3_SNAPSHOT',
      inventory: 'SEPARATE_COLLECTION',
    },
    supplementalCollections: [{
      collection: 'productInventory', domain: 'inventory',
      endpoint: '/api/sync/collections/productInventory/full',
      consistency: 'EVENTUAL_AFTER_V3_ACTIVATION',
    }],
  };
  assert.equal(validateOperationalLargeMasterSyncV3Manifest(operational).contractVersion, 2);
  assert.throws(() => validateOperationalLargeMasterSyncV3Manifest({
    ...operational, authority: { ...operational.authority, prices: 'LEGACY' },
  }), /SYNC_V3_CONTRACT_INVALID/);
  assert.throws(() => validateOperationalLargeMasterSyncV3Manifest({
    ...operational, supplementalCollections: [],
  }), /SYNC_V3_CONTRACT_INVALID/);
  assert.throws(() => validateOperationalLargeMasterSyncV3Manifest({
    ...operational, datasets: { articles: manifest.datasets.articles },
  }), /SYNC_V3_OPERATIONAL_DATASETS_INCOMPLETE/);
});

test('operational download rejects v1 or incomplete manifest before SQLite access', async () => {
  const { manifest, responses } = await manifestAndResponses({ articles: [[{ id: 'A' }]] });
  let storeCalls = 0;
  const store = {
    readProgress: async () => { storeCalls += 1; return null; },
    prepare: async () => { storeCalls += 1; },
  } as never;
  const client = new LargeMasterSyncV3Client({
    store, transport: new MapTransport(responses), requireOperationalContract: true,
  });
  await assert.rejects(() => client.resumeSync(SYNC_ID), /SYNC_V3_OPERATIONAL_CONTRACT_REQUIRED/);
  assert.equal(storeCalls, 0);

  responses.set(`/api/sync/v3/master-syncs/${SYNC_ID}/manifest`, {
    status: 200, headers: {}, text: JSON.stringify({ ...manifest, contractVersion: 2,
      datasets: { articles: manifest.datasets.articles },
      authority: { catalog: 'V3_SNAPSHOT', prices: 'V3_SNAPSHOT', taxes: 'V3_SNAPSHOT',
        inventory: 'SEPARATE_COLLECTION' },
      supplementalCollections: [{ collection: 'productInventory', domain: 'inventory',
        endpoint: '/api/sync/collections/productInventory/full',
        consistency: 'EVENTUAL_AFTER_V3_ACTIVATION' }],
    }),
  });
  await assert.rejects(() => client.resumeSync(SYNC_ID), /SYNC_V3_OPERATIONAL_DATASETS_INCOMPLETE/);
  assert.equal(storeCalls, 0);
});

test('contract v2 retains operational records and fences the active SQLite version', async () => {
  const article = {
    id: 'A', sku: 'DEMO-001', name: 'Artículo demo', description: 'Artículo demo',
    category: 'Bebidas', categoryId: 'CAT', posCategoryId: 'CAT', active: true,
    sellable: true, inventoriable: true, taxable: true, taxIds: ['TX'],
    operationalFlags: { trackInventory: true },
  };
  const { manifest, responses } = await manifestAndResponses({
    articles: [[article]],
    prices: [[{ articleId: 'A', tariffId: 'T1', price: 125.5 }]],
    tariffs: [[{ id: 'T1', code: 'DET', name: 'Detalle', currency: 'DOP', taxIncluded: true, active: true }]],
    taxes: [[{ id: 'TX', code: 'ITBIS18', name: 'ITBIS 18%', rate: 0.18, active: true }]],
  });
  const operational = {
    ...manifest,
    contractVersion: 2,
    authority: { catalog: 'V3_SNAPSHOT', prices: 'V3_SNAPSHOT', taxes: 'V3_SNAPSHOT',
      inventory: 'SEPARATE_COLLECTION' },
    supplementalCollections: [{ collection: 'productInventory', domain: 'inventory',
      endpoint: '/api/sync/collections/productInventory/full', consistency: 'EVENTUAL_AFTER_V3_ACTIVATION' }],
  };
  responses.set(`/api/sync/v3/master-syncs/${SYNC_ID}/manifest`, {
    status: 200, headers: {}, text: JSON.stringify(operational),
  });
  const { store, sqlite } = sqliteStore();
  const client = new LargeMasterSyncV3Client({ store, transport: new MapTransport(responses),
    requireOperationalContract: true,
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }) });
  assert.deepEqual(await client.resumeSync(SYNC_ID), {
    syncId: SYNC_ID, syncVersion: 186, contractVersion: 2,
  });
  assert.deepEqual(await store.getActiveRuntimeVersion(), {
    syncId: SYNC_ID, syncVersion: 186, contractVersion: 2,
  });
  const stored = sqlite.prepare('SELECT sellable, record_json FROM master_v3_articles WHERE sync_version = 186').get() as {
    sellable: number; record_json: string;
  };
  assert.equal(stored.sellable, 1);
  assert.deepEqual(JSON.parse(stored.record_json), article);
  assert.equal((sqlite.prepare('SELECT contract_version FROM sync_v3_sessions WHERE sync_id = ?')
    .get(SYNC_ID) as { contract_version: number }).contract_version, 2);
  const runtime = await LargeMasterSyncV3Runtime.open(store);
  assert.ok(runtime);
  assert.deepEqual(await runtime.searchOperationalArticles('demo'), [article]);
  assert.deepEqual(await runtime.searchOperationalArticles('demo', 'OTHER'), []);
  assert.deepEqual(await runtime.getOperationalArticle('A'), article);
  assert.equal((await runtime.getOperationalTariffs())[0].taxIncluded, true);
  assert.equal((await runtime.getOperationalTaxes())[0].rate, 0.18);
  assert.deepEqual(await runtime.getOperationalVariants('A'), []);
});

test('treats the disabled V3 response as a non-fatal legacy fallback', async () => {
  const { store } = sqliteStore();
  const transport: LargeMasterSyncV3Transport = { request: async () => ({
    status: 404, headers: {}, text: JSON.stringify({ code: 'SYNC_V3_NOT_ENABLED', fallback: 'legacy' }),
  }) };
  const client = new LargeMasterSyncV3Client({ store, transport, maxRetries: 0 });
  assert.deepEqual(await client.requestSync(), { fallback: 'legacy' });
});

test('manifest is authoritative for a non-empty subset, including zero datasets and barcode alias', async () => {
  const { sqlite, store } = sqliteStore();
  const declared = ['articles', 'variants', 'barcodes'] as const;
  const { manifest, responses } = await manifestAndResponses({
    articles: [[{ id: 'A1', sku: 'ONE', taxable: false, taxIds: [], active: true }]],
    variants: [],
    barcodes: [[{ articleId: 'A1', barcode: '7460999' }]],
  }, 186, SYNC_ID, declared);
  const validated = validateLargeMasterSyncV3Manifest(manifest);
  assert.deepEqual(Object.keys(validated.datasets), declared);
  assert.equal(validated.datasets.variants?.count, 0);
  assert.equal(validated.datasets.variants?.chunks, 0);

  const client = new LargeMasterSyncV3Client({ store, transport: new MapTransport(responses),
    storageStats: async () => ({ availableBytes: 70 * 1024 * 1024, totalBytes: 2e9 }), maxRetries: 0 });
  await client.resumeSync(SYNC_ID);
  const progress = await store.readProgress(SYNC_ID);
  assert.deepEqual(progress?.datasets.map(row => row.dataset), declared);
  assert.equal(queryCount(sqlite, 'master_v3_variants'), 0);
  const runtime = await LargeMasterSyncV3Runtime.open(store);
  assert.deepEqual(await runtime?.findBarcode('7460999'), { articleId: 'A1', variantId: null });
});

test('manifest polling honors GENERATING body on 200/202 and reports FAILED', async () => {
  const { store } = sqliteStore();
  for (const status of [200, 202]) {
    const client = new LargeMasterSyncV3Client({ store, maxRetries: 0, transport: {
      request: async () => ({ status, headers: { 'retry-after': '3', 'content-type': 'application/json' },
        text: JSON.stringify({ syncId: SYNC_ID, status: 'GENERATING' }) }),
    } });
    assert.deepEqual(await client.getManifest(SYNC_ID), { generating: true, retryAfterMs: 3000 });
  }
  for (const status of [200, 202]) {
    const failed = new LargeMasterSyncV3Client({ store, maxRetries: 0, transport: {
      request: async () => ({ status, headers: { 'content-type': 'application/json' },
        text: JSON.stringify({ syncId: SYNC_ID, status: 'FAILED' }) }),
    } });
    await assert.rejects(() => failed.getManifest(SYNC_ID), (error: unknown) =>
      error instanceof LargeMasterSyncV3Error && error.code === 'SYNC_V3_FAILED');
  }
});

test('applies chunks atomically, resumes at the first missing chunk, activates by pointer and serves bounded lookups', async () => {
  const { sqlite, store } = sqliteStore();
  const { manifest, responses } = await manifestAndResponses({
    taxes: [[{ id: 'ITBIS', code: '18', name: 'ITBIS', rate: 18, active: true }]],
    tariffs: [[{ id: 'T1', code: 'T1', name: 'General', currency: 'DOP', active: true }]],
    articles: [
      [{ id: 'A1', sku: 'SKU-1', description: 'Uno', taxable: true, taxIds: ['ITBIS'], active: true }],
      [{ id: 'A2', sku: 'SKU-2', description: 'Dos', taxable: false, taxIds: [], active: true }],
    ],
    barcodes: [[{ articleId: 'A1', code: '7460001' }]],
    prices: [[{ articleId: 'A1', tariffId: 'T1', price: 100 }, { articleId: 'A2', tariffId: 'T1', price: 200 }]],
  });
  await store.prepare(manifest);
  const transport = new MapTransport(responses);
  const client = new LargeMasterSyncV3Client({ store, transport,
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  const firstChunk = await client.getChunk(manifest, 'articles', 0);
  await client.applyChunk(firstChunk);
  assert.equal(await client.applyChunk(firstChunk), 'ALREADY_APPLIED');
  const runtime = await client.resumeSync(SYNC_ID);
  assert.deepEqual(runtime, { syncId: SYNC_ID, syncVersion: 186 });
  const articleRequests = transport.requests.filter(path => path.includes('/datasets/articles/chunks/'));
  assert.deepEqual(articleRequests, [
    `/api/sync/v3/master-syncs/${SYNC_ID}/datasets/articles/chunks/0`,
    `/api/sync/v3/master-syncs/${SYNC_ID}/datasets/articles/chunks/1`,
  ]);
  assert.equal(queryCount(sqlite, 'master_v3_articles'), 2);
  assert.equal(queryCount(sqlite, 'sync_v3_chunks'), 6);
  const catalog = await LargeMasterSyncV3Runtime.open(store);
  assert.ok(catalog);
  assert.deepEqual(await catalog.getPrices(['A1'], 'T1'), [{ articleId: 'A1', tariffId: 'T1', price: 100 }]);
  assert.deepEqual(await catalog.findBarcode('7460001'), { articleId: 'A1', variantId: null });
  assert.equal((await catalog.listArticlesPage(null, 1)).length, 1);
  const plan = sqlite.prepare("EXPLAIN QUERY PLAN SELECT price FROM master_v3_prices WHERE sync_version=? AND article_id=? AND tariff_id=?").all(186, 'A1', 'T1');
  assert.match(JSON.stringify(plan), /sqlite_autoindex_master_v3_prices|idx_master_v3_prices/i);
});

test('rolls back a partially invalid chunk together with its APPLIED marker', async () => {
  const { sqlite, store } = sqliteStore();
  const { manifest } = await manifestAndResponses({ articles: [[
    { id: 'A1', taxable: true, taxIds: [], active: true },
    { taxable: true, taxIds: [], active: true },
  ]] });
  await store.prepare(manifest);
  const rawText = chunkText('articles', 0, manifest.datasets.articles ? [
    { id: 'A1', taxable: true, taxIds: [], active: true },
    { taxable: true, taxIds: [], active: true },
  ] : []);
  await assert.rejects(() => store.applyChunk({
    envelope: JSON.parse(rawText), checksum: 'a'.repeat(64), recordCount: 2,
    rawBytes: new TextEncoder().encode(rawText).byteLength, rawText,
  }), (error: unknown) => error instanceof LargeMasterSyncV3Error && error.code === 'SYNC_V3_RECORD_INVALID');
  assert.equal(queryCount(sqlite, 'master_v3_articles'), 0);
  assert.equal(queryCount(sqlite, 'sync_v3_chunks'), 0);
});

test('native sqlite path sends one executeSet call per bounded 250-record subbatch', async () => {
  const { store, executeSetCalls } = sqliteStore(undefined, true);
  const records = Array.from({ length: 501 }, (_, index) => ({ id: `T${index}`, active: true }));
  const { manifest, responses } = await manifestAndResponses({ taxes: [records] }, 186, SYNC_ID, ['taxes']);
  await store.prepare(manifest);
  const client = new LargeMasterSyncV3Client({ store, transport: new MapTransport(responses), maxRetries: 0 });
  await client.applyChunk(await client.getChunk(manifest, 'taxes', 0));
  assert.deepEqual(executeSetCalls, [250, 250, 1]);
});

test('fails closed when StatFs capacity cannot hold staging plus SQLite overhead', async () => {
  const { store } = sqliteStore();
  const { responses } = await manifestAndResponses({ articles: [[{ id: 'A1', taxable: true, taxIds: [], active: true }]] });
  const client = new LargeMasterSyncV3Client({ store, transport: new MapTransport(responses),
    storageStats: async () => ({ availableBytes: 1024, totalBytes: 2048 }), maxRetries: 0 });
  await assert.rejects(() => client.resumeSync(SYNC_ID), (error: unknown) =>
    error instanceof LargeMasterSyncV3Error && error.code === 'SYNC_V3_INSUFFICIENT_STORAGE');
  assert.equal(await store.findIncomplete(), null);
});

test('keeps ACTIVE unchanged on failed activation and can atomically roll back to previous', async () => {
  const firstId = '00000000-0000-4000-8000-000000000001';
  const secondId = '00000000-0000-4000-8000-000000000002';
  const { store } = sqliteStore();
  const first = await manifestAndResponses({
    tariffs: [[{ id: 'T1', active: true }]],
    articles: [[{ id: 'A1', taxable: false, taxIds: [], active: true }]],
    prices: [[{ articleId: 'A1', tariffId: 'T1', price: 100 }]],
  }, 186, firstId);
  const firstClient = new LargeMasterSyncV3Client({ store, transport: new MapTransport(first.responses),
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  await firstClient.resumeSync(firstId);

  const second = await manifestAndResponses({
    tariffs: [[{ id: 'T1', active: true }]],
    articles: [[{ id: 'A2', taxable: false, taxIds: [], active: true }]],
    prices: [[{ articleId: 'A2', tariffId: 'T1', price: 200 }]],
  }, 187, secondId);
  await store.prepare(second.manifest);
  await assert.rejects(() => store.activate(secondId), /SYNC_V3_ACTIVATION_PRECONDITION_FAILED/);
  assert.deepEqual(await store.getActiveRuntimeVersion(), { syncId: firstId, syncVersion: 186 });

  const secondClient = new LargeMasterSyncV3Client({ store, transport: new MapTransport(second.responses),
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  await secondClient.resumeSync(secondId);
  assert.deepEqual(await store.getActiveRuntimeVersion(), { syncId: secondId, syncVersion: 187 });
  assert.deepEqual(await secondClient.rollbackSync(), { syncId: firstId, syncVersion: 186 });
  assert.deepEqual(await store.getActiveRuntimeVersion(), { syncId: firstId, syncVersion: 186 });
});

test('rejects orphan article tax and barcode variant references before activation', async () => {
  const taxCase = sqliteStore();
  const orphanTax = await manifestAndResponses({
    taxes: [[{ id: 'T1', active: true }]],
    articles: [[{ id: 'A1', taxable: true, taxIds: ['T404'], active: true }]],
  }, 186, SYNC_ID, ['taxes', 'articles']);
  const taxClient = new LargeMasterSyncV3Client({ store: taxCase.store,
    transport: new MapTransport(orphanTax.responses),
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  await assert.rejects(() => taxClient.resumeSync(SYNC_ID), (error: unknown) =>
    error instanceof LargeMasterSyncV3Error && error.code === 'SYNC_V3_ARTICLE_TAX_REFERENCE_INVALID');
  assert.equal(await taxCase.store.getActiveRuntimeVersion(), null);

  const barcodeCase = sqliteStore();
  const orphanVariant = await manifestAndResponses({
    articles: [[{ id: 'A1', taxable: false, taxIds: [], active: true }]],
    variants: [[{ articleId: 'A1', id: 'V1', active: true }]],
    barcodes: [[{ articleId: 'A1', variantId: 'V404', code: '7460001' }]],
  }, 186, SYNC_ID, ['articles', 'variants', 'barcodes']);
  const barcodeClient = new LargeMasterSyncV3Client({ store: barcodeCase.store,
    transport: new MapTransport(orphanVariant.responses),
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  await assert.rejects(() => barcodeClient.resumeSync(SYNC_ID), (error: unknown) =>
    error instanceof LargeMasterSyncV3Error && error.code === 'SYNC_V3_BARCODE_VARIANT_REFERENCE_INVALID');
  assert.equal(await barcodeCase.store.getActiveRuntimeVersion(), null);
});

test('resumes persisted progress after interruptions at 10, 25, 50, 75 and 99 percent', async () => {
  const articleChunks = Array.from({ length: 100 }, (_, index) => [[{
    id: `A${index.toString().padStart(3, '0')}`, taxable: false, taxIds: [], active: true,
  }]][0]);
  for (const interruptedAt of [10, 25, 50, 75, 99]) {
    const { sqlite, store } = sqliteStore();
    const { manifest, responses } = await manifestAndResponses({ articles: articleChunks });
    await store.prepare(manifest);
    const beforeRestart = new LargeMasterSyncV3Client({ store, transport: new MapTransport(responses),
      storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
    for (let index = 0; index < interruptedAt; index += 1) {
      await beforeRestart.applyChunk(await beforeRestart.getChunk(manifest, 'articles', index));
    }
    const afterRestartTransport = new MapTransport(responses);
    const afterRestart = new LargeMasterSyncV3Client({ store, transport: afterRestartTransport,
      storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
    await afterRestart.resumeSync(SYNC_ID);
    const resumed = afterRestartTransport.requests.filter(path => path.includes('/datasets/articles/chunks/'));
    assert.equal(resumed.length, 100 - interruptedAt);
    assert.ok(resumed[0].endsWith(`/chunks/${interruptedAt}`));
    assert.equal(queryCount(sqlite, 'master_v3_articles'), 100);
    assert.deepEqual(await store.getActiveRuntimeVersion(), { syncId: SYNC_ID, syncVersion: 186 });
    sqlite.close();
  }
});

test('resume fills the first real chunk gap and recalculates progress with higher applied indexes', async () => {
  const { sqlite, store } = sqliteStore();
  const records = Array.from({ length: 5 }, (_, index) => [{
    id: `A${index}`, taxable: false, taxIds: [], active: true,
  }]);
  const { manifest, responses } = await manifestAndResponses({ articles: records }, 186, SYNC_ID, ['articles']);
  await store.prepare(manifest);
  const seedClient = new LargeMasterSyncV3Client({ store, transport: new MapTransport(responses), maxRetries: 0 });
  await seedClient.applyChunk(await seedClient.getChunk(manifest, 'articles', 0));

  for (const index of [2, 4]) {
    sqlite.prepare(`INSERT INTO master_v3_articles
      (sync_version, article_id, taxable, tax_ids_json, active) VALUES (?, ?, 0, '[]', 1)`)
      .run(186, `A${index}`);
    const response = responses.get(`/api/sync/v3/master-syncs/${SYNC_ID}/datasets/articles/chunks/${index}`)!;
    sqlite.prepare(`INSERT INTO sync_v3_chunks
      (sync_id, dataset, chunk_index, checksum, record_count, raw_bytes, status, applied_at)
      VALUES (?, 'articles', ?, ?, 1, ?, 'APPLIED', ?)`)
      .run(SYNC_ID, index, response.headers['X-Sync-V3-Checksum'],
        new TextEncoder().encode(response.text).byteLength, new Date().toISOString());
  }
  sqlite.prepare(`UPDATE sync_v3_dataset_progress SET applied_count = 99, applied_chunks = 3,
    status = 'APPLYING' WHERE sync_id = ? AND dataset = 'articles'`).run(SYNC_ID);

  assert.equal(await seedClient.applyChunk(await seedClient.getChunk(manifest, 'articles', 1)), 'APPLIED');
  const afterFirstGap = await store.readProgress(SYNC_ID);
  assert.equal(afterFirstGap?.datasets[0].appliedCount, 4);
  assert.equal(afterFirstGap?.datasets[0].appliedChunks, 4);
  assert.equal(afterFirstGap?.datasets[0].status, 'APPLYING');

  const resumeTransport = new MapTransport(responses);
  const client = new LargeMasterSyncV3Client({ store, transport: resumeTransport,
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  await client.resumeSync(SYNC_ID);
  assert.deepEqual(resumeTransport.requests.filter(path => path.includes('/datasets/articles/chunks/')),
    [`/api/sync/v3/master-syncs/${SYNC_ID}/datasets/articles/chunks/3`]);
  const progress = await store.readProgress(SYNC_ID);
  assert.equal(progress?.datasets[0].appliedCount, 5);
  assert.equal(progress?.datasets[0].appliedChunks, 5);
  assert.equal(progress?.datasets[0].status, 'VALIDATED');
  assert.equal(queryCount(sqlite, 'master_v3_articles'), 5);
});

test('shares the adapter write lock and never yields inside BEGIN IMMEDIATE', async () => {
  const { sqlite, store, writeLock } = sqliteStore();
  const { manifest } = await manifestAndResponses({});
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const legacyWrite = writeLock(async () => blocked);
  const preparation = store.prepare(manifest);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(queryCount(sqlite, 'sync_v3_sessions'), 0);
  release();
  await legacyWrite;
  await preparation;
  assert.equal(queryCount(sqlite, 'sync_v3_sessions'), 1);
  const source = readFileSync(new URL('../services/db/LargeMasterSyncV3SqliteStore.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /setTimeout|queueMicrotask/);
});

test('resume is idempotent from VALIDATED and after ACTIVE', async () => {
  let fault = true;
  const { store } = sqliteStore(point => {
    if (fault && point === 'activation_after_pointer') throw new Error('KILL_ACTIVATION');
  });
  const { responses } = await manifestAndResponses({
    tariffs: [[{ id: 'T1', active: true }]],
    articles: [[{ id: 'A1', taxable: false, taxIds: [], active: true }]],
    prices: [[{ articleId: 'A1', tariffId: 'T1', price: 10 }]],
  });
  const firstTransport = new MapTransport(responses);
  const client = new LargeMasterSyncV3Client({ store, transport: firstTransport,
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  await assert.rejects(() => client.resumeSync(SYNC_ID), /KILL_ACTIVATION/);
  assert.equal((await store.readProgress(SYNC_ID))?.status, 'VALIDATED');
  assert.equal(await store.getActiveRuntimeVersion(), null);

  fault = false;
  const requestsBefore = firstTransport.requests.length;
  assert.deepEqual(await client.resumeSync(SYNC_ID), { syncId: SYNC_ID, syncVersion: 186 });
  assert.equal(firstTransport.requests.slice(requestsBefore).filter(path => path.includes('/chunks/')).length, 0);
  const requestsBeforeActiveResume = firstTransport.requests.length;
  assert.deepEqual(await client.resumeSync(SYNC_ID), { syncId: SYNC_ID, syncVersion: 186 });
  assert.equal(firstTransport.requests.slice(requestsBeforeActiveResume).filter(path => path.includes('/chunks/')).length, 0);
});

test('fault injection preserves ACTIVE across download, hash, parse, transaction, commit and dataset transition', async () => {
  const stages = ['download', 'hash', 'parse'] as const;
  for (const stage of stages) {
    const { store } = sqliteStore();
    const { responses } = await manifestAndResponses({ taxes: [[{ id: 'T', active: true }]] });
    const client = new LargeMasterSyncV3Client({ store, transport: new MapTransport(responses),
      storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0,
      fault: point => { if (point === stage) throw new Error(`KILL_${stage}`); } });
    await assert.rejects(() => client.resumeSync(SYNC_ID), new RegExp(`KILL_${stage}`));
    assert.equal(await store.getActiveRuntimeVersion(), null);
    assert.equal((await store.readProgress(SYNC_ID))?.chunks.length, 0);
  }

  for (const stage of ['apply_after_records', 'apply_before_commit', 'dataset_before_validate'] as const) {
    let enabled = true;
    const { sqlite, store } = sqliteStore(point => {
      if (enabled && point === stage) throw new Error(`KILL_${stage}`);
    });
    const { responses } = await manifestAndResponses({ taxes: [[{ id: 'T', active: true }]] });
    const client = new LargeMasterSyncV3Client({ store, transport: new MapTransport(responses),
      storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
    await assert.rejects(() => client.resumeSync(SYNC_ID), new RegExp(`KILL_${stage}`));
    assert.equal(await store.getActiveRuntimeVersion(), null);
    if (stage === 'dataset_before_validate') {
      assert.equal(queryCount(sqlite, 'master_v3_taxes'), 1);
      assert.equal((await store.readProgress(SYNC_ID))?.datasets.find(row => row.dataset === 'taxes')?.status, 'COMPLETE');
    } else {
      assert.equal(queryCount(sqlite, 'master_v3_taxes'), 0);
      assert.equal((await store.readProgress(SYNC_ID))?.chunks.length, 0);
    }
    enabled = false;
    await client.resumeSync(SYNC_ID);
    assert.deepEqual(await store.getActiveRuntimeVersion(), { syncId: SYNC_ID, syncVersion: 186 });
  }
});

test('internal timeout, HTML 503 and category-scope fallback are classified before JSON parsing', async () => {
  const { store } = sqliteStore();
  const timeoutTransport: LargeMasterSyncV3Transport = {
    request: async (_path, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }),
  };
  const timeoutClient = new LargeMasterSyncV3Client({ store, transport: timeoutTransport,
    maxRetries: 0, requestTimeoutMs: 5 });
  await assert.rejects(() => timeoutClient.requestSync(), (error: unknown) =>
    error instanceof LargeMasterSyncV3Error && error.code === 'SYNC_V3_TIMEOUT');

  const htmlClient = new LargeMasterSyncV3Client({ store, maxRetries: 0, transport: {
    request: async () => ({ status: 503, headers: { 'content-type': 'text/html' }, text: '<h1>down</h1>' }),
  } });
  await assert.rejects(() => htmlClient.requestSync(), (error: unknown) =>
    error instanceof LargeMasterSyncV3Error && error.code === 'SYNC_V3_HTTP_TEMPORARY');

  const fallbackClient = new LargeMasterSyncV3Client({ store, maxRetries: 0, transport: {
    request: async () => ({ status: 409, headers: { 'content-type': 'application/json' },
      text: JSON.stringify({ code: 'SYNC_V3_CATEGORY_SCOPE_UNSUPPORTED', fallback: 'legacy' }) }),
  } });
  assert.deepEqual(await fallbackClient.requestSync(), { fallback: 'legacy' });
});

test('operation gate wakes on sale activity after payment clears without deadlock', async () => {
  const previousWindow = globalThis.window;
  const eventTarget = new EventTarget();
  Object.assign(eventTarget, {
    setTimeout,
    clearTimeout,
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
  });
  Object.defineProperty(globalThis, 'window', { value: eventTarget, configurable: true, writable: true });
  try {
    resetLargeMasterSyncV3OperationGateForTests();
    setLargeMasterSyncV3CriticalOperation('PAYMENT', true);
    setPosSaleActivity({ active: true, cartCount: 1 });
    let resolved = false;
    const waiting = waitForLargeMasterSyncV3OperationalWindow().then(() => { resolved = true; });
    setLargeMasterSyncV3CriticalOperation('PAYMENT', false);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(resolved, false);
    setPosSaleActivity({ active: false });
    await Promise.race([waiting, new Promise((_, reject) => setTimeout(() => reject(new Error('DEADLOCK')), 100))]);
    assert.equal(resolved, true);
  } finally {
    resetLargeMasterSyncV3OperationGateForTests();
    setPosSaleActivity({ active: false });
    Object.defineProperty(globalThis, 'window', { value: previousWindow, configurable: true, writable: true });
  }
});

test('operation gate rechecks after parse before opening the sqlite transaction', async () => {
  const previousWindow = globalThis.window;
  const eventTarget = new EventTarget();
  Object.assign(eventTarget, {
    setTimeout,
    clearTimeout,
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
  });
  Object.defineProperty(globalThis, 'window', { value: eventTarget, configurable: true, writable: true });
  try {
    resetLargeMasterSyncV3OperationGateForTests();
    const { store } = sqliteStore();
    const { responses } = await manifestAndResponses({ taxes: [[{ id: 'T1', active: true }]] },
      186, SYNC_ID, ['taxes']);
    let parsed!: () => void;
    const parseReached = new Promise<void>(resolve => { parsed = resolve; });
    const client = new LargeMasterSyncV3Client({ store, transport: new MapTransport(responses),
      storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0,
      fault: point => {
        if (point === 'parse') {
          setPosSaleActivity({ active: true, cartCount: 1 });
          parsed();
        }
      },
    });
    const syncing = client.resumeSync(SYNC_ID);
    await parseReached;
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await store.readProgress(SYNC_ID))?.chunks.length, 0);
    setPosSaleActivity({ active: false });
    await Promise.race([syncing, new Promise((_, reject) => setTimeout(() => reject(new Error('DEADLOCK')), 100))]);
    assert.deepEqual(await store.getActiveRuntimeVersion(), { syncId: SYNC_ID, syncVersion: 186 });
  } finally {
    resetLargeMasterSyncV3OperationGateForTests();
    setPosSaleActivity({ active: false });
    Object.defineProperty(globalThis, 'window', { value: previousWindow, configurable: true, writable: true });
  }
});

test('opt-in prefetch downloads at most two chunks and applies SQLite chunks in order', async () => {
  const { store } = sqliteStore();
  const { responses } = await manifestAndResponses({ articles: Array.from({ length: 5 }, (_, index) => [{
    id: `A${index}`, taxable: false, taxIds: [], active: true,
  }]) }, 186, SYNC_ID, ['articles']);
  const started: number[] = [];
  const applied: number[] = [];
  let inFlight = 0;
  let peak = 0;
  const transport: LargeMasterSyncV3Transport = { async request(path) {
    const index = Number(path.match(/\/chunks\/(\d+)$/)?.[1]);
    if (Number.isInteger(index)) {
      started.push(index);
      peak = Math.max(peak, ++inFlight);
      await new Promise(resolve => setTimeout(resolve, index === 0 ? 20 : 1));
      inFlight -= 1;
    }
    return responses.get(path)!;
  } };
  const originalApplyChunk = store.applyChunk.bind(store);
  store.applyChunk = async (chunk: Parameters<typeof store.applyChunk>[0]) => {
    applied.push(chunk.envelope.chunkIndex);
    return originalApplyChunk(chunk);
  };
  const client = new LargeMasterSyncV3Client({ store, transport, downloadConcurrency: 2,
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  await client.resumeSync(SYNC_ID);
  assert.equal(peak, 2);
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  assert.deepEqual(applied, [0, 1, 2, 3, 4]);
});

test('blocked SQLite apply retains at most two completed chunk payloads', async () => {
  const { store } = sqliteStore();
  const { responses } = await manifestAndResponses({ articles: Array.from({ length: 3 }, (_, index) => [{
    id: `A${index}`, taxable: false, taxIds: [], active: true,
  }]) }, 186, SYNC_ID, ['articles']);
  const completed = new Set<number>();
  const applied = new Set<number>();
  let peakRetained = 0;
  const transport: LargeMasterSyncV3Transport = { async request(path) {
    const index = Number(path.match(/\/chunks\/(\d+)$/)?.[1]);
    if (Number.isInteger(index)) {
      completed.add(index);
      peakRetained = Math.max(peakRetained, completed.size - applied.size);
    }
    return responses.get(path)!;
  } };
  let releaseApply!: () => void;
  const blockedApply = new Promise<void>(resolve => { releaseApply = resolve; });
  let applying!: () => void;
  const applyStarted = new Promise<void>(resolve => { applying = resolve; });
  const originalApply = store.applyChunk.bind(store);
  store.applyChunk = async chunk => {
    if (chunk.envelope.chunkIndex === 0) {
      applying();
      await blockedApply;
    }
    const result = await originalApply(chunk);
    applied.add(chunk.envelope.chunkIndex);
    return result;
  };
  const client = new LargeMasterSyncV3Client({ store, transport, downloadConcurrency: 2,
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  const syncing = client.resumeSync(SYNC_ID);
  try {
    await applyStarted;
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual([...completed], [0, 1]);
    assert.equal(peakRetained, 2);
  } finally {
    releaseApply();
  }
  await syncing;
  assert.equal(peakRetained, 2);
  assert.deepEqual([...applied], [0, 1, 2]);
});

test('default client remains sequential across downloads and SQLite applies', async () => {
  const { store } = sqliteStore();
  const { responses } = await manifestAndResponses({
    taxes: [[{ id: 'T1', active: true }]],
    articles: [[{ id: 'A0', taxable: false, taxIds: [], active: true }],
      [{ id: 'A1', taxable: false, taxIds: [], active: true }]],
  }, 186, SYNC_ID, ['taxes', 'articles']);
  const events: string[] = [];
  const transport: LargeMasterSyncV3Transport = { async request(path) {
    if (path.includes('/chunks/')) events.push(`fetch:${path.match(/\/datasets\/([^/]+)\/chunks\/(\d+)$/)?.slice(1).join(':')}`);
    return responses.get(path)!;
  } };
  const originalApply = store.applyChunk.bind(store);
  store.applyChunk = async chunk => {
    events.push(`apply:${chunk.envelope.dataset}:${chunk.envelope.chunkIndex}`);
    return originalApply(chunk);
  };
  const originalValidate = store.markDatasetValidated.bind(store);
  store.markDatasetValidated = async (syncId, dataset) => {
    events.push(`validated:${dataset}`);
    return originalValidate(syncId, dataset);
  };
  const client = new LargeMasterSyncV3Client({ store, transport,
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  await client.resumeSync(SYNC_ID);
  assert.deepEqual(events, [
    'fetch:taxes:0', 'apply:taxes:0', 'validated:taxes',
    'fetch:articles:0', 'apply:articles:0', 'fetch:articles:1', 'apply:articles:1',
    'validated:articles',
  ]);
});

test('opt-in prefetch waits for dataset validation before starting the next dataset', async () => {
  const { store } = sqliteStore();
  const { responses } = await manifestAndResponses({
    taxes: [[{ id: 'T1', active: true }], [{ id: 'T2', active: true }]],
    articles: [[{ id: 'A0', taxable: false, taxIds: [], active: true }]],
  }, 186, SYNC_ID, ['taxes', 'articles']);
  const events: string[] = [];
  const transport: LargeMasterSyncV3Transport = { async request(path) {
    if (path.includes('/chunks/')) events.push(path.includes('/datasets/articles/') ? 'fetch:articles' : 'fetch:taxes');
    return responses.get(path)!;
  } };
  const originalValidate = store.markDatasetValidated.bind(store);
  store.markDatasetValidated = async (syncId, dataset) => {
    events.push(`validated:${dataset}`);
    return originalValidate(syncId, dataset);
  };
  const client = new LargeMasterSyncV3Client({ store, transport, downloadConcurrency: 2,
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  await client.resumeSync(SYNC_ID);
  assert.ok(events.indexOf('validated:taxes') < events.indexOf('fetch:articles'));
  assert.deepEqual(events.filter(event => event === 'fetch:taxes').length, 2);
});

test('prefetched failure aborts the current download, leaves staging intact, and resumes', async () => {
  const { store } = sqliteStore();
  const { responses } = await manifestAndResponses({ articles: Array.from({ length: 3 }, (_, index) => [{
    id: `A${index}`, taxable: false, taxIds: [], active: true,
  }]) }, 186, SYNC_ID, ['articles']);
  let currentAborted = false;
  const transport: LargeMasterSyncV3Transport = { async request(path, init) {
    if (path.endsWith('/chunks/0')) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => { currentAborted = true; reject(new DOMException('aborted', 'AbortError')); };
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    if (path.endsWith('/chunks/1')) throw new Error('SPECULATIVE_DOWNLOAD_FAILED');
    return responses.get(path)!;
  } };
  const client = new LargeMasterSyncV3Client({ store, transport, downloadConcurrency: 2,
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  await assert.rejects(() => client.resumeSync(SYNC_ID), /SPECULATIVE_DOWNLOAD_FAILED/);
  assert.equal(currentAborted, true);
  assert.equal((await store.readProgress(SYNC_ID))?.chunks.length, 0);
  assert.equal(await store.getActiveRuntimeVersion(), null);
  const resumed = new LargeMasterSyncV3Client({ store, transport: new MapTransport(responses), downloadConcurrency: 2,
    maxRetries: 0 });
  await resumed.resumeSync(SYNC_ID);
  assert.equal((await store.readProgress(SYNC_ID))?.chunks.length, 3);
});

test('current chunk failure drains prefetched work without applying a later chunk', async () => {
  const { store } = sqliteStore();
  const { responses } = await manifestAndResponses({ articles: Array.from({ length: 2 }, (_, index) => [{
    id: `A${index}`, taxable: false, taxIds: [], active: true,
  }]) }, 186, SYNC_ID, ['articles']);
  let prefetchedAborted = false;
  let prefetchedStarted!: () => void;
  const prefetchedStart = new Promise<void>(resolve => { prefetchedStarted = resolve; });
  const transport: LargeMasterSyncV3Transport = { async request(path, init) {
    if (path.endsWith('/chunks/0')) {
      await prefetchedStart;
      throw new Error('CURRENT_DOWNLOAD_FAILED');
    }
    if (path.endsWith('/chunks/1')) {
      prefetchedStarted();
      await new Promise<void>((resolve, reject) => {
        const abort = () => { prefetchedAborted = true; reject(new DOMException('aborted', 'AbortError')); };
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    return responses.get(path)!;
  } };
  const client = new LargeMasterSyncV3Client({ store, transport, downloadConcurrency: 2,
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
  await assert.rejects(() => client.resumeSync(SYNC_ID), /CURRENT_DOWNLOAD_FAILED/);
  assert.equal(prefetchedAborted, true);
  assert.equal((await store.readProgress(SYNC_ID))?.chunks.length, 0);
});

test('abort during prefetch persists only applied chunks and restart resumes the first gap', async () => {
  const { store } = sqliteStore();
  const { responses } = await manifestAndResponses({ articles: Array.from({ length: 3 }, (_, index) => [{
    id: `A${index}`, taxable: false, taxIds: [], active: true,
  }]) }, 186, SYNC_ID, ['articles']);
  const abortController = new AbortController();
  const transport: LargeMasterSyncV3Transport = { async request(path, init) {
    if (path.includes('/chunks/') && !path.endsWith('/chunks/0')) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new DOMException('aborted', 'AbortError'));
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    return responses.get(path)!;
  } };
  const client = new LargeMasterSyncV3Client({ store, transport, downloadConcurrency: 2,
    storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0,
    metric: metric => { if (metric.event === 'chunk_progress' && metric.chunkIndex === 0) abortController.abort(); },
  });
  await assert.rejects(() => client.resumeSync(SYNC_ID, abortController.signal), /AbortError|aborted/);
  assert.deepEqual((await store.readProgress(SYNC_ID))?.chunks.map(chunk => chunk.chunkIndex), [0]);
  const resumeTransport = new MapTransport(responses);
  const resumed = new LargeMasterSyncV3Client({ store, transport: resumeTransport, downloadConcurrency: 2,
    maxRetries: 0 });
  await resumed.resumeSync(SYNC_ID);
  assert.deepEqual(resumeTransport.requests.filter(path => path.includes('/chunks/')).map(path => Number(path.match(/\/chunks\/(\d+)$/)?.[1])), [1, 2]);
});

test('prefetch does not start behind a closed operation gate and abort removes its waiter', async () => {
  const previousWindow = globalThis.window;
  const eventTarget = new EventTarget();
  let saleListeners = 0;
  Object.assign(eventTarget, { setTimeout, clearTimeout });
  const add = eventTarget.addEventListener.bind(eventTarget);
  const remove = eventTarget.removeEventListener.bind(eventTarget);
  eventTarget.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'clicpos:sale-activity-changed') saleListeners += 1;
    add(type, listener);
  }) as typeof eventTarget.addEventListener;
  eventTarget.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'clicpos:sale-activity-changed') saleListeners -= 1;
    remove(type, listener);
  }) as typeof eventTarget.removeEventListener;
  Object.defineProperty(globalThis, 'window', { value: eventTarget, configurable: true, writable: true });
  try {
    resetLargeMasterSyncV3OperationGateForTests();
    setPosSaleActivity({ active: true, cartCount: 1 });
    const { store } = sqliteStore();
    const { responses } = await manifestAndResponses({ articles: [[{
      id: 'A0', taxable: false, taxIds: [], active: true,
    }], [{ id: 'A1', taxable: false, taxIds: [], active: true }]] }, 186, SYNC_ID, ['articles']);
    const transport = new MapTransport(responses);
    const controller = new AbortController();
    const client = new LargeMasterSyncV3Client({ store, transport, downloadConcurrency: 2,
      storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0 });
    const syncing = client.resumeSync(SYNC_ID, controller.signal);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(transport.requests.filter(path => path.includes('/chunks/')), []);
    assert.equal(saleListeners, 2);
    controller.abort();
    await assert.rejects(() => syncing, /AbortError|aborted/);
    assert.equal(saleListeners, 0);
    assert.equal((await store.readProgress(SYNC_ID))?.chunks.length, 0);
  } finally {
    resetLargeMasterSyncV3OperationGateForTests();
    setPosSaleActivity({ active: false });
    Object.defineProperty(globalThis, 'window', { value: previousWindow, configurable: true, writable: true });
  }
});

test('prefetch stops launching new chunks while a sale holds the operational gate', async () => {
  const previousWindow = globalThis.window;
  const eventTarget = new EventTarget();
  Object.assign(eventTarget, { setTimeout, clearTimeout,
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
  });
  Object.defineProperty(globalThis, 'window', { value: eventTarget, configurable: true, writable: true });
  try {
    resetLargeMasterSyncV3OperationGateForTests();
    const { store } = sqliteStore();
    const { responses } = await manifestAndResponses({ articles: Array.from({ length: 3 }, (_, index) => [{
      id: `A${index}`, taxable: false, taxIds: [], active: true,
    }]) }, 186, SYNC_ID, ['articles']);
    let parsed!: () => void;
    const parseReached = new Promise<void>(resolve => { parsed = resolve; });
    const transport = new MapTransport(responses);
    const client = new LargeMasterSyncV3Client({ store, transport, downloadConcurrency: 2,
      storageStats: async () => ({ availableBytes: 1e9, totalBytes: 2e9 }), maxRetries: 0,
      fault: (point, context) => {
        if (point === 'parse' && context.chunkIndex === 0) {
          setPosSaleActivity({ active: true, cartCount: 1 });
          parsed();
        }
      },
    });
    const syncing = client.resumeSync(SYNC_ID);
    await parseReached;
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(transport.requests.some(path => path.endsWith('/chunks/2')), false);
    assert.equal((await store.readProgress(SYNC_ID))?.chunks.length, 0);
    setPosSaleActivity({ active: false });
    await syncing;
    assert.equal(transport.requests.some(path => path.endsWith('/chunks/2')), true);
  } finally {
    resetLargeMasterSyncV3OperationGateForTests();
    setPosSaleActivity({ active: false });
    Object.defineProperty(globalThis, 'window', { value: previousWindow, configurable: true, writable: true });
  }
});

test('dark lifecycle is wired but cannot load runtime or start network work', async () => {
  resetLargeMasterSyncV3LifecycleForTests();
  assert.deepEqual(await bootstrapLargeMasterSyncV3Lifecycle(undefined), { enabled: false, runtime: null });
  assert.equal(getLargeMasterSyncV3Runtime(), null);
});
