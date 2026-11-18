export type AuditRow = Record<string, unknown>;
/** Raw SQL row bytes are bounded before the bridge. JSON escaping adds at most 6x plus schema keys. Output lines have an exact UTF-8 byte budget. */
export const REFERENCE_AUDIT_PAGE_BYTES = 128 * 1024;
export const REFERENCE_AUDIT_LINE_BYTES = 32 * 1024;
export interface BaselineReferenceInventory {
  schemaVersion: 2;
  startedAt: string;
  completedAt: string;
  scanComplete: boolean;
  referenceInventoryComplete: boolean;
  migrationAllowed: false;
  tableCount: number;
  rowCount: number;
  referenceCount: number;
  balanceCount: number;
  versionCount: number;
  issueCount: number;
  pageCount: number;
}
export interface BaselineReferenceProgress { table: string; rows: number; references: number; }
export interface BaselineReferenceInventoryOptions {
  /** Awaited for every bounded line. The consumer must not retain the full report. */
  emitLine(line: string): Promise<void>;
  onProgress?(progress: BaselineReferenceProgress): void;
  assertContext?(): void;
  signal?: AbortSignal;
}
export interface AuditConnection {
  query(sql: string, values?: unknown[]): Promise<{ values?: AuditRow[] }>;
  execute(sql: string, transaction?: boolean): Promise<unknown>;
}
export class BaselineReferenceRowTooLargeError extends Error {
  constructor(public readonly table: string, public readonly rowBytes: number) {
    super('REFERENCE_AUDIT_ROW_TOO_LARGE');
  }
}
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
export function assertReferenceAuditNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('REFERENCE_AUDIT_CANCELLED');
}

