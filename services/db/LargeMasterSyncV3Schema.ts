import { normalizeV3CategoryKey } from '../sync/LargeMasterSyncV3Categories';

export const LARGE_MASTER_SYNC_V3_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS master_v3_catalog_owners (
  sync_id TEXT NOT NULL, sync_version INTEGER NOT NULL, binding TEXT NOT NULL,
  inventory_sync_id TEXT NOT NULL, inventory_sync_version INTEGER NOT NULL,
  inventory_version INTEGER NOT NULL, inventory_cursor TEXT NOT NULL,
  PRIMARY KEY(sync_id, sync_version)
);
CREATE TABLE IF NOT EXISTS sync_v3_sessions (
  sync_id TEXT PRIMARY KEY NOT NULL,
  sync_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 3),
  contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('STAGING','VALIDATED','ACTIVE','FAILED','ROLLED_BACK')),
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  activated_at TEXT,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_v3_sessions_status_updated
ON sync_v3_sessions(status, updated_at);

CREATE TABLE IF NOT EXISTS sync_v3_dataset_progress (
  sync_id TEXT NOT NULL,
  dataset TEXT NOT NULL,
  expected_count INTEGER NOT NULL CHECK (expected_count >= 0),
  expected_chunks INTEGER NOT NULL CHECK (expected_chunks >= 0),
  expected_checksum TEXT,
  applied_count INTEGER NOT NULL DEFAULT 0,
  applied_chunks INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPLYING','COMPLETE','VALIDATED','FAILED')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (sync_id, dataset),
  FOREIGN KEY (sync_id) REFERENCES sync_v3_sessions(sync_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_v3_chunks (
  sync_id TEXT NOT NULL,
  dataset TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  checksum TEXT NOT NULL,
  record_count INTEGER NOT NULL CHECK (record_count >= 0),
  raw_bytes INTEGER NOT NULL CHECK (raw_bytes >= 0),
  status TEXT NOT NULL CHECK (status = 'APPLIED'),
  applied_at TEXT NOT NULL,
  PRIMARY KEY (sync_id, dataset, chunk_index),
  FOREIGN KEY (sync_id, dataset) REFERENCES sync_v3_dataset_progress(sync_id, dataset) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS master_v3_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  active_version INTEGER,
  active_sync_id TEXT,
  staging_version INTEGER,
  staging_sync_id TEXT,
  previous_version INTEGER,
  previous_sync_id TEXT,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO master_v3_state(singleton, updated_at) VALUES (1, datetime('now'));

CREATE TABLE IF NOT EXISTS master_v3_articles (
  sync_version INTEGER NOT NULL,
  article_id TEXT NOT NULL,
  sku TEXT,
  description TEXT,
  article_type TEXT,
  uom TEXT,
  taxable INTEGER NOT NULL,
  tax_ids_json TEXT NOT NULL,
  family_id TEXT,
  category_id TEXT,
  active INTEGER NOT NULL,
  sellable INTEGER NOT NULL DEFAULT 1,
  record_json TEXT,
  pos_category_key TEXT,
  pos_category_label TEXT,
  PRIMARY KEY (sync_version, article_id)
);
CREATE INDEX IF NOT EXISTS idx_master_v3_articles_version_sku
ON master_v3_articles(sync_version, sku);

CREATE TABLE IF NOT EXISTS master_v3_tariffs (
  sync_version INTEGER NOT NULL,
  tariff_id TEXT NOT NULL,
  code TEXT,
  name TEXT,
  currency TEXT,
  active INTEGER NOT NULL,
  record_json TEXT,
  PRIMARY KEY (sync_version, tariff_id)
);

CREATE TABLE IF NOT EXISTS master_v3_taxes (
  sync_version INTEGER NOT NULL,
  tax_id TEXT NOT NULL,
  code TEXT,
  name TEXT,
  rate REAL,
  active INTEGER NOT NULL,
  record_json TEXT,
  PRIMARY KEY (sync_version, tax_id)
);

CREATE TABLE IF NOT EXISTS master_v3_variants (
  sync_version INTEGER NOT NULL,
  article_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  code TEXT,
  description TEXT,
  active INTEGER NOT NULL,
  record_json TEXT,
  PRIMARY KEY (sync_version, article_id, variant_id),
  FOREIGN KEY (sync_version, article_id) REFERENCES master_v3_articles(sync_version, article_id)
);

CREATE TABLE IF NOT EXISTS master_v3_barcodes (
  sync_version INTEGER NOT NULL,
  barcode TEXT NOT NULL,
  article_id TEXT NOT NULL,
  variant_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (sync_version, barcode, article_id, variant_id),
  FOREIGN KEY (sync_version, article_id) REFERENCES master_v3_articles(sync_version, article_id)
);
CREATE INDEX IF NOT EXISTS idx_master_v3_variants_code ON master_v3_variants(sync_version, code);
CREATE INDEX IF NOT EXISTS idx_master_v3_barcodes_lookup
ON master_v3_barcodes(sync_version, barcode);

CREATE TABLE IF NOT EXISTS master_v3_prices (
  sync_version INTEGER NOT NULL,
  article_id TEXT NOT NULL,
  tariff_id TEXT NOT NULL,
  price REAL NOT NULL,
  PRIMARY KEY (sync_version, article_id, tariff_id),
  FOREIGN KEY (sync_version, article_id) REFERENCES master_v3_articles(sync_version, article_id),
  FOREIGN KEY (sync_version, tariff_id) REFERENCES master_v3_tariffs(sync_version, tariff_id)
);
CREATE INDEX IF NOT EXISTS idx_master_v3_prices_tariff_article
ON master_v3_prices(sync_version, tariff_id, article_id);

CREATE TABLE IF NOT EXISTS master_v3_inventory_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  sync_id TEXT NOT NULL,
  sync_version INTEGER NOT NULL,
  inventory_version INTEGER NOT NULL CHECK (inventory_version >= 0),
  cursor TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS master_v3_operational_owner (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  sync_id TEXT NOT NULL,
  sync_version INTEGER NOT NULL,
  binding TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS master_v3_inventory_balances (
  item_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  qty_on_hand REAL NOT NULL,
  qty_reserved REAL NOT NULL,
  qty_committed REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (item_id, warehouse_id)
);
`;

const CONTRACT_V2_COLUMNS = [
  ['sync_v3_sessions', 'contract_version', 'INTEGER NOT NULL DEFAULT 1'],
  ['master_v3_articles', 'sellable', 'INTEGER NOT NULL DEFAULT 1'],
  ['master_v3_articles', 'record_json', 'TEXT'],
  ['master_v3_articles', 'pos_category_key', 'TEXT'],
  ['master_v3_articles', 'pos_category_label', 'TEXT'],
  ['master_v3_tariffs', 'record_json', 'TEXT'],
  ['master_v3_taxes', 'record_json', 'TEXT'],
  ['master_v3_variants', 'record_json', 'TEXT'],
] as const;

/** Additive and idempotent: upgrades the already-activated emulator database in place. */
export const ensureLargeMasterSyncV3ContractColumns = async (db: {
  query(sql: string): Promise<{ values?: Array<Record<string, unknown>> }>;
  execute(sql: string): Promise<unknown>;
}): Promise<void> => {
  for (const [table, column, definition] of CONTRACT_V2_COLUMNS) {
    const info = await db.query(`PRAGMA table_info(${table});`);
    if (info.values?.some(row => String(row.name) === column)) continue;
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_master_v3_articles_pos_category
    ON master_v3_articles(sync_version, pos_category_key, active, sellable, article_id);`);
};

export const V3_CATEGORY_BACKFILL_BATCH_SIZE = 250;
type CategoryMigrationConnection = {
  query(sql: string, values?: unknown[]): Promise<{ values?: Array<Record<string, unknown>> }>;
  execute(sql: string, transaction?: boolean): Promise<unknown>;
  run(sql: string, values?: unknown[], transaction?: boolean): Promise<unknown>;
  executeSet?(set: Array<{ statement: string; values: unknown[] }>, transaction?: boolean, returnMode?: string): Promise<unknown>;
};

/** Caller holds the adapter write lock before it exposes the initialized DB.
 * NULL is resumable pending work; empty key marks a completed unclassified/invalid row.
 * Each bounded batch commits independently. Source JSON, IDs and financial state never change.
 */
export const backfillLargeMasterSyncV3Categories = async (db: CategoryMigrationConnection): Promise<void> => {
  let cursor: [unknown, unknown] | undefined;
  while (true) {
    await db.execute('BEGIN IMMEDIATE TRANSACTION;', false);
    try {
      const batch = (await db.query(`SELECT sync_version, article_id, record_json
        FROM master_v3_articles WHERE pos_category_key IS NULL
        ${cursor ? 'AND (sync_version, article_id) > (?, ?)' : ''}
        ORDER BY sync_version, article_id LIMIT ?`, [...(cursor || []), V3_CATEGORY_BACKFILL_BATCH_SIZE])).values || [];
      if (!batch.length) { await db.execute('COMMIT;', false); return; }
      const updates = batch.map(row => {
        let label = '';
        try {
          const record: unknown = typeof row.record_json === 'string' ? JSON.parse(row.record_json) : null;
          if (record && typeof record === 'object' && !Array.isArray(record)) {
            const category = (record as Record<string, unknown>).category;
            label = typeof category === 'string' ? category.trim() : '';
          }
        } catch { /* Preserve invalid JSON for the operational reader to reject as before. */ }
        return { statement: `UPDATE master_v3_articles SET pos_category_key = ?, pos_category_label = ?
          WHERE sync_version = ? AND article_id = ? AND pos_category_key IS NULL`,
        values: [normalizeV3CategoryKey(label), label, row.sync_version, row.article_id] };
      });
      if (db.executeSet) await db.executeSet(updates, false, 'no');
      else for (const update of updates) await db.run(update.statement, update.values, false);
      await db.execute('COMMIT;', false);
      const last = batch[batch.length - 1];
      cursor = [last.sync_version, last.article_id];
    } catch (error) {
      await db.execute('ROLLBACK;', false).catch(() => undefined);
      throw error;
    }
  }
};
