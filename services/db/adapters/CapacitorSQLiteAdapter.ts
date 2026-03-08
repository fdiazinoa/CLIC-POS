import { Capacitor } from '@capacitor/core';
import type { DatabaseAdapter } from '../DatabaseAdapter';

const DB_NAME = 'clic_pos_native';
const DB_VERSION = 1;

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
        await this.writeStoredDocuments(collectionName, docs);
    }

    async saveDocument<T extends { id: string }>(collectionName: string, doc: T): Promise<void> {
        const docs = await this.readStoredDocuments(collectionName);
        const nextDocs = Array.isArray(docs) ? [...docs] : [];
        const index = nextDocs.findIndex((item: T) => item.id === doc.id);

        if (index >= 0) {
            nextDocs[index] = doc;
        } else {
            nextDocs.push(doc);
        }

        await this.writeStoredDocuments(collectionName, nextDocs);
    }

    async bulkUpsert<T extends { id: string }>(collectionName: string, docs: T[]): Promise<void> {
        if (!docs || docs.length === 0) return;

        const storedDocs = await this.readStoredDocuments(collectionName);
        const docMap = new Map<string, T>();

        (storedDocs as T[]).forEach((doc) => {
            docMap.set(doc.id, doc);
        });

        docs.forEach((doc) => {
            docMap.set(doc.id, doc);
        });

        await this.writeStoredDocuments(collectionName, Array.from(docMap.values()));
    }

    async bulkUpdateProducts(productIds: string[], updates: any, _userId?: string, _userName?: string): Promise<void> {
        const products = await this.getCollection<any>('products') || [];
        if (!Array.isArray(products)) return;

        const idSet = new Set(productIds || []);
        const now = new Date().toISOString();
        const updatedProducts = products.map((product: any) => {
            if (!idSet.has(product.id)) return product;

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
            next.updatedAt = now;
            return next;
        });

        await this.saveCollection('products', updatedProducts);
    }

    async getDocument<T>(collectionName: string, id: string): Promise<T | null> {
        const docs = await this.readStoredDocuments(collectionName);
        if (!Array.isArray(docs)) return null;
        return docs.find((doc: T) => (doc as any).id === id) || null;
    }

    async deleteDocument(collectionName: string, id: string): Promise<void> {
        const docs = await this.readStoredDocuments(collectionName);
        if (!Array.isArray(docs)) return;

        const nextDocs = docs.filter((doc: any) => doc?.id !== id);
        await this.writeStoredDocuments(collectionName, nextDocs);
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
            CREATE TABLE IF NOT EXISTS collections (
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
        `);
    }

    private async readStoredDocuments(collectionName: string): Promise<any[]> {
        const db = this.ensureDb();
        const result = await db.query('SELECT value FROM collections WHERE key = ?', [collectionName]);
        const row = Array.isArray(result?.values) ? result.values[0] : null;
        const rawValue = row && typeof row === 'object' ? (row as Record<string, unknown>).value : null;

        if (typeof rawValue !== 'string' || !rawValue.trim()) {
            return [];
        }

        try {
            const parsed = JSON.parse(rawValue);
            return this.toStoredDocuments(collectionName, parsed);
        } catch (error) {
            console.warn(`[CapacitorSQLiteAdapter] Failed to parse ${collectionName}:`, error);
            return [];
        }
    }

    private async writeStoredDocuments(collectionName: string, docs: any[]): Promise<void> {
        const db = this.ensureDb();
        await db.run(
            'INSERT OR REPLACE INTO collections (key, value, updatedAt) VALUES (?, ?, ?)',
            [collectionName, JSON.stringify(Array.isArray(docs) ? docs : []), new Date().toISOString()]
        );
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
            if (!docs.length) return {};
            const current = docs.find((doc: any) => doc?.id === 'current');
            return current || docs[0] || {};
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
}
