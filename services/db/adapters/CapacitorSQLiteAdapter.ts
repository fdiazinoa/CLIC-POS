import { SYNC_MONITOR_PAGE_SQL, syncMonitorPageParams, decodeSyncMonitorPage, type SyncMonitorPageRequest } from '../SyncMonitorPage';
import { Capacitor } from '@capacitor/core';
import type {
    DatabaseAdapter,
    DurableDocumentMutation,
    FinancialCommitInput,
    MasterNumberRangeRecord,
    NumberedMasterCommitInput,
    NumberedMasterCommitResult,
} from '../DatabaseAdapter';
import { DURABLE_OUTBOX_SCHEMA_SQL } from '../../sync/DurableOutboxSchema';
import { applyMasterNumberToDocument, buildNumberedCustomerMutation } from '../../sync/masterNumberRangeContract';
import { compactStoredTerminalCatalog } from '../../../utils/compactTerminalCatalogSnapshot';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL, ensureLargeMasterSyncV3ContractColumns } from '../LargeMasterSyncV3Schema';
import { LargeMasterSyncV3SqliteStore } from '../LargeMasterSyncV3SqliteStore';
import { V3_FINANCIAL_RETAINED_UPSERT_SQL } from '../LargeMasterSyncV3FinancialRetention';

const DB_NAME = 'clic_pos_native';
const DB_VERSION = 1;
const DOCUMENT_READ_BATCH_SIZE = 15;
const MAX_DOCUMENT_JSON_BYTES = 4 * 1024 * 1024;
const CONFIG_READ_CHUNK_SIZE = 256 * 1024;
const DOCUMENT_SCHEMA_MIGRATION_KEY = 'documents_schema_v2_migrated';
const STRICT_DURABLE_COLLECTIONS = ['kdsDispatchQueue', 'productionPrintQueue'] as const;
const DOCUMENT_UPSERT_SQL = `
    INSERT INTO documents (collection_name, doc_id, data, sort_order, updatedAt)
    VALUES (
        ?,
        ?,
        ?,
        COALESCE(
            (SELECT sort_order FROM documents WHERE collection_name = ? AND doc_id = ?),
            (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM documents WHERE collection_name = ?)
        ),
        ?
    )
    ON CONFLICT(collection_name, doc_id) DO UPDATE SET
        data = ${V3_FINANCIAL_RETAINED_UPSERT_SQL},
        updatedAt = excluded.updatedAt
`;

type SQLiteBridgeModule = typeof import('@capacitor-community/sqlite');
type SQLiteConnectionInstance = InstanceType<SQLiteBridgeModule['SQLiteConnection']>;
type SQLiteDBConnectionInstance = InstanceType<SQLiteBridgeModule['SQLiteDBConnection']>;

export class CapacitorSQLiteAdapter implements DatabaseAdapter {
    private sqliteConnection: SQLiteConnectionInstance | null = null;
    private db: SQLiteDBConnectionInstance | null = null;
    private isReady = false;
    private writeQueue: Promise<unknown> = Promise.resolve();
    public readonly adapterType = 'local';
    public readonly masterSyncV3Store = new LargeMasterSyncV3SqliteStore(
        () => this.ensureDb() as any,
        operation => this.withWriteLock(operation),
    );

    async connect(): Promise<void> {
        if (this.isReady) return;

        if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
            throw new Error('CapacitorSQLiteAdapter is only available on Android native runtime.');
        }

        const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
        this.sqliteConnection = new SQLiteConnection(CapacitorSQLite);

        const consistency = await this.sqliteConnection.checkConnectionsConsistency().catch(() => ({ result: false }));
        const hasConnection = await this.sqliteConnection.isConnection(DB_NAME, false).catch(() => ({ result: false }));

        if (consistency.result && hasConnection.result) {
            this.db = await this.sqliteConnection.retrieveConnection(DB_NAME, false);
        } else {
            this.db = await this.sqliteConnection.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
        }

