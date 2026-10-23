import type { SyncMonitorPage, SyncMonitorPageRequest } from './SyncMonitorPage';
import type { LargeMasterSyncV3Store } from '../sync/LargeMasterSyncV3Types';

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
    /** Verified original provenance: native restoration checks retirement inside its writer transaction. */
    recoveryOriginal?: import('../recovery/PendingOperationsRecovery').OriginalRecord;
    requireAbsent?: boolean;
    expectedDocument?: string;
    /** Native CAS-only append path; remote ACK retained-upsert cannot modify these fields. */
    v3FiscalMetadataOperation?: 'FISCAL_DISPATCH_CLAIM' | 'CLASSIFICATION_PROJECTION_APPEND' | 'CLASSIFICATION_ATTEMPT_CONSUME' | 'PRESUBMIT_EVIDENCE_REPAIR' | 'FISCAL_SUBMISSION_SCOPE_APPEND' | 'FISCAL_LOOKUP_APPROVAL_APPEND' | 'FISCAL_STATUS_RECONCILE' | 'FISCAL_PRINT_EVIDENCE_APPEND';
    /** Verified V3 sale demand; checked against scoped baseline + ledger inside the write transaction. */
    v3CurrentCatalog?: { syncId: string; syncVersion: number; binding: string };
    /** Narrow native CAS disposition for an already expired local stamped reservation. */
    v3ReservationExpiration?: true;
    inventoryPresentationPrecondition?: import('../inventoryPresentations/runtime').PresentationCommitProof;
    v3ExpectedRetainedDocument?: { collection: string; id: string; expected: string };
    v3StockRequirements?: Array<{ baseline: string; productId: string; warehouseId: string; quantity: number; quantityScale?: 4 }>;
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
    fiscalWorkflowCommits?: Array<{checkoutId:string;transactionId:string;birth:import('../fiscal/FiscalWorkflowV2Types').FiscalWorkflowBirthV2|null}>;
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

export interface FinancialNumberReservation {
    seriesId?: string;
    documentType?: string;
    global: boolean;
    fiscal?: {terminalId:string;type:import('../../types').FiscalDocumentCode;ncf:string;
        expectedConfig:string;expectedBuffer:string;expectedAllocation:string;expectedRange:string};
}
export interface FinancialNumberResult {
    ncf?: string;
    globalSequence?: number;
    seriesNumber?: number;
    displayId?: string;
    series?: { id: string; [key: string]: any };
}

export interface DatabaseAdapter {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    articleFormatSQL?():import('../articleFormats/store').FormatSQL;
    articleFormatFinancialSQL?():import('../articleFormats/store').FormatSQL;
    inventoryPresentationsSQL?():import('../inventoryPresentations/store').PresentationSQL;
    readonly fiscalWorkflowStore?: import('../fiscal/FiscalWorkflowV2Types').FiscalWorkflowStore;
    readonly terminalAuthEvidenceStore?: import('./TerminalAuthEvidenceStore').TerminalAuthEvidenceStore;
    readonly adapterType: 'local' | 'network';
    /** Present only on native adapters supporting the typed fiscal metadata CAS protocol. */
    readonly supportsV3FiscalMetadataCAS?: boolean;
    /** Readonly, all-status exact original SALE/PAYMENT rows for prepared fiscal readiness. */
    getFiscalAppliedSourceRows?(transactionId:string):Promise<import('../fiscal/FiscalAppliedReceiptV2').FiscalOutboxAnchor[]>;
    /** Android-only, dark V3 staging store. Its presence does not announce a network capability. */
    readonly masterSyncV3Store?: LargeMasterSyncV3Store;

    getFiscalStatusCandidates?(binding: string, afterId: string, limit: number): Promise<string[]>;

    getSyncMonitorPage?(request: SyncMonitorPageRequest): Promise<SyncMonitorPage>;

    /** Shared native transaction for global and document-series issuance. Never broadcasts inside SQL. */
    reserveFinancialNumbers?(input: FinancialNumberReservation): Promise<FinancialNumberResult>;

    /** Native-only setup projection: canonical CAS, taxes/tariffs/taxRate only; no generic save fallback. */
    compareAndSwapV3SetupConfig?(expected: import('../../types').BusinessConfig,
        projected: import('../../types').BusinessConfig, assertIdentity: () => void): Promise<void>;

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

    /** Strict all-or-nothing local publication; never falls back to a second storage backend. */
    isV3TicketClosed?(id: string): Promise<boolean>;
    saveDocumentsAtomically?(documents: DurableDocumentMutation[], requireAbsent?: boolean, replaceCollections?: string[]): Promise<void>;

    // Stats
    getStats?(): Promise<{ type: string; size: number; tables: number }>;
}
