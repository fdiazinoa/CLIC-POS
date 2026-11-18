export type AuditRow = Record<string, unknown>;
export interface BaselineReferenceInventory {
  schemaVersion: 1;
  startedAt: string;
  completedAt: string;
  scanComplete: boolean;
  referenceInventoryComplete: boolean;
  scope: string;
  exclusions: string[];
  migrationAllowed: false;
  tables: Array<{ name: string; rows: number; pageHashes: string[]; columns: string[]; primaryKey: string[]; foreignKeys: AuditRow[] }>;
  references: Array<{ table: string; collection?: string; row: Record<string, unknown>; path: string; valueHash: string; authority?: Record<string, unknown> }>;
  inventoryBalances: AuditRow[];
  versions: AuditRow[];
  issues: Array<{ table: string; column: string; row: Record<string, unknown>; kind: string }>;
}
export interface AuditConnection {
  query(sql: string, values?: unknown[]): Promise<{ values?: AuditRow[] }>;
  execute(sql: string, transaction?: boolean): Promise<unknown>;
}
/** The native bridge could not confirm transaction closure. The adapter must quarantine this connection. */
export class BaselineReferenceConnectionUncertainError extends Error {
  constructor(error: unknown, rollbackError: unknown) {
    super('NATIVE_REFERENCE_AUDIT_CONNECTION_UNCERTAIN', { cause: { error, rollbackError } });
  }
}
const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"';
const referenceKeys = new Set(['v3SaleAuthority', 'v3InventoryBaseline', 'v3Binding', 'inventorySyncId', 'inventorySyncVersion']);
const nativeReference = /(?:baseline|^binding$|^inventory_sync_|^sync_id$|^sync_version$|^v3SaleAuthority$|^v3Binding$)/i;
const jsonColumn = /^(?:data|record_json|payload_text|manifest_json)$|_json$/i;
const privateColumn = /token|password|secret|credential|binding|auth|email|phone|address|name|tax_id|rnc|card|account/i;
const text = (value: unknown) => JSON.stringify(value) ?? 'null';
async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(text(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Full paged census of recognized V3 authority keys in every JSON cell and native baseline columns.
 * No raw documents, customer/payment data, credentials or binding values leave this function.
 * The caller must hold the adapter's shared writer lane for the read transaction. */
export async function collectBaselineReferenceInventory(connection: AuditConnection): Promise<BaselineReferenceInventory> {
  const report: BaselineReferenceInventory = { schemaVersion: 1, startedAt: new Date().toISOString(), completedAt: '',
    scanComplete: false, referenceInventoryComplete: false,
    scope: 'All committed SQLite tables: recognized V3 JSON authority keys, native baseline/sync/binding columns and declared foreign keys.',
    exclusions: ['Unsaved in-memory UI state is not persisted or exported.', 'Undeclared implicit application relationships cannot be inferred; this report never authorizes migration.'],
    migrationAllowed: false, tables: [], references: [], inventoryBalances: [], versions: [], issues: [] };
  try {
    // BEGIN can take effect even when the bridge loses its response; cleanup also covers that failure.
    await connection.execute('BEGIN DEFERRED TRANSACTION;', false);
    const tables = (await connection.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).values || [];
    for (const required of ['documents','master_v3_state','master_v3_inventory_state','master_v3_operational_owner']) {
      if (!tables.some(table => table.name === required)) report.issues.push({table:required,column:'',row:{},kind:'MISSING_CORE_TABLE'});
    }
    for (const entry of tables) {
      const name = String(entry.name);
      const columns = (await connection.query(`PRAGMA table_info(${quote(name)})`)).values || [];
      const keys = columns.filter(column => Number(column.pk) > 0).sort((a,b) => Number(a.pk)-Number(b.pk)).map(column => String(column.name));
      const foreignKeys = (await connection.query(`PRAGMA foreign_key_list(${quote(name)})`)).values || [];
      const foreignColumns = new Set(foreignKeys.map(key => String(key.from)));
      const pageSize = name === 'sync_v3_chunks' ? 4 : name === 'documents' ? 50 : columns.some(column => jsonColumn.test(String(column.name))) ? 25 : 250;
      const order = keys.length ? keys.map(quote).join(',') : 'rowid';
      const table = { name, rows: 0, pageHashes: [] as string[], columns: columns.map(column => String(column.name)), primaryKey: keys, foreignKeys };
      report.tables.push(table);
      while (true) {
        const page = (await connection.query(`SELECT ${keys.length ? '*' : 'rowid AS __audit_rowid__, *'} FROM ${quote(name)} ORDER BY ${order} LIMIT ? OFFSET ?`, [pageSize, table.rows])).values || [];
        if (!page.length) break;
        table.pageHashes.push(await hash(page));
        for (const record of page) {
          const locator: AuditRow = {};
          for (const key of keys.length ? keys : ['__audit_rowid__']) locator[key] = privateColumn.test(key) ? await hash(record[key]) : record[key];
          const collection = name === 'documents' && typeof record.collection_name === 'string' ? record.collection_name : undefined;
          const reference = async (path: string, value: unknown) => {
            const authority: AuditRow = {};
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              for (const key of ['syncId','syncVersion','inventorySyncId','inventorySyncVersion','inventoryVersion','inventoryCursor','warehouseId','tariffId','taxIncluded']) {
                const field = (value as AuditRow)[key];
                if (['string','number','boolean'].includes(typeof field)) authority[key] = field;
              }
            }
            report.references.push({ table: name, ...(collection ? { collection } : {}), row: locator, path, valueHash: await hash(value), ...(Object.keys(authority).length ? { authority } : {}) });
          };
          for (const column of columns) {
            const key = String(column.name), value = record[key];
            if (value == null) continue;
            if (/BLOB/i.test(String(column.type))) {
              report.issues.push({table:name,column:key,row:locator,kind:'OPAQUE_BLOB_NOT_INSPECTED'}); continue;
            }
            if (nativeReference.test(key) || foreignColumns.has(key)) await reference(key, value);
            if (typeof value !== 'string') continue;
            if (!jsonColumn.test(key) && !/^\s*(?:\[|\{)/.test(value)) continue;
            let parsed: unknown;
            try { parsed = JSON.parse(value); }
            catch {
              if (jsonColumn.test(key)) report.issues.push({table:name,column:key,row:locator,kind:'MALFORMED_JSON'});
              continue;
            }
            if (name === 'documents' && key === 'data' && ['inventoryLedger','transactions','transactionHistory','parkedTickets','v3RestoredTicketSources','reservations'].includes(collection || '')
              && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
              report.issues.push({table:name,column:key,row:locator,kind:'MALFORMED_SOURCE'});
            }
            const pending = [{ value: parsed, path: key + ':$' }];
            while (pending.length) {
              const next = pending.pop()!;
              if (!next.value || typeof next.value !== 'object') continue;
              for (const [field, child] of Object.entries(next.value)) {
                const path = `${next.path}[${JSON.stringify(field)}]`;
                if (referenceKeys.has(field)) await reference(path, child);
                pending.push({value:child,path});
              }
            }
          }
          if (name === 'master_v3_inventory_balances') {
            const balance: AuditRow = {};
            for (const key of ['item_id','warehouse_id','qty_on_hand','qty_reserved','qty_committed']) balance[key] = record[key];
            report.inventoryBalances.push(balance);
          }
          if (name === 'master_v3_state' || name === 'master_v3_inventory_state') {
            report.versions.push(Object.fromEntries(Object.entries(record).filter(([key]) => !privateColumn.test(key))));
          }
        }
        table.rows += page.length;
        if (page.length < pageSize) break;
      }
    }
    await connection.execute('COMMIT;', false);
    report.completedAt = new Date().toISOString();
    report.scanComplete = true;
    report.referenceInventoryComplete = report.issues.length === 0;
    return report;
  } catch (error) {
    try { await connection.execute('ROLLBACK;', false); }
    catch (rollbackError) { throw new BaselineReferenceConnectionUncertainError(error, rollbackError); }
    throw error; // No partial report may be exported as complete.
  }
}
