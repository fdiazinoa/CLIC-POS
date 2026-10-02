import {
  LARGE_MASTER_SYNC_V3_DATASETS,
  LargeMasterSyncV3Error,
  type LargeMasterSyncV3Chunk,
  type LargeMasterSyncV3Dataset,
  type LargeMasterSyncV3Manifest,
  type LargeMasterSyncV3Progress,
  type LargeMasterSyncV3RuntimeVersion,
  type LargeMasterSyncV3Store,
} from '../sync/LargeMasterSyncV3Types';

type QueryResult = { values?: Array<Record<string, unknown>> };
type SQLiteConnection = {
  execute(sql: string, transaction?: boolean): Promise<unknown>;
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  run(sql: string, values?: unknown[], transaction?: boolean): Promise<unknown>;
};
export type LargeMasterSyncV3WriteLock = <T>(operation: () => Promise<T>) => Promise<T>;
export type LargeMasterSyncV3SqliteFaultPoint =
  | 'apply_after_records'
  | 'apply_before_commit'
  | 'dataset_before_validate'
  | 'activation_after_pointer';
export type LargeMasterSyncV3SqliteFaultHook = (
  point: LargeMasterSyncV3SqliteFaultPoint,
  context: Record<string, unknown>,
) => void | Promise<void>;

type RecordObject = Record<string, unknown>;
const CHUNK_SUB_BATCH_SIZE = 250;
const object = (value: unknown): RecordObject => value && typeof value === 'object' && !Array.isArray(value)
  ? value as RecordObject : {};
const requiredId = (row: RecordObject, key: string): string => {
  const value = String(row[key] ?? '').trim();
  if (!value) throw new LargeMasterSyncV3Error('SYNC_V3_RECORD_INVALID', `Falta ${key}`);
  return value;
};
const optionalText = (value: unknown): string | null => value == null || String(value).trim() === ''
  ? null : String(value);
const booleanInt = (value: unknown): number => value === false ? 0 : 1;
const finiteNumber = (value: unknown, key: string): number => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new LargeMasterSyncV3Error('SYNC_V3_RECORD_INVALID', `${key} inválido`);
  return number;
};
const now = () => new Date().toISOString();
const rows = (result: QueryResult): Array<Record<string, unknown>> => Array.isArray(result.values) ? result.values : [];
const first = (result: QueryResult): Record<string, unknown> | null => rows(result)[0] || null;

export class LargeMasterSyncV3SqliteStore implements LargeMasterSyncV3Store {
  constructor(
    private readonly connection: () => SQLiteConnection,
    private readonly writeLock: LargeMasterSyncV3WriteLock,
    private readonly fault?: LargeMasterSyncV3SqliteFaultHook,
  ) {}

