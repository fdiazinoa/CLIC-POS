
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
    additionalOutboxEvents?: DurableOutboxEventInput[];
    paymentIntentIds?: string[];
}

export type MasterNumberRangeEntityType = 'CUSTOMER' | 'SUPPLIER' | 'ITEM';

export interface MasterNumberRangeRecord {
    id: string;
    entityType: MasterNumberRangeEntityType;
    prefix: string;
    startNumber: number;
    endNumber: number;
    nextNumber: number;
    lastIssuedNumber: number | null;
    padding: number;
    status: string;
    updatedAt: string;
    lastReportedNumber: number | null;
    progressPending: boolean;
    blockedReason?: string | null;
    /** Local ownership scope, taken from the validated terminal snapshot context. */
    terminalId?: string | null;
}

export interface NumberedMasterCommitInput {
    entityType: MasterNumberRangeEntityType;
    collectionName: 'customers' | 'suppliers' | 'products';
    document: { id: string; [key: string]: any };
    sourceTerminalId: string;
    localTerminalId?: string;
}

export interface NumberedMasterCommitResult {
    document: { id: string; [key: string]: any };
    range: MasterNumberRangeRecord | null;
    issuedNumber: number | null;
    code: string;
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
    // documents and their durable outbox events in one database transaction.
    commitFinancialTransaction?(input: FinancialCommitInput): Promise<void>;

    getMasterNumberRanges?(): Promise<MasterNumberRangeRecord[]>;
    upsertMasterNumberRanges?(ranges: MasterNumberRangeRecord[]): Promise<void>;
    commitNumberedMasterCreation?(input: NumberedMasterCommitInput): Promise<NumberedMasterCommitResult>;
    markMasterNumberRangeProgressReported?(rangeId: string, lastIssuedNumber: number): Promise<void>;
    blockMasterNumberRange?(rangeId: string, reason: string): Promise<void>;

    // Stats
    getStats?(): Promise<{ type: string; size: number; tables: number }>;
}
