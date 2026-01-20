
import { DatabaseAdapter } from '../DatabaseAdapter';

const DB_KEY = 'clic_pos_db_v1';

export class LocalStorageAdapter implements DatabaseAdapter {
    private dbCache: any = null;

    async connect(): Promise<void> {
        // Simulate connection delay
        await new Promise(resolve => setTimeout(resolve, 50));
        this.loadFromStorage();
        console.log('[LocalStorageAdapter] Connected');
    }

    async disconnect(): Promise<void> {
        this.dbCache = null;
    }

    private loadFromStorage() {
        const raw = localStorage.getItem(DB_KEY);
        if (raw) {
            try {
                this.dbCache = JSON.parse(raw);
            } catch (e) {
                console.error('Failed to parse DB', e);
                this.dbCache = {};
            }
        } else {
            this.dbCache = {};
        }
    }

    private saveToStorage() {
        if (this.dbCache) {
            localStorage.setItem(DB_KEY, JSON.stringify(this.dbCache));
        }
    }

    async getCollection<T>(collectionName: string): Promise<T[]> {
        if (!this.dbCache) this.loadFromStorage();
        return (this.dbCache[collectionName] as T[]) || [];
    }

    async saveCollection<T>(collectionName: string, data: T[]): Promise<void> {
        if (!this.dbCache) this.loadFromStorage();
        this.dbCache[collectionName] = data;
        this.saveToStorage();
    }

    async saveDocument<T extends { id: string }>(collectionName: string, doc: T): Promise<void> {
        if (!this.dbCache) this.loadFromStorage();

        const collection = (this.dbCache[collectionName] as T[]) || [];
        const index = collection.findIndex(d => d.id === doc.id);

        if (index >= 0) {
            collection[index] = doc;
        } else {
            collection.push(doc);
        }

        this.dbCache[collectionName] = collection;
        this.saveToStorage();
    }

    async getDocument<T>(collectionName: string, id: string): Promise<T | null> {
        if (!this.dbCache) this.loadFromStorage();
        const collection = (this.dbCache[collectionName] as any[]) || [];
        return collection.find(d => d.id === id) || null;
    }
}