  async prepare(manifest: LargeMasterSyncV3Manifest): Promise<void> {
    await this.writeLock(async () => {
      const db = this.connection();
      await db.execute('BEGIN IMMEDIATE TRANSACTION;', false);
      try {
        const existing = first(await db.query(
          'SELECT sync_version, schema_version, manifest_json, status FROM sync_v3_sessions WHERE sync_id = ?',
          [manifest.syncId],
        ));
        if (existing && (Number(existing.sync_version) !== manifest.syncVersion
          || Number(existing.schema_version) !== manifest.schemaVersion
          || String(existing.manifest_json) !== JSON.stringify(manifest))) {
          throw new LargeMasterSyncV3Error('SYNC_V3_RESUME_MANIFEST_MISMATCH');
        }
        if (existing?.status === 'ROLLED_BACK' || existing?.status === 'FAILED') {
          throw new LargeMasterSyncV3Error('SYNC_V3_SESSION_NOT_RESUMABLE');
        }
        if (existing?.status === 'ACTIVE') {
          const active = first(await db.query(`SELECT active_sync_id, active_version
            FROM master_v3_state WHERE singleton = 1`));
          if (String(active?.active_sync_id || '') !== manifest.syncId
            || Number(active?.active_version) !== manifest.syncVersion) {
            throw new LargeMasterSyncV3Error('SYNC_V3_ACTIVE_POINTER_MISMATCH');
          }
          await db.execute('COMMIT;', false);
          return;
        }
        const timestamp = now();
        await db.run(`INSERT OR IGNORE INTO sync_v3_sessions
          (sync_id, sync_version, schema_version, status, manifest_json, created_at, updated_at)
          VALUES (?, ?, 3, 'STAGING', ?, ?, ?)`,
        [manifest.syncId, manifest.syncVersion, JSON.stringify(manifest), manifest.createdAt, timestamp], false);
        for (const dataset of LARGE_MASTER_SYNC_V3_DATASETS) {
          const expected = manifest.datasets[dataset];
          if (!expected) continue;
          await db.run(`INSERT OR IGNORE INTO sync_v3_dataset_progress
            (sync_id, dataset, expected_count, expected_chunks, expected_checksum,
             applied_count, applied_chunks, status, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`, [
            manifest.syncId,
            dataset,
            expected.count,
            expected.chunks,
            expected.checksum,
            expected.chunks === 0 && expected.count === 0 ? 'COMPLETE' : 'PENDING',
            timestamp,
          ], false);
          const stored = first(await db.query(`SELECT expected_count, expected_chunks, expected_checksum
            FROM sync_v3_dataset_progress WHERE sync_id = ? AND dataset = ?`, [manifest.syncId, dataset]));
          if (!stored || Number(stored.expected_count) !== expected.count
            || Number(stored.expected_chunks) !== expected.chunks
            || String(stored.expected_checksum || '') !== String(expected.checksum || '')) {
            throw new LargeMasterSyncV3Error('SYNC_V3_RESUME_MANIFEST_MISMATCH');
          }
        }
        await db.run(`UPDATE master_v3_state SET staging_version = ?, staging_sync_id = ?, updated_at = ?
          WHERE singleton = 1 AND (staging_sync_id IS NULL OR staging_sync_id = ?)`,
        [manifest.syncVersion, manifest.syncId, timestamp, manifest.syncId], false);
        const state = first(await db.query('SELECT staging_sync_id FROM master_v3_state WHERE singleton = 1'));
        if (String(state?.staging_sync_id || '') !== manifest.syncId) {
          throw new LargeMasterSyncV3Error('SYNC_V3_STAGING_CONFLICT');
        }
        await db.execute('COMMIT;', false);
      } catch (error) {
        await db.execute('ROLLBACK;', false).catch(() => undefined);
        throw error;
      }
    });
  }

  async readProgress(syncId: string): Promise<LargeMasterSyncV3Progress | null> {
    const db = this.connection();
    const session = first(await db.query(
      'SELECT sync_id, sync_version, status FROM sync_v3_sessions WHERE sync_id = ?', [syncId],
    ));
    if (!session) return null;
    const progressRows = rows(await db.query(`SELECT dataset, expected_count, expected_chunks,
      expected_checksum, applied_count, applied_chunks, status
      FROM sync_v3_dataset_progress WHERE sync_id = ? ORDER BY rowid`, [syncId]));
    const chunkRows = rows(await db.query(`SELECT dataset, chunk_index, checksum, record_count
      FROM sync_v3_chunks WHERE sync_id = ? AND status = 'APPLIED'
      ORDER BY dataset, chunk_index`, [syncId]));
    return {
      syncId: String(session.sync_id),
      syncVersion: Number(session.sync_version),
      status: String(session.status),
      datasets: progressRows.map(row => ({
        dataset: String(row.dataset) as LargeMasterSyncV3Dataset,
        expectedCount: Number(row.expected_count),
        expectedChunks: Number(row.expected_chunks),
        expectedChecksum: row.expected_checksum == null ? null : String(row.expected_checksum),
        appliedCount: Number(row.applied_count),
        appliedChunks: Number(row.applied_chunks),
        status: String(row.status),
      })),
      chunks: chunkRows.map(row => ({
        dataset: String(row.dataset) as LargeMasterSyncV3Dataset,
        chunkIndex: Number(row.chunk_index),
        checksum: String(row.checksum),
        recordCount: Number(row.record_count),
      })),
    };
  }

