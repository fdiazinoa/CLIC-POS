
export interface DatabaseAdapter {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    readonly adapterType: 'local' | 'network';

    // Generic CRUD
    getCollection<T>(collectionName: string, queryParams?: Record<string, string>): Promise<T[]>;
    saveCollection<T>(collectionName: string, data: T[]): Promise<void>;

    // Document operations (simulated in LocalStorage, real in SQLite)
    saveDocument<T extends { id: string }>(collectionName: string, doc: T): Promise<void>;
    bulkUpsert<T extends { id: string }>(collectionName: string, docs: T[]): Promise<void>; // NEW: Efficient bulk upsert
    getDocument<T>(collectionName: string, id: string): Promise<T | null>;
    deleteDocument(collectionName: string, id: string): Promise<void>;

    // Raw Query (for SQLite specific optimizations later)
    executeSQL?(query: string, params?: any[]): Promise<any>;

    // Stats
    getStats?(): Promise<{ type: string; size: number; tables: number }>;
}
