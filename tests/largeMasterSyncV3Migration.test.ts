import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureLargeMasterSyncV3ContractColumns } from '../services/db/LargeMasterSyncV3Schema';

test('upgrades an existing V3 canary database without removing its active session', async () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE sync_v3_sessions (
        sync_id TEXT PRIMARY KEY, sync_version INTEGER, schema_version INTEGER,
        status TEXT, manifest_json TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE master_v3_articles (sync_version INTEGER, article_id TEXT, active INTEGER);
      CREATE TABLE master_v3_tariffs (sync_version INTEGER, tariff_id TEXT);
      CREATE TABLE master_v3_taxes (sync_version INTEGER, tax_id TEXT);
      CREATE TABLE master_v3_variants (sync_version INTEGER, article_id TEXT, variant_id TEXT);
      INSERT INTO sync_v3_sessions VALUES ('canary-v9', 9, 3, 'ACTIVE', '{}', 'old', 'old');
      INSERT INTO master_v3_articles VALUES (9, 'article-1', 1);
    `);
    const connection = {
      async query(sql: string) { return { values: sqlite.prepare(sql).all() as Array<Record<string, unknown>> }; },
      async execute(sql: string) { sqlite.exec(sql); },
    };
    await ensureLargeMasterSyncV3ContractColumns(connection);
    await ensureLargeMasterSyncV3ContractColumns(connection);
    const session = sqlite.prepare('SELECT sync_version, status, contract_version FROM sync_v3_sessions').get() as {
      sync_version: number; status: string; contract_version: number;
    };
    assert.deepEqual(session, { sync_version: 9, status: 'ACTIVE', contract_version: 1 });
    const article = sqlite.prepare('SELECT article_id, active, sellable, record_json FROM master_v3_articles').get() as {
      article_id: string; active: number; sellable: number; record_json: string | null;
    };
    assert.deepEqual(article, { article_id: 'article-1', active: 1, sellable: 1, record_json: null });
    for (const table of ['master_v3_tariffs', 'master_v3_taxes', 'master_v3_variants']) {
      assert.ok((sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }> )
        .some(column => column.name === 'record_json'));
    }
  } finally {
    sqlite.close();
  }
});