  async findIncomplete(): Promise<LargeMasterSyncV3Progress | null> {
    const row = first(await this.connection().query(`SELECT sync_id FROM sync_v3_sessions
      WHERE status IN ('STAGING','VALIDATED') ORDER BY updated_at DESC LIMIT 1`));
    return row ? this.readProgress(String(row.sync_id)) : null;
  }

  async applyChunk(chunk: LargeMasterSyncV3Chunk): Promise<'APPLIED' | 'ALREADY_APPLIED'> {
    return this.writeLock(async () => {
      const db = this.connection();
      await db.execute('BEGIN IMMEDIATE TRANSACTION;', false);
      try {
        const session = first(await db.query(
          "SELECT sync_version, status FROM sync_v3_sessions WHERE sync_id = ? AND status = 'STAGING'",
          [chunk.envelope.syncId],
        ));
        if (!session) throw new LargeMasterSyncV3Error('SYNC_V3_SESSION_NOT_STAGING');
        const prior = first(await db.query(`SELECT checksum, record_count FROM sync_v3_chunks
          WHERE sync_id = ? AND dataset = ? AND chunk_index = ?`,
        [chunk.envelope.syncId, chunk.envelope.dataset, chunk.envelope.chunkIndex]));
        if (prior) {
          if (String(prior.checksum) !== chunk.checksum || Number(prior.record_count) !== chunk.recordCount) {
            throw new LargeMasterSyncV3Error('SYNC_V3_CHUNK_REPLAY_MISMATCH');
          }
          await db.execute('COMMIT;', false);
          return 'ALREADY_APPLIED';
        }
        const progress = first(await db.query(`SELECT expected_chunks, applied_chunks FROM sync_v3_dataset_progress
          WHERE sync_id = ? AND dataset = ?`, [chunk.envelope.syncId, chunk.envelope.dataset]));
        if (!progress) throw new LargeMasterSyncV3Error('SYNC_V3_DATASET_NOT_DECLARED');
        if (chunk.envelope.chunkIndex !== Number(progress.applied_chunks)
          || chunk.envelope.chunkIndex >= Number(progress.expected_chunks)) {
          throw new LargeMasterSyncV3Error('SYNC_V3_CHUNK_OUT_OF_ORDER');
        }
        const syncVersion = Number(session.sync_version);
        for (let offset = 0; offset < chunk.envelope.records.length; offset += CHUNK_SUB_BATCH_SIZE) {
          const batch = chunk.envelope.records.slice(offset, offset + CHUNK_SUB_BATCH_SIZE);
          for (const rawRecord of batch) {
            await this.upsertRecord(db, chunk.envelope.dataset, syncVersion, object(rawRecord));
          }
        }
        await this.fault?.('apply_after_records', {
          syncId: chunk.envelope.syncId, dataset: chunk.envelope.dataset, chunkIndex: chunk.envelope.chunkIndex,
        });
        const timestamp = now();
        await db.run(`INSERT INTO sync_v3_chunks
          (sync_id, dataset, chunk_index, checksum, record_count, raw_bytes, status, applied_at)
          VALUES (?, ?, ?, ?, ?, ?, 'APPLIED', ?)`, [
          chunk.envelope.syncId, chunk.envelope.dataset, chunk.envelope.chunkIndex,
          chunk.checksum, chunk.recordCount, chunk.rawBytes, timestamp,
        ], false);
        await db.run(`UPDATE sync_v3_dataset_progress SET
          applied_count = applied_count + ?, applied_chunks = applied_chunks + 1,
          status = CASE WHEN applied_chunks + 1 = expected_chunks THEN 'COMPLETE' ELSE 'APPLYING' END,
          updated_at = ? WHERE sync_id = ? AND dataset = ?`, [
          chunk.recordCount, timestamp, chunk.envelope.syncId, chunk.envelope.dataset,
        ], false);
        await db.run('UPDATE sync_v3_sessions SET updated_at = ? WHERE sync_id = ?',
          [timestamp, chunk.envelope.syncId], false);
        await this.fault?.('apply_before_commit', {
          syncId: chunk.envelope.syncId, dataset: chunk.envelope.dataset, chunkIndex: chunk.envelope.chunkIndex,
        });
        await db.execute('COMMIT;', false);
        return 'APPLIED';
      } catch (error) {
        await db.execute('ROLLBACK;', false).catch(() => undefined);
        throw error;
      }
    });
  }

