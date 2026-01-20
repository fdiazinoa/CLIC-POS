import { DatabaseAdapter } from '../DatabaseAdapter';
// @ts-ignore
import initSqlJs from 'sql.js';

const DB_NAME = 'clic_pos_sqlite.db';
const STORE_NAME = 'snapshots';
const KEY_NAME = 'latest';

export class SQLiteWASMAdapter implements DatabaseAdapter {
    private db: any = null;
    private isReady: boolean = false;

    constructor() {
        console.log("🔌 SQLiteWASMAdapter instantiated.");
    }

    async connect(): Promise<void> {
        if (this.isReady) return;

        console.log("⏳ Initializing SQLite WASM...");

        try {
            const SQL = await initSqlJs({
                locateFile: (file: string) => `/assets/${file}`
            });

            // 1. Try to load from IndexedDB
            const savedData = await this.loadFromIndexedDB();

            if (savedData) {
                console.log("📂 Loaded database from IndexedDB.");
                this.db = new SQL.Database(savedData);
                // Ensure schema is up to date (migrations)
                this.initSchema();
            } else {
                console.log("✨ Creating new in-memory database.");
                this.db = new SQL.Database();
                this.initSchema();
            }

            this.isReady = true;
            console.log("✅ SQLite Database Ready.");
        } catch (error) {
            console.error("❌ Failed to initialize SQLite:", error);
            throw error;
        }
    }

    private initSchema() {
        if (!this.db) return;
        this.db.run(`
            CREATE TABLE IF NOT EXISTS collections (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS sync_queue (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                payload TEXT NOT NULL,
                status TEXT NOT NULL, -- PENDING, SYNCED, ERROR
                retryCount INTEGER DEFAULT 0,
                createdAt TEXT NOT NULL,
                error TEXT
            );
        `);
        this.saveToIndexedDB();
    }

    async disconnect(): Promise<void> {
        console.log('SQLite WASM Disconnected');
        if (this.db) {
            this.db = null;
            this.isReady = false;
        }
    }

    async getCollection<T>(collectionName: string): Promise<T[] | any> {
        if (!this.db) throw new Error("Database not initialized");

        const stmt = this.db.prepare("SELECT value FROM collections WHERE key = :key");
        const result = stmt.getAsObject({ ':key': collectionName });
        stmt.free();

        if (result && result.value) {
            return JSON.parse(result.value as string);
        }
        return null;
    }

    async saveCollection(collectionName: string, data: any): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        const json = JSON.stringify(data);
        this.db.run("INSERT OR REPLACE INTO collections (key, value) VALUES (?, ?)", [collectionName, json]);

        await this.saveToIndexedDB();
    }

    async saveDocument<T extends { id: string }>(collectionName: string, doc: T): Promise<void> {
        let collection = await this.getCollection<T[]>(collectionName) || [];
        // Ensure collection is an array
        if (!Array.isArray(collection)) collection = [];

        const existingIndex = collection.findIndex((d: T) => d.id === doc.id);
        if (existingIndex > -1) {
            collection[existingIndex] = doc;
        } else {
            collection.push(doc);
        }
        await this.saveCollection(collectionName, collection);
    }

    async getDocument<T>(collectionName: string, id: string): Promise<T | null> {
        const collection = await this.getCollection<T[]>(collectionName);
        if (collection && Array.isArray(collection)) {
            return collection.find((doc: T) => (doc as any).id === id) || null;
        }
        return null;
    }

    async executeSQL(query: string, params: any[] = []): Promise<any> {
        if (!this.db) throw new Error("Database not initialized");
        return this.db.exec(query, params);
    }

    async getStats(): Promise<{ type: string; size: number; tables: number }> {
        if (!this.db) return { type: 'SQLite WASM (Disconnected)', size: 0, tables: 0 };

        // Get size
        const data = this.db.export();
        const size = data.byteLength;

        // Get tables
        const result = this.db.exec("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        const tables = result[0]?.values[0][0] || 0;

        return {
            type: 'SQLite WASM (In-Memory + IndexedDB)',
            size,
            tables: tables as number
        };
    }

    // --- PERSISTENCE HELPERS (IndexedDB) ---

    private async saveToIndexedDB(): Promise<void> {
        if (!this.db) return;
        const data = this.db.export();

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);

            request.onupgradeneeded = (event: any) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };

            request.onsuccess = (event: any) => {
                const db = event.target.result;
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.put(data, KEY_NAME);

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            };

            request.onerror = () => reject(request.error);
        });
    }

    private async loadFromIndexedDB(): Promise<Uint8Array | null> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);

            request.onupgradeneeded = (event: any) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };

            request.onsuccess = (event: any) => {
                const db = event.target.result;
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const getRequest = store.get(KEY_NAME);

                getRequest.onsuccess = () => {
                    resolve(getRequest.result || null);
                };

                getRequest.onerror = () => reject(getRequest.error);
            };

            request.onerror = () => reject(request.error);
        });
    }
}
