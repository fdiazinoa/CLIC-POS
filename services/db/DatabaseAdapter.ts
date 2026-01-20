
export interface DatabaseAdapter {
    connect(): Promise<void>;
    disconnect(): Promise<void>;

    // Generic CRUD
    getCollection<T>(collectionName: string): Promise<T[]>;
    saveCollection<T>(collectionName: string, data: T[]): Promise<void>;

    // Document operations (simulated in LocalStorage, real in SQLite)
    saveDocument<T extends { id: string }>(collectionName: string, doc: T): Promise<void>;
    getDocument<T>(collectionName: string, id: string): Promise<T | null>;

    // Raw Query (for SQLite specific optimizations later)
    executeSQL?(query: string, params?: any[]): Promise<any>;

    // Stats
    getStats?(): Promise<{ type: string; size: number; tables: number }>;
}