  async markDatasetValidated(syncId: string, dataset: LargeMasterSyncV3Dataset): Promise<void> {
    await this.writeLock(async () => {
      const db = this.connection();
      const current = first(await db.query(`SELECT status, applied_count, expected_count, applied_chunks, expected_chunks
        FROM sync_v3_dataset_progress WHERE sync_id = ? AND dataset = ?`, [syncId, dataset]));
      if (current?.status === 'VALIDATED'
        && Number(current.applied_count) === Number(current.expected_count)
        && Number(current.applied_chunks) === Number(current.expected_chunks)) return;
      await this.fault?.('dataset_before_validate', { syncId, dataset });
      const result = await db.run(`UPDATE sync_v3_dataset_progress SET status = 'VALIDATED',
        updated_at = ? WHERE sync_id = ? AND dataset = ? AND status = 'COMPLETE'
        AND applied_count = expected_count AND applied_chunks = expected_chunks`, [now(), syncId, dataset]);
      const changes = Number((result as { changes?: { changes?: number } })?.changes?.changes ?? 0);
      if (changes !== 1) throw new LargeMasterSyncV3Error('SYNC_V3_DATASET_INCOMPLETE');
    });
  }

  async validateStaging(syncId: string): Promise<void> {
    await this.writeLock(async () => {
      const db = this.connection();
      const session = first(await db.query(
        "SELECT sync_version, status FROM sync_v3_sessions WHERE sync_id = ? AND status IN ('STAGING','VALIDATED')", [syncId],
      ));
      if (!session) throw new LargeMasterSyncV3Error('SYNC_V3_SESSION_NOT_STAGING');
      const incomplete = first(await db.query(`SELECT dataset FROM sync_v3_dataset_progress
        WHERE sync_id = ? AND status != 'VALIDATED' LIMIT 1`, [syncId]));
      if (incomplete) throw new LargeMasterSyncV3Error('SYNC_V3_DATASET_INCOMPLETE');
      const syncVersion = Number(session.sync_version);
      for (const dataset of LARGE_MASTER_SYNC_V3_DATASETS) {
        const expected = first(await db.query(`SELECT expected_count FROM sync_v3_dataset_progress
          WHERE sync_id = ? AND dataset = ?`, [syncId, dataset]));
        if (!expected) continue;
        const actual = first(await db.query(
          `SELECT COUNT(*) AS count FROM master_v3_${dataset} WHERE sync_version = ?`, [syncVersion],
        ));
        if (Number(actual?.count) !== Number(expected.expected_count)) {
          throw new LargeMasterSyncV3Error('SYNC_V3_DATASET_COUNT_MISMATCH', dataset);
        }
      }
      const foreignKeys = rows(await db.query('PRAGMA foreign_key_check;'));
      if (foreignKeys.length) throw new LargeMasterSyncV3Error('SYNC_V3_FOREIGN_KEY_CHECK_FAILED');
      const quick = first(await db.query('PRAGMA quick_check;'));
      if (!quick || !Object.values(quick).some(value => String(value).toLowerCase() === 'ok')) {
        throw new LargeMasterSyncV3Error('SYNC_V3_QUICK_CHECK_FAILED');
      }
      if (session.status !== 'VALIDATED') {
        await db.run("UPDATE sync_v3_sessions SET status = 'VALIDATED', updated_at = ? WHERE sync_id = ?",
          [now(), syncId]);
      }
    });
  }

