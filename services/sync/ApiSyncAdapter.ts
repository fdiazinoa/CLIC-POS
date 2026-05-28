import { Product } from '../../types';
import {
    buildErpCashMovementPayload,
    buildErpInventoryLedgerPayload,
    buildErpLoyaltyEventPayload,
    buildErpSalePayload,
    buildErpWalletEventPayload,
    buildErpZReportPayload
} from './erpOutboundPayloads';
import { permissionService } from './PermissionService';
import { getSyncDeviceToken, markSyncDeviceTokenInvalid, previewSyncDeviceToken, resolveSyncDeviceToken } from './deviceToken';
import {
    getSyncProfileSourcePriority,
    loadSyncProfile,
    resolveSyncTarget,
    ResolvedSyncTarget
} from './SyncProfile';
import {
    reportSyncErrorDiagnostic,
    setCatalogDiagnosticStatus,
    setSalesPushDiagnosticStatus,
    setSyncAuthDiagnosticStatus,
    setTerminalBindingDiagnosticStatus,
    type SyncDiagnosticOperation
} from './SyncErrorDiagnostic';
import { requestJson } from '../network/httpClient';
import { clearStoredSyncToken, readTerminalCredentialsSync, saveTerminalCredentialsSync } from './TerminalCredentialStore';

/**
 * API Sync Adapter
 * 
 * Synchronization adapter that uses REST API to communicate with the Master terminal.
 * Replaces the localStorage-based LocalSyncAdapter with a modern HTTP-based approach.
 */

export interface SyncChange {
    collection: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'BULK_UPDATE';
    items: any[];
    timestamp: string;
    sourceTerminalId: string;
    version: number;
}

export interface SyncMetadata {
    collection: string;
    lastSyncedAt: string;
    version: number;
    itemCount: number;
    fullSyncVersion?: number;
}

export interface ProductImageManifestItem {
    id: string;
    hash: string;
    hasImage: boolean;
    updatedAt: string | null;
}

export interface ProductImagePayloadItem {
    id: string;
    image: string | null;
    images: string[];
    hash: string;
    updatedAt: string | null;
}

interface SyncConfig {
    masterUrl: string;
    terminalId: string;
    autoRetry: boolean;
    retryDelayMs: number;
}

interface TerminalInventoryBalancePayload {
    item_id?: string | null;
    product_id?: string | null;
    id?: string | null;
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
    inventory?: {
        cursor?: string | null;
        balances?: TerminalInventoryBalancePayload[];
        has_changes?: boolean;
    };
}

type CircuitBreakerChannel = 'sales' | 'background';
type OperationalSyncOperation = Exclude<SyncDiagnosticOperation, 'REGISTER_TERMINAL'>;

const ERP_TEMPORARILY_UNAVAILABLE_ERROR = 'ERP temporalmente no disponible';
const ERP_SYNC_TOKEN_KEYS = [
    'clic_erp_sync_token',
    'clic_erp_sync_auth_token',
    'CLIC_ERP_SYNC_TOKEN',
    'syncAuthToken',
    'sync_auth_token',
    'erp_sync_token',
];
const ERP_SYNC_TOKEN_EXPIRES_AT_KEY = 'clic_erp_sync_token_expires_at';
const ERP_SYNC_TOKEN_UPDATED_AT_KEY = 'clic_erp_sync_token_updated_at';
const ERP_MASTER_PULL_COLLECTIONS = new Set([
    'products',
    'items',
    'taxes',
    'customers',
    'suppliers',
    'warehouses',
    'paymentMethods',
    'priceLists',
    'productPrices',
    'categories',
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
    'productStocks',
    'supplierProductPrices',
]);
const ERP_OPERATION_PUSH_COLLECTIONS = new Set([
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
const ERP_CRITICAL_MASTER_COLLECTIONS = new Set([
    'products',
    'taxes',
    'warehouses',
    'paymentMethods',
    'documentSeries',
    'internalSequences',
    'fiscalRanges',
    'fiscalSequences',
    'terminalFiscalConfig',
]);

const isErpMasterPullCollection = (collection: string): boolean =>
    ERP_MASTER_PULL_COLLECTIONS.has(collection);

const isErpOperationPushCollection = (collection: string): boolean =>
    ERP_OPERATION_PUSH_COLLECTIONS.has(collection);

const logSkippedNonMasterPull = (
    collection: string,
    operation: OperationalSyncOperation,
    endpoint?: string
): void => {
    console.warn('[SYNC_COLLECTION_SKIPPED_NOT_A_MASTER]', {
        collection,
        operation,
        endpoint,
        isMasterCollection: isErpMasterPullCollection(collection),
        isOperationCollection: isErpOperationPushCollection(collection),
        isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(collection),
        skippedReason: isErpOperationPushCollection(collection) ? 'OPERATION_COLLECTION' : 'NOT_A_MASTER_ERP_COLLECTION',
        userVisibleSeverity: 'warning',
        message: 'Colección omitida: no es maestro ERP.',
    });
};

const safeLocalStorageGet = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const safeLocalStorageSet = (key: string, value: string): void => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage quota must not break the operational binding.
    }
};

const safeLocalStorageRemove = (key: string): void => {
    try {
        localStorage.removeItem(key);
    } catch {
        // Non-critical cleanup.
    }
};

const previewSyncToken = (token?: string | null): string | null => {
    const normalized = String(token || '').trim();
    if (!normalized) return null;
    if (normalized.length <= 10) return `${normalized.slice(0, 2)}...${normalized.slice(-2)}`;
    return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
};

const sanitizeSyncToken = (token?: string | null): string | null => {
    const normalized = String(token || '')
        .replace(/[\r\n\t]/g, '')
        .trim();

    if (!normalized) return null;
    if (['undefined', 'null', 'nan'].includes(normalized.toLowerCase())) return null;
    if (normalized === '[object Object]') return null;
    if (normalized.length < 8) return null;
    return normalized;
};

const pickFirstString = (...values: unknown[]): string | null => {
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
    }
    return null;
};

class SyncCircuitBreaker {
    private consecutiveFailures = 0;
    private openedAt = 0;

    constructor(
        private readonly channel: CircuitBreakerChannel,
        private readonly maxConsecutiveFailures = 3,
        private readonly resetTimeoutMs = 30000
    ) {}

    assertAvailable() {
        if (this.consecutiveFailures < this.maxConsecutiveFailures) return;

        const elapsed = Date.now() - this.openedAt;
        if (elapsed < this.resetTimeoutMs) {
            console.warn(`[SYNC_HTTP] circuit=${this.channel} open message="${ERP_TEMPORARILY_UNAVAILABLE_ERROR}"`);
            throw new Error(ERP_TEMPORARILY_UNAVAILABLE_ERROR);
        }

        console.log(`[SYNC_HTTP] circuit=${this.channel} half-open after cooldown; retrying ERP connectivity.`);
        this.consecutiveFailures = 0;
        this.openedAt = 0;
    }

    recordSuccess(): boolean {
        const wasOpen = this.consecutiveFailures >= this.maxConsecutiveFailures;
        this.reset();
        return wasOpen;
    }

    recordConnectionFailure(): boolean {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures < this.maxConsecutiveFailures) return false;

        this.openedAt = Date.now();
        console.error(
            `[SYNC_HTTP] circuit=${this.channel} opened message="${ERP_TEMPORARILY_UNAVAILABLE_ERROR}" failures=${this.consecutiveFailures}`
        );
        return true;
    }

    canRetry(): boolean {
        return this.consecutiveFailures < this.maxConsecutiveFailures;
    }

    reset() {
        this.consecutiveFailures = 0;
        this.openedAt = 0;
    }
}

class ApiSyncAdapter {
    private config: SyncConfig | null = null;
    private authToken: string | null = null;
    private erpAuthToken: string | null = null;
    private operationalTargetHint: { terminalId: string | null; baseUrl: string | null } = { terminalId: null, baseUrl: null };
    private isOnline: boolean = true;
    private authInFlight: Record<CircuitBreakerChannel, Promise<void> | null> = { sales: null, background: null };
    private erpAuthInFlight: Record<CircuitBreakerChannel, Promise<string> | null> = { sales: null, background: null };
    private lastOperationalStockBalanceMaps = new Map<string, Record<string, number>>();
    private onlineListener: (() => void) | null = null;
    private offlineListener: (() => void) | null = null;

    private readonly salesCircuitBreaker = new SyncCircuitBreaker('sales');
    private readonly backgroundCircuitBreaker = new SyncCircuitBreaker('background');
    private onConnectionRestored: (() => void) | null = null;
    private lastAuthLogAt: Record<'master' | 'erp', number> = { master: 0, erp: 0 };
    private readonly AUTH_LOG_THROTTLE_MS = 5000;