        await this.db.open();
        await this.initSchema();
        this.isReady = true;
        console.log('[CapacitorSQLiteAdapter] Connected');
    }

    async disconnect(): Promise<void> {
        if (!this.db || !this.sqliteConnection) return;

        try {
            await this.db.close();
        } catch (error) {
            console.warn('[CapacitorSQLiteAdapter] close() failed:', error);
        }

        try {
            await this.sqliteConnection.closeConnection(DB_NAME, false);
        } catch (error) {
            console.warn('[CapacitorSQLiteAdapter] closeConnection() failed:', error);
        }

        this.db = null;
        this.sqliteConnection = null;
        this.isReady = false;
    }

    async getSyncMonitorPage(request: SyncMonitorPageRequest) {
        const result = await this.ensureDb().query(SYNC_MONITOR_PAGE_SQL, syncMonitorPageParams(request));
        return decodeSyncMonitorPage(result.values?.[0]);
    }

    async getCollection<T>(collectionName: string, _queryParams?: Record<string, string>): Promise<T[] | any> {
        const docs = await this.readStoredDocuments(collectionName);
        return this.fromStoredDocuments(collectionName, docs);
    }

    async saveCollection<T>(collectionName: string, data: T[]): Promise<void> {
        const docs = this.toStoredDocuments(collectionName, data);
        await this.replaceStoredDocuments(collectionName, docs);
    }

    async saveDocument<T extends { id: string }>(collectionName: string, doc: T): Promise<void> {
        await this.upsertStoredDocuments(collectionName, [doc]);
    }

    async saveDocumentsAtomically(documents: DurableDocumentMutation[], requireAbsent = false, replaceCollections: string[] = []): Promise<void> {
        if (!documents.length && !replaceCollections.length) return;
        await this.withWriteLock(async () => {
            const db = this.ensureDb();
            const now = new Date().toISOString();
            const needsFinancialPrecondition = documents.some(row => row.document.v3InventoryBaseline
              || row.requireAbsent || row.expectedDocument !== undefined || row.v3StockRequirements);
            const assertAbsent = async () => {
              for (const { collectionName, document } of documents) {
                const rows = await db.query('SELECT doc_id FROM documents WHERE collection_name = ? AND doc_id = ?', [collectionName, document.id]);
                if (rows.values?.length) throw new Error('RECOVERY_LOCAL_CONFLICT:' + collectionName + ':' + document.id);
              }
            };
            // Preserve the established legacy executeSet path; V3/CAS checks must run after BEGIN.
            if (requireAbsent && !needsFinancialPrecondition) await assertAbsent();
            const precondition = async () => {
              await this.assertV3FinancialBaseline(documents);
              if (requireAbsent) await assertAbsent();
            };
            await this.executeUnlocked([...replaceCollections.map(name => ({statement: 'DELETE FROM documents WHERE collection_name = ?', values: [name]})), ...documents.map(({ collectionName, document }) => ({
                statement: DOCUMENT_UPSERT_SQL,
                values: [collectionName, document.id, JSON.stringify(document), collectionName, document.id, collectionName, now],
            }))], needsFinancialPrecondition ? precondition : undefined);
        });
    }

    async bulkUpsert<T extends { id: string }>(collectionName: string, docs: T[]): Promise<void> {
        if (!docs || docs.length === 0) return;
        await this.upsertStoredDocuments(collectionName, docs);
    }

    async bulkUpdateProducts(productIds: string[], updates: any, _userId?: string, _userName?: string): Promise<void> {
        const products = await this.getCollection<any>('products') || [];
        if (!Array.isArray(products)) return;

        const idSet = new Set(productIds || []);
        const now = new Date().toISOString();
        const updatedProducts = products.reduce((acc: any[], product: any) => {
            if (!idSet.has(product.id)) return acc;

            const next = { ...product };
            if (updates?.flags) {
                next.operationalFlags = { ...(next.operationalFlags || {}) };
                Object.entries(updates.flags).forEach(([key, cfg]: [string, any]) => {
                    if (cfg?.apply) {
                        (next.operationalFlags as any)[key] = cfg.value;
                    }
                });
            }
            if (updates?.classification) {
                if (updates.classification.categoryId) next.category = updates.classification.categoryId;
                if (updates.classification.measurementUnit) next.measurementUnit = updates.classification.measurementUnit;
                if (updates.classification.purchaseUnit) next.purchaseUnit = updates.classification.purchaseUnit;
            }
            if (updates?.pricing?.tariffActions) {
                const tariffCatalog = new Map(
                    (updates.pricing.tariffs || []).map((tariff: any) => [tariff.id, tariff])
                );
                next.tariffs = [...(next.tariffs || [])];

                Object.entries(updates.pricing.tariffActions).forEach(([tariffId, action]) => {
                    const existingIndex = next.tariffs.findIndex((tariff: any) => tariff.tariffId === tariffId);
                    if (action === 'ASSIGN') {
                        if (existingIndex === -1) {
                            const tariffMeta = tariffCatalog.get(tariffId) as { id: string; name?: string } | undefined;
                            next.tariffs.push({
                                tariffId,
                                name: tariffMeta?.name,
                                price: Number(next.price || 0),
                                costBase: Number(next.cost || 0),
                                margin: next.cost > 0
                                    ? ((Number(next.price || 0) - Number(next.cost || 0)) / Number(next.cost || 0)) * 100
                                    : 30
                            });
                        }
                    } else if (action === 'REMOVE' && existingIndex !== -1) {
                        next.tariffs.splice(existingIndex, 1);
                    }
                });
            }
            if (updates?.warehouseActions) {
                const activeInWarehouses = new Set(next.activeInWarehouses || []);
                Object.entries(updates.warehouseActions).forEach(([whId, action]) => {
                    if (action === 'ENABLE') {
                        activeInWarehouses.add(whId);
                    } else if (action === 'DISABLE') {
                        activeInWarehouses.delete(whId);
                    }
                });
                next.activeInWarehouses = Array.from(activeInWarehouses);
            }
            next.updatedAt = now;
            acc.push(next);
            return acc;
        }, []);

        await this.bulkUpsert('products', updatedProducts);
    }

    async getDocument<T>(collectionName: string, id: string): Promise<T | null> {
        const db = this.ensureDb();
        const result = await db.query(
            'SELECT data FROM documents WHERE collection_name = ? AND doc_id = ? LIMIT 1',
            [collectionName, id]
        );
        const row = Array.isArray(result?.values) ? result.values[0] : null;
        const rawValue = row && typeof row === 'object' ? (row as Record<string, unknown>).data : null;
        if (typeof rawValue !== 'string' || !rawValue.trim()) return null;

        try {
            return JSON.parse(rawValue) as T;
        } catch (error) {
            console.warn(`[CapacitorSQLiteAdapter] Failed to parse ${collectionName}/${id}:`, error);
            return null;
        }
    }

    async deleteDocument(collectionName: string, id: string): Promise<void> {
        const db = this.ensureDb();
        await this.withWriteLock(() => db.run('DELETE FROM documents WHERE collection_name = ? AND doc_id = ?', [collectionName, id]));
    }

    async executeSQL(query: string, params: any[] = []): Promise<any> {
        const db = this.ensureDb();
        const normalized = query.trim();
        const isReadQuery = /^(SELECT|PRAGMA|WITH)\b/i.test(normalized);

        if (isReadQuery) {
            const result = await db.query(normalized, params);
            const rows = Array.isArray(result?.values) ? result.values : [];
            if (rows.length === 0) return [];

            if (Array.isArray(rows[0])) {
                return rows;
            }

            const columns = Object.keys(rows[0]);
            return [
                {
                    columns,
                    values: rows.map((row: Record<string, unknown>) => columns.map((column) => row[column]))
                }
            ];
        }

        return this.withWriteLock(() => db.run(normalized, params));
    }

    async commitFinancialTransaction(input: FinancialCommitInput): Promise<void> {
        const now = new Date().toISOString();
        const statements: Array<{ statement: string; values: any[] }> = [];

        for (const mutation of input.documents) {
            const document = mutation.document;
            if (!document?.id || !mutation.collectionName) {
                throw new Error('Financial commit contains a document without collection or id.');
            }
            statements.push({
                statement: DOCUMENT_UPSERT_SQL,
                values: [
                    mutation.collectionName,
                    String(document.id),
                    JSON.stringify(document),
                    mutation.collectionName,
                    String(document.id),
                    mutation.collectionName,
                    now,
                ],
            });
        }

        const outboxEvents = [input.outboxEvent, ...(input.additionalOutboxEvents || [])];
        for (const event of outboxEvents) {
            statements.push({
                statement: `INSERT INTO sync_outbox_v2 (
                    event_id, event_type, aggregate_type, aggregate_id, schema_version,
                    payload_json, status, attempt_count, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
                ON CONFLICT(event_id) DO NOTHING`,
                values: [
                    event.eventId,
                    event.eventType,
                    event.aggregateType,
                    event.aggregateId,
                    event.schemaVersion,
                    JSON.stringify(event.payload),
                    event.createdAt,
                    now,
                ],
            });
        }

        const event = input.outboxEvent;
        for (const intentId of input.paymentIntentIds || []) {
            statements.push({
                statement: `UPDATE payment_intents_v2
                    SET status = 'COMMITTED', transaction_id = ?, committed_at = ?, updated_at = ?, last_error = NULL
                    WHERE intent_id = ? AND status = 'AUTHORIZED'`,
                values: [event.aggregateId, now, now, intentId],
            });
        }

        const needsFinancialPrecondition = input.documents.some(row => row.document.v3InventoryBaseline
          || row.requireAbsent || row.expectedDocument !== undefined || row.v3StockRequirements);
        await this.withWriteLock(() => this.executeUnlocked(statements,
          needsFinancialPrecondition ? () => this.assertV3FinancialBaseline(input.documents) : undefined));
    }

    async getMasterNumberRanges(): Promise<MasterNumberRangeRecord[]> {
        const result = await this.ensureDb().query(`SELECT
            range_id, entity_type, prefix, start_number, end_number, next_number,
            last_issued_number, padding, status, updated_at, last_reported_number,
            progress_pending, blocked_reason, terminal_id
            FROM master_number_ranges ORDER BY entity_type, start_number, range_id`);
        return (Array.isArray(result?.values) ? result.values : []).map((row: any) => ({
            id: String(row.range_id),
            entityType: row.entity_type,
            prefix: String(row.prefix),
            startNumber: Number(row.start_number),
            endNumber: Number(row.end_number),
            nextNumber: Number(row.next_number),
            lastIssuedNumber: row.last_issued_number == null ? null : Number(row.last_issued_number),
            padding: Number(row.padding),
            status: String(row.status),
            updatedAt: String(row.updated_at),
            lastReportedNumber: row.last_reported_number == null ? null : Number(row.last_reported_number),
            progressPending: Number(row.progress_pending) === 1,
            blockedReason: row.blocked_reason == null ? null : String(row.blocked_reason),
            terminalId: row.terminal_id == null ? null : String(row.terminal_id),
        }));
    }

    async upsertMasterNumberRanges(ranges: MasterNumberRangeRecord[]): Promise<void> {
        if (!ranges.length) return;
        await this.executeSetOrRun(ranges.map(range => ({
            statement: `INSERT INTO master_number_ranges (
                range_id, entity_type, prefix, start_number, end_number, next_number,
                last_issued_number, padding, status, updated_at, last_reported_number,
                progress_pending, blocked_reason, terminal_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(range_id) DO UPDATE SET
                entity_type = excluded.entity_type,
                prefix = excluded.prefix,
                start_number = excluded.start_number,
                end_number = excluded.end_number,
                next_number = MAX(master_number_ranges.next_number, excluded.next_number),
                last_issued_number = MAX(
                    COALESCE(master_number_ranges.last_issued_number, excluded.start_number - 1),
                    COALESCE(excluded.last_issued_number, excluded.start_number - 1)
                ),
                padding = excluded.padding,
                terminal_id = excluded.terminal_id,
                status = CASE
                    WHEN master_number_ranges.status = 'REVOKED' THEN 'REVOKED'
                    WHEN master_number_ranges.status = 'BLOCKED'
                         AND datetime(excluded.updated_at) <= datetime(master_number_ranges.updated_at)
                    THEN 'BLOCKED'
                    WHEN MAX(master_number_ranges.next_number, excluded.next_number) > excluded.end_number
                         AND excluded.status = 'ACTIVE'
                    THEN 'EXHAUSTED'
                    ELSE excluded.status
                END,
                updated_at = CASE WHEN datetime(excluded.updated_at) > datetime(master_number_ranges.updated_at)
                    THEN excluded.updated_at ELSE master_number_ranges.updated_at END,
                last_reported_number = MAX(
                    COALESCE(master_number_ranges.last_reported_number, excluded.start_number - 1),
                    COALESCE(excluded.last_reported_number, excluded.start_number - 1)
                ),
                progress_pending = CASE
                    WHEN master_number_ranges.progress_pending = 1 THEN 1
                    ELSE excluded.progress_pending
                END,
                blocked_reason = CASE
                    WHEN master_number_ranges.status = 'BLOCKED'
                         AND datetime(excluded.updated_at) <= datetime(master_number_ranges.updated_at)
                    THEN master_number_ranges.blocked_reason
                    ELSE excluded.blocked_reason
                END`,
            values: [
                range.id, range.entityType, range.prefix, range.startNumber, range.endNumber,
                range.nextNumber, range.lastIssuedNumber, range.padding, range.status, range.updatedAt,
                range.lastReportedNumber, range.progressPending ? 1 : 0, range.blockedReason ?? null,
                range.terminalId ?? null,
            ],
        })));
    }

    async commitNumberedMasterCreation(input: NumberedMasterCommitInput): Promise<NumberedMasterCommitResult> {
        return this.withWriteLock(async () => {
        const db = this.ensureDb();
        await db.execute('BEGIN IMMEDIATE TRANSACTION;', false);
        try {
            const existing = await this.getDocument<any>(input.collectionName, input.document.id);
            if (existing) {
                await db.execute('COMMIT;', false);
                return {
                    document: existing,
                    range: null,
                    issuedNumber: Number.isSafeInteger(existing.master_number_value) ? existing.master_number_value : null,
                    code: String(existing.external_code || existing.customer_code || existing.supplier_code || existing.sku || ''),
                };
            }
            await db.run(`UPDATE master_number_ranges
                SET status = 'EXHAUSTED'
                WHERE entity_type = ? AND status = 'ACTIVE' AND next_number > end_number`, [input.entityType], false);
            const selection = await db.query(`SELECT * FROM master_number_ranges
                WHERE entity_type = ? AND terminal_id = ? AND status = 'ACTIVE' AND next_number <= end_number
                ORDER BY start_number, range_id LIMIT 1`, [input.entityType, input.sourceTerminalId]);
            const row = Array.isArray(selection?.values) ? selection.values[0] : null;
            if (!row) throw new Error('La terminal agotó el rango asignado. Conéctala y solicita un nuevo rango.');
            const range: MasterNumberRangeRecord = {
                id: String(row.range_id), entityType: row.entity_type, prefix: String(row.prefix),
                startNumber: Number(row.start_number), endNumber: Number(row.end_number),
                nextNumber: Number(row.next_number),
                lastIssuedNumber: row.last_issued_number == null ? null : Number(row.last_issued_number),
                padding: Number(row.padding), status: String(row.status), updatedAt: String(row.updated_at),
                lastReportedNumber: row.last_reported_number == null ? null : Number(row.last_reported_number),
                progressPending: Number(row.progress_pending) === 1,
                blockedReason: row.blocked_reason == null ? null : String(row.blocked_reason),
                terminalId: row.terminal_id == null ? null : String(row.terminal_id),
            };
            const issuedNumber = range.nextNumber;
            const document = applyMasterNumberToDocument(
                input.entityType, input.document, range, issuedNumber, input.sourceTerminalId,
            );
            const nextNumber = issuedNumber + 1;
            await db.run(`UPDATE master_number_ranges SET
                next_number = ?, last_issued_number = ?, progress_pending = 1,
                status = CASE WHEN ? > end_number THEN 'EXHAUSTED' ELSE status END
                WHERE range_id = ?`, [nextNumber, issuedNumber, nextNumber, range.id], false);
            const now = new Date().toISOString();
            await db.run(DOCUMENT_UPSERT_SQL.trim(), [
                input.collectionName, input.document.id, JSON.stringify(document),
                input.collectionName, input.document.id, input.collectionName, now,
            ], false);
            if (input.entityType === 'CUSTOMER') {
                const mutation = buildNumberedCustomerMutation(document, input.localTerminalId || input.sourceTerminalId, now);
                await db.run(DOCUMENT_UPSERT_SQL.trim(), [
                    'customerMutations', mutation.id, JSON.stringify(mutation),
                    'customerMutations', mutation.id, 'customerMutations', now,
                ], false);
            }
            await db.execute('COMMIT;', false);
            return {
                document,
                range: { ...range, nextNumber, lastIssuedNumber: issuedNumber,
                    status: nextNumber > range.endNumber ? 'EXHAUSTED' : range.status, progressPending: true },
                issuedNumber,
                code: String(document.external_code),
            };
        } catch (error) {
            await db.execute('ROLLBACK;', false).catch(() => undefined);
            throw error;
        }
        });
    }

    async markMasterNumberRangeProgressReported(rangeId: string, lastIssuedNumber: number): Promise<void> {
        await this.withWriteLock(() => this.ensureDb().run(`UPDATE master_number_ranges SET
            last_reported_number = MAX(COALESCE(last_reported_number, start_number - 1), ?),
            progress_pending = CASE WHEN COALESCE(last_issued_number, start_number - 1)
                > MAX(COALESCE(last_reported_number, start_number - 1), ?) THEN 1 ELSE 0 END
            WHERE range_id = ?`, [lastIssuedNumber, lastIssuedNumber, rangeId]));
    }

    async blockMasterNumberRange(rangeId: string, reason: string): Promise<void> {
        await this.withWriteLock(() => this.ensureDb().run(
            `UPDATE master_number_ranges SET status = 'BLOCKED', blocked_reason = ? WHERE range_id = ?`,
            [reason, rangeId],
        ));
    }

    async getStats(): Promise<{ type: string; size: number; tables: number }> {
        const db = this.ensureDb();
        const tablesResult = await db.query(
            "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        );
        const pageCountResult = await db.query('PRAGMA page_count;');
        const pageSizeResult = await db.query('PRAGMA page_size;');

        const tables = this.readNumericResult(tablesResult?.values, 'count');
        const pageCount = this.readNumericResult(pageCountResult?.values, 'page_count');
        const pageSize = this.readNumericResult(pageSizeResult?.values, 'page_size');

        return {
            type: 'Capacitor SQLite (Android Native)',
            size: pageCount * pageSize,
            tables
        };
    }

    private ensureDb(): SQLiteDBConnectionInstance {
        if (!this.db) {
            throw new Error('Capacitor SQLite database not initialized');
        }
        return this.db;
    }

    private async initSchema(): Promise<void> {
        const db = this.ensureDb();
        await db.execute(`
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS documents (
                collection_name TEXT NOT NULL,
                doc_id TEXT NOT NULL,
                data TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                updatedAt TEXT NOT NULL,
                PRIMARY KEY (collection_name, doc_id)
            );
            CREATE INDEX IF NOT EXISTS idx_documents_collection_sort
            ON documents(collection_name, sort_order, updatedAt);
            CREATE INDEX IF NOT EXISTS idx_documents_v3_inventory_baseline
            ON documents(json_extract(data, '$.v3InventoryBaseline'), json_extract(data, '$.productId'), json_extract(data, '$.warehouseId'))
            WHERE collection_name = 'inventoryLedger' AND json_extract(data, '$.v3InventoryBaseline') IS NOT NULL;
            CREATE TRIGGER IF NOT EXISTS preserve_v3_inventory_delete BEFORE DELETE ON documents
            WHEN OLD.collection_name IN ('inventoryLedger', 'transactions', 'transactionHistory') AND json_extract(OLD.data, '$.v3InventoryBaseline') IS NOT NULL
            BEGIN SELECT RAISE(IGNORE); END;
            CREATE TRIGGER IF NOT EXISTS preserve_v3_inventory_update BEFORE UPDATE OF data ON documents
            WHEN OLD.collection_name = 'inventoryLedger' AND json_extract(OLD.data, '$.v3InventoryBaseline') IS NOT NULL
            AND (json_extract(NEW.data, '$.v3InventoryBaseline') IS NOT json_extract(OLD.data, '$.v3InventoryBaseline')
              OR json_extract(NEW.data, '$.productId') IS NOT json_extract(OLD.data, '$.productId')
              OR json_extract(NEW.data, '$.warehouseId') IS NOT json_extract(OLD.data, '$.warehouseId')
              OR json_extract(NEW.data, '$.qtyIn') IS NOT json_extract(OLD.data, '$.qtyIn')
              OR json_extract(NEW.data, '$.qtyOut') IS NOT json_extract(OLD.data, '$.qtyOut'))
            BEGIN SELECT RAISE(ABORT, 'SYNC_V3_INVENTORY_COVERAGE_REQUIRED'); END;
            CREATE TRIGGER IF NOT EXISTS preserve_v3_financial_authority_update BEFORE UPDATE OF data ON documents
            WHEN OLD.collection_name IN ('transactions','transactionHistory') AND json_extract(OLD.data, '$.v3InventoryBaseline') IS NOT NULL
            AND (json_extract(NEW.data, '$.v3InventoryBaseline') IS NOT json_extract(OLD.data, '$.v3InventoryBaseline')
              OR json_extract(NEW.data, '$.v3Binding') IS NOT json_extract(OLD.data, '$.v3Binding')
              OR json_extract(NEW.data, '$.v3WarehouseId') IS NOT json_extract(OLD.data, '$.v3WarehouseId')
              OR json_extract(NEW.data, '$.v3CommitFingerprint') IS NOT json_extract(OLD.data, '$.v3CommitFingerprint')
              OR json_extract(NEW.data, '$.items') IS NOT json_extract(OLD.data, '$.items')
              OR json_extract(NEW.data, '$.total') IS NOT json_extract(OLD.data, '$.total')
              OR json_extract(NEW.data, '$.netAmount') IS NOT json_extract(OLD.data, '$.netAmount')
              OR json_extract(NEW.data, '$.taxAmount') IS NOT json_extract(OLD.data, '$.taxAmount'))
            BEGIN SELECT RAISE(ABORT, 'SYNC_V3_FINANCIAL_AUTHORITY_IMMUTABLE'); END;
            CREATE TABLE IF NOT EXISTS storage_meta (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            );
            ${STRICT_DURABLE_COLLECTIONS.map(collection => `
            INSERT OR IGNORE INTO storage_meta (key, value, updatedAt)
            VALUES ('durable_collection:${collection}', 'documents_v1', datetime('now'));`).join('')}
            CREATE TABLE IF NOT EXISTS sync_queue (
                id TEXT PRIMARY KEY NOT NULL,
                type TEXT NOT NULL,
                payload TEXT NOT NULL,
                status TEXT NOT NULL,
                retryCount INTEGER DEFAULT 0,
                createdAt TEXT NOT NULL,
                error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_sync_queue_status_created_at
            ON sync_queue(status, createdAt);
            CREATE TABLE IF NOT EXISTS master_number_ranges (
                range_id TEXT PRIMARY KEY NOT NULL,
                entity_type TEXT NOT NULL,
                prefix TEXT NOT NULL,
                start_number INTEGER NOT NULL,
                end_number INTEGER NOT NULL,
                next_number INTEGER NOT NULL,
                last_issued_number INTEGER,
                padding INTEGER NOT NULL,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_reported_number INTEGER,
                progress_pending INTEGER NOT NULL DEFAULT 0,
                blocked_reason TEXT,
                terminal_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_master_number_ranges_allocation
            ON master_number_ranges(entity_type, status, start_number, range_id);
            ${DURABLE_OUTBOX_SCHEMA_SQL}
            ${LARGE_MASTER_SYNC_V3_SCHEMA_SQL}
        `);
        await ensureLargeMasterSyncV3ContractColumns(db);
        await this.migrateLegacyCollectionsBlobTable();
    }

    private async readStoredDocuments(collectionName: string): Promise<any[]> {
        const db = this.ensureDb();
        const docs: any[] = [];
        let offset = 0;

        while (true) {
            const result = await db.query(
                'SELECT doc_id, length(data) AS data_length, CASE WHEN length(data) <= ? THEN data ELSE NULL END AS data FROM documents WHERE collection_name = ? ORDER BY sort_order ASC, updatedAt ASC LIMIT ? OFFSET ?',
                [MAX_DOCUMENT_JSON_BYTES, collectionName, DOCUMENT_READ_BATCH_SIZE, offset]
            );
            const rows = Array.isArray(result?.values) ? result.values : [];
            if (rows.length === 0) break;

            for (const row of rows) {
                const storedRow = row && typeof row === 'object' ? row as Record<string, unknown> : {};
                let rawValue = storedRow.data;
                if (rawValue === null && collectionName === 'config' && typeof storedRow.doc_id === 'string') {
                    const chunks: string[] = [];
                    const length = Number(storedRow.data_length) || 0;
                    for (let start = 1; start <= length; start += CONFIG_READ_CHUNK_SIZE) {
                        const chunk = await db.query(
                            'SELECT substr(data, ?, ?) AS data FROM documents WHERE collection_name = ? AND doc_id = ?',
                            [start, CONFIG_READ_CHUNK_SIZE, collectionName, storedRow.doc_id]
                        );
                        const text = chunk.values?.[0]?.data;
                        if (typeof text !== 'string') throw new Error('No se pudo leer la configuración SQLite completa.');
                        chunks.push(text);
                    }
                    rawValue = chunks.join('');
                }
                if (typeof rawValue !== 'string' || !rawValue.trim()) continue;
                if (collectionName !== 'config' && rawValue.length > MAX_DOCUMENT_JSON_BYTES) {
                    console.error(
                        `[CapacitorSQLiteAdapter] Skipping oversized ${collectionName} document `
                        + `(${rawValue.length} bytes) to avoid Android bridge OOM`
                    );
                    continue;
                }
                try {
                    const parsed = JSON.parse(rawValue);
                    docs.push(collectionName === 'config' ? compactStoredTerminalCatalog(parsed) : parsed);
                } catch (error) {
                    console.warn(`[CapacitorSQLiteAdapter] Failed to parse ${collectionName} row:`, error);
                    if (collectionName === 'config') throw error;
                }
            }

            offset += rows.length;
            if (rows.length < DOCUMENT_READ_BATCH_SIZE) break;
        }

        return docs;
    }

    private async replaceStoredDocuments(collectionName: string, docs: any[]): Promise<void> {
        const db = this.ensureDb();
        const now = new Date().toISOString();
        const statements = [
            {
                statement: 'DELETE FROM documents WHERE collection_name = ?',
                values: [collectionName],
            },
            ...this.toDocumentRows(collectionName, docs).map((row, index) => ({
                statement: DOCUMENT_UPSERT_SQL,
                values: [
                    collectionName,
                    row.docId,
                    row.data,
                    collectionName,
                    row.docId,
                    collectionName,
                    now,
                ],
            })),
        ];

        await this.executeSetOrRun(statements);
    }

    private async upsertStoredDocuments(collectionName: string, docs: any[]): Promise<void> {
        if (!Array.isArray(docs) || docs.length === 0) return;

        const now = new Date().toISOString();
        const statements = this.toDocumentRows(collectionName, docs).map((row) => ({
            statement: DOCUMENT_UPSERT_SQL,
            values: [
                collectionName,
                row.docId,
                row.data,
                collectionName,
                row.docId,
                collectionName,
                now,
            ],
        }));

        await this.executeSetOrRun(statements);
    }

    private toDocumentRows(collectionName: string, docs: any[]): Array<{ docId: string; data: string }> {
        const rowsById = new Map<string, { docId: string; data: string }>();
        (Array.isArray(docs) ? docs : [])
            .map((doc, index) => {
                const docId = this.resolveDocumentId(collectionName, doc, index);
                if (!docId) return null;
                const payload = doc && typeof doc === 'object'
                    ? { ...doc, id: doc?.id || docId }
                    : { id: docId, value: doc };
                return {
                    docId,
                    data: JSON.stringify(payload),
                };
            })
            .filter((row): row is { docId: string; data: string } => Boolean(row))
            .forEach((row) => rowsById.set(row.docId, row));
        return Array.from(rowsById.values());
    }

    private async executeSetOrRun(statements: Array<{ statement: string; values: any[] }>): Promise<void> {
        if (!statements.length) return;
        await this.withWriteLock(() => this.executeUnlocked(statements));
    }

    private async assertV3FinancialBaseline(documents: DurableDocumentMutation[]): Promise<void> {
        const demands = new Map<string, { baseline: string; productId: string; warehouseId: string; quantity: number }>();
        for (const mutation of documents) {
            const document = mutation.document as any;
            if (mutation.requireAbsent || mutation.expectedDocument !== undefined) {
              const stored = await this.ensureDb().query('SELECT data FROM documents WHERE collection_name = ? AND doc_id = ?', [mutation.collectionName, document.id]);
              if (mutation.requireAbsent && stored.values?.length) throw new Error('SYNC_V3_DUPLICATE_COMMIT');
              if (mutation.expectedDocument !== undefined && stored.values?.[0]?.data !== mutation.expectedDocument) {
                throw new Error('SYNC_V3_CONCURRENT_FINANCIAL_UPDATE');
              }
            }
            if (!document.v3InventoryBaseline) continue;
            const [binding, syncId, syncVersion, inventoryVersion, cursor] = JSON.parse(document.v3InventoryBaseline);
            const result = await this.ensureDb().query(`SELECT o.binding FROM master_v3_operational_owner o
              JOIN master_v3_state s ON s.singleton = 1 JOIN master_v3_inventory_state i ON i.singleton = 1
              WHERE o.singleton = 1 AND o.binding = ? AND o.sync_id = ? AND o.sync_version = ?
              AND s.active_sync_id = o.sync_id AND s.active_version = o.sync_version
              AND i.sync_id = o.sync_id AND i.sync_version = o.sync_version
              AND i.inventory_version = ? AND i.cursor = ?`, [binding, syncId, syncVersion, inventoryVersion, cursor]);
            if (!result.values?.length || document.v3Binding !== binding) throw new Error('SYNC_V3_RUNTIME_VERSION_CHANGED');
            for (const requirement of mutation.v3StockRequirements || []) {
              if (requirement.baseline !== document.v3InventoryBaseline || requirement.warehouseId !== document.v3WarehouseId
                || !Number.isFinite(requirement.quantity) || requirement.quantity <= 0) throw new Error('SYNC_V3_MOVEMENT_AUTHORITY_INVALID');
              const key = JSON.stringify([requirement.baseline, requirement.productId, requirement.warehouseId]);
              const prior = demands.get(key);
              demands.set(key, { ...requirement, quantity: requirement.quantity + (prior?.quantity || 0) });
            }
        }
        // Both this read and every ledger write occur after BEGIN, under the shared native write queue.
        for (const demand of demands.values()) {
          const result = await this.ensureDb().query(`SELECT
            COALESCE((SELECT qty_on_hand - qty_reserved - qty_committed FROM master_v3_inventory_balances
              WHERE item_id = ? AND warehouse_id = ?), 0) + COALESCE((SELECT SUM(
                COALESCE(json_extract(data, '$.qtyIn'), 0) - COALESCE(json_extract(data, '$.qtyOut'), 0))
              FROM documents WHERE collection_name = 'inventoryLedger'
                AND json_extract(data, '$.v3InventoryBaseline') = ?
                AND json_extract(data, '$.productId') = ? AND json_extract(data, '$.warehouseId') = ?), 0) AS available`,
            [demand.productId, demand.warehouseId, demand.baseline, demand.productId, demand.warehouseId]);
          if (demand.quantity > Number(result.values?.[0]?.available || 0)) throw new Error('SYNC_V3_STOCK_INSUFFICIENT');
        }
    }

    private async executeUnlocked(statements: Array<{ statement: string; values: any[] }>, precondition?: () => Promise<void>): Promise<void> {
        const db = this.ensureDb();
        const executable = statements.map((entry) => ({
            statement: entry.statement.trim(),
            values: entry.values,
        }));

        if (!precondition && typeof (db as any).executeSet === 'function') {
            await (db as any).executeSet(executable, true, 'no');
            return;
        }

        await db.execute('BEGIN TRANSACTION;', false);
        try {
            await precondition?.();
            for (const entry of executable) {
                await db.run(entry.statement, entry.values, false);
            }
            await db.execute('COMMIT;', false);
        } catch (error) {
            await db.execute('ROLLBACK;', false).catch(() => undefined);
            throw error;
        }
    }

    private withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(operation, operation);
        this.writeQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    private resolveDocumentId(collectionName: string, doc: any, index: number): string {
        if (collectionName === 'config') {
            return String(doc?.id || 'current');
        }
        if (collectionName === 'globalSequenceCounter') {
            return 'value';
        }
        const explicitId = doc?.id ?? doc?._id ?? doc?.uuid;
        if (explicitId !== undefined && explicitId !== null && String(explicitId).trim()) {
            return String(explicitId);
        }
        return `${collectionName}_${index}`;
    }

    private toStoredDocuments(collectionName: string, data: any): any[] {
        if (collectionName === 'config' && data && !Array.isArray(data)) {
            return [{ ...compactStoredTerminalCatalog(data), id: (data as any).id || 'current' }];
        }

        if (collectionName === 'globalSequenceCounter' && typeof data === 'number') {
            return [{ id: 'value', count: data }];
        }

        return Array.isArray(data) ? data : [];
    }

    private fromStoredDocuments(collectionName: string, docs: any[]): any {
        if (collectionName === 'config') {
            const realDocs = docs.filter((doc: any) => doc?.id !== '_db_initialized' && doc?.id !== 'config_metadata');
            if (!realDocs.length) return {};
            const current = realDocs.find((doc: any) => doc?.id === 'current');
            return current || realDocs[0] || {};
        }

        if (collectionName === 'globalSequenceCounter') {
            const row = docs.find((doc: any) => doc?.id === 'value');
            return typeof row?.count === 'number' ? row.count : 0;
        }

        return docs;
    }

    private readNumericResult(values: any[] | undefined, key: string): number {
        if (!Array.isArray(values) || values.length === 0) return 0;
        const row = values[0];
        if (row && typeof row === 'object' && key in row) {
            return Number((row as Record<string, unknown>)[key] || 0);
        }
        return 0;
    }

    private async migrateLegacyCollectionsBlobTable(): Promise<void> {
        const db = this.ensureDb();
        const migrated = await this.getMetaValue(DOCUMENT_SCHEMA_MIGRATION_KEY);
        if (migrated === '1') return;

        const hasLegacyTable = await this.hasLegacyCollectionsBlobTable();
        if (!hasLegacyTable) {
            await this.setMetaValue(DOCUMENT_SCHEMA_MIGRATION_KEY, '1');
            return;
        }

        const existingDocsCount = this.readNumericResult(
            (await db.query('SELECT COUNT(*) as count FROM documents'))?.values,
            'count'
        );
        if (existingDocsCount > 0) {
            await this.setMetaValue(DOCUMENT_SCHEMA_MIGRATION_KEY, '1');
            return;
        }

        console.log('[CapacitorSQLiteAdapter] Migrating legacy collection blobs to document rows...');
        const keyResult = await db.query('SELECT key FROM collections ORDER BY key ASC');
        const keyRows = Array.isArray(keyResult?.values) ? keyResult.values : [];
        let migratedRows = 0;

        for (const keyRow of keyRows) {
            const collectionName = keyRow && typeof keyRow === 'object'
                ? String((keyRow as Record<string, unknown>).key || '')
                : '';
            if (!collectionName) continue;

            const result = await db.query(
                'SELECT key, value FROM collections WHERE key = ? LIMIT 1',
                [collectionName]
            );
            const row = Array.isArray(result?.values) ? result.values[0] : null;
            const rawValue = row && typeof row === 'object' ? (row as Record<string, unknown>).value : null;
            if (typeof rawValue !== 'string' || !rawValue.trim()) continue;
            if (rawValue.length > MAX_DOCUMENT_JSON_BYTES) {
                console.error(
                    `[CapacitorSQLiteAdapter] Skipping oversized legacy blob ${collectionName} `
                    + `(${rawValue.length} bytes) during migration`
                );
                continue;
            }

            try {
                const parsed = JSON.parse(rawValue);
                const docs = this.toStoredDocuments(collectionName, parsed);
                await this.replaceStoredDocuments(collectionName, docs);
                migratedRows += docs.length;
            } catch (error) {
                console.warn(`[CapacitorSQLiteAdapter] Failed to migrate ${collectionName}:`, error);
            }
        }

        await this.setMetaValue(DOCUMENT_SCHEMA_MIGRATION_KEY, '1');
        console.log(`[CapacitorSQLiteAdapter] Migrated ${migratedRows} documents from legacy blobs.`);
    }

    private async hasLegacyCollectionsBlobTable(): Promise<boolean> {
        const db = this.ensureDb();
        const tableResult = await db.query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='collections'"
        );
        if (!Array.isArray(tableResult?.values) || tableResult.values.length === 0) return false;

        const pragmaResult = await db.query('PRAGMA table_info(collections);');
        const columns = new Set(
            (Array.isArray(pragmaResult?.values) ? pragmaResult.values : [])
                .map((row: any) => String(row?.name || ''))
                .filter(Boolean)
        );
        return columns.has('key') && columns.has('value');
    }

    private async getMetaValue(key: string): Promise<string | null> {
        const db = this.ensureDb();
        const result = await db.query('SELECT value FROM storage_meta WHERE key = ? LIMIT 1', [key]);
        const row = Array.isArray(result?.values) ? result.values[0] : null;
        const value = row && typeof row === 'object' ? (row as Record<string, unknown>).value : null;
        return typeof value === 'string' ? value : null;
    }

    private async setMetaValue(key: string, value: string): Promise<void> {
        const db = this.ensureDb();
        await this.withWriteLock(() => db.run(
            'INSERT OR REPLACE INTO storage_meta (key, value, updatedAt) VALUES (?, ?, ?)',
            [key, value, new Date().toISOString()]
        ));
    }
}