  async activate(syncId: string): Promise<LargeMasterSyncV3RuntimeVersion> {
    return this.writeLock(async () => {
      const db = this.connection();
      const alreadyActive = first(await db.query(`SELECT s.sync_version FROM sync_v3_sessions s
        JOIN master_v3_state state ON state.singleton = 1
        WHERE s.sync_id = ? AND s.status = 'ACTIVE'
        AND state.active_sync_id = s.sync_id AND state.active_version = s.sync_version`, [syncId]));
      if (alreadyActive) return { syncId, syncVersion: Number(alreadyActive.sync_version) };
      await db.execute('BEGIN IMMEDIATE TRANSACTION;', false);
      try {
        const session = first(await db.query(
          "SELECT sync_version FROM sync_v3_sessions WHERE sync_id = ? AND status = 'VALIDATED'", [syncId],
        ));
        const state = first(await db.query('SELECT * FROM master_v3_state WHERE singleton = 1'));
        if (!session || String(state?.staging_sync_id || '') !== syncId
          || Number(state?.staging_version) !== Number(session.sync_version)) {
          throw new LargeMasterSyncV3Error('SYNC_V3_ACTIVATION_PRECONDITION_FAILED');
        }
        const timestamp = now();
        await db.run(`UPDATE master_v3_state SET
          previous_version = active_version, previous_sync_id = active_sync_id,
          active_version = staging_version, active_sync_id = staging_sync_id,
          staging_version = NULL, staging_sync_id = NULL, updated_at = ? WHERE singleton = 1`, [timestamp], false);
        await this.fault?.('activation_after_pointer', { syncId, syncVersion: Number(session.sync_version) });
        await db.run("UPDATE sync_v3_sessions SET status = 'ACTIVE', activated_at = ?, updated_at = ? WHERE sync_id = ?",
          [timestamp, timestamp, syncId], false);
        if (state?.active_sync_id) {
          await db.run("UPDATE sync_v3_sessions SET status = 'ROLLED_BACK', updated_at = ? WHERE sync_id = ? AND status = 'ACTIVE'",
            [timestamp, state.active_sync_id], false);
        }
        await db.execute('COMMIT;', false);
        return { syncId, syncVersion: Number(session.sync_version) };
      } catch (error) {
        await db.execute('ROLLBACK;', false).catch(() => undefined);
        throw error;
      }
    });
  }

  async rollback(): Promise<LargeMasterSyncV3RuntimeVersion> {
    return this.writeLock(async () => {
      const db = this.connection();
      await db.execute('BEGIN IMMEDIATE TRANSACTION;', false);
      try {
        const state = first(await db.query('SELECT * FROM master_v3_state WHERE singleton = 1'));
        if (!state?.previous_sync_id || state.previous_version == null) {
          throw new LargeMasterSyncV3Error('SYNC_V3_PREVIOUS_VERSION_UNAVAILABLE');
        }
        const timestamp = now();
        await db.run(`UPDATE master_v3_state SET
          active_version = previous_version, active_sync_id = previous_sync_id,
          previous_version = active_version, previous_sync_id = active_sync_id,
          updated_at = ? WHERE singleton = 1`, [timestamp], false);
        await db.run("UPDATE sync_v3_sessions SET status = 'ACTIVE', updated_at = ? WHERE sync_id = ?",
          [timestamp, state.previous_sync_id], false);
        if (state.active_sync_id) {
          await db.run("UPDATE sync_v3_sessions SET status = 'ROLLED_BACK', updated_at = ? WHERE sync_id = ?",
            [timestamp, state.active_sync_id], false);
        }
        await db.execute('COMMIT;', false);
        return { syncId: String(state.previous_sync_id), syncVersion: Number(state.previous_version) };
      } catch (error) {
        await db.execute('ROLLBACK;', false).catch(() => undefined);
        throw error;
      }
    });
  }

  async getActiveRuntimeVersion(): Promise<LargeMasterSyncV3RuntimeVersion | null> {
    const state = first(await this.connection().query(
      'SELECT active_sync_id, active_version FROM master_v3_state WHERE singleton = 1',
    ));
    return state?.active_sync_id && state.active_version != null
      ? { syncId: String(state.active_sync_id), syncVersion: Number(state.active_version) } : null;
  }

