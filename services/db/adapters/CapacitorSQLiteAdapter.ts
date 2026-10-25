import {TRACKING_OPERATION_SCHEMA,prepareTrackingOperation,readTrackingOperation,recordTrackingPaymentEffect,assertTrackingOperationCommit,readCommittedTrackingReceipt,retireTrackingOperation,type TrackingOperation,type TrackingScope} from '../TrackingCheckoutOperation';
import {base6,readV3Base6Stock} from '../V3Base6Stock';
import {TRACKING_ALLOCATION_SCHEMA,installTrackingAllocation,prepareTrackingCheckout,fenceTrackingCheckout,abandonTrackingCheckout,consumeTrackingCheckout} from '../TrackingAllocationStore';
import type {Transaction} from '../../../types';
import type {TrackingAuthority,TrackingSelection} from '../../tracking/TrackingAuthority';
import {OFFLINE_FISCAL_ALLOCATION_WRITER_SCHEMA} from '../OfflineFiscalAllocationStore';
import {FISCAL_RETIREMENT_WRITER_SCHEMA,OFFLINE_FISCAL_ABANDON_WRITER_SCHEMA,assertRetirementRecoveryPromotion} from '../FiscalWorkflowRetirementStore';
import {assertTableFiscalSaleContext} from '../../fiscal/OfflineTableFiscalCheckout';
import {assertPresentationCommit} from '../../inventoryPresentations/nativeGuard';
import { NativeFiscalWorkflowV2Store,FISCAL_WORKFLOW_V2_SCHEMA,consumeFiscalWorkflowBirth } from '../FiscalWorkflowV2Store';
import {NativeTerminalAuthEvidenceStore,TERMINAL_AUTH_EVIDENCE_SCHEMA} from '../TerminalAuthEvidenceStore';
import {FISCAL_OUTBOX_SOURCE_SQL,fiscalOutboxSourceParams,captureFiscalOutboxAnchors,type FiscalOutboxAnchor} from '../../fiscal/FiscalAppliedReceiptV2';
import {assertV3ReservationSource,assertV3ReservationLines,assertV3ReservationInvoice,reservationClaimId} from '../../sync/LargeMasterSyncV3ReservationAuthority';
import {reconcileInventoryPoolIndex,isInventoryPoolDDL} from '../../articleFormats/inventoryPoolIndex';
import {assertNoReconciledOrdinaryWriter} from '../../articleFormats/inventoryJournal';
import {readV3Base4Stock,base4} from '../V3Base4Stock';
import {Money} from '../../articleFormats/wire';
import {NATIVE_FISCAL_RECEIPTS_SCHEMA,planNativeFiscalReceipt} from '../NativeFiscalReservation';
import type {LargeMasterSyncV3Store} from '../../sync/LargeMasterSyncV3Types';
import {validateFiscalBufferReservation} from '../../../utils/fiscalBufferAuthority';
import { ARTICLE_FORMAT_RETAINED_UPSERT_SQL } from '../ArticleFormatFinancialRetention';
import { planFinancialNumbers, FINANCIAL_COUNTER_UPSERT_SQL } from '../FinancialNumberReservation';
import { ARTICLE_FORMATS_SCHEMA } from '../../articleFormats/schema';
import type { FormatSQL,FormatStatement } from '../../articleFormats/store';
import { getEffectiveFiscalComplianceConfig, getProviderEnvironment } from '../../../utils/fiscal/fiscalHelpers';
import { validateV3FiscalMetadataMutation,validateFiscalDispatchClaimBatch } from '../LargeMasterSyncV3FiscalMetadata';
import { v3ArticleSemantics, v3RetainedLineFingerprint } from '../../sync/LargeMasterSyncV3StockAuthority';
import { SYNC_MONITOR_PAGE_SQL, syncMonitorPageParams, decodeSyncMonitorPage, type SyncMonitorPageRequest } from '../SyncMonitorPage';
import { Capacitor } from '@capacitor/core';
import type {
    DatabaseAdapter,
    DurableDocumentMutation,
    FinancialCommitInput,
    FinancialNumberReservation,
    FinancialNumberResult,
    MasterNumberRangeRecord,
    NumberedMasterCommitInput,
    NumberedMasterCommitResult,
} from '../DatabaseAdapter';
import { DURABLE_OUTBOX_SCHEMA_SQL } from '../../sync/DurableOutboxSchema';
import { applyMasterNumberToDocument, buildNumberedCustomerMutation } from '../../sync/masterNumberRangeContract';
import { compactStoredTerminalCatalog } from '../../../utils/compactTerminalCatalogSnapshot';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL, ensureLargeMasterSyncV3ContractColumns, backfillLargeMasterSyncV3Categories } from '../LargeMasterSyncV3Schema';
import { LargeMasterSyncV3SqliteStore } from '../LargeMasterSyncV3SqliteStore';
import { V3_FINANCIAL_RETAINED_UPSERT_SQL } from '../LargeMasterSyncV3FinancialRetention';

const DB_NAME = 'clic_pos_native';
const DB_VERSION = 1;
const DOCUMENT_READ_BATCH_SIZE = 15;
const MAX_DOCUMENT_JSON_BYTES = 4 * 1024 * 1024;
const CONFIG_READ_CHUNK_SIZE = 256 * 1024;
const DOCUMENT_SCHEMA_MIGRATION_KEY = 'documents_schema_v2_migrated';
const STRICT_DURABLE_COLLECTIONS = ['kdsDispatchQueue', 'productionPrintQueue'] as const;
const DOCUMENT_UPSERT_SQL = `
    INSERT INTO documents (collection_name, doc_id, data, sort_order, updatedAt)
    VALUES (
        ?,
        ?,
        ?,
        COALESCE(
            (SELECT sort_order FROM documents WHERE collection_name = ? AND doc_id = ?),
            (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM documents WHERE collection_name = ?)
        ),
        ?
    )
    ON CONFLICT(collection_name, doc_id) DO UPDATE SET
        data = ${FINANCIAL_COUNTER_UPSERT_SQL.replace('__FINANCIAL_DOCUMENT__', ARTICLE_FORMAT_RETAINED_UPSERT_SQL.replace('__V3_FINANCIAL_DOCUMENT__',V3_FINANCIAL_RETAINED_UPSERT_SQL))},
        updatedAt = excluded.updatedAt
`;

type SQLiteBridgeModule = typeof import('@capacitor-community/sqlite');
type SQLiteConnectionInstance = InstanceType<SQLiteBridgeModule['SQLiteConnection']>;
type SQLiteDBConnectionInstance = InstanceType<SQLiteBridgeModule['SQLiteDBConnection']>;

export const NATIVE_V3_METHOD_CONCURRENCY = {
    getInventoryAuthority: 'read',
    assertCanReplaceUnusedBaseline: 'read',
    activateUnusedBaseline: 'write',
    prepareCatalogOnly: 'write',
    activateCatalogOnly: 'write',
    getCatalogReceipt: 'read',
    readAdministrativeCatalogPage: 'read',
    readProductionCatalogPage: 'read',
    prepare: 'write',
    readProgress: 'read',
    findIncomplete: 'read',
    applyChunk: 'write',
    markDatasetValidated: 'write',
    validateStaging: 'write',
    activate: 'write',
    rollback: 'write',
    getActiveRuntimeVersion: 'read',
    getPragmaSnapshot: 'read',
    getDatabaseSizeBytes: 'read',
    listArticlesPage: 'read',
    searchOperationalArticles: 'read',
    getOperationalCategories: 'read',
    getOperationalArticle: 'read',
    getOperationalTariffs: 'read',
    getAdministrativeTariff: 'read',
    getOperationalTaxes: 'read',
    getOperationalVariants: 'read',
    getPrices: 'read',
    findBarcode: 'read',
    findOperationalCode: 'read',
    getOperationalOwner: 'read',
    setOperationalOwner: 'write',
    getOperationalStockProjection: 'read',
    getLocalInventoryDelta: 'read',
    assertCanRefresh: 'read',
    getLocalInventoryDeltas: 'read',
    getOperationalSupports: 'read',
    replaceInventorySnapshot: 'write',
    getInventorySnapshotVersion: 'read',
    getInventoryBalance: 'read',
    cleanupExpiredVersions: 'write',
} satisfies Record<keyof LargeMasterSyncV3Store,'read'|'write'>;

export class CapacitorSQLiteAdapter implements DatabaseAdapter {
    readonly supportsV3FiscalMetadataCAS = true;
    private sqliteConnection: SQLiteConnectionInstance | null = null;
    private db: SQLiteDBConnectionInstance | null = null;
    private isReady = false;
    private financialConnectionError:Error|null=null;
    private connectPromise: Promise<void> | null = null;
    private disconnectPromise: Promise<void> | null = null;
    private writeQueue: Promise<unknown> = Promise.resolve();
    public readonly adapterType = 'local';
    public readonly fiscalWorkflowStore=new NativeFiscalWorkflowV2Store(()=>this.ensureDb() as any,work=>this.withWriteLock(work));
    public readonly terminalAuthEvidenceStore=new NativeTerminalAuthEvidenceStore(()=>this.ensureDb() as any,work=>this.withWriteLock(work),work=>this.withNativeTransaction(work));
    public readonly masterSyncV3Store = this.serializedMasterStore();

    private serializedMasterStore():LargeMasterSyncV3SqliteStore {
        const store=new LargeMasterSyncV3SqliteStore(()=>this.ensureDb() as any,operation=>this.withWriteLock(operation),undefined,()=>this.readConfigOwned());

        return new Proxy(store,{get:(target,key)=>{
            const value=Reflect.get(target,key);
            if(typeof value!=='function') return value;
            // Internal calls retain the raw target and explicit connection. Public observers wait for committed state.
            const mode=NATIVE_V3_METHOD_CONCURRENCY[key as keyof typeof NATIVE_V3_METHOD_CONCURRENCY];
            if(!mode) throw new Error('NATIVE_MASTER_STORE_METHOD_UNCLASSIFIED:'+String(key));
            return mode==='write' ? value.bind(target) : (...args:any[])=>this.withWriteLock(()=>value.apply(target,args));
        }});
    }

    connect(): Promise<void> {
        if (this.disconnectPromise) return this.disconnectPromise.then(() => this.connect());
        if (this.isReady) return Promise.resolve();
        if (this.connectPromise) return this.connectPromise;

        // A caller's timeout does not cancel native open/schema work. All callers,
        // including startup retries, must await that same operation.
        this.connectPromise = this.connectOnce().finally(() => {
            this.connectPromise = null;
        });
        return this.connectPromise;
    }

    private loadSQLiteBridge(): Promise<SQLiteBridgeModule> {
        return import('@capacitor-community/sqlite');
    }

    private async connectOnce(): Promise<void> {

        if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
            throw new Error('CapacitorSQLiteAdapter is only available on Android native runtime.');
        }

        // If cleanup failed, retain and close that manager before replacing it.
        if (this.sqliteConnection) await this.closeRegisteredConnection();

        const { CapacitorSQLite, SQLiteConnection } = await this.loadSQLiteBridge();
        this.sqliteConnection = new SQLiteConnection(CapacitorSQLite);