    private isCircuitBreakerOpenError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error || '');
        return message.includes(ERP_TEMPORARILY_UNAVAILABLE_ERROR);
    }

    private safeParseSyncJson(text: string): any | null {
        try {
            return text ? JSON.parse(text) : null;
        } catch {
            return null;
        }
    }

    private collectResponseFacts(value: unknown, facts: {
        success: boolean;
        applied: boolean;
        alreadyApplied: boolean;
        duplicate: boolean;
        realApplyError: boolean;
        errors: string[];
    }) {
        if (value === null || value === undefined) return;

        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (!normalized) return;
            if (
                normalized.includes('already_applied') ||
                normalized.includes('already applied') ||
                normalized.includes('already exists') ||
                normalized.includes('ya existe') ||
                normalized.includes('ya fue aplicado') ||
                normalized.includes('previamente aplicado') ||
                normalized.includes('applied previously') ||
                normalized.includes('apply_skipped_reason') && normalized.includes('already_applied')
            ) {
                facts.alreadyApplied = true;
            }
            if (
                normalized.includes('duplicate') ||
                normalized.includes('duplicado') ||
                normalized.includes('duplicada') ||
                normalized.includes('duplicated')
            ) {
                facts.duplicate = true;
            }
            if (normalized === 'success' || normalized === 'ok') facts.success = true;
            if (normalized === 'applied') facts.applied = true;
            if (normalized === 'already_applied') facts.alreadyApplied = true;
            return;
        }

        if (typeof value !== 'object') return;

        if (Array.isArray(value)) {
            value.forEach(item => this.collectResponseFacts(item, facts));
            return;
        }

        for (const [rawKey, rawVal] of Object.entries(value as Record<string, unknown>)) {
            const key = rawKey.toLowerCase();
            const stringVal = typeof rawVal === 'string' ? rawVal.trim().toLowerCase() : '';

            if ((key === 'status' || key === 'sync_status' || key === 'applied_status') && stringVal === 'success') {
                facts.success = true;
            }
            if ((key === 'sync_status' || key === 'applied_status' || key === 'status') && stringVal === 'applied') {
                facts.applied = true;
            }
            if (key === 'success' && rawVal === true) facts.success = true;
            if (key === 'applied' && rawVal === true) facts.applied = true;
            if (key === 'duplicate' && rawVal === true) facts.duplicate = true;
            if (key === 'already_applied' && rawVal === true) facts.alreadyApplied = true;
            if (key === 'apply_skipped_reason' && stringVal === 'already_applied') facts.alreadyApplied = true;

            if ((key === 'apply_error' || key === 'error') && rawVal && typeof rawVal !== 'object') {
                const errorText = String(rawVal);
                const errorFacts = { success: false, applied: false, alreadyApplied: false, duplicate: false, realApplyError: false, errors: [] as string[] };
                this.collectResponseFacts(errorText, errorFacts);
                if (!errorFacts.alreadyApplied && !errorFacts.duplicate) {
                    facts.realApplyError = true;
                    facts.errors.push(errorText);
                }
            }

            this.collectResponseFacts(rawVal, facts);
        }
    }

    private isIdempotentAppliedResponse(body: any, text = '', responseOk = true): boolean {
        const facts = {
            success: false,
            applied: false,
            alreadyApplied: false,
            duplicate: false,
            realApplyError: false,
            errors: [] as string[]
        };

        this.collectResponseFacts(body, facts);
        this.collectResponseFacts(text, facts);

        if (facts.realApplyError && !facts.alreadyApplied && !facts.duplicate) return false;
        if (facts.alreadyApplied || facts.duplicate) return true;
        if (responseOk && (facts.success || facts.applied)) return true;
        return false;
    }

    private hasRealApplyErrorResponse(body: any, text = ''): boolean {
        const facts = {
            success: false,
            applied: false,
            alreadyApplied: false,
            duplicate: false,
            realApplyError: false,
            errors: [] as string[]
        };

        this.collectResponseFacts(body, facts);
        this.collectResponseFacts(text, facts);
        return facts.realApplyError && !facts.alreadyApplied && !facts.duplicate;
    }

    private allApplyIssuesAreIdempotent(issues: unknown): boolean {
        const list = Array.isArray(issues) ? issues : issues ? [issues] : [];
        return list.length > 0 && list.every(issue => this.isIdempotentAppliedResponse(issue, JSON.stringify(issue), true));
    }

    private attachTransactionSyncAudit(transaction: any, response: any, mode: 'APPLIED' | 'SKIPPED_ALREADY_APPLIED' | 'STAGED') {
        if (!transaction || typeof transaction !== 'object') return;
        const appliedAt = new Date().toISOString();
        transaction.syncResponse = response;
        transaction.syncedAt = appliedAt;
        transaction.erpSyncStatus = mode;
        transaction.erpSyncResponse = response;
        transaction.erpSyncedAt = appliedAt;
        transaction.syncError = undefined;
    }

    private onConnectionLostCallback: (() => void) | null = null;

    private logAuthFailure(kind: 'master' | 'erp', error: unknown) {
        const now = Date.now();
        if (now - this.lastAuthLogAt[kind] < this.AUTH_LOG_THROTTLE_MS) {
            return;
        }

        this.lastAuthLogAt[kind] = now;
        const prefix = kind === 'master' ? '❌ Authentication failed:' : '❌ ERP authentication failed:';
        console.error(prefix, error);
    }

    setOnConnectionLost(callback: () => void) {
        this.onConnectionLostCallback = callback;
    }

    updateMasterUrl(newUrl: string) {
        if (this.config) {
            console.log(`🔄 ApiSyncAdapter: Updating Master URL to ${newUrl}`);
            this.config.masterUrl = newUrl;
            this.authToken = null;
            this.resetCircuitBreaker();
        }
    }

    resetCircuitBreaker() {
        this.salesCircuitBreaker.reset();
        this.backgroundCircuitBreaker.reset();
        this.isOnline = true;
        console.log('🔄 ApiSyncAdapter: ERP circuit breakers manually RESET.');
    }

    /**
     * Public alias for resetCircuitBreaker to match expected interface
     */
    public resetCircuit() {
        this.resetCircuitBreaker();
    }

    isRecoverableConnectionError(error: unknown): boolean {
        if (this.isCircuitBreakerOpenError(error)) return true;
        if (!(error instanceof Error)) return false;
        return error.name === 'AbortError' || error.message === 'Failed to fetch';
    }

    private getCircuitBreaker(channel: CircuitBreakerChannel): SyncCircuitBreaker {
        return channel === 'sales' ? this.salesCircuitBreaker : this.backgroundCircuitBreaker;
    }

    /**
     * Helper: Fetch with Retry and Timeout
     */
    private async fetchWithRetry(
        url: string,
        options: RequestInit = {},
        retries = 2,
        backoff = 500,
        channel: CircuitBreakerChannel = 'background',
        operation: OperationalSyncOperation = channel === 'sales' ? 'PUSH_OPERATIONS' : 'PULL_MASTERS'
    ): Promise<Response> {
        // Add jitter to backoff (±20% randomness)
        const jitter = backoff * 0.2;
        const effectiveBackoff = backoff + (Math.random() * jitter * 2 - jitter);
        const circuitBreaker = this.getCircuitBreaker(channel);
        const shouldGateWithCircuit = operation === 'PUSH_OPERATIONS' || channel === 'sales';
        if (shouldGateWithCircuit) {
            circuitBreaker.assertAvailable();
        }

        const method = String(options.method || 'GET').toUpperCase();
        const headers = this.normalizeFetchHeaders(options.headers);
        const headersSummary = this.summarizeFetchHeaders(headers);
        const bodySize = this.getBodySize(options.body);
        const capacitorPlatform = this.resolveCapacitorPlatform();
        const syncProfile = loadSyncProfile();
        const tokenDiagnostic = this.resolveStoredErpSyncTokenDiagnostic();
        const fetchContext = {
            method,
            url,
            endpoint: url,
            headersPresent: {
                authorization: headersSummary.authorization,
                xSyncToken: headersSummary.xSyncToken,
                xTerminalId: headersSummary.xTerminalId,
                xDeviceId: headersSummary.xDeviceId,
                xDeviceToken: headersSummary.xDeviceToken,
            },
            tokenPresent: Boolean(headersSummary.tokenPreview),
            tokenPreview: headersSummary.tokenPreview,
            tokenLength: headersSummary.tokenLength || tokenDiagnostic.length || 0,
            tokenSource: tokenDiagnostic.source,
            tokenUpdatedAt: tokenDiagnostic.updatedAt,
            bodySize,
            contentType: headersSummary.contentType,
            contractSource: syncProfile.contractSource || null,
            profileSourcePriority: syncProfile.profileSourcePriority ?? getSyncProfileSourcePriority(syncProfile.contractSource),
            networkOnline: typeof navigator !== 'undefined' ? navigator.onLine : null,
            navigatorUserAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
            platform: typeof navigator !== 'undefined' ? navigator.platform : null,
            capacitorPlatform,
            origin: typeof window !== 'undefined' ? window.location.origin : null,
        };

        console.log('[FETCH_PREPARE]', { ...fetchContext, fetchStage: 'PREPARE_HEADERS' });
        console.log('[FETCH_HEADERS]', {
            method,
            url,
            headersPresent: fetchContext.headersPresent,
            tokenPreview: headersSummary.tokenPreview,
            tokenLength: fetchContext.tokenLength,
            tokenSource: fetchContext.tokenSource,
            tokenUpdatedAt: fetchContext.tokenUpdatedAt,
            contentType: headersSummary.contentType,
            contractSource: fetchContext.contractSource,
            profileSourcePriority: fetchContext.profileSourcePriority,
        });

        try {
            const nativeResponse = await requestJson({
                url,
                method,
                headers,
                body: options.body,
                timeoutMs: 5000,
                diagnosticContext: fetchContext,
            });
            const response = new Response(nativeResponse.text, {
                status: nativeResponse.status,
                headers: nativeResponse.headers,
            });
            console.log('[FETCH_RESPONSE]', {
                ...fetchContext,
                networkEngine: nativeResponse.networkEngine,
                fetchStage: nativeResponse.fetchStage || 'RESPONSE_RECEIVED',
                httpStatus: response.status,
                ok: response.ok,
                statusText: response.statusText,
            });

            // Success resets the breaker
            if (response.ok) {
                const wasBreakerOpen = circuitBreaker.recordSuccess();
                if (wasBreakerOpen && this.onConnectionRestored) {
                    console.log('📶 ApiSyncAdapter: Connection restored, notifying listeners.');
                    this.onConnectionRestored();
                }
            }

            if (response.status === 401) {
                this.authToken = null;
                console.warn(`[SYNC_HTTP] 401 Unauthorized at ${url}. Caller must re-authenticate and replay if safe.`);
            }

            // If 503 Service Unavailable or 504 Gateway Timeout, retry
            if ((response.status === 503 || response.status === 504) && retries > 0) {
                console.warn(`⚠️ Request failed with ${response.status}, retrying in ${Math.round(effectiveBackoff)}ms...`);
                await new Promise(r => setTimeout(r, effectiveBackoff));
                return this.fetchWithRetry(url, options, retries - 1, backoff * 2, channel, operation);
            }

            return response;
        } catch (error: any) {
            const isConnectionError = error.name === 'TypeError' && error.message === 'Failed to fetch';
            const isTimeout = error.name === 'AbortError';
            const httpClientDiagnostic = error?.__httpClientDiagnostic;
            const networkEngine = httpClientDiagnostic?.networkEngine || 'fetch';
            const fetchStage = httpClientDiagnostic?.fetchStage
                || (isConnectionError && networkEngine !== 'capacitor-http' && (headersSummary.authorization || headersSummary.xSyncToken || headersSummary.xTerminalId || headersSummary.xDeviceId)
                    ? 'PREFLIGHT_FAILED'
                    : 'FETCH_FAILED');
            const fetchDiagnostic = {
                ...fetchContext,
                ...(httpClientDiagnostic || {}),
                networkEngine,
                fetchStage,
                errorName: error?.name || null,
                errorMessage: error?.message || String(error || ''),
                errorStack: error?.stack || null,
                errorCause: error?.cause ? String(error.cause) : null,
                corsExpectedHeaders: [
                    'Authorization',
                    'X-Sync-Token',
                    'X-Terminal-Id',
                    'X-POS-Terminal-Id',
                    'X-Device-Id',
                    'X-POS-Device-Id',
                    'Content-Type',
                ],
            };
            this.attachFetchDiagnostic(error, fetchDiagnostic);
            console.error('[FETCH_FAILED]', fetchDiagnostic);

            // Increment failure count on network errors
            if (isConnectionError || isTimeout) {
                const opened = circuitBreaker.recordConnectionFailure();
                if (opened) {
                    // Notify listeners about connection loss to trigger auto-discovery
                    if (this.onConnectionLostCallback) {
                        this.onConnectionLostCallback();
                    }
                }
            }

            if ((isConnectionError || isTimeout) && retries > 0 && circuitBreaker.canRetry()) {
                console.warn(`⚠️ Connection error (${error.message}), retrying in ${Math.round(effectiveBackoff)}ms...`);
                await new Promise(r => setTimeout(r, effectiveBackoff));
                return this.fetchWithRetry(url, options, retries - 1, backoff * 1.5, channel, operation);
            }

            throw error;
        }
    }

    private async fetchWithoutCircuitBreaker(url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
        const method = String(options.method || 'GET').toUpperCase();
        const headers = this.normalizeFetchHeaders(options.headers);
        const nativeResponse = await requestJson({
            url,
            method,
            headers,
            body: options.body,
            timeoutMs,
            diagnosticContext: { method, url, endpoint: url, circuitBreaker: false },
        });
        return new Response(nativeResponse.text, {
            status: nativeResponse.status,
            headers: nativeResponse.headers,
        });
    }

    /**
     * Initialize the adapter with configuration
     */
    async initialize(config: SyncConfig): Promise<void> {
        this.config = config;
        await this.authenticate();
        this.setupOnlineDetection();
        console.log(`🌐 ApiSyncAdapter initialized for Master at ${config.masterUrl}`);
    }

    /**
     * Test connection to a specific URL
     */
    async testConnection(url: string): Promise<boolean> {
        try {
            const cleanUrl = url.replace(/\/$/, '');
            const response = await fetch(`${cleanUrl}/api/sync/ping`);
            return response.ok;
        } catch (e) {
            console.error('Ping failed:', e);
            return false;
        }
    }

    /**
     * Authenticate with the Master terminal
     */
    async authenticate(force = false, channel: CircuitBreakerChannel = 'background'): Promise<void> {
        this.ensureConfig();
        if (!this.config) throw new Error('ApiSyncAdapter not initialized'); // Should be caught by ensureConfig

        if (!force && this.authToken) {
            return;
        }

        if (!force && this.authInFlight[channel]) {
            return this.authInFlight[channel]!;
        }

        const authPromise = (async () => {
            try {
                const response = await this.fetchWithRetry(`${this.config!.masterUrl}/api/sync/auth`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        terminalId: this.config!.terminalId,
                        deviceToken: getSyncDeviceToken()
                    })
                }, 2, 500, channel);

                if (!response.ok) {
                    let errorMessage = `Authentication failed: ${response.status} ${response.statusText}`;
                    try {
                        const errorData = await response.json();
                        errorMessage += ` - ${errorData.message} (${errorData.code})`;

                        if (errorData.code === 'DEVICE_MISMATCH') {
                            console.error('🛑 CRITICAL: DEVICE MISMATCH. This terminal ID is bound to another device.');
                        }
                    } catch {
                        // Ignore json parse error
                    }
                    throw new Error(errorMessage);
                }

                const data = await response.json();
                this.authToken = data.token;
                this.isOnline = true;
                console.log(`✅ Authenticated with Master terminal: ${this.config!.terminalId}`);
            } catch (error: unknown) {
                if (this.isCircuitBreakerOpenError(error)) {
                    console.warn(`⚠️ Authentication deferred: ${ERP_TEMPORARILY_UNAVAILABLE_ERROR}, waiting before retry.`);
                } else {
                    this.logAuthFailure('master', error);
                }
                this.isOnline = false;
                throw error;
            }
        })();

        this.authInFlight[channel] = authPromise.finally(() => {
            this.authInFlight[channel] = null;
        });

        return this.authInFlight[channel]!;
    }

    private buildSyncApiBase(url: string): string {
        const trimmed = url.replace(/\/$/, '');
        return /\/api\/sync$/i.test(trimmed) ? trimmed : `${trimmed}/api/sync`;
    }

    private resolveConfigErpBaseUrl(value: unknown): string | null {
        const raw = typeof value === 'string' ? value.trim() : '';
        if (!raw) return null;

        const withProtocol = /^https?:\/\//i.test(raw) ? raw : `${window.location.protocol}//${raw}`;

        try {
            const url = new URL(withProtocol);
            return url
                .toString()
                .replace(/\/api\/sync\/?$/i, '')
                .replace(/\/api\/?$/i, '')
                .replace(/\/+$/, '');
        } catch {
            return null;
        }
    }

    private resolveOperationalInventoryContext(): {
        terminalId: string | null;
        localTerminalId: string | null;
        tenantId: string | null;
        erpBaseUrl: string | null;
        posDeviceId: string | null;
        syncApiBase: string | null;
    } {
        const syncApiBase = this.operationalTargetHint.baseUrl
            ? this.buildSyncApiBase(this.operationalTargetHint.baseUrl)
            : (localStorage.getItem('CLIC_ERP_SYNC_URL') || '').trim() || null;

        const erpBaseUrl =
            this.resolveConfigErpBaseUrl(localStorage.getItem('CLIC_ERP_BASE_URL')) ||
            this.resolveConfigErpBaseUrl(localStorage.getItem('erp_base_url')) ||
            this.resolveConfigErpBaseUrl(syncApiBase) ||
            null;

        return {
            terminalId:
                this.operationalTargetHint.terminalId ||
                localStorage.getItem('clic_erp_sync_terminal_id') ||
                null,
            localTerminalId:
                localStorage.getItem('clic_erp_sync_local_terminal_id') ||
                localStorage.getItem('active_terminal_id') ||
                localStorage.getItem('CLIC_POS_TERMINAL_ID') ||
                null,
            tenantId:
                localStorage.getItem('clic_erp_sync_tenant_id') ||
                localStorage.getItem('active_tenant_id') ||
                localStorage.getItem('clic_tenant_id') ||
                null,
            erpBaseUrl,
            posDeviceId: localStorage.getItem('CLIC_POS_DEVICE_ID') || null,
            syncApiBase,
        };
    }

    private matchesInventoryBalanceProduct(balance: TerminalInventoryBalancePayload | Record<string, unknown>, productId?: string): boolean {
        const target = String(productId || '').trim();
        if (!target) return true;

        const candidateValues = [
            balance?.item_id,
            balance?.product_id,
            balance?.id,
        ];

        return candidateValues.some((value) => String(value || '').trim() === target);
    }

    private buildOperationalStockBalanceCacheKey(productId?: string): string {
        return String(productId || '__ALL__').trim() || '__ALL__';
    }

    private buildOperationalStockBalanceMap(
        balances: Array<TerminalInventoryBalancePayload | Record<string, unknown>> = []
    ): Record<string, number> {
        const normalized: Record<string, number> = {};

        for (const balance of balances) {
            const warehouseId = String(
                (balance as any)?.warehouse_id
                || (balance as any)?.warehouseId
                || (balance as any)?.id
                || ''
            ).trim();
            const qtyOnHand = Number(
                (balance as any)?.qty_on_hand
                ?? (balance as any)?.qtyOnHand
                ?? (balance as any)?.quantity
                ?? (balance as any)?.qty
                ?? (balance as any)?.stock
                ?? (balance as any)?.balance
            );

            if (!warehouseId || !Number.isFinite(qtyOnHand)) {
                continue;
            }

            normalized[warehouseId] = Number(normalized[warehouseId] || 0) + qtyOnHand;
        }

        return normalized;
    }

    private normalizeTerminalInventoryPayload(payload: unknown): Required<Pick<TerminalInventoryPayload, 'balances' | 'cursor' | 'has_changes'>> {
        const root = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload as Record<string, unknown>
            : {};
        const nested = root.inventory && typeof root.inventory === 'object' && !Array.isArray(root.inventory)
            ? root.inventory as Record<string, unknown>
            : {};

        const balances = Array.isArray(nested.balances)
            ? nested.balances
            : Array.isArray(root.balances)
                ? root.balances
                : Array.isArray((root.data as any)?.inventory?.balances)
                    ? (root.data as any).inventory.balances
                    : [];

        const cursor = typeof nested.cursor === 'string'
            ? nested.cursor.trim() || null
            : typeof root.cursor === 'string'
                ? root.cursor.trim() || null
                : null;

        const hasChanges = typeof nested.has_changes === 'boolean'
            ? nested.has_changes
            : typeof root.has_changes === 'boolean'
                ? root.has_changes
                : true;

        return {
            balances: balances as TerminalInventoryBalancePayload[],
            cursor,
            has_changes: hasChanges,
        };
    }

    setOperationalTargetHint(input: { terminalId?: string | null; baseUrl?: string | null }) {
        const terminalId = String(input.terminalId || '').trim();
        const baseUrl = String(input.baseUrl || '').trim();
        this.operationalTargetHint = {
            terminalId: terminalId || null,
            baseUrl: baseUrl || null,
        };
        if (baseUrl) {
            localStorage.setItem('CLIC_ERP_BASE_URL', baseUrl.replace(/\/api\/sync\/?$/i, '').replace(/\/+$/, ''));
            localStorage.setItem('erp_base_url', baseUrl.replace(/\/api\/sync\/?$/i, '').replace(/\/+$/, ''));
            localStorage.setItem('CLIC_ERP_SYNC_URL', this.buildSyncApiBase(baseUrl));
        }
        if (terminalId) {
            localStorage.setItem('clic_erp_sync_terminal_id', terminalId);
        }
    }

    isUsingErpOperationalTarget(): boolean {
        return this.resolveOperationalTarget()?.useLocalTarget === false;
    }

    private resolveCurrentDeviceId(): string | null {
        return pickFirstString(
            safeLocalStorageGet('CLIC_POS_DEVICE_ID'),
            safeLocalStorageGet('pos_device_id'),
            safeLocalStorageGet('clic_pos_device_id')
        );
    }

    private resolveCurrentTenantId(): string | null {
        const profile = loadSyncProfile();
        return pickFirstString(
            safeLocalStorageGet('clic_erp_sync_tenant_id'),
            safeLocalStorageGet('active_tenant_id'),
            safeLocalStorageGet('clic_tenant_id'),
            profile.erpTenantId,
            profile.cloudTenantId,
            profile.localTenantId
        );
    }

    private resolveStoredErpSyncToken(): string | null {
        return this.resolveStoredErpSyncTokenDiagnostic().token;
    }

    private resolveStoredErpSyncTokenDiagnostic(): { token: string | null; source: string | null; updatedAt: string | null; length: number } {
        const storedCredentials = readTerminalCredentialsSync();
        const credentialToken = sanitizeSyncToken(storedCredentials.syncToken || null);
        if (credentialToken) {
            return {
                token: credentialToken,
                source: 'TERMINAL_CREDENTIAL_STORE',
                updatedAt: storedCredentials.syncTokenUpdatedAt || null,
                length: credentialToken.length,
            };
        }

        for (const key of ERP_SYNC_TOKEN_KEYS) {
            const token = sanitizeSyncToken(safeLocalStorageGet(key));
            if (token) {
                return {
                    token,
                    source: key,
                    updatedAt: safeLocalStorageGet(ERP_SYNC_TOKEN_UPDATED_AT_KEY),
                    length: token.length,
                };
            }
        }
        return { token: null, source: null, updatedAt: safeLocalStorageGet(ERP_SYNC_TOKEN_UPDATED_AT_KEY), length: 0 };
    }

    private persistErpSyncToken(token: string, expiresAt?: unknown): void {
        const normalized = sanitizeSyncToken(token);
        if (!normalized) return;
        safeLocalStorageSet('clic_erp_sync_token', normalized);
        const updatedAt = new Date().toISOString();
        safeLocalStorageSet(ERP_SYNC_TOKEN_UPDATED_AT_KEY, updatedAt);
        if (typeof expiresAt === 'string' && expiresAt.trim()) {
            safeLocalStorageSet(ERP_SYNC_TOKEN_EXPIRES_AT_KEY, expiresAt.trim());
        }
        saveTerminalCredentialsSync({
            syncToken: normalized,
            syncTokenUpdatedAt: updatedAt,
            syncTokenExpiresAt: typeof expiresAt === 'string' && expiresAt.trim() ? expiresAt.trim() : null,
        });
    }

    private clearCanonicalErpSyncToken(): void {
        safeLocalStorageRemove('clic_erp_sync_token');
        safeLocalStorageRemove(ERP_SYNC_TOKEN_EXPIRES_AT_KEY);
        safeLocalStorageRemove(ERP_SYNC_TOKEN_UPDATED_AT_KEY);
        clearStoredSyncToken();
    }

    private buildOperationalHeaders(
        target: { terminalId: string; useLocalTarget: boolean },
        token: string,
        includeContentType = false
    ): Record<string, string> {
        const headers: Record<string, string> = {};
        if (includeContentType) {
            headers['Content-Type'] = 'application/json';
        }

        const normalizedToken = sanitizeSyncToken(token);
        if (normalizedToken) {
            headers.Authorization = `Bearer ${normalizedToken}`;
            headers['X-Sync-Token'] = normalizedToken;
        } else if (token) {
            console.warn('[INVALID_SYNC_HEADERS]', {
                reason: 'INVALID_OR_EMPTY_SYNC_TOKEN',
                tokenPreview: previewSyncToken(token),
            });
        }

        if (!target.useLocalTarget && target.terminalId) {
            headers['X-Terminal-Id'] = target.terminalId;
            headers['X-POS-Terminal-Id'] = target.terminalId;
        }

        const deviceId = this.resolveCurrentDeviceId();
        if (!target.useLocalTarget && deviceId) {
            headers['X-Device-Id'] = deviceId;
            headers['X-POS-Device-Id'] = deviceId;
        }

        const tenantId = this.resolveCurrentTenantId();
        if (!target.useLocalTarget && tenantId) {
            headers['X-Tenant-Id'] = tenantId;
            headers['X-POS-Tenant-Id'] = tenantId;
        }

        return headers;
    }

    private buildRequestAuthDiagnostic(headers: Record<string, string>) {
        const authHeader = headers.Authorization || '';
        const syncToken = headers['X-Sync-Token'] || '';
        return {
            authorizationPresent: Boolean(authHeader),
            syncTokenPresent: Boolean(syncToken),
            syncTokenPreview: previewSyncToken(syncToken || authHeader.replace(/^Bearer\s+/i, '')),
            terminalIdHeaderPresent: Boolean(headers['X-Terminal-Id'] || headers['X-POS-Terminal-Id']),
            deviceIdHeaderPresent: Boolean(headers['X-Device-Id'] || headers['X-POS-Device-Id']),
        };
    }

    private normalizeFetchHeaders(headers: HeadersInit | undefined): Record<string, string> {
        const normalized: Record<string, string> = {};
        if (!headers) return normalized;

        const assign = (key: string, value: unknown) => {
            const headerName = String(key || '').trim();
            const headerValue = String(value ?? '').replace(/[\r\n]/g, '').trim();
            if (!headerName || !headerValue || ['undefined', 'null', '[object object]'].includes(headerValue.toLowerCase())) {
                if (headerName) {
                    console.warn('[INVALID_SYNC_HEADERS]', { headerName, reason: 'EMPTY_OR_INVALID_VALUE' });
                }
                return;
            }
            normalized[headerName] = headerValue;
        };

        if (headers instanceof Headers) {
            headers.forEach((value, key) => assign(key, value));
            return normalized;
        }

        if (Array.isArray(headers)) {
            headers.forEach(([key, value]) => assign(key, value));
            return normalized;
        }

        Object.entries(headers).forEach(([key, value]) => assign(key, value));
        return normalized;
    }

    private summarizeFetchHeaders(headers: Record<string, string>) {
        const syncToken = headers['X-Sync-Token'] || headers['x-sync-token'] || '';
        const authorization = headers.Authorization || headers.authorization || '';
        const deviceToken = headers['X-Device-Token'] || headers['x-device-token'] || '';
        const effectiveToken = syncToken || authorization.replace(/^Bearer\s+/i, '') || deviceToken;
        return {
            authorization: Boolean(authorization),
            xSyncToken: Boolean(syncToken),
            xTerminalId: Boolean(headers['X-Terminal-Id'] || headers['X-POS-Terminal-Id'] || headers['x-terminal-id'] || headers['x-pos-terminal-id']),
            xDeviceId: Boolean(headers['X-Device-Id'] || headers['X-POS-Device-Id'] || headers['x-device-id'] || headers['x-pos-device-id']),
            xDeviceToken: Boolean(deviceToken),
            tokenPreview: previewSyncToken(syncToken || authorization.replace(/^Bearer\s+/i, '')) || previewSyncDeviceToken(deviceToken),
            tokenLength: sanitizeSyncToken(effectiveToken)?.length || deviceToken.length || 0,
            contentType: headers['Content-Type'] || headers['content-type'] || null,
        };
    }

    private resolveCapacitorPlatform(): string {
        try {
            const capacitor = (window as any)?.Capacitor;
            if (capacitor && typeof capacitor.getPlatform === 'function') {
                return String(capacitor.getPlatform() || 'unknown');
            }
        } catch {
            // ignore
        }
        return 'web';
    }

    private getBodySize(body: BodyInit | null | undefined): number {
        if (!body) return 0;
        if (typeof body === 'string') return body.length;
        if (body instanceof Blob) return body.size;
        if (body instanceof FormData) return -1;
        if (body instanceof URLSearchParams) return body.toString().length;
        return -1;
    }

    private attachFetchDiagnostic(error: unknown, diagnostic: Record<string, unknown>): void {
        if (!error || typeof error !== 'object') return;
        try {
            Object.defineProperty(error, '__syncFetchDiagnostic', {
                value: diagnostic,
                configurable: true,
                enumerable: false,
            });
        } catch {
            (error as any).__syncFetchDiagnostic = diagnostic;
        }
    }

    private extractSyncTokenFromAuthResponse(data: any): { token: string | null; expiresAt?: unknown } {
        const token = pickFirstString(
            data?.token,
            data?.syncToken,
            data?.sync_token,
            data?.syncAuthToken,
            data?.sync_auth_token,
            data?.access_token,
            data?.session?.syncToken,
            data?.session?.sync_token,
            data?.terminal_config?.syncToken,
            data?.terminal_config?.sync_token,
            data?.terminal_config?.syncAuthToken,
            data?.terminal_config?.sync_auth_token,
            data?.config?.syncToken,
            data?.config?.sync_token,
            data?.config?.security?.syncAuthToken,
            data?.config?.runtime?.syncAuthToken
        );

        const expiresAt = pickFirstString(
            data?.tokenExpiresAt,
            data?.token_expires_at,
            data?.expiresAt,
            data?.expires_at,
            data?.session?.tokenExpiresAt,
            data?.session?.expires_at
        );

        return { token, expiresAt };
    }

    private buildSyncTokenError(
        code: 'SYNC_TOKEN_MISSING_LOCAL' | 'SYNC_TOKEN_REJECTED',
        detail?: string
    ): Error {
        const message = code === 'SYNC_TOKEN_MISSING_LOCAL'
            ? 'SYNC_TOKEN_MISSING_LOCAL: No hay syncToken local para la terminal vinculada.'
            : 'SYNC_TOKEN_REJECTED: El ERP rechazó el token de sincronización.';
        return new Error(detail ? `${message} ${detail}` : message);
    }

    private buildProtectedPullAuthError(input: {
        collection: string;
        endpoint: string;
        status: number;
        responseBody: string;
        headers: Record<string, string>;
        backendCode?: string | null;
    }): Error {
        const backendCode = input.backendCode
            || (input.status === 401 ? 'AUTH_REQUIRED' : 'AUTH_FAILED');
        const error = new Error(`AUTH_REQUIRED: Falta autenticación/syncToken para descargar ${input.collection}.`);
        reportSyncErrorDiagnostic({
            operation: 'PULL_MASTERS',
            collection: input.collection,
            endpoint: input.endpoint,
            httpStatus: input.status,
            responseBody: input.responseBody,
            error,
            authStatus: backendCode,
            backendCode,
            requestAuth: this.buildRequestAuthDiagnostic(input.headers),
            isMasterCollection: true,
            isOperationCollection: false,
            isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(input.collection),
            userVisibleSeverity: 'critical',
        });
        return error;
    }

    private normalizeBackendCode(payload: any): string | null {
        return pickFirstString(
            payload?.code,
            payload?.errorCode,
            payload?.error_code,
            payload?.statusCode,
            payload?.status_code,
            payload?.error?.code
        );
    }

    private normalizeBackendNextAction(payload: any): string | null {
        return pickFirstString(
            payload?.nextAction,
            payload?.next_action,
            payload?.error?.nextAction,
            payload?.error?.next_action,
        );
    }

    private isDeviceTokenInvalidResponse(status: number, payload: any, rawBody = ''): boolean {
        if (status !== 403) return false;
        const backendCode = this.normalizeBackendCode(payload);
        const message = pickFirstString(payload?.message, payload?.error, payload?.detail, rawBody) || '';
        return backendCode === 'DEVICE_TOKEN_INVALID' || /device token invalid/i.test(message);
    }

    private isDeviceNotAuthorizedResponse(status: number, payload: any, rawBody = ''): boolean {
        if (status !== 403) return false;
        const backendCode = this.normalizeBackendCode(payload);
        const message = pickFirstString(payload?.message, payload?.error, payload?.detail, rawBody) || '';
        return backendCode === 'DEVICE_NOT_AUTHORIZED' || /este equipo ya no es la terminal autorizada/i.test(message);
    }

    private isFiscalConfigMissingResponse(status: number, payload: any, rawBody = ''): boolean {
        if (status !== 409) return false;
        const backendCode = this.normalizeBackendCode(payload);
        const collection = pickFirstString(payload?.collection, payload?.error?.collection);
        const message = pickFirstString(payload?.message, payload?.error, payload?.detail, rawBody) || '';
        return backendCode === 'FISCAL_CONFIG_MISSING'
            || collection === 'fiscalSequences'
            || /falta configuraci[oó]n fiscal/i.test(message);
    }

    private markDiagnosticReported(error: Error): Error {
        try {
            Object.defineProperty(error, '__syncDiagnosticReported', {
                value: true,
                configurable: true,
                enumerable: false,
            });
        } catch {
            (error as any).__syncDiagnosticReported = true;
        }
        return error;
    }

    private wasDiagnosticReported(error: unknown): boolean {
        return Boolean(error && typeof error === 'object' && (error as any).__syncDiagnosticReported);
    }

    private handleFiscalConfigMissing(input: {
        operation: SyncDiagnosticOperation;
        collection: string;
        endpoint: string;
        status: number;
        payload: any;
        responseBody: string;
        requestHeaders: Record<string, string>;
    }): Error {
        setCatalogDiagnosticStatus('FISCAL_CONFIG_MISSING');
        setSalesPushDiagnosticStatus('LOCKED_FISCAL_CONFIG_REQUIRED');

        const canIssueNonFiscalSales = safeLocalStorageGet('canIssueNonFiscalSales') === 'true'
            || safeLocalStorageGet('clic_can_issue_non_fiscal_sales') === 'true';
        const backendCode = this.normalizeBackendCode(input.payload) || 'FISCAL_CONFIG_MISSING';
        const backendNextAction = this.normalizeBackendNextAction(input.payload);
        const nextAction = canIssueNonFiscalSales
            ? 'CONFIGURE_FISCAL_OR_USE_NON_FISCAL_POLICY'
            : (backendNextAction || 'CONFIGURE_TERMINAL_FISCAL_SETTINGS');
        const baseMessage = 'FISCAL_CONFIG_MISSING: Falta configuración fiscal para esta terminal. Configura las series, rangos y consecutivos en el ERP.';
        const error = new Error(canIssueNonFiscalSales
            ? `${baseMessage} Las ventas no fiscales pueden habilitarse según la política de esta terminal.`
            : baseMessage);

        console.warn('[FISCAL_CONFIG_MISSING]', {
            collection: input.collection,
            endpoint: input.endpoint,
            httpStatus: input.status,
            backendCode,
            catalogSyncStatus: 'FISCAL_CONFIG_MISSING',
            salesPushStatus: 'LOCKED_FISCAL_CONFIG_REQUIRED',
            canIssueNonFiscalSales,
            nextAction,
        });

        reportSyncErrorDiagnostic({
            operation: input.operation,
            collection: input.collection,
            endpoint: input.endpoint,
            httpStatus: input.status,
            responseBody: input.responseBody,
            error,
            backendCode,
            nextAction,
            requestAuth: this.buildRequestAuthDiagnostic(input.requestHeaders),
            isMasterCollection: true,
            isOperationCollection: false,
            isCriticalMaster: true,
            userVisibleSeverity: 'critical',
        });

        return this.markDiagnosticReported(error);
    }

    private normalizeBackendDebugId(payload: any): string | null {
        return pickFirstString(
            payload?.debugId,
            payload?.debug_id,
            payload?.error?.debugId,
            payload?.error?.debug_id,
        );
    }

    private resolveFailedMasterCollection(requestCollection: string, payload: any): string {
        return pickFirstString(
            payload?.collection,
            payload?.error?.collection,
            requestCollection,
        ) || requestCollection || 'desconocida';
    }

    private isMasterCollectionPullFailedResponse(status: number, payload: any, rawBody = ''): boolean {
        if (status !== 500) return false;
        const backendCode = this.normalizeBackendCode(payload);
        const message = pickFirstString(payload?.message, payload?.error, payload?.detail, rawBody) || '';
        return backendCode === 'SYNC_COLLECTION_PULL_FAILED'
            || /sync_collection_pull_failed/i.test(message);
    }

    private throwIfKnownMasterPullFailure(input: {
        operation: SyncDiagnosticOperation;
        collection: string;
        endpoint: string;
        status: number;
        payload: any;
        responseBody: string;
        requestHeaders: Record<string, string>;
    }): void {
        if (this.isFiscalConfigMissingResponse(input.status, input.payload, input.responseBody)) {
            throw this.handleFiscalConfigMissing(input);
        }
        if (this.isMasterCollectionPullFailedResponse(input.status, input.payload, input.responseBody)) {
            throw this.handleMasterCollectionPullFailed(input);
        }
    }

    private handleMasterCollectionPullFailed(input: {
        operation: SyncDiagnosticOperation;
        collection: string;
        endpoint: string;
        status: number;
        payload: any;
        responseBody: string;
        requestHeaders: Record<string, string>;
    }): Error {
        setCatalogDiagnosticStatus('ERP_MASTER_PULL_FAILED');
        setSalesPushDiagnosticStatus('LOCKED_MASTER_SYNC_REQUIRED');

        const backendCode = this.normalizeBackendCode(input.payload) || 'SYNC_COLLECTION_PULL_FAILED';
        const failedCollection = this.resolveFailedMasterCollection(input.collection, input.payload);
        const debugId = this.normalizeBackendDebugId(input.payload);
        const baseMessage = `SYNC_COLLECTION_PULL_FAILED: El ERP falló al generar la colección ${failedCollection}. Revisa el backend ERP.`;
        const error = new Error(debugId ? `${baseMessage} (debugId: ${debugId})` : baseMessage);

        console.warn('[ERP_MASTER_PULL_FAILED]', {
            collection: failedCollection,
            endpoint: input.endpoint,
            httpStatus: input.status,
            backendCode,
            debugId,
            catalogSyncStatus: 'ERP_MASTER_PULL_FAILED',
            salesPushStatus: 'LOCKED_MASTER_SYNC_REQUIRED',
        });

        reportSyncErrorDiagnostic({
            operation: input.operation,
            collection: failedCollection,
            endpoint: input.endpoint,
            httpStatus: input.status,
            responseBody: input.responseBody,
            error,
            backendCode,
            debugId,
            requestAuth: this.buildRequestAuthDiagnostic(input.requestHeaders),
            isMasterCollection: true,
            isOperationCollection: false,
            isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(failedCollection),
            userVisibleSeverity: 'critical',
        });

        return this.markDiagnosticReported(error);
    }

    private async parseJsonResponseSafely(response: Response): Promise<{ data: any; text: string }> {
        const text = await response.text().catch(() => '');
        if (!text) return { data: null, text: '' };
        try {
            return { data: JSON.parse(text), text };
        } catch {
            return { data: null, text };
        }
    }

    private handleDeviceTokenInvalid(input: {
        operation: OperationalSyncOperation;
        endpoint: string;
        response: Response;
        payload: any;
        responseBody: string;
        requestHeaders: Record<string, string>;
        tokenResolution: ReturnType<typeof resolveSyncDeviceToken>;
    }): Error {
        this.erpAuthToken = null;
        this.clearCanonicalErpSyncToken();
        markSyncDeviceTokenInvalid('DEVICE_TOKEN_INVALID');
        setTerminalBindingDiagnosticStatus('TOKEN_INVALID');
        setCatalogDiagnosticStatus('AUTH_ERROR');
        setSalesPushDiagnosticStatus('LOCKED_AUTH_REQUIRED');
        setSyncAuthDiagnosticStatus('DEVICE_TOKEN_INVALID');

        const backendCode = this.normalizeBackendCode(input.payload) || 'DEVICE_TOKEN_INVALID';
        const error = new Error('DEVICE_TOKEN_INVALID: El token de esta terminal no coincide con el registrado en el ERP. Debe renovarse el token de terminal o revincular la caja.');
        console.warn('[DEVICE_TOKEN_INVALID]', {
            endpoint: input.endpoint,
            terminalId: this.resolveOperationalTarget(input.operation)?.terminalId || null,
            deviceId: this.resolveCurrentDeviceId(),
            tokenPresent: Boolean(input.tokenResolution.token),
            tokenPreview: previewSyncDeviceToken(input.tokenResolution.token),
            tokenSource: input.tokenResolution.sourceKey,
            tokenUpdatedAt: input.tokenResolution.updatedAt || null,
            backendCode,
            nextAction: 'ROTATE_DEVICE_TOKEN_OR_REBIND',
        });

        reportSyncErrorDiagnostic({
            operation: input.operation,
            endpoint: input.endpoint,
            httpStatus: input.response.status,
            responseBody: input.responseBody,
            error,
            authStatus: 'DEVICE_TOKEN_INVALID',
            backendCode,
            nextAction: 'ROTATE_DEVICE_TOKEN_OR_REBIND',
            requestAuth: {
                ...this.buildRequestAuthDiagnostic(input.requestHeaders),
                syncTokenPreview: previewSyncDeviceToken(input.tokenResolution.token),
            },
            userVisibleSeverity: 'critical',
        });

        return error;
    }

    private handleDeviceNotAuthorized(input: {
        operation: OperationalSyncOperation;
        endpoint: string;
        response: Response;
        payload: any;
        responseBody: string;
        requestHeaders: Record<string, string>;
        tokenResolution: ReturnType<typeof resolveSyncDeviceToken>;
    }): Error {
        this.erpAuthToken = null;
        this.clearCanonicalErpSyncToken();
        setTerminalBindingDiagnosticStatus('BOUND_AUTH_MISMATCH');
        setCatalogDiagnosticStatus('AUTH_ERROR');
        setSalesPushDiagnosticStatus('LOCKED_AUTH_REQUIRED');
        setSyncAuthDiagnosticStatus('DEVICE_NOT_AUTHORIZED');

        const backendCode = this.normalizeBackendCode(input.payload) || 'DEVICE_NOT_AUTHORIZED';
        const error = new Error('DEVICE_NOT_AUTHORIZED: Esta Caja está vinculada, pero este equipo no está autorizado en el ERP. Solicita reautorización desde Cloud-Admin o usa un código de vinculación.');
        console.warn('[DEVICE_NOT_AUTHORIZED]', {
            endpoint: input.endpoint,
            terminalId: this.resolveOperationalTarget(input.operation)?.terminalId || null,
            deviceId: this.resolveCurrentDeviceId(),
            tokenPresent: Boolean(input.tokenResolution.token),
            tokenPreview: previewSyncDeviceToken(input.tokenResolution.token),
            tokenSource: input.tokenResolution.sourceKey,
            tokenUpdatedAt: input.tokenResolution.updatedAt || null,
            backendCode,
            canTakeover: true,
            nextAction: 'REAUTHORIZE_TERMINAL',
        });

        reportSyncErrorDiagnostic({
            operation: input.operation,
            endpoint: input.endpoint,
            httpStatus: input.response.status,
            responseBody: input.responseBody,
            error,
            authStatus: 'DEVICE_NOT_AUTHORIZED',
            backendCode,
            nextAction: 'REAUTHORIZE_TERMINAL',
            requestAuth: {
                ...this.buildRequestAuthDiagnostic(input.requestHeaders),
                syncTokenPreview: previewSyncDeviceToken(input.tokenResolution.token),
            },
            fetchDiagnostic: {
                fetchStage: 'RESPONSE_RECEIVED',
                method: 'POST',
                endpoint: input.endpoint,
                tokenPresent: Boolean(input.tokenResolution.token),
                tokenPreview: previewSyncDeviceToken(input.tokenResolution.token),
                tokenLength: input.tokenResolution.token?.length || 0,
                tokenSource: input.tokenResolution.sourceKey,
                tokenUpdatedAt: input.tokenResolution.updatedAt || null,
                headersPresent: {
                    authorization: false,
                    xSyncToken: false,
                    xTerminalId: Boolean(input.requestHeaders['X-Terminal-Id']),
                    xDeviceId: Boolean(input.requestHeaders['X-Device-Id']),
                    xDeviceToken: Boolean(input.requestHeaders['X-Device-Token']),
                },
                networkOnline: typeof navigator !== 'undefined' ? navigator.onLine : null,
            },
            userVisibleSeverity: 'critical',
        });

        return error;
    }

    private buildOperationalPostBody(
        target: { terminalId: string; useLocalTarget: boolean; kind?: string },
        body: Record<string, unknown>
    ): Record<string, unknown> {
        if (target.useLocalTarget) return body;

        const deviceId = this.resolveCurrentDeviceId();

        const normalizedBody: Record<string, unknown> = {
            ...body,
            terminalId: target.terminalId,
            terminal_id: target.terminalId,
            ...(target.kind ? { sync_channel: target.kind } : {}),
            ...(deviceId ? { device_id: deviceId } : {})
        };

        if (Array.isArray(body.items)) {
            normalizedBody.items = body.items.map((item) => {
                const record = item && typeof item === 'object' && !Array.isArray(item)
                    ? item as Record<string, unknown>
                    : {};

                return {
                    ...record,
                    terminalId: target.terminalId,
                    terminal_id: target.terminalId,
                    ...(deviceId ? { device_id: deviceId } : {})
                };
            });
        }

        return normalizedBody;
    }

    private resolveOperationalTarget(
        operation: OperationalSyncOperation = 'PUSH_OPERATIONS'
    ): ({ baseUrl: string; terminalId: string; useLocalTarget: boolean; kind: ResolvedSyncTarget['kind'] }) | null {
        const routedTarget = resolveSyncTarget();
        console.log(
            `[SYNC_ROUTER] operation=${operation} kind=${routedTarget.kind} dataMaster=${routedTarget.dataMaster} customerErpAccess=${routedTarget.customerErpAccess ? 'yes' : 'no'} canPullMasters=${routedTarget.canPullMasters ? 'yes' : 'no'} canPushOperations=${routedTarget.canPushOperations ? 'yes' : 'no'} reason=${routedTarget.reason || 'OK'}`
        );

        const canRunOperation =
            operation === 'PULL_MASTERS'
                ? routedTarget.canPullMasters
                : operation === 'PULL_CONFIG'
                    ? routedTarget.canPullMasters
                    : operation === 'PUSH_MASTERS'
                        ? routedTarget.canPushMasters
                        : routedTarget.canPushOperations;

        if (routedTarget.kind === 'NONE' || !canRunOperation) {
            console.warn(
                `[SYNC_ROUTER] operation=${operation} blocked locally kind=${routedTarget.kind} reason=${routedTarget.reason || 'INSUFFICIENT_SYNC_PERMISSION'} canPullMasters=${routedTarget.canPullMasters ? 'yes' : 'no'} canPushOperations=${routedTarget.canPushOperations ? 'yes' : 'no'}`
            );
            return null;
        }

        if (routedTarget.baseUrl && routedTarget.terminalId) {
            return {
                baseUrl: routedTarget.baseUrl,
                terminalId: routedTarget.terminalId,
                useLocalTarget: routedTarget.kind === 'POS_MASTER',
                kind: routedTarget.kind,
            };
        }

        const localMasterTarget: { baseUrl: string; terminalId: string; useLocalTarget: boolean } | null = this.config?.masterUrl && this.config?.terminalId
            ? {
                baseUrl: this.buildSyncApiBase(this.config.masterUrl),
                terminalId: this.config.terminalId,
                useLocalTarget: true
            }
            : null;

        if (localMasterTarget && permissionService.isSlaveTerminal()) {
            return { ...localMasterTarget, kind: 'POS_MASTER' };
        }

        return localMasterTarget ? { ...localMasterTarget, kind: 'POS_MASTER' } : null;
    }

    private async authenticateOperationalTarget(
        force = false,
        channel: CircuitBreakerChannel = 'background',
        operation: OperationalSyncOperation = channel === 'sales' ? 'PUSH_OPERATIONS' : 'PULL_MASTERS'
    ): Promise<{
        baseUrl: string;
        terminalId: string;
        token: string;
        useLocalTarget: boolean;
        kind: ResolvedSyncTarget['kind'];
    }> {
        const target = this.resolveOperationalTarget(operation);
        if (!target) {
            const routedTarget = resolveSyncTarget();
            const guardReason = routedTarget.reason || 'INSUFFICIENT_SYNC_PERMISSION';
            const error = new Error(
                operation === 'PULL_MASTERS' || operation === 'PULL_CONFIG'
                    ? 'No se pudo iniciar descarga de maestros'
                    : 'Operational sync target is not configured'
            );
            reportSyncErrorDiagnostic({
                operation,
                endpoint: null,
                httpStatus: null,
                error,
                blockedByLocalGuard: true,
                guardReason,
            });
            throw error;
        }

        if (target.useLocalTarget) {
            if (!this.authToken || force) {
                await this.authenticate(force, channel);
            }

            if (!this.authToken) {
                throw new Error('Operational sync token unavailable for local target');
            }

            return {
                ...target,
                token: this.authToken
            };
        }

        if (!navigator.onLine) {
            throw new Error('Browser offline');
        }

        if (!force && safeLocalStorageGet('clic_sync_auth_status') === 'DEVICE_NOT_AUTHORIZED') {
            const deviceId = this.resolveCurrentDeviceId();
            const deviceTokenResolution = resolveSyncDeviceToken();
            const error = new Error('DEVICE_NOT_AUTHORIZED: Esta Caja está vinculada, pero este equipo no está autorizado en el ERP. Solicita reautorización desde Cloud-Admin o usa un código de vinculación.');
            setTerminalBindingDiagnosticStatus('BOUND_AUTH_MISMATCH');
            setCatalogDiagnosticStatus('AUTH_ERROR');
            setSalesPushDiagnosticStatus('LOCKED_AUTH_REQUIRED');
            reportSyncErrorDiagnostic({
                operation,
                endpoint: `${target.baseUrl}/auth`,
                httpStatus: null,
                error,
                authStatus: 'DEVICE_NOT_AUTHORIZED',
                backendCode: 'DEVICE_NOT_AUTHORIZED',
                nextAction: 'REAUTHORIZE_TERMINAL',
                blockedByLocalGuard: true,
                guardReason: 'DEVICE_NOT_AUTHORIZED',
                requestAuth: {
                    authorizationPresent: false,
                    syncTokenPresent: false,
                    syncTokenPreview: previewSyncDeviceToken(deviceTokenResolution.token),
                    terminalIdHeaderPresent: Boolean(target.terminalId),
                    deviceIdHeaderPresent: Boolean(deviceId),
                },
                userVisibleSeverity: 'critical',
            });
            throw error;
        }

        if (!force && this.erpAuthToken) {
            return {
                ...target,
                token: this.erpAuthToken
            };
        }

        if (!force) {
            const storedToken = this.resolveStoredErpSyncToken();
            if (storedToken) {
                this.erpAuthToken = storedToken;
                return {
                    ...target,
                    token: storedToken
                };
            }
        }

        if (!force && this.erpAuthInFlight[channel]) {
            const token = await this.erpAuthInFlight[channel]!;
            return {
                ...target,
                token
            };
        }

        const erpAuthPromise = (async () => {
            const deviceId = this.resolveCurrentDeviceId();
            const tenantId = this.resolveCurrentTenantId();
            const deviceTokenResolution = resolveSyncDeviceToken();
            const deviceToken = deviceTokenResolution.token;
            const storedSyncTokenDiagnostic = this.resolveStoredErpSyncTokenDiagnostic();
            console.log('[SYNC_AUTH_PREPARE]', {
                baseUrl: target.baseUrl,
                terminalId: target.terminalId,
                deviceId,
                tokenPresent: Boolean(deviceToken),
                tokenSource: deviceTokenResolution.sourceKey,
                tokenLength: deviceToken?.length || 0,
                tokenUpdatedAt: deviceTokenResolution.updatedAt || null,
                syncTokenPresent: Boolean(storedSyncTokenDiagnostic.token),
            });

            if (!deviceToken) {
                const error = new Error('DEVICE_TOKEN_MISSING_LOCAL: No hay deviceToken local para autenticar la terminal vinculada.');
                setTerminalBindingDiagnosticStatus('BOUND');
                setCatalogDiagnosticStatus('AUTH_ERROR');
                setSalesPushDiagnosticStatus('LOCKED_AUTH_REQUIRED');
                setSyncAuthDiagnosticStatus('DEVICE_TOKEN_MISSING_LOCAL');
                reportSyncErrorDiagnostic({
                    operation,
                    endpoint: `${target.baseUrl}/auth`,
                    httpStatus: null,
                    error,
                    authStatus: 'DEVICE_TOKEN_MISSING_LOCAL',
                    backendCode: 'DEVICE_TOKEN_MISSING_LOCAL',
                    nextAction: 'REPAIR_TERMINAL_CREDENTIALS',
                    requestAuth: {
                        authorizationPresent: false,
                        syncTokenPresent: false,
                        syncTokenPreview: null,
                        terminalIdHeaderPresent: Boolean(target.terminalId),
                        deviceIdHeaderPresent: Boolean(deviceId),
                    },
                    blockedByLocalGuard: true,
                    guardReason: 'DEVICE_TOKEN_MISSING_LOCAL',
                });
                throw error;
            }

            const authEndpoint = `${target.baseUrl}/auth`;
            const authHeaders = {
                ...this.buildOperationalHeaders(target, '', true),
                'X-Device-Token': deviceToken,
            };
            const response = await this.fetchWithRetry(authEndpoint, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    terminalId: target.terminalId,
                    terminal_id: target.terminalId,
                    deviceToken,
                    deviceId,
                    device_id: deviceId,
                    tenantId,
                    tenant_id: tenantId
                })
            }, 2, 500, channel, operation);

            if (!response.ok) {
                let errorMessage = `ERP authentication failed: ${response.status} ${response.statusText}`;
                const parsedError = await this.parseJsonResponseSafely(response);
                if (this.isDeviceNotAuthorizedResponse(response.status, parsedError.data, parsedError.text)) {
                    throw this.handleDeviceNotAuthorized({
                        operation,
                        endpoint: authEndpoint,
                        response,
                        payload: parsedError.data,
                        responseBody: parsedError.text,
                        requestHeaders: authHeaders,
                        tokenResolution: deviceTokenResolution,
                    });
                }
                if (this.isDeviceTokenInvalidResponse(response.status, parsedError.data, parsedError.text)) {
                    throw this.handleDeviceTokenInvalid({
                        operation,
                        endpoint: authEndpoint,
                        response,
                        payload: parsedError.data,
                        responseBody: parsedError.text,
                        requestHeaders: authHeaders,
                        tokenResolution: deviceTokenResolution,
                    });
                }
                const errorData = parsedError.data;
                errorMessage += ` - ${errorData?.message || errorData?.error || parsedError.text || 'unknown error'}`;
                throw new Error(errorMessage);
            }

            const data = await response.json();
            const { token, expiresAt } = this.extractSyncTokenFromAuthResponse(data);
            if (token) {
                this.persistErpSyncToken(token, expiresAt);
            }
            return token || '';
        })();

        this.erpAuthInFlight[channel] = erpAuthPromise.finally(() => {
            this.erpAuthInFlight[channel] = null;
        });

        try {
            this.erpAuthToken = await this.erpAuthInFlight[channel]!;
        } catch (error) {
            this.logAuthFailure('erp', error);
            throw error;
        }

        if (!this.erpAuthToken) {
            const error = this.buildSyncTokenError('SYNC_TOKEN_MISSING_LOCAL');
            reportSyncErrorDiagnostic({
                operation,
                endpoint: `${target.baseUrl}/auth`,
                httpStatus: null,
                error,
                requestAuth: this.buildRequestAuthDiagnostic(this.buildOperationalHeaders(target, '', true)),
            });
            throw error;
        }

        return {
            ...target,
            token: this.erpAuthToken
        };
    }

    private async postOperationalPayload(path: string, body: Record<string, unknown>): Promise<void> {
        const target = await this.authenticateOperationalTarget(false, 'sales', 'PUSH_OPERATIONS');
        const requestBody = this.buildOperationalPostBody(target, body);
        const response = await this.fetchWithRetry(`${target.baseUrl}${path}`, {
            method: 'POST',
            headers: this.buildOperationalHeaders(target, target.token, true),
            body: JSON.stringify(requestBody)
        }, 2, 500, 'sales', 'PUSH_OPERATIONS');

        if (response.status === 401) {
            if (target.useLocalTarget) {
                this.authToken = null;
            } else {
                this.erpAuthToken = null;
            }

            const retriedTarget = await this.authenticateOperationalTarget(true, 'sales', 'PUSH_OPERATIONS');
            const retryBody = this.buildOperationalPostBody(retriedTarget, body);
            const retryResponse = await this.fetchWithRetry(`${retriedTarget.baseUrl}${path}`, {
                method: 'POST',
                headers: this.buildOperationalHeaders(retriedTarget, retriedTarget.token, true),
                body: JSON.stringify(retryBody)
            }, 2, 500, 'sales', 'PUSH_OPERATIONS');

            if (!retryResponse.ok) {
                throw new Error(`Operational sync failed after re-auth: ${retryResponse.status} ${retryResponse.statusText}`);
            }

            return;
        }

        if (!response.ok) {
            throw new Error(`Operational sync failed: ${response.status} ${response.statusText}`);
        }
    }

    private async getOperationalPayload<T = any>(
        path: string,
        operation: OperationalSyncOperation = 'PULL_CONFIG'
    ): Promise<T> {
        const target = await this.authenticateOperationalTarget(false, 'background', operation);
        const response = await this.fetchWithRetry(`${target.baseUrl}${path}`, {
            headers: this.buildOperationalHeaders(target, target.token)
        }, 2, 500, 'background', operation);

        if (response.status === 401) {
            if (target.useLocalTarget) {
                this.authToken = null;
            } else {
                this.erpAuthToken = null;
            }

            const retriedTarget = await this.authenticateOperationalTarget(true, 'background', operation);
            const retryResponse = await this.fetchWithRetry(`${retriedTarget.baseUrl}${path}`, {
                headers: this.buildOperationalHeaders(retriedTarget, retriedTarget.token)
            }, 2, 500, 'background', operation);

            if (!retryResponse.ok) {
                throw new Error(`Operational fetch failed after re-auth: ${retryResponse.status} ${retryResponse.statusText}`);
            }

            return await retryResponse.json();
        }

        if (!response.ok) {
            throw new Error(`Operational fetch failed: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Ensure operational push channels never fail silently.
     * If adapter is marked offline but browser has network, force re-auth recovery.
     */
    private async ensurePushReady(channel: CircuitBreakerChannel = 'background'): Promise<void> {
        this.ensureConfig();

        if (!navigator.onLine) {
            this.isOnline = false;
            throw new Error('Browser offline');
        }

        if (!this.isOnline) {
            console.warn('⚠️ ApiSyncAdapter: Recovering from offline state before push...');
            this.authToken = null;
        }

        await this.ensureAuthenticated(channel);
        this.isOnline = true;
    }

    /**
     * Lazy Load Configuration
     * Attempts to reconstruct config from localStorage if missing.
     */
    private ensureConfig() {
        if (this.config) return;

        const masterUrl = localStorage.getItem('CLIC_POS_MASTER_URL');
        const terminalId = localStorage.getItem('CLIC_POS_TERMINAL_ID'); // Ensure this is saved else where

        if (masterUrl && terminalId) {
            console.warn('⚠️ ApiSyncAdapter: Config missing. Lazy loading from localStorage.');
            this.config = {
                masterUrl,
                terminalId,
                autoRetry: true,
                retryDelayMs: 5000
            };
        } else {
            console.error('❌ ApiSyncAdapter: Critical - Cannot lazy load config. Missing masterUrl or terminalId.');
            throw new Error('Sync configuration missing in ApiSyncAdapter. Ensure SyncManager is initialized.');
        }
    }

    /**
     * Ensure we have a valid auth token
     */
    private async ensureAuthenticated(channel: CircuitBreakerChannel = 'background'): Promise<void> {
        if (!this.authToken) {
            console.log("🔄 ApiSyncAdapter: No token found, authenticating...");
            await this.authenticate(false, channel);
        }
    }

    /**
     * Setup online/offline detection
     */
    private setupOnlineDetection(): void {
        if (this.onlineListener) {
            window.removeEventListener('online', this.onlineListener);
        }
        if (this.offlineListener) {
            window.removeEventListener('offline', this.offlineListener);
        }

        this.onlineListener = () => {
            console.log('📶 Network connection restored');
            this.isOnline = true;
            this.ensureAuthenticated().catch((error) => {
                if (this.isCircuitBreakerOpenError(error) || this.isRecoverableConnectionError(error)) {
                    console.warn('⚠️ ApiSyncAdapter: Deferred auth after network restore.', error instanceof Error ? error.message : error);
                    return;
                }
                this.logAuthFailure('master', error);
            });
        };

        this.offlineListener = () => {
            console.log('📡 Network connection lost');
            this.isOnline = false;
        };

        window.addEventListener('online', this.onlineListener);
        window.addEventListener('offline', this.offlineListener);
    }

    /**
     * Set callback for connection restoration (circuit breaker reset)
     */
    setOnConnectionRestored(callback: () => void): void {
        this.onConnectionRestored = callback;
    }

    /**
     * Push changes to Master (called by Master terminal only)
     */
    async push(
        collection: string,
        items: any[],
        action: SyncChange['action'] = 'BULK_UPDATE',
        mode: 'UPSERT' | 'FULL_REPLACE' = 'UPSERT'
    ): Promise<void> {
        const activeProfile = loadSyncProfile();
        const routedTarget = resolveSyncTarget(activeProfile);
        if (activeProfile.contractedProduct === 'POS_ERP') {
            console.warn('[INVALID_PUSH_MASTERS_FOR_POS_ERP]', {
                collection,
                action,
                mode,
                targetKind: routedTarget.kind,
                erpTerminalId: activeProfile.erpTerminalId,
                erpReadyForSales: activeProfile.erpReadyForSales,
            });
            return;
        }
        if (routedTarget.kind === 'POS_CLOUD_STAGING' && routedTarget.canPushMasters) {
            const target = await this.authenticateOperationalTarget(false, 'background', 'PUSH_MASTERS');
            const buildBody = () => JSON.stringify({
                items,
                mode,
                action,
                source: 'POS',
                sync_channel: routedTarget.kind,
                master_type: collection,
                collection
            });
            const postCloudStaging = async (authTarget: {
                baseUrl: string;
                terminalId: string;
                token: string;
                useLocalTarget: boolean;
                kind: ResolvedSyncTarget['kind'];
            }) => {
                const primaryUrl = `${authTarget.baseUrl}/cloud-staging/masters/${collection}`;
                const primaryResponse = await this.fetchWithRetry(primaryUrl, {
                    method: 'POST',
                    headers: this.buildOperationalHeaders(authTarget, authTarget.token, true),
                    body: buildBody()
                }, 2, 500, 'background', 'PUSH_MASTERS');

                if (primaryResponse.status !== 404 && primaryResponse.status !== 405) {
                    return primaryResponse;
                }

                console.warn(`[POS_CLOUD_STAGING] ${primaryUrl} unavailable (${primaryResponse.status}); falling back to legacy collection push.`);
                return this.fetchWithRetry(`${authTarget.baseUrl}/collections/${collection}/push`, {
                    method: 'POST',
                    headers: this.buildOperationalHeaders(authTarget, authTarget.token, true),
                    body: buildBody()
                }, 2, 500, 'background', 'PUSH_MASTERS');
            };

            const response = await postCloudStaging(target);

            if (response.status === 401) {
                this.erpAuthToken = null;
                const retriedTarget = await this.authenticateOperationalTarget(true, 'background', 'PUSH_MASTERS');
                const retryResponse = await postCloudStaging(retriedTarget);
                if (!retryResponse.ok) {
                    throw new Error(`Cloud staging push failed after re-auth: ${retryResponse.status} ${retryResponse.statusText}`);
                }
                console.log(`📤 ApiSyncAdapter: Staged ${items.length} ${collection} item(s) after re-auth.`);
                return;
            }

            if (!response.ok) {
                const detail = await response.text().catch(() => '');
                throw new Error(`Cloud staging push failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
            }

            console.log(`📤 ApiSyncAdapter: Staged ${items.length} ${collection} item(s) to cloud.`);
            return;
        }

        if (routedTarget.kind === 'ERP_ACTIVE' && !routedTarget.canPushMasters) {
            console.warn(`[SYNC_ROUTER] push(${collection}) skipped: ERP_ACTIVE masters are governed by ERP.`);
            return;
        }

        if (routedTarget.kind === 'NONE') {
            console.warn(`[SYNC_ROUTER] push(${collection}) skipped: no cloud sync target.`);
            return;
        }

        if (!this.config) {
            throw new Error('Sync configuration missing in ApiSyncAdapter. Ensure SyncManager is initialized.');
        }

        if (!this.authToken) {
            await this.authenticate();
        }

        if (!this.isOnline) {
            throw new Error('Cannot push while offline');
        }

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/collections/${collection}/push`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken
                },
                body: JSON.stringify({ items, mode })
            }, 2, 500, 'background', 'PUSH_MASTERS');

            if (response.status === 401) {
                // Token expired, re-authenticate
                await this.authenticate();
                return this.push(collection, items, action, mode);
            }

            if (!response.ok) {
                throw new Error(`Push failed: ${response.statusText}`);
            }

            const data = await response.json();
            console.log(`📤 ApiSyncAdapter: Pushed ${items.length} items to ${collection} (v${data.version})`);
        } catch (error) {
            console.error(`❌ ApiSyncAdapter: Error pushing ${collection}:`, error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Pull latest changes from Master (called by Slave terminals)
     */
    async pull(collection: string, sinceVersion?: number): Promise<any[]> {
        const operationalTarget = this.resolveOperationalTarget('PULL_MASTERS');
        if (operationalTarget && !operationalTarget.useLocalTarget) {
            if (!isErpMasterPullCollection(collection)) {
                logSkippedNonMasterPull(collection, 'PULL_MASTERS', `${operationalTarget.baseUrl}/collections/${collection}/data`);
                return [];
            }
            const target = await this.authenticateOperationalTarget(false, 'background', 'PULL_MASTERS');
            const url = new URL(`${target.baseUrl}/collections/${collection}/data`);
            if (sinceVersion) {
                url.searchParams.set('sinceVersion', sinceVersion.toString());
            }

            try {
                const headers = this.buildOperationalHeaders(target, target.token);
                const response = await this.fetchWithRetry(url.toString(), {
                    method: 'GET',
                    headers
                }, 2, 500, 'background', 'PULL_MASTERS');

                if (response.status === 401) {
                    this.erpAuthToken = null;
                    this.clearCanonicalErpSyncToken();
                    const retryTarget = await this.authenticateOperationalTarget(true, 'background', 'PULL_MASTERS');
                    const retryHeaders = this.buildOperationalHeaders(retryTarget, retryTarget.token);
                    const retryResponse = await this.fetchWithRetry(url.toString(), {
                        method: 'GET',
                        headers: retryHeaders
                    }, 2, 500, 'background', 'PULL_MASTERS');
                    if (!retryResponse.ok) {
                        const responseBody = await retryResponse.text().catch(() => '');
                        if (retryResponse.status === 401) {
                            const error = this.buildSyncTokenError('SYNC_TOKEN_REJECTED');
                            reportSyncErrorDiagnostic({
                                operation: 'PULL_MASTERS',
                                collection,
                                endpoint: url.toString(),
                                httpStatus: retryResponse.status,
                                responseBody,
                                error,
                                requestAuth: this.buildRequestAuthDiagnostic(retryHeaders),
                                isMasterCollection: true,
                                isOperationCollection: false,
                                isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(collection),
                                userVisibleSeverity: 'critical',
                            });
                            throw error;
                        }
                        throw new Error(`Pull failed after re-auth: ${retryResponse.status} ${retryResponse.statusText}`);
                    }
                    const retryData = await retryResponse.json();
                    return retryData.items || [];
                }

                if (!response.ok) {
                    if (response.status === 404 && !ERP_CRITICAL_MASTER_COLLECTIONS.has(collection)) {
                        console.warn('[SYNC_COLLECTION_SKIPPED_UNSUPPORTED_COLLECTION]', {
                            collection,
                            operation: 'PULL_MASTERS',
                            endpoint: url.toString(),
                            httpStatus: response.status,
                            userVisibleSeverity: 'warning',
                        });
                        return [];
                    }
                    const responseBody = await response.text().catch(() => '');
                    let payload: any = null;
                    try {
                        payload = responseBody ? JSON.parse(responseBody) : null;
                    } catch {
                        payload = null;
                    }
                    this.throwIfKnownMasterPullFailure({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        status: response.status,
                        payload,
                        responseBody,
                        requestHeaders: headers,
                    });
                    const isCriticalMaster = ERP_CRITICAL_MASTER_COLLECTIONS.has(collection);
                    const error = new Error(
                        response.status === 404 && isCriticalMaster
                            ? `ERP no expone endpoint de maestro crítico: ${collection}`
                            : `Pull failed: ${response.status} ${response.statusText}`
                    );
                    reportSyncErrorDiagnostic({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        httpStatus: response.status,
                        responseBody,
                        error,
                        requestAuth: this.buildRequestAuthDiagnostic(headers),
                        isMasterCollection: true,
                        isOperationCollection: false,
                        isCriticalMaster,
                        userVisibleSeverity: isCriticalMaster ? 'critical' : 'warning',
                    });
                    throw error;
                }

                const data = await response.json();
                return data.items || [];
            } catch (error) {
                console.error(`❌ ApiSyncAdapter: Error pulling ${collection} from ERP target:`, error);
                reportSyncErrorDiagnostic({
                    operation: 'PULL_MASTERS',
                    collection,
                    endpoint: url.toString(),
                    httpStatus: error instanceof TypeError ? 'network error' : null,
                    error,
                    requestAuth: this.buildRequestAuthDiagnostic(this.buildOperationalHeaders(target, target.token)),
                });
                throw error;
            }
        }

        if (!this.config) {
            throw new Error('Sync configuration missing');
        }

        if (!this.authToken) {
            try {
                await this.authenticate();
            } catch (error) {
                console.warn('Auto-authentication failed during pull:', error);
                throw new Error('Authentication failed. Please check connection to Master.');
            }
        }

        if (!this.isOnline) {
            console.warn(`⚠️  Cannot pull ${collection} while offline`);
            return [];
        }

        try {
            const url = new URL(`${this.config.masterUrl}/api/sync/collections/${collection}/data`);
            if (sinceVersion) {
                url.searchParams.set('sinceVersion', sinceVersion.toString());
            }

            const response = await this.fetchWithRetry(url.toString(), {
                method: 'GET',
                headers: {
                    'X-Sync-Token': this.authToken
                }
            }, 2, 500, 'background', 'PULL_MASTERS');

            if (response.status === 401) {
                // Token expired, re-authenticate
                await this.authenticate();
                return this.pull(collection, sinceVersion);
            }

            if (!response.ok) {
                const responseBody = await response.text().catch(() => '');
                const error = new Error(`Pull failed: ${response.status} ${response.statusText}`);
                reportSyncErrorDiagnostic({
                    operation: 'PULL_MASTERS',
                    collection,
                    endpoint: `${this.config.masterUrl}/api/sync/collections/${collection}/data`,
                    httpStatus: response.status,
                    responseBody,
                    error,
                });
                throw error;
            }

            const data = await response.json();

            const isDebugMode = () => {
                try {
                    return window.location.search.includes('debug=sync') ||
                        localStorage.getItem('CLIC_POS_DEBUG_SYNC') === 'true';
                } catch {
                    return false;
                }
            };

            if (data.upToDate) {
                if (isDebugMode()) {
                    console.log(`✅ ApiSyncAdapter: ${collection} is up to date (v${sinceVersion})`);
                }
                return [];
            }

            console.log(`📥 ApiSyncAdapter: Pulled ${data.items.length} items from ${collection} (v${data.version})`);
            return data.items;

        } catch (error) {
            console.error(`❌ ApiSyncAdapter: Error pulling ${collection}:`, error);
            reportSyncErrorDiagnostic({
                operation: 'PULL_MASTERS',
                collection,
                endpoint: `${this.config.masterUrl}/api/sync/collections/${collection}/data`,
                httpStatus: error instanceof TypeError ? 'network error' : null,
                error,
            });
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Pull incremental changes from Master (Delta Sync)
     */
    private async pullFullFallbackForCriticalMaster(
        collection: string,
        target: {
            baseUrl: string;
            terminalId: string;
            token: string;
            useLocalTarget: boolean;
            kind: ResolvedSyncTarget['kind'];
        },
        headers: Record<string, string>,
        deltaStatus: number
    ): Promise<{ items: any[], serverTime: string, isFullDownload: boolean, latestVersion?: number, syncStatus?: 'SYNCED_WITH_FULL_FALLBACK' }> {
        const fullEndpoint = `${target.baseUrl}/collections/${collection}/full`;
        const fullResponse = await this.fetchWithRetry(fullEndpoint, {
            method: 'GET',
            headers
        }, 2, 500, 'background', 'PULL_MASTERS');

        console.warn('[PULL_DELTA_FALLBACK_TO_FULL]', {
            collection,
            deltaStatus,
            fullStatus: fullResponse.status,
        });

        if (fullResponse.status === 401 || fullResponse.status === 403) {
            const responseBody = await fullResponse.text().catch(() => '');
            let backendCode: string | null = null;
            try {
                backendCode = this.normalizeBackendCode(responseBody ? JSON.parse(responseBody) : null);
            } catch {
                backendCode = null;
            }
            throw this.buildProtectedPullAuthError({
                collection,
                endpoint: fullEndpoint,
                status: fullResponse.status,
                responseBody,
                headers,
                backendCode,
            });
        }

        if (!fullResponse.ok) {
            const responseBody = await fullResponse.text().catch(() => '');
            let payload: any = null;
            try {
                payload = responseBody ? JSON.parse(responseBody) : null;
            } catch {
                payload = null;
            }
            this.throwIfKnownMasterPullFailure({
                operation: 'PULL_MASTERS',
                collection,
                endpoint: fullEndpoint,
                status: fullResponse.status,
                payload,
                responseBody,
                requestHeaders: headers,
            });
            const error = new Error(`ERP no expone endpoint full de maestro crítico: ${collection}`);
            reportSyncErrorDiagnostic({
                operation: 'PULL_MASTERS',
                collection,
                endpoint: fullEndpoint,
                httpStatus: fullResponse.status,
                responseBody,
                error,
                requestAuth: this.buildRequestAuthDiagnostic(headers),
                isMasterCollection: true,
                isOperationCollection: false,
                isCriticalMaster: true,
                userVisibleSeverity: 'critical',
            });
            throw error;
        }

        const fullData = await fullResponse.json();
        const items = Array.isArray(fullData.items)
            ? fullData.items
            : Array.isArray(fullData.data)
                ? fullData.data
                : Array.isArray(fullData.records)
                    ? fullData.records
                    : [];
        const latestVersion = Number(
            fullData.latestVersion
            ?? fullData.version
            ?? fullData.fullSyncVersion
            ?? fullData.metadata?.version
            ?? 0
        );

        return {
            items,
            serverTime: fullData.serverTime || fullData.timestamp || new Date().toISOString(),
            isFullDownload: true,
            latestVersion,
            syncStatus: 'SYNCED_WITH_FULL_FALLBACK',
        };
    }

    async pullDelta(collection: string, sinceVersion?: number): Promise<{ items: any[], serverTime: string, isFullDownload: boolean, latestVersion?: number, syncStatus?: 'SYNCED_WITH_FULL_FALLBACK' }> {
        const operationalTarget = this.resolveOperationalTarget('PULL_MASTERS');
        if (operationalTarget && !operationalTarget.useLocalTarget) {
            if (!isErpMasterPullCollection(collection)) {
                logSkippedNonMasterPull(collection, 'PULL_MASTERS', `${operationalTarget.baseUrl}/delta/${collection}`);
                return {
                    items: [],
                    serverTime: new Date().toISOString(),
                    isFullDownload: false,
                    latestVersion: sinceVersion || 0,
                };
            }
            const target = await this.authenticateOperationalTarget(false, 'background', 'PULL_MASTERS');
            const url = new URL(`${target.baseUrl}/delta/${collection}`);
            if (sinceVersion !== undefined) {
                url.searchParams.set('sinceVersion', sinceVersion.toString());
            }

            try {
                if (!sanitizeSyncToken(target.token)) {
                    console.warn('[PULL_BLOCKED_NO_SYNC_TOKEN]', {
                        collection,
                        operation: 'PULL_MASTERS',
                        syncTokenPresent: false,
                        authStatus: safeLocalStorageGet('clic_sync_auth_status') || 'AUTH_REQUIRED',
                    });
                    const error = new Error(`SYNC_TOKEN_REQUIRED_BEFORE_PULL: Falta autenticación/syncToken para descargar ${collection}.`);
                    reportSyncErrorDiagnostic({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        httpStatus: null,
                        error,
                        authStatus: 'AUTH_REQUIRED',
                        backendCode: 'SYNC_TOKEN_REQUIRED_BEFORE_PULL',
                        blockedByLocalGuard: true,
                        guardReason: 'SYNC_TOKEN_REQUIRED_BEFORE_PULL',
                        requestSkippedReason: 'SYNC_TOKEN_REQUIRED_BEFORE_PULL',
                        requestAuth: {
                            authorizationPresent: false,
                            syncTokenPresent: false,
                            syncTokenPreview: null,
                            terminalIdHeaderPresent: Boolean(target.terminalId),
                            deviceIdHeaderPresent: Boolean(this.resolveCurrentDeviceId()),
                        },
                        isMasterCollection: true,
                        isOperationCollection: false,
                        isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(collection),
                        userVisibleSeverity: 'critical',
                    });
                    throw error;
                }
                const headers = this.buildOperationalHeaders(target, target.token);
                const response = await this.fetchWithRetry(url.toString(), {
                    method: 'GET',
                    headers
                }, 2, 500, 'background', 'PULL_MASTERS');

                if (response.status === 401) {
                    this.erpAuthToken = null;
                    this.clearCanonicalErpSyncToken();
                    const retryTarget = await this.authenticateOperationalTarget(true, 'background', 'PULL_MASTERS');
                    const retryHeaders = this.buildOperationalHeaders(retryTarget, retryTarget.token);
                    const retryResponse = await this.fetchWithRetry(url.toString(), {
                        method: 'GET',
                        headers: retryHeaders
                    }, 2, 500, 'background', 'PULL_MASTERS');
                    if (!retryResponse.ok) {
                        const responseBody = await retryResponse.text().catch(() => '');
                        if (retryResponse.status === 401) {
                            const error = this.buildProtectedPullAuthError({
                                collection,
                                endpoint: url.toString(),
                                status: retryResponse.status,
                                responseBody,
                                headers: retryHeaders,
                                backendCode: 'SYNC_TOKEN_REJECTED',
                            });
                            throw error;
                        }
                        if (retryResponse.status === 403) {
                            throw this.buildProtectedPullAuthError({
                                collection,
                                endpoint: url.toString(),
                                status: retryResponse.status,
                                responseBody,
                                headers: retryHeaders,
                            });
                        }
                        let retryPayload: any = null;
                        try {
                            retryPayload = responseBody ? JSON.parse(responseBody) : null;
                        } catch {
                            retryPayload = null;
                        }
                        this.throwIfKnownMasterPullFailure({
                            operation: 'PULL_MASTERS',
                            collection,
                            endpoint: url.toString(),
                            status: retryResponse.status,
                            payload: retryPayload,
                            responseBody,
                            requestHeaders: retryHeaders,
                        });
                        if (retryResponse.status === 404 && ERP_CRITICAL_MASTER_COLLECTIONS.has(collection)) {
                            return this.pullFullFallbackForCriticalMaster(collection, retryTarget, retryHeaders, retryResponse.status);
                        }
                        throw new Error(`Delta pull failed after re-auth: ${retryResponse.status} ${retryResponse.statusText}`);
                    }
                    return await retryResponse.json();
                }

                if (!response.ok) {
                    if (response.status === 403) {
                        const responseBody = await response.text().catch(() => '');
                        throw this.buildProtectedPullAuthError({
                            collection,
                            endpoint: url.toString(),
                            status: response.status,
                            responseBody,
                            headers,
                        });
                    }
                    if (response.status === 404 && !ERP_CRITICAL_MASTER_COLLECTIONS.has(collection)) {
                        console.warn('[SYNC_COLLECTION_SKIPPED_UNSUPPORTED_COLLECTION]', {
                            collection,
                            operation: 'PULL_MASTERS',
                            endpoint: url.toString(),
                            httpStatus: response.status,
                            userVisibleSeverity: 'warning',
                        });
                        return {
                            items: [],
                            serverTime: new Date().toISOString(),
                            isFullDownload: false,
                            latestVersion: sinceVersion || 0,
                        };
                    }
                    const isCriticalMaster = ERP_CRITICAL_MASTER_COLLECTIONS.has(collection);
                    if (response.status === 404 && isCriticalMaster) {
                        return this.pullFullFallbackForCriticalMaster(collection, target, headers, response.status);
                    }
                    const responseBody = await response.text().catch(() => '');
                    let payload: any = null;
                    try {
                        payload = responseBody ? JSON.parse(responseBody) : null;
                    } catch {
                        payload = null;
                    }
                    this.throwIfKnownMasterPullFailure({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        status: response.status,
                        payload,
                        responseBody,
                        requestHeaders: headers,
                    });
                    const error = new Error(
                        response.status === 404 && isCriticalMaster
                            ? `ERP no expone endpoint de maestro crítico: ${collection}`
                            : `Delta pull failed: ${response.status} ${response.statusText}`
                    );
                    reportSyncErrorDiagnostic({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        httpStatus: response.status,
                        responseBody,
                        error,
                        requestAuth: this.buildRequestAuthDiagnostic(headers),
                        isMasterCollection: true,
                        isOperationCollection: false,
                        isCriticalMaster,
                        userVisibleSeverity: isCriticalMaster ? 'critical' : 'warning',
                    });
                    throw error;
                }

                return await response.json();
            } catch (error) {
                console.error(`❌ ApiSyncAdapter: Error pulling ERP delta for ${collection}:`, error);
                if (!this.wasDiagnosticReported(error)) {
                    reportSyncErrorDiagnostic({
                        operation: 'PULL_MASTERS',
                        collection,
                        endpoint: url.toString(),
                        httpStatus: error instanceof TypeError ? 'network error' : null,
                        error,
                        requestAuth: this.buildRequestAuthDiagnostic(this.buildOperationalHeaders(target, target.token)),
                    });
                }
                throw error;
            }
        }

        if (!this.config) {
            throw new Error('Sync configuration missing');
        }

        if (!this.authToken) {
            await this.authenticate();
        }

        try {
            const url = new URL(`${this.config.masterUrl}/api/sync/delta/${collection}`);
            if (sinceVersion !== undefined) {
                url.searchParams.set('sinceVersion', sinceVersion.toString());
            }

            const response = await this.fetchWithRetry(url.toString(), {
                method: 'GET',
                headers: {
                    'X-Sync-Token': this.authToken || ''
                }
            }, 2, 500, 'background', 'PULL_MASTERS');

            if (response.status === 401) {
                await this.authenticate();
                return this.pullDelta(collection, sinceVersion);
            }

            if (!response.ok) {
                const responseBody = await response.text().catch(() => '');
                const error = new Error(`Delta pull failed: ${response.status} ${response.statusText}`);
                reportSyncErrorDiagnostic({
                    operation: 'PULL_MASTERS',
                    collection,
                    endpoint: url.toString(),
                    httpStatus: response.status,
                    responseBody,
                    error,
                });
                throw error;
            }

            return await response.json();
        } catch (error) {
            console.error(`❌ ApiSyncAdapter: Error pulling delta for ${collection}:`, error);
            reportSyncErrorDiagnostic({
                operation: 'PULL_MASTERS',
                collection,
                endpoint: `${this.config.masterUrl}/api/sync/delta/${collection}`,
                httpStatus: error instanceof TypeError ? 'network error' : null,
                error,
            });
            throw error;
        }
    }

    /**
     * Pull image manifest for products (lightweight channel).
     */
    async pullProductImageManifest(
        sinceVersion?: number,
        ids?: string[]
    ): Promise<{ items: ProductImageManifestItem[]; version: number; upToDate: boolean; serverTime?: string }> {
        if (!this.config) {
            throw new Error('Sync configuration missing');
        }

        await this.ensureAuthenticated();

        if (!this.isOnline) {
            return { items: [], version: sinceVersion || 0, upToDate: false };
        }

        try {
            const url = new URL(`${this.config.masterUrl}/api/sync/products/images/manifest`);
            if (sinceVersion !== undefined) {
                url.searchParams.set('sinceVersion', sinceVersion.toString());
            }
            if (ids && ids.length > 0) {
                url.searchParams.set('ids', ids.join(','));
            }

            const response = await this.fetchWithRetry(url.toString(), {
                method: 'GET',
                headers: {
                    'X-Sync-Token': this.authToken || ''
                }
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.pullProductImageManifest(sinceVersion, ids);
            }

            if (!response.ok) {
                throw new Error(`Pull product image manifest failed: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                items: Array.isArray(data.items) ? data.items : [],
                version: typeof data.version === 'number' ? data.version : 0,
                upToDate: !!data.upToDate,
                serverTime: data.serverTime
            };
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling product image manifest:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Pull image payload for specific products.
     */
    async pullProductImages(ids: string[]): Promise<ProductImagePayloadItem[]> {
        if (!this.config) {
            throw new Error('Sync configuration missing');
        }

        if (!ids || ids.length === 0) return [];

        await this.ensureAuthenticated();

        if (!this.isOnline) return [];

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/products/images/pull`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({ ids })
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.pullProductImages(ids);
            }

            if (!response.ok) {
                throw new Error(`Pull product images failed: ${response.statusText}`);
            }

            const data = await response.json();
            return Array.isArray(data.items) ? data.items : [];
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling product images:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Get metadata for a collection
     */
    async getMetadata(collection: string): Promise<SyncMetadata | null> {
        const operation: OperationalSyncOperation = collection === 'config' ? 'PULL_CONFIG' : 'PULL_MASTERS';
        const operationalTarget = this.resolveOperationalTarget(operation);
        if (operationalTarget && !operationalTarget.useLocalTarget) {
            if (operation === 'PULL_MASTERS' && !isErpMasterPullCollection(collection)) {
                logSkippedNonMasterPull(collection, operation, `${operationalTarget.baseUrl}/collections/${collection}/metadata`);
                return null;
            }
            const target = await this.authenticateOperationalTarget(false, 'background', operation);
            const endpoint = `${target.baseUrl}/collections/${collection}/metadata`;
            try {
                const headers = this.buildOperationalHeaders(target, target.token);
                const response = await this.fetchWithRetry(endpoint, {
                    method: 'GET',
                    headers
                }, 2, 500, 'background', operation);

                if (response.status === 401) {
                    this.erpAuthToken = null;
                    this.clearCanonicalErpSyncToken();
                    const retryTarget = await this.authenticateOperationalTarget(true, 'background', operation);
                    const retryHeaders = this.buildOperationalHeaders(retryTarget, retryTarget.token);
                    const retryResponse = await this.fetchWithRetry(endpoint, {
                        method: 'GET',
                        headers: retryHeaders
                    }, 2, 500, 'background', operation);
                    if (!retryResponse.ok) {
                        const responseBody = await retryResponse.text().catch(() => '');
                        if (retryResponse.status === 401) {
                            const error = this.buildSyncTokenError('SYNC_TOKEN_REJECTED');
                            reportSyncErrorDiagnostic({
                                operation,
                                collection,
                                endpoint,
                                httpStatus: retryResponse.status,
                                responseBody,
                                error,
                                requestAuth: this.buildRequestAuthDiagnostic(retryHeaders),
                                isMasterCollection: operation === 'PULL_CONFIG' || isErpMasterPullCollection(collection),
                                isOperationCollection: isErpOperationPushCollection(collection),
                                isCriticalMaster: ERP_CRITICAL_MASTER_COLLECTIONS.has(collection),
                                userVisibleSeverity: 'critical',
                            });
                        }
                        return null;
                    }
                    const retryData = await retryResponse.json();
                    const retryMetadata = retryData.metadata || retryData;
                    return {
                        collection,
                        lastSyncedAt: retryMetadata.lastUpdated || retryMetadata.lastSyncedAt || new Date().toISOString(),
                        version: Number(retryMetadata.version || 0),
                        itemCount: Number(retryMetadata.itemCount || retryMetadata.count || 0),
                        fullSyncVersion: retryMetadata.fullSyncVersion
                    };
                }

                if (!response.ok) {
                    if (response.status === 404 && !ERP_CRITICAL_MASTER_COLLECTIONS.has(collection)) {
                        console.warn('[SYNC_COLLECTION_SKIPPED_UNSUPPORTED_COLLECTION]', {
                            collection,
                            operation,
                            endpoint,
                            httpStatus: response.status,
                            userVisibleSeverity: 'warning',
                        });
                        return null;
                    }
                    const responseBody = await response.text().catch(() => '');
                    const isCriticalMaster = ERP_CRITICAL_MASTER_COLLECTIONS.has(collection);
                    let payload: any = null;
                    try {
                        payload = responseBody ? JSON.parse(responseBody) : null;
                    } catch {
                        payload = null;
                    }
                    this.throwIfKnownMasterPullFailure({
                        operation,
                        collection,
                        endpoint,
                        status: response.status,
                        payload,
                        responseBody,
                        requestHeaders: headers,
                    });
                    const error = new Error(
                        response.status === 404 && isCriticalMaster
                            ? `ERP no expone endpoint de maestro crítico: ${collection}`
                            : `Get metadata failed: ${response.status} ${response.statusText}`
                    );
                    reportSyncErrorDiagnostic({
                        operation,
                        collection,
                        endpoint,
                        httpStatus: response.status,
                        responseBody,
                        error,
                        requestAuth: this.buildRequestAuthDiagnostic(headers),
                        isMasterCollection: operation === 'PULL_CONFIG' || isErpMasterPullCollection(collection),
                        isOperationCollection: isErpOperationPushCollection(collection),
                        isCriticalMaster,
                        userVisibleSeverity: isCriticalMaster ? 'critical' : 'warning',
                    });
                    return null;
                }

                const data = await response.json();
                const metadata = data.metadata || data;
                return {
                    collection,
                    lastSyncedAt: metadata.lastUpdated || metadata.lastSyncedAt || new Date().toISOString(),
                    version: Number(metadata.version || 0),
                    itemCount: Number(metadata.itemCount || metadata.count || 0),
                    fullSyncVersion: metadata.fullSyncVersion
                };
            } catch (error) {
                console.error(`❌ ApiSyncAdapter: Error getting ERP metadata for ${collection}:`, error);
                if (!this.wasDiagnosticReported(error)) {
                    reportSyncErrorDiagnostic({
                        operation,
                        collection,
                        endpoint,
                        httpStatus: error instanceof TypeError ? 'network error' : null,
                        error,
                        requestAuth: this.buildRequestAuthDiagnostic(this.buildOperationalHeaders(target, target.token)),
                    });
                }
                return null;
            }
        }

        if (!this.config) {
            return null;
        }

        if (!this.authToken) {
            try {
                await this.authenticate();
            } catch (error) {
                return null; // Return null if cannot authenticate to avoid UI noise
            }
        }

        if (!this.isOnline) {
            return null;
        }

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/collections/${collection}/metadata`, {
                method: 'GET',
                headers: {
                    'X-Sync-Token': this.authToken
                }
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.getMetadata(collection);
            }

            if (!response.ok) {
                const responseBody = await response.text().catch(() => '');
                const error = new Error(`Get metadata failed: ${response.status} ${response.statusText}`);
                reportSyncErrorDiagnostic({
                    operation: collection === 'config' ? 'PULL_CONFIG' : 'PULL_MASTERS',
                    collection,
                    endpoint: `${this.config.masterUrl}/api/sync/collections/${collection}/metadata`,
                    httpStatus: response.status,
                    responseBody,
                    error,
                });
                throw error;
            }

            const data = await response.json();
            return {
                collection,
                lastSyncedAt: data.metadata.lastUpdated,
                version: data.metadata.version,
                itemCount: data.metadata.itemCount,
                fullSyncVersion: data.metadata.fullSyncVersion
            };

        } catch (error) {
            console.error(`❌ ApiSyncAdapter: Error getting metadata for ${collection}:`, error);
            reportSyncErrorDiagnostic({
                operation: collection === 'config' ? 'PULL_CONFIG' : 'PULL_MASTERS',
                collection,
                endpoint: `${this.config.masterUrl}/api/sync/collections/${collection}/metadata`,
                httpStatus: error instanceof TypeError ? 'network error' : null,
                error,
            });
            this.isOnline = false;
            return null;
        }
    }

    /**
     * Check if new data is available
     */
    async hasNewData(collection: string, localVersion: number): Promise<boolean> {
        const metadata = await this.getMetadata(collection);
        if (!metadata) return false;

        return metadata.version > localVersion;
    }

    /**
     * Get list of connected terminals (Master only)
     */
    async getConnectedTerminals(): Promise<any[]> {
        if (!this.config) return [];

        if (!this.authToken) {
            try {
                await this.authenticate();
            } catch (error) {
                return [];
            }
        }

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/terminals`, {
                headers: { 'X-Sync-Token': this.authToken }
            });

            if (response.status === 401) {
                console.warn('⚠️ ApiSyncAdapter: Token expired fetching terminals, re-authenticating...');
                await this.authenticate();
                // Retry once
                const retryResponse = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/terminals`, {
                    headers: { 'X-Sync-Token': this.authToken || '' }
                });
                if (!retryResponse.ok) return [];
                const data = await retryResponse.json();
                return data.terminals || [];
            }

            if (!response.ok) return [];

            const data = await response.json();
            return data.terminals || [];
        } catch (error) {
            console.error('Error fetching terminals:', error);
            return [];
        }
    }

    /**
     * Get connection status
     */
    getConnectionStatus(): { isOnline: boolean; isAuthenticated: boolean; masterUrl: string | null } {
        return {
            isOnline: this.isOnline,
            isAuthenticated: !!this.authToken,
            masterUrl: this.config?.masterUrl || null
        };
    }

    /**
     * Push a single transaction to Master
     */
    private resolveClientErpBaseUrlForInbox(): string | undefined {
        if (typeof window === 'undefined') return undefined;
        try {
            const a = localStorage.getItem('CLIC_ERP_BASE_URL')?.trim();
            const b = localStorage.getItem('erp_base_url')?.trim();
            const vite =
                typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ERP_BASE_URL
                    ? String((import.meta as any).env.VITE_ERP_BASE_URL).trim()
                    : '';
            return a || b || vite || undefined;
        } catch {
            return undefined;
        }
    }

    private maskSyncToken(token: string | null): string {
        if (!token) return 'none';
        if (token.length <= 10) return '(short)';
        return `${token.slice(0, 4)}…${token.slice(-4)}`;
    }

    private logCriticalSalesRequest(input: {
        authUrl: string;
        postUrl: string;
        terminalId: string;
        retryCount: number;
        token: string | null;
        txId?: string;
    }) {
        console.log(
            `[SYNC_SALES_HTTP] authUrl=${input.authUrl} postUrl=${input.postUrl} terminalId=${input.terminalId} retryCount=${input.retryCount} token=${this.maskSyncToken(input.token)} tx=${input.txId || 'n/a'}`
        );
    }

    private async postErpSalesTransactionWithSmartAuth(
        normalizedTransaction: any,
        txId: string
    ): Promise<{
        target: { baseUrl: string; terminalId: string; token: string; useLocalTarget: boolean; kind: ResolvedSyncTarget['kind'] };
        response: Response;
        text: string;
    }> {
        let target = await this.authenticateOperationalTarget(false, 'sales', 'PUSH_OPERATIONS');
        const postUrl = `${target.baseUrl}/transactions`;
        const authUrl = `${target.baseUrl}/auth`;

        for (let retryCount = 0; retryCount <= 1; retryCount += 1) {
            const requestBody = this.buildOperationalPostBody(target, { items: [normalizedTransaction] });
            this.logCriticalSalesRequest({
                authUrl,
                postUrl,
                terminalId: target.terminalId,
                retryCount,
                token: target.token,
                txId
            });
            const response = await this.fetchWithRetry(postUrl, {
                method: 'POST',
                headers: this.buildOperationalHeaders(target, target.token, true),
                body: JSON.stringify(requestBody)
            }, 2, 500, 'sales', 'PUSH_OPERATIONS');
            const text = await response.text();

            if (response.status !== 401 || retryCount === 1) {
                return { target, response, text };
            }

            console.warn(`[SYNC_SALES_HTTP] 401 for tx=${txId}; refreshing ERP sync token and replaying request immediately.`);
            this.erpAuthToken = null;
            target = await this.authenticateOperationalTarget(true, 'sales', 'PUSH_OPERATIONS');
        }

        throw new Error('ERP transaction sync failed: request was not attempted');
    }

    private async postLocalSalesTransactionWithSmartAuth(
        normalizedTransaction: any,
        txId: string,
        itemsCount: number | string,
        skipErpForward = false
    ): Promise<Response> {
        await this.ensurePushReady('sales');
        const erpBaseUrl = this.resolveClientErpBaseUrlForInbox();
        const postUrl = `${this.config!.masterUrl}/api/sync/transactions`;
        const authUrl = `${this.config!.masterUrl}/api/sync/auth`;

        for (let retryCount = 0; retryCount <= 1; retryCount += 1) {
            if (!this.authToken || retryCount > 0) {
                this.authToken = null;
                await this.authenticate(true, 'sales');
            }

            this.logCriticalSalesRequest({
                authUrl,
                postUrl,
                terminalId: this.config!.terminalId,
                retryCount,
                token: this.authToken,
                txId
            });
            console.log(
                `[SYNC_TX_PUSH] POST ${postUrl} tx=${txId} source_tx=${normalizedTransaction.source_transaction_id} source_terminal=${normalizedTransaction.source_terminal_id || normalizedTransaction.terminalId} items=${itemsCount} erp_base_url=${erpBaseUrl ? 'sent' : 'MISSING'}`
            );
            const response = await this.fetchWithRetry(postUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({
                    items: [normalizedTransaction],
                    ...(erpBaseUrl ? { erp_base_url: erpBaseUrl } : {}),
                    ...(skipErpForward ? { skip_erp_forward: true } : {})
                })
            }, 2, 500, 'sales');

            if (response.status !== 401 || retryCount === 1) {
                return response;
            }

            console.warn(`[SYNC_SALES_HTTP] 401 for local sales tx=${txId}; refreshing sync token and replaying request immediately.`);
        }

        throw new Error('ERP transaction sync failed: request was not attempted');
    }

    private shouldSkipErpSaleSync(transaction: any): boolean {
        return Boolean(
            transaction?.skipErpSaleSync
            || transaction?.marketplaceSourceChannel === 'UBER_EATS'
        );
    }

    async pushTransaction(transaction: any): Promise<void> {
        try {
            const normalizedTransaction = buildErpSalePayload(transaction);
            const operationalTarget = this.resolveOperationalTarget();
            const txId = String(normalizedTransaction.source_transaction_id || normalizedTransaction.id || transaction?.id || 'unknown');
            const itemsCount = Array.isArray((normalizedTransaction as any).items)
                ? (normalizedTransaction as any).items.length
                : typeof (normalizedTransaction as any).items === 'string'
                  ? `string(len=${String((normalizedTransaction as any).items).length})`
                  : 'none';
            const skipErpSaleSync = this.shouldSkipErpSaleSync(normalizedTransaction);

            if (operationalTarget && !operationalTarget.useLocalTarget) {
                if (skipErpSaleSync) {
                    console.log(`[SYNC_TX_PUSH] ERP direct skipped for tx=${txId} marketplace=${normalizedTransaction.marketplaceSourceChannel || 'n/a'}`);
                    return;
                }
                console.log(
                    `[SYNC_TX_PUSH] ERP direct start base=${operationalTarget.baseUrl} terminal=${operationalTarget.terminalId} tx=${txId} items=${itemsCount}`
                );
                const { target, response, text } = await this.postErpSalesTransactionWithSmartAuth(normalizedTransaction, txId);
                const syncBody = this.safeParseSyncJson(text);
                const responseAudit = syncBody || { raw: text };
                const isCloudStaging = target.kind === 'POS_CLOUD_STAGING';

                if (!response.ok) {
                    if (this.isIdempotentAppliedResponse(syncBody, text, false)) {
                        this.attachTransactionSyncAudit(transaction, responseAudit, 'SKIPPED_ALREADY_APPLIED');
                        console.warn(
                            `[SYNC_TX_PUSH] ERP direct idempotent OK tx=${txId} status=${response.status} body=${text.slice(0, 400)}`
	                    );
	                    return;
	                }
                    if (isCloudStaging && response.status >= 200 && response.status < 300) {
                        this.attachTransactionSyncAudit(transaction, responseAudit, 'STAGED');
                        console.warn(`[SYNC_TX_PUSH] Cloud staging accepted tx=${txId} with non-standard response body=${text.slice(0, 400)}`);
                        return;
                    }
	                    throw new Error(
	                        `ERP transaction sync failed: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 400)}` : ''}`
	                    );
	                }

                if (isCloudStaging) {
                    this.attachTransactionSyncAudit(transaction, responseAudit, 'STAGED');
                    console.log(
                        `[SYNC_TX_PUSH] Cloud staging OK tx=${txId} host=${target.baseUrl} terminal=${target.terminalId} body=${text.slice(0, 400)}`
                    );
                    return;
                }
	
	                if (syncBody && typeof syncBody.applyFailedCount === 'number' && syncBody.applyFailedCount > 0) {
                    if (this.allApplyIssuesAreIdempotent(syncBody.applyIssues || syncBody.results || syncBody)) {
                        this.attachTransactionSyncAudit(transaction, syncBody, 'SKIPPED_ALREADY_APPLIED');
                        console.warn(
                            `[SYNC_TX_PUSH] ERP direct idempotent apply failure accepted tx=${txId}`,
                            syncBody.applyIssues
                        );
                        return;
                    }
                    console.error(
                        `[SYNC_TX_PUSH] ERP /api/sync/transactions applyFailedCount=${syncBody.applyFailedCount}`,
                        syncBody.applyIssues
                    );
                    throw new Error(`ERP did not persist sale (apply failures): ${JSON.stringify(syncBody.applyIssues || [])}`);
                }
                if (this.hasRealApplyErrorResponse(syncBody, text)) {
                    throw new Error(`ERP did not persist sale (apply error): ${text.slice(0, 400)}`);
                }

                this.attachTransactionSyncAudit(transaction, responseAudit, 'APPLIED');

                console.log(
                    `[SYNC_TX_PUSH] ERP direct OK tx=${txId} host=${target.baseUrl} terminal=${target.terminalId} body=${text.slice(0, 400)}`
                );
                return;
            }

            console.log(
                `[SYNC_TX_PUSH] pre-auth masterUrl=${this.config?.masterUrl || 'n/a'} terminalId=${this.config?.terminalId || 'n/a'} hasToken=${!!this.authToken}`
            );
            const response = await this.postLocalSalesTransactionWithSmartAuth(
                normalizedTransaction,
                txId,
                itemsCount,
                skipErpSaleSync
            );

            if (!response.ok) {
                const errorText = await response.text();
                let errBody: any = null;
                let detail = errorText.slice(0, 400);
                try {
                    errBody = errorText ? JSON.parse(errorText) : null;
                    detail =
                        errBody?.message ||
                        errBody?.error ||
                        errBody?.detail ||
                        (errBody?.erpInbox ? JSON.stringify(errBody.erpInbox) : detail);
                } catch {
                    // plain-text body
                }

                const candidateTexts = [
                    errorText,
                    errBody?.message,
                    errBody?.error,
                    errBody?.detail,
                    errBody?.erpInbox?.message,
                    errBody?.erpInbox?.error
                ]
                    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                    .map((value) => value.toLowerCase());

                const masterAcceptedLocally =
                    response.status === 502 &&
                    ((typeof errBody?.savedLocally === 'boolean' && errBody.savedLocally) ||
                        (typeof errBody?.persistedLocally === 'boolean' && errBody.persistedLocally) ||
                        candidateTexts.some((value) =>
                            value.includes('local master saved the sale') ||
                            value.includes('saved the sale locally') ||
                            value.includes('saved locally') ||
                            value.includes('persisted locally') ||
                            value.includes('forward to erp failed')
                        ));

                if (masterAcceptedLocally) {
                    console.warn(
                        `[SYNC_TX_PUSH] Master persisted tx=${txId} locally but ERP forwarding failed. Accepting slave sync and leaving ERP retry to master. body=${detail}`
                    );
                    this.attachTransactionSyncAudit(transaction, errBody || { raw: errorText }, 'APPLIED');
                    return;
                }

                if (this.isIdempotentAppliedResponse(errBody, errorText, false)) {
                    console.warn(
                        `[SYNC_TX_PUSH] Master/ERP returned duplicate already-applied for tx=${txId}. Marking local sync completed. body=${detail}`
                    );
                    this.attachTransactionSyncAudit(transaction, errBody || { raw: errorText }, 'SKIPPED_ALREADY_APPLIED');
                    return;
                }

                throw new Error(
                    `Push transaction failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`
                );
            }

            let syncBody: any = null;
            try {
                syncBody = await response.json();
            } catch {
                // non-JSON response
            }
            const erp = syncBody?.erpInbox;
            const r0 = Array.isArray(erp?.results) ? erp.results[0] : null;
            console.log(
                `[SYNC_TX_PUSH] master_response applyFailedCount=${syncBody?.applyFailedCount ?? 'n/a'} erpInbox_skipped=${erp?.skipped ?? 'n/a'} erpInbox_failed=${erp?.failed ?? 'n/a'} sync_id=${r0?.syncId ?? 'n/a'} erp_document_id=${r0?.erpDocumentId ?? 'n/a'} apply_err=${r0?.error ?? 'n/a'}`
            );
            if (syncBody && typeof syncBody.applyFailedCount === 'number' && syncBody.applyFailedCount > 0) {
                if (this.allApplyIssuesAreIdempotent(syncBody.applyIssues || erp?.results || syncBody)) {
                    console.warn(
                        `[SYNC_TX_PUSH] Master response contained idempotent apply failures for tx=${txId}. Marking completed.`,
                        syncBody.applyIssues
                    );
                    this.attachTransactionSyncAudit(transaction, syncBody, 'SKIPPED_ALREADY_APPLIED');
                    return;
                }
                console.error(
                    `[SYNC_TX_PUSH] ERP /api/sync/transactions applyFailedCount=${syncBody.applyFailedCount}`,
                    syncBody.applyIssues
                );
                throw new Error(`ERP did not persist sale (apply failures): ${JSON.stringify(syncBody.applyIssues || [])}`);
            }
            if (erp?.failed && !this.isIdempotentAppliedResponse(erp, JSON.stringify(erp), true)) {
                throw new Error(`ERP did not persist sale (apply error): ${JSON.stringify(erp).slice(0, 400)}`);
            }
            if (this.hasRealApplyErrorResponse(syncBody, JSON.stringify(syncBody))) {
                throw new Error(`ERP did not persist sale (apply error): ${JSON.stringify(syncBody).slice(0, 400)}`);
            }
            this.attachTransactionSyncAudit(transaction, syncBody, 'APPLIED');
            if (erp?.skipped) {
                console.warn(
                    `[SYNC_TX_PUSH] Master OK but ERP inbox skipped (${erp.reason || 'NO_ERP_URL'}). Configure CLIC_ERP_BASE_URL / erp_base_url localStorage or ERP_BASE_URL on Master. tx=${txId}`
                );
            } else if (erp?.failed) {
                console.error(`[SYNC_TX_PUSH] Unexpected erpInbox.failed in 200 response tx=${txId}`);
            } else {
                const types = Array.isArray(erp?.results) ? erp.results.map((r: any) => r.eventType).join(', ') : 'SALE_POSTED';
                const docIds = Array.isArray(erp?.results)
                    ? erp.results.map((r: any) => r.erpDocumentId).filter(Boolean).join(', ')
                    : '';
                console.log(
                    `[SYNC_TX_PUSH] ERP inbox OK [${types}] tx=${txId} host=${erp?.erpBaseUrlUsed || 'n/a'} erp_document_id=${docIds || 'n/a'}`
                );
            }
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing transaction:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Push a single inventory movement to Master
     */
    async pushInventoryMovement(movement: any): Promise<void> {
        try {
            const payload = buildErpInventoryLedgerPayload(movement);
            await this.postOperationalPayload('/inventory/movements', { items: [payload] });
            console.log(`📤 ApiSyncAdapter: Pushed inventory movement ${payload.source_inventory_movement_id || payload.id}`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing inventory movement:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Push a single inventory count session to Master
     */
    async pushInventoryCount(countSession: any): Promise<void> {
        try {
            await this.ensurePushReady();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/inventory/counts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({ items: [countSession] })
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.pushInventoryCount(countSession);
            }

            if (!response.ok) {
                throw new Error(`Push inventory count failed: ${response.statusText}`);
            }
            console.log(`📤 ApiSyncAdapter: Pushed inventory count ${countSession.id}`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing inventory count:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Push a single cash movement to Master
     */
    async pushCashMovement(movement: any): Promise<void> {
        try {
            const normalizedMovement = buildErpCashMovementPayload(movement);
            await this.postOperationalPayload('/cash/movements', { items: [normalizedMovement] });
            console.log(`📤 ApiSyncAdapter: Pushed cash movement ${normalizedMovement.source_cash_movement_id || normalizedMovement.id}`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing cash movement:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Push a single Z-Report to Master
     */
    async pushZReport(report: any): Promise<void> {
        try {
            const normalizedReport = buildErpZReportPayload(report);
            await this.postOperationalPayload('/z-reports', { items: [normalizedReport] });
            console.log(`📤 ApiSyncAdapter: Pushed Z-Report ${normalizedReport.source_z_report_id || normalizedReport.id}`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing Z-Report:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Push wallet / loyalty operational events (normalized, idempotent by source_event_id on Master).
     */
    async pushOperationalEvents(items: Record<string, unknown>[]): Promise<void> {
        if (!items.length) return;
        try {
            const normalized = items.map((row) => {
                const channel = String((row as any).operationalChannel || '').toUpperCase();
                if (channel === 'LOYALTY') {
                    return buildErpLoyaltyEventPayload(row);
                }
                return buildErpWalletEventPayload(row);
            });
            await this.postOperationalPayload('/operational/events', { items: normalized });
            console.log(`📤 ApiSyncAdapter: Pushed ${normalized.length} operational event(s)`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pushing operational events:', error);
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Pull pending transactions (Master only)
     */
    async pullPendingTransactions(): Promise<any[]> {
        if (!this.config || !this.isOnline) return [];

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/transactions/pending`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

            if (!response.ok) {
                throw new Error(`Pull pending transactions failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.items || [];
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling pending transactions:', error);
            return [];
        }
    }

    /**
     * Acknowledge pending transactions (Master only)
     */
    async ackPendingTransactions(ids: string[]): Promise<void> {
        if (!this.config || !this.isOnline) return;
        if (!ids || ids.length === 0) return;

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/transactions/pending/ack`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({ ids })
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.ackPendingTransactions(ids);
            }
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error acknowledging pending transactions:', error);
        }
    }

    /**
     * Pull pending inventory movements (Master only)
     */
    async pullPendingInventoryMovements(): Promise<any[]> {
        if (!this.config || !this.isOnline) return [];

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/inventory/movements/pending`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

            if (!response.ok) {
                throw new Error(`Pull pending inventory movements failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.items || [];
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling pending inventory movements:', error);
            return [];
        }
    }

    /**
     * Acknowledge pending inventory movements (Master only)
     */
    async ackPendingInventoryMovements(ids: string[]): Promise<void> {
        if (!this.config || !this.isOnline) return;
        if (!ids || ids.length === 0) return;

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/inventory/movements/pending/ack`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({ ids })
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.ackPendingInventoryMovements(ids);
            }
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error acknowledging pending inventory movements:', error);
        }
    }

    /**
     * Report a sync error to Master
     */
    async reportError(error: string, itemType: string, itemId: string): Promise<void> {
        if (!this.config || !this.isOnline) return;

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/errors`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({
                    error,
                    itemType,
                    itemId,
                    terminalId: this.config.terminalId,
                    timestamp: new Date().toISOString()
                })
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.reportError(error, itemType, itemId);
            }
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error reporting sync error:', error);
        }
    }

    /**
     * Pull all historical data for a terminal (new device inheritance)
     */
    async pullHistory(terminalId: string): Promise<any> {
        if (!this.config || !this.isOnline) return null;

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/history/${terminalId}`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

            if (!response.ok) {
                throw new Error(`Pull history failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.data;
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling history:', error);
            return null;
        }
    }

    /**
     * Get operational status (Master only)
     */
    async getOperationalStatus(): Promise<any> {
        if (!this.config) return null;

        if (!this.authToken) {
            try {
                await this.authenticate();
            } catch (error) {
                return null;
            }
        }

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/operational-status`, {
                headers: { 'X-Sync-Token': this.authToken }
            });

            if (response.status === 401) {
                console.warn('⚠️ ApiSyncAdapter: Token expired fetching operational status, re-authenticating...');
                await this.authenticate();
                // Retry once
                const retryResponse = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/operational-status`, {
                    headers: { 'X-Sync-Token': this.authToken || '' }
                });
                if (!retryResponse.ok) return null;
                const data = await retryResponse.json();
                return data;
            }

            if (!response.ok) return null;

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error fetching operational status:', error);
            return null;
        }
    }

    async retryErpForwardQueue(ids?: string[]): Promise<any> {
        if (!this.config) return null;

        if (!this.authToken) {
            await this.authenticate();
        }

        const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/erp-forward/retry`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Sync-Token': this.authToken || ''
            },
            body: JSON.stringify({ ids: Array.isArray(ids) ? ids : undefined })
        });

        if (response.status === 401) {
            await this.authenticate(true);
            const retryResponse = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/erp-forward/retry`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({ ids: Array.isArray(ids) ? ids : undefined })
            });
            if (!retryResponse.ok) {
                throw new Error(`ERP forward retry failed: ${retryResponse.status} ${retryResponse.statusText}`);
            }
            return retryResponse.json();
        }

        if (!response.ok) {
            throw new Error(`ERP forward retry failed: ${response.status} ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Pull global configuration from Master
     */
    async pullConfig(): Promise<any> {
        const operationalTarget = this.resolveOperationalTarget('PULL_CONFIG');
        if (operationalTarget && !operationalTarget.useLocalTarget) {
            const data = await this.getOperationalPayload<{ config?: any }>('/config', 'PULL_CONFIG');
            return data?.config || data || null;
        }

        if (!this.config) return null;
        if (!this.authToken) await this.authenticate();

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/config`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            }, 2, 500, 'background', 'PULL_CONFIG');

            if (response.status === 401) {
                await this.authenticate();
                return this.pullConfig();
            }

            if (!response.ok) throw new Error(`Pull config failed: ${response.statusText}`);

            const data = await response.json();
            return data.config;
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling config:', error);
            throw error;
        }
    }

    /**
     * Pull lightweight stock balances for all products (used by Slaves)
     */
    async pullStockBalances(): Promise<any[]> {
        if (!this.config || !this.isOnline) return [];

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/inventory/stock-balances`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

            if (!response.ok) {
                throw new Error(`Pull stock balances failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.balances || [];
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling stock balances:', error);
            return [];
        }
    }

    async pullOperationalStockBalances(productId?: string): Promise<any[]> {
        try {
            if (!this.isUsingErpOperationalTarget()) {
                const query = productId ? `?product_id=${encodeURIComponent(productId)}` : '';
                const data = await this.getOperationalPayload<{ balances?: any[] }>(`/inventory/stock-balances${query}`);
                return Array.isArray(data?.balances) ? data.balances : [];
            }

            const context = this.resolveOperationalInventoryContext();
            if (!context.terminalId || !context.syncApiBase) {
                console.warn('⚠️ ApiSyncAdapter: Missing ERP terminal inventory context for operational balances');
                return [];
            }

            const params = new URLSearchParams();
            if (context.tenantId) params.set('tenant_id', context.tenantId);
            if (context.erpBaseUrl) params.set('erp_base_url', context.erpBaseUrl);
            if (context.posDeviceId) params.set('pos_device_id', context.posDeviceId);
            if (context.localTerminalId) params.set('local_terminal_id', context.localTerminalId);

            const endpoint = `${context.syncApiBase}/terminals/${encodeURIComponent(context.terminalId)}/inventory?${params.toString()}`;
            const response = await this.fetchWithoutCircuitBreaker(endpoint, {
                headers: {
                    Accept: 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Operational inventory block failed: ${response.status} ${response.statusText}`);
            }

            const payload = (await response.json()) as TerminalInventoryPayload;
            const normalizedPayload = this.normalizeTerminalInventoryPayload(payload);
            return normalizedPayload.balances.filter((balance) => this.matchesInventoryBalanceProduct(balance, productId));
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling operational stock balances:', error);
            return [];
        }
    }

    async pullOperationalStockBalanceMap(productId?: string): Promise<Record<string, number>> {
        const cacheKey = this.buildOperationalStockBalanceCacheKey(productId);
        const previous = this.lastOperationalStockBalanceMaps.get(cacheKey) || {};

        try {
            if (!this.isUsingErpOperationalTarget()) {
                const balances = await this.pullOperationalStockBalances(productId);
                const nextMap = this.buildOperationalStockBalanceMap(balances);
                if (Object.keys(nextMap).length > 0) {
                    this.lastOperationalStockBalanceMaps.set(cacheKey, nextMap);
                    return nextMap;
                }
                return previous;
            }

            const context = this.resolveOperationalInventoryContext();
            if (!context.terminalId || !context.syncApiBase) {
                console.error('❌ ApiSyncAdapter: Missing ERP inventory context', context);
                return previous;
            }

            const params = new URLSearchParams();
            if (context.tenantId) params.set('tenant_id', context.tenantId);
            if (context.erpBaseUrl) params.set('erp_base_url', context.erpBaseUrl);
            if (context.posDeviceId) params.set('pos_device_id', context.posDeviceId);
            if (context.localTerminalId) params.set('local_terminal_id', context.localTerminalId);

            const endpoint = `${context.syncApiBase}/terminals/${encodeURIComponent(context.terminalId)}/inventory?${params.toString()}`;
            const response = await this.fetchWithoutCircuitBreaker(endpoint, {
                headers: {
                    Accept: 'application/json',
                },
            });

            if (!response.ok) {
                const detail = await response.text().catch(() => '');
                console.error('❌ ApiSyncAdapter: ERP inventory request failed', {
                    endpoint,
                    status: response.status,
                    statusText: response.statusText,
                    detail,
                });
                return previous;
            }

            const payload = await response.json();
            const normalizedPayload = this.normalizeTerminalInventoryPayload(payload);
            const filteredBalances = normalizedPayload.balances.filter((balance: any) => this.matchesInventoryBalanceProduct(balance, productId));
            const nextMap = this.buildOperationalStockBalanceMap(filteredBalances);

            if (Object.keys(nextMap).length > 0) {
                this.lastOperationalStockBalanceMaps.set(cacheKey, nextMap);
                return nextMap;
            }

            console.error('❌ ApiSyncAdapter: ERP inventory payload parsed without balances', {
                endpoint,
                productId,
                payload,
            });
            return previous;
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling operational stock balance map:', {
                productId,
                error,
                previous,
            });
            return previous;
        }
    }

    /**
     * Pull Kardex for a specific product on-demand
     */
    async pullKardexOnDemand(productId: string): Promise<any[]> {
        try {
            if (this.isUsingErpOperationalTarget()) {
                const data = await this.getOperationalPayload<{ items?: any[] }>(`/inventory/kardex/${encodeURIComponent(productId)}`);
                return data.items || [];
            }

            if (!this.config || !this.isOnline) return [];

            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/inventory/kardex/${productId}`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

            if (!response.ok) {
                throw new Error(`Pull Kardex failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.items || [];
        } catch (error) {
            console.error(`❌ ApiSyncAdapter: Error pulling Kardex for ${productId}:`, error);
            return [];
        }
    }

    /**
     * Reset all operational data for a specific terminal on the Master server
     */
    async resetTerminalData(terminalId: string): Promise<void> {
        if (!this.config || !this.isOnline) return;

        if (!this.authToken) {
            await this.authenticate();
        }

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/reset/${terminalId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                }
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.resetTerminalData(terminalId);
            }

            if (!response.ok) {
                throw new Error(`Reset terminal data failed: ${response.statusText}`);
            }

            console.log(`✅ ApiSyncAdapter: Reset terminal data for ${terminalId} on Master`);
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error resetting terminal data:', error);
            throw error;
        }
    }

    /**
     * Clear authentication (for testing or logout)
     */
    clearAuth(): void {
        this.authToken = null;
    }
    /**
     * Fetch lightweight product image manifest
     */
    async fetchImageManifest(currentVersion: number): Promise<{ version: number; items: ProductImageManifestItem[]; upToDate: boolean }> {
        if (!this.config || !this.isOnline) return { version: currentVersion, items: [], upToDate: true };

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/images/manifest?v=${currentVersion}`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

            if (response.status === 304) {
                return { version: currentVersion, items: [], upToDate: true };
            }

            if (!response.ok) {
                throw new Error(`Fetch image manifest failed: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                version: data.version,
                items: data.items || [],
                upToDate: false
            };
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error fetching image manifest:', error);
            return { version: currentVersion, items: [], upToDate: true };
        }
    }

    /**
     * Pull batch of product images
     */
    async pullImages(ids: string[]): Promise<ProductImagePayloadItem[]> {
        if (!this.config || !this.isOnline || ids.length === 0) return [];

        try {
            await this.ensureAuthenticated();
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/images/batch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({ ids })
            });

            if (!response.ok) {
                throw new Error(`Pull images failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.items || [];
        } catch (error) {
            console.error('❌ ApiSyncAdapter: Error pulling images:', error);
            return [];
        }
    }
}

export const apiSyncAdapter = new ApiSyncAdapter();