  async listArticlesPage(runtime: LargeMasterSyncV3RuntimeVersion, afterArticleId: string | null, limit: number): Promise<Record<string, unknown>[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return rows(await this.connection().query(`SELECT a.article_id AS id, a.sku, a.description,
      a.article_type AS type, a.uom, a.taxable, a.tax_ids_json AS taxIdsJson,
      a.family_id AS familyId, a.category_id AS categoryId, a.active
      FROM master_v3_articles a WHERE a.sync_version = ?
      AND a.article_id > COALESCE(?, '') ORDER BY a.article_id LIMIT ?`,
    [runtime.syncVersion, afterArticleId, safeLimit]));
  }

  async getPrices(runtime: LargeMasterSyncV3RuntimeVersion, articleIds: string[], tariffId: string): Promise<Array<{ articleId: string; tariffId: string; price: number }>> {
    const ids = [...new Set(articleIds.map(String).filter(Boolean))].slice(0, 500);
    if (!ids.length || !tariffId) return [];
    const placeholders = ids.map(() => '?').join(',');
    return rows(await this.connection().query(`SELECT p.article_id, p.tariff_id, p.price
      FROM master_v3_prices p WHERE p.sync_version = ?
      AND p.tariff_id = ? AND p.article_id IN (${placeholders})`,
    [runtime.syncVersion, tariffId, ...ids])).map(row => ({
      articleId: String(row.article_id), tariffId: String(row.tariff_id), price: Number(row.price),
    }));
  }

  async findBarcode(runtime: LargeMasterSyncV3RuntimeVersion, barcode: string): Promise<{ articleId: string; variantId: string | null } | null> {
    const row = first(await this.connection().query(`SELECT b.article_id, b.variant_id
      FROM master_v3_barcodes b WHERE b.sync_version = ? AND b.barcode = ? LIMIT 1`,
    [runtime.syncVersion, barcode]));
    return row ? { articleId: String(row.article_id), variantId: String(row.variant_id || '') || null } : null;
  }

  async getPragmaSnapshot(): Promise<Record<string, string | number | null>> {
    const result: Record<string, string | number | null> = {};
    for (const name of ['journal_mode', 'synchronous', 'busy_timeout', 'foreign_keys', 'cache_size', 'temp_store']) {
      const row = first(await this.connection().query(`PRAGMA ${name};`));
      result[name] = row ? (Object.values(row)[0] as string | number | null) : null;
    }
    return result;
  }

  async getDatabaseSizeBytes(): Promise<number> {
    const pageCount = first(await this.connection().query('PRAGMA page_count;'));
    const pageSize = first(await this.connection().query('PRAGMA page_size;'));
    return Number(pageCount?.page_count || Object.values(pageCount || {})[0] || 0)
      * Number(pageSize?.page_size || Object.values(pageSize || {})[0] || 0);
  }

  async cleanupExpiredVersions(olderThanIso: string, maxVersions = 1): Promise<number> {
    const limit = Math.max(1, Math.min(5, Math.floor(maxVersions)));
    return this.writeLock(async () => {
      const db = this.connection();
      const candidates = rows(await db.query(`SELECT s.sync_id, s.sync_version
        FROM sync_v3_sessions s, master_v3_state state
        WHERE state.singleton = 1 AND s.status = 'ROLLED_BACK'
        AND COALESCE(s.activated_at, s.updated_at) < ?
        AND s.sync_version NOT IN (
          COALESCE(state.active_version, -1), COALESCE(state.previous_version, -1),
          COALESCE(state.staging_version, -1)
        ) ORDER BY COALESCE(s.activated_at, s.updated_at) LIMIT ?`, [olderThanIso, limit]));
      let removed = 0;
      for (const candidate of candidates) {
        await db.execute('BEGIN IMMEDIATE TRANSACTION;', false);
        try {
          for (const dataset of ['prices', 'barcodes', 'variants', 'articles', 'tariffs', 'taxes'] as const) {
            await db.run(`DELETE FROM master_v3_${dataset} WHERE sync_version = ?`,
              [Number(candidate.sync_version)], false);
          }
          await db.run('DELETE FROM sync_v3_sessions WHERE sync_id = ?', [String(candidate.sync_id)], false);
          await db.execute('COMMIT;', false);
          removed += 1;
        } catch (error) {
          await db.execute('ROLLBACK;', false).catch(() => undefined);
          throw error;
        }
      }
      return removed;
    });
  }

