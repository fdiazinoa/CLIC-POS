/**
 * Sync Manager
 * 
 * Orchestrates all synchronization operations between master and slave terminals.
 * Manages catalog distribution (Master → Slaves) and operational data collection (Slaves → Master).
 */

import { db } from '../../utils/db';
import { dbAdapter } from '../db';
import { apiSyncAdapter, ProductImageManifestItem, ProductImagePayloadItem } from './ApiSyncAdapter';
import { NetworkScanner } from './NetworkScanner';
import { v4 as uuidv4 } from 'uuid';
import { Capacitor } from '@capacitor/core';
import { permissionService } from './PermissionService';
import { isNativeAndroidRuntime, normalizeErpBaseUrl, normalizeErpSyncApiBase, resolveErpSyncApiBase } from '../../utils/erpBaseUrl';
import { realtimeNotificationService } from './RealtimeNotificationService';
import { productImageCacheService } from './ProductImageCacheService';
import { masterDataImageCacheService, type ImageBackedCollection } from './MasterDataImageCacheService';
import { DEFAULT_ROLES } from '../../constants';
import { Product, Customer, Supplier, DocumentSeries, BusinessConfig, SyncConfig, TerminalConfig, PurchaseOrder, StockTransfer, ProductStock, ProductPrice, TariffPrice, Warehouse, User, RoleDefinition, Permission } from '../../types';
import {
    applyTerminalConfigSnapshot,
    extractTerminalConfigSnapshot,
    extractTerminalOperationalDocumentState,
} from '../../utils/terminalConfigSnapshot';
import { buildMasterUrlFromHost } from '../../utils/cloudMasterRegistry';
import {
    looksLikeUuidString,
    mergeDocumentSeriesCollection,
    resolveDocumentSeriesDisplayPrefix,
} from '../../utils/documentSeriesIdentity';
import {
    posCatalogDebugElapsedMs,
    posCatalogDebugLog,
    posCatalogDebugLogDbRows,
    posCatalogDebugMatchesRaw,
    posCatalogDebugNow,
    posCatalogDebugSummarizeItem,
} from '../../utils/posCatalogDebugTrace';
import { canonicalizeWarehouseRecord } from '../../utils/masterIdentity';
import {
    extractWarehouseStockBalances,
    productIdMatchesInventoryReference,
    productIdentityCandidates,
} from '../../utils/productReferences';
import { canonicalizeTariffEntries, resolveTariffId } from '../../utils/masterIdentity';
import { ensureSyncDeviceToken, getInvalidatedSyncDeviceTokenInfo, resolveSyncDeviceToken } from './deviceToken';
import { normalizeRestaurantProductConfig } from '../../utils/restaurantProductConfig';
import { protectsLocalCatalogFromCloud, syncPolicy } from './SyncProfile';
import { isPosCloudStagingPushCollection } from './PosCloudStagingService';
import { reportSyncErrorDiagnostic, setCatalogDiagnosticStatus } from './SyncErrorDiagnostic';
import { DEVICE_SUPERSEDED_MESSAGE, dispatchDeviceRevoked } from '../../utils/deviceRevocation';
import { triggerErpSyncOutbox } from '../../utils/erpSyncLifecycle';
import { isPosSaleActive } from '../../utils/posSaleActivity';

export type SyncableCollection =
    | 'products' | 'items' | 'taxes' | 'customers' | 'suppliers' | 'warehouses'
    | 'paymentMethods' | 'priceLists' | 'productPrices' | 'categories' | 'productCategories' | 'productGroups' | 'collections'
    | 'serviceTypes' | 'rooms' | 'tables' | 'productionAreas'
    | 'documentSeries' | 'documentTypes' | 'fiscalRanges' | 'fiscalReceiptTypes'
    | 'fiscalReceipts' | 'fiscalSequences' | 'internalSequences' | 'terminalFiscalConfig'
    | 'promotions' | 'campaigns' | 'coupons' | 'discountRules' | 'promotionRules'
    | 'promotionConditions' | 'promotionBenefits'
    | 'pointsPrograms' | 'loyaltyPrograms' | 'pointsRules' | 'earningRules'
    | 'redemptionRules' | 'customerPointBalances' | 'loyaltyTiers'
    | 'users' | 'roles' | 'productStocks' | 'supplierProductPrices'
    | 'inventoryLedger' | 'transactions' | 'payments' | 'cashClosures' | 'cashOpenings'
    | 'zReports' | 'cashMovements' | 'cashDrawerEvents' | 'inventoryMovements'
    | 'transfers' | 'receptions' | 'returns' | 'creditNotes'
    | 'promotionRedemptions' | 'couponRedemptions'
    | 'loyaltyPointMovements' | 'loyaltyPointAccruals' | 'loyaltyPointRedemptions'
    | 'pointAdjustments' | 'issuedFiscalDocuments' | 'fiscalDocumentUsages'
    | 'purchaseOrders' | 'activities' | 'crmOpportunities' | 'erp_sales_documents';

const MASTER_COLLECTIONS_FOR_ERP_PULL = new Set<SyncableCollection>([
    'products',
    'items',
    'taxes',
    'customers',
    'suppliers',
    'warehouses',
    'paymentMethods',
    'priceLists',
    'productStocks',
    'productPrices',
    'supplierProductPrices',
    'categories',
    'productCategories',
    'productGroups',
    'collections',
    'serviceTypes',
    'rooms',
    'tables',
    'productionAreas',
    'documentSeries',
    'documentTypes',
    'fiscalRanges',
    'fiscalReceiptTypes',
    'fiscalReceipts',
    'fiscalSequences',
    'internalSequences',
    'terminalFiscalConfig',
    'promotions',
    'campaigns',
    'coupons',
    'discountRules',
    'promotionRules',
    'promotionConditions',
    'promotionBenefits',
    'pointsPrograms',
    'loyaltyPrograms',
    'pointsRules',
    'earningRules',
    'redemptionRules',
    'customerPointBalances',
    'loyaltyTiers',
    'users',
    'roles',
]);

const CRITICAL_MASTER_COLLECTIONS_FOR_ERP_PULL = new Set<SyncableCollection>([
    'products',
    'taxes',
    'warehouses',
    'paymentMethods',
    'categories',
    'productCategories',
    'productGroups',
    'collections',
    'documentSeries',
    'fiscalRanges',
    'fiscalSequences',
    'internalSequences',
    'terminalFiscalConfig',
]);

const FISCAL_MASTER_COLLECTIONS_FOR_ERP_PULL = new Set<SyncableCollection>([
    'documentSeries',
    'documentTypes',
    'fiscalRanges',
    'fiscalReceiptTypes',
    'fiscalReceipts',
    'fiscalSequences',
    'internalSequences',
    'terminalFiscalConfig',
]);

const PROMOTION_MASTER_COLLECTIONS_FOR_ERP_PULL = new Set<SyncableCollection>([
    'promotions',
    'campaigns',
    'coupons',
    'discountRules',
    'promotionRules',
    'promotionConditions',
    'promotionBenefits',
]);

const LOYALTY_MASTER_COLLECTIONS_FOR_ERP_PULL = new Set<SyncableCollection>([
    'pointsPrograms',
    'loyaltyPrograms',
    'pointsRules',
    'earningRules',
    'redemptionRules',
    'customerPointBalances',
    'loyaltyTiers',
]);

const OPERATION_COLLECTIONS_FOR_ERP_PUSH = new Set<SyncableCollection>([
    'transactions',
    'payments',
    'cashClosures',
    'cashOpenings',
    'zReports',
    'cashMovements',
    'cashDrawerEvents',
    'inventoryLedger',
    'inventoryMovements',
    'transfers',
    'receptions',
    'returns',
    'creditNotes',
    'promotionRedemptions',
    'couponRedemptions',
    'loyaltyPointMovements',
    'loyaltyPointAccruals',
    'loyaltyPointRedemptions',
    'pointAdjustments',
    'issuedFiscalDocuments',
    'fiscalDocumentUsages',
    'purchaseOrders',
    'activities',
    'crmOpportunities',
    'erp_sales_documents',
]);

const isErpMasterPullCollection = (collection: SyncableCollection): boolean =>
    MASTER_COLLECTIONS_FOR_ERP_PULL.has(collection);

const isErpOperationCollection = (collection: SyncableCollection): boolean =>
    OPERATION_COLLECTIONS_FOR_ERP_PUSH.has(collection);

const isErpCriticalMasterCollection = (collection: SyncableCollection): boolean =>
    CRITICAL_MASTER_COLLECTIONS_FOR_ERP_PULL.has(collection);

const isPaymentMethodsMissingSyncError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;
    const value = (error as {
        __syncCollection?: string;
        __syncBackendCode?: string;
        backendCode?: string;
        code?: string;
        message?: string;
        collection?: string;
        supported?: boolean;
        critical?: boolean;
    });
    const normalizeCode = (code: string | undefined): string => String(code || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const normalizedCollection = String(value.collection || value.__syncCollection || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const normalizedMessage = String(value.message || '').toLowerCase();
    const backendCode = normalizeCode(value.__syncBackendCode || value.backendCode || value.code);
    const backendCodeMatch = backendCode === 'PAYMENT_METHODS_MISSING'
        || backendCode === 'PAYMENTMETHODS_MISSING'
        || /PAYMENT[_\s-]?METHODS?[_\s-]?MISSING/.test((value.__syncBackendCode || value.backendCode || value.code || '').toUpperCase());
    const collectionMatch = normalizedCollection === 'paymentmethods' || normalizedCollection === 'paymentmethod';
    const messageMatch = /payment methods missing|faltan m[ée]todos de pago|sin medios de pago|sin m[éé]todos de pago/i.test(normalizedMessage);
    return (
        backendCodeMatch
        || messageMatch
        || (value.supported === false && value.critical === true)
        || collectionMatch && /m[ée]todo/.test(normalizedMessage)
    );
};

const logSkippedNonMasterPull = (
    collection: SyncableCollection,
    targetKind: string,
    reason = isErpOperationCollection(collection) ? 'OPERATION_COLLECTION' : 'NOT_A_MASTER_ERP_COLLECTION'
): void => {
    console.warn('[SYNC_COLLECTION_SKIPPED_NOT_A_MASTER]', {
        collection,
        operation: 'PULL_MASTERS',
        targetKind,
        isMasterCollection: isErpMasterPullCollection(collection),
        isOperationCollection: isErpOperationCollection(collection),
        isCriticalMaster: isErpCriticalMasterCollection(collection),
        isFiscalMaster: FISCAL_MASTER_COLLECTIONS_FOR_ERP_PULL.has(collection),
        isPromotionMaster: PROMOTION_MASTER_COLLECTIONS_FOR_ERP_PULL.has(collection),
        isLoyaltyMaster: LOYALTY_MASTER_COLLECTIONS_FOR_ERP_PULL.has(collection),
        skippedReason: reason,
        userVisibleSeverity: 'warning',
    });
};

interface SyncStatus {
    collection: string;
    lastSyncedAt: string | null;
    localVersion: number;
    remoteVersion: number | null;
    lastSyncTimestamp?: string | null;
    status: 'SYNCED' | 'SYNCED_CLOUD' | 'PENDING' | 'ERROR';
    error?: string;
}

type TerminalManifestMasterScope = 'items' | 'customers' | 'suppliers' | 'sellers' | 'users' | 'pos_users' | 'roles' | 'pos_roles' | 'purchase_orders' | 'transfers';
type TerminalManifestBlockScope = 'inventory' | 'product_prices';
type TerminalManifestResolvedScope =
    | 'identity'
    | 'terminal'
    | 'device_role'
    | 'role'
    | 'pricing'
    | 'inventory'
    | 'documents'
    | 'catalog'
    | 'promotions'
    | 'loyalty';
type TerminalManifestScope = 'terminal' | TerminalManifestMasterScope | TerminalManifestBlockScope;
type TerminalManifestCountScope = TerminalManifestMasterScope | TerminalManifestBlockScope;

type TimestampCursorCollection = 'products' | 'items';

interface TimestampCollectionCursorState {
    lastSyncedAt: string | null;
    cursor: string | null;
    nextCursor: string | null;
}

interface TerminalCursorMap {
    terminal?: string | null;
    items?: string | null;
    customers?: string | null;
    suppliers?: string | null;
    users?: string | null;
    pos_users?: string | null;
    roles?: string | null;
    pos_roles?: string | null;
    purchase_orders?: string | null;
    transfers?: string | null;
    inventory?: string | null;
    product_prices?: string | null;
}

const TIMESTAMP_CURSOR_COLLECTIONS = new Set<SyncableCollection>(['products', 'items']);
const TIMESTAMP_COLLECTION_CURSOR_KEY_PREFIX = 'clic_pos_collection_timestamp_cursor:';

const isTimestampCursorCollection = (collection: SyncableCollection): collection is TimestampCursorCollection =>
    TIMESTAMP_CURSOR_COLLECTIONS.has(collection);

const normalizeIsoCursor = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || Number.isNaN(Date.parse(trimmed))) return null;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return null;
    return trimmed;
};

interface TerminalManifestPayload {
    cursor_map?: TerminalCursorMap;
    changed?: Partial<Record<TerminalManifestScope, boolean>>;
    changed_blocks?: TerminalManifestScope[];
    counts?: Partial<Record<TerminalManifestCountScope, number>>;
    snapshot_at?: string | null;
    inventory_version?: string | null;
    price_version?: string | null;
    domain_hashes?: Partial<Record<TerminalManifestBlockScope, string | null>>;
    snapshot_meta?: TerminalSnapshotDiagnostics | null;
}

interface TerminalSnapshotDiagnostics {
    snapshotSource?: 'live' | 'persistent' | string | null;
    snapshotAgeMs?: number | null;
    snapshotVersionHash?: string | null;
}

interface TerminalInventoryBalancePayload {
    item_id?: string | null;
    warehouse_id?: string | null;
    qty_on_hand?: number | null;
    qty_reserved?: number | null;
    qty_committed?: number | null;
    updated_at?: string | null;
}

interface TerminalInventoryPayload {
    cursor?: string | null;
    balances?: TerminalInventoryBalancePayload[];
    has_changes?: boolean;
    inventory_version?: string | null;
    snapshot_meta?: TerminalSnapshotDiagnostics | null;
    inventory?: {
        cursor?: string | null;
        balances?: TerminalInventoryBalancePayload[];
        has_changes?: boolean;
        inventory_version?: string | null;
        snapshot_meta?: TerminalSnapshotDiagnostics | null;
    };
}

interface TerminalProductPricePayload {
    id?: string | null;
    product_id?: string | null;
    item_id?: string | null;
    tariff_id?: string | null;
    tariff_code?: string | null;
    price?: number | null;
    currency?: string | null;
    updated_at?: string | null;
}

interface TerminalProductPricesPayload {
    cursor?: string | null;
    prices?: TerminalProductPricePayload[];
    has_changes?: boolean;
    price_version?: string | null;
    snapshot_meta?: TerminalSnapshotDiagnostics | null;
    product_prices?: {
        cursor?: string | null;
        prices?: TerminalProductPricePayload[];
        has_changes?: boolean;
        price_version?: string | null;
        snapshot_meta?: TerminalSnapshotDiagnostics | null;
    };
}

class SyncManager {
    private autoSyncInterval: any = null;
    private imageSyncInterval: any = null;
    private syncVersions: Map<string, number> = new Map();
    private syncTimestamps: Map<string, string> = new Map();
    private syncConfig: SyncConfig | null = null;
    private isMaster: boolean = false;
    private isDisabled: boolean = false;
    private initializedLocalTerminalId: string | null = null;
    private imageSyncInProgress = false;
    private lastProductImageManifestVersion = 0;
    private productImageHashes: Map<string, string> = new Map();
    private imageSyncOnlineHandler: (() => void) | null = null;
    private reducedSyncMode = false;
    private readonly IMAGE_SYNC_INTERVAL_MS = 180000;
    private readonly IMAGE_SYNC_BATCH_SIZE = 40;
    private terminalManifestSyncInFlight = false;
    private readyToSellStartedAt = 0;
    private readyToSellState: {
        readyToSell: boolean;
        readyToSellTimestamp: string | null;
        readyToSellDuration: number | null;
        currentSyncPhase: string;
        lastSync: string | null;
        lastSuccessfulSync: string | null;
        failedOperations: number;
        retryCount: number;
        inventoryVersion: string | null;
        priceVersion: string | null;
        inventoryVersionMatch: boolean | null;
        priceVersionMatch: boolean | null;
        inventorySyncSkippedByVersion: boolean;
        priceSyncSkippedByVersion: boolean;
        lastVersionComparison: Record<string, unknown> | null;
        snapshotSource: string | null;
        snapshotAgeMs: number | null;
        snapshotVersionHash: string | null;
        syncTelemetry: {
            inventory_version_hits: number;
            inventory_version_misses: number;
            price_version_hits: number;
            price_version_misses: number;
            inventory_sync_skipped: number;
            price_sync_skipped: number;
            bytes_saved_estimate: number;
        };
    } = {
        readyToSell: false,
        readyToSellTimestamp: null,
        readyToSellDuration: null,
        currentSyncPhase: 'IDLE',
        lastSync: null,
        lastSuccessfulSync: null,
        failedOperations: 0,
        retryCount: 0,
        inventoryVersion: null,
        priceVersion: null,
        inventoryVersionMatch: null,
        priceVersionMatch: null,
        inventorySyncSkippedByVersion: false,
        priceSyncSkippedByVersion: false,
        lastVersionComparison: null,
        snapshotSource: null,
        snapshotAgeMs: null,
        snapshotVersionHash: null,
        syncTelemetry: {
            inventory_version_hits: 0,
            inventory_version_misses: 0,
            price_version_hits: 0,
            price_version_misses: 0,
            inventory_sync_skipped: 0,
            price_sync_skipped: 0,
            bytes_saved_estimate: 0,
        },
    };

