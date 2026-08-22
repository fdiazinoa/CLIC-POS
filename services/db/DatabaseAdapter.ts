
export type DurableOutboxStatus =
    | 'PENDING'
    | 'SENDING'
    | 'RETRY_WAIT'
    | 'SYNCED_MASTER'
    | 'APPLIED_ERP'
    | 'REJECTED';

export interface DurableDocumentMutation {
    collectionName: string;
    document: { id: string; [key: string]: any };
}

export interface DurableOutboxEventInput {
    eventId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    schemaVersion: number;
    payload: Record<string, any>;
    createdAt: string;
}

export interface FinancialCommitInput {
    documents: DurableDocumentMutation[];
    outboxEvent: DurableOutboxEventInput;
    paymentIntentIds?: string[];
}

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
    bulkUpdateProducts(productIds: string[], updates: any, userId?: string, userName?: string): Promise<void>; // NEW: Bulk specific handling
    getDocument<T>(collectionName: string, id: string): Promise<T | null>;
    deleteDocument(collectionName: string, id: string): Promise<void>;

    // Raw Query (for SQLite specific optimizations later)
    executeSQL?(query: string, params?: any[]): Promise<any>;

    // Android SQLite only. POS-2A uses this boundary to commit the financial
    // documents and their durable outbox event in one database transaction.
    commitFinancialTransaction?(input: FinancialCommitInput): Promise<void>;

    // Stats
    getStats?(): Promise<{ type: string; size: number; tables: number }>;
}