        try {
            const consistency = await this.sqliteConnection.checkConnectionsConsistency();
            const hasConnection = await this.sqliteConnection.isConnection(DB_NAME, false);

            if (consistency.result && hasConnection.result) {
                this.db = await this.sqliteConnection.retrieveConnection(DB_NAME, false);
            } else {
                this.db = await this.sqliteConnection.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
            }

            if (!(await this.db.isDBOpen()).result) await this.db.open();
            await this.initSchema();
            this.isReady = true;
            console.log('[CapacitorSQLiteAdapter] Connected');
        } catch (error) {
            // Release the registered handle after a failed open or migration,
            // before a later retry creates another manager for the same file.
            await this.closeRegisteredConnection().catch(cleanupError => {
                console.warn('[CapacitorSQLiteAdapter] startup cleanup failed:', cleanupError);
            });
            throw error;
        }
    }

    disconnect(): Promise<void> {
        if (this.disconnectPromise) return this.disconnectPromise;
        const connecting = this.connectPromise;
        this.disconnectPromise = (async () => {
            await connecting?.catch(() => undefined);
            await this.closeRegisteredConnection();
        })().finally(() => {
            this.disconnectPromise = null;
        });
        return this.disconnectPromise;
    }

    private async closeRegisteredConnection(): Promise<void> {
        this.isReady = false;
        // End a failed schema transaction on the native thread before closing.
        // Retain the handle on cleanup failure so retry cannot abandon its lock.
        if (this.db && this.sqliteConnection) {
            if ((await this.db.isDBOpen()).result && (await this.db.isTransactionActive()).result) {
                await this.db.rollbackTransaction();
            }
            // closeConnection also closes an open database; never delete/reset it.
            await this.sqliteConnection.closeConnection(DB_NAME, false);
        }

        this.db = null;
        this.financialConnectionError = null;
        this.sqliteConnection = null;
        this.isReady = false;
    }

    async getSyncMonitorPage(request: SyncMonitorPageRequest) {
        const result = await this.withWriteLock(() => this.ensureDb().query(SYNC_MONITOR_PAGE_SQL, syncMonitorPageParams(request)));
        return decodeSyncMonitorPage(result.values?.[0]);
    }

    async getCollection<T>(collectionName: string, _queryParams?: Record<string, string>): Promise<T[] | any> {
        const docs = await this.withWriteLock(() => this.readStoredDocuments(collectionName));
        return this.fromStoredDocuments(collectionName, docs);
    }

    /** Same decoder, compaction and current-document selection as getCollection, under an existing owner. */
    private async readConfigOwned():Promise<import('../../../types').BusinessConfig> {
        const docs=await this.readStoredDocuments('config');
        if(!docs.some(doc=>doc&&typeof doc==='object'&&!Array.isArray(doc)&&doc.id!=='_db_initialized'&&doc.id!=='config_metadata')){
            throw new Error('SYNC_V3_BINDING_CHANGED');
        }
        return this.fromStoredDocuments('config',docs);
    }

    async saveCollection<T>(collectionName: string, data: T[]): Promise<void> {
        const docs = this.toStoredDocuments(collectionName, data);
        await this.replaceStoredDocuments(collectionName, docs);
    }

    async compareAndSwapV3SetupConfig(expected: import('../../../types').BusinessConfig,
        projected: import('../../../types').BusinessConfig, assertIdentity: () => void): Promise<void> {
        // Freeze inputs before waiting on the lane; callers cannot mutate a queued precondition.
        const expectedJson = JSON.stringify(expected);
        const next = JSON.parse(JSON.stringify(projected));
        const original = JSON.parse(expectedJson);
        const withoutProjection = (value: any) => {
            const { taxes: _taxes, tariffs: _tariffs, taxRate: _taxRate, ...rest } = value;
            return JSON.stringify(rest);
        };
        if (withoutProjection(next) !== withoutProjection(original) || next.taxRate !== 0
            || !Array.isArray(next.taxes) || !Array.isArray(next.tariffs)) {
            throw new Error('SYNC_V3_SETUP_PROJECTION_INVALID');
        }
        return this.withWriteLock(() => this.withNativeTransaction(async () => {
            if (JSON.stringify(await this.readConfigOwned()) !== expectedJson) {
                throw new Error('SYNC_V3_BINDING_CHANGED');
            }
            const now = new Date().toISOString();
            const rows = this.toDocumentRows('config', this.toStoredDocuments('config', next));
            const statements = [
                ...this.collectionReplacementStatements('config', rows.map(row => row.docId), now),
                ...rows.map(row => ({ statement: DOCUMENT_UPSERT_SQL,
                    values: ['config', row.docId, row.data, 'config', row.docId, 'config', now] })),
            ];
            // This hook must never call public DB/runtime APIs or return asynchronous work.
            assertIdentity();
            for (const entry of statements) await this.ensureDb().run(entry.statement, entry.values, false);
        }));
    }

    async saveDocument<T extends { id: string }>(collectionName: string, doc: T): Promise<void> {
        await this.upsertStoredDocuments(collectionName, [doc]);
    }

    async getFiscalStatusCandidates(binding: string, afterId: string, limit: number): Promise<string[]> {
        return this.withWriteLock(async()=>{
      const result = await this.ensureDb().query(`SELECT doc_id FROM documents WHERE collection_name='transactions'
        AND doc_id>? AND json_extract(data,'$.v3Binding')=? AND json_extract(data,'$.fiscalProvider')='MSELLER'
        AND COALESCE(json_extract(data,'$.fiscalSyncStatus'),'PENDING') IN ('PENDING','ERROR')
        AND (json_type(data,'$.fiscalSubmissionScope')='object' OR json_type(data,'$.fiscalLookupApproval')='object')
        AND (json_extract(data,'$.fiscalProviderStatus')='V3_ISSUE_REQUESTED' OR json_extract(data,'$.fiscalClassificationAttemptedAt') IS NOT NULL
          OR json_extract(data,'$.fiscalReferenceId') IS NOT NULL OR json_extract(data,'$.fiscalCertifiedNcf') IS NOT NULL) ORDER BY doc_id LIMIT ?`,[afterId,binding,Math.min(10,Math.max(1,limit))]);
      return (result.values || []).map(row=>String(row.doc_id));

        });
    }

    async getFiscalAppliedSourceRows(transactionId:string):Promise<FiscalOutboxAnchor[]>{
      return this.withWriteLock(async()=> (await this.ensureDb().query(FISCAL_OUTBOX_SOURCE_SQL,fiscalOutboxSourceParams(transactionId))).values as FiscalOutboxAnchor[] || []);
    }

    async saveDocumentsAtomically(documents: DurableDocumentMutation[], requireAbsent = false, replaceCollections: string[] = []): Promise<void> {
        if (!documents.length && !replaceCollections.length) return;
        await this.withWriteLock(async () => {
            const db = this.ensureDb();
            const now = new Date().toISOString();
            if (documents.some(row=>row.v3FiscalMetadataOperation==='FISCAL_DISPATCH_CLAIM')) {
              if(requireAbsent||replaceCollections.length)throw Error('SYNC_V3_FISCAL_METADATA_MUTATION_DENIED');
              await validateFiscalDispatchClaimBatch(documents);
              await this.executeUnlocked(documents.map(row=>({statement:row.collectionName==='fiscalDispatchClaims'
                ? 'INSERT INTO documents(collection_name,doc_id,data,sort_order,updatedAt) VALUES(?,?,?,0,?)'
                : 'UPDATE documents SET data=?,updatedAt=? WHERE collection_name=? AND doc_id=? AND data=?',
                values:row.collectionName==='fiscalDispatchClaims'?[row.collectionName,row.document.id,JSON.stringify(row.document),now]
                  :[JSON.stringify(row.document),now,row.collectionName,row.document.id,row.expectedDocument]})),async()=>{
                await this.assertV3FinancialBaseline(documents);
                const claim=documents.find(row=>row.collectionName==='fiscalDispatchClaims')!.document;
                if(claim.schemaVersion===2){
                  const rows=(await db.query(FISCAL_OUTBOX_SOURCE_SQL,fiscalOutboxSourceParams(claim.sourceTransactionId))).values as FiscalOutboxAnchor[] || [];
                  const actual=captureFiscalOutboxAnchors(rows,claim.sourceTransactionId);
                  if(JSON.stringify(actual)!==JSON.stringify(claim.outboxAnchors))throw Error('FISCAL_V3_ORIGINAL_OUTBOX_CHANGED');
                }
                const source=documents.find(row=>row.collectionName==='transactions')!,scope=source.document.fiscalSubmissionScope;
                const config=documents.find(row=>row.collectionName==='config')!.document;
                const terminals=(config.terminals||[]).filter((row:any)=>row.id===scope.terminalId),terminal=terminals[0];
                const binding=terminal?.config?.erpBinding;
                if(terminals.length!==1||binding?.tenantId!==scope.tenantId||binding?.companyId!==scope.companyId||binding?.storeId!==scope.storeId
                  ||terminal.config?.currentDeviceId!==scope.deviceId||String(config.companyInfo?.rnc||'').replace(/\D/g,'')!==scope.issuerRnc
                  ||getProviderEnvironment(getEffectiveFiscalComplianceConfig(config as any,terminal.config),'MSELLER')!==scope.environment)throw Error('SYNC_V3_FISCAL_METADATA_MUTATION_DENIED');
              });
              return;
            }
            if (documents.some(row => row.v3FiscalMetadataOperation)) {
              if (requireAbsent || replaceCollections.length || documents.some(row => !row.v3FiscalMetadataOperation)) {
                throw new Error('SYNC_V3_FISCAL_METADATA_MUTATION_DENIED');
              }
              if (documents.some(row => ['FISCAL_STATUS_RECONCILE','FISCAL_PRINT_EVIDENCE_APPEND'].includes(row.v3FiscalMetadataOperation!))) {
                const transaction = documents.find(row => row.collectionName === 'transactions');
                const history = documents.find(row => row.collectionName === 'transactionHistory');
                if (documents.length !== 2 || !transaction || !history
                  || documents.some(row => row.v3FiscalMetadataOperation !== documents[0].v3FiscalMetadataOperation)
                  || transaction.document.id !== history.document.id
                  || JSON.stringify(transaction.document.fiscalStatusProof) !== JSON.stringify(history.document.fiscalStatusProof)
                  || JSON.stringify(transaction.document.fiscalPrintProof) !== JSON.stringify(history.document.fiscalPrintProof)
                  || history.v3ExpectedRetainedDocument?.collection !== 'transactions'
                  || history.v3ExpectedRetainedDocument.id !== transaction.document.id
                  || history.v3ExpectedRetainedDocument.expected !== transaction.expectedDocument) {
                  throw new Error('SYNC_V3_FISCAL_METADATA_MUTATION_DENIED');
                }
              }
              await db.execute('BEGIN TRANSACTION;', false);
              try {
                await this.assertV3FinancialBaseline(documents);
                for (const mutation of documents) {
                  await validateV3FiscalMetadataMutation(mutation);
                  if (['FISCAL_SUBMISSION_SCOPE_APPEND','FISCAL_LOOKUP_APPROVAL_APPEND','FISCAL_STATUS_RECONCILE','FISCAL_PRINT_EVIDENCE_APPEND'].includes(mutation.v3FiscalMetadataOperation!)) {
                    const canonical = mutation.collectionName === 'transactionHistory' ? JSON.parse(mutation.v3ExpectedRetainedDocument?.expected || '{}') : mutation.document;
                    const scope = canonical.fiscalSubmissionScope || canonical.fiscalLookupApproval;
                    const configRows = await db.query("SELECT data FROM documents WHERE collection_name='config' AND doc_id='current'");
                    const config = JSON.parse(String(configRows.values?.[0]?.data || '{}'));
                    const terminals = (config.terminals || []).filter((terminal: any) => terminal.id === scope?.terminalId);
                    const binding = terminals[0]?.config?.erpBinding;
                    if (terminals.length !== 1 || binding?.tenantId !== scope?.tenantId || binding?.companyId !== scope?.companyId
                      || terminals[0]?.config?.currentDeviceId !== scope?.deviceId || (!scope?.storeId || binding?.storeId !== scope.storeId)
                      || String(config.companyInfo?.rnc || '').replace(/\D/g,'') !== scope?.issuerRnc
                      || getProviderEnvironment(getEffectiveFiscalComplianceConfig(config,terminals[0]?.config),'MSELLER') !== scope?.environment) throw new Error('SYNC_V3_FISCAL_METADATA_MUTATION_DENIED');
                  }
                  if (mutation.v3FiscalMetadataOperation === 'PRESUBMIT_EVIDENCE_REPAIR') {
                    const audit = mutation.document.fiscalPreSubmitRecoveryAudit?.at(-1);
                    const configRows = await db.query("SELECT data FROM documents WHERE collection_name='config' AND doc_id='current'");
                    const config = JSON.parse(String(configRows.values?.[0]?.data || '{}'));
                    const terminals = (config.terminals || []).filter((terminal: any) => terminal.id === audit?.scope?.terminalId);
                    const binding = terminals[0]?.config?.erpBinding;
                    if (terminals.length !== 1 || binding?.tenantId !== audit.scope.tenantId || binding?.companyId !== audit.scope.companyId) {
                      throw new Error('SYNC_V3_FISCAL_METADATA_MUTATION_DENIED');
                    }
                  }
                  await db.run('UPDATE documents SET data=?,updatedAt=? WHERE collection_name=? AND doc_id=? AND data=?',
                    [JSON.stringify(mutation.document),now,mutation.collectionName,mutation.document.id,mutation.expectedDocument],false);
                  const updated = await db.query('SELECT changes() AS changed');
                  if (Number(updated.values?.[0]?.changed) !== 1) throw new Error('SYNC_V3_CONCURRENT_FINANCIAL_UPDATE');
                }
                await db.execute('COMMIT;', false);
              } catch(error) {
                await db.execute('ROLLBACK;',false).catch(()=>undefined);
                throw error;
              }
              return;
            }
            const needsFinancialPrecondition = documents.some(row => row.recoveryOriginal || row.document.v3InventoryBaseline
              || row.requireAbsent || row.expectedDocument !== undefined || row.v3StockRequirements);
            const assertAbsent = async () => {
              for (const { collectionName, document } of documents) {
                const rows = await db.query('SELECT doc_id FROM documents WHERE collection_name = ? AND doc_id = ?', [collectionName, document.id]);
                if (rows.values?.length) throw new Error('RECOVERY_LOCAL_CONFLICT:' + collectionName + ':' + document.id);
              }
            };
            // Preserve the established legacy executeSet path; V3/CAS checks must run after BEGIN.
            if (requireAbsent && !needsFinancialPrecondition) await assertAbsent();
            const precondition = async () => {
              await assertRetirementRecoveryPromotion(db,documents);
              await this.assertV3FinancialBaseline(documents);
              if (requireAbsent) await assertAbsent();
            };
            await this.executeUnlocked([...replaceCollections.flatMap(name => this.collectionReplacementStatements(name,documents.filter(d=>d.collectionName===name).map(d=>d.document.id),now)), ...documents.map(({ collectionName, document }) => ({
                statement: DOCUMENT_UPSERT_SQL,
                values: [collectionName, document.id, JSON.stringify(document), collectionName, document.id, collectionName, now],
            }))], needsFinancialPrecondition ? precondition : undefined);
        });
    }

    async bulkUpsert<T extends { id: string }>(collectionName: string, docs: T[]): Promise<void> {
        if (!docs || docs.length === 0) return;
        await this.upsertStoredDocuments(collectionName, docs);
    }

    async bulkUpdateProducts(productIds: string[], updates: any, _userId?: string, _userName?: string): Promise<void> {
        const products = await this.getCollection<any>('products') || [];
        if (!Array.isArray(products)) return;

        const idSet = new Set(productIds || []);
        const now = new Date().toISOString();
        const updatedProducts = products.reduce((acc: any[], product: any) => {
            if (!idSet.has(product.id)) return acc;

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
            if (updates?.pricing?.tariffActions) {
                const tariffCatalog = new Map(
                    (updates.pricing.tariffs || []).map((tariff: any) => [tariff.id, tariff])
                );
                next.tariffs = [...(next.tariffs || [])];

                Object.entries(updates.pricing.tariffActions).forEach(([tariffId, action]) => {
                    const existingIndex = next.tariffs.findIndex((tariff: any) => tariff.tariffId === tariffId);
                    if (action === 'ASSIGN') {
                        if (existingIndex === -1) {
                            const tariffMeta = tariffCatalog.get(tariffId) as { id: string; name?: string } | undefined;
                            next.tariffs.push({
                                tariffId,
                                name: tariffMeta?.name,
                                price: Number(next.price || 0),
                                costBase: Number(next.cost || 0),
                                margin: next.cost > 0
                                    ? ((Number(next.price || 0) - Number(next.cost || 0)) / Number(next.cost || 0)) * 100
                                    : 30
                            });
                        }
                    } else if (action === 'REMOVE' && existingIndex !== -1) {
                        next.tariffs.splice(existingIndex, 1);
                    }
                });
            }
            if (updates?.warehouseActions) {
                const activeInWarehouses = new Set(next.activeInWarehouses || []);
                Object.entries(updates.warehouseActions).forEach(([whId, action]) => {
                    if (action === 'ENABLE') {
                        activeInWarehouses.add(whId);
                    } else if (action === 'DISABLE') {
                        activeInWarehouses.delete(whId);
                    }
                });
                next.activeInWarehouses = Array.from(activeInWarehouses);
            }
            next.updatedAt = now;
            acc.push(next);
            return acc;
        }, []);

        await this.bulkUpsert('products', updatedProducts);
    }

    getDocument<T>(collectionName:string,id:string):Promise<T|null> {
        return this.withWriteLock(()=>this.getDocumentUnlocked<T>(collectionName,id));
    }

    private async getDocumentUnlocked<T>(collectionName: string, id: string): Promise<T | null> {
        const db = this.ensureDb();
        const result = await db.query(
            'SELECT data FROM documents WHERE collection_name = ? AND doc_id = ? LIMIT 1',
            [collectionName, id]
        );
        const row = Array.isArray(result?.values) ? result.values[0] : null;
        const rawValue = row && typeof row === 'object' ? (row as Record<string, unknown>).data : null;
        if (typeof rawValue !== 'string' || !rawValue.trim()) return null;

        try {
            return JSON.parse(rawValue) as T;
        } catch (error) {
            console.warn(`[CapacitorSQLiteAdapter] Failed to parse ${collectionName}/${id}:`, error);
            return null;
        }
    }

    async deleteDocument(collectionName: string, id: string): Promise<void> {
        const db = this.ensureDb();
        if(collectionName==='globalSequenceCounter') throw new Error('NATIVE_FINANCIAL_COUNTER_DELETE_FORBIDDEN');
        await this.withWriteLock(async()=>{
            if(collectionName==='internalSequences') {
                await db.run("UPDATE documents SET data=json_set(data,'$.active',json('false')),updatedAt=? WHERE collection_name=? AND doc_id=?",[new Date().toISOString(),collectionName,id]);
                return;
            }
            await db.run('DELETE FROM documents WHERE collection_name = ? AND doc_id = ?', [collectionName, id]);
        });
    }

    async executeSQL(query: string, params: any[] = []): Promise<any> {
        const db = this.ensureDb();
        const normalized = query.trim();
        const isReadQuery = /^(SELECT|PRAGMA|WITH)\b/i.test(normalized);

        if (isReadQuery) {
            const result = await this.withWriteLock(() => db.query(normalized, params));
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

        return this.withWriteLock(() => db.run(normalized, params));
    }

    async readTrackingCheckout(cartIdentity:string,scope:TrackingScope){return this.withWriteLock(()=>readTrackingOperation(this.ensureDb() as any,cartIdentity,scope));}
    async readCommittedTrackingReceipt(operation:TrackingOperation){return this.withWriteLock(()=>readCommittedTrackingReceipt(this.ensureDb() as any,operation));}
    async readTrackingAuthority(allocationId:string):Promise<{authorityJson:string;witnessHash:string;availableMinor:number}|null>{
        const row=(await this.ensureDb().query("SELECT a.authority_json,a.delivery_witness_hash,a.state,json_extract(a.authority_json,'$.quantityMinor')-a.consumed_minor-coalesce((SELECT sum(c.quantity_minor) FROM pos_tracking_checkout_v1 c WHERE c.allocation_id=a.id AND c.phase IN('PREPARED','EFFECT_POSSIBLE')),0) available_minor FROM pos_tracking_allocations_v1 a WHERE a.id=?",[allocationId])).values?.[0];return row?{authorityJson:String(row.authority_json),witnessHash:String(row.delivery_witness_hash),availableMinor:row.state==='ACTIVE'?Number(row.available_minor):0}:null;
    }
    async installTrackingAuthority(authority:TrackingAuthority,previouslySeen:boolean,serverConsumedMinor=0,deliveryWitnessHash?:string,deliveryClock?:import('../TrackingAllocationStore').TrackingDeliveryClock):Promise<void>{
        await this.withWriteLock(()=>this.executeUnlocked([],()=>installTrackingAllocation(this.ensureDb() as any,authority,previouslySeen,serverConsumedMinor,deliveryWitnessHash,deliveryClock),true));
    }
    async prepareTrackingCheckout(checkoutId:string,selections:TrackingSelection[],scope:Pick<TrackingAuthority,'tenantId'|'companyId'|'storeId'|'warehouseId'|'terminalId'|'deviceId'>,operation:{transactionId:string;cartIdentity:string}):Promise<void>{
        await this.withWriteLock(()=>this.executeUnlocked([],async()=>{await prepareTrackingOperation(this.ensureDb() as any,checkoutId,operation.transactionId,operation.cartIdentity,scope);await prepareTrackingCheckout(this.ensureDb() as any,checkoutId,selections,scope);},true));
    }
    async fenceTrackingCheckout(checkoutId:string,paymentId:string):Promise<number>{
        let effectAt=0;await this.withWriteLock(()=>this.executeUnlocked([],async()=>{effectAt=await fenceTrackingCheckout(this.ensureDb() as any,checkoutId);await recordTrackingPaymentEffect(this.ensureDb() as any,checkoutId,paymentId);},true));return effectAt;
    }
    async abandonTrackingCheckout(checkoutId:string):Promise<void>{
        await this.withWriteLock(()=>this.executeUnlocked([],async()=>{await abandonTrackingCheckout(this.ensureDb() as any,checkoutId);await retireTrackingOperation(this.ensureDb() as any,checkoutId);},true));
    }

    async commitFinancialTransaction(input: FinancialCommitInput): Promise<void> {
        const now = new Date().toISOString();
        const statements: Array<{ statement: string; values: any[] }> = [];

        for (const mutation of input.documents) {
            const document = mutation.document;
            if (!document?.id || !mutation.collectionName) {
                throw new Error('Financial commit contains a document without collection or id.');
            }
            statements.push({
                statement: DOCUMENT_UPSERT_SQL,
                values: [
                    mutation.collectionName,
                    String(document.id),
                    JSON.stringify(document),
                    mutation.collectionName,
                    String(document.id),
                    mutation.collectionName,
                    now,
                ],
            });
        }

        const outboxEvents = [input.outboxEvent, ...(input.additionalOutboxEvents || [])];
        for (const event of outboxEvents) {
            statements.push({
                statement: `INSERT INTO sync_outbox_v2 (
                    event_id, event_type, aggregate_type, aggregate_id, schema_version,
                    payload_json, status, attempt_count, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
                ON CONFLICT(event_id) DO NOTHING`,
                values: [
                    event.eventId,
                    event.eventType,
                    event.aggregateType,
                    event.aggregateId,
                    event.schemaVersion,
                    JSON.stringify(event.payload),
                    event.createdAt,
                    now,
                ],
            });
        }

        const event = input.outboxEvent;
        for (const intentId of input.paymentIntentIds || []) {
            statements.push({
                statement: `UPDATE payment_intents_v2
                    SET status = 'COMMITTED', transaction_id = ?, committed_at = ?, updated_at = ?, last_error = NULL
                    WHERE intent_id = ? AND status = 'AUTHORIZED'`,
                values: [event.aggregateId, now, now, intentId],
            });
        }

        const needsFinancialPrecondition = input.documents.some(row => row.document.v3InventoryBaseline
          || row.requireAbsent || row.expectedDocument !== undefined || row.v3StockRequirements);
        await this.withWriteLock(() => this.executeUnlocked(statements,async()=>{
          const trackedSources=input.documents.filter(d=>d.collectionName==='transactions'&&d.document.items?.some((line:any)=>line.v3SaleAuthority&&line.trackingData?.length));
          const trackingCommits=input.trackingCommits||[];
          if(trackedSources.length!==trackingCommits.length||new Set(trackingCommits.map(c=>c.transactionId)).size!==trackingCommits.length||new Set(trackingCommits.map(c=>c.checkoutId)).size!==trackingCommits.length||trackedSources.some(d=>trackingCommits.filter(c=>c.transactionId===d.document.id).length!==1))throw Error('TRACKING_ATOMIC_SOURCE_REQUIRED');
          for(const tracking of input.trackingCommits||[]){
            const source=input.documents.find(d=>d.collectionName==='transactions'&&d.document.id===tracking.transactionId);
            const event=outboxEvents.find(e=>e.eventType==='SALE_POSTED'&&e.aggregateId===tracking.transactionId);
            const history=input.documents.find(d=>d.collectionName==='transactionHistory'&&d.document.id===tracking.transactionId);
            const selections=source?.document.items?.flatMap((line:any)=>line.trackingData||[])||[];
            if(!source||!event||!history||JSON.stringify(history.document.items?.flatMap((line:any)=>line.trackingData||[])||[])!==JSON.stringify(tracking.selections)||JSON.stringify(selections)!==JSON.stringify(tracking.selections)||JSON.stringify(event.payload.transaction?.items?.flatMap((line:any)=>line.trackingData||[])||[])!==JSON.stringify(tracking.selections))throw Error('TRACKING_ATOMIC_SOURCE_REQUIRED');
            const effectRows=(await this.ensureDb().query('SELECT effect_at_ms FROM pos_tracking_checkout_v1 WHERE checkout_id=?',[tracking.checkoutId])).values||[];
            if(!Number.isFinite(Date.parse(source.document.trackingEffectAt))||effectRows.some((row:any)=>row.effect_at_ms!==Date.parse(source.document.trackingEffectAt)))throw Error('TRACKING_EFFECT_TIME_REQUIRED');
            await assertTrackingOperationCommit(this.ensureDb() as any,tracking.checkoutId,source.document as Transaction);
            await consumeTrackingCheckout(this.ensureDb() as any,tracking.checkoutId,tracking.transactionId,tracking.selections);
          }
          if(input.documents.some(d=>d.collectionName==='transactions'&&d.document.items?.some((line:any)=>line.v3SaleAuthority&&line.trackingData?.length))&&!input.trackingCommits?.length)throw Error('TRACKING_ATOMIC_SOURCE_REQUIRED');
          if(needsFinancialPrecondition)await this.assertV3FinancialBaseline(input.documents);
          for(const proof of input.fiscalAllocationPreconditions||[]){
            if(!['config','fiscalAllocations','fiscalRanges','localFiscalBuffer'].includes(proof.collection))throw Error('OFFLINE_FISCAL_COMMIT_PROOF_INVALID');
            const actual=(await this.ensureDb().query('SELECT data FROM documents WHERE collection_name=? AND doc_id=?',[proof.collection,proof.id])).values?.[0]?.data||null;
            if(actual!==proof.expected)throw Error('OFFLINE_FISCAL_COMMIT_AUTHORITY_CHANGED');
          }
          if(input.fiscalWorkflowCommits?.some(c=>c.birth?.schemaVersion===3)&&!input.fiscalAllocationPreconditions?.length)throw Error('OFFLINE_FISCAL_COMMIT_PROOF_REQUIRED');
          const births=outboxEvents.filter(e=>e.eventType==='SALE_POSTED'&&e.payload.fiscalWorkflowBirth);
          if(births.some(e=>!input.fiscalWorkflowCommits?.some(c=>c.transactionId===e.aggregateId&&JSON.stringify(c.birth)===JSON.stringify(e.payload.fiscalWorkflowBirth))))throw Error('FISCAL_WORKFLOW_ATOMIC_BIRTH_REQUIRED');
          for(const commit of input.fiscalWorkflowCommits||[]){
            const source=input.documents.find(d=>d.collectionName==='transactions'&&d.document.id===commit.transactionId);
            const history=input.documents.find(d=>d.collectionName==='transactionHistory'&&d.document.id===commit.transactionId);
            if(!source?.requireAbsent||!history?.requireAbsent)throw Error('FISCAL_WORKFLOW_NEW_SOURCE_REQUIRED');
            if((source.document as any).fiscalSaleContext){
              const context=(source.document as any).fiscalSaleContext;
              const settlement=input.documents.find(d=>d.collectionName==='v3TicketSettlements'&&d.document.id===context.accountId);
              if(!settlement?.requireAbsent||settlement.document.transactionId!==commit.transactionId||!settlement.v3ExpectedRetainedDocument)throw Error('OFFLINE_FISCAL_TABLE_ATOMIC_SETTLEMENT_REQUIRED');
              const retained=settlement.v3ExpectedRetainedDocument;
              await assertTableFiscalSaleContext(source.document as any,{collection:retained.collection,id:retained.id,expected:retained.expected});
            }
            if(commit.birth?.schemaVersion===3){
              if(input.fiscalWorkflowCommits?.length!==1||new Set(input.documents.map(d=>JSON.stringify([d.collectionName,d.document.id]))).size!==input.documents.length||JSON.stringify(source.document)!==JSON.stringify(history.document))throw Error('OFFLINE_FISCAL_ATOMIC_SOURCE_REQUIRED');
              const tx=source.document as unknown as import('../../../types').Transaction;
              if(tx.documentType!=='REFUND'){
                const seriesRaw=(await this.ensureDb().query("SELECT data FROM documents WHERE collection_name='internalSequences' AND doc_id=?",[tx.seriesId])).values?.[0]?.data;
                const counterRaw=(await this.ensureDb().query("SELECT data FROM documents WHERE collection_name='globalSequenceCounter' AND doc_id='value'")).values?.[0]?.data;
                const numbers=planFinancialNumbers({seriesId:tx.seriesId,documentType:'TICKET',global:true},seriesRaw?JSON.parse(seriesRaw):undefined,counterRaw?JSON.parse(counterRaw):undefined);
                const seriesMutation=input.documents.filter(d=>d.collectionName==='internalSequences'),counterMutation=input.documents.filter(d=>d.collectionName==='globalSequenceCounter');
                if(!tx.seriesId||seriesMutation.length!==1||counterMutation.length!==1||JSON.stringify([tx.displayId,tx.seriesNumber,tx.globalSequence])!==JSON.stringify([numbers.result.displayId,numbers.result.seriesNumber,numbers.result.globalSequence])||JSON.stringify(seriesMutation[0].document)!==JSON.stringify(numbers.series)||seriesMutation[0].expectedDocument!==seriesRaw||JSON.stringify(counterMutation[0].document)!==JSON.stringify(numbers.counter)||(counterRaw?counterMutation[0].expectedDocument!==counterRaw:counterMutation[0].requireAbsent!==true))throw Error('OFFLINE_FISCAL_NUMBER_PLAN_CHANGED');
              }
            }
            await consumeFiscalWorkflowBirth(this.ensureDb() as any,commit,source.document as any,outboxEvents.find(e=>['SALE_POSTED','SALES_CREDIT_NOTE_POSTED'].includes(e.eventType)&&e.aggregateId===commit.transactionId)?.eventId);
          }
        },Boolean(input.fiscalAllocationPreconditions?.length||input.trackingCommits?.length)));
    }

    async getMasterNumberRanges(): Promise<MasterNumberRangeRecord[]> {
        return this.withWriteLock(async()=>{
        const result = await this.ensureDb().query(`SELECT
            range_id, entity_type, prefix, start_number, end_number, next_number,
            last_issued_number, padding, status, updated_at, last_reported_number,
            progress_pending, blocked_reason, terminal_id
            FROM master_number_ranges ORDER BY entity_type, start_number, range_id`);
        return (Array.isArray(result?.values) ? result.values : []).map((row: any) => ({
            id: String(row.range_id),
            entityType: row.entity_type,
            prefix: String(row.prefix),
            startNumber: Number(row.start_number),
            endNumber: Number(row.end_number),
            nextNumber: Number(row.next_number),
            lastIssuedNumber: row.last_issued_number == null ? null : Number(row.last_issued_number),
            padding: Number(row.padding),
            status: String(row.status),
            updatedAt: String(row.updated_at),
            lastReportedNumber: row.last_reported_number == null ? null : Number(row.last_reported_number),
            progressPending: Number(row.progress_pending) === 1,
            blockedReason: row.blocked_reason == null ? null : String(row.blocked_reason),
            terminalId: row.terminal_id == null ? null : String(row.terminal_id),
        }));

        });
    }

    async upsertMasterNumberRanges(ranges: MasterNumberRangeRecord[]): Promise<void> {
        if (!ranges.length) return;
        await this.executeSetOrRun(ranges.map(range => ({
            statement: `INSERT INTO master_number_ranges (
                range_id, entity_type, prefix, start_number, end_number, next_number,
                last_issued_number, padding, status, updated_at, last_reported_number,
                progress_pending, blocked_reason, terminal_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(range_id) DO UPDATE SET
                entity_type = excluded.entity_type,
                prefix = excluded.prefix,
                start_number = excluded.start_number,
                end_number = excluded.end_number,
                next_number = MAX(master_number_ranges.next_number, excluded.next_number),
                last_issued_number = MAX(
                    COALESCE(master_number_ranges.last_issued_number, excluded.start_number - 1),
                    COALESCE(excluded.last_issued_number, excluded.start_number - 1)
                ),
                padding = excluded.padding,
                terminal_id = excluded.terminal_id,
                status = CASE
                    WHEN master_number_ranges.status = 'REVOKED' THEN 'REVOKED'
                    WHEN master_number_ranges.status = 'BLOCKED'
                         AND datetime(excluded.updated_at) <= datetime(master_number_ranges.updated_at)
                    THEN 'BLOCKED'
                    WHEN MAX(master_number_ranges.next_number, excluded.next_number) > excluded.end_number
                         AND excluded.status = 'ACTIVE'
                    THEN 'EXHAUSTED'
                    ELSE excluded.status
                END,
                updated_at = CASE WHEN datetime(excluded.updated_at) > datetime(master_number_ranges.updated_at)
                    THEN excluded.updated_at ELSE master_number_ranges.updated_at END,
                last_reported_number = MAX(
                    COALESCE(master_number_ranges.last_reported_number, excluded.start_number - 1),
                    COALESCE(excluded.last_reported_number, excluded.start_number - 1)
                ),
                progress_pending = CASE
                    WHEN master_number_ranges.progress_pending = 1 THEN 1
                    ELSE excluded.progress_pending
                END,
                blocked_reason = CASE
                    WHEN master_number_ranges.status = 'BLOCKED'
                         AND datetime(excluded.updated_at) <= datetime(master_number_ranges.updated_at)
                    THEN master_number_ranges.blocked_reason
                    ELSE excluded.blocked_reason
                END`,
            values: [
                range.id, range.entityType, range.prefix, range.startNumber, range.endNumber,
                range.nextNumber, range.lastIssuedNumber, range.padding, range.status, range.updatedAt,
                range.lastReportedNumber, range.progressPending ? 1 : 0, range.blockedReason ?? null,
                range.terminalId ?? null,
            ],
        })));
    }

    async commitNumberedMasterCreation(input: NumberedMasterCommitInput): Promise<NumberedMasterCommitResult> {
        return this.withWriteLock(async () => {
        const db = this.ensureDb();
        await db.execute('BEGIN IMMEDIATE TRANSACTION;', false);
        try {
            const existing = await this.getDocumentUnlocked<any>(input.collectionName, input.document.id);
            if (existing) {
                await db.execute('COMMIT;', false);
                return {
                    document: existing,
                    range: null,
                    issuedNumber: Number.isSafeInteger(existing.master_number_value) ? existing.master_number_value : null,
                    code: String(existing.external_code || existing.customer_code || existing.supplier_code || existing.sku || ''),
                };
            }
            await db.run(`UPDATE master_number_ranges
                SET status = 'EXHAUSTED'
                WHERE entity_type = ? AND status = 'ACTIVE' AND next_number > end_number`, [input.entityType], false);
            const selection = await db.query(`SELECT * FROM master_number_ranges
                WHERE entity_type = ? AND terminal_id = ? AND status = 'ACTIVE' AND next_number <= end_number
                ORDER BY start_number, range_id LIMIT 1`, [input.entityType, input.sourceTerminalId]);
            const row = Array.isArray(selection?.values) ? selection.values[0] : null;
            if (!row) throw new Error('La terminal agotó el rango asignado. Conéctala y solicita un nuevo rango.');
            const range: MasterNumberRangeRecord = {
                id: String(row.range_id), entityType: row.entity_type, prefix: String(row.prefix),
                startNumber: Number(row.start_number), endNumber: Number(row.end_number),
                nextNumber: Number(row.next_number),
                lastIssuedNumber: row.last_issued_number == null ? null : Number(row.last_issued_number),
                padding: Number(row.padding), status: String(row.status), updatedAt: String(row.updated_at),
                lastReportedNumber: row.last_reported_number == null ? null : Number(row.last_reported_number),
                progressPending: Number(row.progress_pending) === 1,
                blockedReason: row.blocked_reason == null ? null : String(row.blocked_reason),
                terminalId: row.terminal_id == null ? null : String(row.terminal_id),
            };
            const issuedNumber = range.nextNumber;
            const document = applyMasterNumberToDocument(
                input.entityType, input.document, range, issuedNumber, input.sourceTerminalId,
            );
            const nextNumber = issuedNumber + 1;
            await db.run(`UPDATE master_number_ranges SET
                next_number = ?, last_issued_number = ?, progress_pending = 1,
                status = CASE WHEN ? > end_number THEN 'EXHAUSTED' ELSE status END
                WHERE range_id = ?`, [nextNumber, issuedNumber, nextNumber, range.id], false);
            const now = new Date().toISOString();
            await db.run(DOCUMENT_UPSERT_SQL.trim(), [
                input.collectionName, input.document.id, JSON.stringify(document),
                input.collectionName, input.document.id, input.collectionName, now,
            ], false);
            if (input.entityType === 'CUSTOMER') {
                const mutation = buildNumberedCustomerMutation(document, input.localTerminalId || input.sourceTerminalId, now);
                await db.run(DOCUMENT_UPSERT_SQL.trim(), [
                    'customerMutations', mutation.id, JSON.stringify(mutation),
                    'customerMutations', mutation.id, 'customerMutations', now,
                ], false);
            }
            await db.execute('COMMIT;', false);
            return {
                document,
                range: { ...range, nextNumber, lastIssuedNumber: issuedNumber,
                    status: nextNumber > range.endNumber ? 'EXHAUSTED' : range.status, progressPending: true },
                issuedNumber,
                code: String(document.external_code),
            };
        } catch (error) {
            await db.execute('ROLLBACK;', false).catch(() => undefined);
            throw error;
        }
        });
    }

    async markMasterNumberRangeProgressReported(rangeId: string, lastIssuedNumber: number): Promise<void> {
        await this.withWriteLock(() => this.ensureDb().run(`UPDATE master_number_ranges SET
            last_reported_number = MAX(COALESCE(last_reported_number, start_number - 1), ?),
            progress_pending = CASE WHEN COALESCE(last_issued_number, start_number - 1)
                > MAX(COALESCE(last_reported_number, start_number - 1), ?) THEN 1 ELSE 0 END
            WHERE range_id = ?`, [lastIssuedNumber, lastIssuedNumber, rangeId]));
    }

    async blockMasterNumberRange(rangeId: string, reason: string): Promise<void> {
        await this.withWriteLock(() => this.ensureDb().run(
            `UPDATE master_number_ranges SET status = 'BLOCKED', blocked_reason = ? WHERE range_id = ?`,
            [reason, rangeId],
        ));
    }

    async getStats(): Promise<{ type: string; size: number; tables: number }> {
        return this.withWriteLock(async()=>{
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

        });
    }

    private ensureDb(): SQLiteDBConnectionInstance {
        if(this.financialConnectionError) throw this.financialConnectionError;
        if (!this.db) {
            throw new Error('Capacitor SQLite database not initialized');
        }
        return this.db;
    }

    /** Existing operational port retains the new-posting guard until the independent native proof gate. */
    articleFormatSQL(): FormatSQL { return this.createArticleFormatSQL(false); }

    /** Internal typed V3 bridge. Presence is storage support, never integral or network admission readiness. */
    articleFormatFinancialSQL(): FormatSQL { return this.createArticleFormatSQL(true); }

    /** Commercial policy cache on the existing shared SQL lock; no financial-format admission. */
    inventoryPresentationsSQL():import('../../inventoryPresentations/store').PresentationSQL {
        const port=this.createArticleFormatSQL(false);
        return {executeSchema:port.executeSchema,query:port.query,executeAtomic:port.executeAtomic,runExclusive:work=>port.runExclusive!(work),
            runTransaction:work=>this.withWriteLock(()=>this.withNativeTransaction(()=>work({
                executeSchema:async()=>{throw Error('INVENTORY_PRESENTATION_SCHEMA_INSIDE_TRANSACTION');},
                query:async<T>(sql:string,values:(string|number|null)[])=>(await this.ensureDb().query(sql,values)).values as T[] || [],
                executeAtomic:statements=>this.executeArticleFormatOwned(statements),
            }))),
        };
    }

    private createArticleFormatSQL(financial: boolean): FormatSQL {
        const direct: FormatSQL = {
            storageLayout: 'DOCUMENTS',
            financialPostingReadiness: financial ? 'NATIVE_V3_TRANSACTION' : 'NATIVE_UNPROVEN',
            executeSchema: async sql => {
                await this.ensureDb().execute('PRAGMA foreign_keys = ON;', false);
                await this.ensureDb().execute(sql);
            },
            executeAtomic: statements => this.executeUnlocked(statements.map(s => ({statement:s.statement,values:s.values || []}))),
            query: async <T>(sql:string,values:(string|number|null)[]) => (await this.ensureDb().query(sql,values)).values as T[] || [],
        };
        const port: FormatSQL = {
            ...direct,
            executeSchema: sql => this.withWriteLock(() => direct.executeSchema(sql)),
            executeAtomic: statements => this.withWriteLock(() => direct.executeAtomic(statements)),
            query: (sql,values) => this.withWriteLock(() => direct.query(sql,values)),
            runExclusive: work => this.withWriteLock(() => work(direct)),
        };
        port.runFinancial = work => this.withWriteLock(() => this.withNativeTransaction(async () => {
            const scoped:FormatSQL={...direct,
                executeSchema:async()=>{throw Error('POS_FORMAT_SCHEMA_INSIDE_FINANCIAL_TRANSACTION');},
                executeAtomic:statements=>this.executeArticleFormatOwned(statements),
                assertFinancialDocuments:documents=>this.assertV3FinancialBaseline(documents),
            };
            return work(scoped);
        }));
        return port;
    }

    /** Only the two authorized pool-index statements need native execute DDL on this owned transaction. */
    private async executeArticleFormatOwned(statements:FormatStatement[]):Promise<void> {
        const db=this.ensureDb();
        for(const entry of statements){
            if(isInventoryPoolDDL(entry))await db.execute(entry.statement,false);
            else await db.run(entry.statement,entry.values || [],false);
        }
    }

    /** Android's tracked beginTransaction uses SQLiteDatabase.beginTransaction (EXCLUSIVE), before any read. */
    private async withNativeTransaction<T>(work:()=>Promise<T>):Promise<T> {
        const db=this.ensureDb();
        let commitAttempted=false;
        try {
            await db.beginTransaction();
            const result=await work();
            commitAttempted=true;
            await db.commitTransaction();
            return result;
        } catch(error) {
            // A native response can be lost after BEGIN or COMMIT. Inspect the tracked transaction, never compensate.
            let active:boolean;
            try {
                active=Boolean((await db.isTransactionActive()).result);
                if(active) await db.rollbackTransaction();
            } catch(rollbackError) {
                this.financialConnectionError=new Error('NATIVE_FINANCIAL_CONNECTION_UNCERTAIN',{cause:{error,rollbackError}});
                throw this.financialConnectionError;
            }
            if(commitAttempted&&!active) throw new Error('NATIVE_FINANCIAL_COMMIT_UNCERTAIN',{cause:error});
            throw error;
        }
    }

    async reserveFinancialNumbers(input:FinancialNumberReservation):Promise<FinancialNumberResult> {
        // Reservation fields are primitives; fiscal contains only primitive/serialized snapshot fields.
        input={...input,...(input.fiscal?{fiscal:{...input.fiscal}}:{})};
        return this.withWriteLock(()=>this.withNativeTransaction(async()=>{
            const db=this.ensureDb();
            const read=async(collection:string,id:string)=>{
                const rows=await db.query('SELECT data FROM documents WHERE collection_name=? AND doc_id=?',[collection,id]);
                return rows.values?.[0]?.data ? JSON.parse(String(rows.values[0].data)) : undefined;
            };
            let fiscalBuffer:any;
            let fiscalReceipt:Awaited<ReturnType<typeof planNativeFiscalReceipt>>;
            if(input.fiscal){
                const f=input.fiscal;
                const expected=[['config',f.expectedConfig],['localFiscalBuffer',f.expectedBuffer],['fiscalAllocations',f.expectedAllocation],['fiscalRanges',f.expectedRange]];
                const actual:any[]=[];
                for(const [collection,raw] of expected){
                    const document=JSON.parse(raw);
                    const rows=await db.query('SELECT data FROM documents WHERE collection_name=? AND doc_id=?',[collection,document.id]);
                    if(rows.values?.[0]?.data!==raw) throw new Error('NATIVE_FISCAL_AUTHORITY_CONFLICT');
                    actual.push(document);
                }
                fiscalBuffer=validateFiscalBufferReservation({business:actual[0],buffer:actual[1],allocation:actual[2],range:actual[3],terminalId:f.terminalId,type:f.type,ncf:f.ncf});
                fiscalReceipt=await planNativeFiscalReceipt(async<T>(sql:string,values:(string|number|null)[])=>(await db.query(sql,values)).values as T[] || [],actual[0],actual[1],f.ncf,{requireIssuer:f.type.startsWith('E')});
            }
            const plan=planFinancialNumbers(input,input.seriesId ? await read('internalSequences',input.seriesId) : undefined,
                input.global ? await read('globalSequenceCounter','value') : undefined);
            const now=new Date().toISOString();
            if(fiscalReceipt){
                await db.run('INSERT INTO article_format_wire_write_scope VALUES(1)',[],false);
                await db.run(fiscalReceipt.statement.statement,fiscalReceipt.statement.values || [],false);
            }
            for(const [collection,document] of [['internalSequences',plan.series],['globalSequenceCounter',plan.counter],['localFiscalBuffer',fiscalBuffer]] as const){
                if(document) await db.run(DOCUMENT_UPSERT_SQL,[collection,document.id,JSON.stringify(document),collection,document.id,collection,now],false);
            }
            if(fiscalReceipt)await db.run('DELETE FROM article_format_wire_write_scope WHERE id=1',[],false);
            return {...plan.result,...(input.fiscal ? {ncf:input.fiscal.ncf} : {})};
        }));
    }

    private async initSchema(): Promise<void> {
        const db = this.ensureDb();
        await db.execute('PRAGMA foreign_keys = ON;', false);
        await db.execute(`
            ${FISCAL_WORKFLOW_V2_SCHEMA}
            CREATE TABLE IF NOT EXISTS documents (
                collection_name TEXT NOT NULL,
                doc_id TEXT NOT NULL,
                data TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                updatedAt TEXT NOT NULL,
                PRIMARY KEY (collection_name, doc_id)
            );
            CREATE INDEX IF NOT EXISTS idx_documents_collection_sort
            ON documents(collection_name, sort_order, updatedAt);
            CREATE INDEX IF NOT EXISTS idx_documents_v3_inventory_baseline
            ON documents(json_extract(data, '$.v3InventoryBaseline'), json_extract(data, '$.productId'), json_extract(data, '$.warehouseId'))
            WHERE collection_name = 'inventoryLedger' AND json_extract(data, '$.v3InventoryBaseline') IS NOT NULL;
            CREATE TRIGGER IF NOT EXISTS preserve_fiscal_dispatch_insert BEFORE INSERT ON documents
            WHEN NEW.collection_name='fiscalDispatchClaims' AND EXISTS(SELECT 1 FROM documents WHERE collection_name='fiscalDispatchClaims' AND doc_id=NEW.doc_id)
            BEGIN SELECT RAISE(ABORT, 'FISCAL_DISPATCH_UNKNOWN_GET_ONLY'); END;
            CREATE TRIGGER IF NOT EXISTS preserve_fiscal_dispatch_update BEFORE UPDATE ON documents
            WHEN OLD.collection_name='fiscalDispatchClaims'
            BEGIN SELECT RAISE(ABORT, 'FISCAL_DISPATCH_UNKNOWN_GET_ONLY'); END;
            CREATE TRIGGER IF NOT EXISTS preserve_fiscal_dispatch_delete BEFORE DELETE ON documents
            WHEN OLD.collection_name='fiscalDispatchClaims'
            BEGIN SELECT RAISE(ABORT, 'FISCAL_DISPATCH_UNKNOWN_GET_ONLY'); END;
            CREATE TRIGGER IF NOT EXISTS preserve_v3_inventory_delete BEFORE DELETE ON documents
            WHEN OLD.collection_name IN ('inventoryLedger', 'transactions', 'transactionHistory') AND json_extract(OLD.data, '$.v3InventoryBaseline') IS NOT NULL
            BEGIN SELECT RAISE(IGNORE); END;
            CREATE TRIGGER IF NOT EXISTS preserve_v3_inventory_update BEFORE UPDATE OF data ON documents
            WHEN OLD.collection_name = 'inventoryLedger' AND json_extract(OLD.data, '$.v3InventoryBaseline') IS NOT NULL
            AND (json_extract(NEW.data, '$.v3InventoryBaseline') IS NOT json_extract(OLD.data, '$.v3InventoryBaseline')
              OR json_extract(NEW.data, '$.productId') IS NOT json_extract(OLD.data, '$.productId')
              OR json_extract(NEW.data, '$.warehouseId') IS NOT json_extract(OLD.data, '$.warehouseId')
              OR json_extract(NEW.data, '$.qtyIn') IS NOT json_extract(OLD.data, '$.qtyIn')
              OR json_extract(NEW.data, '$.qtyOut') IS NOT json_extract(OLD.data, '$.qtyOut'))
            BEGIN SELECT RAISE(ABORT, 'SYNC_V3_INVENTORY_COVERAGE_REQUIRED'); END;
            CREATE TRIGGER IF NOT EXISTS preserve_v3_financial_authority_update BEFORE UPDATE OF data ON documents
            WHEN OLD.collection_name IN ('transactions','transactionHistory') AND json_extract(OLD.data, '$.v3InventoryBaseline') IS NOT NULL
            AND (json_extract(NEW.data, '$.v3InventoryBaseline') IS NOT json_extract(OLD.data, '$.v3InventoryBaseline')
              OR json_extract(NEW.data, '$.v3Binding') IS NOT json_extract(OLD.data, '$.v3Binding')
              OR json_extract(NEW.data, '$.v3WarehouseId') IS NOT json_extract(OLD.data, '$.v3WarehouseId')
              OR json_extract(NEW.data, '$.v3CommitFingerprint') IS NOT json_extract(OLD.data, '$.v3CommitFingerprint')
              OR json_extract(NEW.data, '$.items') IS NOT json_extract(OLD.data, '$.items')
              OR json_extract(NEW.data, '$.total') IS NOT json_extract(OLD.data, '$.total')
              OR json_extract(NEW.data, '$.netAmount') IS NOT json_extract(OLD.data, '$.netAmount')
              OR json_extract(NEW.data, '$.taxAmount') IS NOT json_extract(OLD.data, '$.taxAmount'))
            BEGIN SELECT RAISE(ABORT, 'SYNC_V3_FINANCIAL_AUTHORITY_IMMUTABLE'); END;
            CREATE TABLE IF NOT EXISTS storage_meta (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            );
            ${STRICT_DURABLE_COLLECTIONS.map(collection => `
            INSERT OR IGNORE INTO storage_meta (key, value, updatedAt)
            VALUES ('durable_collection:${collection}', 'documents_v1', datetime('now'));`).join('')}
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
            CREATE TABLE IF NOT EXISTS master_number_ranges (
                range_id TEXT PRIMARY KEY NOT NULL,
                entity_type TEXT NOT NULL,
                prefix TEXT NOT NULL,
                start_number INTEGER NOT NULL,
                end_number INTEGER NOT NULL,
                next_number INTEGER NOT NULL,
                last_issued_number INTEGER,
                padding INTEGER NOT NULL,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_reported_number INTEGER,
                progress_pending INTEGER NOT NULL DEFAULT 0,
                blocked_reason TEXT,
                terminal_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_master_number_ranges_allocation
            ON master_number_ranges(entity_type, status, start_number, range_id);
            ${DURABLE_OUTBOX_SCHEMA_SQL}
            ${FISCAL_RETIREMENT_WRITER_SCHEMA}
            ${OFFLINE_FISCAL_ABANDON_WRITER_SCHEMA}
            ${OFFLINE_FISCAL_ALLOCATION_WRITER_SCHEMA}
            ${TRACKING_ALLOCATION_SCHEMA}
            ${TRACKING_OPERATION_SCHEMA}
            ${LARGE_MASTER_SYNC_V3_SCHEMA_SQL}
            ${ARTICLE_FORMATS_SCHEMA}
            ${NATIVE_FISCAL_RECEIPTS_SCHEMA}
            ${TERMINAL_AUTH_EVIDENCE_SCHEMA}
        `);
        await this.withWriteLock(()=>this.withNativeTransaction(()=>reconcileInventoryPoolIndex({
            storageLayout:'DOCUMENTS',
            query:async<T>(sql:string,values:(string|number|null)[])=>(await db.query(sql,values)).values as T[] || [],
            executeAtomic:statements=>this.executeArticleFormatOwned(statements),
            executeSchema:async()=>{throw Error('POS_FORMAT_SCHEMA_INSIDE_FINANCIAL_TRANSACTION');},
        },false)));
        await this.withWriteLock(async () => {
            await ensureLargeMasterSyncV3ContractColumns(db);
            await backfillLargeMasterSyncV3Categories(db);
        });
        await this.migrateLegacyCollectionsBlobTable();
    }

    private async readStoredDocuments(collectionName: string): Promise<any[]> {
        const db = this.ensureDb();
        const docs: any[] = [];
        let offset = 0;

        while (true) {
            const result = await db.query(
                'SELECT doc_id, length(data) AS data_length, CASE WHEN length(data) <= ? THEN data ELSE NULL END AS data FROM documents WHERE collection_name = ? ORDER BY sort_order ASC, updatedAt ASC LIMIT ? OFFSET ?',
                [MAX_DOCUMENT_JSON_BYTES, collectionName, DOCUMENT_READ_BATCH_SIZE, offset]
            );
            const rows = Array.isArray(result?.values) ? result.values : [];
            if (rows.length === 0) break;

            for (const row of rows) {
                const storedRow = row && typeof row === 'object' ? row as Record<string, unknown> : {};
                let rawValue = storedRow.data;
                if (rawValue === null && collectionName === 'config' && typeof storedRow.doc_id === 'string') {
                    const chunks: string[] = [];
                    const length = Number(storedRow.data_length) || 0;
                    for (let start = 1; start <= length; start += CONFIG_READ_CHUNK_SIZE) {
                        const chunk = await db.query(
                            'SELECT substr(data, ?, ?) AS data FROM documents WHERE collection_name = ? AND doc_id = ?',
                            [start, CONFIG_READ_CHUNK_SIZE, collectionName, storedRow.doc_id]
                        );
                        const text = chunk.values?.[0]?.data;
                        if (typeof text !== 'string') throw new Error('No se pudo leer la configuración SQLite completa.');
                        chunks.push(text);
                    }
                    rawValue = chunks.join('');
                }
                if (typeof rawValue !== 'string' || !rawValue.trim()) continue;
                if (collectionName !== 'config' && rawValue.length > MAX_DOCUMENT_JSON_BYTES) {
                    console.error(
                        `[CapacitorSQLiteAdapter] Skipping oversized ${collectionName} document `
                        + `(${rawValue.length} bytes) to avoid Android bridge OOM`
                    );
                    continue;
                }
                try {
                    const parsed = JSON.parse(rawValue);
                    docs.push(collectionName === 'config' ? compactStoredTerminalCatalog(parsed) : parsed);
                } catch (error) {
                    console.warn(`[CapacitorSQLiteAdapter] Failed to parse ${collectionName} row:`, error);
                    if (collectionName === 'config') throw error;
                }
            }

            offset += rows.length;
            if (rows.length < DOCUMENT_READ_BATCH_SIZE) break;
        }

        return docs;
    }

    private collectionReplacementStatements(name:string,ids:string[],now:string):Array<{statement:string;values:any[]}> {
        const placeholders=ids.map(()=>'?').join(',');
        const statements:Array<{statement:string;values:any[]}>=[];
        if(name==='internalSequences') statements.push({
            statement:`UPDATE documents SET data=json_set(data,'$.active',json('false')),updatedAt=?
                WHERE collection_name='internalSequences' ${ids.length ? `AND doc_id NOT IN (${placeholders})` : ''}`,
            values:[now,...ids],
        });
        // Preserve issued counters; omitting a series revokes its eligibility without erasing its high-water mark.
        // Incoming fiscal/config rows are updated in place. Only actual omissions are withdrawals;
        // deleting a matching row first would revoke unchanged authority and erase live buffer state.
        const preserveIncomingRows=['localFiscalBuffer','config','fiscalAllocations','fiscalRanges'].includes(name)&&ids.length>0;
        statements.push({statement:`DELETE FROM documents WHERE collection_name=?
            AND collection_name NOT IN ('internalSequences','globalSequenceCounter')
            ${preserveIncomingRows ? `AND doc_id NOT IN (${placeholders})` : ''}`,
            values:[name,...(preserveIncomingRows ? ids : [])]});
        return statements;
    }

    private async replaceStoredDocuments(collectionName: string, docs: any[]): Promise<void> {
        const db = this.ensureDb();
        const now = new Date().toISOString();
        const rows=this.toDocumentRows(collectionName,docs);
        const statements = [
            ...this.collectionReplacementStatements(collectionName,rows.map(row=>row.docId),now),
            ...rows.map((row) => ({
                statement: DOCUMENT_UPSERT_SQL,
                values: [
                    collectionName,
                    row.docId,
                    row.data,
                    collectionName,
                    row.docId,
                    collectionName,
                    now,
                ],
            })),
        ];

        await this.executeSetOrRun(statements);
    }

    private async upsertStoredDocuments(collectionName: string, docs: any[]): Promise<void> {
        if (!Array.isArray(docs) || docs.length === 0) return;

        const now = new Date().toISOString();
        const statements = this.toDocumentRows(collectionName, docs).map((row) => ({
            statement: DOCUMENT_UPSERT_SQL,
            values: [
                collectionName,
                row.docId,
                row.data,
                collectionName,
                row.docId,
                collectionName,
                now,
            ],
        }));

        await this.executeSetOrRun(statements);
    }

    private toDocumentRows(collectionName: string, docs: any[]): Array<{ docId: string; data: string }> {
        const rowsById = new Map<string, { docId: string; data: string }>();
        (Array.isArray(docs) ? docs : [])
            .map((doc, index) => {
                const docId = this.resolveDocumentId(collectionName, doc, index);
                if (!docId) return null;
                const payload = doc && typeof doc === 'object'
                    ? { ...doc, id: doc?.id || docId }
                    : { id: docId, value: doc };
                return {
                    docId,
                    data: JSON.stringify(payload),
                };
            })
            .filter((row): row is { docId: string; data: string } => Boolean(row))
            .forEach((row) => rowsById.set(row.docId, row));
        return Array.from(rowsById.values());
    }

    private async executeSetOrRun(statements: Array<{ statement: string; values: any[] }>): Promise<void> {
        if (!statements.length) return;
        await this.withWriteLock(() => this.executeUnlocked(statements));
    }

    async isV3TicketClosed(id: string): Promise<boolean> {
        return this.withWriteLock(async()=>{
      const result=await this.ensureDb().query(`SELECT doc_id FROM documents WHERE
        (collection_name='v3TicketSettlements' AND doc_id=?) OR
        (collection_name IN ('transactions','transactionHistory') AND json_extract(data,'$.restaurantOrderId')=?
          AND COALESCE(json_extract(data,'$.type'),'SALE') != 'REFUND') LIMIT 1`,[id,id]);
      return Boolean(result.values?.length);

        });
    }

    /** Missing cells remain zero only for an anchored, unchanged base product with current canonical permission. */
    private async assertKnownSparseNegativeArticle(
        read:(sql:string,values:any[])=>Promise<{values?:any[]}>,line:any,warehouseId:string,inventoryVersion:number,
        current:{syncId:string;syncVersion:number;binding:string},
    ):Promise<void> {
        const denied=()=>new Error('SYNC_V3_INVENTORY_COVERAGE_REQUIRED');
        const stamp=line.v3SaleAuthority;
        if(stamp?.syncId!==current.syncId||stamp.syncVersion!==current.syncVersion||line.variantId||line.variantSku)throw denied();
        const records=(await read('SELECT sync_version,record_json FROM master_v3_articles WHERE article_id=? AND sync_version IN (?,?)',
            [line.id,inventoryVersion,current.syncVersion])).values || [];
        const anchored=records.filter(r=>r.sync_version===inventoryVersion),selected=records.filter(r=>r.sync_version===current.syncVersion);
        if(anchored.length!==1||selected.length!==1)throw denied();
        let original:any,source:any;
        try{original=JSON.parse(anchored[0].record_json);source=JSON.parse(selected[0].record_json);}catch{throw denied();}
        if(!original||!source||Array.isArray(original)||Array.isArray(source)||original.id!==line.id||source.id!==line.id
            ||source.type!=='PRODUCT'||source.inventoriable!==true||source.active===false||source.sellable===false
            ||source.operationalFlags?.trackInventory!==true||source.operationalFlags?.allowNegativeStock!==true
            ||['isWeighted','usesLots','usesSerial'].some(flag=>source.operationalFlags?.[flag]===true)
            ||!Array.isArray(original.activeWarehouseIds)||!original.activeWarehouseIds.includes(warehouseId)
            ||!Array.isArray(source.activeWarehouseIds)||!source.activeWarehouseIds.includes(warehouseId)
            ||v3ArticleSemantics(original)!==v3ArticleSemantics(source))throw denied();
    }

    private async assertV3FinancialBaseline(documents: DurableDocumentMutation[]): Promise<void> {
        const retainedSources = new Map<string,{document:any;lines:Map<string,any[]>}>();
        const reads = new Map<string, Promise<any>>();
        const read = (sql: string, values: any[]) => {
          const key = JSON.stringify([sql, values]);
          if (!reads.has(key)) reads.set(key, this.ensureDb().query(sql, values));
          return reads.get(key)!;
        };
        const demands = new Map<string, { baseline: string; productId: string; warehouseId: string; quantity: number; quantityScale?:4|6; exactQuantity?:string; nonFormatWriter?:boolean }>();
        for (const mutation of documents) {
            const document = mutation.document as any;
            if(mutation.collectionName==='transactions'&&mutation.requireAbsent)await assertPresentationCommit(document,mutation.inventoryPresentationPrecondition,async<T>(sql:string,values:(string|number|null)[])=>(await read(sql,values)).values as T[] || [],mutation.v3StockRequirements||[]);
            if(mutation.collectionName==='inventoryLedger'&&!document.articleFormatEventId
              &&(Number(document.qtyIn || 0)!==0||Number(document.qtyOut || 0)!==0)) {
              await assertNoReconciledOrdinaryWriter(async<T>(sql:string,values:(string|number|null)[])=>(await read(sql,values)).values as T[] || [],document.warehouseId);
            }
            if (mutation.requireAbsent || mutation.expectedDocument !== undefined) {
              const stored = await read('SELECT data FROM documents WHERE collection_name = ? AND doc_id = ?', [mutation.collectionName, document.id]);
              if (mutation.requireAbsent && stored.values?.length) throw new Error('SYNC_V3_DUPLICATE_COMMIT');
              if (mutation.expectedDocument !== undefined && stored.values?.[0]?.data !== mutation.expectedDocument) {
                throw new Error('SYNC_V3_CONCURRENT_FINANCIAL_UPDATE');
              }
            }
            if (mutation.v3ExpectedRetainedDocument) {
              const expected = mutation.v3ExpectedRetainedDocument;
              if(['transactions','transactionHistory'].includes(expected.collection) && document.id !== expected.id
                && (document.type !== 'REFUND' || document.originalTransactionId !== expected.id)) {
                throw new Error('SYNC_V3_RETAINED_SOURCE_REQUIRED');
              }
              const stored = await read('SELECT data FROM documents WHERE collection_name = ? AND doc_id = ?', [expected.collection, expected.id]);
              if (stored.values?.[0]?.data !== expected.expected) throw new Error('SYNC_V3_RETAINED_TICKET_CHANGED');
              const retained = JSON.parse(expected.expected);
              if(['transactions','transactionHistory'].includes(expected.collection)&&document.id!==expected.id&&document.originalTransactionId===expected.id
                && !['COMPLETED','PARTIAL_REFUND'].includes(retained.status)) throw Error('SYNC_V3_REFUND_ORIGINAL_NOT_REFUNDABLE');
              if(expected.collection==='transactionHistory' && !retained.zReportId) throw Error('SYNC_V3_RETAINED_SOURCE_REQUIRED');
              const reservation = expected.collection === 'reservations' ? retained : retained.sourceCollection === 'reservations'
                ? JSON.parse(retained.sourceExpected) : undefined;
              if (reservation) {
                assertV3ReservationSource(reservation,document.v3Binding,document.v3WarehouseId,mutation.v3ReservationExpiration === true);
                if (mutation.v3ReservationExpiration) {
                  if (mutation.collectionName === 'reservations' ? document.status !== 'EXPIRED' || document.id !== reservation.id
                    : mutation.collectionName !== 'v3RestoredTicketSources' || document.state !== 'CANCELLED' || document.cancelReason !== 'EXPIRED'
                      || document.id !== reservationClaimId(reservation.id)) throw new Error('SYNC_V3_RESERVATION_EXPIRY_INVALID');
                  const prefix = reservationClaimId(reservation.id)+':payment:';
                  const active = await read("SELECT intent_id FROM payment_intents_v2 WHERE substr(payment_id,1,?)=? AND status IN ('AUTHORIZING','AUTHORIZED','UNKNOWN','RECONCILIATION_REQUIRED') LIMIT 1",[prefix.length,prefix]);
                  if (active.values?.length) throw new Error('SYNC_V3_RESERVATION_PAYMENT_RECONCILIATION_REQUIRED');
                }
                const original = await read('SELECT data FROM documents WHERE collection_name = ? AND doc_id = ?', ['reservations',reservation.id]);
                if (original.values?.[0]?.data !== JSON.stringify(reservation)) throw new Error('SYNC_V3_RESERVATION_SOURCE_CHANGED');
                if (expected.collection !== 'reservations' && (retained.id !== reservationClaimId(reservation.id) || retained.state !== 'PENDING'
                  || retained.sourceId !== reservation.id)) throw new Error('SYNC_V3_RESERVATION_SOURCE_CHANGED');
                if (document.items?.length && ['transactions','transactionHistory','v3RestoredTicketSources'].includes(mutation.collectionName)) {
                  assertV3ReservationLines(reservation,document.items);
                  if (mutation.collectionName === 'transactions' || mutation.collectionName === 'transactionHistory') assertV3ReservationInvoice(reservation,document);
                }
              }

              if (!['transactions','transactionHistory'].includes(expected.collection)) {
                const closed = await read(`SELECT doc_id FROM documents WHERE
                  (collection_name='v3TicketSettlements' AND doc_id=?) OR
                  (collection_name IN ('transactions','transactionHistory') AND json_extract(data,'$.restaurantOrderId')=?
                    AND COALESCE(json_extract(data,'$.type'),'SALE') != 'REFUND') LIMIT 1`,[expected.id,expected.id]);
                if(closed.values?.length) throw new Error('SYNC_V3_RETAINED_TICKET_CHANGED');
              }
            }
            if (mutation.collectionName === 'catalogEdits' && document.mutation?.domain === 'item_operations'
              && document.mutation?.field === 'production_area_id' && mutation.v3CurrentCatalog) {
              const current = mutation.v3CurrentCatalog;
              const active = await read(`SELECT o.binding FROM master_v3_operational_owner o
                JOIN master_v3_state s ON s.singleton=1 WHERE o.singleton=1 AND o.binding=?
                AND o.sync_id=? AND o.sync_version=? AND s.active_sync_id=o.sync_id AND s.active_version=o.sync_version`,
                [current.binding,current.syncId,current.syncVersion]);
              if (!active.values?.length) throw new Error('SYNC_V3_CATALOG_VERSION_CHANGED');
            }
            if (!document.v3InventoryBaseline) continue;
            const [binding, syncId, syncVersion, inventoryVersion, cursor] = JSON.parse(document.v3InventoryBaseline);
            const current = mutation.v3CurrentCatalog || { syncId, syncVersion, binding };
            if (current.binding !== binding) throw new Error('SYNC_V3_MOVEMENT_AUTHORITY_INVALID');
            const result = await read(`SELECT o.binding FROM master_v3_operational_owner o
              JOIN master_v3_state s ON s.singleton = 1 JOIN master_v3_inventory_state i ON i.singleton = 1
              WHERE o.singleton = 1 AND o.binding = ? AND o.sync_id = ? AND o.sync_version = ?
              AND s.active_sync_id = o.sync_id AND s.active_version = o.sync_version
              AND i.sync_id = ? AND i.sync_version = ?
              AND i.inventory_version = ? AND i.cursor = ?`, [binding, current.syncId, current.syncVersion, syncId, syncVersion, inventoryVersion, cursor]);
            if (!result.values?.length || document.v3Binding !== binding) throw new Error('SYNC_V3_RUNTIME_VERSION_CHANGED');
            if (current.syncId !== syncId || current.syncVersion !== syncVersion) {
              const receipt = await read(`SELECT sync_id FROM master_v3_catalog_owners WHERE sync_id = ? AND sync_version = ?
                AND binding = ? AND inventory_sync_id = ? AND inventory_sync_version = ? AND inventory_version = ? AND inventory_cursor = ?`,
                [current.syncId, current.syncVersion, binding, syncId, syncVersion, inventoryVersion, cursor]);
              if (!receipt.values?.length) throw new Error('SYNC_V3_STOCK_AUTHORITY_INVALID');
            }
            for (const line of document.items || []) {
              if (mutation.requireAbsent && mutation.collectionName === 'transactions'
                && (current.syncId !== syncId || current.syncVersion !== syncVersion)
                && line.isInventoriable && line.operationalFlags?.trackInventory !== false && line.type !== 'SERVICE') {
                const coverage = await read('SELECT item_id FROM master_v3_inventory_balances WHERE item_id=? AND warehouse_id=?', [line.id,document.v3WarehouseId]);
                if (!coverage.values?.length) {
                  await this.assertKnownSparseNegativeArticle(read,line,document.v3WarehouseId,syncVersion,current);
                }
              }
              const stamp = line.v3SaleAuthority;
              if (!stamp || stamp.binding !== binding || stamp.warehouseId !== document.v3WarehouseId) throw new Error('SYNC_V3_MOVEMENT_AUTHORITY_INVALID');
              const explicit = stamp.inventorySyncId !== undefined || stamp.inventorySyncVersion !== undefined;
              if (explicit && (!stamp.inventorySyncId || !Number.isSafeInteger(stamp.inventorySyncVersion))) throw new Error('SYNC_V3_STOCK_AUTHORITY_INVALID');
              if ((stamp.inventorySyncId || stamp.syncId) !== syncId || (stamp.inventorySyncVersion ?? stamp.syncVersion) !== syncVersion
                || stamp.inventoryVersion !== inventoryVersion || stamp.inventoryCursor !== cursor) throw new Error('SYNC_V3_STOCK_AUTHORITY_INVALID');
              if (stamp.syncId !== current.syncId || stamp.syncVersion !== current.syncVersion) {
                const context = mutation.v3ExpectedRetainedDocument || (mutation.expectedDocument && mutation.collectionName === 'transactions'
                  ? { collection: 'transactions', id: document.id, expected: mutation.expectedDocument } : undefined);
                if (!context || !['parkedTickets','transactions','transactionHistory','v3RestoredTicketSources','reservations'].includes(context.collection)
                  || context.collection === 'reservations' && document.sourceId !== context.id && document.reservationId !== context.id
                  || context.collection === 'v3RestoredTicketSources' && context.id.startsWith('reservation:') && document.id !== context.id && document.v3ReservationClaimId !== context.id
                  || !['transactions','transactionHistory','reservations'].includes(context.collection) && !context.id.startsWith('reservation:') && document.restaurantOrderId !== context.id
                  || ['transactions','transactionHistory'].includes(context.collection) && document.id !== context.id && document.originalTransactionId !== context.id) {
                  throw new Error('SYNC_V3_RETAINED_SOURCE_REQUIRED');
                }
                const stored = await read('SELECT data FROM documents WHERE collection_name = ? AND doc_id = ?', [context.collection, context.id]);
                if (stored.values?.[0]?.data !== context.expected) throw new Error('SYNC_V3_RETAINED_TICKET_CHANGED');
                const sourceKey=JSON.stringify([context.collection,context.id,context.expected]);
                if(!retainedSources.has(sourceKey)) {
                  const document=JSON.parse(context.expected); const lines=new Map<string,any[]>();
                  for(const source of document.items || []) {
                    const key=JSON.stringify([source.cartId,source.id]);lines.set(key,[...(lines.get(key)||[]),source]);
                  }
                  retainedSources.set(sourceKey,{document,lines});
                }
                const source=retainedSources.get(sourceKey)!;
                if (context.collection === 'v3RestoredTicketSources' && !['PENDING','PARKED'].includes(source.document.state)) throw new Error('SYNC_V3_RETAINED_TICKET_CHANGED');
                const formatSourceLine = document.articleFormatEventId && line.formatWireLine?.source_line_id;
                const sourceLineId = formatSourceLine || line.cartId;
                const sources = source.lines.get(JSON.stringify([sourceLineId,line.id])) || [];
                if (formatSourceLine && (source.document.articleFormatEventId !== document.articleFormatWire?.source_event_id
                  || JSON.stringify(sources[0]?.articleFormat) !== JSON.stringify(line.articleFormat))) throw new Error('SYNC_V3_RETAINED_LINE_CHANGED');
                if (sources.length !== 1 || v3RetainedLineFingerprint(sources[0]) !== v3RetainedLineFingerprint(formatSourceLine ? {...line,cartId:sourceLineId} : line)) {
                  throw new Error('SYNC_V3_RETAINED_LINE_CHANGED');
                }
                if (!['transactions','transactionHistory'].includes(context.collection)) {
                  const closed = await read(`SELECT doc_id FROM documents WHERE
                    (collection_name='v3TicketSettlements' AND doc_id=?) OR
                    (collection_name IN ('transactions','transactionHistory') AND json_extract(data,'$.restaurantOrderId')=?
                      AND COALESCE(json_extract(data,'$.type'),'SALE') != 'REFUND') LIMIT 1`, [context.id,context.id]);
                  if (closed.values?.length) throw new Error('SYNC_V3_RETAINED_TICKET_CHANGED');
                }
                const receipt = await read(`SELECT sync_id FROM master_v3_catalog_owners WHERE sync_id = ? AND sync_version = ?
                  AND binding = ? AND inventory_sync_id = ? AND inventory_sync_version = ? AND inventory_version = ? AND inventory_cursor = ?`,
                  [stamp.syncId, stamp.syncVersion, binding, syncId, syncVersion, inventoryVersion, cursor]);
                if (!receipt.values?.length) throw new Error('SYNC_V3_RETAINED_OWNER_REQUIRED');
              }
            }
            for (const requirement of mutation.v3StockRequirements || []) {
              if (requirement.baseline !== document.v3InventoryBaseline || requirement.warehouseId !== document.v3WarehouseId
                || !Number.isFinite(requirement.quantity) || requirement.quantity <= 0 || (requirement.quantityScale!==undefined && requirement.quantityScale!==4&&requirement.quantityScale!==6)) throw new Error('SYNC_V3_MOVEMENT_AUTHORITY_INVALID');
              const key = JSON.stringify([requirement.baseline, requirement.productId, requirement.warehouseId]);
              const prior = demands.get(key);
              const exactQuantity=new Money(String(requirement.quantity)).plus(prior?.exactQuantity || String(prior?.quantity || 0)).toFixed();
              const quantityScale=requirement.quantityScale || prior?.quantityScale;
              if(prior?.quantityScale&&requirement.quantityScale&&prior.quantityScale!==requirement.quantityScale)throw Error('TRACKING_BASE_PRECISION_INVALID');
              if(quantityScale===6){base6(requirement.quantity);const exact=new Money(exactQuantity);if(exact.dp()>6||exact.abs().times(1000000).gt(Number.MAX_SAFE_INTEGER))throw Error('TRACKING_BASE_PRECISION_INVALID');}
              if(quantityScale===4){
                base4(requirement.quantity);
                const exact=new Money(exactQuantity);
                if(exact.dp()>4 || exact.abs().gt('99999999999.9999'))throw new Error('POS_FORMAT_PRECISION_INVALID');
              }
              demands.set(key, { ...requirement, quantity: requirement.quantity + (prior?.quantity || 0),quantityScale,exactQuantity,nonFormatWriter:!document.articleFormatEventId||prior?.nonFormatWriter });
            }
        }
        // Both this read and every ledger write occur after BEGIN, under the shared native write queue.
        for (const demand of demands.values()) {
          if(demand.nonFormatWriter)await assertNoReconciledOrdinaryWriter(async<T>(sql:string,values:(string|number|null)[])=>(await read(sql,values)).values as T[] || [],demand.warehouseId);
          if(demand.quantityScale===6){const stock=await readV3Base6Stock(async<T>(sql:string,values:(string|number|null)[])=>(await read(sql,values)).values as T[]||[],demand.baseline,demand.productId,demand.warehouseId);if(new Money(demand.exactQuantity!).gt(stock.available))throw Error('SYNC_V3_STOCK_INSUFFICIENT');continue;}
          if(demand.quantityScale===4){
            const stock=await readV3Base4Stock(async<T>(sql:string,values:(string|number|null)[])=>(await read(sql,values)).values as T[] || [],demand.baseline,demand.productId,demand.warehouseId);
            if(new Money(demand.exactQuantity!).gt(stock.available))throw new Error('SYNC_V3_STOCK_INSUFFICIENT');
            continue;
          }
          const result = await read(`SELECT
            COALESCE((SELECT qty_on_hand - qty_reserved - qty_committed FROM master_v3_inventory_balances
              WHERE item_id = ? AND warehouse_id = ?), 0) + COALESCE((SELECT SUM(
                COALESCE(json_extract(data, '$.qtyIn'), 0) - COALESCE(json_extract(data, '$.qtyOut'), 0))
              FROM documents WHERE collection_name = 'inventoryLedger'
                AND json_extract(data, '$.v3InventoryBaseline') = ?
                AND json_extract(data, '$.productId') = ? AND json_extract(data, '$.warehouseId') = ?), 0) AS available`,
            [demand.productId, demand.warehouseId, demand.baseline, demand.productId, demand.warehouseId]);
          if (demand.quantity > Number(result.values?.[0]?.available || 0)) throw new Error('SYNC_V3_STOCK_INSUFFICIENT');
        }
    }

    private async executeUnlocked(statements: Array<{ statement: string; values: any[] }>, precondition?: () => Promise<void>, nativeFinancial=false): Promise<void> {
        const db = this.ensureDb();
        const executable = statements.map((entry) => ({
            statement: entry.statement.trim(),
            values: entry.values,
        }));

        if(nativeFinancial){await this.withNativeTransaction(async()=>{await precondition?.();for(const entry of executable)await db.run(entry.statement,entry.values,false);});return;}

        if (!precondition && typeof (db as any).executeSet === 'function') {
            await (db as any).executeSet(executable, true, 'no');
            return;
        }

        await db.execute('BEGIN TRANSACTION;', false);
        try {
            await precondition?.();
            for (const entry of executable) {
                await db.run(entry.statement, entry.values, false);
            }
            await db.execute('COMMIT;', false);
        } catch (error) {
            await db.execute('ROLLBACK;', false).catch(() => undefined);
            throw error;
        }
    }

    private withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
        const guarded=()=>{
            if(this.financialConnectionError)throw this.financialConnectionError;
            return operation();
        };
        const result = this.writeQueue.then(guarded, guarded);
        this.writeQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    private resolveDocumentId(collectionName: string, doc: any, index: number): string {
        if (collectionName === 'config') {
            return String(doc?.id || 'current');
        }
        if (collectionName === 'globalSequenceCounter') {
            return 'value';
        }
        const explicitId = doc?.id ?? doc?._id ?? doc?.uuid;
        if (explicitId !== undefined && explicitId !== null && String(explicitId).trim()) {
            return String(explicitId);
        }
        return `${collectionName}_${index}`;
    }

    private toStoredDocuments(collectionName: string, data: any): any[] {
        if (collectionName === 'config' && data && !Array.isArray(data)) {
            return [{ ...compactStoredTerminalCatalog(data), id: (data as any).id || 'current' }];
        }

        if (collectionName === 'globalSequenceCounter' && typeof data === 'number') {
            return [{ id: 'value', count: data }];
        }

        return Array.isArray(data) ? data : [];
    }

    private fromStoredDocuments(collectionName: string, docs: any[]): any {
        if (collectionName === 'config') {
            const realDocs = docs.filter((doc: any) => doc?.id !== '_db_initialized' && doc?.id !== 'config_metadata');
            if (!realDocs.length) return {};
            const current = realDocs.find((doc: any) => doc?.id === 'current');
            return current || realDocs[0] || {};
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

    private async migrateLegacyCollectionsBlobTable(): Promise<void> {
        const db = this.ensureDb();
        const migrated = await this.getMetaValue(DOCUMENT_SCHEMA_MIGRATION_KEY);
        if (migrated === '1') return;

        const hasLegacyTable = await this.hasLegacyCollectionsBlobTable();
        if (!hasLegacyTable) {
            await this.setMetaValue(DOCUMENT_SCHEMA_MIGRATION_KEY, '1');
            return;
        }

        const existingDocsCount = this.readNumericResult(
            (await db.query('SELECT COUNT(*) as count FROM documents'))?.values,
            'count'
        );
        if (existingDocsCount > 0) {
            await this.setMetaValue(DOCUMENT_SCHEMA_MIGRATION_KEY, '1');
            return;
        }

        console.log('[CapacitorSQLiteAdapter] Migrating legacy collection blobs to document rows...');
        const keyResult = await db.query('SELECT key FROM collections ORDER BY key ASC');
        const keyRows = Array.isArray(keyResult?.values) ? keyResult.values : [];
        let migratedRows = 0;

        for (const keyRow of keyRows) {
            const collectionName = keyRow && typeof keyRow === 'object'
                ? String((keyRow as Record<string, unknown>).key || '')
                : '';
            if (!collectionName) continue;

            const result = await db.query(
                'SELECT key, value FROM collections WHERE key = ? LIMIT 1',
                [collectionName]
            );
            const row = Array.isArray(result?.values) ? result.values[0] : null;
            const rawValue = row && typeof row === 'object' ? (row as Record<string, unknown>).value : null;
            if (typeof rawValue !== 'string' || !rawValue.trim()) continue;
            if (rawValue.length > MAX_DOCUMENT_JSON_BYTES) {
                console.error(
                    `[CapacitorSQLiteAdapter] Skipping oversized legacy blob ${collectionName} `
                    + `(${rawValue.length} bytes) during migration`
                );
                continue;
            }

            try {
                const parsed = JSON.parse(rawValue);
                const docs = this.toStoredDocuments(collectionName, parsed);
                await this.replaceStoredDocuments(collectionName, docs);
                migratedRows += docs.length;
            } catch (error) {
                console.warn(`[CapacitorSQLiteAdapter] Failed to migrate ${collectionName}:`, error);
            }
        }

        await this.setMetaValue(DOCUMENT_SCHEMA_MIGRATION_KEY, '1');
        console.log(`[CapacitorSQLiteAdapter] Migrated ${migratedRows} documents from legacy blobs.`);
    }

    private async hasLegacyCollectionsBlobTable(): Promise<boolean> {
        const db = this.ensureDb();
        const tableResult = await db.query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='collections'"
        );
        if (!Array.isArray(tableResult?.values) || tableResult.values.length === 0) return false;

        const pragmaResult = await db.query('PRAGMA table_info(collections);');
        const columns = new Set(
            (Array.isArray(pragmaResult?.values) ? pragmaResult.values : [])
                .map((row: any) => String(row?.name || ''))
                .filter(Boolean)
        );
        return columns.has('key') && columns.has('value');
    }

    private async getMetaValue(key: string): Promise<string | null> {
        const db = this.ensureDb();
        const result = await db.query('SELECT value FROM storage_meta WHERE key = ? LIMIT 1', [key]);
        const row = Array.isArray(result?.values) ? result.values[0] : null;
        const value = row && typeof row === 'object' ? (row as Record<string, unknown>).value : null;
        return typeof value === 'string' ? value : null;
    }

    private async setMetaValue(key: string, value: string): Promise<void> {
        const db = this.ensureDb();
        await this.withWriteLock(() => db.run(
            'INSERT OR REPLACE INTO storage_meta (key, value, updatedAt) VALUES (?, ?, ?)',
            [key, value, new Date().toISOString()]
        ));
    }
}