    private getTimestampCursorState(collection: TimestampCursorCollection): TimestampCollectionCursorState {
        const fallback: TimestampCollectionCursorState = {
            lastSyncedAt: null,
            cursor: null,
            nextCursor: null,
        };
        try {
            const raw = localStorage.getItem(`${TIMESTAMP_COLLECTION_CURSOR_KEY_PREFIX}${collection}`);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw) as Partial<TimestampCollectionCursorState>;
            const cursor = normalizeIsoCursor(parsed.nextCursor) || normalizeIsoCursor(parsed.cursor) || normalizeIsoCursor(parsed.lastSyncedAt);
            return {
                lastSyncedAt: normalizeIsoCursor(parsed.lastSyncedAt) || cursor,
                cursor,
                nextCursor: normalizeIsoCursor(parsed.nextCursor) || cursor,
            };
        } catch {
            return fallback;
        }
    }

    private saveTimestampCursorState(collection: TimestampCursorCollection, value: unknown): string | null {
        const cursor = normalizeIsoCursor(value);
        if (!cursor) return null;
        const state: TimestampCollectionCursorState = {
            lastSyncedAt: cursor,
            cursor,
            nextCursor: cursor,
        };
        localStorage.setItem(`${TIMESTAMP_COLLECTION_CURSOR_KEY_PREFIX}${collection}`, JSON.stringify(state));
        localStorage.setItem(`sync_timestamp_${collection}`, cursor);
        this.syncTimestamps.set(collection, cursor);
        return cursor;
    }

    private clearTimestampCursorState(collection: TimestampCursorCollection): void {
        localStorage.removeItem(`${TIMESTAMP_COLLECTION_CURSOR_KEY_PREFIX}${collection}`);
    }
    private imageSyncWorkerTimer: any = null;
    private imageSyncWorkerQueue: Array<{
        kind: 'products' | ImageBackedCollection;
        items: any[];
        reason: string;
    }> = [];

    public isInitialized: boolean = false;

    private publishSyncHealthUpdate(): void {
        try {
            localStorage.setItem('clic_pos_sync_health', JSON.stringify(this.getSyncHealthSnapshot()));
            window.dispatchEvent(new CustomEvent('syncHealthUpdated', { detail: this.getSyncHealthSnapshot() }));
        } catch {
            // best-effort diagnostics only
        }
    }

    private beginReadyToSellBootstrap(reason: string): void {
        if (this.readyToSellStartedAt > 0 && !this.readyToSellState.readyToSell) return;
        this.readyToSellStartedAt = Date.now();
        this.readyToSellState = {
            ...this.readyToSellState,
            readyToSell: false,
            readyToSellTimestamp: null,
            readyToSellDuration: null,
            currentSyncPhase: reason,
            lastSync: new Date().toISOString(),
        };
        this.publishSyncHealthUpdate();
    }

    private markReadyToSell(reason: string): void {
        if (this.readyToSellState.readyToSell) return;
        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const duration = this.readyToSellStartedAt > 0 ? now - this.readyToSellStartedAt : 0;
        this.readyToSellState = {
            ...this.readyToSellState,
            readyToSell: true,
            readyToSellTimestamp: timestamp,
            readyToSellDuration: duration,
            currentSyncPhase: reason,
            lastSuccessfulSync: timestamp,
        };
        console.info('ready_to_sell', {
            readyToSell: true,
            readyToSellTimestamp: timestamp,
            readyToSellDuration: duration,
            reason,
        });
        this.publishSyncHealthUpdate();
    }

    private setSyncPhase(phase: string): void {
        this.readyToSellState = {
            ...this.readyToSellState,
            currentSyncPhase: phase,
            lastSync: new Date().toISOString(),
        };
        this.publishSyncHealthUpdate();
    }

    public getSyncHealthSnapshot() {
        return {
            ...this.readyToSellState,
            pendingImageJobs: this.imageSyncWorkerQueue.length,
            imageSyncInProgress: this.imageSyncInProgress,
            erpActive: apiSyncAdapter.isErpActiveOperationalTarget(),
            tokenStatus: localStorage.getItem('clic_sync_auth_status') || 'UNKNOWN',
            terminalId: localStorage.getItem('clic_erp_sync_terminal_id') || localStorage.getItem('active_terminal_id') || null,
        };
    }

    private scheduleImageSyncWorker(kind: 'products' | ImageBackedCollection, items: any[], reason: string): void {
        const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
        if (safeItems.length === 0) return;
        this.imageSyncWorkerQueue.push({ kind, items: safeItems, reason });
        this.publishSyncHealthUpdate();

        if (this.imageSyncWorkerTimer) return;
        this.imageSyncWorkerTimer = window.setTimeout(() => {
            this.imageSyncWorkerTimer = null;
            void this.flushImageSyncWorkerQueue();
        }, 1500);
    }

    private async flushImageSyncWorkerQueue(): Promise<void> {
        if (this.imageSyncInProgress || this.imageSyncWorkerQueue.length === 0) return;
        const jobs = this.imageSyncWorkerQueue.splice(0);
        this.imageSyncInProgress = true;
        this.setSyncPhase('P4_IMAGE_SYNC_BACKGROUND');
        try {
            for (const job of jobs) {
                const startedAt = posCatalogDebugNow();
                if (job.kind === 'products') {
                    await productImageCacheService.syncSnapshotItems(job.items as Product[]);
                } else {
                    await masterDataImageCacheService.syncSnapshotItems(job.kind, job.items as any[]);
                }
                posCatalogDebugLog('image worker: job completed', {
                    kind: job.kind,
                    reason: job.reason,
                    count: job.items.length,
                    elapsedMs: posCatalogDebugElapsedMs(startedAt),
                });
            }
        } catch (error) {
            this.readyToSellState.failedOperations += 1;
            console.warn('⚠️ ImageSyncWorker: background image sync failed:', error);
        } finally {
            this.imageSyncInProgress = false;
            this.publishSyncHealthUpdate();
            if (this.imageSyncWorkerQueue.length > 0) {
                this.imageSyncWorkerTimer = window.setTimeout(() => {
                    this.imageSyncWorkerTimer = null;
                    void this.flushImageSyncWorkerQueue();
                }, 3000);
            }
        }
    }

    private resolveRuntimeWarehousesFromConfig(config: BusinessConfig | null | undefined, terminalId: string): Warehouse[] {
        if (!config || !Array.isArray(config.terminals)) {
            return [];
        }

        const terminal = config.terminals.find((candidate) => candidate?.id === terminalId) || config.terminals[0];
        const warehouses = Array.isArray(terminal?.config?.inventoryScope?.warehouses)
            ? terminal.config.inventoryScope.warehouses
            : [];

        return warehouses
            .filter((warehouse) => warehouse && typeof warehouse === 'object')
            .map((warehouse) => ({
                ...warehouse,
                erpWarehouseId: String((warehouse as any).erpWarehouseId || (warehouse as any).sourceWarehouseId || (warehouse as any).inventoryLocalId || warehouse.id || '').trim() || String(warehouse.id || '').trim(),
            })) as Warehouse[];
    }

    private isImageBackedCollection(collection: SyncableCollection): collection is ImageBackedCollection {
        return collection === 'customers' || collection === 'suppliers';
    }

    private normalizeMasterUrlForStorage(value: string): string {
        const trimmed = value.trim();
        if (!trimmed) return '';

        try {
            const parsed = new URL(trimmed);
            const numericPort = Number(parsed.port || 3001);
            return buildMasterUrlFromHost(
                parsed.hostname,
                Number.isFinite(numericPort) && numericPort > 0 ? numericPort : 3001,
                parsed.protocol,
            );
        } catch {
            const withoutProtocol = trimmed.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
            const [host, port] = withoutProtocol.split(':');
            const numericPort = Number(port);
            return buildMasterUrlFromHost(
                host,
                Number.isFinite(numericPort) && numericPort > 0 ? numericPort : 3001,
            );
        }
    }

    private resolveConfigErpBaseUrl(value: unknown): string | null {
        const raw = typeof value === 'string' ? value.trim() : '';
        if (!raw) return null;
        return normalizeErpBaseUrl(raw);
    }

    private resolveSyncApiBase(value: unknown): string | null {
        const raw = typeof value === 'string' ? value.trim() : '';
        if (!raw) return null;
        return normalizeErpSyncApiBase(raw);
    }

    private rehydrateOperationalTargetFromConfig(config: BusinessConfig | null, terminalId: string | null) {
        const currentTerminal = terminalId && config?.terminals
            ? config.terminals.find((terminal) =>
                terminal.id === terminalId || terminal.config?.erpTerminalId === terminalId
            )
            : null;

        const hintedTerminalId =
            String(currentTerminal?.config?.erpBinding?.terminalId || '').trim() ||
            String(currentTerminal?.config?.erpTerminalId || '').trim();

        const hintedBaseUrl =
            this.resolveConfigErpBaseUrl(localStorage.getItem('CLIC_ERP_BASE_URL')) ||
            this.resolveConfigErpBaseUrl(localStorage.getItem('erp_base_url')) ||
            this.resolveConfigErpBaseUrl(localStorage.getItem('CLIC_ERP_SYNC_URL')) ||
            this.resolveConfigErpBaseUrl(currentTerminal?.config?.metadata?.erp_base_url) ||
            this.resolveConfigErpBaseUrl(currentTerminal?.config?.metadata?.erpBaseUrl) ||
            this.resolveConfigErpBaseUrl((import.meta as any)?.env?.VITE_ERP_BASE_URL) ||
            this.resolveConfigErpBaseUrl((import.meta as any)?.env?.VITE_ERP_SYNC_API_URL) ||
            this.resolveConfigErpBaseUrl((import.meta as any)?.env?.VITE_SYNC_API_URL) ||
            null;

        apiSyncAdapter.setOperationalTargetHint({
            terminalId: hintedTerminalId || null,
            baseUrl: hintedBaseUrl || null,
        });

        if (hintedTerminalId) {
            localStorage.setItem('clic_erp_sync_terminal_id', hintedTerminalId);
        }

        if (terminalId) {
            localStorage.setItem('clic_erp_sync_local_terminal_id', terminalId);
        }
    }

    private shouldUseAbsoluteTerminalConfigEndpoint(): boolean {
        try {
            return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
        } catch {
            return false;
        }
    }

    private resolveTerminalConfigSyncApiBase(context: { erpBaseUrl: string | null }): string | null {
        const env = (import.meta as any)?.env || {};
        const candidates = [
            localStorage.getItem('CLIC_ERP_SYNC_URL'),
            env.VITE_SYNC_API_URL,
            env.VITE_ERP_SYNC_API_URL,
            context.erpBaseUrl,
            localStorage.getItem('CLIC_ERP_BASE_URL'),
            localStorage.getItem('erp_base_url'),
            env.VITE_ERP_BASE_URL,
        ];

        for (const candidate of candidates) {
            const resolved = this.resolveSyncApiBase(candidate);
            if (resolved) {
                return resolved;
            }
        }

        return resolveErpSyncApiBase();
    }

    private resolveLocalSyncApiBaseCandidates(): string[] {
        if (isNativeAndroidRuntime()) {
            return [];
        }

        const candidates = [
            'http://127.0.0.1:3001/api/sync',
            'http://localhost:3001/api/sync',
        ];

        if (window.location.protocol.startsWith('http') && window.location.hostname) {
            candidates.unshift(`${window.location.protocol}//${window.location.hostname}:3001/api/sync`);
        }

        return Array.from(new Set(candidates.map((value) => value.trim()).filter(Boolean)));
    }

    private buildTerminalConfigEndpointCandidates(context: { erpBaseUrl: string | null }): Array<{
        baseUrl: string;
        mode: string;
        includeErpBaseUrl: boolean;
    }> {
        const syncApiBase = this.resolveTerminalConfigSyncApiBase(context);
        const useAbsoluteEndpoint = this.shouldUseAbsoluteTerminalConfigEndpoint();

        if (!useAbsoluteEndpoint) {
            return [{
                baseUrl: '/api/sync',
                mode: 'relative-local-proxy',
                includeErpBaseUrl: true,
            }];
        }

        const erpCandidates = syncApiBase
            ? [{
                baseUrl: syncApiBase,
                mode: 'absolute-sync-api',
                includeErpBaseUrl: false,
            }]
            : [];

        const loopbackCandidates = this.resolveLocalSyncApiBaseCandidates().map((baseUrl) => ({
            baseUrl,
            mode: 'local-loopback-proxy',
            includeErpBaseUrl: true,
        }));

        return [...erpCandidates, ...loopbackCandidates];
    }

    /**
     * Helper: Check if debug mode for sync is enabled
     */
    private isDebugSync(): boolean {
        try {
            return window.location.search.includes('debug=sync') ||
                localStorage.getItem('CLIC_POS_DEBUG_SYNC') === 'true';
        } catch {
            return false;
        }
    }

    /**
     * Initialize sync manager
     */
    async initialize(config: BusinessConfig, terminalId: string) {
        // Ensure a device token exists for this browser instance
        this.ensureDeviceToken();
        this.initializedLocalTerminalId = terminalId;
        this.beginReadyToSellBootstrap('P0_INITIALIZE_SYNC_MANAGER');
        this.rehydrateOperationalTargetFromConfig(config, terminalId);

        // Detect Network Mode
        // NOTE: We allow SyncManager even in network mode for Master to manage terminals

        /*
        if (dbAdapter.adapterType === 'network') {
            console.log("🛑 SyncManager disabled: Application is running in full Network Mode (No local DB).");
            this.isDisabled = true;
            return;
        }
        */

        permissionService.initialize(config, terminalId);
        this.isMaster = permissionService.isMasterTerminal();

        // Get sync configuration from terminal config
        const terminal = (config.terminals || []).find(t => t.id === terminalId);
        let savedMasterUrl = localStorage.getItem('CLIC_POS_MASTER_URL');
        const runtimeMasterUrl = buildMasterUrlFromHost(window.location.hostname);

        const parseHostname = (url: string): string | null => {
            try {
                return new URL(url).hostname?.toLowerCase() || null;
            } catch {
                return null;
            }
        };
        const normalizeLegacyMasterInput = (value: string): string => {
            return value
                .trim()
                .replace(/^https?:\/\//i, '')
                .replace(/\/.*$/, '');
        };
        const buildMasterUrlFromLegacyInput = (value: string): string => {
            const normalized = normalizeLegacyMasterInput(value);
            if (!normalized) return runtimeMasterUrl;
            const [host, port] = normalized.split(':');
            const numericPort = Number(port);
            return buildMasterUrlFromHost(host, Number.isFinite(numericPort) && numericPort > 0 ? numericPort : 3001);
        };
        const normalizeStoredMasterUrl = (value: string): string => {
            try {
                const parsed = new URL(value);
                const numericPort = Number(parsed.port || 3001);
                return buildMasterUrlFromHost(parsed.hostname, Number.isFinite(numericPort) && numericPort > 0 ? numericPort : 3001, parsed.protocol);
            } catch {
                return buildMasterUrlFromLegacyInput(value);
            }
        };

        if (savedMasterUrl) {
            const normalizedSavedMasterUrl = normalizeStoredMasterUrl(savedMasterUrl);
            if (normalizedSavedMasterUrl && normalizedSavedMasterUrl !== savedMasterUrl) {
                console.warn(`⚠️ SyncManager: Normalizing stored master URL (${savedMasterUrl}) -> ${normalizedSavedMasterUrl}`);
                savedMasterUrl = normalizedSavedMasterUrl;
                localStorage.setItem('CLIC_POS_MASTER_URL', normalizedSavedMasterUrl);
            }
        }

        const runtimeHost = window.location.hostname.toLowerCase();
        const savedHost = savedMasterUrl ? parseHostname(savedMasterUrl) : null;
        const isSavedLoopback = savedHost === 'localhost' || savedHost === '127.0.0.1';
        const isRuntimeLoopback = runtimeHost === 'localhost' || runtimeHost === '127.0.0.1';

        // Master must always point to itself. Never reuse slave pointers.
        if (this.isMaster) {
            if (localStorage.getItem('pos_master_ip')) {
                localStorage.removeItem('pos_master_ip');
            }
            if (savedMasterUrl !== runtimeMasterUrl) {
                console.warn(`⚠️ SyncManager: MASTER overriding masterUrl (${savedMasterUrl || 'none'}) -> ${runtimeMasterUrl}`);
            }
            savedMasterUrl = runtimeMasterUrl;
            localStorage.setItem('CLIC_POS_MASTER_URL', runtimeMasterUrl);
        }

        // Master terminal must not keep localhost URL when running from a remote browser.
        if (this.isMaster && savedMasterUrl && isSavedLoopback && !isRuntimeLoopback) {
            console.warn(`⚠️ SyncManager: Replacing stale master URL (${savedMasterUrl}) with runtime host (${runtimeMasterUrl})`);
            savedMasterUrl = runtimeMasterUrl;
            localStorage.setItem('CLIC_POS_MASTER_URL', runtimeMasterUrl);
        }

        // Slave terminals: prefer explicit paired master IP over stale saved URL.
        if (!this.isMaster) {
            const legacyMasterIp = localStorage.getItem('pos_master_ip');
            if (legacyMasterIp) {
                const forcedSlaveMasterUrl = buildMasterUrlFromLegacyInput(legacyMasterIp);
                const forcedHost = parseHostname(forcedSlaveMasterUrl);
                const currentHost = savedMasterUrl ? parseHostname(savedMasterUrl) : null;
                if (!currentHost || !forcedHost || currentHost !== forcedHost) {
                    console.warn(
                        `⚠️ SyncManager: SLAVE overriding stale master URL (${savedMasterUrl || 'none'}) with paired master (${forcedSlaveMasterUrl})`
                    );
                    savedMasterUrl = forcedSlaveMasterUrl;
                    localStorage.setItem('CLIC_POS_MASTER_URL', forcedSlaveMasterUrl);
                }
            }
        }

        // Fallback: Check for 'pos_master_ip' (set by TerminalBindingScreen)
        if (!savedMasterUrl) {
            const legacyIp = localStorage.getItem('pos_master_ip');
            if (legacyIp) {
                savedMasterUrl = buildMasterUrlFromLegacyInput(legacyIp);
                console.log(`ℹ️ SyncManager: Inferred Master URL from IP: ${savedMasterUrl}`);
            }
        }

        // Slave safety: never keep loopback master URL when running from a remote host.
        if (!this.isMaster && savedMasterUrl) {
            const effectiveSavedHost = parseHostname(savedMasterUrl);
            const isEffectiveSavedLoopback = effectiveSavedHost === 'localhost' || effectiveSavedHost === '127.0.0.1';
            if (isEffectiveSavedLoopback && !isRuntimeLoopback) {
                console.warn(
                    `⚠️ SyncManager: SLAVE replacing loopback master URL (${savedMasterUrl}) with runtime host (${runtimeMasterUrl})`
                );
                savedMasterUrl = runtimeMasterUrl;
                localStorage.setItem('CLIC_POS_MASTER_URL', runtimeMasterUrl);
            }
        }

        // Last resort on slave: use runtime host as master URL if nothing is configured.
        if (!this.isMaster && !savedMasterUrl) {
            savedMasterUrl = runtimeMasterUrl;
            localStorage.setItem('CLIC_POS_MASTER_URL', runtimeMasterUrl);
        }

        this.syncConfig = terminal?.config.syncConfig || {
            mode: this.isMaster ? 'MASTER' : 'SLAVE',
            masterUrl: savedMasterUrl || undefined,
            autoSyncIntervalMs: 30000,
            isEnabled: true
        };

        // Override with saved URL if exists and not master
        if (savedMasterUrl && !this.isMaster) {
            this.syncConfig.masterUrl = savedMasterUrl;
        }

        // Initialize API sync adapter for slave terminals
        if (!this.isMaster && this.syncConfig.masterUrl) {
            try {
                await apiSyncAdapter.initialize({
                    masterUrl: this.syncConfig.masterUrl,
                    terminalId: terminalId,
                    autoRetry: true,
                    retryDelayMs: 5000
                });
                console.log(`🔄 SyncManager initialized in SLAVE mode, Master: ${this.syncConfig.masterUrl}`);
            } catch (error) {
                console.error('❌ Failed to initialize API sync adapter:', error);
            }
        } else if (this.isMaster) {
            // Master terminal: Authenticate with own server
            // Backend runs on port 3001 (Vite runs on 3000)
            const masterUrl = this.syncConfig.masterUrl || runtimeMasterUrl;

            // Ensure config has the URL for future reference
            if (!this.syncConfig.masterUrl) {
                this.syncConfig.masterUrl = masterUrl;
            }

            try {
                await apiSyncAdapter.initialize({
                    masterUrl,
                    terminalId: terminalId,
                    autoRetry: true, // Retry enabled for Master too, to handle server restarts
                    retryDelayMs: 5000
                });
                console.log(`🔄 SyncManager initialized in MASTER mode at ${masterUrl}`);
            } catch (error) {
                console.warn('⚠️  Master sync adapter initialization failed:', error);
            }
        }

        await this.loadSyncVersions();
        this.loadProductImageSyncState();

        if (!this.isMaster) {
            this.attachImageSyncReconnectHandler();
            window.setTimeout(() => {
                this.syncProductImages({
                    forceManifestCheck: this.productImageHashes.size === 0 || this.lastProductImageManifestVersion === 0
                }).catch((error) => {
                    console.warn('⚠️ Initial background image sync failed:', error);
                });
            }, 12000);
        } else {
            this.detachImageSyncReconnectHandler();
        }

        // If Master, try to refresh config from server only if local is totally missing 
        // or during specific recovery scenarios (like HTTPS switch).
        // WARNING: Avoid forcing pullConfig(true) unconditionally here as it triggers App.tsx re-init loops.
        if (this.isMaster) {
            try {
                const localConfig = await db.get('config');
                const hasValidLocalConfig = localConfig && !Array.isArray(localConfig) && Object.keys(localConfig).length > 0;

                if (!hasValidLocalConfig) {
                    console.log('🔄 SyncManager: Local Master config missing. Refreshing from server...');
                    await this.pullConfig(true);
                }
            } catch (configError) {
                console.warn('⚠️ SyncManager: Master config refresh failed during init:', configError);
            }
            if (apiSyncAdapter.isErpActiveOperationalTarget()) {
                void this.initializeMasterData().catch((error) => {
                    console.warn('⚠️ SyncManager: ERP startup master recovery deferred/failed:', error);
                });
            } else {
                await this.initializeMasterData();
            }
        }

        // Subscribe to connection restoration to relaunch recovery immediately
        apiSyncAdapter.setOnConnectionRestored(async () => {
            console.log('🔄 SyncManager: Connection restored, re-triggering recovery/sync...');
            await triggerErpSyncOutbox('connection_restored');
            if (this.isMaster) {
                await this.initializeMasterData();
            } else {
                const updates = await this.checkForUpdates();
                if (updates.length > 0) {
                    await this.syncAllCatalogs();
                }
            }
        });

        // Initialize Realtime Notifications (WebSocket triggers)
        if (this.syncConfig && this.syncConfig.isEnabled && this.syncConfig.masterUrl) {
            realtimeNotificationService
                .initialize(this.syncConfig.masterUrl, terminalId)
                .catch((error) => {
                    console.warn('⚠️ RealtimeNotificationService init failed:', error);
                });
        }

        // Performance: Purge old synced data on startup (Slave only)
        if (!this.isMaster) {
            this.purgeSyncedHistoricalData().catch(e => console.error('❌ SyncManager: Initial purge failed:', e));
        }

        if (apiSyncAdapter.isErpActiveOperationalTarget()) {
            void this.syncTerminalMastersOnStartup(config).catch((error) => {
                console.warn('⚠️ SyncManager: startup terminal manifest sync failed:', error);
                this.readyToSellState.failedOperations += 1;
                this.publishSyncHealthUpdate();
            });
        }

        console.log('🔄 SyncManager initialized');

        // Subscribe to connection loss to trigger auto-discovery
        if (!this.isMaster) {
            apiSyncAdapter.setOnConnectionLost(() => {
                console.warn('📡 SyncManager: Connection lost. Initiating Auto-Discovery...');
                this.startRecoveryProcess();
            });
            apiSyncAdapter.setOnConnectionLost(() => {
                console.warn('📡 SyncManager: Connection lost. Initiating Auto-Discovery...');
                this.startRecoveryProcess();
            });
        }

        this.isInitialized = true;
    }

    public async fastSyncCoreData(): Promise<void> {
        console.log('🚀 [AUTH_SYNC] Starting Fast Bootstrap Sync...');

        // Ensure valid token (Master doesn't need this flow usually, but good for consistency)
        this.ensureDeviceToken();

        // 1. Users (CRITICAL)
        console.log('🔄 [AUTH_SYNC] Downloading users...');
        await this.pullCatalog('users', true); // Force pull
        const users = await db.get('users');
        console.log(`✅ [AUTH_SYNC] Users received: ${Array.isArray(users) ? users.length : 0}`);

        if (!Array.isArray(users) || users.length === 0) {
            // Check if we got an error that suggests pairing issue?
            // For now just throw to trigger UI error
            throw new Error('Received 0 users from Master. Check device pairing.');
        }

        // 2. Roles
        console.log('🔄 [AUTH_SYNC] Downloading roles...');
        await this.pullCatalog('roles', true);

        // 3. Terminals (for identification)
        console.log('🔄 [AUTH_SYNC] Downloading terminals...');
        // SyncManager uses 'config' for terminals usually, but let's see if we can pull 'config'
        await this.pullConfig(true);

        console.log('✨ [AUTH_SYNC] Bootstrap Complete.');
    }

    private ensureDeviceToken() {
        const syncMode = String(localStorage.getItem('clic_sync_mode') || '').trim().toUpperCase();
        const invalidated = getInvalidatedSyncDeviceTokenInfo();
        const existing = resolveSyncDeviceToken();
        if (syncMode === 'POS_ERP' && (!existing.token || invalidated.invalidatedAt)) {
            console.warn('[SyncManager] ERP terminal requires register token; skipping LOCAL_GENERATED device token');
            return;
        }

        const result = ensureSyncDeviceToken(() => `dev_${uuidv4()}`);
        if (result.created) {
            console.log('🔑 SyncManager: Generated new Device Token');
        } else if (result.migratedFrom) {
            console.log(`🔑 SyncManager: Migrated legacy Device Token from ${result.migratedFrom}`);
        }
    }

    private sanitizeConfig(config: any): any {
        if (!config || typeof config !== 'object') return {};
        const { id, _db_initialized, config_metadata, _id, ...rest } = config;
        return rest;
    }

    private getPendingTerminalSnapshot(targetTerminalId: string | null, localTerminalId: string | null): any | null {
        try {
            const raw = localStorage.getItem('clic_pos_terminal_config_pending_snapshot');
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            const pendingErpTerminalId = typeof parsed?.erpTerminalId === 'string' ? parsed.erpTerminalId.trim() : '';
            const pendingLocalTerminalId = typeof parsed?.localTerminalId === 'string' ? parsed.localTerminalId.trim() : '';
            const snapshot = extractTerminalConfigSnapshot(parsed?.snapshot);
            if (!snapshot) return null;

            const matchesTarget =
                (targetTerminalId && pendingErpTerminalId && targetTerminalId === pendingErpTerminalId) ||
                (localTerminalId && pendingLocalTerminalId && localTerminalId === pendingLocalTerminalId) ||
                (!pendingErpTerminalId && !pendingLocalTerminalId);

            return matchesTarget ? snapshot : null;
        } catch (error) {
            console.warn('⚠️ No se pudo leer el snapshot pendiente de terminal:', error);
            return null;
        }
    }

    private clearPendingTerminalSnapshot() {
        localStorage.removeItem('clic_pos_terminal_config_pending_snapshot');
    }

    private getActiveTerminalContext(config?: BusinessConfig | null): {
        terminalId: string | null;
        localTerminalId: string | null;
        tenantId: string | null;
        erpBaseUrl: string | null;
        posDeviceId: string | null;
        bindingMode?: 'MASTER' | 'SLAVE';
    } {
        const activeTerminalId =
            localStorage.getItem('active_terminal_id') ||
            localStorage.getItem('CLIC_POS_TERMINAL_ID') ||
            this.initializedLocalTerminalId ||
            null;

        const currentTerminal = activeTerminalId && config?.terminals
            ? config.terminals.find((terminal) =>
                terminal.id === activeTerminalId ||
                terminal.config?.erpTerminalId === activeTerminalId ||
                terminal.config?.erpBinding?.terminalId === activeTerminalId
            )
            : null;

        const erpTerminalId =
            currentTerminal?.config?.erpBinding?.terminalId ||
            currentTerminal?.config?.erpTerminalId ||
            (looksLikeUuidString(currentTerminal?.id) ? currentTerminal?.id : null) ||
            localStorage.getItem('clic_erp_sync_terminal_id') ||
            activeTerminalId ||
            null;
        const activeTenantId =
            currentTerminal?.config?.erpBinding?.tenantId ||
            localStorage.getItem('clic_erp_sync_tenant_id') ||
            localStorage.getItem('active_tenant_id') ||
            localStorage.getItem('clic_tenant_id') ||
            null;
        const erpBaseUrl =
            this.resolveConfigErpBaseUrl(localStorage.getItem('CLIC_ERP_BASE_URL')) ||
            this.resolveConfigErpBaseUrl(localStorage.getItem('erp_base_url')) ||
            this.resolveConfigErpBaseUrl(localStorage.getItem('CLIC_ERP_SYNC_URL')) ||
            this.resolveConfigErpBaseUrl((import.meta as any)?.env?.VITE_ERP_BASE_URL) ||
            this.resolveConfigErpBaseUrl((import.meta as any)?.env?.VITE_ERP_SYNC_API_URL) ||
            this.resolveConfigErpBaseUrl((import.meta as any)?.env?.VITE_SYNC_API_URL) ||
            null;

        const posDeviceId =
            currentTerminal?.config?.currentDeviceId ||
            localStorage.getItem('CLIC_POS_DEVICE_ID') ||
            null;

        const bindingMode = currentTerminal
            ? (currentTerminal.config?.isPrimaryNode === false ? 'SLAVE' : 'MASTER')
            : undefined;

        return {
            terminalId: erpTerminalId,
            localTerminalId: activeTerminalId,
            tenantId: activeTenantId,
            erpBaseUrl,
            posDeviceId,
            bindingMode,
        };
    }

    private getCatalogCursorStorageKey(localTerminalId: string): string {
        return `clic_pos_terminal_catalog_cursor:${localTerminalId}`;
    }

    private getTerminalManifestCursorStorageKey(localTerminalId: string): string {
        return `clic_pos_terminal_manifest_cursor_map:${localTerminalId}`;
    }

    private getInventoryVersionStorageKey(localTerminalId: string): string {
        return `clic_pos_inventory_version:${localTerminalId}`;
    }

    private getPriceVersionStorageKey(localTerminalId: string): string {
        return `clic_pos_price_version:${localTerminalId}`;
    }

    private getStartupManifestSessionKey(localTerminalId: string): string {
        return `clic_pos_terminal_startup_manifest_synced:${localTerminalId}`;
    }

    private buildPosDeviceHeaders(deviceId: string | null | undefined): Record<string, string> {
        const resolvedDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';
        return resolvedDeviceId
            ? {
                'X-Device-Id': resolvedDeviceId,
                'X-POS-Device-Id': resolvedDeviceId,
            }
            : {};
    }

    private async buildTerminalEndpointError(
        response: Response,
        fallbackMessage: string,
        context?: { terminalId?: string | null; posDeviceId?: string | null }
    ): Promise<Error> {
        let payload: Record<string, any> | null = null;
        let detail = '';

        try {
            const clonedPayload = await response.clone().json();
            payload = clonedPayload && typeof clonedPayload === 'object' && !Array.isArray(clonedPayload)
                ? clonedPayload
                : null;
        } catch {
            // Fall back to text below.
        }

        if (payload) {
            const code = String(payload.code || '').trim().toUpperCase();
            if (response.status === 403 && code === 'DEVICE_SUPERSEDED') {
                dispatchDeviceRevoked({
                    reason: 'DEVICE_SUPERSEDED',
                    message: String(payload.message || '').trim() || DEVICE_SUPERSEDED_MESSAGE,
                    terminalId: context?.terminalId || payload.terminal_id || null,
                    previousDeviceId: context?.posDeviceId || null,
                    newDeviceId: payload.canonical_device_id || payload.new_device_id || null,
                    payload,
                });
            }

            detail = String(payload.message || payload.error || '').trim();
        }

        if (!detail) {
            detail = await response.text().catch(() => '');
        }

        return new Error(detail || fallbackMessage);
    }

    private readStoredCatalogCursor(localTerminalId: string | null): string | null {
        if (!localTerminalId) return null;
        const raw = localStorage.getItem(this.getCatalogCursorStorageKey(localTerminalId));
        const value = typeof raw === 'string' ? raw.trim() : '';
        return value || null;
    }

    private persistCatalogCursor(localTerminalId: string | null, cursor: unknown): void {
        if (!localTerminalId) return;
        const value = typeof cursor === 'string' ? cursor.trim() : '';
        const key = this.getCatalogCursorStorageKey(localTerminalId);
        if (value) {
            localStorage.setItem(key, value);
        } else {
            localStorage.removeItem(key);
        }
    }

    private normalizeVersionToken(value: unknown): string | null {
        if (typeof value === 'string') {
            return value.trim() || null;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value);
        }
        return null;
    }

    private readStoredInventoryVersion(localTerminalId: string | null): string | null {
        if (!localTerminalId) return null;
        return this.normalizeVersionToken(localStorage.getItem(this.getInventoryVersionStorageKey(localTerminalId)));
    }

    private readStoredPriceVersion(localTerminalId: string | null): string | null {
        if (!localTerminalId) return null;
        return this.normalizeVersionToken(localStorage.getItem(this.getPriceVersionStorageKey(localTerminalId)));
    }

    private persistInventoryVersion(localTerminalId: string | null, version: unknown): void {
        if (!localTerminalId) return;
        const normalized = this.normalizeVersionToken(version);
        if (normalized) {
            localStorage.setItem(this.getInventoryVersionStorageKey(localTerminalId), normalized);
        }
    }

    private persistPriceVersion(localTerminalId: string | null, version: unknown): void {
        if (!localTerminalId) return;
        const normalized = this.normalizeVersionToken(version);
        if (normalized) {
            localStorage.setItem(this.getPriceVersionStorageKey(localTerminalId), normalized);
        }
    }

    private incrementSyncTelemetry(metric: keyof SyncManager['readyToSellState']['syncTelemetry'], amount = 1): void {
        this.readyToSellState = {
            ...this.readyToSellState,
            syncTelemetry: {
                ...this.readyToSellState.syncTelemetry,
                [metric]: Number(this.readyToSellState.syncTelemetry[metric] || 0) + amount,
            },
        };
    }

    private estimateBlockBytesSaved(count: number | null | undefined, averageBytesPerRecord: number): number {
        const safeCount = Number(count);
        return Number.isFinite(safeCount) && safeCount > 0
            ? Math.round(safeCount * averageBytesPerRecord)
            : 0;
    }

    private recordSnapshotDiagnostics(source: string, diagnostics: TerminalSnapshotDiagnostics | null | undefined): void {
        if (!diagnostics) return;
        this.readyToSellState = {
            ...this.readyToSellState,
            snapshotSource: diagnostics.snapshotSource ? String(diagnostics.snapshotSource) : this.readyToSellState.snapshotSource,
            snapshotAgeMs: Number.isFinite(Number(diagnostics.snapshotAgeMs)) ? Number(diagnostics.snapshotAgeMs) : this.readyToSellState.snapshotAgeMs,
            snapshotVersionHash: diagnostics.snapshotVersionHash || this.readyToSellState.snapshotVersionHash,
        };
        posCatalogDebugLog('snapshot awareness', {
            source,
            snapshotSource: diagnostics.snapshotSource || null,
            snapshotAgeMs: diagnostics.snapshotAgeMs ?? null,
            snapshotVersionHash: diagnostics.snapshotVersionHash || null,
        });
        this.publishSyncHealthUpdate();
    }

    private readStoredTerminalCursorMap(localTerminalId: string | null): TerminalCursorMap {
        if (!localTerminalId) return {};

        const raw = localStorage.getItem(this.getTerminalManifestCursorStorageKey(localTerminalId));
        if (!raw) return {};

        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return {};
            }

            return {
                terminal: typeof parsed.terminal === 'string' ? parsed.terminal.trim() || null : null,
                items: typeof parsed.items === 'string' ? parsed.items.trim() || null : null,
                customers: typeof parsed.customers === 'string' ? parsed.customers.trim() || null : null,
                suppliers: typeof parsed.suppliers === 'string' ? parsed.suppliers.trim() || null : null,
                purchase_orders: typeof parsed.purchase_orders === 'string' ? parsed.purchase_orders.trim() || null : null,
                transfers: typeof parsed.transfers === 'string' ? parsed.transfers.trim() || null : null,
                inventory: typeof parsed.inventory === 'string' ? parsed.inventory.trim() || null : null,
                product_prices: typeof parsed.product_prices === 'string' ? parsed.product_prices.trim() || null : null,
            };
        } catch {
            return {};
        }
    }

    private persistTerminalCursorMap(localTerminalId: string | null, cursorMap: TerminalCursorMap | null | undefined): void {
        if (!localTerminalId || !cursorMap) return;

        const normalizedCursorMap: TerminalCursorMap = {
            terminal: typeof cursorMap.terminal === 'string' ? cursorMap.terminal.trim() || null : null,
            items: typeof cursorMap.items === 'string' ? cursorMap.items.trim() || null : null,
            customers: typeof cursorMap.customers === 'string' ? cursorMap.customers.trim() || null : null,
            suppliers: typeof cursorMap.suppliers === 'string' ? cursorMap.suppliers.trim() || null : null,
            purchase_orders: typeof cursorMap.purchase_orders === 'string' ? cursorMap.purchase_orders.trim() || null : null,
            transfers: typeof cursorMap.transfers === 'string' ? cursorMap.transfers.trim() || null : null,
            inventory: typeof cursorMap.inventory === 'string' ? cursorMap.inventory.trim() || null : null,
            product_prices: typeof cursorMap.product_prices === 'string' ? cursorMap.product_prices.trim() || null : null,
        };

        const hasValue = Object.values(normalizedCursorMap).some((value) => typeof value === 'string' && value.trim());
        const key = this.getTerminalManifestCursorStorageKey(localTerminalId);
        if (hasValue) {
            localStorage.setItem(key, JSON.stringify(normalizedCursorMap));
        } else {
            localStorage.removeItem(key);
        }
    }

    private wasStartupManifestSyncCompleted(localTerminalId: string | null): boolean {
        if (!localTerminalId) return false;
        return localStorage.getItem(this.getStartupManifestSessionKey(localTerminalId)) === 'true';
    }

    private markStartupManifestSyncCompleted(localTerminalId: string | null): void {
        if (!localTerminalId) return;
        localStorage.setItem(this.getStartupManifestSessionKey(localTerminalId), 'true');
    }

    private catalogDeleteCandidates(item: Record<string, unknown> | null | undefined): string[] {
        if (!item || typeof item !== 'object') return [];
        const rawCandidates = [
            item.id,
            item.sku,
            item.item_code,
            item.code,
            item.barcode,
        ];

        return Array.from(new Set(
            rawCandidates
                .map((value) => (typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : ''))
                .filter(Boolean)
        ));
    }

    private buildLocalProductLookupMaps(localProducts: Product[]): {
        localById: Map<string, Product>;
        localByBarcode: Map<string, Product>;
        localByCode: Map<string, Product>;
    } {
        const localById = new Map<string, Product>();
        const localByBarcode = new Map<string, Product>();
        const localByCode = new Map<string, Product>();

        for (const product of Array.isArray(localProducts) ? localProducts : []) {
            const localId = typeof product?.id === 'string' ? product.id.trim() : String(product?.id || '').trim();
            if (!localId) continue;

            localById.set(localId, product);

            const barcode = typeof product?.barcode === 'string' ? product.barcode.trim() : String(product?.barcode || '').trim();
            if (barcode && !localByBarcode.has(barcode)) {
                localByBarcode.set(barcode, product);
            }

            const codeCandidates = [
                localId,
                typeof (product as any)?.sku === 'string' ? (product as any).sku.trim() : String((product as any)?.sku || '').trim(),
                typeof (product as any)?.item_code === 'string' ? (product as any).item_code.trim() : String((product as any)?.item_code || '').trim(),
                typeof (product as any)?.code === 'string' ? (product as any).code.trim() : String((product as any)?.code || '').trim(),
                barcode,
            ].filter(Boolean);

            for (const code of codeCandidates) {
                if (!localByCode.has(code)) {
                    localByCode.set(code, product);
                }
            }
        }

        return { localById, localByBarcode, localByCode };
    }

    private buildLocalProductIdentityLookup(localProducts: Product[]): Map<string, Product> {
        const localByIdentity = new Map<string, Product>();

        for (const product of Array.isArray(localProducts) ? localProducts : []) {
            for (const candidate of productIdentityCandidates(product)) {
                if (!localByIdentity.has(candidate)) {
                    localByIdentity.set(candidate, product);
                }
            }
        }

        return localByIdentity;
    }

    private collectSnapshotProductAliasIds(product: Product): string[] {
        const canonicalProductId = typeof product?.id === 'string' ? product.id.trim() : String(product?.id || '').trim();
        return productIdentityCandidates(product).filter((candidate) => candidate !== canonicalProductId);
    }

    private reconcileCatalogProductIds(config: BusinessConfig, localProducts: Product[]): BusinessConfig {
        const hasGroups = Array.isArray(config?.productGroups) && config.productGroups.length > 0;
        const hasSeasons = Array.isArray(config?.seasons) && config.seasons.length > 0;
        if (!hasGroups && !hasSeasons) {
            return config;
        }

        const { localById, localByBarcode, localByCode } = this.buildLocalProductLookupMaps(localProducts);
        const resolveProductId = (value: unknown): string => {
            const raw = typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : '';
            if (!raw) return '';
            return localById.get(raw)?.id || localByCode.get(raw)?.id || localByBarcode.get(raw)?.id || raw;
        };
        const normalizeRefs = (values: unknown): string[] => Array.from(new Set(
            (Array.isArray(values) ? values : [])
                .map((entry) => resolveProductId(entry))
                .filter(Boolean)
        ));

        let changed = false;

        const nextGroups = hasGroups
            ? (config.productGroups || []).map((group) => {
                const normalizedProductIds = normalizeRefs(group?.productIds);
                const same =
                    normalizedProductIds.length === (group?.productIds || []).length &&
                    normalizedProductIds.every((value, index) => value === (group?.productIds || [])[index]);
                if (!same) changed = true;
                return same ? group : { ...group, productIds: normalizedProductIds };
            })
            : config.productGroups;

        const nextSeasons = hasSeasons
            ? (config.seasons || []).map((season) => {
                const normalizedProductIds = normalizeRefs(season?.productIds);
                const same =
                    normalizedProductIds.length === (season?.productIds || []).length &&
                    normalizedProductIds.every((value, index) => value === (season?.productIds || [])[index]);
                if (!same) changed = true;
                return same ? season : { ...season, productIds: normalizedProductIds };
            })
            : config.seasons;

        if (!changed) {
            return config;
        }

        return {
            ...config,
            productGroups: nextGroups,
            seasons: nextSeasons,
        };
    }

    private normalizeTerminalManifestPayload(payload: unknown): TerminalManifestPayload | null {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return null;
        }

        const record = payload as Record<string, any>;
        const manifest = record.manifest && typeof record.manifest === 'object' && !Array.isArray(record.manifest)
            ? record.manifest as Record<string, any>
            : record;
        const cursorMap = manifest.cursor_map && typeof manifest.cursor_map === 'object' && !Array.isArray(manifest.cursor_map)
            ? manifest.cursor_map as Record<string, any>
            : {};
        const changed = manifest.changed && typeof manifest.changed === 'object' && !Array.isArray(manifest.changed)
            ? manifest.changed as Record<string, any>
            : {};
        const counts = manifest.counts && typeof manifest.counts === 'object' && !Array.isArray(manifest.counts)
            ? manifest.counts as Record<string, any>
            : {};
        const versions = manifest.versions && typeof manifest.versions === 'object' && !Array.isArray(manifest.versions)
            ? manifest.versions as Record<string, any>
            : {};
        const inventoryMeta = manifest.inventory && typeof manifest.inventory === 'object' && !Array.isArray(manifest.inventory)
            ? manifest.inventory as Record<string, any>
            : {};
        const productPricesMeta = manifest.product_prices && typeof manifest.product_prices === 'object' && !Array.isArray(manifest.product_prices)
            ? manifest.product_prices as Record<string, any>
            : {};
        const cacheMeta = manifest.cache && typeof manifest.cache === 'object' && !Array.isArray(manifest.cache)
            ? manifest.cache as Record<string, any>
            : {};
        const snapshotMeta = manifest.snapshot_meta && typeof manifest.snapshot_meta === 'object' && !Array.isArray(manifest.snapshot_meta)
            ? manifest.snapshot_meta as Record<string, any>
            : manifest.snapshot && typeof manifest.snapshot === 'object' && !Array.isArray(manifest.snapshot)
                ? manifest.snapshot as Record<string, any>
                : {};
        const domainHashes = manifest.domain_hashes && typeof manifest.domain_hashes === 'object' && !Array.isArray(manifest.domain_hashes)
            ? manifest.domain_hashes as Record<string, any>
            : manifest.hashes && typeof manifest.hashes === 'object' && !Array.isArray(manifest.hashes)
                ? manifest.hashes as Record<string, any>
                : {};
        const normalizeScope = (scope: unknown): TerminalManifestScope | null => {
            const token = typeof scope === 'string'
                ? scope.trim().toLowerCase().replace(/[\s-]+/g, '_')
                : '';
            if (!token) return null;
            if (['inventory', 'inventories', 'inventory_stock', 'inventory_stocks', 'stock', 'stocks', 'stock_balance', 'stock_balances'].includes(token)) {
                return 'inventory';
            }
            if (['product_price', 'product_prices', 'price', 'prices', 'tariff', 'tariffs', 'tarifa', 'tarifas'].includes(token)) {
                return 'product_prices';
            }
            return ['terminal', 'items', 'customers', 'suppliers', 'sellers', 'purchase_orders', 'transfers'].includes(token)
                ? token as TerminalManifestScope
                : null;
        };
        const readCursor = (...keys: string[]): string | null => {
            for (const key of keys) {
                const value = cursorMap[key];
                if (typeof value === 'string' && value.trim()) return value.trim();
            }
            return null;
        };
        const readBoolean = (...keys: string[]): boolean => keys.some((key) => Boolean(changed[key]));
        const readCount = (...keys: string[]): number => {
            for (const key of keys) {
                const value = Number(counts[key]);
                if (Number.isFinite(value)) return value;
            }
            return 0;
        };
        const readVersion = (...values: unknown[]): string | null => {
            for (const value of values) {
                const normalized = this.normalizeVersionToken(value);
                if (normalized) return normalized;
            }
            return null;
        };
        const readHash = (...keys: string[]): string | null => {
            for (const key of keys) {
                const value = domainHashes[key];
                if (typeof value === 'string' && value.trim()) return value.trim();
            }
            return null;
        };
        const diagnostics: TerminalSnapshotDiagnostics = {
            snapshotSource: readVersion(
                snapshotMeta.source,
                snapshotMeta.snapshot_source,
                cacheMeta.source,
                cacheMeta.snapshot_source,
                manifest.persistent_snapshot ? 'persistent' : null,
            ),
            snapshotAgeMs: Number.isFinite(Number(snapshotMeta.age_ms ?? snapshotMeta.snapshot_age_ms ?? cacheMeta.age_ms))
                ? Number(snapshotMeta.age_ms ?? snapshotMeta.snapshot_age_ms ?? cacheMeta.age_ms)
                : null,
            snapshotVersionHash: readVersion(
                snapshotMeta.version_hash,
                snapshotMeta.snapshot_version_hash,
                snapshotMeta.hash,
                cacheMeta.version_hash,
                cacheMeta.hash,
            ),
        };

        return {
            cursor_map: {
                terminal: readCursor('terminal'),
                items: readCursor('items'),
                customers: readCursor('customers'),
                suppliers: readCursor('suppliers'),
                purchase_orders: readCursor('purchase_orders', 'purchaseOrders'),
                transfers: readCursor('transfers'),
                inventory: readCursor('inventory', 'stock', 'stocks', 'stock_balances', 'inventory_stock'),
                product_prices: readCursor('product_prices', 'productPrices', 'prices', 'tariffs', 'tarifas'),
            },
            changed: {
                terminal: readBoolean('terminal'),
                items: readBoolean('items'),
                customers: readBoolean('customers'),
                suppliers: readBoolean('suppliers'),
                purchase_orders: readBoolean('purchase_orders', 'purchaseOrders'),
                transfers: readBoolean('transfers'),
                inventory: readBoolean('inventory', 'stock', 'stocks', 'stock_balances', 'inventory_stock'),
                product_prices: readBoolean('product_prices', 'productPrices', 'prices', 'tariffs', 'tarifas'),
            },
            changed_blocks: Array.isArray(manifest.changed_blocks)
                ? manifest.changed_blocks
                    .map((scope: unknown) => normalizeScope(scope))
                    .filter((scope: TerminalManifestScope | null): scope is TerminalManifestScope => Boolean(scope))
                : [],
            counts: {
                items: readCount('items'),
                customers: readCount('customers'),
                suppliers: readCount('suppliers'),
                purchase_orders: readCount('purchase_orders', 'purchaseOrders'),
                transfers: readCount('transfers'),
                inventory: readCount('inventory', 'stock', 'stocks', 'stock_balances', 'inventory_stock'),
                product_prices: readCount('product_prices', 'productPrices', 'prices', 'tariffs', 'tarifas'),
            },
            snapshot_at: typeof manifest.snapshot_at === 'string' ? manifest.snapshot_at.trim() || null : null,
            inventory_version: readVersion(
                manifest.inventory_version,
                manifest.inventoryVersion,
                versions.inventory,
                versions.inventory_version,
                inventoryMeta.version,
                inventoryMeta.inventory_version,
                inventoryMeta.inventoryVersion,
            ),
            price_version: readVersion(
                manifest.price_version,
                manifest.priceVersion,
                manifest.product_prices_version,
                manifest.productPricesVersion,
                versions.price,
                versions.price_version,
                versions.product_prices,
                versions.product_prices_version,
                productPricesMeta.version,
                productPricesMeta.price_version,
                productPricesMeta.product_prices_version,
            ),
            domain_hashes: {
                inventory: readHash('inventory', 'stock', 'stocks', 'stock_balances', 'inventory_stock'),
                product_prices: readHash('product_prices', 'productPrices', 'prices', 'tariffs', 'tarifas'),
            },
            snapshot_meta: diagnostics.snapshotSource || diagnostics.snapshotAgeMs != null || diagnostics.snapshotVersionHash
                ? diagnostics
                : null,
        };
    }

    private async fetchTerminalEndpoint(endpoint: string, headers: Record<string, string>): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 12000);
        try {
            return await fetch(endpoint, {
                headers,
                signal: controller.signal,
            });
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    private async fetchTerminalManifest(context: {
        terminalId: string | null;
        localTerminalId: string | null;
        tenantId: string | null;
        erpBaseUrl: string | null;
        posDeviceId: string | null;
    }, cursorMap: TerminalCursorMap): Promise<TerminalManifestPayload | null> {
        if (!context.terminalId || !context.tenantId) {
            return null;
        }

        const endpointCandidates = this.buildTerminalConfigEndpointCandidates(context);

        let lastError: unknown = null;

        for (const endpointCandidate of endpointCandidates) {
            const startedAt = posCatalogDebugNow();
            const params = new URLSearchParams();
            params.set('tenant_id', context.tenantId);
            params.set('terminal_id', context.terminalId);
            if (endpointCandidate.includeErpBaseUrl && context.erpBaseUrl) params.set('erp_base_url', context.erpBaseUrl);
            if (context.posDeviceId) params.set('pos_device_id', context.posDeviceId);
            if (context.posDeviceId) params.set('device_id', context.posDeviceId);
            if (context.localTerminalId) params.set('local_terminal_id', context.localTerminalId);
            if (cursorMap.terminal) params.set('terminal_cursor', cursorMap.terminal);
            if (cursorMap.items) params.set('items_cursor', cursorMap.items);
            if (cursorMap.customers) params.set('customers_cursor', cursorMap.customers);
            if (cursorMap.suppliers) params.set('suppliers_cursor', cursorMap.suppliers);
            if (cursorMap.purchase_orders) params.set('purchase_orders_cursor', cursorMap.purchase_orders);
            if (cursorMap.transfers) params.set('transfers_cursor', cursorMap.transfers);
            if (cursorMap.inventory) params.set('inventory_cursor', cursorMap.inventory);
            if (cursorMap.product_prices) params.set('product_prices_cursor', cursorMap.product_prices);

            try {
                const endpointPath = `/terminals/${encodeURIComponent(context.terminalId)}/manifest`;
                const endpoint = `${endpointCandidate.baseUrl}${endpointPath}?${params.toString()}`;
                posCatalogDebugLog('startup manifest: fetch begin', {
                    endpoint,
                    endpointMode: endpointCandidate.mode,
                });

                const response = await this.fetchTerminalEndpoint(
                    endpoint,
                    {
                        Accept: 'application/json',
                        ...this.buildPosDeviceHeaders(context.posDeviceId),
                    }
                );

                if (!response.ok) {
                    throw await this.buildTerminalEndpointError(
                        response,
                        `No se pudo consultar el manifest de maestros (${response.status}).`,
                        { terminalId: context.terminalId, posDeviceId: context.posDeviceId },
                    );
                }

                const payload = await response.json();
                const normalizedManifest = this.normalizeTerminalManifestPayload(payload);
                posCatalogDebugLog('startup manifest: fetch success', {
                    endpointMode: endpointCandidate.mode,
                    elapsedMs: posCatalogDebugElapsedMs(startedAt),
                    changed: normalizedManifest?.changed || null,
                    changedBlocks: normalizedManifest?.changed_blocks || null,
                    counts: normalizedManifest?.counts || null,
                });
                return normalizedManifest;
            } catch (error) {
                lastError = error;
                posCatalogDebugLog('startup manifest: fetch failed', {
                    endpointMode: endpointCandidate.mode,
                    endpointBaseUrl: endpointCandidate.baseUrl,
                    elapsedMs: posCatalogDebugElapsedMs(startedAt),
                    error: String((error as Error)?.message || error),
                });
            }
        }

        if (lastError) {
            throw lastError;
        }

        return null;
    }

    private async fetchTerminalInventoryBlock(context: {
        terminalId: string | null;
        localTerminalId: string | null;
        tenantId: string | null;
        erpBaseUrl: string | null;
        posDeviceId: string | null;
    }, cursor: string | null): Promise<TerminalInventoryPayload | null> {
        if (!context.terminalId || !context.tenantId) {
            return null;
        }

        const endpointCandidates = this.buildTerminalConfigEndpointCandidates(context);

        let lastError: unknown = null;

        for (const endpointCandidate of endpointCandidates) {
            const startedAt = posCatalogDebugNow();
            const params = new URLSearchParams();
            params.set('tenant_id', context.tenantId);
            params.set('terminal_id', context.terminalId);
            if (endpointCandidate.includeErpBaseUrl && context.erpBaseUrl) params.set('erp_base_url', context.erpBaseUrl);
            if (context.posDeviceId) params.set('pos_device_id', context.posDeviceId);
            if (context.posDeviceId) params.set('device_id', context.posDeviceId);
            if (context.localTerminalId) params.set('local_terminal_id', context.localTerminalId);
            if (cursor) params.set('inventory_cursor', cursor);

            try {
                const endpointPath = `/terminals/${encodeURIComponent(context.terminalId)}/inventory`;
                const endpoint = `${endpointCandidate.baseUrl}${endpointPath}?${params.toString()}`;
                posCatalogDebugLog('inventory block: fetch begin', {
                    endpoint,
                    endpointMode: endpointCandidate.mode,
                    inventoryCursorSent: cursor,
                });

                const response = await this.fetchTerminalEndpoint(
                    endpoint,
                    {
                        Accept: 'application/json',
                        ...this.buildPosDeviceHeaders(context.posDeviceId),
                    }
                );

                if (!response.ok) {
                    throw await this.buildTerminalEndpointError(
                        response,
                        `No se pudo consultar el bloque inventory (${response.status}).`,
                        { terminalId: context.terminalId, posDeviceId: context.posDeviceId },
                    );
                }

                const payload = await response.json();
                const root = payload && typeof payload === 'object' && !Array.isArray(payload)
                    ? payload as Record<string, any>
                    : {};
                const inventory = root.inventory && typeof root.inventory === 'object' && !Array.isArray(root.inventory)
                    ? root.inventory as Record<string, any>
                    : {};
                const snapshotMeta = root.snapshot_meta && typeof root.snapshot_meta === 'object' && !Array.isArray(root.snapshot_meta)
                    ? root.snapshot_meta as Record<string, any>
                    : inventory.snapshot_meta && typeof inventory.snapshot_meta === 'object' && !Array.isArray(inventory.snapshot_meta)
                        ? inventory.snapshot_meta as Record<string, any>
                        : root.snapshot && typeof root.snapshot === 'object' && !Array.isArray(root.snapshot)
                            ? root.snapshot as Record<string, any>
                            : {};
                const cacheMeta = root.cache && typeof root.cache === 'object' && !Array.isArray(root.cache)
                    ? root.cache as Record<string, any>
                    : inventory.cache && typeof inventory.cache === 'object' && !Array.isArray(inventory.cache)
                        ? inventory.cache as Record<string, any>
                        : {};
                const snapshotDiagnostics: TerminalSnapshotDiagnostics = {
                    snapshotSource: this.normalizeVersionToken(snapshotMeta.source)
                        || this.normalizeVersionToken(snapshotMeta.snapshot_source)
                        || this.normalizeVersionToken(cacheMeta.source)
                        || (root.persistent_snapshot || inventory.persistent_snapshot ? 'persistent' : null),
                    snapshotAgeMs: Number.isFinite(Number(snapshotMeta.age_ms ?? snapshotMeta.snapshot_age_ms ?? cacheMeta.age_ms))
                        ? Number(snapshotMeta.age_ms ?? snapshotMeta.snapshot_age_ms ?? cacheMeta.age_ms)
                        : null,
                    snapshotVersionHash: this.normalizeVersionToken(snapshotMeta.version_hash)
                        || this.normalizeVersionToken(snapshotMeta.snapshot_version_hash)
                        || this.normalizeVersionToken(snapshotMeta.hash)
                        || this.normalizeVersionToken(cacheMeta.version_hash)
                        || this.normalizeVersionToken(cacheMeta.hash),
                };
                const normalizedPayload: TerminalInventoryPayload = {
                    cursor:
                        typeof inventory.cursor === 'string'
                            ? inventory.cursor.trim() || null
                            : typeof root.cursor === 'string'
                                ? root.cursor.trim() || null
                                : null,
                    balances:
                        Array.isArray(inventory.balances)
                            ? inventory.balances as TerminalInventoryBalancePayload[]
                            : Array.isArray(inventory.stock_balances)
                                ? inventory.stock_balances as TerminalInventoryBalancePayload[]
                                : Array.isArray(inventory.stockBalances)
                                    ? inventory.stockBalances as TerminalInventoryBalancePayload[]
                            : Array.isArray(root.balances)
                                ? root.balances as TerminalInventoryBalancePayload[]
                                : Array.isArray(root.stock_balances)
                                    ? root.stock_balances as TerminalInventoryBalancePayload[]
                                    : Array.isArray(root.stockBalances)
                                        ? root.stockBalances as TerminalInventoryBalancePayload[]
                                : [],
                    has_changes:
                        typeof inventory.has_changes === 'boolean'
                            ? inventory.has_changes
                            : typeof root.has_changes === 'boolean'
                                ? root.has_changes
                                : true,
                    inventory_version: this.normalizeVersionToken(root.inventory_version)
                        || this.normalizeVersionToken(root.inventoryVersion)
                        || this.normalizeVersionToken(inventory.inventory_version)
                        || this.normalizeVersionToken(inventory.inventoryVersion)
                        || this.normalizeVersionToken(inventory.version),
                    snapshot_meta: snapshotDiagnostics.snapshotSource || snapshotDiagnostics.snapshotAgeMs != null || snapshotDiagnostics.snapshotVersionHash
                        ? snapshotDiagnostics
                        : null,
                };

                posCatalogDebugLog('inventory block: fetch success', {
                    endpointMode: endpointCandidate.mode,
                    elapsedMs: posCatalogDebugElapsedMs(startedAt),
                    balanceCount: normalizedPayload.balances?.length || 0,
                    hasChanges: normalizedPayload.has_changes,
                    cursor: normalizedPayload.cursor,
                    inventoryVersion: normalizedPayload.inventory_version || null,
                    snapshotMeta: normalizedPayload.snapshot_meta || null,
                });

                return normalizedPayload;
            } catch (error) {
                lastError = error;
                posCatalogDebugLog('inventory block: fetch failed', {
                    endpointMode: endpointCandidate.mode,
                    endpointBaseUrl: endpointCandidate.baseUrl,
                    elapsedMs: posCatalogDebugElapsedMs(startedAt),
                    error: String((error as Error)?.message || error),
                });
            }
        }

        if (lastError) {
            throw lastError;
        }

        return null;
    }

    private async fetchTerminalProductPricesBlock(context: {
        terminalId: string | null;
        localTerminalId: string | null;
        tenantId: string | null;
        erpBaseUrl: string | null;
        posDeviceId: string | null;
    }, cursor: string | null): Promise<TerminalProductPricesPayload | null> {
        if (!context.terminalId || !context.tenantId) {
            return null;
        }

        const endpointCandidates = this.buildTerminalConfigEndpointCandidates(context);

        let lastError: unknown = null;

        for (const endpointCandidate of endpointCandidates) {
            const startedAt = posCatalogDebugNow();
            const params = new URLSearchParams();
            params.set('tenant_id', context.tenantId);
            params.set('terminal_id', context.terminalId);
            if (endpointCandidate.includeErpBaseUrl && context.erpBaseUrl) params.set('erp_base_url', context.erpBaseUrl);
            if (context.posDeviceId) params.set('pos_device_id', context.posDeviceId);
            if (context.posDeviceId) params.set('device_id', context.posDeviceId);
            if (context.localTerminalId) params.set('local_terminal_id', context.localTerminalId);
            if (cursor) params.set('product_prices_cursor', cursor);

            try {
                const endpointPath = `/terminals/${encodeURIComponent(context.terminalId)}/product-prices`;
                const endpoint = `${endpointCandidate.baseUrl}${endpointPath}?${params.toString()}`;
                posCatalogDebugLog('product prices block: fetch begin', {
                    endpoint,
                    endpointMode: endpointCandidate.mode,
                    productPricesCursorSent: cursor,
                });

                const response = await this.fetchTerminalEndpoint(
                    endpoint,
                    {
                        Accept: 'application/json',
                        ...this.buildPosDeviceHeaders(context.posDeviceId),
                    }
                );

                if (!response.ok) {
                    throw await this.buildTerminalEndpointError(
                        response,
                        `No se pudo consultar el bloque product_prices (${response.status}).`,
                        { terminalId: context.terminalId, posDeviceId: context.posDeviceId },
                    );
                }

                const payload = await response.json();
                const root = payload && typeof payload === 'object' && !Array.isArray(payload)
                    ? payload as Record<string, any>
                    : {};
                const productPrices = root.product_prices && typeof root.product_prices === 'object' && !Array.isArray(root.product_prices)
                    ? root.product_prices as Record<string, any>
                    : {};
                const snapshotMeta = root.snapshot_meta && typeof root.snapshot_meta === 'object' && !Array.isArray(root.snapshot_meta)
                    ? root.snapshot_meta as Record<string, any>
                    : productPrices.snapshot_meta && typeof productPrices.snapshot_meta === 'object' && !Array.isArray(productPrices.snapshot_meta)
                        ? productPrices.snapshot_meta as Record<string, any>
                        : root.snapshot && typeof root.snapshot === 'object' && !Array.isArray(root.snapshot)
                            ? root.snapshot as Record<string, any>
                            : {};
                const cacheMeta = root.cache && typeof root.cache === 'object' && !Array.isArray(root.cache)
                    ? root.cache as Record<string, any>
                    : productPrices.cache && typeof productPrices.cache === 'object' && !Array.isArray(productPrices.cache)
                        ? productPrices.cache as Record<string, any>
                        : {};
                const snapshotDiagnostics: TerminalSnapshotDiagnostics = {
                    snapshotSource: this.normalizeVersionToken(snapshotMeta.source)
                        || this.normalizeVersionToken(snapshotMeta.snapshot_source)
                        || this.normalizeVersionToken(cacheMeta.source)
                        || (root.persistent_snapshot || productPrices.persistent_snapshot ? 'persistent' : null),
                    snapshotAgeMs: Number.isFinite(Number(snapshotMeta.age_ms ?? snapshotMeta.snapshot_age_ms ?? cacheMeta.age_ms))
                        ? Number(snapshotMeta.age_ms ?? snapshotMeta.snapshot_age_ms ?? cacheMeta.age_ms)
                        : null,
                    snapshotVersionHash: this.normalizeVersionToken(snapshotMeta.version_hash)
                        || this.normalizeVersionToken(snapshotMeta.snapshot_version_hash)
                        || this.normalizeVersionToken(snapshotMeta.hash)
                        || this.normalizeVersionToken(cacheMeta.version_hash)
                        || this.normalizeVersionToken(cacheMeta.hash),
                };
                const normalizedPayload: TerminalProductPricesPayload = {
                    cursor:
                        typeof productPrices.cursor === 'string'
                            ? productPrices.cursor.trim() || null
                            : typeof root.cursor === 'string'
                                ? root.cursor.trim() || null
                                : null,
                    prices:
                        Array.isArray(productPrices.prices)
                            ? productPrices.prices as TerminalProductPricePayload[]
                            : Array.isArray(root.prices)
                                ? root.prices as TerminalProductPricePayload[]
                                : [],
                    has_changes:
                        typeof productPrices.has_changes === 'boolean'
                            ? productPrices.has_changes
                            : typeof root.has_changes === 'boolean'
                                ? root.has_changes
                                : true,
                    price_version: this.normalizeVersionToken(root.price_version)
                        || this.normalizeVersionToken(root.priceVersion)
                        || this.normalizeVersionToken(root.product_prices_version)
                        || this.normalizeVersionToken(root.productPricesVersion)
                        || this.normalizeVersionToken(productPrices.price_version)
                        || this.normalizeVersionToken(productPrices.product_prices_version)
                        || this.normalizeVersionToken(productPrices.version),
                    snapshot_meta: snapshotDiagnostics.snapshotSource || snapshotDiagnostics.snapshotAgeMs != null || snapshotDiagnostics.snapshotVersionHash
                        ? snapshotDiagnostics
                        : null,
                };

                posCatalogDebugLog('product prices block: fetch success', {
                    endpointMode: endpointCandidate.mode,
                    elapsedMs: posCatalogDebugElapsedMs(startedAt),
                    priceCount: normalizedPayload.prices?.length || 0,
                    hasChanges: normalizedPayload.has_changes,
                    cursor: normalizedPayload.cursor,
                    priceVersion: normalizedPayload.price_version || null,
                    snapshotMeta: normalizedPayload.snapshot_meta || null,
                });

                return normalizedPayload;
            } catch (error) {
                lastError = error;
                posCatalogDebugLog('product prices block: fetch failed', {
                    endpointMode: endpointCandidate.mode,
                    endpointBaseUrl: endpointCandidate.baseUrl,
                    elapsedMs: posCatalogDebugElapsedMs(startedAt),
                    error: String((error as Error)?.message || error),
                });
            }
        }

        if (lastError) {
            throw lastError;
        }

        return null;
    }

    private async reconcileTerminalManifest(
        baseConfig: BusinessConfig | null,
        options?: {
            skipIfStartupCompleted?: boolean;
            markStartupCompleted?: boolean;
            bootstrapBlocks?: boolean;
        }
    ): Promise<BusinessConfig | null> {
        if (this.isDisabled || this.terminalManifestSyncInFlight || !navigator.onLine) {
            return null;
        }

        const context = this.getActiveTerminalContext(baseConfig);
        const localTerminalId = context.localTerminalId || context.terminalId;
        if (!context.terminalId || !localTerminalId || !context.tenantId) {
            return null;
        }

        if (protectsLocalCatalogFromCloud()) {
            if (options?.markStartupCompleted) {
                this.markStartupManifestSyncCompleted(localTerminalId);
            }
            console.warn('[SYNC_ROUTER] POS_CLOUD_STAGING manifest sync skipped; local catalog remains authoritative.');
            return null;
        }

        const currentTerminalConfig = context.localTerminalId || context.terminalId
            ? baseConfig?.terminals?.find((terminal) =>
                terminal.id === context.localTerminalId ||
                terminal.id === context.terminalId ||
                terminal.config?.erpTerminalId === context.terminalId ||
                terminal.config?.erpBinding?.terminalId === context.terminalId
            )?.config
            : null;
        const preflightProductGroups = Array.isArray(baseConfig?.productGroups)
            ? baseConfig.productGroups
            : [];
        const preflightTerminalAllowedCategories = Array.isArray(currentTerminalConfig?.catalog?.allowedCategories)
            ? currentTerminalConfig.catalog.allowedCategories
            : [];
        const shouldBypassCompletedManifestSkipForCatalog = Boolean(
            apiSyncAdapter.isErpActiveOperationalTarget() &&
            preflightProductGroups.length === 0 &&
            preflightTerminalAllowedCategories.length === 0
        );

        if (options?.skipIfStartupCompleted && this.wasStartupManifestSyncCompleted(localTerminalId) && !shouldBypassCompletedManifestSkipForCatalog) {
            return null;
        }

        this.terminalManifestSyncInFlight = true;

        try {
            const storedCursorMap = this.readStoredTerminalCursorMap(localTerminalId);
            const localInventoryVersion = this.readStoredInventoryVersion(localTerminalId);
            const localPriceVersion = this.readStoredPriceVersion(localTerminalId);
            const manifest = await this.fetchTerminalManifest(context, storedCursorMap);
            if (!manifest?.cursor_map || !manifest.changed) {
                return null;
            }
            this.recordSnapshotDiagnostics('manifest', manifest.snapshot_meta);

            const changedMasterScopes: TerminalManifestMasterScope[] = (['items', 'customers', 'suppliers', 'sellers', 'users', 'pos_users', 'roles', 'pos_roles', 'purchase_orders', 'transfers'] as TerminalManifestMasterScope[])
                .filter((scope) => manifest.changed?.[scope]);
            const changedBlocks = Array.isArray(manifest.changed_blocks) ? manifest.changed_blocks : [];
            const inventoryChanged = Boolean(manifest.changed.inventory) || changedBlocks.includes('inventory');
            const productPricesChanged = Boolean(manifest.changed.product_prices) || changedBlocks.includes('product_prices');
            const remoteInventoryVersion = this.normalizeVersionToken(manifest.inventory_version);
            const remotePriceVersion = this.normalizeVersionToken(manifest.price_version);
            const inventoryVersionComparable = Boolean(localInventoryVersion && remoteInventoryVersion);
            const priceVersionComparable = Boolean(localPriceVersion && remotePriceVersion);
            const inventoryVersionMatch = inventoryVersionComparable
                ? localInventoryVersion === remoteInventoryVersion
                : null;
            const priceVersionMatch = priceVersionComparable
                ? localPriceVersion === remotePriceVersion
                : null;
            const forceFullBootstrap = Boolean(
                options?.bootstrapBlocks ||
                (manifest as any).forceFullBootstrap ||
                (manifest as any).force_full_bootstrap ||
                (manifest as any).fullBootstrapRequired ||
                (manifest as any).full_bootstrap_required
            );
            const terminalChanged = Boolean(manifest.changed.terminal);
            const bootstrapInventoryOnStartup = Boolean(forceFullBootstrap || !storedCursorMap.inventory);
            const bootstrapProductPricesOnStartup = Boolean(forceFullBootstrap || !storedCursorMap.product_prices);
            const inventorySyncSkippedByVersion = Boolean(!bootstrapInventoryOnStartup && inventoryVersionMatch === true);
            const priceSyncSkippedByVersion = Boolean(!bootstrapProductPricesOnStartup && priceVersionMatch === true);
            const inventoryVersionMiss = Boolean(remoteInventoryVersion && localInventoryVersion && remoteInventoryVersion !== localInventoryVersion);
            const priceVersionMiss = Boolean(remotePriceVersion && localPriceVersion && remotePriceVersion !== localPriceVersion);
            const persistedInternalSequences = ((await db.get('internalSequences')) as DocumentSeries[]) || [];
            const persistedTerminalSeries = Array.isArray(currentTerminalConfig?.documentSeries)
                ? currentTerminalConfig.documentSeries
                : [];
            const hasErpTerminalConfigDocumentSeries = [...persistedInternalSequences, ...persistedTerminalSeries]
                .some((series: any) => String(series?.source || '').toUpperCase() === 'ERP_TERMINAL_CONFIG');
            const requiresDocumentSeriesConfigFetch = Boolean(
                apiSyncAdapter.isErpActiveOperationalTarget() &&
                !hasErpTerminalConfigDocumentSeries
            );
            const persistedProductGroups = Array.isArray(baseConfig?.productGroups)
                ? baseConfig.productGroups
                : [];
            const persistedTerminalAllowedCategories = Array.isArray(currentTerminalConfig?.catalog?.allowedCategories)
                ? currentTerminalConfig.catalog.allowedCategories
                : [];
            const persistedDepartments = Array.isArray(baseConfig?.departments) ? baseConfig.departments : [];
            const persistedSections = Array.isArray(baseConfig?.sections) ? baseConfig.sections : [];
            const persistedFamilies = Array.isArray(baseConfig?.families) ? baseConfig.families : [];
            const persistedSubfamilies = Array.isArray(baseConfig?.subfamilies) ? baseConfig.subfamilies : [];
            const persistedBrands = Array.isArray(baseConfig?.brands) ? baseConfig.brands : [];
            const missingCommercialClassifications =
                persistedDepartments.length === 0 ||
                persistedSections.length === 0 ||
                persistedFamilies.length === 0 ||
                persistedSubfamilies.length === 0 ||
                persistedBrands.length === 0;
            const requiresCatalogConfigFetch = Boolean(
                apiSyncAdapter.isErpActiveOperationalTarget() &&
                (
                    (persistedProductGroups.length === 0 && persistedTerminalAllowedCategories.length === 0) ||
                    missingCommercialClassifications
                )
            );
            if (requiresDocumentSeriesConfigFetch) {
                console.warn('POS_DOCUMENT_SERIES_CONFIG_FETCH_REQUIRED', {
                    terminalId: context.terminalId,
                    localTerminalId,
                    reason: 'ERP_ACTIVE_WITHOUT_PERSISTED_TERMINAL_CONFIG_SERIES',
                    internalSequencesCount: persistedInternalSequences.length,
                    terminalDocumentSeriesCount: persistedTerminalSeries.length,
                });
            }
            if (requiresCatalogConfigFetch) {
                console.warn('POS_CLASSIFICATIONS_CONFIG_FETCH_REQUIRED', {
                    terminalId: context.terminalId,
                    localTerminalId,
                    reason: 'ERP_ACTIVE_WITHOUT_PERSISTED_TERMINAL_CATALOG_CLASSIFICATIONS',
                    productGroupsCount: persistedProductGroups.length,
                    allowedCategoriesCount: persistedTerminalAllowedCategories.length,
                    departmentsCount: persistedDepartments.length,
                    sectionsCount: persistedSections.length,
                    familiesCount: persistedFamilies.length,
                    subfamiliesCount: persistedSubfamilies.length,
                    brandsCount: persistedBrands.length,
                });
            }

            if (inventoryVersionMatch === true) {
                this.incrementSyncTelemetry('inventory_version_hits');
            } else if (inventoryVersionMiss) {
                this.incrementSyncTelemetry('inventory_version_misses');
            }
            if (priceVersionMatch === true) {
                this.incrementSyncTelemetry('price_version_hits');
            } else if (priceVersionMiss) {
                this.incrementSyncTelemetry('price_version_misses');
            }
            if (inventorySyncSkippedByVersion) {
                this.incrementSyncTelemetry('inventory_sync_skipped');
                this.incrementSyncTelemetry('bytes_saved_estimate', this.estimateBlockBytesSaved(manifest.counts?.inventory, 180));
            }
            if (priceSyncSkippedByVersion) {
                this.incrementSyncTelemetry('price_sync_skipped');
                this.incrementSyncTelemetry('bytes_saved_estimate', this.estimateBlockBytesSaved(manifest.counts?.product_prices, 160));
            }

            this.readyToSellState = {
                ...this.readyToSellState,
                inventoryVersion: remoteInventoryVersion || localInventoryVersion,
                priceVersion: remotePriceVersion || localPriceVersion,
                inventoryVersionMatch,
                priceVersionMatch,
                inventorySyncSkippedByVersion,
                priceSyncSkippedByVersion,
                lastVersionComparison: {
                    localTerminalId,
                    localInventoryVersion,
                    remoteInventoryVersion,
                    localPriceVersion,
                    remotePriceVersion,
                    inventoryVersionMatch,
                    priceVersionMatch,
                    inventorySyncSkippedByVersion,
                    priceSyncSkippedByVersion,
                    inventoryHash: manifest.domain_hashes?.inventory || null,
                    priceHash: manifest.domain_hashes?.product_prices || null,
                    comparedAt: new Date().toISOString(),
                },
            };
            this.publishSyncHealthUpdate();

            if (!requiresDocumentSeriesConfigFetch && !requiresCatalogConfigFetch && !terminalChanged && changedMasterScopes.length === 0 && (!inventoryChanged || inventorySyncSkippedByVersion) && !bootstrapInventoryOnStartup && (!productPricesChanged || priceSyncSkippedByVersion) && !bootstrapProductPricesOnStartup) {
                this.persistTerminalCursorMap(localTerminalId, manifest.cursor_map);
                if (options?.markStartupCompleted) {
                    this.markStartupManifestSyncCompleted(localTerminalId);
                }
                return null;
            }

            const shouldRefreshTerminalConfig = terminalChanged || changedMasterScopes.length > 0 || requiresDocumentSeriesConfigFetch || requiresCatalogConfigFetch;
            const resolvedScopes: TerminalManifestResolvedScope[] = terminalChanged
                ? ['identity', 'terminal', 'device_role', 'role', 'pricing', 'inventory', 'documents', 'catalog', 'promotions', 'loyalty']
                : Array.from(new Set<TerminalManifestResolvedScope>([
                    ...(requiresDocumentSeriesConfigFetch ? ['documents' as TerminalManifestResolvedScope] : []),
                    ...((requiresCatalogConfigFetch || changedMasterScopes.includes('items')) ? ['catalog' as TerminalManifestResolvedScope] : []),
                ]));
            const configTask = shouldRefreshTerminalConfig
                ? this.refreshTerminalResolvedConfig(undefined, {
                    forceRemoteFetch: true,
                    masterScopes: changedMasterScopes,
                    resolvedScopes,
                    supplementalMode: 'background',
                })
                : Promise.resolve<BusinessConfig | null>(null);

            const shouldRunInventoryTask = (inventoryChanged || bootstrapInventoryOnStartup || inventoryVersionMiss) && !inventorySyncSkippedByVersion;
            const shouldRunProductPricesTask = (productPricesChanged || bootstrapProductPricesOnStartup || priceVersionMiss) && !priceSyncSkippedByVersion;
            const inventoryTask = shouldRunInventoryTask
                ? this.fetchTerminalInventoryBlock(context, storedCursorMap.inventory || null)
                : Promise.resolve<TerminalInventoryPayload | null>(null);

            const productPricesTask = shouldRunProductPricesTask
                ? this.fetchTerminalProductPricesBlock(context, storedCursorMap.product_prices || null)
                : Promise.resolve<TerminalProductPricesPayload | null>(null);

            const [configResult, productPricesResult] = await Promise.allSettled([
                configTask,
                productPricesTask,
            ]);

            const refreshedConfig = configResult.status === 'fulfilled' ? configResult.value : null;
            if (configResult.status === 'rejected') {
                throw configResult.reason;
            }

            if (shouldRunProductPricesTask && productPricesResult.status === 'fulfilled') {
                const productPricesPayload = productPricesResult.value;
                this.recordSnapshotDiagnostics('product_prices', productPricesPayload?.snapshot_meta);
                if (productPricesPayload?.cursor) {
                    manifest.cursor_map.product_prices = productPricesPayload.cursor;
                }

                const productPrices = Array.isArray(productPricesPayload?.prices) ? productPricesPayload.prices : [];
                const shouldApplyProductPrices =
                    productPrices.length > 0 &&
                    (Boolean(productPricesPayload?.has_changes) || bootstrapProductPricesOnStartup || Boolean(options?.bootstrapBlocks));
                let productPricesAppliedCount = 0;

                if (shouldApplyProductPrices) {
                    productPricesAppliedCount = await this.applyTerminalProductPricesBlock(productPrices);
                    this.persistPriceVersion(localTerminalId, productPricesPayload?.price_version || remotePriceVersion);
                } else if (productPricesPayload?.has_changes === false) {
                    this.persistPriceVersion(localTerminalId, productPricesPayload?.price_version || remotePriceVersion);
                }

                posCatalogDebugLog('product prices block: apply completed', {
                    productPricesChanged,
                    bootstrapProductPricesOnStartup,
                    forceFullBootstrap,
                    productPricesCursorPresent: Boolean(storedCursorMap.product_prices),
                    localPriceVersion,
                    remotePriceVersion,
                    priceVersionMatch,
                    priceSyncSkippedByVersion,
                    payloadPriceCount: productPrices.length,
                    payloadHasChanges: productPricesPayload?.has_changes ?? null,
                    payloadPriceVersion: productPricesPayload?.price_version || null,
                    productPricesAppliedCount,
                });
            } else if (shouldRunProductPricesTask && productPricesResult.status === 'rejected') {
                this.readyToSellState.failedOperations += 1;
                console.warn('⚠️ SyncManager: product prices block refresh failed:', productPricesResult.reason);
            }

            if (shouldRunInventoryTask) {
                void Promise.allSettled([inventoryTask]).then(async ([inventoryResult]) => {
                    if (inventoryResult.status === 'rejected') {
                        this.readyToSellState.failedOperations += 1;
                        this.publishSyncHealthUpdate();
                        console.warn('⚠️ SyncManager: background inventory refresh failed:', inventoryResult.reason);
                        return;
                    }

                    const inventoryPayload = inventoryResult.value;
                    this.recordSnapshotDiagnostics('inventory', inventoryPayload?.snapshot_meta);
                    if (inventoryPayload?.cursor) {
                        this.persistTerminalCursorMap(localTerminalId, {
                            ...manifest.cursor_map,
                            inventory: inventoryPayload.cursor,
                        });
                    }
                    const inventoryBalances = Array.isArray(inventoryPayload?.balances) ? inventoryPayload.balances : [];
                    const shouldApplyInventoryPayload =
                        inventoryBalances.length > 0 &&
                        (Boolean(inventoryPayload?.has_changes) || bootstrapInventoryOnStartup || Boolean(options?.bootstrapBlocks));
                    let inventoryAppliedCount = 0;

                    if (shouldApplyInventoryPayload) {
                        inventoryAppliedCount = await this.applyTerminalInventoryBlock(inventoryBalances);
                        this.persistInventoryVersion(localTerminalId, inventoryPayload?.inventory_version || remoteInventoryVersion);
                    } else if (inventoryPayload?.has_changes === false) {
                        this.persistInventoryVersion(localTerminalId, inventoryPayload?.inventory_version || remoteInventoryVersion);
                    }

                    if (apiSyncAdapter.isErpActiveOperationalTarget()) {
                        const shouldForceDirectInventoryRefresh =
                            Boolean(options?.bootstrapBlocks) ||
                            inventoryAppliedCount === 0;

                        if (shouldForceDirectInventoryRefresh) {
                            const directRefreshCount = await this.refreshOperationalInventorySnapshot();
                            if (directRefreshCount > 0) {
                                inventoryAppliedCount = directRefreshCount;
                            }
                        }
                    }

                    posCatalogDebugLog('inventory block: background apply completed', {
                        inventoryChanged,
                        bootstrapInventoryOnStartup,
                        forceFullBootstrap,
                        inventoryCursorPresent: Boolean(storedCursorMap.inventory),
                        localInventoryVersion,
                        remoteInventoryVersion,
                        inventoryVersionMatch,
                        inventorySyncSkippedByVersion,
                        payloadBalanceCount: inventoryBalances.length,
                        payloadHasChanges: inventoryPayload?.has_changes ?? null,
                        payloadInventoryVersion: inventoryPayload?.inventory_version || null,
                        inventoryAppliedCount,
                    });
                });
            }

            if (!refreshedConfig && (!inventoryChanged || inventorySyncSkippedByVersion) && (!productPricesChanged || priceSyncSkippedByVersion) && !bootstrapInventoryOnStartup && !bootstrapProductPricesOnStartup) {
                return null;
            }

            this.persistTerminalCursorMap(localTerminalId, manifest.cursor_map);
            if (options?.markStartupCompleted) {
                this.markStartupManifestSyncCompleted(localTerminalId);
            }

            return refreshedConfig;
        } finally {
            this.terminalManifestSyncInFlight = false;
        }
    }

    private async syncTerminalMastersOnStartup(baseConfig: BusinessConfig | null): Promise<void> {
        try {
            this.setSyncPhase('P0_P1_STARTUP_MANIFEST');
            await this.reconcileTerminalManifest(baseConfig, {
                skipIfStartupCompleted: true,
                markStartupCompleted: true,
            });
            this.markReadyToSell('P0_P1_READY');
        } catch (error) {
            this.readyToSellState.failedOperations += 1;
            this.publishSyncHealthUpdate();
            console.warn('⚠️ SyncManager: startup manifest sync failed:', error);
        }
    }

    private async refreshOperationalInventorySnapshot(): Promise<number> {
        if (!apiSyncAdapter.isErpActiveOperationalTarget()) {
            return 0;
        }

        const [rawProducts, rawWarehouses, rawStocks] = await Promise.all([
            db.get('products'),
            db.get('warehouses'),
            db.get('productStocks'),
        ]);
        const localProducts = (Array.isArray(rawProducts) ? rawProducts : []) as Product[];
        const runtimeWarehouses = (Array.isArray(rawWarehouses) ? rawWarehouses : []) as Warehouse[];
        const existingStocks = (Array.isArray(rawStocks) ? rawStocks : []) as ProductStock[];

        if (localProducts.length === 0) {
            return 0;
        }

        const remoteBalances = await apiSyncAdapter.pullOperationalStockBalances();
        if (!Array.isArray(remoteBalances) || remoteBalances.length === 0) {
            return 0;
        }

        const now = new Date().toISOString();
        const updatedProducts = new Set<string>();
        const nextProductsById = new Map<string, Product>(
            localProducts
                .filter((product) => Boolean(product?.id))
                .map((product) => [String(product.id).trim(), product])
        );
        const nextStocksById = new Map<string, ProductStock>(
            existingStocks
                .filter((stock) => Boolean(stock?.id))
                .map((stock) => [String(stock.id).trim(), stock])
        );
        const nextStockKeys = new Set<string>();

        for (const product of localProducts) {
            const matchedBalances = remoteBalances.filter((entry) =>
                productIdMatchesInventoryReference(entry, product, localProducts)
            );
            if (matchedBalances.length === 0) continue;

            const normalizedStockBalances = canonicalizeWarehouseRecord(
                extractWarehouseStockBalances(
                    matchedBalances,
                    ...matchedBalances.flatMap((entry: any) => [
                        entry?.stockBalances,
                        entry?.stock_balances,
                        entry?.balances,
                        entry?.warehouseBalances,
                        entry?.warehouse_balances,
                        entry?.metadata?.stockBalances,
                        entry?.metadata?.stock_balances,
                    ]),
                ),
                runtimeWarehouses,
            );

            const warehouseIds = Array.from(new Set([
                ...runtimeWarehouses.map((warehouse) => String(warehouse?.id || '').trim()).filter(Boolean),
                ...Object.keys(normalizedStockBalances),
            ]));
            const nextProduct: Product = {
                ...product,
                stockBalances: normalizedStockBalances,
                stock: Object.values(normalizedStockBalances).reduce((sum, quantity) => sum + Number(quantity || 0), 0),
                updatedAt: typeof (matchedBalances[0] as any)?.updatedAt === 'string'
                    ? (matchedBalances[0] as any).updatedAt
                    : product.updatedAt || now,
            };

            nextProductsById.set(nextProduct.id, nextProduct);
            updatedProducts.add(nextProduct.id);

            for (const warehouseId of warehouseIds) {
                const quantity = Number(normalizedStockBalances?.[warehouseId] ?? 0);
                const nextStock: ProductStock = {
                    id: `${nextProduct.id}_${warehouseId}`,
                    productId: nextProduct.id,
                    warehouseId,
                    quantity,
                    qtyPhysical: quantity,
                    qtyCommitted: 0,
                    qtyAvailable: quantity,
                    updatedAt: now,
                };
                nextStockKeys.add(`${nextProduct.id}::${warehouseId}`);
                nextStocksById.set(nextStock.id, nextStock);
            }
        }

        if (updatedProducts.size === 0) {
            return 0;
        }

        for (const stock of existingStocks) {
            if (!updatedProducts.has(String(stock?.productId || '').trim())) continue;
            const key = `${String(stock?.productId || '').trim()}::${String(stock?.warehouseId || '').trim()}`;
            if (nextStockKeys.has(key)) continue;
            if (stock?.id) {
                nextStocksById.delete(String(stock.id).trim());
            }
        }

        await Promise.all([
            db.save('products' as any, Array.from(nextProductsById.values())),
            db.save('productStocks' as any, Array.from(nextStocksById.values())),
        ]);
        window.dispatchEvent(new CustomEvent('productsUpdated'));
        window.dispatchEvent(new CustomEvent('productStocksUpdated'));
        return updatedProducts.size;
    }

    private async applyTerminalInventoryBlock(balances: TerminalInventoryBalancePayload[]): Promise<number> {
        const normalizedBalances = Array.isArray(balances) ? balances : [];
        if (normalizedBalances.length === 0) {
            return 0;
        }

        const [rawProducts, rawStocks, rawWarehouses] = await Promise.all([
            db.get('products'),
            db.get('productStocks'),
            db.get('warehouses'),
        ]);
        const localProducts = (Array.isArray(rawProducts) ? rawProducts : []) as Product[];
        const existingStocks = (Array.isArray(rawStocks) ? rawStocks : []) as ProductStock[];
        const runtimeWarehouses = (Array.isArray(rawWarehouses) ? rawWarehouses : []) as Warehouse[];

        if (localProducts.length === 0) {
            return 0;
        }

        const existingStocksByProductWarehouse = new Map<string, ProductStock>();
        for (const stock of existingStocks) {
            const productId = String(stock?.productId || '').trim();
            const warehouseId = String(stock?.warehouseId || '').trim();
            if (!productId || !warehouseId) continue;
            existingStocksByProductWarehouse.set(this.buildSnapshotProductStockLookupKey(productId, warehouseId), stock);
        }

        const updatedProducts = new Set<string>();
        const nextProductsById = new Map<string, Product>(
            localProducts
                .filter((product) => Boolean(product?.id))
                .map((product) => [String(product.id).trim(), product])
        );
        const nextStocksById = new Map<string, ProductStock>(
            existingStocks
                .filter((stock) => Boolean(stock?.id))
                .map((stock) => [String(stock.id).trim(), stock])
        );
        const nextStockKeys = new Set<string>();
        const now = new Date().toISOString();

        for (const product of localProducts) {
            const matchedBalances = normalizedBalances.filter((entry) =>
                productIdMatchesInventoryReference(entry, product, localProducts)
            );
            if (matchedBalances.length === 0) {
                continue;
            }

            const warehouseBalanceMap = canonicalizeWarehouseRecord(
                matchedBalances.reduce<Record<string, number>>((acc, entry) => {
                    const warehouseId = String(
                        entry?.warehouse_id
                        || (entry as any)?.warehouseId
                        || (entry as any)?.store_id
                        || (entry as any)?.storeId
                        || ''
                    ).trim();
                    if (!warehouseId) return acc;
                    acc[warehouseId] = Number(acc[warehouseId] || 0) + Number(
                        entry?.qty_on_hand
                        ?? (entry as any)?.qtyOnHand
                        ?? (entry as any)?.quantity
                        ?? (entry as any)?.qty
                        ?? (entry as any)?.stock
                        ?? (entry as any)?.balance
                        ?? 0
                    );
                    return acc;
                }, {}),
                runtimeWarehouses,
            );

            const nextProduct: Product = {
                ...product,
                stockBalances: warehouseBalanceMap,
                stock: Object.values(warehouseBalanceMap).reduce((sum, quantity) => sum + Number(quantity || 0), 0),
                updatedAt: matchedBalances.reduce((latest, entry) => {
                    const candidate = typeof (entry?.updated_at || (entry as any)?.updatedAt) === 'string'
                        ? (entry.updated_at || (entry as any)?.updatedAt)
                        : '';
                    if (!candidate) return latest;
                    return !latest || candidate > latest ? candidate : latest;
                }, product.updatedAt || now),
            };

            nextProductsById.set(nextProduct.id, nextProduct);
            updatedProducts.add(nextProduct.id);

            const aliasProductIds = this.collectSnapshotProductAliasIds(nextProduct);
            const warehouseIds = this.collectSnapshotProductWarehouseIds(nextProduct, runtimeWarehouses, existingStocksByProductWarehouse, aliasProductIds);

            for (const warehouseId of warehouseIds) {
                const lookupKey = this.buildSnapshotProductStockLookupKey(nextProduct.id, warehouseId);
                const existingStock = this.resolveExistingSnapshotProductStock(nextProduct.id, warehouseId, aliasProductIds, existingStocksByProductWarehouse);
                const matchedWarehouseBalances = matchedBalances.filter((entry) => String(
                    entry?.warehouse_id
                    || (entry as any)?.warehouseId
                    || (entry as any)?.store_id
                    || (entry as any)?.storeId
                    || ''
                ).trim() === warehouseId);
                const matchedBalance = matchedWarehouseBalances[matchedWarehouseBalances.length - 1];
                const qtyPhysical = Number(warehouseBalanceMap?.[warehouseId] ?? 0);
                const qtyCommitted = matchedWarehouseBalances.reduce((sum, entry) => {
                    const nextValue = Number(entry?.qty_committed);
                    return Number.isFinite(nextValue) ? sum + nextValue : sum;
                }, 0) || Number(existingStock?.qtyCommitted ?? 0);
                const qtyReserved = matchedWarehouseBalances.reduce((sum, entry) => {
                    const nextValue = Number(entry?.qty_reserved);
                    return Number.isFinite(nextValue) ? sum + nextValue : sum;
                }, 0);
                const nextStock: ProductStock = {
                    id: `${nextProduct.id}_${warehouseId}`,
                    productId: nextProduct.id,
                    warehouseId,
                    quantity: qtyPhysical,
                    qtyPhysical,
                    qtyCommitted,
                    qtyAvailable: qtyPhysical - qtyCommitted - qtyReserved,
                    updatedAt: typeof (matchedBalance?.updated_at || (matchedBalance as any)?.updatedAt) === 'string'
                        ? (matchedBalance.updated_at || (matchedBalance as any)?.updatedAt)
                        : now,
                };

                nextStockKeys.add(`${nextProduct.id}::${warehouseId}`);
                nextStocksById.set(nextStock.id, nextStock);
                existingStocksByProductWarehouse.set(lookupKey, nextStock);
            }

            await this.reconcileSnapshotProductStockAliases(nextProduct.id, aliasProductIds, existingStocksByProductWarehouse);
        }

        if (updatedProducts.size === 0) {
            return 0;
        }

        for (const stock of existingStocks) {
            if (!updatedProducts.has(String(stock?.productId || '').trim())) continue;
            const key = `${String(stock?.productId || '').trim()}::${String(stock?.warehouseId || '').trim()}`;
            if (nextStockKeys.has(key)) continue;
            if (stock?.id) {
                nextStocksById.delete(String(stock.id).trim());
            }
        }

        await Promise.all([
            db.save('products' as any, Array.from(nextProductsById.values())),
            db.save('productStocks' as any, Array.from(nextStocksById.values())),
        ]);
        window.dispatchEvent(new CustomEvent('productsUpdated'));
        window.dispatchEvent(new CustomEvent('productStocksUpdated'));
        return updatedProducts.size;
    }

    private async applyTerminalProductPricesBlock(prices: TerminalProductPricePayload[]): Promise<number> {
        const normalizedPrices = Array.isArray(prices) ? prices : [];
        const [rawProducts, rawConfig] = await Promise.all([
            db.get('products'),
            db.get('config'),
        ]);
        const localProducts = (Array.isArray(rawProducts) ? rawProducts : []) as Product[];
        const businessConfig = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
            ? rawConfig as BusinessConfig
            : null;
        const configTariffs = Array.isArray(businessConfig?.tariffs) ? businessConfig.tariffs : [];

        if (normalizedPrices.length === 0) {
            await db.save('productPrices' as any, []);
            window.dispatchEvent(new CustomEvent('productPricesUpdated'));
            return 0;
        }

        if (localProducts.length === 0) {
            return 0;
        }

        const localById = new Map<string, Product>();
        for (const product of localProducts) {
            if (product?.id) {
                localById.set(String(product.id).trim(), product);
            }
        }

        const localByIdentity = this.buildLocalProductIdentityLookup(localProducts);
        const nextPriceDocs = new Map<string, ProductPrice>();
        const nextTariffsByProduct = new Map<string, TariffPrice[]>();

        for (const entry of normalizedPrices) {
            const candidateTokens = productIdentityCandidates({
                id: entry?.product_id || entry?.item_id || entry?.id || '',
                productId: entry?.product_id || '',
                itemId: entry?.item_id || '',
            });
            const matchedProduct = candidateTokens
                .map((candidate) => localByIdentity.get(candidate) || localById.get(candidate))
                .find(Boolean) || null;

            if (!matchedProduct?.id) {
                continue;
            }

            const rawTariffId = String(entry?.tariff_id || entry?.tariff_code || '').trim();
            const tariffId = resolveTariffId(rawTariffId, configTariffs);
            const price = Number(entry?.price);

            if (!tariffId || !Number.isFinite(price)) {
                continue;
            }

            const productId = String(matchedProduct.id).trim();
            const documentId = `${productId}_${tariffId}`;
            const itemId = String(
                entry?.item_id
                || entry?.product_id
                || this.collectSnapshotProductAliasIds(matchedProduct)[0]
                || productId
            ).trim();
            nextPriceDocs.set(documentId, {
                id: documentId,
                productId,
                tariffId,
                tariffCode: String(entry?.tariff_code || '').trim() || undefined,
                itemId,
                erpProductId: itemId || undefined,
                sourceProductId: itemId || undefined,
                price,
                currency: String(entry?.currency || '').trim() || undefined,
                updatedAt: String(entry?.updated_at || matchedProduct.updatedAt || new Date().toISOString()).trim(),
            });

            const currentTariffs = nextTariffsByProduct.get(productId)
                || canonicalizeTariffEntries(Array.isArray(matchedProduct.tariffs) ? matchedProduct.tariffs : [], configTariffs);
            const currentIndex = currentTariffs.findIndex((tariff) => String(tariff?.tariffId || '').trim() === tariffId);
            const nextTariff: TariffPrice = {
                ...(currentIndex >= 0 ? currentTariffs[currentIndex] : {}),
                tariffId,
                price,
                name: currentIndex >= 0 ? currentTariffs[currentIndex]?.name : undefined,
            };

            if (currentIndex >= 0) {
                currentTariffs[currentIndex] = nextTariff;
            } else {
                currentTariffs.push(nextTariff);
            }

            nextTariffsByProduct.set(productId, canonicalizeTariffEntries(currentTariffs, configTariffs));
        }

        await db.save('productPrices' as any, Array.from(nextPriceDocs.values()));

        const activeTerminalId =
            localStorage.getItem('active_terminal_id') ||
            localStorage.getItem('CLIC_POS_TERMINAL_ID') ||
            this.initializedLocalTerminalId ||
            null;
        const currentTerminal = activeTerminalId && Array.isArray(businessConfig?.terminals)
            ? businessConfig!.terminals.find((terminal) => terminal?.id === activeTerminalId) || businessConfig!.terminals[0]
            : businessConfig?.terminals?.[0];
        const defaultTariffId =
            String(currentTerminal?.config?.pricing?.defaultTariffId || '').trim()
            || String(configTariffs[0]?.id || '').trim()
            || '';

        let updatedProducts = 0;
        for (const [productId, tariffs] of nextTariffsByProduct.entries()) {
            const product = localById.get(productId);
            if (!product) continue;

            const defaultTariff = tariffs.find((tariff) => String(tariff?.tariffId || '').trim() === defaultTariffId);
            const nextProduct: Product = {
                ...product,
                tariffs,
                price: Number.isFinite(Number(defaultTariff?.price)) ? Number(defaultTariff?.price) : product.price,
            };
            localById.set(productId, nextProduct);
            updatedProducts += 1;
        }

        if (updatedProducts > 0) {
            await db.save('products' as any, Array.from(localById.values()));
            window.dispatchEvent(new CustomEvent('productsUpdated'));
        }
        window.dispatchEvent(new CustomEvent('productPricesUpdated'));
        return nextPriceDocs.size;
    }

    async syncTerminalManifestInBackground(
        baseConfig?: BusinessConfig | null,
        options?: {
            bootstrapBlocks?: boolean;
        }
    ): Promise<BusinessConfig | null> {
        try {
            return await this.reconcileTerminalManifest(baseConfig ?? null, {
                skipIfStartupCompleted: false,
                markStartupCompleted: false,
                bootstrapBlocks: Boolean(options?.bootstrapBlocks),
            });
        } catch (error) {
            console.warn('⚠️ SyncManager: background manifest sync failed:', error);
            return null;
        }
    }

    private async deleteSnapshotProducts(itemsToDelete: unknown[]): Promise<number> {
        const incoming = Array.isArray(itemsToDelete) ? itemsToDelete : [];
        if (incoming.length === 0) return 0;

        const localProducts = (await db.get('products')) as Product[];
        const { localById, localByBarcode, localByCode } = this.buildLocalProductLookupMaps(localProducts);

        const idsToDelete = new Set<string>();

        for (const rawItem of incoming) {
            const candidates = this.catalogDeleteCandidates(rawItem as Record<string, unknown>);

            for (const candidate of candidates) {
                const byId = localById.get(candidate);
                if (byId?.id) idsToDelete.add(byId.id);

                const byCode = localByCode.get(candidate);
                if (byCode?.id) idsToDelete.add(byCode.id);

                const byBarcode = localByBarcode.get(candidate);
                if (byBarcode?.id) idsToDelete.add(byBarcode.id);
            }
        }

        for (const id of idsToDelete) {
            await db.deleteDocument('products', id);
        }

        if (idsToDelete.size > 0) {
            window.dispatchEvent(new CustomEvent('productsUpdated'));
        }

        return idsToDelete.size;
    }

    private imageBackedDeleteCandidates(
        collection: ImageBackedCollection,
        item: Record<string, unknown>
    ): string[] {
        const candidates = [
            typeof item.id === 'string' ? item.id.trim() : String(item.id || '').trim(),
            typeof item.taxId === 'string' ? item.taxId.trim() : String(item.taxId || '').trim(),
            typeof item.email === 'string' ? item.email.trim().toLowerCase() : String(item.email || '').trim().toLowerCase(),
            typeof item.phone === 'string' ? item.phone.trim() : String(item.phone || '').trim(),
        ].filter(Boolean);

        if (collection === 'customers') {
            return [
                ...candidates,
                typeof item.name === 'string' ? item.name.trim() : String(item.name || '').trim(),
            ].filter(Boolean);
        }

        return candidates;
    }

    private async deleteSnapshotImageBackedCollection(
        collection: ImageBackedCollection,
        itemsToDelete: unknown[]
    ): Promise<number> {
        const incoming = Array.isArray(itemsToDelete) ? itemsToDelete : [];
        if (incoming.length === 0) return 0;

        const localItems = (await db.get(collection)) as Record<string, unknown>[];
        const byId = new Map<string, string>();
        const byTaxId = new Map<string, string>();
        const byEmail = new Map<string, string>();
        const byPhone = new Map<string, string>();
        const byName = new Map<string, string>();

        for (const localItem of Array.isArray(localItems) ? localItems : []) {
            const localId = typeof localItem?.id === 'string' ? localItem.id.trim() : String(localItem?.id || '').trim();
            if (!localId) continue;

            byId.set(localId, localId);

            const taxId = typeof localItem?.taxId === 'string' ? localItem.taxId.trim() : String(localItem?.taxId || '').trim();
            if (taxId) byTaxId.set(taxId, localId);

            const email = typeof localItem?.email === 'string' ? localItem.email.trim().toLowerCase() : String(localItem?.email || '').trim().toLowerCase();
            if (email) byEmail.set(email, localId);

            const phone = typeof localItem?.phone === 'string' ? localItem.phone.trim() : String(localItem?.phone || '').trim();
            if (phone) byPhone.set(phone, localId);

            if (collection === 'customers') {
                const name = typeof localItem?.name === 'string' ? localItem.name.trim() : String(localItem?.name || '').trim();
                if (name) byName.set(name, localId);
            }
        }

        const idsToDelete = new Set<string>();

        for (const rawItem of incoming) {
            const item = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem)
                ? (rawItem as Record<string, unknown>)
                : {};

            for (const candidate of this.imageBackedDeleteCandidates(collection, item)) {
                const normalized = candidate.trim();
                if (!normalized) continue;

                const match =
                    byId.get(normalized) ||
                    byTaxId.get(normalized) ||
                    byEmail.get(normalized.toLowerCase()) ||
                    byPhone.get(normalized) ||
                    (collection === 'customers' ? byName.get(normalized) : undefined);

                if (match) {
                    idsToDelete.add(match);
                }
            }
        }

        for (const id of idsToDelete) {
            await db.deleteDocument(collection, id);
        }

        if (idsToDelete.size > 0) {
            window.dispatchEvent(new CustomEvent(`${collection}Updated`));
        }

        return idsToDelete.size;
    }

    private async applyCatalogDelta(deltaPayload: unknown): Promise<{ upserted: number; deleted: number }> {
        const delta = deltaPayload && typeof deltaPayload === 'object'
            ? (deltaPayload as Record<string, unknown>)
            : {};
        const itemsUpsert = Array.isArray(delta.items_upsert) ? delta.items_upsert : [];
        const itemsDelete = Array.isArray(delta.items_delete) ? delta.items_delete : [];
        const customersUpsert = Array.isArray(delta.customers_upsert) ? delta.customers_upsert : [];
        const customersDelete = Array.isArray(delta.customers_delete) ? delta.customers_delete : [];
        const suppliersUpsert = Array.isArray(delta.suppliers_upsert) ? delta.suppliers_upsert : [];
        const suppliersDelete = Array.isArray(delta.suppliers_delete) ? delta.suppliers_delete : [];
        const purchaseOrdersUpsert = Array.isArray(delta.purchase_orders_upsert)
            ? delta.purchase_orders_upsert
            : (Array.isArray(delta.purchaseOrders_upsert) ? delta.purchaseOrders_upsert : []);
        const purchaseOrdersDelete = Array.isArray(delta.purchase_orders_delete)
            ? delta.purchase_orders_delete
            : (Array.isArray(delta.purchaseOrders_delete) ? delta.purchaseOrders_delete : []);
        const transfersUpsert = Array.isArray(delta.transfers_upsert) ? delta.transfers_upsert : [];
        const transfersDelete = Array.isArray(delta.transfers_delete) ? delta.transfers_delete : [];

        const productUpserted = itemsUpsert.length > 0
            ? await this.applySnapshotProducts({ masters: { items: itemsUpsert } })
            : 0;
        const productDeleted = itemsDelete.length > 0
            ? await this.deleteSnapshotProducts(itemsDelete)
            : 0;
        const customerUpserted = customersUpsert.length > 0
            ? await this.applySnapshotImageBackedCollection('customers', customersUpsert)
            : 0;
        const customerDeleted = customersDelete.length > 0
            ? await this.deleteSnapshotImageBackedCollection('customers', customersDelete)
            : 0;
        const supplierUpserted = suppliersUpsert.length > 0
            ? await this.applySnapshotImageBackedCollection('suppliers', suppliersUpsert)
            : 0;
        const supplierDeleted = suppliersDelete.length > 0
            ? await this.deleteSnapshotImageBackedCollection('suppliers', suppliersDelete)
            : 0;
        const purchaseOrdersUpserted = purchaseOrdersUpsert.length > 0
            ? await this.applySnapshotStructuredCollection('purchaseOrders', purchaseOrdersUpsert, this.normalizeSnapshotPurchaseOrder.bind(this))
            : 0;
        const purchaseOrdersDeleted = purchaseOrdersDelete.length > 0
            ? await this.deleteSnapshotStructuredCollection('purchaseOrders', purchaseOrdersDelete)
            : 0;
        const transfersUpserted = transfersUpsert.length > 0
            ? await this.applySnapshotStructuredCollection('transfers', transfersUpsert, this.normalizeSnapshotTransfer.bind(this))
            : 0;
        const transfersDeleted = transfersDelete.length > 0
            ? await this.deleteSnapshotStructuredCollection('transfers', transfersDelete)
            : 0;

        return {
            upserted: productUpserted + customerUpserted + supplierUpserted + purchaseOrdersUpserted + transfersUpserted,
            deleted: productDeleted + customerDeleted + supplierDeleted + purchaseOrdersDeleted + transfersDeleted,
        };
    }

    async refreshTerminalResolvedConfig(
        snapshotOverride?: unknown,
        options?: {
            baseConfig?: BusinessConfig | null;
            persist?: boolean;
            dispatchEvent?: boolean;
            forceRemoteFetch?: boolean;
            forceFullCatalog?: boolean;
            masterScopes?: TerminalManifestMasterScope[];
            blockScopes?: TerminalManifestBlockScope[];
            resolvedScopes?: TerminalManifestResolvedScope[];
            supplementalMode?: 'inline' | 'background' | 'skip';
        }
    ): Promise<BusinessConfig | null> {
        if (this.isDisabled) return null;
        const refreshStartedAt = posCatalogDebugNow();

        const loadedConfig = options?.baseConfig ?? (await db.get('config') as unknown);
        const baseConfig = loadedConfig && !Array.isArray(loadedConfig)
            ? (loadedConfig as BusinessConfig)
            : null;
        if (!baseConfig || Array.isArray(baseConfig) || !Array.isArray(baseConfig.terminals)) {
            return null;
        }

        const context = this.getActiveTerminalContext(baseConfig);
        if (!context.terminalId) {
            return null;
        }

        const protectLocalCatalog = protectsLocalCatalogFromCloud();

        const snapshotTerminalId = context.localTerminalId || context.terminalId;
        const cachedSnapshot = baseConfig.terminalSnapshots?.[snapshotTerminalId] || null;
        const currentCatalogCursor = this.readStoredCatalogCursor(snapshotTerminalId);
        const currentTerminalCursorMap = this.readStoredTerminalCursorMap(snapshotTerminalId);
        const requestedMasterScopes = Array.isArray(options?.masterScopes)
            ? Array.from(new Set(options.masterScopes.filter(Boolean)))
            : null;
        const requestedBlockScopes = Array.isArray(options?.blockScopes)
            ? Array.from(new Set(options.blockScopes.filter(Boolean)))
            : null;
        const requestedResolvedScopes = Array.isArray(options?.resolvedScopes)
            ? Array.from(new Set(options.resolvedScopes.filter(Boolean)))
            : null;
        let payload: Record<string, any> | null = null;
        let catalogDelta: Record<string, unknown> | null = null;
        let nextCatalogCursor: string | null = null;

        let snapshot = extractTerminalConfigSnapshot(snapshotOverride);
        const pendingSnapshot = snapshot
            ? null
            : this.getPendingTerminalSnapshot(context.terminalId, snapshotTerminalId);
        const endpointCandidates = this.buildTerminalConfigEndpointCandidates(context);
        const syncApiBase = this.resolveTerminalConfigSyncApiBase(context);
        const useAbsoluteEndpoint = this.shouldUseAbsoluteTerminalConfigEndpoint();
        const canFetchRemote = Boolean(
            context.terminalId &&
            context.tenantId &&
            endpointCandidates.length > 0
        );
        const allowPendingFallback = !options?.forceRemoteFetch;

        posCatalogDebugLog('refreshTerminalResolvedConfig: context', {
            terminalId: context.terminalId,
            localTerminalId: snapshotTerminalId,
            tenantIdPresent: Boolean(context.tenantId),
            erpBaseUrlPresent: Boolean(context.erpBaseUrl),
            syncApiBasePresent: Boolean(syncApiBase),
            useAbsoluteEndpoint,
            endpointCandidates: endpointCandidates.map((candidate) => ({
                mode: candidate.mode,
                baseUrl: candidate.baseUrl,
            })),
            forceRemoteFetch: Boolean(options?.forceRemoteFetch),
            forceFullCatalog: Boolean(options?.forceFullCatalog),
            hasCatalogCursor: Boolean(currentCatalogCursor),
            hasTerminalCursorMap: Object.keys(currentTerminalCursorMap).length > 0,
            hasPendingSnapshot: Boolean(pendingSnapshot),
            requestedMasterScopes,
            requestedBlockScopes,
            requestedResolvedScopes,
        });

        if (!snapshot && options?.forceRemoteFetch && !canFetchRemote) {
            posCatalogDebugLog('refreshTerminalResolvedConfig: remote fetch unavailable', {
                terminalId: context.terminalId,
                localTerminalId: snapshotTerminalId,
                tenantId: context.tenantId || null,
                erpBaseUrl: context.erpBaseUrl || null,
                syncApiBase: syncApiBase || null,
                endpointCandidates: endpointCandidates.map((candidate) => ({
                    mode: candidate.mode,
                    baseUrl: candidate.baseUrl,
                })),
            });
        }

        if (!snapshot && canFetchRemote) {
            let lastFetchError: unknown = null;

            for (const endpointCandidate of endpointCandidates) {
                const fetchAttemptStartedAt = posCatalogDebugNow();
                const params = new URLSearchParams();
                if (context.tenantId) params.set('tenant_id', context.tenantId);
                if (context.terminalId) params.set('terminal_id', context.terminalId);
                if (endpointCandidate.includeErpBaseUrl && context.erpBaseUrl) params.set('erp_base_url', context.erpBaseUrl);
                if (context.posDeviceId) params.set('pos_device_id', context.posDeviceId);
                if (context.posDeviceId) params.set('device_id', context.posDeviceId);
                if (context.localTerminalId) params.set('local_terminal_id', context.localTerminalId);
                if (!options?.forceFullCatalog && currentCatalogCursor) params.set('catalog_cursor', currentCatalogCursor);
                if (requestedMasterScopes) {
                    params.set('master_scopes', requestedMasterScopes.length > 0 ? requestedMasterScopes.join(',') : 'none');
                }
                if (requestedResolvedScopes) {
                    params.set('resolved_scopes', requestedResolvedScopes.length > 0 ? requestedResolvedScopes.join(',') : 'none');
                }

                try {
                    const endpointPath = `/terminals/${encodeURIComponent(context.terminalId)}/config`;
                    const endpoint = `${endpointCandidate.baseUrl}${endpointPath}${params.toString() ? `?${params.toString()}` : ''}`;
                    posCatalogDebugLog('refreshTerminalResolvedConfig: fetch begin', {
                        endpoint,
                        endpointMode: endpointCandidate.mode,
                        forceRemoteFetch: Boolean(options?.forceRemoteFetch),
                        forceFullCatalog: Boolean(options?.forceFullCatalog),
                        catalogCursorSent: !options?.forceFullCatalog ? currentCatalogCursor : null,
                        requestedMasterScopes,
                        requestedBlockScopes,
                        requestedResolvedScopes,
                    });
                    const response = await fetch(endpoint, {
                        headers: {
                            Accept: 'application/json',
                            ...this.buildPosDeviceHeaders(context.posDeviceId),
                        },
                    });
                    if (!response.ok) {
                        throw await this.buildTerminalEndpointError(
                            response,
                            `No se pudo refrescar la configuración de terminal (${response.status}).`,
                            { terminalId: context.terminalId, posDeviceId: context.posDeviceId },
                        );
                    }

                    const responseContentType = response.headers.get('content-type') || null;
                    payload = await response.json();
                    const configSnapshotMeta = payload?.snapshot_meta && typeof payload.snapshot_meta === 'object' && !Array.isArray(payload.snapshot_meta)
                        ? payload.snapshot_meta as Record<string, any>
                        : payload?.cache && typeof payload.cache === 'object' && !Array.isArray(payload.cache)
                            ? payload.cache as Record<string, any>
                            : {};
                    this.recordSnapshotDiagnostics('terminal_config', {
                        snapshotSource: this.normalizeVersionToken(configSnapshotMeta.source)
                            || this.normalizeVersionToken(configSnapshotMeta.snapshot_source)
                            || (payload?.persistent_snapshot ? 'persistent' : null),
                        snapshotAgeMs: Number.isFinite(Number(configSnapshotMeta.age_ms ?? configSnapshotMeta.snapshot_age_ms))
                            ? Number(configSnapshotMeta.age_ms ?? configSnapshotMeta.snapshot_age_ms)
                            : null,
                        snapshotVersionHash: this.normalizeVersionToken(configSnapshotMeta.version_hash)
                            || this.normalizeVersionToken(configSnapshotMeta.snapshot_version_hash)
                            || this.normalizeVersionToken(configSnapshotMeta.hash),
                    });
                    snapshot = extractTerminalConfigSnapshot(payload?.terminal_config ?? payload);
                    catalogDelta = payload?.catalog_delta && typeof payload.catalog_delta === 'object'
                        ? payload.catalog_delta
                        : null;
                    nextCatalogCursor =
                        typeof payload?.snapshot_meta?.catalog_cursor === 'string'
                            ? payload.snapshot_meta.catalog_cursor.trim() || null
                            : null;

                    const snapshotMasters = (snapshot as any)?.masters;
                    const traceRows = Array.isArray(snapshotMasters?.items)
                        ? snapshotMasters.items
                            .filter((item: unknown) => posCatalogDebugMatchesRaw(item))
                            .map((item: Record<string, unknown>) => posCatalogDebugSummarizeItem(item))
                        : [];

                    posCatalogDebugLog('refreshTerminalResolvedConfig: fetch success', {
                        source: payload?.source || null,
                        endpointMode: endpointCandidate.mode,
                        contentType: responseContentType,
                        elapsedMs: posCatalogDebugElapsedMs(fetchAttemptStartedAt),
                        usedCatalogDelta: Boolean(catalogDelta),
                        nextCatalogCursor,
                        traceRows,
                    });

                    if (!snapshot && payload?.config && !Array.isArray(payload.config)) {
                        const incomingConfig = payload.config as BusinessConfig;
                        const changed =
                            JSON.stringify(this.sanitizeConfig(baseConfig)) !==
                            JSON.stringify(this.sanitizeConfig(incomingConfig));

                        if (options?.persist !== false && changed) {
                            await db.save('config', incomingConfig);
                        }

                        if (options?.dispatchEvent !== false && changed) {
                            window.dispatchEvent(new CustomEvent('configUpdated', { detail: incomingConfig }));
                        }

                        return incomingConfig;
                    }

                    break;
                } catch (remoteSnapshotError) {
                    lastFetchError = remoteSnapshotError;
                    posCatalogDebugLog('refreshTerminalResolvedConfig: fetch failed', {
                        allowPendingFallback,
                        endpointMode: endpointCandidate.mode,
                        endpointBaseUrl: endpointCandidate.baseUrl,
                        hasPendingSnapshot: Boolean(pendingSnapshot),
                        elapsedMs: posCatalogDebugElapsedMs(fetchAttemptStartedAt),
                        error: String((remoteSnapshotError as Error)?.message || remoteSnapshotError),
                    });
                }
            }

            if (!snapshot && lastFetchError) {
                if (!pendingSnapshot || !allowPendingFallback) {
                    throw lastFetchError;
                }
                console.warn('⚠️ SyncManager: Could not fetch remote terminal snapshot. Falling back to pending snapshot.', lastFetchError);
            }
        }

        if (!snapshot && pendingSnapshot && allowPendingFallback) {
            const traceRows = Array.isArray(pendingSnapshot?.masters?.items)
                ? pendingSnapshot.masters.items
                    .filter((item: unknown) => posCatalogDebugMatchesRaw(item))
                    .map((item: Record<string, unknown>) => posCatalogDebugSummarizeItem(item))
                : [];
            posCatalogDebugLog('refreshTerminalResolvedConfig: using pending snapshot fallback', {
                traceRows,
            });
            snapshot = pendingSnapshot;
        }

        if (!snapshot) {
            return null;
        }

        try {
            const applyStartedAt = posCatalogDebugNow();
            if (!protectLocalCatalog) {
                if (catalogDelta) {
                    await this.applyCatalogDelta(catalogDelta);
                } else {
                    await this.applySnapshotProducts(snapshot);
                }
                const structuredMasterData = await this.refreshTerminalStructuredMasterData(snapshot, catalogDelta, {
                    terminalIds: [
                        context.terminalId,
                        snapshotTerminalId,
                        context.localTerminalId,
                        context.posDeviceId,
                    ],
                });
                await posCatalogDebugLogDbRows('after refreshTerminalResolvedConfig product apply');
                posCatalogDebugLog('refreshTerminalResolvedConfig: product apply success', {
                    usedCatalogDelta: Boolean(catalogDelta),
                    structuredMasterData,
                    elapsedMs: posCatalogDebugElapsedMs(applyStartedAt),
                });
            } else {
                posCatalogDebugLog('refreshTerminalResolvedConfig: catalog apply skipped for POS_CLOUD_STAGING', {
                    usedCatalogDelta: Boolean(catalogDelta),
                    requestedMasterScopes,
                    requestedResolvedScopes,
                });
            }
        } catch (error) {
            console.warn('⚠️ SyncManager: Could not apply snapshot products from terminal config push:', error);
            posCatalogDebugLog('refreshTerminalResolvedConfig: product apply failed', {
                elapsedMs: posCatalogDebugElapsedMs(refreshStartedAt),
                error: String((error as Error)?.message || error),
            });
        }

        const configAfterStructuredMasterDataRaw = (await db.get('config')) as unknown;
        const configForTerminalSnapshot =
            configAfterStructuredMasterDataRaw &&
            !Array.isArray(configAfterStructuredMasterDataRaw) &&
            Array.isArray((configAfterStructuredMasterDataRaw as BusinessConfig).terminals)
                ? configAfterStructuredMasterDataRaw as BusinessConfig
                : baseConfig;

        const applied = applyTerminalConfigSnapshot(configForTerminalSnapshot, {
            terminalId: snapshotTerminalId,
            posDeviceId: context.posDeviceId || undefined,
            bindingMode: context.bindingMode,
            incomingSnapshot: snapshot,
            cachedSnapshot,
        });

        const localProducts = ((await db.get('products')) as Product[]) || [];
        const nextConfig = this.reconcileCatalogProductIds(applied.config, localProducts);
        const nextRuntimeWarehouses = this.resolveRuntimeWarehousesFromConfig(nextConfig, applied.terminalId);
        const operationalDocumentState = extractTerminalOperationalDocumentState(nextConfig, applied.terminalId);
        const changed =
            JSON.stringify(this.sanitizeConfig(configForTerminalSnapshot)) !==
            JSON.stringify(this.sanitizeConfig(nextConfig));

        if (options?.persist !== false && changed) {
            await db.save('config', nextConfig);
        }

        if (nextRuntimeWarehouses.length > 0) {
            const persistedWarehouses = ((await db.get('warehouses')) as Warehouse[]) || [];
            const persistedJson = JSON.stringify(persistedWarehouses);
            const nextJson = JSON.stringify(nextRuntimeWarehouses);

            if (persistedJson !== nextJson) {
                await db.save('warehouses', nextRuntimeWarehouses);
                window.dispatchEvent(new CustomEvent('warehousesUpdated'));
            }
        }

        await db.rehydrateOperationalDocumentState(
            operationalDocumentState.documentSeries,
            operationalDocumentState.fiscalRanges,
            operationalDocumentState.fiscalAllocations,
            operationalDocumentState.terminalId,
        );

        if (snapshot && this.getPendingTerminalSnapshot(context.terminalId, snapshotTerminalId)) {
            this.clearPendingTerminalSnapshot();
        }

        if (snapshot.tenant_id) {
            localStorage.setItem('active_tenant_id', snapshot.tenant_id);
        }
        localStorage.setItem('active_terminal_id', applied.terminalId);
        localStorage.setItem('CLIC_POS_TERMINAL_ID', applied.terminalId);
        let nextTerminalCursorMap = { ...currentTerminalCursorMap };
        if (nextCatalogCursor) {
            this.persistCatalogCursor(snapshotTerminalId, nextCatalogCursor);
        }

        if (!protectLocalCatalog && requestedBlockScopes?.includes('inventory')) {
            const inventoryPayload = await this.fetchTerminalInventoryBlock(
                context,
                currentTerminalCursorMap.inventory || null,
            );
            if (inventoryPayload?.cursor) {
                nextTerminalCursorMap = {
                    ...nextTerminalCursorMap,
                    inventory: inventoryPayload.cursor,
                };
            }
            this.recordSnapshotDiagnostics('refresh_config_inventory', inventoryPayload?.snapshot_meta);
            const inventoryBalances = Array.isArray(inventoryPayload?.balances) ? inventoryPayload.balances : [];
            let inventoryAppliedCount = 0;
            if (inventoryBalances.length > 0) {
                inventoryAppliedCount = await this.applyTerminalInventoryBlock(inventoryBalances);
                this.persistInventoryVersion(snapshotTerminalId, inventoryPayload?.inventory_version);
            } else if (inventoryPayload?.has_changes === false) {
                this.persistInventoryVersion(snapshotTerminalId, inventoryPayload?.inventory_version);
            }
            if (apiSyncAdapter.isErpActiveOperationalTarget()) {
                const directRefreshCount = await this.refreshOperationalInventorySnapshot();
                if (directRefreshCount > 0) {
                    inventoryAppliedCount = directRefreshCount;
                    this.persistInventoryVersion(snapshotTerminalId, inventoryPayload?.inventory_version);
                }
            }
            posCatalogDebugLog('refreshTerminalResolvedConfig: inventory block applied', {
                payloadBalanceCount: inventoryBalances.length,
                payloadHasChanges: inventoryPayload?.has_changes ?? null,
                inventoryAppliedCount,
            });
        }

        if (!protectLocalCatalog && requestedBlockScopes?.includes('product_prices')) {
            const productPricesPayload = await this.fetchTerminalProductPricesBlock(
                context,
                currentTerminalCursorMap.product_prices || null,
            );
            if (productPricesPayload?.cursor) {
                nextTerminalCursorMap = {
                    ...nextTerminalCursorMap,
                    product_prices: productPricesPayload.cursor,
                };
            }
            this.recordSnapshotDiagnostics('refresh_config_product_prices', productPricesPayload?.snapshot_meta);
            const productPrices = Array.isArray(productPricesPayload?.prices) ? productPricesPayload.prices : [];
            let productPricesAppliedCount = 0;
            if (productPrices.length > 0) {
                productPricesAppliedCount = await this.applyTerminalProductPricesBlock(productPrices);
                this.persistPriceVersion(snapshotTerminalId, productPricesPayload?.price_version);
            } else if (productPricesPayload?.has_changes === false) {
                this.persistPriceVersion(snapshotTerminalId, productPricesPayload?.price_version);
            }
            posCatalogDebugLog('refreshTerminalResolvedConfig: product prices block applied', {
                payloadPriceCount: productPrices.length,
                payloadHasChanges: productPricesPayload?.has_changes ?? null,
                productPricesAppliedCount,
            });
        }

        if (JSON.stringify(nextTerminalCursorMap) !== JSON.stringify(currentTerminalCursorMap)) {
            this.persistTerminalCursorMap(snapshotTerminalId, nextTerminalCursorMap);
        }

        const runSupplementalMasterData = async () => {
            try {
                await this.refreshTerminalSupplementalMasterData(snapshot, catalogDelta);
            } catch (error) {
                this.readyToSellState.failedOperations += 1;
                this.publishSyncHealthUpdate();
                console.warn('⚠️ SyncManager: Supplemental customer/supplier refresh failed after terminal config update:', error);
            }
        };

        if (options?.supplementalMode === 'background') {
            window.setTimeout(() => {
                void runSupplementalMasterData();
            }, 1000);
        } else if (options?.supplementalMode !== 'skip') {
            await runSupplementalMasterData();
        }

        if (options?.dispatchEvent !== false && changed) {
            window.dispatchEvent(new CustomEvent('configUpdated', { detail: nextConfig }));
        }

        posCatalogDebugLog('refreshTerminalResolvedConfig: completed', {
            changed,
            usedCatalogDelta: Boolean(catalogDelta),
            nextCatalogCursor,
            requestedBlockScopes,
            elapsedMs: posCatalogDebugElapsedMs(refreshStartedAt),
        });

        return nextConfig;
    }

    private async applySnapshotProducts(snapshot: unknown): Promise<number> {
        const startedAt = posCatalogDebugNow();
        const rawItems = Array.isArray((snapshot as any)?.masters?.items)
            ? (snapshot as any).masters.items
            : [];

        if (rawItems.length === 0) {
            return 0;
        }

        const normalizedItems = await this.enrichPulledProducts(rawItems);
        const localProducts = (await db.get('products')) as Product[];
        const runtimeWarehouses = ((await db.get('warehouses')) as Warehouse[]) || [];
        const existingProductStocks = ((await db.get('productStocks')) as ProductStock[]) || [];
        const existingStocksByProductWarehouse = new Map<string, ProductStock>(
            existingProductStocks.map((stock) => [
                this.buildSnapshotProductStockLookupKey(stock?.productId || '', stock?.warehouseId || ''),
                stock,
            ]),
        );
        const localProductsById = new Map<string, Product>(
            localProducts
                .filter((product) => Boolean(product?.id))
                .map((product) => [String(product.id).trim(), product]),
        );
        const localByIdentity = this.buildLocalProductIdentityLookup(localProducts);
        const preserveOperationalInventory = apiSyncAdapter.isErpActiveOperationalTarget();
        let updatedCount = 0;
        const duplicateIdsToRemove = new Set<string>();
        const traceRaw = rawItems.filter((item: unknown) => posCatalogDebugMatchesRaw(item));

        if (traceRaw.length > 0) {
            posCatalogDebugLog('applySnapshotProducts: raw snapshot items', {
                traceRows: traceRaw.map((item: Record<string, unknown>) => posCatalogDebugSummarizeItem(item)),
            });
        }

        for (const [index, normalizedItem] of normalizedItems.entries()) {
            if (!normalizedItem?.id) continue;
            const rawItem = rawItems[index] as Record<string, unknown> | undefined;
            let item = normalizeRestaurantProductConfig(normalizedItem as any) as any;
            const incomingRemoteId =
                typeof rawItem?.id === 'string'
                    ? rawItem.id.trim()
                    : String(rawItem?.id || normalizedItem.id || '').trim();

            const incomingCodes = new Set<string>([
                ...productIdentityCandidates(rawItem || null),
                ...productIdentityCandidates(normalizedItem as Record<string, unknown>),
            ]);

            let canonicalLocalProduct: Product | undefined;
            for (const code of incomingCodes) {
                if (localByIdentity.has(code)) {
                    canonicalLocalProduct = localByIdentity.get(code);
                    break;
                }
            }

            if (canonicalLocalProduct?.id && canonicalLocalProduct.id !== normalizedItem.id) {
                if (posCatalogDebugMatchesRaw(rawItem || normalizedItem)) {
                    posCatalogDebugLog('applySnapshotProducts: canonical remap', {
                        rawId: typeof rawItem?.id === 'string' ? rawItem.id.trim() : String(rawItem?.id || '').trim(),
                        normalizedId: typeof normalizedItem?.id === 'string' ? normalizedItem.id.trim() : String(normalizedItem?.id || '').trim(),
                        canonicalLocalId: canonicalLocalProduct.id,
                        canonicalName: canonicalLocalProduct.name,
                    });
                }
                item = {
                    ...canonicalLocalProduct,
                    ...normalizeRestaurantProductConfig(normalizedItem as any),
                    id: canonicalLocalProduct.id,
                    sourceItemId:
                        typeof (canonicalLocalProduct as any)?.sourceItemId === 'string' && (canonicalLocalProduct as any).sourceItemId.trim()
                            ? (canonicalLocalProduct as any).sourceItemId.trim()
                            : (typeof (normalizedItem as any)?.sourceItemId === 'string' && (normalizedItem as any).sourceItemId.trim()
                                ? (normalizedItem as any).sourceItemId.trim()
                                : incomingRemoteId),
                    source_item_id:
                        typeof (canonicalLocalProduct as any)?.source_item_id === 'string' && (canonicalLocalProduct as any).source_item_id.trim()
                            ? (canonicalLocalProduct as any).source_item_id.trim()
                            : (typeof (normalizedItem as any)?.source_item_id === 'string' && (normalizedItem as any).source_item_id.trim()
                                ? (normalizedItem as any).source_item_id.trim()
                                : incomingRemoteId),
                    erpProductId:
                        typeof (canonicalLocalProduct as any)?.erpProductId === 'string' && (canonicalLocalProduct as any).erpProductId.trim()
                            ? (canonicalLocalProduct as any).erpProductId.trim()
                            : (typeof (normalizedItem as any)?.erpProductId === 'string' && (normalizedItem as any).erpProductId.trim()
                                ? (normalizedItem as any).erpProductId.trim()
                                : incomingRemoteId),
                };

                const rawId = typeof rawItem?.id === 'string' ? rawItem.id.trim() : String(rawItem?.id || '').trim();
                if (rawId) {
                    duplicateIdsToRemove.add(rawId);
                }
            }

            if (item?.id && incomingRemoteId && incomingRemoteId !== item.id) {
                item = {
                    ...item,
                    sourceItemId:
                        typeof (item as any)?.sourceItemId === 'string' && (item as any).sourceItemId.trim()
                            ? (item as any).sourceItemId.trim()
                            : incomingRemoteId,
                    source_item_id:
                        typeof (item as any)?.source_item_id === 'string' && (item as any).source_item_id.trim()
                            ? (item as any).source_item_id.trim()
                            : incomingRemoteId,
                    erpProductId:
                        typeof (item as any)?.erpProductId === 'string' && (item as any).erpProductId.trim()
                            ? (item as any).erpProductId.trim()
                            : incomingRemoteId,
                };
            }

            if (!item?.id) continue;
            const existingLocalProduct =
                (canonicalLocalProduct?.id && canonicalLocalProduct.id === item.id
                    ? canonicalLocalProduct
                    : localProductsById.get(String(item.id).trim())) || canonicalLocalProduct;

            if (preserveOperationalInventory && existingLocalProduct) {
                item = {
                    ...item,
                    stockBalances:
                        existingLocalProduct.stockBalances && typeof existingLocalProduct.stockBalances === 'object'
                            ? { ...existingLocalProduct.stockBalances }
                            : {},
                    stock: Number.isFinite(Number(existingLocalProduct.stock))
                        ? Number(existingLocalProduct.stock)
                        : Number((item as Product).stock ?? 0),
                };
            }

            item = normalizeRestaurantProductConfig(item as any) as Product;
            if (!preserveOperationalInventory) {
                await this.syncSnapshotProductStocks(item as Product, runtimeWarehouses, existingStocksByProductWarehouse);
            }
            if (posCatalogDebugMatchesRaw(rawItem || item)) {
                posCatalogDebugLog('applySnapshotProducts: saved product', {
                    saved: posCatalogDebugSummarizeItem(item as unknown as Record<string, unknown>),
                });
            }
            for (const candidate of productIdentityCandidates(item as unknown as Record<string, unknown>)) {
                localByIdentity.set(candidate, item as Product);
            }
            localProductsById.set(String(item.id).trim(), item as Product);
            updatedCount += 1;
        }

        for (const duplicateId of duplicateIdsToRemove) {
            localProductsById.delete(duplicateId);
        }

        if (updatedCount > 0 || duplicateIdsToRemove.size > 0) {
            await db.save('products' as any, Array.from(localProductsById.values()));
        }

        this.scheduleImageSyncWorker('products', rawItems as any[], 'applySnapshotProducts');
        posCatalogDebugLog('applySnapshotProducts: image sync scheduled', {
            normalizedCount: normalizedItems.length,
        });
        if (traceRaw.length > 0) {
            await posCatalogDebugLogDbRows('after applySnapshotProducts product apply');
        }

        if (updatedCount > 0) {
            window.dispatchEvent(new CustomEvent('productsUpdated'));
            window.dispatchEvent(new CustomEvent('productStocksUpdated'));
        }

        posCatalogDebugLog('applySnapshotProducts: completed', {
            rawCount: rawItems.length,
            normalizedCount: normalizedItems.length,
            updatedCount,
            duplicateDeletes: duplicateIdsToRemove.size,
            elapsedMs: posCatalogDebugElapsedMs(startedAt),
        });

        return updatedCount;
    }

    private buildSnapshotProductStockLookupKey(productId: string, warehouseId: string): string {
        return `${String(productId || '').trim()}::${String(warehouseId || '').trim()}`;
    }

    private collectSnapshotProductWarehouseIds(
        product: Product,
        runtimeWarehouses: Warehouse[],
        existingStocksByProductWarehouse: Map<string, ProductStock>,
        aliasProductIds: string[] = []
    ): string[] {
        const runtimeWarehouseIds = Array.isArray(runtimeWarehouses)
            ? runtimeWarehouses
                .map((warehouse) => String(warehouse?.id || '').trim())
                .filter(Boolean)
            : [];

        const stockBalances = product?.stockBalances && typeof product.stockBalances === 'object'
            ? product.stockBalances
            : {};

        const productWarehouseIds = [
            ...runtimeWarehouseIds,
            ...Object.keys(stockBalances).map((warehouseId) => String(warehouseId || '').trim()),
            ...(Array.isArray(product?.activeInWarehouses)
                ? product.activeInWarehouses.map((warehouseId) => String(warehouseId || '').trim())
                : []),
            ...(Array.isArray((product as any)?.warehouse_ids)
                ? (product as any).warehouse_ids.map((warehouseId: string) => String(warehouseId || '').trim())
                : []),
        ];

        const productKeyPrefix = `${String(product?.id || '').trim()}::`;
        for (const lookupKey of existingStocksByProductWarehouse.keys()) {
            if (lookupKey.startsWith(productKeyPrefix)) {
                productWarehouseIds.push(lookupKey.slice(productKeyPrefix.length));
            }
        }

        for (const aliasProductId of aliasProductIds) {
            const aliasKeyPrefix = `${String(aliasProductId || '').trim()}::`;
            for (const lookupKey of existingStocksByProductWarehouse.keys()) {
                if (lookupKey.startsWith(aliasKeyPrefix)) {
                    productWarehouseIds.push(lookupKey.slice(aliasKeyPrefix.length));
                }
            }
        }

        return Array.from(new Set(productWarehouseIds.filter(Boolean)));
    }

    private resolveExistingSnapshotProductStock(
        productId: string,
        warehouseId: string,
        aliasProductIds: string[],
        existingStocksByProductWarehouse: Map<string, ProductStock>
    ): ProductStock | undefined {
        const candidateProductIds = [productId, ...aliasProductIds].filter(Boolean);
        for (const candidateProductId of candidateProductIds) {
            const lookupKey = this.buildSnapshotProductStockLookupKey(candidateProductId, warehouseId);
            const existingStock = existingStocksByProductWarehouse.get(lookupKey);
            if (existingStock) {
                return existingStock;
            }
        }
        return undefined;
    }

    private async reconcileSnapshotProductStockAliases(
        canonicalProductId: string,
        aliasProductIds: string[],
        existingStocksByProductWarehouse: Map<string, ProductStock>
    ): Promise<void> {
        const aliases = Array.from(new Set(aliasProductIds.filter(Boolean).filter((alias) => alias !== canonicalProductId)));
        if (aliases.length === 0) {
            return;
        }

        for (const aliasProductId of aliases) {
            const aliasKeyPrefix = `${aliasProductId}::`;
            for (const [lookupKey, stock] of Array.from(existingStocksByProductWarehouse.entries())) {
                if (!lookupKey.startsWith(aliasKeyPrefix)) continue;

                existingStocksByProductWarehouse.delete(lookupKey);

                try {
                    if (stock?.id) {
                        await db.deleteDocument('productStocks', stock.id);
                    }
                } catch (error) {
                    console.warn(`⚠️ SyncManager: could not delete remapped duplicate stock row ${stock?.id}:`, error);
                }
            }
        }
    }

    private async syncSnapshotProductStocks(
        product: Product,
        runtimeWarehouses: Warehouse[],
        existingStocksByProductWarehouse: Map<string, ProductStock>
    ): Promise<void> {
        const productId = String(product?.id || '').trim();
        if (!productId) {
            return;
        }

        const stockBalances = product?.stockBalances && typeof product.stockBalances === 'object'
            ? product.stockBalances
            : {};
        const aliasProductIds = this.collectSnapshotProductAliasIds(product);
        const warehouseIds = this.collectSnapshotProductWarehouseIds(product, runtimeWarehouses, existingStocksByProductWarehouse, aliasProductIds);
        if (warehouseIds.length === 0) {
            return;
        }

        const now = new Date().toISOString();

        for (const warehouseId of warehouseIds) {
            const lookupKey = this.buildSnapshotProductStockLookupKey(productId, warehouseId);
            const existingStock = this.resolveExistingSnapshotProductStock(productId, warehouseId, aliasProductIds, existingStocksByProductWarehouse);
            const qtyPhysical = Number((stockBalances as Record<string, unknown>)?.[warehouseId] ?? 0);
            const qtyCommitted = Number(existingStock?.qtyCommitted ?? 0);
            const nextStock: ProductStock = {
                id: `${productId}_${warehouseId}`,
                productId,
                warehouseId,
                quantity: qtyPhysical,
                qtyPhysical,
                qtyCommitted,
                qtyAvailable: qtyPhysical - qtyCommitted,
                updatedAt: now,
            };

            await db.saveDocument('productStocks', nextStock);
            existingStocksByProductWarehouse.set(lookupKey, nextStock);
        }

        await this.reconcileSnapshotProductStockAliases(productId, aliasProductIds, existingStocksByProductWarehouse);
    }

    private snapshotMasterRows(
        snapshot: unknown,
        key:
            | 'customers'
            | 'suppliers'
            | 'users'
            | 'pos_users'
            | 'roles'
            | 'pos_roles'
            | 'purchaseOrders'
            | 'purchase_orders'
            | 'transfers'
    ): unknown[] | null {
        const masters = snapshot && typeof snapshot === 'object'
            ? (snapshot as Record<string, any>).masters
            : null;

        if (!masters || typeof masters !== 'object') {
            return null;
        }

        if (!Object.prototype.hasOwnProperty.call(masters, key)) {
            return null;
        }

        return Array.isArray((masters as Record<string, unknown>)[key])
            ? ((masters as Record<string, unknown>)[key] as unknown[])
            : [];
    }

    private collectSnapshotMasterRows(
        snapshot: unknown,
        keys: Array<'users' | 'pos_users' | 'roles' | 'pos_roles'>
    ): unknown[] | null {
        let found = false;
        const rows: unknown[] = [];

        for (const key of keys) {
            const snapshotRows = this.snapshotMasterRows(snapshot, key);
            if (snapshotRows === null) continue;
            found = true;
            rows.push(...snapshotRows);
        }

        return found ? rows : null;
    }

    private snapshotText(value: unknown): string {
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return '';
    }

    private snapshotBool(value: unknown): boolean | null {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number' && Number.isFinite(value)) {
            if (value === 1) return true;
            if (value === 0) return false;
        }
        if (typeof value === 'string') {
            const token = value.trim().toLowerCase();
            if (['true', '1', 'yes', 'si', 'sí', 'y'].includes(token)) return true;
            if (['false', '0', 'no', 'n'].includes(token)) return false;
        }
        return null;
    }

    private normalizePosPin(value: unknown): string {
        const raw = this.snapshotText(value);
        const digits = raw.replace(/\D/g, '');
        return /^\d{4}$/.test(digits) ? digits : '';
    }

    private terminalScopeMatches(row: Record<string, unknown>, terminalIds: Array<string | null | undefined>): boolean {
        const scope = this.snapshotText(row.terminal_scope ?? row.terminalScope).toUpperCase();
        const rawTerminalIds = row.terminal_ids ?? row.terminalIds ?? row.terminals ?? row.terminal_id ?? row.terminalId;
        const values = Array.isArray(rawTerminalIds)
            ? rawTerminalIds
            : rawTerminalIds
                ? [rawTerminalIds]
                : [];
        const allowedTerminalIds = values
            .map((entry) => {
                if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
                    const record = entry as Record<string, unknown>;
                    return this.snapshotText(
                        record.id ??
                        record.terminal_id ??
                        record.terminalId ??
                        record.local_terminal_id ??
                        record.localTerminalId ??
                        record.device_id ??
                        record.deviceId
                    );
                }
                return this.snapshotText(entry);
            })
            .filter(Boolean);

        if (scope === 'ALL') {
            return true;
        }

        if (scope !== 'SELECTED' && allowedTerminalIds.length === 0) {
            return true;
        }

        const candidates = new Set(
            terminalIds
                .map((id) => this.snapshotText(id).toLowerCase())
                .filter(Boolean)
        );

        return allowedTerminalIds.some((id) => candidates.has(id.toLowerCase()));
    }

    private normalizeSnapshotRoleId(row: Record<string, unknown>): string {
        const roleObject = row.role && typeof row.role === 'object' && !Array.isArray(row.role)
            ? row.role as Record<string, unknown>
            : {};

        return this.snapshotText(
            row.pos_role_id ??
            row.posRoleId ??
            row.pos_role_code ??
            row.posRoleCode ??
            row.roleId ??
            row.role_id ??
            row.role_code ??
            row.roleCode ??
            roleObject.id ??
            roleObject.code ??
            row.role
        ) || 'CASHIER';
    }

    private normalizeSnapshotPosUser(
        raw: unknown,
        terminalIds: Array<string | null | undefined>
    ): (User & { syncSource?: 'ERP_SNAPSHOT' }) | null {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return null;
        }

        const row = raw as Record<string, unknown>;
        const canOperatePos = this.snapshotBool(
            row.puede_operar_pos ??
            row.can_operate_pos ??
            row.canOperatePos ??
            row.allow_pos_access ??
            row.allowPosAccess ??
            row.pos_enabled ??
            row.posEnabled
        );
        if (canOperatePos === false || !this.terminalScopeMatches(row, terminalIds)) {
            return null;
        }

        const pin = this.normalizePosPin(row.pos_pin ?? row.posPin ?? row.pin ?? row.pin_code ?? row.pinCode);
        if (!pin) {
            return null;
        }

        const id = this.snapshotText(
            row.id ??
            row.user_id ??
            row.userId ??
            row.employee_id ??
            row.employeeId ??
            row.code ??
            row.email ??
            row.username
        );
        const name = this.snapshotText(
            row.name ??
            row.nombre ??
            row.full_name ??
            row.fullName ??
            row.display_name ??
            row.displayName ??
            row.username ??
            row.email
        );
        if (!id || !name) {
            return null;
        }

        const roleId = this.normalizeSnapshotRoleId(row);
        const photo = this.snapshotText(
            row.photo ??
            row.avatar ??
            row.image ??
            row.image_url ??
            row.imageUrl ??
            row.photo_url ??
            row.photoUrl
        );

        return {
            id,
            name,
            pin,
            role: roleId,
            roleId,
            ...(photo ? { photo } : {}),
            syncSource: 'ERP_SNAPSHOT',
        };
    }

    private normalizeSnapshotPermissions(value: unknown, fallback: Permission[]): Permission[] {
        const values = Array.isArray(value)
            ? value
            : typeof value === 'string'
                ? value.split(/[,\s|]+/)
                : [];
        const permissions = Array.from(new Set(
            values
                .map((permission) => this.snapshotText(permission).toUpperCase())
                .filter(Boolean)
        )) as Permission[];

        return permissions.length > 0 ? permissions : fallback;
    }

    private normalizeSnapshotPosRole(raw: unknown): (RoleDefinition & { syncSource?: 'ERP_SNAPSHOT' }) | null {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return null;
        }

        const row = raw as Record<string, unknown>;
        const id = this.snapshotText(
            row.id ??
            row.pos_role_id ??
            row.posRoleId ??
            row.pos_role_code ??
            row.posRoleCode ??
            row.role_id ??
            row.roleId ??
            row.code
        );
        if (!id) {
            return null;
        }

        const fallbackRole = DEFAULT_ROLES.find((role) => role.id === id);
        const name = this.snapshotText(row.name ?? row.nombre ?? row.label ?? row.description) || fallbackRole?.name || id;
        const permissions = this.normalizeSnapshotPermissions(
            row.permissions ?? row.permission_keys ?? row.permissionKeys ?? row.pos_permissions ?? row.posPermissions,
            fallbackRole?.permissions || []
        );
        const maxDiscount = Number(row.maxDiscountPercent ?? row.max_discount_percent ?? fallbackRole?.maxDiscountPercent);
        const isSystem = this.snapshotBool(row.isSystem ?? row.is_system) ?? fallbackRole?.isSystem;

        return {
            ...(fallbackRole || {}),
            id,
            name,
            permissions,
            ...(Number.isFinite(maxDiscount) ? { maxDiscountPercent: maxDiscount } : {}),
            ...(typeof isSystem === 'boolean' ? { isSystem } : {}),
            syncSource: 'ERP_SNAPSHOT',
        };
    }

    private async applySnapshotPosRoles(incomingItems: unknown[]): Promise<number> {
        const normalizedRoles = (Array.isArray(incomingItems) ? incomingItems : [])
            .map((item) => this.normalizeSnapshotPosRole(item))
            .filter(Boolean) as Array<RoleDefinition & { syncSource?: 'ERP_SNAPSHOT' }>;

        if (normalizedRoles.length === 0) {
            return 0;
        }

        const existingRoles = ((await db.get('roles')) as Array<RoleDefinition & { syncSource?: 'ERP_SNAPSHOT' }>) || [];
        const rolesById = new Map<string, RoleDefinition & { syncSource?: 'ERP_SNAPSHOT' }>();
        [...DEFAULT_ROLES, ...(Array.isArray(existingRoles) ? existingRoles : [])].forEach((role) => {
            if (role?.id) rolesById.set(role.id, role as RoleDefinition & { syncSource?: 'ERP_SNAPSHOT' });
        });

        normalizedRoles.forEach((role) => {
            const existing = rolesById.get(role.id);
            rolesById.set(role.id, {
                ...(existing || {}),
                ...role,
                permissions: role.permissions.length > 0 ? role.permissions : existing?.permissions || [],
            });
        });

        await db.save('roles', Array.from(rolesById.values()));
        window.dispatchEvent(new CustomEvent('rolesUpdated'));
        return normalizedRoles.length;
    }

    private async applySnapshotPosUsers(
        incomingItems: unknown[],
        terminalIds: Array<string | null | undefined>,
        replaceSnapshotSet = true
    ): Promise<number> {
        const normalizedUsers = (Array.isArray(incomingItems) ? incomingItems : [])
            .map((item) => this.normalizeSnapshotPosUser(item, terminalIds))
            .filter(Boolean) as Array<User & { syncSource?: 'ERP_SNAPSHOT' }>;
        const incomingIds = new Set(normalizedUsers.map((user) => user.id));
        const existingUsers = ((await db.get('users')) as Array<User & { syncSource?: 'ERP_SNAPSHOT' }>) || [];
        const existingById = new Map<string, User & { syncSource?: 'ERP_SNAPSHOT' }>(
            (Array.isArray(existingUsers) ? existingUsers : [])
                .filter((user) => Boolean(user?.id))
                .map((user) => [user.id, user])
        );
        const nextById = new Map<string, User & { syncSource?: 'ERP_SNAPSHOT' }>();

        (Array.isArray(existingUsers) ? existingUsers : []).forEach((user) => {
            if (!user?.id || incomingIds.has(user.id)) {
                return;
            }
            if (replaceSnapshotSet && user.syncSource === 'ERP_SNAPSHOT') {
                return;
            }
            nextById.set(user.id, user);
        });

        normalizedUsers.forEach((user) => {
            const existing = existingById.get(user.id);
            nextById.set(user.id, {
                ...(existing || {}),
                ...user,
                photo: user.photo || existing?.photo,
                biometrics: existing?.biometrics,
            });
        });

        await db.save('users', Array.from(nextById.values()));
        window.dispatchEvent(new CustomEvent('usersUpdated'));
        return normalizedUsers.length;
    }

    private async applySnapshotImageBackedCollection(
        collection: ImageBackedCollection,
        incomingItems: unknown[]
    ): Promise<number> {
        const cleanItems = (Array.isArray(incomingItems) ? incomingItems : [])
            .map((item) => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) {
                    return null;
                }
                const { _op, ...rest } = item as Record<string, unknown>;
                return rest;
            })
            .filter(Boolean) as Record<string, unknown>[];

        const normalizedItems = await masterDataImageCacheService.normalizeIncomingItems(collection, cleanItems as any[]);
        await db.save(collection, normalizedItems);
        this.scheduleImageSyncWorker(collection, cleanItems as any[], `applySnapshotImageBackedCollection:${collection}`);
        window.dispatchEvent(new CustomEvent(`${collection}Updated`));
        return normalizedItems.length;
    }

    private normalizeSnapshotPurchaseOrderStatus(value: unknown): PurchaseOrder['status'] {
        const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';

        switch (normalized) {
            case 'COMPLETED':
            case 'RECIBIDO':
            case 'CERRADO':
                return 'COMPLETED';
            case 'PARTIAL':
            case 'PARCIAL':
                return 'PARTIAL';
            default:
                return 'ORDERED';
        }
    }

    private normalizeSnapshotPurchaseOrder(raw: unknown): PurchaseOrder | null {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return null;
        }

        const row = raw as Record<string, unknown>;
        const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? row.metadata as Record<string, unknown>
            : {};
        const items = Array.isArray(row.items) ? row.items : [];
        const normalizedItems = items
            .map((entry) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                    return null;
                }

                const line = entry as Record<string, unknown>;
                const productId = typeof line.productId === 'string' ? line.productId.trim() : String(line.productId || line.item_id || '').trim();
                if (!productId) {
                    return null;
                }

                const quantityOrdered = Number(line.quantityOrdered ?? line.quantity_ordered ?? line.cantidad_ordenada ?? line.quantity ?? 0);
                const quantityReceived = Number(line.quantityReceived ?? line.quantity_received ?? line.cantidad_recibida ?? 0);
                const cost = Number(line.cost ?? line.unitCost ?? line.unit_cost ?? line.precio_unitario ?? 0);
                const productName = typeof line.productName === 'string'
                    ? line.productName.trim()
                    : String(line.productName || line.product_name || line.name || '').trim();

                return {
                    productId,
                    productName: productName || productId,
                    quantityOrdered: Number.isFinite(quantityOrdered) ? Math.max(0, quantityOrdered) : 0,
                    quantityReceived: Number.isFinite(quantityReceived) ? Math.max(0, quantityReceived) : 0,
                    cost: Number.isFinite(cost) ? cost : 0,
                    variantSku: typeof line.variantSku === 'string' ? line.variantSku.trim() : undefined,
                    variantInfo: typeof line.variantInfo === 'string' ? line.variantInfo.trim() : undefined,
                };
            })
            .filter(Boolean) as PurchaseOrder['items'];

        const id = typeof row.id === 'string' ? row.id.trim() : String(row.id || '').trim();
        if (!id) {
            return null;
        }

        const status = this.normalizeSnapshotPurchaseOrderStatus(row.status);
        const totalCost = Number(row.totalCost ?? row.total_cost ?? row.totalEstimated ?? row.total_estimated ?? 0);

        return {
            id,
            code: typeof row.code === 'string'
                ? row.code.trim()
                : String(row.code || row.codigo || row.displayId || row.display_id || id).trim(),
            supplierId: typeof row.supplierId === 'string' ? row.supplierId.trim() : String(row.supplierId || row.supplier_id || '').trim(),
            supplierName: typeof row.supplierName === 'string'
                ? row.supplierName.trim()
                : String(row.supplierName || row.supplier_name || '').trim() || undefined,
            warehouseId: typeof row.warehouseId === 'string'
                ? row.warehouseId.trim()
                : String(row.warehouseId || row.warehouse_id || metadata.warehouseId || metadata.warehouse_id || '').trim() || undefined,
            date: typeof row.date === 'string' ? row.date : new Date().toISOString(),
            expectedDate: typeof row.expectedDate === 'string'
                ? row.expectedDate
                : String(row.expectedDate || row.expected_date || row.date || new Date().toISOString()).trim(),
            dueDate: typeof row.dueDate === 'string' ? row.dueDate : String(row.dueDate || row.due_date || '').trim() || undefined,
            status,
            items: normalizedItems,
            totalCost: Number.isFinite(totalCost)
                ? totalCost
                : normalizedItems.reduce((sum, item) => sum + (Number(item.quantityOrdered || 0) * Number(item.cost || 0)), 0),
            sentAt: typeof row.sentAt === 'string' ? row.sentAt : String(row.sentAt || row.sent_at || '').trim() || undefined,
            syncSource: 'ERP_SNAPSHOT',
        };
    }

    private normalizeSnapshotTransfer(raw: unknown): StockTransfer | null {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return null;
        }

        const row = raw as Record<string, unknown>;
        const items = Array.isArray(row.items) ? row.items : [];
        const normalizedItems = items
            .map((entry) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                    return null;
                }

                const line = entry as Record<string, unknown>;
                const productId = typeof line.productId === 'string' ? line.productId.trim() : String(line.productId || line.item_id || '').trim();
                if (!productId) {
                    return null;
                }

                const quantity = Number(line.quantity ?? line.quantity_sent ?? 0);
                const receivedQuantity = Number(line.receivedQuantity ?? line.quantity_received ?? 0);
                const productName = typeof line.productName === 'string'
                    ? line.productName.trim()
                    : String(line.productName || line.product_name || line.name || '').trim();

                return {
                    productId,
                    productName: productName || productId,
                    quantity: Number.isFinite(quantity) ? Math.max(0, quantity) : 0,
                    receivedQuantity: Number.isFinite(receivedQuantity) ? Math.max(0, receivedQuantity) : undefined,
                };
            })
            .filter(Boolean) as StockTransfer['items'];

        const id = typeof row.id === 'string' ? row.id.trim() : String(row.id || '').trim();
        if (!id) {
            return null;
        }

        const rawStatus = typeof row.status === 'string' ? row.status.trim().toUpperCase() : '';

        return {
            id,
            displayId: typeof row.displayId === 'string'
                ? row.displayId.trim()
                : String(row.displayId || row.display_id || '').trim() || undefined,
            sourceWarehouseId: typeof row.sourceWarehouseId === 'string'
                ? row.sourceWarehouseId.trim()
                : String(row.sourceWarehouseId || row.source_warehouse_id || '').trim(),
            destinationWarehouseId: typeof row.destinationWarehouseId === 'string'
                ? row.destinationWarehouseId.trim()
                : String(row.destinationWarehouseId || row.destination_warehouse_id || '').trim(),
            items: normalizedItems,
            status: rawStatus === 'COMPLETED' ? 'COMPLETED' : 'IN_TRANSIT',
            createdAt: typeof row.createdAt === 'string' ? row.createdAt : String(row.createdAt || row.created_at || new Date().toISOString()).trim(),
            sentAt: typeof row.sentAt === 'string' ? row.sentAt : String(row.sentAt || row.sent_at || '').trim() || undefined,
            receivedAt: typeof row.receivedAt === 'string' ? row.receivedAt : String(row.receivedAt || row.received_at || '').trim() || undefined,
            createdBy: typeof row.createdBy === 'string' ? row.createdBy : String(row.createdBy || row.created_by || '').trim() || undefined,
            syncSource: 'ERP_SNAPSHOT',
        };
    }

    private async applySnapshotStructuredCollection<T extends { id: string; syncSource?: 'LOCAL' | 'ERP_SNAPSHOT' }>(
        collection: 'purchaseOrders' | 'transfers',
        incomingItems: unknown[],
        normalize: (item: unknown) => T | null
    ): Promise<number> {
        const normalizedItems = (Array.isArray(incomingItems) ? incomingItems : [])
            .map((item) => normalize(item))
            .filter(Boolean) as T[];
        const incomingIds = new Set(normalizedItems.map((item) => item.id));
        const existingItems = (await db.get(collection)) as Array<T & { syncSource?: 'LOCAL' | 'ERP_SNAPSHOT' }> || [];
        let updatedCount = 0;

        for (const item of normalizedItems) {
            await db.saveDocument(collection, item as any);
            updatedCount += 1;
        }

        const staleIds = existingItems
            .filter((item) => item?.syncSource === 'ERP_SNAPSHOT' && item?.id && !incomingIds.has(item.id))
            .map((item) => item.id);

        for (const staleId of staleIds) {
            await db.deleteDocument(collection, staleId as any);
        }

        if (updatedCount > 0 || staleIds.length > 0) {
            window.dispatchEvent(new CustomEvent(`${collection}Updated`));
        }

        return updatedCount + staleIds.length;
    }

    private async deleteSnapshotStructuredCollection(
        collection: 'purchaseOrders' | 'transfers',
        ids: unknown[]
    ): Promise<number> {
        const normalizedIds = Array.from(new Set(
            (Array.isArray(ids) ? ids : [])
                .map((value) => (typeof value === 'string' ? value.trim() : String(value || '').trim()))
                .filter(Boolean),
        ));

        if (normalizedIds.length === 0) {
            return 0;
        }

        let deletedCount = 0;

        for (const id of normalizedIds) {
            await db.deleteDocument(collection, id as any);
            deletedCount += 1;
        }

        if (deletedCount > 0) {
            window.dispatchEvent(new CustomEvent(`${collection}Updated`));
        }

        return deletedCount;
    }

    private async refreshTerminalStructuredMasterData(
        snapshot: unknown,
        catalogDelta?: Record<string, unknown> | null,
        options?: {
            terminalIds?: Array<string | null | undefined>;
        }
    ): Promise<{
        users: number;
        roles: number;
        categories: number;
        productGroups: number;
        purchaseOrders: number;
        transfers: number;
    }> {
        const startedAt = posCatalogDebugNow();
        const results = {
            users: 0,
            roles: 0,
            categories: 0,
            productGroups: 0,
            purchaseOrders: 0,
            transfers: 0,
        };

        const catalogClassificationResults = await this.applyTerminalCatalogClassifications(snapshot);
        results.categories = catalogClassificationResults.categories;
        results.productGroups = catalogClassificationResults.productGroups;

        const roleRows = this.collectSnapshotMasterRows(snapshot, ['pos_roles', 'roles']);
        if (roleRows !== null) {
            results.roles = await this.applySnapshotPosRoles(roleRows);
        }

        const userRows = this.collectSnapshotMasterRows(snapshot, ['pos_users', 'users']);
        if (userRows !== null) {
            results.users = await this.applySnapshotPosUsers(userRows, options?.terminalIds || []);
        }

        const collections: Array<{
            resultKey: 'purchaseOrders' | 'transfers';
            collection: 'purchaseOrders' | 'transfers';
            snapshotKeys: Array<'purchaseOrders' | 'purchase_orders' | 'transfers'>;
            upsertKeys: string[];
            deleteKeys: string[];
            normalize: (item: unknown) => PurchaseOrder | StockTransfer | null;
        }> = [
            {
                resultKey: 'purchaseOrders',
                collection: 'purchaseOrders',
                snapshotKeys: ['purchaseOrders', 'purchase_orders'],
                upsertKeys: ['purchase_orders_upsert', 'purchaseOrders_upsert'],
                deleteKeys: ['purchase_orders_delete', 'purchaseOrders_delete'],
                normalize: this.normalizeSnapshotPurchaseOrder.bind(this),
            },
            {
                resultKey: 'transfers',
                collection: 'transfers',
                snapshotKeys: ['transfers'],
                upsertKeys: ['transfers_upsert'],
                deleteKeys: ['transfers_delete'],
                normalize: this.normalizeSnapshotTransfer.bind(this),
            },
        ];

        for (const entry of collections) {
            const deltaUpsert = entry.upsertKeys.find((key) => Array.isArray((catalogDelta as Record<string, unknown> | null)?.[key]));
            const deltaDelete = entry.deleteKeys.find((key) => Array.isArray((catalogDelta as Record<string, unknown> | null)?.[key]));

            if (deltaUpsert || deltaDelete) {
                const upserted = deltaUpsert
                    ? await this.applySnapshotStructuredCollection(
                        entry.collection,
                        ((catalogDelta as Record<string, unknown>)[deltaUpsert] as unknown[]) || [],
                        entry.normalize as (item: unknown) => any,
                    )
                    : 0;
                const deleted = deltaDelete
                    ? await this.deleteSnapshotStructuredCollection(
                        entry.collection,
                        ((catalogDelta as Record<string, unknown>)[deltaDelete] as unknown[]) || [],
                    )
                    : 0;
                results[entry.resultKey] = upserted + deleted;
                continue;
            }

            let snapshotRows: unknown[] | null = null;
            for (const key of entry.snapshotKeys) {
                snapshotRows = this.snapshotMasterRows(snapshot, key);
                if (snapshotRows !== null) {
                    break;
                }
            }

            if (snapshotRows !== null) {
                results[entry.resultKey] = await this.applySnapshotStructuredCollection(
                    entry.collection,
                    snapshotRows,
                    entry.normalize as (item: unknown) => any,
                );
            }
        }

        posCatalogDebugLog('refreshTerminalResolvedConfig: structured master data complete', {
            users: results.users,
            roles: results.roles,
            categories: results.categories,
            productGroups: results.productGroups,
            purchaseOrders: results.purchaseOrders,
            transfers: results.transfers,
            elapsedMs: posCatalogDebugElapsedMs(startedAt),
        });

        return results;
    }

    private async applyTerminalCatalogClassifications(snapshot: unknown): Promise<{ categories: number; productGroups: number }> {
        const root = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
            ? snapshot as Record<string, any>
            : {};
        const terminalConfig = root.terminal_config && typeof root.terminal_config === 'object' && !Array.isArray(root.terminal_config)
            ? root.terminal_config as Record<string, any>
            : root.terminalConfig && typeof root.terminalConfig === 'object' && !Array.isArray(root.terminalConfig)
                ? root.terminalConfig as Record<string, any>
                : {};
        const resolvedSource = root.resolved || terminalConfig.resolved;
        const resolved = resolvedSource && typeof resolvedSource === 'object' && !Array.isArray(resolvedSource)
            ? resolvedSource as Record<string, any>
            : {};
        const catalogSource = resolved.catalog || root.catalog || terminalConfig.catalog;
        const catalog = catalogSource && typeof catalogSource === 'object' && !Array.isArray(catalogSource)
            ? catalogSource as Record<string, any>
            : {};
        const classificationsSource = catalog.classifications || resolved.classifications || root.classifications || terminalConfig.classifications;
        const classifications = classificationsSource && typeof classificationsSource === 'object' && !Array.isArray(classificationsSource)
            ? classificationsSource as Record<string, any>
            : {};
        const categoryRows = Array.isArray(catalog.allowed_categories)
            ? catalog.allowed_categories
            : Array.isArray(catalog.allowedCategories)
                ? catalog.allowedCategories
                : Array.isArray(catalog.categories)
                    ? catalog.categories
                    : Array.isArray(catalog.product_categories)
                        ? catalog.product_categories
                        : Array.isArray(catalog.productCategories)
                            ? catalog.productCategories
                            : [];
        const productGroupRows = Array.isArray(catalog.product_groups)
            ? catalog.product_groups
            : Array.isArray(catalog.productGroups)
                ? catalog.productGroups
                : Array.isArray(catalog.groups)
                    ? catalog.groups
                    : [];
        const pickRows = (...values: unknown[]): unknown[] => {
            for (const value of values) {
                if (Array.isArray(value)) return value;
            }
            return [];
        };
        const findFirstRowsByKey = (source: unknown, keyNames: string[], maxDepth = 5): unknown[] => {
            const wanted = new Set(keyNames.map(key => key.toLowerCase()));
            const visited = new Set<unknown>();
            const queue: Array<{ value: unknown; depth: number }> = [{ value: source, depth: 0 }];

            while (queue.length > 0) {
                const { value, depth } = queue.shift()!;
                if (!value || typeof value !== 'object' || visited.has(value) || depth > maxDepth) continue;
                visited.add(value);

                if (Array.isArray(value)) {
                    for (const item of value) queue.push({ value: item, depth: depth + 1 });
                    continue;
                }

                const record = value as Record<string, unknown>;
                for (const [key, child] of Object.entries(record)) {
                    if (wanted.has(key.toLowerCase()) && Array.isArray(child)) {
                        return child;
                    }
                }
                for (const child of Object.values(record)) {
                    if (child && typeof child === 'object') {
                        queue.push({ value: child, depth: depth + 1 });
                    }
                }
            }

            return [];
        };
        const pickRowsDeep = (keyNames: string[], ...values: unknown[]): unknown[] => {
            const direct = pickRows(...values);
            if (direct.length > 0) return direct;
            return findFirstRowsByKey(root, keyNames);
        };

        const normalizeName = (value: unknown): string => {
            if (typeof value === 'string') return value.trim();
            if (typeof value === 'number' && Number.isFinite(value)) return String(value);
            return '';
        };
        const normalizeClassificationRows = (rows: unknown[], fallbackPrefix: string) => {
            const byId = new Map<string, any>();
            for (const [index, entry] of rows.entries()) {
                const record = entry && typeof entry === 'object' && !Array.isArray(entry)
                    ? entry as Record<string, any>
                    : {};
                const name = normalizeName(record.name || record.nombre || record.label || record.description || record.descripcion || record.code || entry);
                if (!name) continue;
                const id = normalizeName(record.id || record.uuid || record.code || `${fallbackPrefix}-${index + 1}`);
                const code = normalizeName(record.code || record.codigo || id || name);
                byId.set(id || code || name, {
                    id: id || code || name,
                    code: code || id || name,
                    name,
                    parentId: normalizeName(record.parentId || record.parent_id || record.parent || record.parentCode || record.parent_code) || undefined,
                    source: 'ERP_TERMINAL_CONFIG',
                    syncSource: 'ERP_SNAPSHOT',
                    updatedAt: new Date().toISOString(),
                });
            }
            return Array.from(byId.values()).sort((left, right) => String(left.name).localeCompare(String(right.name)));
        };
        const normalizeRefs = (value: unknown): string[] => {
            const rawItems = Array.isArray(value) ? value : [];
            return Array.from(new Set(rawItems.map((item) => {
                if (typeof item === 'string') return item.trim();
                if (typeof item === 'number' && Number.isFinite(item)) return String(item);
                if (item && typeof item === 'object' && !Array.isArray(item)) {
                    const record = item as Record<string, any>;
                    return normalizeName(record.id || record.productId || record.product_id || record.itemId || record.item_id || record.sku || record.code || record.barcode);
                }
                return '';
            }).filter(Boolean)));
        };

        let changed = false;
        let categories = 0;
        let productGroups = 0;
        const departments = normalizeClassificationRows(
            pickRowsDeep(
                ['departments', 'departamentos', 'product_departments', 'productDepartments', 'item_departments', 'itemDepartments'],
                catalog.departments,
                catalog.departamentos,
                classifications.departments,
                classifications.departamentos
            ),
            'erp-department'
        );
        const sections = normalizeClassificationRows(
            pickRowsDeep(
                ['sections', 'secciones', 'product_sections', 'productSections', 'item_sections', 'itemSections'],
                catalog.sections,
                catalog.secciones,
                classifications.sections,
                classifications.secciones
            ),
            'erp-section'
        );
        const families = normalizeClassificationRows(
            pickRowsDeep(
                ['families', 'familias', 'family_list', 'familyList', 'product_families', 'productFamilies', 'item_families', 'itemFamilies'],
                catalog.families,
                catalog.familias,
                catalog.product_families,
                catalog.productFamilies,
                classifications.families,
                classifications.familias
            ),
            'erp-family'
        );
        const subfamilies = normalizeClassificationRows(
            pickRowsDeep(
                ['subfamilies', 'sub_families', 'subFamilies', 'subfamilias', 'sub_familias', 'product_subfamilies', 'productSubfamilies', 'item_subfamilies', 'itemSubfamilies'],
                catalog.subfamilies,
                catalog.sub_families,
                catalog.subFamilies,
                catalog.subfamilias,
                catalog.product_subfamilies,
                catalog.productSubfamilies,
                classifications.subfamilies,
                classifications.subfamilias
            ),
            'erp-subfamily'
        );
        const brands = normalizeClassificationRows(
            pickRowsDeep(
                ['brands', 'marcas', 'product_brands', 'productBrands', 'item_brands', 'itemBrands'],
                catalog.brands,
                catalog.marcas,
                classifications.brands,
                classifications.marcas
            ),
            'erp-brand'
        );
        const posCategories = normalizeClassificationRows(categoryRows, 'erp-pos-category');

        for (const [index, entry] of categoryRows.entries()) {
            const record = entry && typeof entry === 'object' && !Array.isArray(entry)
                ? entry as Record<string, any>
                : {};
            const name = normalizeName(record.name || record.nombre || record.label || record.description || record.descripcion || entry);
            if (!name) continue;
            const code = normalizeName(record.code || record.id || name);
            await db.saveDocument('categories' as any, {
                id: normalizeName(record.id) || code || `erp-category-${index + 1}`,
                code: code || name,
                name,
                description: normalizeName(record.description || record.descripcion) || undefined,
                source: 'ERP_TERMINAL_CONFIG',
                syncSource: 'ERP_SNAPSHOT',
                updatedAt: new Date().toISOString(),
            } as any);
            categories += 1;
            changed = true;
        }

        for (const [index, entry] of productGroupRows.entries()) {
            const record = entry && typeof entry === 'object' && !Array.isArray(entry)
                ? entry as Record<string, any>
                : {};
            const id = normalizeName(record.id || record.groupId || record.group_id || record.code || `erp-product-group-${index + 1}`);
            const name = normalizeName(record.name || record.nombre || record.label || record.description || record.descripcion || record.code || id);
            if (!id || !name) continue;
            await db.saveDocument('productGroups' as any, {
                id,
                code: normalizeName(record.code) || id,
                name,
                color: normalizeName(record.color) || undefined,
                description: normalizeName(record.description || record.descripcion) || undefined,
                productIds: normalizeRefs(record.productIds ?? record.product_ids ?? record.items ?? record.products),
                source: 'ERP_TERMINAL_CONFIG',
                syncSource: 'ERP_SNAPSHOT',
                updatedAt: new Date().toISOString(),
            } as any);
            productGroups += 1;
            changed = true;
        }

        let nextConfigWithClassifications: Record<string, any> | null = null;
        if (
            departments.length > 0 ||
            sections.length > 0 ||
            families.length > 0 ||
            subfamilies.length > 0 ||
            brands.length > 0 ||
            posCategories.length > 0
        ) {
            const currentConfig = ((await db.get('config')) || {}) as Record<string, any>;
            const nextConfig = {
                ...currentConfig,
                departments: departments.length > 0 ? departments : currentConfig.departments,
                sections: sections.length > 0 ? sections : currentConfig.sections,
                families: families.length > 0 ? families : currentConfig.families,
                subfamilies: subfamilies.length > 0 ? subfamilies : currentConfig.subfamilies,
                brands: brands.length > 0 ? brands : currentConfig.brands,
                posCategories: posCategories.length > 0 ? posCategories : currentConfig.posCategories,
            };
            await db.save('config', nextConfig);
            nextConfigWithClassifications = nextConfig;
            changed = true;
        }

        if (changed) {
            window.dispatchEvent(new CustomEvent('categoriesUpdated'));
            window.dispatchEvent(new CustomEvent('productGroupsUpdated'));
            if (nextConfigWithClassifications) {
                window.dispatchEvent(new CustomEvent('configUpdated', { detail: nextConfigWithClassifications }));
            }
            posCatalogDebugLog('POS_CLASSIFICATIONS_RESOLVED_FROM_TERMINAL_CONFIG', {
                categories,
                productGroups,
                departments: departments.length,
                sections: sections.length,
                families: families.length,
                subfamilies: subfamilies.length,
                brands: brands.length,
                posCategories: posCategories.length,
                catalogKeys: Object.keys(catalog),
            });
        }

        return { categories, productGroups };
    }

    private async refreshTerminalSupplementalMasterData(
        snapshot: unknown,
        catalogDelta?: Record<string, unknown> | null
    ): Promise<{
        customers: number;
        suppliers: number;
    }> {
        const startedAt = posCatalogDebugNow();
        const collections: ImageBackedCollection[] = ['customers', 'suppliers'];
        const results: Record<ImageBackedCollection, number> = {
            customers: 0,
            suppliers: 0,
        };

        for (const collection of collections) {
            const deltaHasCollection =
                Boolean(catalogDelta) &&
                (
                    Array.isArray((catalogDelta as Record<string, unknown>)[`${collection}_upsert`]) ||
                    Array.isArray((catalogDelta as Record<string, unknown>)[`${collection}_delete`])
                );

            if (deltaHasCollection) {
                continue;
            }

            const snapshotRows = this.snapshotMasterRows(snapshot, collection);

            // An empty array can mean that the terminal config snapshot was
            // persisted without this master scope. It must not suppress the
            // collection pull, especially when the manifest reports records.
            if (snapshotRows !== null && snapshotRows.length > 0) {
                results[collection] = await this.applySnapshotImageBackedCollection(collection, snapshotRows);
                continue;
            }

            try {
                results[collection] = await this.pullCatalog(collection, false, { ignoreThrottle: true });
            } catch (error) {
                console.warn(`⚠️ SyncManager: Could not pull ${collection} after terminal config refresh:`, error);
            }
        }

        posCatalogDebugLog('refreshTerminalResolvedConfig: supplemental master data complete', {
            customers: results.customers,
            suppliers: results.suppliers,
            elapsedMs: posCatalogDebugElapsedMs(startedAt),
        });

        return results;
    }

    private isRecoveringConnection = false;

    /**
     * AUTO-DISCOVERY: Recover connection by scanning local network
     */
    private async startRecoveryProcess() {
        if (this.isRecoveringConnection || this.isMaster) return;
        this.isRecoveringConnection = true;

        // Notify UI
        window.dispatchEvent(new CustomEvent('sync:reconnecting', { detail: { status: 'searching' } }));

        const savedMasterUrl = localStorage.getItem('CLIC_POS_MASTER_URL');
        const currentIp = savedMasterUrl ? new URL(savedMasterUrl).hostname : null;

        console.log(`🕵️‍♂️ Auto-Discovery: Starting scan. Last successful IP: ${currentIp}`);

        // Delegate scanning to NetworkScanner
        const foundUrl = await NetworkScanner.findMaster(currentIp || undefined);

        if (foundUrl) {
            console.log(`🎉 Auto-Discovery: MASTER FOUND at ${foundUrl}`);
            this.finalizeRecovery(foundUrl);
        } else {
            console.warn('❌ Auto-Discovery: Could not find Master. Waiting for manual retry.');
            window.dispatchEvent(new CustomEvent('sync:reconnecting', { detail: { status: 'failed' } }));
            this.isRecoveringConnection = false;
        }
    }

    private finalizeRecovery(url: string) {
        const normalizedUrl = this.normalizeMasterUrlForStorage(url) || url;
        localStorage.setItem('CLIC_POS_MASTER_URL', normalizedUrl);

        // Legacy support
        try {
            const urlObj = new URL(normalizedUrl);
            localStorage.setItem('pos_master_ip', urlObj.hostname);
        } catch (e) {
            // Ignore
        }

        if (this.syncConfig) {
            this.syncConfig.masterUrl = url;
        }

        // Critical: Reset Adapter & Circuit Breaker
        apiSyncAdapter.updateMasterUrl(normalizedUrl);
        apiSyncAdapter.resetCircuit();

        // Notify UI
        window.dispatchEvent(new CustomEvent('sync:reconnecting', { detail: { status: 'connected', url } }));

        // Resume Sync
        this.isRecoveringConnection = false;

        // Force immediate sync
        setTimeout(() => {
            console.log('🔄 SyncManager: Triggering immediate post-recovery sync.');
            this.checkForUpdates().then((updates) => {
                if (updates.length > 0) this.syncAllCatalogs();
            });
        }, 1000);
    }

    private loadProductImageSyncState() {
        try {
            const rawHashes = localStorage.getItem('sync_product_image_hashes');
            if (rawHashes) {
                const parsed = JSON.parse(rawHashes);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    this.productImageHashes = new Map(
                        Object.entries(parsed)
                            .filter(([id, hash]) => typeof id === 'string' && typeof hash === 'string')
                            .map(([id, hash]) => [id, hash as string])
                    );
                }
            }
        } catch (error) {
            console.warn('⚠️ Could not load local image hash state, rebuilding cache.', error);
            this.productImageHashes.clear();
        }

        const savedVersion = localStorage.getItem('sync_version_product_images');
        this.lastProductImageManifestVersion = savedVersion ? parseInt(savedVersion, 10) || 0 : 0;
    }

    private persistProductImageSyncState() {
        const serialized: Record<string, string> = {};
        for (const [id, hash] of this.productImageHashes.entries()) {
            serialized[id] = hash;
        }
        localStorage.setItem('sync_product_image_hashes', JSON.stringify(serialized));
        localStorage.setItem('sync_version_product_images', this.lastProductImageManifestVersion.toString());
    }




    private attachImageSyncReconnectHandler() {
        if (this.imageSyncOnlineHandler) return;
        this.imageSyncOnlineHandler = () => {
            if (this.reducedSyncMode) return;
            this.syncProductImages({ forceManifestCheck: true }).catch((error) => {
                console.warn('⚠️ Image sync on reconnect failed:', error);
            });
        };
        window.addEventListener('online', this.imageSyncOnlineHandler);
    }

    private detachImageSyncReconnectHandler() {
        if (!this.imageSyncOnlineHandler) return;
        window.removeEventListener('online', this.imageSyncOnlineHandler);
        this.imageSyncOnlineHandler = null;
    }

    private startImageSync(intervalMs: number = this.IMAGE_SYNC_INTERVAL_MS) {
        if (this.imageSyncInterval) {
            clearInterval(this.imageSyncInterval);
        }

        this.imageSyncInterval = setInterval(() => {
            if (this.reducedSyncMode) return;
            this.syncProductImages().catch((error) => {
                console.warn('⚠️ Scheduled image sync failed:', error);
            });
        }, intervalMs);

        console.log(`🖼️ Image auto-sync started (${intervalMs / 1000}s interval)`);
    }

    private async syncProductImages(options?: { forceManifestCheck?: boolean }): Promise<number> {
        if (this.isDisabled) return 0;
        if (this.imageSyncInProgress) return 0;
        if (permissionService.isMasterTerminal()) return 0;
        if (!this.syncConfig?.masterUrl || !navigator.onLine) return 0;

        this.imageSyncInProgress = true;

        try {
            const localProducts = await db.get('products') as Product[];
            if (!Array.isArray(localProducts) || localProducts.length === 0) return 0;

            const localById = new Map(localProducts.filter(p => p?.id).map(p => [p.id, p]));
            const manifestResult = await apiSyncAdapter.fetchImageManifest(
                options?.forceManifestCheck ? undefined : this.lastProductImageManifestVersion
            );

            if (typeof manifestResult.version === 'number') {
                this.lastProductImageManifestVersion = manifestResult.version;
            }

            if (manifestResult.upToDate && !options?.forceManifestCheck) {
                this.persistProductImageSyncState();
                return 0;
            }

            const manifestById = new Map<string, ProductImageManifestItem>();
            const idsToFetch: string[] = [];

            for (const item of manifestResult.items || []) {
                if (!item?.id) continue;
                const localProduct = localById.get(item.id);
                if (!localProduct) continue;
                const hasRemoteImageUrl = typeof localProduct.imageUrl === 'string' && localProduct.imageUrl.trim().length > 0;
                const hasCompletedNativeImageCache = isNativeAndroidRuntime() && typeof localProduct.imageLocalPath === 'string' && localProduct.imageLocalPath.trim().length > 0;
                const hasCompletedWebImage = !isNativeAndroidRuntime() && this.hasAnyImage(localProduct);
                if (hasRemoteImageUrl && (hasCompletedNativeImageCache || hasCompletedWebImage)) {
                    if (item.hash) {
                        this.productImageHashes.set(item.id, item.hash);
                    }
                    continue;
                }

                manifestById.set(item.id, item);
                const cachedHash = this.productImageHashes.get(item.id);
                const localHasImage = this.hasAnyImage(localProduct);
                const shouldFetch = cachedHash !== item.hash || localHasImage !== !!item.hasImage;

                if (shouldFetch) {
                    idsToFetch.push(item.id);
                }
            }

            for (const cachedId of Array.from(this.productImageHashes.keys())) {
                if (!localById.has(cachedId)) {
                    this.productImageHashes.delete(cachedId);
                }
            }

            if (idsToFetch.length === 0) {
                for (const [id, item] of manifestById.entries()) {
                    this.productImageHashes.set(id, item.hash);
                }
                this.persistProductImageSyncState();
                return 0;
            }

            let updatedCount = 0;
            for (let i = 0; i < idsToFetch.length; i += this.IMAGE_SYNC_BATCH_SIZE) {
                const chunk = idsToFetch.slice(i, i + this.IMAGE_SYNC_BATCH_SIZE);
                const payload = await apiSyncAdapter.pullImages(chunk);
                const payloadById = new Map<string, ProductImagePayloadItem>(
                    payload.filter(item => item?.id).map(item => [item.id, item])
                );

                for (const id of chunk) {
                    const remote = payloadById.get(id);
                    const manifestItem = manifestById.get(id);
                    const localProduct = localById.get(id);
                    if (!localProduct) continue;

                    if (!remote) {
                        if (manifestItem) {
                            this.productImageHashes.set(id, manifestItem.hash);
                        }
                        continue;
                    }

                    const remoteImage = this.normalizeImage(remote.image);
                    const remoteImages = this.normalizeImages(remote.images);
                    const localImage = this.normalizeImage(localProduct.image);
                    const localImages = this.normalizeImages(localProduct.images);

                    const imageChanged = localImage !== remoteImage;
                    const imagesChanged = !this.imageArraysEqual(localImages, remoteImages);

                    if (imageChanged || imagesChanged) {
                        const updatedProduct: Product = {
                            ...localProduct,
                            image: remoteImage || undefined,
                            images: remoteImages,
                            updatedAt: remote.updatedAt || localProduct.updatedAt
                        };
                        await db.saveDocument('products', updatedProduct);
                        localById.set(id, updatedProduct);
                        updatedCount++;
                    }

                    if (remote.hash) {
                        this.productImageHashes.set(id, remote.hash);
                    } else if (manifestItem) {
                        this.productImageHashes.set(id, manifestItem.hash);
                    }
                }
            }

            for (const [id, item] of manifestById.entries()) {
                this.productImageHashes.set(id, item.hash);
            }
            this.persistProductImageSyncState();

            if (updatedCount > 0) {
                console.log(`🖼️ Image sync updated ${updatedCount} products`);
                window.dispatchEvent(new CustomEvent('productsUpdated'));
            }

            return updatedCount;
        } finally {
            this.imageSyncInProgress = false;
        }
    }

    private normalizeImage(image: any): string | null {
        return typeof image === 'string' && image.trim().length > 0 ? image : null;
    }

    private normalizeImages(images: any): string[] {
        if (!Array.isArray(images)) return [];
        return images.filter(img => typeof img === 'string' && img.trim().length > 0);
    }

    private hasAnyImage(product: Pick<Product, 'image' | 'images'>): boolean {
        return !!this.normalizeImage(product.image) || this.normalizeImages(product.images).length > 0;
    }

    private imageArraysEqual(a: string[], b: string[]): boolean {
        return a.length === b.length && a.every((value, idx) => value === b[idx]);
    }



    private lastRecoveryTime: Map<string, number> = new Map();

    /**
     * Restore Master data from Server if local is empty
     * This handles the case where Master storage is wiped (e.g. new origin) but Server has data.
     */
    private async initializeMasterData() {
        const collections: SyncableCollection[] = ['internalSequences', 'fiscalRanges', 'products', 'customers', 'suppliers', 'paymentMethods'];

        // Detect stale local master snapshot...
        // ... (skipping severe drift catalog check for brevity in this specific patch as requested focus is on the loop) ...

        for (const collection of collections) {
            // 🛡️ COOLDOWN: Prevent recovery loop (5 minutes)
            const lastRun = this.lastRecoveryTime.get(collection) || 0;
            if (Date.now() - lastRun < 300000) {
                continue;
            }

            const localData = await db.get(collection as any);
            const localCount = Array.isArray(localData) ? localData.length : 0;
            const isEmpty = localCount === 0;

            let remoteCount = 0;
            try {
                const metadata = await apiSyncAdapter.getMetadata(collection);
                remoteCount = metadata?.itemCount || 0;
            } catch {
                // Ignore metadata failures here
            }

            // ✅ FIX: equality check. If synchronized, DO NOT trigger recovery.
            if (localCount === remoteCount && remoteCount > 0) {
                continue;
            }

            // Also check if it only contains defaults (for sequences)
            // If we have very few items, we might want to check server
            const isMinimal = localCount <= 3;
            const hasSevereDrift = remoteCount > 0 && localCount < Math.floor(remoteCount * 0.5);

            if (isEmpty || (isMinimal && remoteCount > 5) || hasSevereDrift) {
                console.log(
                    `🔍 Master Init: Recovery needed for ${collection} ` +
                    `(local=${localCount}, remote=${remoteCount}). Checking server...`
                );

                this.lastRecoveryTime.set(collection, Date.now()); // Set cooldown

                try {
	                    // Reset cursor so delta endpoint returns full snapshot.
	                    this.syncVersions.set(collection, 0);
	                    localStorage.setItem(`sync_version_${collection}`, '0');
	                    if (isTimestampCursorCollection(collection)) {
	                        this.clearTimestampCursorState(collection);
	                    }

                    const pulled = await this.pullCatalog(collection);
                    if (pulled > 0) {
                        continue;
                    }

                    // Fallback: direct full pull in case delta cursor path returned nothing.
                    const serverItems = await apiSyncAdapter.pull(collection);
                    if (serverItems && serverItems.length > localCount) {
                        console.log(`📥 Master Init: Restoring ${serverItems.length} items from Server for ${collection}`);
                        await db.save(collection as any, serverItems);

                        // Update version
                        const metadata = await apiSyncAdapter.getMetadata(collection);
                        if (metadata) {
                            this.syncVersions.set(collection, metadata.version);
                        }
                    }
                } catch (error: unknown) {
                    console.error(`⚠️ Master Init: Could not restore ${collection}:`, error);
                    // Standard error logging only
                }
            }
        }
    }

    // Removed setupStorageListener - no longer needed for API-based sync

    /**
     * Load local sync versions from storage
     * For API mode, we track versions locally
     */
    private async loadSyncVersions() {
	        const collections: (SyncableCollection | 'config')[] = [
	            'products',
	            'items',
	            'taxes',
            'customers',
            'suppliers',
            'warehouses',
            'paymentMethods',
            'productPrices',
            'categories',
            'productCategories',
            'productGroups',
            'collections',
            'users',
            'roles',
            'documentSeries',
            'fiscalRanges',
            'fiscalSequences',
            'internalSequences',
            'terminalFiscalConfig',
            'config',
        ];

        for (const collection of collections) {
            // Load timestamp from localStorage
            const savedTimestamp = localStorage.getItem(`sync_timestamp_${collection}`);
            if (savedTimestamp) {
                this.syncTimestamps.set(collection, savedTimestamp);
            }

            // Load local version cursor (authoritative for delta)
            const savedVersion = localStorage.getItem(`sync_version_${collection}`);
            if (savedVersion) {
                this.syncVersions.set(collection, parseInt(savedVersion));
            } else {
                this.syncVersions.set(collection, 0);
            }

            // Optionally warm metadata for UI (does not overwrite local cursor)
            if (!this.isMaster && this.syncConfig?.masterUrl) {
                try {
                    await apiSyncAdapter.getMetadata(collection);
                } catch {
                    // Ignore metadata errors on init
                }
            }
        }
    }

    /**
     * Push catalog data to sync storage (Master only)
     * Now uses API instead of localStorage
     */
    async pushCatalog(collection: SyncableCollection): Promise<void> {
        if (this.isDisabled) return;

        if (!permissionService.isMasterTerminal() && collection !== 'internalSequences') {
            console.warn(`⚠️  Slave terminal cannot push ${collection}`);
            return;
        }

        // 🛡️ RECURSIVE LOOP GUARD
        if (this.isInternalPulling) {
            console.log(`[PUSH_CANCELADO] Cambio local detectado durante un PULL en ${collection}. Evitando bucle.`);
            return;
        }

        try {
            const data = await db.get(collection as any);
            const items = Array.isArray(data) ? data : [];
            if (items.length === 0) {
                console.warn(`[SYNC_CATALOG_SKIP] pushCatalog collection=${collection} skipped: local dataset empty`);
                return;
            }

            // Push to server API
            // const timestamp = new Date().toISOString();
            // console.log(`[PUSH_DISPARADO] ${timestamp} Enviando cambio al Master: ${items.length} items in ${collection}`);

            await apiSyncAdapter.push(collection, items, 'BULK_UPDATE', 'FULL_REPLACE');

            // Update local version tracking
            const metadata = await apiSyncAdapter.getMetadata(collection);
            if (metadata) {
                this.syncVersions.set(collection, metadata.version);
            }

            // console.log(`✅ SyncManager: Pushed ${items.length} items from ${collection}`);
        } catch (error: any) {
            if (error.message === 'Cannot push while offline') {
                console.warn(`⚠️ SyncManager: Pushing ${collection} deferred (Offline)`);
            } else {
                console.error(`❌ SyncManager: Error pushing ${collection}:`, error);
            }
            throw error;
        }
    }

    private isInternalSyncing: boolean = false;
    private isInternalPulling: boolean = false; // MUTE DURING PULL
    private lastSyncTime: number = 0;
    private readonly MIN_SYNC_INTERVAL_MS = 5000; // 5 seconds debounce
    private watchdogTimer: any = null;
    private readonly WATCHDOG_TIMEOUT_MS = 45000; // 45 seconds max sync time

    /**
     * Prevent local credit-note/refund data loss during full transaction pulls.
     * Full snapshots can be stale while a refund is still syncing.
     */
    private async mergeTransactionsFullSnapshot(serverItems: any[]): Promise<any[]> {
        if (!Array.isArray(serverItems)) return [];

        const normalizeText = (value: any) =>
            typeof value === 'string' ? value.trim().toUpperCase() : '';
        const toTimestamp = (value?: string) => {
            const ts = value ? new Date(value).getTime() : NaN;
            return Number.isFinite(ts) ? ts : 0;
        };
        const isPendingSync = (value: any) =>
            ['PENDING', 'ERROR', 'SYNCING'].includes(normalizeText(value));
        const isCreditNoteLike = (tx: any) => {
            const docType = normalizeText(tx?.documentType);
            const ncfType = normalizeText(tx?.ncfType);
            const status = normalizeText(tx?.status);
            return docType === 'REFUND' || ncfType === 'B04' || status === 'PARTIAL_REFUND';
        };

        const localTransactions = (await db.get('transactions' as any)) as any[] || [];
        const mergedById = new Map<string, any>();

        for (const tx of serverItems) {
            if (!tx?.id) continue;
            mergedById.set(tx.id, tx);
        }

        for (const localTx of localTransactions) {
            if (!localTx?.id) continue;
            if (!isCreditNoteLike(localTx) && !isPendingSync(localTx?.syncStatus)) continue;

            const existing = mergedById.get(localTx.id);
            if (!existing) {
                mergedById.set(localTx.id, localTx);
                continue;
            }

            const localTs = Math.max(toTimestamp(localTx?.updatedAt), toTimestamp(localTx?.date));
            const remoteTs = Math.max(toTimestamp(existing?.updatedAt), toTimestamp(existing?.date));
            if (localTs >= remoteTs) {
                mergedById.set(localTx.id, { ...existing, ...localTx });
            }
        }

        return Array.from(mergedById.values()).sort((a, b) => {
            const aTs = toTimestamp(a?.date);
            const bTs = toTimestamp(b?.date);
            return bTs - aTs;
        });
    }

    private async mirrorDocumentSeriesToInternalSequences(items: any[]): Promise<void> {
        const config = (await db.get('config')) as any;
        const terminals = Array.isArray(config?.terminals) ? config.terminals : [];
        const activeTerminalKeys = [
            localStorage.getItem('active_terminal_id'),
            localStorage.getItem('CLIC_POS_TERMINAL_ID'),
            localStorage.getItem('clic_pos_terminal_id'),
        ].map((value) => String(value || '').trim().toUpperCase()).filter(Boolean);
        const activeTerminal = terminals.find((terminal: any) => {
            const keys = [
                terminal?.id,
                terminal?.terminalId,
                terminal?.terminal_id,
                terminal?.config?.erpTerminalId,
                terminal?.config?.erp_terminal_id,
                terminal?.config?.erpBinding?.terminalId,
                terminal?.config?.erpBinding?.terminal_id,
            ].map((value) => String(value || '').trim().toUpperCase()).filter(Boolean);
            return activeTerminalKeys.some((key) => keys.includes(key));
        }) || terminals.find((terminal: any) =>
            Array.isArray(terminal?.config?.documentSeries) &&
            terminal.config.documentSeries.some((series: any) =>
                String(series?.source || '').toUpperCase() === 'ERP_TERMINAL_CONFIG'
            )
        );
        const terminalSeries = Array.isArray(activeTerminal?.config?.documentSeries)
            ? activeTerminal.config.documentSeries
            : [];
        const hasTerminalErpSeries = terminalSeries.some((series: any) =>
            String(series?.source || '').toUpperCase() === 'ERP_TERMINAL_CONFIG'
        );
        const sourceSeries = hasTerminalErpSeries ? terminalSeries : items;
        const incomingSeries = mergeDocumentSeriesCollection((Array.isArray(sourceSeries) ? sourceSeries : []) as DocumentSeries[]);
        if (incomingSeries.length === 0) return;

        const existingSeries = ((await db.get('internalSequences')) as DocumentSeries[]) || [];
        const incomingHasAuthoritativeErpSeries = incomingSeries.some((series: any) =>
            String(series?.source || '').toUpperCase() === 'ERP_TERMINAL_CONFIG'
        );
        const mergedSeries = incomingHasAuthoritativeErpSeries
            ? mergeDocumentSeriesCollection(incomingSeries.map((incoming: any) => {
                const incomingKeys = [
                    incoming.id,
                    incoming.code,
                    incoming.prefix,
                ].map((value) => String(value || '').trim().toUpperCase()).filter(Boolean);
                const localMatch = existingSeries.find((candidate: any) => {
                    const candidateKeys = [
                        candidate.id,
                        candidate.code,
                        candidate.prefix,
                    ].map((value) => String(value || '').trim().toUpperCase()).filter(Boolean);
                    return incomingKeys.some((key) => candidateKeys.includes(key));
                });
                return {
                    ...incoming,
                    nextNumber: Math.max(Number(incoming.nextNumber) || 1, Number(localMatch?.nextNumber) || 1),
                };
            }))
            : mergeDocumentSeriesCollection([...existingSeries, ...incomingSeries]);
        if (JSON.stringify(existingSeries) !== JSON.stringify(mergedSeries)) {
            await db.save('internalSequences', mergedSeries);
            window.dispatchEvent(new CustomEvent('internalSequencesUpdated'));
        }
    }

    getIsInternalSyncing() {
        return this.isInternalSyncing;
    }

    async pullCatalog(
        collection: SyncableCollection,
        force: boolean = false,
        options?: {
            ignoreThrottle?: boolean;
        }
    ): Promise<number> {
        if (this.isDisabled) return 0;
        const target = syncPolicy.resolve();
        if (target.kind === 'POS_CLOUD_STAGING') {
            logSkippedNonMasterPull(collection, target.kind, 'POS_CLOUD_STAGING_PULL_BLOCKED');
            return 0;
        }
        if (target.kind === 'ERP_ACTIVE' && !isErpMasterPullCollection(collection)) {
            logSkippedNonMasterPull(collection, target.kind);
            return 0;
        }
        if (target.kind !== 'POS_MASTER' && isErpOperationCollection(collection)) {
            logSkippedNonMasterPull(collection, target.kind, 'OPERATION_PULL_REQUIRES_POS_MASTER');
            return 0;
        }
        if (target.kind === 'NONE' && !target.canPullMasters) {
            logSkippedNonMasterPull(collection, target.kind, 'SYNC_TARGET_NOT_CONFIGURED');
            return 0;
        }
        if (isErpMasterPullCollection(collection) && !target.canPullMasters) {
            console.warn(
                `[SYNC_ROUTER] pullCatalog skipped collection=${collection} channel=${target.kind} dataMaster=${target.dataMaster}. POS local remains source of truth.`
            );
            return 0;
        }

        // A local database reset can leave the legacy sync version behind. In
        // that state ERP correctly reports "no changes" while SQLite has no
        // customers to hydrate, so the empty collection must force a full pull.
        if (!force && collection === 'customers') {
            const localCustomers = await db.get('customers');
            if (Array.isArray(localCustomers) && localCustomers.length === 0) {
                force = true;
                this.syncVersions.set(collection, 0);
                localStorage.removeItem(`sync_version_${collection}`);
                localStorage.removeItem(`sync_timestamp_${collection}`);
                console.warn('[SYNC_CUSTOMERS_EMPTY_RECOVERY] forcing full customer pull');
            }
        }

        // Throttling...
        // Throttling...
        if (this.isInternalSyncing && !options?.ignoreThrottle) {
            // console.log(`🔒 SyncManager: Pull skipped for ${collection} (Locked: Sync in progress)`);
            return 0;
        }

        const now = Date.now();
        if (!force && !options?.ignoreThrottle && (now - this.lastSyncTime < this.MIN_SYNC_INTERVAL_MS)) {
            // console.log(`⏳ SyncManager: Pull skipped for ${collection} (Throttled: ${((this.MIN_SYNC_INTERVAL_MS - (now - this.lastSyncTime)) / 1000).toFixed(1)}s remaining)`);
            return 0;
        }

        // Start critical section
        try {
            if (collection === 'products') {
                setCatalogDiagnosticStatus('SYNCING');
            }
            this.isInternalSyncing = true;
            this.isInternalPulling = true; // LOCK LOCAL PUSH TRIGGERS
            this.lastSyncTime = now;

            // Watchdog: If sync hangs for > 45s, perform hard reset of locks
            if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
            this.watchdogTimer = setTimeout(() => {
                if (this.isInternalPulling) {
                    console.warn(`🚨 SyncManager: Watchdog detected Stuck Lock on ${collection}. Forcing release.`);
                    this.isInternalPulling = false;
                    this.isInternalSyncing = false;
                }
            }, this.WATCHDOG_TIMEOUT_MS);

	            const usesTimestampCursor = target.kind === 'ERP_ACTIVE' && isTimestampCursorCollection(collection);
	            if (force && usesTimestampCursor) {
	                this.clearTimestampCursorState(collection);
	            }
	            const timestampCursorState = usesTimestampCursor && !force
	                ? this.getTimestampCursorState(collection)
	                : null;
	            const timestampCursor = timestampCursorState?.nextCursor || timestampCursorState?.cursor || timestampCursorState?.lastSyncedAt || null;
	            const lastVersion = force ? 0 : (this.syncVersions.get(collection) || 0);
	            // const timestamp = new Date().toISOString();
	            // console.log(`[PULL_INICIO] ${timestamp} Descargando colección: ${collection} (LastVersion: ${lastVersion})`);
            // A forced customer recovery must bypass the version cursor. The ERP
            // delta endpoint can legitimately return no rows for sinceVersion=0,
            // while the full master endpoint is the authoritative rehydration path.
            const response = force && collection === 'customers'
                ? {
                    items: await apiSyncAdapter.pull(collection),
                    serverTime: new Date().toISOString(),
                    isFullDownload: true,
                    latestVersion: 0,
                }
                : await apiSyncAdapter.pullDelta(collection, lastVersion || undefined, usesTimestampCursor ? {
                    cursor: timestampCursor,
                    limit: 500,
                } : undefined);
	            const { items, serverTime, isFullDownload, latestVersion, cursor, nextCursor, lastSyncedAt, hasMore } = response;
	            let metadataCache: any = undefined;

            const getMetadataOnce = async () => {
                if (metadataCache !== undefined) return metadataCache;
                metadataCache = await apiSyncAdapter.getMetadata(collection);
                return metadataCache;
            };

	            console.log('[SYNC_CATALOG_PULL_RESULT]', {
	                collection,
	                type: isFullDownload ? 'full' : 'delta',
	                cursorSent: timestampCursor,
	                cursorReceived: nextCursor || cursor || lastSyncedAt || serverTime || null,
	                count: items.length,
	                hasMore: Boolean(hasMore),
	            });
	            console.log(`📦 SyncManager: Received ${items.length} items for ${collection} (${isFullDownload ? 'Full' : 'Delta'})`);

            if (items.length === 0 && !isFullDownload) {
                const localData = await db.get(collection as any);
                const localCount = Array.isArray(localData) ? localData.length : 0;
                const metadata = await getMetadataOnce();
                const remoteCount = metadata?.itemCount || 0;
                const remoteVersion = typeof metadata?.version === 'number'
                    ? metadata.version
                    : (typeof latestVersion === 'number' ? latestVersion : 0);
                const hasCountDrift = remoteCount > localCount;
                const hasLegacyVersionDrift = remoteVersion === 0 && remoteCount > 0 && lastVersion > 0;

                // Self-heal: if server has more rows but delta says "no updates", force full pull.
                if (hasCountDrift || hasLegacyVersionDrift) {
                    console.warn(
                        `⚠️ SyncManager: Drift detected for ${collection} (local=${localCount}, remote=${remoteCount}, localVersion=${lastVersion}, remoteVersion=${remoteVersion}). Forcing full pull...`
                    );
                    const fullItems = await apiSyncAdapter.pull(collection);

                    if (Array.isArray(fullItems) && fullItems.length > 0) {
                        let cleanItems = fullItems.map((item: any) => {
                            const { _op, ...rest } = item;
                            if (collection === 'internalSequences' || collection === 'documentSeries') {
                                return this.repairSequenceData(rest);
                            }

                            // Master as Proxy logic: Default cloudSyncStatus to PENDING for audited documents if missing
                            if (['transactions', 'reservations', 'inventoryLedger', 'zReports'].includes(collection)) {
                                if (!rest.cloudSyncStatus) rest.cloudSyncStatus = 'PENDING';
                            }

                            return rest;
                        });

                        if (collection === 'products') {
                            cleanItems = await this.enrichPulledProducts(cleanItems);
                        }

                        const safeItems = collection === 'transactions'
                            ? await this.mergeTransactionsFullSnapshot(cleanItems)
                            : cleanItems;

                        await db.save(collection as any, safeItems);
                        if (collection === 'documentSeries') {
                            await this.mirrorDocumentSeriesToInternalSequences(safeItems);
                        }

                        if (typeof remoteVersion === 'number') {
                            this.syncVersions.set(collection, remoteVersion);
                            localStorage.setItem(`sync_version_${collection}`, remoteVersion.toString());
                        }

                        if (serverTime) {
                            this.syncTimestamps.set(collection, serverTime);
                            localStorage.setItem(`sync_timestamp_${collection}`, serverTime);
                        }

                        if (collection === 'products') {
                            await productImageCacheService.syncSnapshotItems(safeItems as Product[]);
                            try {
                                await this.syncProductImages({ forceManifestCheck: true });
                            } catch (error) {
                                console.warn('⚠️ Image sync side-channel failed after drift recovery:', error);
                            }
                        }

                        window.dispatchEvent(new CustomEvent(`${collection}Updated`));
                        if (collection === 'internalSequences' || collection === 'documentSeries') {
                            window.dispatchEvent(new CustomEvent('seriesUpdated'));
                        }

                        console.log(`✅ SyncManager: Drift recovery completed for ${collection} with ${safeItems.length} items.`);
                        return safeItems.length;
                    }
                }

	                console.log(`ℹ️  SyncManager: No updates for ${collection}`);
	                if (usesTimestampCursor) {
	                    const savedCursor = this.saveTimestampCursorState(collection, nextCursor || cursor || lastSyncedAt || serverTime);
	                    console.log('[SYNC_DELTA_CURSOR_SAVED]', {
	                        collection,
	                        type: 'delta',
	                        cursorReceived: savedCursor,
	                        count: 0,
	                        hasMore: false,
	                    });
	                }
	                if (serverTime) {
	                    this.syncTimestamps.set(collection, serverTime);
	                    localStorage.setItem(`sync_timestamp_${collection}`, serverTime);
	                }
                if (typeof latestVersion === 'number') {
                    this.syncVersions.set(collection, latestVersion);
                    localStorage.setItem(`sync_version_${collection}`, latestVersion.toString());
                }
                return 0;
            }

            if (isFullDownload) {
                // Legacy behavior for first load or force pull
                console.log(`💾 SyncManager: Performing FULL save for ${collection}...`);
                let cleanItems = items.map((item: any) => {
                    const { _op, ...rest } = item;
                    // Add repair logic for internalSequences
                    if (collection === 'internalSequences' || collection === 'documentSeries') {
                        return this.repairSequenceData(rest);
                    }

                    // Master as Proxy logic: Default cloudSyncStatus to PENDING for audited documents if missing
                    if (['transactions', 'reservations', 'inventoryLedger', 'zReports'].includes(collection)) {
                        if (!rest.cloudSyncStatus) rest.cloudSyncStatus = 'PENDING';
                    }

                    return rest;
                });

                if (collection === 'products') {
                    cleanItems = (await this.enrichPulledProducts(cleanItems)).map((item: any) => normalizeRestaurantProductConfig(item));
                } else if (this.isImageBackedCollection(collection)) {
                    cleanItems = await masterDataImageCacheService.normalizeIncomingItems(collection, cleanItems as any[]);
                }

                const safeItems = collection === 'transactions'
                    ? await this.mergeTransactionsFullSnapshot(cleanItems)
                    : cleanItems;

                if (collection === 'products' && safeItems.length === 0) {
                    const localProducts = await db.get('products');
                    const localCount = Array.isArray(localProducts) ? localProducts.length : 0;
                    if (localCount > 0) {
                        console.warn('REMOTE_CATALOG_EMPTY_GUARD: ERP returned zero products; keeping local catalog intact.');
                        return 0;
                    }
                }
                await db.save(collection as any, safeItems);
                if (collection === 'documentSeries') {
                    await this.mirrorDocumentSeriesToInternalSequences(safeItems);
                }

                if (collection === 'products') {
                    await productImageCacheService.syncSnapshotItems(safeItems as Product[]);
                } else if (this.isImageBackedCollection(collection)) {
                    await masterDataImageCacheService.syncSnapshotItems(collection, items as any[]);
                }
            } else {
                // Incremental update (Upsert / Delete)
                console.log(`💾 SyncManager: Performing INCREMENTAL update for ${collection}...`);
                const updatedProductsForImageSync: Product[] = [];
                const updatedMasterDataForImageSync: any[] = [];
                for (const item of items) {
                    const op = item._op;
                    const { _op, ...cleanItem } = item;
                    if (op === 'DELETE' || item.deletedAt || item.isActive === false) {
                        console.log(`🗑️ SyncManager: Deleting item ${item.id} from ${collection}`);
                        await db.deleteDocument(collection as any, item.id);
                    } else {
                        // Add repair logic for internalSequences
                        let finalItem = (collection === 'internalSequences' || collection === 'documentSeries') ? this.repairSequenceData(cleanItem) : cleanItem;

                        if (collection === 'products') {
                            const enriched = await this.enrichPulledProducts([finalItem]);
                            finalItem = normalizeRestaurantProductConfig(enriched[0]);
                        } else if (this.isImageBackedCollection(collection)) {
                            finalItem = await masterDataImageCacheService.normalizeIncomingItem(collection, finalItem as any);
                        }

                        // Master as Proxy logic: Default cloudSyncStatus to PENDING for audited documents if missing
                        if (['transactions', 'reservations', 'inventoryLedger', 'zReports'].includes(collection)) {
                            if (!finalItem.cloudSyncStatus) finalItem.cloudSyncStatus = 'PENDING';
                        }

                        await db.saveDocument(collection as any, finalItem);
                        if (collection === 'products') {
                            updatedProductsForImageSync.push(finalItem as Product);
                        } else if (this.isImageBackedCollection(collection)) {
                            updatedMasterDataForImageSync.push(cleanItem);
                        }
                        // console.log(`[LOCAL_UPDATE] ${new Date().toISOString()} Registro actualizado en IndexedDB: ${finalItem.id}`);
                    }
                }

                if (collection === 'products' && updatedProductsForImageSync.length > 0) {
                    await productImageCacheService.syncSnapshotItems(updatedProductsForImageSync);
                } else if (this.isImageBackedCollection(collection) && updatedMasterDataForImageSync.length > 0) {
                    await masterDataImageCacheService.syncSnapshotItems(collection, updatedMasterDataForImageSync);
                }

                if (collection === 'documentSeries') {
                    const allDocumentSeries = ((await db.get('documentSeries' as any)) as DocumentSeries[]) || [];
                    await this.mirrorDocumentSeriesToInternalSequences(allDocumentSeries);
                }
            }

            // CRITICAL: If we just pulled inventory ledger entries, we MUST recalculate stock
            // for all affected products to ensure "Unidades en Red" and "Existencias" are correct.
            // NOTE: We skip this on SLAVE terminals because they rely on pre-calculated stock from Master.
            if (collection === 'inventoryLedger' && items.length > 0 && !permissionService.isSlaveTerminal()) {
                // console.log(`🔄 SyncManager: Recalculating stock for ${items.length} ledger entries...`);
                const affectedProducts = new Set<string>();
                const affectedWarehouses = new Set<string>();

                for (const item of items) {
                    if (item.productId) affectedProducts.add(item.productId);
                    if (item.warehouseId) affectedWarehouses.add(item.warehouseId);
                }

                for (const productId of affectedProducts) {
                    for (const warehouseId of affectedWarehouses) {
                        // We recalculate for all combinations found in the batch
                        // db.recalculateProductStock is smart enough to only process if entries exist
                        await db.recalculateProductStock(productId, warehouseId);
                    }
                }
                console.log(`✅ SyncManager: Stock recalculation complete for ${affectedProducts.size} products.`);
            }

	            // Update local sync timestamp
	            if (usesTimestampCursor) {
	                const savedCursor = this.saveTimestampCursorState(collection, nextCursor || cursor || lastSyncedAt || serverTime);
	                console.log('[SYNC_DELTA_CURSOR_SAVED]', {
	                    collection,
	                    type: isFullDownload ? 'full' : 'delta',
	                    cursorReceived: savedCursor,
	                    count: items.length,
	                    hasMore: Boolean(hasMore),
	                });
	            }
	            if (serverTime) {
	                this.syncTimestamps.set(collection, serverTime);
	                localStorage.setItem(`sync_timestamp_${collection}`, serverTime);
	            }

            // Also update legacy version if available in metadata
            let newVersion = typeof latestVersion === 'number' ? latestVersion : undefined;
            if (newVersion === undefined) {
                const metadata = await apiSyncAdapter.getMetadata(collection);
                if (metadata) {
                    newVersion = metadata.version;
                }
            }
            if (typeof newVersion === 'number') {
                this.syncVersions.set(collection, newVersion);
                localStorage.setItem(`sync_version_${collection}`, newVersion.toString());
            }

            if (collection === 'products') {
               try {
                  await this.syncProductImages();
               } catch (error) {
                  console.warn('⚠️ Image sync side-channel failed after products pull:', error);
               }
               setCatalogDiagnosticStatus('SYNCED');
            }
            if (collection === 'categories' || collection === 'productCategories' || collection === 'productGroups' || collection === 'collections') {
                window.dispatchEvent(new CustomEvent('categoriesUpdated'));
            }

            console.log(`✅ SyncManager: Pulled ${items.length} items for ${collection}. New version: ${newVersion ?? 'unknown'}`);

            // Dispatch event for UI to refresh
            window.dispatchEvent(new CustomEvent(`${collection}Updated`));
            if (collection === 'internalSequences' || collection === 'documentSeries') {
                window.dispatchEvent(new CustomEvent('seriesUpdated'));
            }

            return items.length;
        } catch (error) {
            console.error(`❌ SyncManager: Error pulling ${collection}:`, error);
            if (collection === 'paymentMethods' && isPaymentMethodsMissingSyncError(error)) {
                console.warn('⚠️ SyncManager: paymentMethods is unavailable in terminal configuration; continuing sync flow.');
                return 0;
            }
            if (!(error && typeof error === 'object' && (error as any).__syncDiagnosticReported)) {
                reportSyncErrorDiagnostic({
                    operation: 'PULL_MASTERS',
                    collection,
                    error,
                });
            }
            throw error;
        } finally {
            if (this.watchdogTimer) {
                clearTimeout(this.watchdogTimer);
                this.watchdogTimer = null;
            }
            this.isInternalSyncing = false;
            this.isInternalPulling = false; // RELEASE LOCK
        }
    }

    /**
     * Sync all catalogs (Master: push, Slave: pull)
     */
    async syncAllCatalogs(): Promise<SyncStatus[]> {
        if (this.isDisabled) return [];

        // Catalogs: Master PUSHES, Slaves PULL
        // Added inventoryLedger and transactions so slaves can see history from other terminals
        const isMaster = permissionService.isMasterTerminal();
        const defaultCatalogs: SyncableCollection[] = [
            'products',
            'taxes',
            'customers',
            'suppliers',
            'warehouses',
            'paymentMethods',
            'priceLists',
            'productPrices',
            'categories',
            'productCategories',
            'productGroups',
            'collections',
            'serviceTypes',
            'rooms',
            'tables',
            'productionAreas',
            'users',
            'roles',
            'documentSeries',
            'documentTypes',
            'internalSequences',
            'fiscalRanges',
            'fiscalReceiptTypes',
            'fiscalReceipts',
            'fiscalSequences',
            'terminalFiscalConfig',
            'promotions',
            'campaigns',
            'coupons',
            'discountRules',
            'promotionRules',
            'promotionConditions',
            'promotionBenefits',
            'pointsPrograms',
            'loyaltyPrograms',
            'pointsRules',
            'earningRules',
            'redemptionRules',
            'customerPointBalances',
            'loyaltyTiers',
            'productStocks',
            ...(isMaster || permissionService.shouldShowGlobalSales() ? ['inventoryLedger' as SyncableCollection] : []),
            ...(permissionService.shouldShowGlobalSales() ? ['transactions' as SyncableCollection] : []),
            'transfers',
            'receptions'
        ];

        // Operations: Master PULLS, Slaves PUSH (via separate methods, but we sync here for visibility)
        const operations: SyncableCollection[] = ['inventoryLedger', 'zReports'];

        const results: SyncStatus[] = [];
        const target = syncPolicy.resolve();
        let catalogs: SyncableCollection[] = target.kind === 'ERP_ACTIVE'
            ? defaultCatalogs.filter(isErpMasterPullCollection)
            : defaultCatalogs;
        if (target.kind === 'ERP_ACTIVE') {
            for (const collection of defaultCatalogs) {
                if (!isErpMasterPullCollection(collection)) {
                    logSkippedNonMasterPull(collection, target.kind, 'REMOVED_FROM_ERP_ACTIVE_CATALOG_PULL');
                }
            }
        } else if (target.kind === 'POS_CLOUD_STAGING' && target.canPushMasters && target.dataMaster === 'POS') {
            for (const collection of defaultCatalogs) {
                if (!isPosCloudStagingPushCollection(collection)) {
                    logSkippedNonMasterPull(collection, target.kind, 'POS_CLOUD_STAGING_PUSH_NOT_SUPPORTED');
                }
            }
            catalogs = defaultCatalogs.filter(isPosCloudStagingPushCollection);
        }

        // 0. Pull singleton config first on slaves (document assignments/terminal behavior live there).
        if (!permissionService.isMasterTerminal()) {
            try {
                await this.pullConfig();
                const metadata = await apiSyncAdapter.getMetadata('config');
                const localVersion = this.syncVersions.get('config') || 0;

                results.push({
                    collection: 'config',
                    lastSyncedAt: metadata?.lastSyncedAt || null,
                    localVersion,
                    remoteVersion: metadata?.version || null,
                    status: 'SYNCED'
                });
            } catch (error: any) {
                reportSyncErrorDiagnostic({
                    operation: 'PULL_CONFIG',
                    collection: 'config',
                    error,
                });
                results.push({
                    collection: 'config',
                    lastSyncedAt: null,
                    localVersion: this.syncVersions.get('config') || 0,
                    remoteVersion: null,
                    status: 'ERROR',
                    error: error.message
                });
            }
        }

        // 1. Sync Catalogs
        for (const collection of catalogs) {
            try {
                if (target.canPushMasters && target.dataMaster === 'POS') {
                    await this.pushCatalog(collection);
                    const localData = await db.get(collection as any);
                    const localVersion = this.syncVersions.get(collection) || 0;

                    results.push({
                        collection,
                        lastSyncedAt: new Date().toISOString(),
                        localVersion,
                        remoteVersion: Array.isArray(localData) ? localData.length : null,
                        status: 'SYNCED_CLOUD'
                    });
                    continue;
                } else if (target.kind === 'POS_CLOUD_STAGING' || !target.canPullMasters) {
                    logSkippedNonMasterPull(collection, target.kind, 'LOCAL_MASTERS_PROTECTED');
                    const localData = await db.get(collection as any);
                    const localVersion = this.syncVersions.get(collection) || 0;
                    results.push({
                        collection,
                        lastSyncedAt: null,
                        localVersion,
                        remoteVersion: Array.isArray(localData) ? localData.length : null,
                        status: 'SYNCED',
                    });
                    continue;
                } else {
                    // Pull only when the channel allows remote masters (ERP_ACTIVE or POS_MASTER).
                    await this.pullCatalog(collection);
                }

                const metadata = await apiSyncAdapter.getMetadata(collection);
                const localVersion = this.syncVersions.get(collection) || 0;

                results.push({
                    collection,
                    lastSyncedAt: metadata?.lastSyncedAt || null,
                    localVersion,
                    remoteVersion: metadata?.version || null,
                    status: 'SYNCED'
                });
            } catch (error: any) {
                reportSyncErrorDiagnostic({
                    operation: target.canPushMasters && target.dataMaster === 'POS' ? 'PUSH_MASTERS' : 'PULL_MASTERS',
                    collection,
                    error,
                });
                if (collection === 'paymentMethods' && isPaymentMethodsMissingSyncError(error)) {
                    results.push({
                        collection,
                        lastSyncedAt: null,
                        localVersion: this.syncVersions.get(collection) || 0,
                        remoteVersion: null,
                        status: 'SYNCED',
                        error: error.message,
                    });
                    continue;
                }
                results.push({
                    collection,
                    lastSyncedAt: null,
                    localVersion: this.syncVersions.get(collection) || 0,
                    remoteVersion: null,
                    status: 'ERROR',
                    error: error.message
                });
            }
        }

        // 2. Sync Operations (Master Only - PULL via local POS master)
        if (permissionService.isMasterTerminal() && target.kind === 'POS_MASTER') {
            for (const collection of operations) {
                try {
                    // Master pulls operations from Server to see what Slaves have sent
                    await this.pullCatalog(collection);

                    const metadata = await apiSyncAdapter.getMetadata(collection);
                    const localVersion = this.syncVersions.get(collection) || 0;

                    results.push({
                        collection,
                        lastSyncedAt: metadata?.lastSyncedAt || null,
                        localVersion,
                        remoteVersion: metadata?.version || null,
                        status: 'SYNCED'
                    });
                } catch (error: any) {
                    reportSyncErrorDiagnostic({
                        operation: 'PULL_MASTERS',
                        collection,
                        error,
                    });
                    results.push({
                        collection,
                        lastSyncedAt: null,
                        localVersion: this.syncVersions.get(collection) || 0,
                        remoteVersion: null,
                        status: 'ERROR',
                        error: error.message
                    });
                }
            }
        }

        // 3. Performance: Purge old synced transactions and movements
        this.purgeSyncedHistoricalData().catch(e => console.error('❌ SyncManager: Purge failed:', e));

        return results;
    }

    /**
     * Purge historical data that has already been synced and is older than 45 days.
     * This keeps the local IndexedDB lean and fast.
     */
    private lastPurgeTimestamp: number = 0;
    private readonly PURGE_THROTTLE_MS = 1000 * 60 * 60 * 6; // 6 hours

    async purgeSyncedHistoricalData() {
        if (this.isMaster) return; // Master keeps all local data as primary storage

        // Throttle frequency: Only purge every 6 hours to avoid disk churn during sync bursts
        const now = Date.now();
        if (now - this.lastPurgeTimestamp < this.PURGE_THROTTLE_MS) {
            return;
        }

        const PURGE_DAYS = 45;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - PURGE_DAYS);
        const cutoffIso = cutoffDate.toISOString();

        console.log(`🧹 SyncManager: Cleaning up synced data older than ${cutoffIso}...`);

        try {
            // 1. Purge Synced Transactions
            const syncedTransactions = (await db.get('transactions')) || [];
            const toDeleteTxns = syncedTransactions.filter((t: any) =>
                t.syncStatus === 'SYNCED' && t.date < cutoffIso
            );
            if (toDeleteTxns.length > 0) {
                console.log(`🧹 SyncManager: Purging ${toDeleteTxns.length} old synced transactions.`);
                for (const txn of toDeleteTxns) await db.deleteDocument('transactions', (txn as any).id);
            }

            // 2. Purge Synced Inventory Movements
            const syncedMovements = (await db.get('inventoryLedger')) as any[] || [];
            const toDeleteMoves = syncedMovements.filter((m: any) =>
                m.syncStatus === 'SYNCED' && m.date < cutoffIso
            );
            if (toDeleteMoves.length > 0) {
                console.log(`🧹 SyncManager: Purging ${toDeleteMoves.length} old synced inventory movements.`);
                for (const move of toDeleteMoves) await db.deleteDocument('inventoryLedger', (move as any).id);
            }

            this.lastPurgeTimestamp = Date.now();
        } catch (error) {
            console.error('❌ SyncManager: Error during historical data purge:', error);
        }
    }

    /**
     * Check for catalog updates without pulling
     */
    async checkForUpdates(): Promise<string[]> {
        const target = syncPolicy.resolve();
        const defaultCollections: SyncableCollection[] = [
            'products',
            'taxes',
            'customers',
            'suppliers',
            'warehouses',
            'paymentMethods',
            'priceLists',
            'productPrices',
            'categories',
            'productCategories',
            'productGroups',
            'collections',
            'serviceTypes',
            'rooms',
            'tables',
            'productionAreas',
            'users',
            'roles',
            'documentSeries',
            'documentTypes',
            'internalSequences',
            'fiscalRanges',
            'fiscalReceiptTypes',
            'fiscalReceipts',
            'fiscalSequences',
            'terminalFiscalConfig',
            'promotions',
            'campaigns',
            'coupons',
            'discountRules',
            'promotionRules',
            'promotionConditions',
            'promotionBenefits',
            'pointsPrograms',
            'loyaltyPrograms',
            'pointsRules',
            'earningRules',
            'redemptionRules',
            'customerPointBalances',
            'loyaltyTiers',
            'productStocks',
            'transfers',
            'receptions',
            ...(permissionService.shouldShowGlobalSales() ? ['transactions' as SyncableCollection] : [])
        ];
        const collections = target.kind === 'ERP_ACTIVE'
            ? defaultCollections.filter(isErpMasterPullCollection)
            : defaultCollections;
        const updatesAvailable: string[] = [];

        for (const collection of collections) {
            const localVersion = this.syncVersions.get(collection) || 0;
            const metadata = await apiSyncAdapter.getMetadata(collection);
            const remoteVersion = metadata?.version || 0;
            const remoteCount = metadata?.itemCount || 0;
            const hasNew = remoteVersion > localVersion;

            // CRITICAL: Also check if local collection is empty. 
            // This handles the case where remote version is 0 but server has data (Slave first pull).
            const localData = await db.get(collection as any);
            const localCount = Array.isArray(localData) ? localData.length : 0;
            const isEmpty = localCount === 0;
            const hasCountDrift = remoteCount > localCount;
            const hasLegacyVersionDrift = remoteVersion === 0 && remoteCount > 0 && localVersion > 0;

            if (hasNew || hasCountDrift || hasLegacyVersionDrift || (isEmpty && localVersion === 0)) {
                updatesAvailable.push(collection);
            }
        }

        // Config is a singleton object. Slaves must also track updates for terminal assignments.
        if (!permissionService.isMasterTerminal()) {
            const localVersion = this.syncVersions.get('config') || 0;
            const hasNewConfig = await apiSyncAdapter.hasNewData('config', localVersion);
            const localConfig = await db.get('config') as unknown as BusinessConfig | null;
            const isConfigMissing = !localConfig || Array.isArray(localConfig) || Object.keys(localConfig).length === 0;

            if (hasNewConfig || (isConfigMissing && localVersion === 0)) {
                updatesAvailable.push('config');
            }
        }

        return updatesAvailable;
    }

    /**
     * Force push all catalogs (Master only)
     * Used to resolve sync discrepancies by re-uploading everything
     */
    async forcePushAll(): Promise<void> {
        const target = syncPolicy.resolve();
        if (target.kind === 'ERP_ACTIVE') {
            console.warn('[SYNC_ROUTER] forcePushAll redirected to forcePullAll: ERP_ACTIVE owns master data.');
            await this.forcePullAll();
            return;
        }

        if (!permissionService.isMasterTerminal()) {
            console.warn('⚠️  Only master terminal can force push');
            throw new Error('Solo la terminal Master puede forzar la subida de datos.');
        }

        const collections: SyncableCollection[] = ['products', 'customers', 'suppliers', 'users', 'roles', 'internalSequences'];
        console.log('🚀 Force pushing all collections...');

        for (const collection of collections) {
            await this.pushCatalog(collection);
        }

        console.log('✅ Force push completed');
    }

    /**
     * Force pull all catalogs (Slave: from Master, Master: from Server)
     * Resets local versions to 0 to force full download
     */
    async forcePullAll(): Promise<void> {
        console.log('🔄 Forcing full pull of all catalogs...');
        const target = syncPolicy.resolve();
        if (!target.canPullMasters) {
            console.warn(
                `[SYNC_ROUTER] forcePullAll skipped channel=${target.kind} dataMaster=${target.dataMaster}. This terminal must not download ERP masters.`
            );
            window.dispatchEvent(new CustomEvent('syncStart', { detail: { modules: [] } }));
            window.dispatchEvent(new CustomEvent('syncProgress', {
                detail: { id: 'sync-profile', status: 'SUCCESS', message: 'Canal POS: maestros locales protegidos', count: 0 }
            }));
            return;
        }

        // Define modules to sync. ERP_ACTIVE must pull only masters/config, never POS operations.
        const baseModules = [
            { id: 'config', label: 'Configuración Global (Tarifas)' },
            { id: 'products', label: 'Catálogo de Productos' },
            { id: 'taxes', label: 'Impuestos' },
            { id: 'customers', label: 'Base de Clientes' },
            { id: 'suppliers', label: 'Proveedores' },
            { id: 'warehouses', label: 'Almacenes' },
            { id: 'paymentMethods', label: 'Métodos de Pago' },
            { id: 'productPrices', label: 'Precios de Productos' },
            { id: 'productStocks', label: 'Existencias por Almacén' },
            { id: 'priceLists', label: 'Tarifas' },
            { id: 'users', label: 'Operadores de Sistema' },
            { id: 'roles', label: 'Roles y Permisos' },
            { id: 'documentSeries', label: 'Series Documentales' },
            { id: 'documentTypes', label: 'Tipos de Documento' },
            { id: 'internalSequences', label: 'Secuencias de Documentos' },
            { id: 'fiscalRanges', label: 'Rangos Fiscales DGII' },
            { id: 'fiscalSequences', label: 'Secuencias Fiscales' },
            { id: 'terminalFiscalConfig', label: 'Configuración Fiscal de Terminal' },
            { id: 'promotions', label: 'Promociones' },
            { id: 'campaigns', label: 'Campañas' },
            { id: 'coupons', label: 'Cupones' },
            { id: 'pointsPrograms', label: 'Programas de Puntos' },
            { id: 'loyaltyPrograms', label: 'Programas de Fidelidad' },
            { id: 'pointsRules', label: 'Reglas de Puntos' },
        ];
        const modules = target.kind === 'ERP_ACTIVE'
            ? baseModules.filter(module => [
                'config',
                'products',
                'taxes',
                'customers',
                'suppliers',
                'warehouses',
                'paymentMethods',
                'priceLists',
                'productPrices',
                'productStocks',
                'users',
                'roles',
                'documentSeries',
                'internalSequences',
                'documentTypes',
                'fiscalRanges',
                'fiscalSequences',
                'terminalFiscalConfig',
            ].includes(module.id))
            : [...baseModules];

        if (permissionService.isMasterTerminal() && target.kind !== 'ERP_ACTIVE') {
            modules.push(
                { id: 'transactions', label: 'Historial de Ventas' },
                { id: 'zReports', label: 'Cierres de Caja (Z)' },
                { id: 'inventoryLedger', label: 'Movimientos de Inventario' },
                { id: 'cashMovements', label: 'Movimientos de Efectivo' }
            );
        } else if (permissionService.shouldShowGlobalSales() && target.kind !== 'ERP_ACTIVE') {
            modules.push(
                { id: 'transactions', label: 'Historial de Ventas Globales' }
            );
        }

        // Initialize progress UI
        window.dispatchEvent(new CustomEvent('syncStart', { detail: { modules } }));

        for (const module of modules) {
            try {
                // Update UI: Processing
                window.dispatchEvent(new CustomEvent('syncProgress', {
                    detail: { id: module.id, status: 'PROCESSING', message: 'Descargando datos...' }
                }));

                let count = 0;

                if (module.id === 'config') {
                    // Special handling for config object
                    this.syncVersions.set('config', 0);
                    localStorage.setItem('sync_version_config', '0');
                    await this.pullConfig(true);
                    count = 1; // Config is a single object, not a collection of items
                } else {
                    // Standard collection sync
                    this.syncVersions.set(module.id as SyncableCollection, 0); // Reset local version to force full pull
                    localStorage.setItem(`sync_version_${module.id}`, '0');
                    count = await this.pullCatalog(module.id as SyncableCollection);
                }

                // Update UI: Success
                window.dispatchEvent(new CustomEvent('syncProgress', {
                    detail: { id: module.id, status: 'SUCCESS', message: 'Completado', count }
                }));

            } catch (error: any) {
                console.error(`❌ Failed to restore ${module.id}:`, error);
                if (module.id === 'paymentMethods' && isPaymentMethodsMissingSyncError(error)) {
                    window.dispatchEvent(new CustomEvent('syncProgress', {
                        detail: { id: module.id, status: 'SUCCESS', message: 'Sincronización no crítica: métodos de pago pendientes.' }
                    }));
                    continue;
                }
                // Update UI: Error
                window.dispatchEvent(new CustomEvent('syncProgress', {
                    detail: { id: module.id, status: 'ERROR', message: error.message || 'Error desconocido' }
                }));
            }
        }

        console.log('✅ Force pull process finished');
    }

    async fullPull(): Promise<void> {
        try {
            await this.refreshTerminalResolvedConfig(undefined, { dispatchEvent: false });
        } catch (error) {
            console.warn('⚠️ SyncManager: Could not refresh terminal snapshot before full pull:', error);
        }

        await this.forcePullAll();
    }

    /**
     * Pull global configuration (mainly for Slave terminals)
     */
    async pullConfig(force: boolean = false): Promise<void> {
        if (this.isDisabled) return;

        // Master already owns source-of-truth config locally; skip unless explicitly forced.
        if (!force && permissionService.isMasterTerminal()) return;

        try {
            const localVersion = this.syncVersions.get('config') || 0;
            const localConfig = await db.get('config') as unknown as BusinessConfig | null;
            const metadata = await apiSyncAdapter.getMetadata('config');
            const remoteVersion = metadata?.version;

            if (this.isDebugSync()) {
                console.log('⬇️ Pulling global configuration...');
            }
            const config = await apiSyncAdapter.pullConfig();
            if (!config) return;

            let finalConfig = config;
            try {
                const refreshedConfig = await this.refreshTerminalResolvedConfig(undefined, {
                    baseConfig: config,
                    persist: false,
                    dispatchEvent: false,
                });
                if (refreshedConfig) {
                    finalConfig = refreshedConfig;
                }
            } catch (snapshotError) {
                console.warn('⚠️ SyncManager: Terminal snapshot refresh failed during pullConfig. Using global config fallback.', snapshotError);
            }

            const currentTerminalId = permissionService.getTerminalId();
            const localTerminal = (localConfig?.terminals || []).find((terminal: any) => terminal.id === currentTerminalId);
            const localAllowsNegativeStock = Boolean(localTerminal?.config?.workflow?.inventory?.allowNegativeStock);
            if (currentTerminalId && localAllowsNegativeStock) {
                finalConfig = {
                    ...finalConfig,
                    terminals: (finalConfig.terminals || []).map((terminal: any) => {
                        if (terminal.id !== currentTerminalId) return terminal;
                        return {
                            ...terminal,
                            config: {
                                ...terminal.config,
                                workflow: {
                                    ...(terminal.config?.workflow || {}),
                                    inventory: {
                                        ...(terminal.config?.workflow?.inventory || {}),
                                        allowNegativeStock: true,
                                    },
                                },
                            },
                        };
                    }),
                };
            }

            const localSanitized = this.sanitizeConfig(localConfig);
            const incomingSanitized = this.sanitizeConfig(finalConfig);

            const localConfigJson = JSON.stringify(localSanitized);
            const incomingConfigJson = JSON.stringify(incomingSanitized);
            const changed = localConfigJson !== incomingConfigJson;

            if (!changed) {
                if (typeof remoteVersion === 'number') {
                    this.syncVersions.set('config', remoteVersion);
                    localStorage.setItem('sync_version_config', remoteVersion.toString());
                }
                return;
            }

            console.log('💾 Saving global configuration...');
            await db.save('config', finalConfig);

            const finalVersion = (typeof remoteVersion === 'number')
                ? remoteVersion
                : Math.max(localVersion + 1, 1);
            this.syncVersions.set('config', finalVersion);
            localStorage.setItem('sync_version_config', finalVersion.toString());

            console.log('✅ Global configuration saved.');

            // Notify runtime so the app can apply it immediately without restart.
            window.dispatchEvent(new CustomEvent('configUpdated', { detail: finalConfig }));
        } catch (error) {
            console.error('❌ SyncManager: Failed to pull config:', error);
            throw error;
        }
    }

    /**
     * Get sync status for all collections with detailed counts
     */
    async getSyncStatus(): Promise<(SyncStatus & { itemCount: number })[]> {
        const collections: SyncableCollection[] = ['products', 'customers', 'suppliers', 'users', 'roles', 'internalSequences'];
        const statuses: (SyncStatus & { itemCount: number })[] = [];

        for (const collection of collections) {
            const metadata = await apiSyncAdapter.getMetadata(collection);
            const localVersion = this.syncVersions.get(collection) || 0;
            const hasNew = metadata ? await apiSyncAdapter.hasNewData(collection, localVersion) : false;

            // Get local item count
            const localData = await db.get(collection as any);
            const itemCount = Array.isArray(localData) ? localData.length : 0;

            statuses.push({
                collection,
                lastSyncedAt: metadata?.lastSyncedAt || null,
                localVersion,
                remoteVersion: metadata?.version || null,
                lastSyncTimestamp: this.syncTimestamps.get(collection) || null,
                status: hasNew ? 'PENDING' : 'SYNCED',
                itemCount
            });
        }

        return statuses;
    }

    /**
     * Get detailed operational status (Master only)
     */
    async getOperationalStatus(): Promise<any> {
        if (!permissionService.isMasterTerminal()) return null;

        try {
            return await apiSyncAdapter.getOperationalStatus();
        } catch (error) {
            console.error('Error fetching operational status:', error);
            return null;
        }
    }

    async retryErpForwardQueue(ids?: string[]): Promise<any> {
        if (!permissionService.isMasterTerminal()) return null;

        try {
            return await apiSyncAdapter.retryErpForwardQueue(ids);
        } catch (error) {
            console.error('Error retrying ERP forward queue:', error);
            throw error;
        }
    }

    isUsingErpOperationalTarget(): boolean {
        return apiSyncAdapter.isUsingErpOperationalTarget();
    }

    isErpActiveOperationalTarget(): boolean {
        return apiSyncAdapter.isErpActiveOperationalTarget();
    }

    /**
     * Start automatic sync (for slave terminals)
     */
    startAutoSync(intervalMs: number = 30000) {
        if (this.isDisabled) return;

        if (this.autoSyncInterval) {
            this.stopAutoSync();
        }

        this.autoSyncInterval = setInterval(() => {
            void this.runAutomaticMasterDataSync();
        }, intervalMs);

        if (!permissionService.isMasterTerminal()) {
            this.startImageSync(this.IMAGE_SYNC_INTERVAL_MS);
        }

        console.log(`⏰ Auto-sync started (${intervalMs / 1000}s interval)`);
    }

    private async runAutomaticMasterDataSync(): Promise<void> {
        if (!permissionService.isMasterTerminal()) {
            try {
                await this.pullConfig();
            } catch (error) {
                console.warn('⚠️ Auto-sync: Failed to refresh config:', error);
            }
        }

        // Configuration remains critical while idle. Only large master-data
        // checks and image transfers are reduced.
        if (this.reducedSyncMode) return;

        const updates = await this.checkForUpdates();
        if (updates.length > 0) {
            console.log(`📥 Auto-sync: Found updates for ${updates.join(', ')}`);
            await this.syncAllCatalogs();
        }
    }

    setReducedSyncMode(reduced: boolean, reason = 'inactivity'): void {
        if (this.reducedSyncMode === reduced) return;
        this.reducedSyncMode = reduced;
        console.info(`[SYNC_POLICY] Master data sync ${reduced ? 'reduced' : 'active'} (${reason}).`);

        if (!reduced && navigator.onLine && !isPosSaleActive()) {
            window.setTimeout(() => {
                void this.runAutomaticMasterDataSync();
            }, 0);
        }
    }

    isReducedSyncMode(): boolean {
        return this.reducedSyncMode;
    }

    /**
     * Stop automatic sync
     */
    stopAutoSync() {
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
            this.autoSyncInterval = null;
            console.log('⏹️  Auto-sync stopped');
        }
        if (this.imageSyncInterval) {
            clearInterval(this.imageSyncInterval);
            this.imageSyncInterval = null;
            console.log('⏹️  Image auto-sync stopped');
        }
        this.detachImageSyncReconnectHandler();
    }

    /**
     * Broadcast a single collection change (Master only)
     * Used when individual items are created/updated
     */
    async broadcastChange(collection: SyncableCollection, item: any, action: 'CREATE' | 'UPDATE' | 'DELETE') {
        if (this.isDisabled || !this.syncConfig) {
            console.warn(`⚠️ SyncManager: Broadcast for ${collection} skipped (Not initialized)`);
            return;
        }

        if (!permissionService.isMasterTerminal() && collection !== 'internalSequences') {
            console.warn('⚠️  Only master terminal can broadcast changes (except internalSequences)');
            return;
        }

        try {
            if (!item || !item.id) {
                console.warn(`⚠️ SyncManager: Missing item for ${collection} broadcast. Falling back to full push.`);
                await this.pushCatalog(collection);
                return;
            }

            await apiSyncAdapter.push(collection, [item], action, 'UPSERT');
            console.log(`📡 Broadcasted ${action} for ${collection} (item ${item.id})`);
        } catch (error: any) {
            if (error.message === 'Cannot push while offline') {
                // Suppress unnecessary error logging, as local save succeeded
                console.warn(`⚠️ Broadcast for ${collection} deferred (Offline)`);
            } else {
                throw error;
            }
        }
    }

    /**
     * Push a single Z-Report to Master (or Server if we are Master)
     */
    async pushZReport(report: any) {
        try {
            await apiSyncAdapter.pushZReport(report);
            console.log('📤 SyncManager: Pushed Z-Report to Server');
        } catch (error) {
            console.error('❌ SyncManager: Failed to push Z-Report:', error);
            // We don't throw here to avoid blocking the UI, as it's already saved locally
        }
    }

    /**
     * Push a single inventory movement to Master (or Server if we are Master)
     */
    async pushInventoryMovement(movement: any) {
        // If we are Master, we still want to push to the Server so it has the record
        // The Server is the source of truth for the "Global Ledger"
        try {
            await apiSyncAdapter.pushInventoryMovement(movement);
            console.log('📤 SyncManager: Pushed inventory movement to Server');
        } catch (error) {
            console.error('❌ SyncManager: Failed to push inventory movement:', error);
            // We don't throw here to avoid blocking the UI, as it's already saved locally
        }
    }

    /**
     * Get list of connected terminals (Master only)
     */
    async getConnectedTerminals() {
        return await apiSyncAdapter.getConnectedTerminals();
    }

    /**
     * Test connection to a URL
     */
    async testConnection(url: string) {
        return await apiSyncAdapter.testConnection(url);
    }

    /**
     * Get sync connection status (for UI display)
     */
    getSyncConnectionStatus() {
        const apiStatus = apiSyncAdapter.getConnectionStatus();
        return {
            ...apiStatus,
            mode: this.syncConfig?.mode || 'MASTER',
            isEnabled: this.syncConfig?.isEnabled !== false
        };
    }

    /**
     * Reset terminal data on Master server
     */
    async resetTerminalData(terminalId: string) {
        try {
            await apiSyncAdapter.resetTerminalData(terminalId);
            console.log(`✅ SyncManager: Reset signal sent for terminal ${terminalId}`);
        } catch (error) {
            console.warn(`⚠️ SyncManager: Failed to send reset signal for terminal ${terminalId}:`, error);
        }
    }

    /**
     * Update Master URL and re-initialize sync adapter
     */
    async setMasterUrl(url: string) {
        if (this.isMaster) return;

        const normalizedUrl = this.normalizeMasterUrlForStorage(url) || url;

        console.log(`🔄 Updating Master URL to: ${normalizedUrl}`);

        // Save to localStorage for persistence
        localStorage.setItem('CLIC_POS_MASTER_URL', normalizedUrl);
        try {
            const urlObj = new URL(normalizedUrl);
            localStorage.setItem('pos_master_ip', urlObj.hostname);
        } catch {
            // Ignore malformed URLs here; initialize below will surface any real problem.
        }

        if (this.syncConfig) {
            this.syncConfig.masterUrl = normalizedUrl;
        }

        await apiSyncAdapter.initialize({
            masterUrl: normalizedUrl,
            terminalId: permissionService.getTerminalId() || 'unknown',
            autoRetry: true,
            retryDelayMs: 5000
        });
    }

    /**
     * Restore historical data for a terminal (new device inheritance)
     */
    async restoreHistory(terminalId: string): Promise<void> {
        if (this.isMaster) return; // Master doesn't need to restore history from itself

        console.log(`📥 SyncManager: Restoring history for terminal ${terminalId}...`);

        try {
            const history = await apiSyncAdapter.pullHistory(terminalId);
            if (!history) {
                console.warn('⚠️ SyncManager: No history found or could not reach Master.');
                return;
            }

            // 1. Restore Transactions
            if (history.transactions?.length > 0) {
                console.log(`📥 SyncManager: Restoring ${history.transactions.length} transactions...`);
                await db.save('transactions', history.transactions);
            }

            // 2. Restore Inventory Movements
            if (history.inventoryLedger?.length > 0) {
                console.log(`📥 SyncManager: Restoring ${history.inventoryLedger.length} inventory movements...`);
                await db.save('inventoryLedger', history.inventoryLedger);
            }

            // 3. Restore Z-Reports
            if (history.zReports?.length > 0) {
                console.log(`📥 SyncManager: Restoring ${history.zReports.length} Z-Reports...`);
                await db.save('zReports', history.zReports);
            }

            // 4. Restore Cash Movements
            if (history.cashMovements?.length > 0) {
                console.log(`📥 SyncManager: Restoring ${history.cashMovements.length} cash movements...`);
                await db.save('cashMovements', history.cashMovements);
            }

            // 5. Update local sync versions and FORCE Pull critical catalogs (especially sequences)
            // This ensures document numbering continues correctly
            const collections: SyncableCollection[] = ['products', 'customers', 'suppliers', 'internalSequences', 'fiscalRanges'];
            for (const col of collections) {
                const metadata = await apiSyncAdapter.getMetadata(col);
                if (metadata) {
                    this.syncVersions.set(col, metadata.version);
                    localStorage.setItem(`sync_version_${col}`, metadata.version.toString());
                }

                // Force a pull of internalSequences specifically to ensure we have the latest from Master
                if (col === 'internalSequences') {
                    console.log('📥 SyncManager: Force pulling internalSequences for numbering continuity...');
                    await this.pullCatalog('internalSequences');
                }
            }

            console.log('✅ SyncManager: History restoration complete.');
        } catch (error) {
            console.error('❌ SyncManager: Error restoring history:', error);
            throw error;
        }
    }
    private async resolveCurrentTerminalConfig(): Promise<TerminalConfig | null> {
        try {
            const raw = await db.get('config');
            let businessConfig: any = raw;
            if (Array.isArray(raw)) {
                businessConfig =
                    raw.find((c: any) => c && c.id === 'current') ||
                    raw.find((c: any) => Array.isArray(c?.terminals)) ||
                    raw[0];
            }
            const tid = permissionService.getTerminalId();
            if (!tid || !businessConfig?.terminals) return null;
            const terminal = (businessConfig.terminals as any[]).find((t: any) => t.id === tid);
            return terminal?.config || null;
        } catch {
            return null;
        }
    }

    /** Catálogo tal cual viene del ERP/master; el POS no inventa tarifas ni almacenes. */
    private async enrichPulledProducts(items: any[]): Promise<any[]> {
        return await productImageCacheService.normalizeIncomingProducts(Array.isArray(items) ? items : []);
    }

    /**
     * Repair missing documentType in sequence data (Legacy/Imported Fix)
     */
    private repairSequenceData(item: any): any {
        const rawPrefix = String(item.prefix || '').trim();
        const idStr = String(item.id || '').trim();
        let base = { ...item };
        if (!rawPrefix || looksLikeUuidString(rawPrefix) || rawPrefix.toLowerCase() === idStr.toLowerCase()) {
            base.prefix = resolveDocumentSeriesDisplayPrefix(item);
        }

        if (base.documentType) return base;

        console.log(`🛠️ SyncManager: Repairing missing documentType for sequence ${base.id} (${base.prefix})`);

        // Match by ID first (Defaults)
        if (base.id === 'TICKET') return { ...base, documentType: 'TICKET' };
        if (base.id === 'REFUND') return { ...base, documentType: 'REFUND' };
        if (base.id === 'TRANSFER') return { ...base, documentType: 'TRANSFER' };
        if (base.id === 'VOID') return { ...base, documentType: 'VOID' };

        // Match by Prefix
        const prefix = base.prefix || '';
        if (prefix.startsWith('TCK')) return { ...base, documentType: 'TICKET' };
        if (prefix.startsWith('NC') || prefix.startsWith('REF')) return { ...base, documentType: 'REFUND' };
        if (prefix.startsWith('TR')) return { ...base, documentType: 'TRANSFER' };
        if (prefix.startsWith('VOID')) return { ...base, documentType: 'VOID' };
        if (prefix.startsWith('AJ')) return { ...base, documentType: 'ADJUSTMENT_IN' };
        if (prefix.startsWith('CR') || prefix.startsWith('CK')) return { ...base, documentType: 'Z_REPORT' };
        if (prefix.startsWith('XP')) return { ...base, documentType: 'X_REPORT' };

        // Fallback for everything else
        return { ...base, documentType: 'TICKET' };
    }
}

export const syncManager = new SyncManager();