/** Streaming census inside the adapter writer lane. No database writes; no cumulative row/reference arrays. */
export async function collectBaselineReferenceInventory(connection: AuditConnection, options: BaselineReferenceInventoryOptions): Promise<BaselineReferenceInventory> {
  const report: BaselineReferenceInventory = { schemaVersion: 2, startedAt: new Date().toISOString(), completedAt: '',
    scanComplete: false, referenceInventoryComplete: false, migrationAllowed: false,
    tableCount: 0, rowCount: 0, referenceCount: 0, balanceCount: 0, versionCount: 0, issueCount: 0, pageCount: 0 };
  const check = () => assertReferenceAuditNotAborted(options.signal);
  const emit = async (entry: AuditRow) => {
    check();
    const line = JSON.stringify(entry) + '\n';
    if (new TextEncoder().encode(line).length > REFERENCE_AUDIT_LINE_BYTES) throw new Error('REFERENCE_AUDIT_ENTRY_TOO_LARGE');
    await options.emitLine(line);
    check();
  };
  const issue = async (table: string, column: string, row: AuditRow, kind: string) => {
    report.issueCount++;
    await emit({ type: 'issue', table, column, row, kind });
  };
  check();
  options.assertContext?.();
  try {
    // A lost BEGIN response must also enter rollback/quarantine handling.
    await connection.execute('BEGIN DEFERRED TRANSACTION;', false);
    await emit({ type: 'scope', schemaVersion: 2,
      scope: 'All committed SQLite tables: recognized V3 JSON authority keys, native baseline/sync/binding columns and declared foreign keys.',
      exclusions: ['Unsaved in-memory UI state is not persisted.', 'Undeclared implicit application relationships cannot be inferred.'],
      pageHashScope: 'Bounded projected rows; BLOB contents excluded and reported as issues.', migrationAllowed: false });
    const tables = (await connection.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).values || [];
    for (const required of ['documents','master_v3_state','master_v3_inventory_state','master_v3_operational_owner']) {
      if (!tables.some(table => table.name === required)) await issue(required, '', {}, 'MISSING_CORE_TABLE');
    }
    for (const entry of tables) {
      check();
      const name = String(entry.name);
      const columns = (await connection.query(`PRAGMA table_info(${quote(name)})`)).values || [];
      const keys = columns.filter(column => Number(column.pk) > 0).sort((a,b) => Number(a.pk)-Number(b.pk)).map(column => String(column.name));
      const foreignKeys = (await connection.query(`PRAGMA foreign_key_list(${quote(name)})`)).values || [];
      const foreignColumns = new Set(foreignKeys.map(key => String(key.from)));
      const order = keys.length ? keys.map(quote).join(',') : 'rowid';
      // Only lengths cross the bridge first. A huge JSON cell is never selected into WebView.
      const sizes = columns.filter(column => !/BLOB/i.test(String(column.type))).map(column => `coalesce(length(CAST(${quote(String(column.name))} AS BLOB)),0)`);
      const sizeExpression = `${32 + columns.length * 16}+${sizes.length ? sizes.join('+') : '0'}`;
      const projection = columns.map(column => /BLOB/i.test(String(column.type))
        ? `CASE WHEN ${quote(String(column.name))} IS NULL THEN NULL ELSE 'AUDIT_OPAQUE_BLOB' END AS ${quote(String(column.name))}`
        : quote(String(column.name))).join(',');
      let rowCount = 0;
      report.tableCount++;
      await emit({ type: 'table', name, columns: columns.map(column => String(column.name)), primaryKey: keys, foreignKeys });
      options.onProgress?.({table:name,rows:report.rowCount,references:report.referenceCount});
      while (true) {
        check();
        const lengths = (await connection.query(`SELECT ${sizeExpression} AS __audit_bytes__ FROM ${quote(name)} ORDER BY ${order} LIMIT ? OFFSET ?`, [32, rowCount])).values || [];
        if (!lengths.length) break;
        let count = 0, bytes = 0;
        for (const length of lengths) {
          const size = Number(length.__audit_bytes__);
          if (!Number.isSafeInteger(size) || size < 0) throw new Error('REFERENCE_AUDIT_SIZE_UNKNOWN');
          if (size > REFERENCE_AUDIT_PAGE_BYTES) throw new BaselineReferenceRowTooLargeError(name,size);
          if (bytes + size > REFERENCE_AUDIT_PAGE_BYTES) break;
          bytes += size; count++;
        }
        check();
        const page = (await connection.query(`SELECT ${keys.length ? '' : 'rowid AS __audit_rowid__, '}${projection} FROM ${quote(name)} ORDER BY ${order} LIMIT ? OFFSET ?`, [count, rowCount])).values || [];
        if (page.length !== count) throw new Error('REFERENCE_AUDIT_SNAPSHOT_CHANGED');
        report.pageCount++;
        await emit({ type: 'page', table: name, offset: rowCount, rows: page.length, projectedRowHash: await hash(page) });
        for (const record of page) {
          check();
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
            report.referenceCount++;
            await emit({ type: 'reference', table: name, ...(collection ? { collection } : {}), row: locator, path, valueHash: await hash(value), ...(Object.keys(authority).length ? { authority } : {}) });
          };
          for (const column of columns) {
            const key = String(column.name), value = record[key];
            if (value == null) continue;
            if (/BLOB/i.test(String(column.type))) { await issue(name,key,locator,'OPAQUE_BLOB_NOT_INSPECTED'); continue; }
            if (nativeReference.test(key) || foreignColumns.has(key)) await reference(key, value);
            if (typeof value !== 'string' || (!jsonColumn.test(key) && !/^\s*(?:\[|\{)/.test(value))) continue;
            let parsed: unknown;
            try { parsed = JSON.parse(value); }
            catch { if (jsonColumn.test(key)) await issue(name,key,locator,'MALFORMED_JSON'); continue; }
            if (name === 'documents' && key === 'data' && ['inventoryLedger','transactions','transactionHistory','parkedTickets','v3RestoredTicketSources','reservations'].includes(collection || '')
              && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) await issue(name,key,locator,'MALFORMED_SOURCE');
            // Keep one traversal frame per depth; never retain a copied full path for every descendant.
            const stack: Array<{entries: Array<[string,unknown]>; index: number; edge?: string}> = [];
            if (parsed && typeof parsed === 'object') stack.push({entries:Object.entries(parsed),index:0});
            while (stack.length) {
              check();
              const frame = stack[stack.length-1];
              if (frame.index >= frame.entries.length) { stack.pop(); continue; }
              const [field,child] = frame.entries[frame.index++];
              if (referenceKeys.has(field)) {
                const path = key + ':$' + stack.slice(1).map(parent => `[${JSON.stringify(parent.edge)}]`).join('') + `[${JSON.stringify(field)}]`;
                await reference(path,child);
              }
              if (child && typeof child === 'object') stack.push({entries:Object.entries(child),index:0,edge:field});
            }
          }
          if (name === 'master_v3_inventory_balances') {
            const balance: AuditRow = {};
            for (const key of ['item_id','warehouse_id','qty_on_hand','qty_reserved','qty_committed']) balance[key] = record[key];
            report.balanceCount++; await emit({ type: 'balance', ...balance });
          }
          if (name === 'master_v3_state' || name === 'master_v3_inventory_state') {
            report.versionCount++; await emit({ type: 'version', table: name, ...Object.fromEntries(Object.entries(record).filter(([key]) => !privateColumn.test(key))) });
          }
        }
        rowCount += page.length; report.rowCount += page.length;
        options.onProgress?.({table:name,rows:report.rowCount,references:report.referenceCount});
      }
      await emit({type:'table_end',name,rows:rowCount});
    }
    check();
    options.assertContext?.();
    await connection.execute('COMMIT;', false);
    report.completedAt = new Date().toISOString(); report.scanComplete = true;
    report.referenceInventoryComplete = report.issueCount === 0;
    // Publication/footer belongs to the caller, after the identity guard; no callback after COMMIT here.
    return report;
  } catch (error) {
    try { await connection.execute('ROLLBACK;', false); }
    catch (rollbackError) { throw new BaselineReferenceConnectionUncertainError(error, rollbackError); }
    throw error;
  }
}
