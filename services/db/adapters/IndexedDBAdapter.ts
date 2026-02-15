import { DatabaseAdapter } from '../DatabaseAdapter';

const DB_NAME = 'clic_pos_indexeddb';
const DB_VERSION = 13; // Incremented to add reservations and inventory commitments
const OLD_DB_KEY = 'clic_pos_db_v1';
const OPEN_TIMEOUT_MS = 15000;
const CURSOR_IDLE_TIMEOUT_MS = 3000;
const CURSOR_HARD_TIMEOUT_MS = 8000;

const STORES = [
    'config', 'users', 'roles', 'customers', 'warehouses',
    'products', 'transactions', 'transactionHistory', 'cashMovements', 'transfers',
    'parkedTickets', 'purchaseOrders', 'suppliers', 'inventoryLedger',
    'internalSequences', 'fiscalRanges', 'fiscalAllocations',
    'localFiscalBuffer', 'campaigns', 'coupons', 'zReports',
    'receptions', 'productStocks', 'supplierProductPrices',
    'inventoryTracking', 'rooms', 'tables', 'globalSequenceCounter',
    'watchlists', 'syncMetadata', 'inventorySnapshots', 'inventoryAuditLogs', 'inventoryCounts',
    'offline_receptions', 'offline_reception_queue', 'offline_reception_conflicts',
    'offline_inventory_counts', 'offline_inventory_count_queue', 'offline_inventory_count_conflicts',
    'offline_print_queue', 'reservations', 'inventoryCommitments'
];

export class IndexedDBAdapter implements DatabaseAdapter {
    private db: IDBDatabase | null = null;
    private storageOnlyMode = false;
    public readonly adapterType = 'local';

    async connect(): Promise<void> {
        if (this.db) return;

        try {
            this.db = await this.openDatabase(DB_VERSION, OPEN_TIMEOUT_MS);
        } catch (error: any) {
            const message = String(error?.message || error || '');
            const canFallback = message.toLowerCase().includes('timeout') || message.toLowerCase().includes('blocked');

            if (!canFallback) {
                throw error;
            }

            console.warn('[IndexedDBAdapter] Upgrade open failed. Switching to localStorage-only mode.', error);
            this.storageOnlyMode = true;
            await this.migrateFromLocalStorage();
            return;
        }

        this.storageOnlyMode = false;
        console.log('[IndexedDBAdapter] Connected');
        this.attachVersionChangeHandler();
        await this.migrateFromLocalStorage();
    }

