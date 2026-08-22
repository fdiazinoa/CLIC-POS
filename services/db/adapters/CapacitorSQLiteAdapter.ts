import { Capacitor } from '@capacitor/core';
import type { DatabaseAdapter, FinancialCommitInput } from '../DatabaseAdapter';
import { DURABLE_OUTBOX_SCHEMA_SQL } from '../../sync/DurableOutboxSchema';

const DB_NAME = 'clic_pos_native';
const DB_VERSION = 1;
const DOCUMENT_READ_BATCH_SIZE = 15;
const MAX_DOCUMENT_JSON_BYTES = 4 * 1024 * 1024;
const DOCUMENT_SCHEMA_MIGRATION_KEY = 'documents_schema_v2_migrated';
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
        data = excluded.data,
        updatedAt = excluded.updatedAt
`;

type SQLiteBridgeModule = typeof import('@capacitor-community/sqlite');
type SQLiteConnectionInstance = InstanceType<SQLiteBridgeModule['SQLiteConnection']>;
type SQLiteDBConnectionInstance = InstanceType<SQLiteBridgeModule['SQLiteDBConnection']>;

export class CapacitorSQLiteAdapter implements DatabaseAdapter {
    private sqliteConnection: SQLiteConnectionInstance | null = null;
    private db: SQLiteDBConnectionInstance | null = null;
    private isReady = false;
    public readonly adapterType = 'local';

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
        await db.run('DELETE FROM documents WHERE collection_name = ? AND doc_id = ?', [collectionName, id]);
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

        return db.run(normalized, params);
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

        const event = input.outboxEvent;
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

        for (const intentId of input.paymentIntentIds || []) {
            statements.push({
                statement: `UPDATE payment_intents_v2
                    SET status = 'COMMITTED', transaction_id = ?, committed_at = ?, updated_at = ?, last_error = NULL
                    WHERE intent_id = ? AND status = 'AUTHORIZED'`,
                values: [event.aggregateId, now, now, intentId],
            });
        }

        await this.executeSetOrRun(statements);
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
            CREATE TABLE IF NOT EXISTS storage_meta (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            );
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
            ${DURABLE_OUTBOX_SCHEMA_SQL}
        `);
        await this.migrateLegacyCollectionsBlobTable();
    }

    private async readStoredDocuments(collectionName: string): Promise<any[]> {
        const db = this.ensureDb();
        const docs: any[] = [];
        let offset = 0;

        while (true) {
            const result = await db.query(
                'SELECT data FROM documents WHERE collection_name = ? ORDER BY sort_order ASC, updatedAt ASC LIMIT ? OFFSET ?',
                [collectionName, DOCUMENT_READ_BATCH_SIZE, offset]
            );
            const rows = Array.isArray(result?.values) ? result.values : [];
            if (rows.length === 0) break;

            for (const row of rows) {
                const rawValue = row && typeof row === 'object' ? (row as Record<string, unknown>).data : null;
                if (typeof rawValue !== 'string' || !rawValue.trim()) continue;
                if (rawValue.length > MAX_DOCUMENT_JSON_BYTES) {
                    console.error(
                        `[CapacitorSQLiteAdapter] Skipping oversized ${collectionName} document `
                        + `(${rawValue.length} bytes) to avoid Android bridge OOM`
                    );
                    continue;
                }
                try {
                    docs.push(JSON.parse(rawValue));
                } catch (error) {
                    console.warn(`[CapacitorSQLiteAdapter] Failed to parse ${collectionName} row:`, error);
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
        const db = this.ensureDb();
        const executable = statements.map((entry) => ({
            statement: entry.statement.trim(),
            values: entry.values,
        }));

        if (typeof (db as any).executeSet === 'function') {
            await (db as any).executeSet(executable, true, 'no');
            return;
        }

        await db.execute('BEGIN TRANSACTION;');
        try {
            for (const entry of executable) {
                await db.run(entry.statement, entry.values);
            }
            await db.execute('COMMIT;');
        } catch (error) {
            await db.execute('ROLLBACK;').catch(() => undefined);
            throw error;
        }
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
            return [{ ...data, id: (data as any).id || 'current' }];
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
        await db.run(
            'INSERT OR REPLACE INTO storage_meta (key, value, updatedAt) VALUES (?, ?, ?)',
            [key, value, new Date().toISOString()]
        );
    }
}
