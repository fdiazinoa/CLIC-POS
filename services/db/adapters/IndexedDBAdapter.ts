import { DatabaseAdapter } from '../DatabaseAdapter';

const DB_NAME = 'clic_pos_indexeddb';
const DB_VERSION = 9; // Incremented to add inventory counts store
const OLD_DB_KEY = 'clic_pos_db_v1';

export class IndexedDBAdapter implements DatabaseAdapter {
    private db: IDBDatabase | null = null;
    public readonly adapterType = 'local';

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event: any) => {
                const db = event.target.result;
                const transaction = event.target.transaction;
                console.log(`[IndexedDBAdapter] 🔼 Upgrading DB to version ${DB_VERSION}`);

                // SCHEMA FIX V5/V6: Force delete and recreate transfers
                if (db.objectStoreNames.contains('transfers')) {
                    db.deleteObjectStore('transfers');
                }

                // SCHEMA FIX V7: Force delete and recreate zReports (User reported visibility issue)
                if (db.objectStoreNames.contains('zReports')) {
                    console.log('[IndexedDBAdapter] ♻️ Recreating zReports store to fix schema');
                    db.deleteObjectStore('zReports');
                }
                // This fixes the "DataError" caused by bad keyPath or corrupted schema
                if (db.objectStoreNames.contains('transfers')) {
                    db.deleteObjectStore('transfers');
                }

                // We'll create it fresh in the loop below or explicitly here
                // Let's rely on the loop below to create it, but we MUST delete it first if it existed bad.

                // We'll create stores dynamically as needed, 
                // but we initialize common ones here for safety
                const stores = [
                    'config', 'users', 'roles', 'customers', 'warehouses',
                    'products', 'transactions', 'transactionHistory', 'cashMovements', 'transfers',
                    'parkedTickets', 'purchaseOrders', 'suppliers', 'inventoryLedger',
                    'internalSequences', 'fiscalRanges', 'fiscalAllocations',
                    'localFiscalBuffer', 'campaigns', 'coupons', 'zReports',
                    'receptions', 'productStocks', 'supplierProductPrices',
                    'inventoryTracking', 'rooms', 'tables', 'globalSequenceCounter',
                    'watchlists', 'syncMetadata', 'inventorySnapshots', 'inventoryAuditLogs', 'inventoryCounts'
                ];

                stores.forEach(store => {
                    if (!db.objectStoreNames.contains(store)) {
                        db.createObjectStore(store, { keyPath: 'id' });
                    }
                });

                // Special case for globalSequenceCounter which is a single value, 
                // but we'll treat it as a collection for consistency with the interface
            };

            request.onsuccess = async (event: any) => {
                this.db = event.target.result;
                console.log('[IndexedDBAdapter] Connected');

                // Check if we need to migrate from LocalStorage
                await this.migrateFromLocalStorage();
                resolve();
            };

            request.onerror = (event: any) => {
                console.error('[IndexedDBAdapter] Connection error:', event.target.error);
                reject(event.target.error);
            };
        });
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
    }

    async getCollection<T>(collectionName: string): Promise<T[]> {
        if (!this.db) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            try {
                // Ensure store exists (handle dynamically)
                if (!this.db!.objectStoreNames.contains(collectionName)) {
                    // Can't create store outside of onupgradeneeded easily in vanilla IDB
                    // For now, return empty array if store missing
                    return resolve([]);
                }

                const transaction = this.db!.transaction(collectionName, 'readonly');
                const store = transaction.objectStore(collectionName);
                const request = store.getAll();

                request.onsuccess = () => {
                    const data = request.result;
                    if (collectionName === 'config' && data.length > 0) {
                        // Return the config object if it's the 'current' document
                        const current = data.find((d: any) => d.id === 'current');
                        resolve(current || data[0]);
                    }
                    if (collectionName === 'globalSequenceCounter' && data.length > 0) {
                        const val = data.find((d: any) => d.id === 'value');
                        resolve(val ? val.count : 0);
                    }
                    resolve(data as T[]);
                };
                request.onerror = () => reject(request.error);
            } catch (e) {
                console.error(`Error getting collection ${collectionName}:`, e);
                resolve([]); // Fallback
            }
        });
    }

    async saveCollection<T>(collectionName: string, data: T[]): Promise<void> {
        if (!this.db) throw new Error('DB not connected');

        // Note: For IDB, saveCollection (replace all) is expensive.
        // We'll clear the store and put all.
        return new Promise((resolve, reject) => {
            if (!this.db!.objectStoreNames.contains(collectionName)) {
                console.warn(`Creating store ${collectionName} during saveCollection is not supported directly. Upgrade required.`);
                return resolve();
            }

            const transaction = this.db!.transaction(collectionName, 'readwrite');
            const store = transaction.objectStore(collectionName);

            store.clear();

            if (collectionName === 'config' && !Array.isArray(data)) {
                store.put({ ...(data as any), id: 'current' });
            } else if (collectionName === 'globalSequenceCounter' && typeof data === 'number') {
                store.put({ id: 'value', count: data });
            } else if (Array.isArray(data)) {
                data.forEach(doc => store.put(doc));
            }

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async saveDocument<T extends { id: string }>(collectionName: string, doc: T): Promise<void> {
        if (!this.db) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            if (!this.db!.objectStoreNames.contains(collectionName)) {
                // Return silently or error? Let's log.
                console.error(`Store ${collectionName} missing in IndexedDB`);
                return resolve();
            }

            const transaction = this.db!.transaction(collectionName, 'readwrite');
            const store = transaction.objectStore(collectionName);
            store.put(doc);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async getDocument<T>(collectionName: string, id: string): Promise<T | null> {
        if (!this.db) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            if (!this.db!.objectStoreNames.contains(collectionName)) return resolve(null);

            const transaction = this.db!.transaction(collectionName, 'readonly');
            const store = transaction.objectStore(collectionName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteDocument(collectionName: string, id: string): Promise<void> {
        if (!this.db) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            if (!this.db!.objectStoreNames.contains(collectionName)) return resolve();

            const transaction = this.db!.transaction(collectionName, 'readwrite');
            const store = transaction.objectStore(collectionName);
            store.delete(id);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async checkHealth(): Promise<boolean> {
        return !!this.db;
    }
}