  private async upsertRecord(db: SQLiteConnection, dataset: LargeMasterSyncV3Dataset, version: number, row: RecordObject): Promise<void> {
    if (dataset === 'articles') {
      const taxIds = Array.isArray(row.taxIds) ? row.taxIds.map(String) : [];
      await db.run(`INSERT INTO master_v3_articles
        (sync_version, article_id, sku, description, article_type, uom, taxable, tax_ids_json, family_id, category_id, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sync_version, article_id) DO UPDATE SET sku=excluded.sku, description=excluded.description,
        article_type=excluded.article_type, uom=excluded.uom, taxable=excluded.taxable,
        tax_ids_json=excluded.tax_ids_json, family_id=excluded.family_id, category_id=excluded.category_id, active=excluded.active`,
      [version, requiredId(row, 'id'), optionalText(row.sku), optionalText(row.description), optionalText(row.type),
        optionalText(row.uom), row.taxable === true ? 1 : 0, JSON.stringify(taxIds), optionalText(row.familyId),
        optionalText(row.categoryId), booleanInt(row.active)], false);
      return;
    }
    if (dataset === 'prices') {
      await db.run(`INSERT INTO master_v3_prices(sync_version, article_id, tariff_id, price) VALUES (?, ?, ?, ?)
        ON CONFLICT(sync_version, article_id, tariff_id) DO UPDATE SET price=excluded.price`,
      [version, requiredId(row, 'articleId'), requiredId(row, 'tariffId'), finiteNumber(row.price, 'price')], false);
      return;
    }
    if (dataset === 'tariffs') {
      await db.run(`INSERT INTO master_v3_tariffs(sync_version, tariff_id, code, name, currency, active)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(sync_version, tariff_id) DO UPDATE SET
        code=excluded.code, name=excluded.name, currency=excluded.currency, active=excluded.active`,
      [version, requiredId(row, 'id'), optionalText(row.code), optionalText(row.name), optionalText(row.currency), booleanInt(row.active)], false);
      return;
    }
    if (dataset === 'taxes') {
      await db.run(`INSERT INTO master_v3_taxes(sync_version, tax_id, code, name, rate, active)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(sync_version, tax_id) DO UPDATE SET
        code=excluded.code, name=excluded.name, rate=excluded.rate, active=excluded.active`,
      [version, requiredId(row, 'id'), optionalText(row.code), optionalText(row.name),
        row.rate == null ? null : finiteNumber(row.rate, 'rate'), booleanInt(row.active)], false);
      return;
    }
    if (dataset === 'variants') {
      await db.run(`INSERT INTO master_v3_variants(sync_version, article_id, variant_id, code, description, active)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(sync_version, article_id, variant_id) DO UPDATE SET
        code=excluded.code, description=excluded.description, active=excluded.active`,
      [version, requiredId(row, 'articleId'), requiredId(row, 'id'), optionalText(row.code),
        optionalText(row.description), booleanInt(row.active)], false);
      return;
    }
    if (dataset === 'barcodes') {
      await db.run(`INSERT INTO master_v3_barcodes(sync_version, barcode, article_id, variant_id)
        VALUES (?, ?, ?, ?) ON CONFLICT(sync_version, barcode, article_id, variant_id) DO NOTHING`,
      [version, requiredId(row, 'code'), requiredId(row, 'articleId'), optionalText(row.variantId) || ''], false);
      return;
    }
    throw new LargeMasterSyncV3Error('SYNC_V3_DATASET_UNSUPPORTED');
  }

}