    private openDatabase(version?: number, timeoutMs = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const fail = (error: any) => {
                if (settled) return;
                settled = true;
                reject(error);
            };
            const complete = (db: IDBDatabase) => {
                if (settled) return;
                settled = true;
                resolve(db);
            };

            const request = typeof version === 'number'
                ? indexedDB.open(DB_NAME, version)
                : indexedDB.open(DB_NAME);

            const watchdog = window.setTimeout(() => {
                fail(new Error('IndexedDB open timeout. Possible blocked upgrade on another tab.'));
            }, timeoutMs);

            request.onupgradeneeded = (event: any) => {
                const db = event.target.result as IDBDatabase;
                const oldVersion = Number(event.oldVersion || 0);
                this.ensureSchema(db, oldVersion);
            };

            request.onsuccess = () => {
                window.clearTimeout(watchdog);
                if (settled) {
                    try {
                        request.result?.close();
                    } catch {
                        // no-op
                    }
                    return;
                }
                complete(request.result);
            };

            request.onerror = () => {
                window.clearTimeout(watchdog);
                console.error('[IndexedDBAdapter] Connection error:', request.error);
                fail(request.error || new Error('IndexedDB open error'));
            };

            request.onblocked = () => {
                window.clearTimeout(watchdog);
                fail(new Error('IndexedDB upgrade blocked by another open tab/session.'));
            };
        });
    }

    private ensureSchema(db: IDBDatabase, oldVersion: number) {
        console.log(`[IndexedDBAdapter] 🔼 Upgrading DB to version ${DB_VERSION}`);

        // Legacy schema fixes must run only for old DB versions.
        if (oldVersion < 7 && db.objectStoreNames.contains('transfers')) {
            db.deleteObjectStore('transfers');
        }

        if (oldVersion < 8 && db.objectStoreNames.contains('zReports')) {
            console.log('[IndexedDBAdapter] ♻️ Recreating zReports store to fix schema');
            db.deleteObjectStore('zReports');
        }

        STORES.forEach(store => {
            if (!db.objectStoreNames.contains(store)) {
                db.createObjectStore(store, { keyPath: 'id' });
            }
        });
    }

    private attachVersionChangeHandler() {
        if (!this.db) return;
        this.db.onversionchange = () => {
            console.warn('[IndexedDBAdapter] Version change detected. Closing DB connection to unblock upgrade.');
            this.db?.close();
            this.db = null;
        };
    }

    private hasStore(collectionName: string): boolean {
        return !this.storageOnlyMode && !!this.db && this.db.objectStoreNames.contains(collectionName);
    }

    private fallbackKey(collectionName: string): string {
        return `${DB_NAME}__fallback__${collectionName}`;
    }

    private readFallbackCollection(collectionName: string): any[] {
        try {
            const raw = localStorage.getItem(this.fallbackKey(collectionName));
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private writeFallbackCollection(collectionName: string, docs: any[]): void {
        localStorage.setItem(this.fallbackKey(collectionName), JSON.stringify(Array.isArray(docs) ? docs : []));
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
            return Number(row?.count || 0);
        }
        return docs;
    }

    private upsertFallbackDocument(collectionName: string, doc: any): void {
        const docs = this.readFallbackCollection(collectionName);
        const index = docs.findIndex(item => item?.id === doc?.id);
        if (index >= 0) {
            docs[index] = doc;
        } else {
            docs.push(doc);
        }
        this.writeFallbackCollection(collectionName, docs);
    }

    private async migrateFromLocalStorage() {
        const raw = localStorage.getItem(OLD_DB_KEY);
        if (!raw) return;

        console.log('[IndexedDBAdapter] 🚚 Starting migration from LocalStorage...');
        try {
            const data = JSON.parse(raw);
            const collections = Object.keys(data);

            for (const colName of collections) {
                const colData = data[colName];
                if (colName === 'config' && !Array.isArray(colData)) {
                    // Config is usually an object, but our adapter expects collections of objects with 'id'
                    // We'll wrap it if necessary, or just skip if it doesn't fit the 'id' requirement
                    // Actually, let's just make it a document with id 'current'
                    await this.saveDocument('config', { ...colData, id: 'current' });
                } else if (Array.isArray(colData)) {
                    // Bulk save documents
                    for (const doc of colData) {
                        if (doc && typeof doc === 'object' && doc.id) {
                            await this.saveDocument(colName, doc);
                        }
                    }
                } else if (typeof colData === 'number' && colName === 'globalSequenceCounter') {
                    await this.saveDocument(colName, { id: 'value', count: colData });
                }
            }

            // Delete the old key - don't try to backup since localStorage is full!
            localStorage.removeItem(OLD_DB_KEY);
            console.log('[IndexedDBAdapter] ✅ Migration successful. Old LocalStorage key removed.');
        } catch (e) {
            console.error('[IndexedDBAdapter] ❌ Migration failed:', e);
        }
    }

    async disconnect(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        this.storageOnlyMode = false;
    }

    async getCollection<T>(collectionName: string, _queryParams?: Record<string, string>): Promise<T[]> {
        if (!this.db && !this.storageOnlyMode) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            try {
                // Use localStorage for heavy collections to avoid IndexedDB lock contention from sync/pruning
                if (collectionName === 'transactions' || collectionName === 'transactionHistory') {
                    const docs = this.readFallbackCollection(collectionName);
                    return resolve(this.fromStoredDocuments(collectionName, docs));
                }

                if (!this.hasStore(collectionName)) {
                    const docs = this.readFallbackCollection(collectionName);
                    return resolve(this.fromStoredDocuments(collectionName, docs));
                }

                const transaction = this.db!.transaction(collectionName, 'readonly');
                const store = transaction.objectStore(collectionName);
                const request = store.getAll();

                request.onsuccess = () => {
                    const docs = Array.isArray(request.result) ? request.result : [];
                    resolve(this.fromStoredDocuments(collectionName, docs));
                };
                request.onerror = () => reject(request.error);
            } catch (e) {
                console.error(`Error getting collection ${collectionName}:`, e);
                const docs = this.readFallbackCollection(collectionName);
                resolve(this.fromStoredDocuments(collectionName, docs));
            }
        });
    }

    async saveCollection<T>(collectionName: string, data: T[]): Promise<void> {
        if (!this.db && !this.storageOnlyMode) throw new Error('DB not connected');
        const docs = this.toStoredDocuments(collectionName, data);

        return new Promise((resolve, reject) => {
            if (!this.hasStore(collectionName)) {
                this.writeFallbackCollection(collectionName, docs);
                return resolve();
            }

            const transaction = this.db!.transaction(collectionName, 'readwrite');
            const store = transaction.objectStore(collectionName);

            store.clear();
            docs.forEach(doc => store.put(doc));

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => {
                console.warn(`[IndexedDBAdapter] saveCollection fallback for ${collectionName}:`, transaction.error);
                try {
                    this.writeFallbackCollection(collectionName, docs);
                    resolve();
                } catch (e) {
                    reject(transaction.error || e);
                }
            };
        });
    }

    async saveDocument<T extends { id: string }>(collectionName: string, doc: T): Promise<void> {
        if (!this.db && !this.storageOnlyMode) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            // Use localStorage for heavy collections to match getCollection behavior and avoid lock contention
            if (collectionName === 'transactions' || collectionName === 'transactionHistory') {
                try {
                    this.upsertFallbackDocument(collectionName, doc);
                    return resolve();
                } catch (e) {
                    return reject(e);
                }
            }

            if (!this.hasStore(collectionName)) {
                this.upsertFallbackDocument(collectionName, doc);
                return resolve();
            }

            try {
                const transaction = this.db!.transaction(collectionName, 'readwrite');
                const store = transaction.objectStore(collectionName);
                store.put(doc);

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => {
                    console.warn(`[IndexedDBAdapter] saveDocument fallback for ${collectionName}:`, transaction.error);
                    try {
                        this.upsertFallbackDocument(collectionName, doc);
                        resolve();
                    } catch (e) {
                        reject(transaction.error || e);
                    }
                };
            } catch (error) {
                console.warn(`[IndexedDBAdapter] saveDocument immediate fallback for ${collectionName}:`, error);
                try {
                    this.upsertFallbackDocument(collectionName, doc);
                    resolve();
                } catch (e) {
                    reject(error || e);
                }
            }
        });
    }

    async getDocument<T>(collectionName: string, id: string): Promise<T | null> {
        if (!this.db && !this.storageOnlyMode) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            if (!this.hasStore(collectionName)) {
                const docs = this.readFallbackCollection(collectionName);
                const match = docs.find((doc: any) => doc?.id === id) || null;
                return resolve(match);
            }

            const transaction = this.db!.transaction(collectionName, 'readonly');
            const store = transaction.objectStore(collectionName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteDocument(collectionName: string, id: string): Promise<void> {
        if (!this.db && !this.storageOnlyMode) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            if (!this.hasStore(collectionName)) {
                const docs = this.readFallbackCollection(collectionName).filter((doc: any) => doc?.id !== id);
                this.writeFallbackCollection(collectionName, docs);
                return resolve();
            }

            const transaction = this.db!.transaction(collectionName, 'readwrite');
            const store = transaction.objectStore(collectionName);
            store.delete(id);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async checkHealth(): Promise<boolean> {
        return this.storageOnlyMode || !!this.db;
    }
}
