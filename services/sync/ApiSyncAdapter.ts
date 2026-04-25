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

class ApiSyncAdapter {
    private config: SyncConfig | null = null;
    private authToken: string | null = null;
    private erpAuthToken: string | null = null;
    private operationalTargetHint: { terminalId: string | null; baseUrl: string | null } = { terminalId: null, baseUrl: null };
    private isOnline: boolean = true;
    private authInFlight: Promise<void> | null = null;
    private erpAuthInFlight: Promise<string> | null = null;
    private lastOperationalStockBalanceMaps = new Map<string, Record<string, number>>();
    private onlineListener: (() => void) | null = null;
    private offlineListener: (() => void) | null = null;

    // Circuit Breaker State
    private consecutiveFailures: number = 0;
    private circuitOpenTimeStamp: number = 0;
    private readonly MAX_CONSECUTIVE_FAILURES = 3;
    private readonly CIRCUIT_RESET_TIMEOUT = 30000; // 30 seconds
    private readonly CIRCUIT_BREAKER_OPEN_ERROR = 'Circuit Breaker Open: Master unreachable';
    private onConnectionRestored: (() => void) | null = null;
    private lastAuthLogAt: Record<'master' | 'erp', number> = { master: 0, erp: 0 };
    private readonly AUTH_LOG_THROTTLE_MS = 5000;

    private isCircuitBreakerOpenError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error || '');
        return message.includes(this.CIRCUIT_BREAKER_OPEN_ERROR);
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
        this.consecutiveFailures = 0;
        this.circuitOpenTimeStamp = 0;
        this.isOnline = true;
        console.log('🔄 ApiSyncAdapter: Circuit Breaker manually RESET.');
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

    /**
     * Helper: Fetch with Retry and Timeout
     */
    private async fetchWithRetry(url: string, options: RequestInit = {}, retries = 2, backoff = 500, timeoutMs = 5000): Promise<Response> {
        // Add jitter to backoff (±20% randomness)
        const jitter = backoff * 0.2;
        const effectiveBackoff = backoff + (Math.random() * jitter * 2 - jitter);
        // Circuit Breaker Check
        if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
            const timeSinceOpen = Date.now() - this.circuitOpenTimeStamp;
            if (timeSinceOpen < this.CIRCUIT_RESET_TIMEOUT) {
                console.warn('⚠️ Circuit Breaker OPEN. Rejecting request to avoid freeze.');
                throw new Error(this.CIRCUIT_BREAKER_OPEN_ERROR);
            } else {
                // Reset circuit on timeout test
                console.log('🔄 Circuit Breaker Reset: Retrying connection...');
                this.consecutiveFailures = 0;
            }
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);

            // Success resets the breaker
            if (response.ok) {
                const wasBreakerOpen = this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES;
                this.consecutiveFailures = 0;

                if (wasBreakerOpen && this.onConnectionRestored) {
                    console.log('📶 ApiSyncAdapter: Connection restored, notifying listeners.');
                    this.onConnectionRestored();
                }
            }

            // If 401 Unauthorized, clear token and potentially re-auth
            if (response.status === 401) {
                console.warn(`⚠️ ApiSyncAdapter: 401 Unauthorized at ${url}. Clearing token.`);
                this.authToken = null;
                // We don't re-auth here to avoid recursion, 
                // but the next call will trigger it via ensureAuthenticated()
            }

            // If 503 Service Unavailable or 504 Gateway Timeout, retry
            if ((response.status === 503 || response.status === 504) && retries > 0) {
                console.warn(`⚠️ Request failed with ${response.status}, retrying in ${Math.round(effectiveBackoff)}ms...`);
                await new Promise(r => setTimeout(r, effectiveBackoff));
                return this.fetchWithRetry(url, options, retries - 1, backoff * 2, timeoutMs);
            }

            return response;
        } catch (error: any) {
            clearTimeout(timeoutId);

            const isConnectionError = error.name === 'TypeError' && error.message === 'Failed to fetch';
            const isTimeout = error.name === 'AbortError';

            // Increment failure count on network errors
            if (isConnectionError || isTimeout) {
                this.consecutiveFailures++;
                if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
                    this.circuitOpenTimeStamp = Date.now();
                    console.error('🚨 Circuit Breaker TRIPPED: Too many connection failures.');

                    // Notify listeners about connection loss to trigger auto-discovery
                    if (this.onConnectionLostCallback) {
                        this.onConnectionLostCallback();
                    }
                }
            }

            if ((isConnectionError || isTimeout) && retries > 0 && this.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES) {
                console.warn(`⚠️ Connection error (${error.message}), retrying in ${Math.round(effectiveBackoff)}ms...`);
                await new Promise(r => setTimeout(r, effectiveBackoff));
                return this.fetchWithRetry(url, options, retries - 1, backoff * 1.5, timeoutMs);
            }

            throw error;
        }
    }

    private async fetchWithoutCircuitBreaker(url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timeoutId);
        }
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
    async authenticate(force = false): Promise<void> {
        this.ensureConfig();
        if (!this.config) throw new Error('ApiSyncAdapter not initialized'); // Should be caught by ensureConfig

        if (!force && this.authToken) {
            return;
        }

        if (!force && this.authInFlight) {
            return this.authInFlight;
        }

        const authPromise = (async () => {
            try {
                const response = await this.fetchWithRetry(`${this.config!.masterUrl}/api/sync/auth`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        terminalId: this.config!.terminalId,
                        deviceToken: localStorage.getItem('CLIC_POS_DEVICE_TOKEN')
                    })
                });

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
                    console.warn('⚠️ Authentication deferred: circuit breaker open, waiting before retry.');
                } else {
                    this.logAuthFailure('master', error);
                }
                this.isOnline = false;
                throw error;
            }
        })();

        this.authInFlight = authPromise.finally(() => {
            this.authInFlight = null;
        });

        return this.authInFlight;
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

    private resolveOperationalTarget(): { baseUrl: string; terminalId: string; useLocalTarget: boolean } | null {
        const localMasterTarget: { baseUrl: string; terminalId: string; useLocalTarget: boolean } | null = this.config?.masterUrl && this.config?.terminalId
            ? {
                baseUrl: this.buildSyncApiBase(this.config.masterUrl),
                terminalId: this.config.terminalId,
                useLocalTarget: true
            }
            : null;

        if (localMasterTarget && permissionService.isSlaveTerminal()) {
            return localMasterTarget;
        }

        const boundErpTerminalId =
            this.operationalTargetHint.terminalId ||
            localStorage.getItem('clic_erp_sync_terminal_id');
        const erpBaseUrl =
            this.operationalTargetHint.baseUrl ||
            localStorage.getItem('CLIC_ERP_SYNC_URL') ||
            localStorage.getItem('CLIC_ERP_BASE_URL') ||
            localStorage.getItem('erp_base_url');

        if (boundErpTerminalId && erpBaseUrl) {
            return {
                baseUrl: this.buildSyncApiBase(erpBaseUrl),
                terminalId: boundErpTerminalId,
                useLocalTarget: false
            };
        }

        return localMasterTarget;
    }

    private async authenticateOperationalTarget(force = false): Promise<{
        baseUrl: string;
        terminalId: string;
        token: string;
        useLocalTarget: boolean;
    }> {
        const target = this.resolveOperationalTarget();
        if (!target) {
            throw new Error('Operational sync target is not configured');
        }

        if (target.useLocalTarget) {
            if (!this.authToken || force) {
                await this.authenticate(force);
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

        if (!force && this.erpAuthToken) {
            return {
                ...target,
                token: this.erpAuthToken
            };
        }

        if (!force && this.erpAuthInFlight) {
            const token = await this.erpAuthInFlight;
            return {
                ...target,
                token
            };
        }

        const erpAuthPromise = (async () => {
            const response = await this.fetchWithRetry(`${target.baseUrl}/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    terminalId: target.terminalId,
                    deviceToken: localStorage.getItem('CLIC_POS_DEVICE_TOKEN')
                })
            });

            if (!response.ok) {
                let errorMessage = `ERP authentication failed: ${response.status} ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorMessage += ` - ${errorData.message || errorData.error || 'unknown error'}`;
                } catch {
                    // ignore JSON parse issues here
                }
                throw new Error(errorMessage);
            }

            const data = await response.json();
            return String(data.token || '');
        })();

        this.erpAuthInFlight = erpAuthPromise.finally(() => {
            this.erpAuthInFlight = null;
        });

        try {
            this.erpAuthToken = await this.erpAuthInFlight;
        } catch (error) {
            this.logAuthFailure('erp', error);
            throw error;
        }

        if (!this.erpAuthToken) {
            throw new Error('Operational sync token unavailable for ERP target');
        }

        return {
            ...target,
            token: this.erpAuthToken
        };
    }

    private async postOperationalPayload(path: string, body: Record<string, unknown>): Promise<void> {
        const target = await this.authenticateOperationalTarget();
        const response = await this.fetchWithRetry(`${target.baseUrl}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Sync-Token': target.token
            },
            body: JSON.stringify(body)
        });

        if (response.status === 401) {
            if (target.useLocalTarget) {
                this.authToken = null;
            } else {
                this.erpAuthToken = null;
            }

            const retriedTarget = await this.authenticateOperationalTarget(true);
            const retryResponse = await this.fetchWithRetry(`${retriedTarget.baseUrl}${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': retriedTarget.token
                },
                body: JSON.stringify(body)
            });

            if (!retryResponse.ok) {
                throw new Error(`Operational sync failed after re-auth: ${retryResponse.status} ${retryResponse.statusText}`);
            }

            return;
        }

        if (!response.ok) {
            throw new Error(`Operational sync failed: ${response.status} ${response.statusText}`);
        }
    }

    private async getOperationalPayload<T = any>(path: string): Promise<T> {
        const target = await this.authenticateOperationalTarget();
        const response = await this.fetchWithRetry(`${target.baseUrl}${path}`, {
            headers: {
                'X-Sync-Token': target.token
            }
        });

        if (response.status === 401) {
            if (target.useLocalTarget) {
                this.authToken = null;
            } else {
                this.erpAuthToken = null;
            }

            const retriedTarget = await this.authenticateOperationalTarget(true);
            const retryResponse = await this.fetchWithRetry(`${retriedTarget.baseUrl}${path}`, {
                headers: {
                    'X-Sync-Token': retriedTarget.token
                }
            });

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
    private async ensurePushReady(): Promise<void> {
        this.ensureConfig();

        if (!navigator.onLine) {
            this.isOnline = false;
            throw new Error('Browser offline');
        }

        if (!this.isOnline) {
            console.warn('⚠️ ApiSyncAdapter: Recovering from offline state before push...');
            this.authToken = null;
        }

        await this.ensureAuthenticated();
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
    private async ensureAuthenticated(): Promise<void> {
        if (!this.authToken) {
            console.log("🔄 ApiSyncAdapter: No token found, authenticating...");
            await this.authenticate();
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
            });

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
            });

            if (response.status === 401) {
                // Token expired, re-authenticate
                await this.authenticate();
                return this.pull(collection, sinceVersion);
            }

            if (!response.ok) {
                throw new Error(`Pull failed: ${response.statusText}`);
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
            this.isOnline = false;
            throw error;
        }
    }

    /**
     * Pull incremental changes from Master (Delta Sync)
     */
    async pullDelta(collection: string, sinceVersion?: number): Promise<{ items: any[], serverTime: string, isFullDownload: boolean, latestVersion?: number }> {
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
            });

            if (response.status === 401) {
                await this.authenticate();
                return this.pullDelta(collection, sinceVersion);
            }

            if (!response.ok) {
                throw new Error(`Delta pull failed: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`❌ ApiSyncAdapter: Error pulling delta for ${collection}:`, error);
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
                throw new Error(`Get metadata failed: ${response.statusText}`);
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

    private async pushTransactionViaMaster(
        normalizedTransaction: any,
        txId: string,
        itemsCount: number | string
    ): Promise<void> {
        console.log(
            `[SYNC_TX_PUSH] fallback master start masterUrl=${this.config?.masterUrl || 'n/a'} terminalId=${this.config?.terminalId || 'n/a'} tx=${txId} items=${itemsCount}`
        );
        await this.ensurePushReady();
        const erpBaseUrl = this.resolveClientErpBaseUrlForInbox();
        const response = await this.fetchWithRetry(`${this.config!.masterUrl}/api/sync/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Sync-Token': this.authToken || ''
            },
            body: JSON.stringify({
                items: [normalizedTransaction],
                ...(erpBaseUrl ? { erp_base_url: erpBaseUrl } : {})
            })
        }, 2, 500, 20000);

        if (response.status === 401) {
            await this.authenticate(true);
            const retryResponse = await this.fetchWithRetry(`${this.config!.masterUrl}/api/sync/transactions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({
                    items: [normalizedTransaction],
                    ...(erpBaseUrl ? { erp_base_url: erpBaseUrl } : {})
                })
            }, 2, 500, 20000);
            if (!retryResponse.ok) {
                const retryText = await retryResponse.text();
                throw new Error(`Master transaction sync failed after re-auth: ${retryResponse.status} ${retryResponse.statusText}${retryText ? ` — ${retryText.slice(0, 400)}` : ''}`);
            }
            return;
        }

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Master transaction sync failed: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 400)}` : ''}`);
        }
    }

    async pushTransaction(transaction: any): Promise<void> {
        try {
            const normalizedTransaction = buildErpSalePayload(transaction);
            const operationalTarget = this.resolveOperationalTarget();
            const txId = normalizedTransaction.source_transaction_id || normalizedTransaction.id;
            const itemsCount = Array.isArray((normalizedTransaction as any).items)
                ? (normalizedTransaction as any).items.length
                : typeof (normalizedTransaction as any).items === 'string'
                  ? `string(len=${String((normalizedTransaction as any).items).length})`
                  : 'none';

            if (operationalTarget && !operationalTarget.useLocalTarget) {
                try {
                    console.log(
                        `[SYNC_TX_PUSH] ERP direct start base=${operationalTarget.baseUrl} terminal=${operationalTarget.terminalId} tx=${txId} items=${itemsCount}`
                    );
                    let target = await this.authenticateOperationalTarget();
                    console.log(
                        `[SYNC_TX_PUSH] ERP direct auth token=${this.maskSyncToken(target.token)} terminal=${target.terminalId}`
                    );
                    let response = await this.fetchWithRetry(`${target.baseUrl}/transactions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Sync-Token': target.token
                        },
                        body: JSON.stringify({ items: [normalizedTransaction] })
                    }, 2, 500, 20000);

                    if (response.status === 401) {
                        this.erpAuthToken = null;
                        target = await this.authenticateOperationalTarget(true);
                        console.log(
                            `[SYNC_TX_PUSH] ERP direct re-auth token=${this.maskSyncToken(target.token)} terminal=${target.terminalId}`
                        );
                        response = await this.fetchWithRetry(`${target.baseUrl}/transactions`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Sync-Token': target.token
                            },
                            body: JSON.stringify({ items: [normalizedTransaction] })
                        }, 2, 500, 20000);
                    }

                    const text = await response.text();
                    let syncBody: any = null;
                    try {
                        syncBody = JSON.parse(text);
                    } catch {
                        // non-JSON response
                    }

                    if (!response.ok) {
                        if (response.status === 401 && this.config?.masterUrl && this.config?.terminalId) {
                            this.erpAuthToken = null;
                            console.warn(
                                `[SYNC_TX_PUSH] ERP direct rejected token for tx=${txId}. Falling back to local master route. body=${text.slice(0, 240)}`
                            );
                            await this.pushTransactionViaMaster(normalizedTransaction, txId, itemsCount);
                            return;
                        }
                        throw new Error(
                            `ERP transaction sync failed: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 400)}` : ''}`
                        );
                    }

                    if (syncBody && typeof syncBody.applyFailedCount === 'number' && syncBody.applyFailedCount > 0) {
                        console.error(
                            `[SYNC_TX_PUSH] ERP /api/sync/transactions applyFailedCount=${syncBody.applyFailedCount}`,
                            syncBody.applyIssues
                        );
                        throw new Error(`ERP did not persist sale (apply failures): ${JSON.stringify(syncBody.applyIssues || [])}`);
                    }

                    console.log(
                        `[SYNC_TX_PUSH] ERP direct OK tx=${txId} host=${target.baseUrl} terminal=${target.terminalId} body=${text.slice(0, 400)}`
                    );
                    return;
                } catch (directError) {
                    if (this.config?.masterUrl && this.config?.terminalId && this.isRecoverableConnectionError(directError)) {
                        console.warn(
                            `[SYNC_TX_PUSH] ERP direct unavailable for tx=${txId}. Falling back to local master route.`,
                            directError instanceof Error ? directError.message : directError
                        );
                        this.resetCircuitBreaker();
                        await this.pushTransactionViaMaster(normalizedTransaction, txId, itemsCount);
                        return;
                    }
                    throw directError;
                }
            }

            console.log(
                `[SYNC_TX_PUSH] pre-auth masterUrl=${this.config?.masterUrl || 'n/a'} terminalId=${this.config?.terminalId || 'n/a'} hasToken=${!!this.authToken}`
            );
            await this.ensurePushReady();
            console.log(
                `[SYNC_TX_PUSH] post-auth hasToken=${!!this.authToken} X-Sync-Token=${this.maskSyncToken(this.authToken)}`
            );
            const erpBaseUrl = this.resolveClientErpBaseUrlForInbox();
            console.log(
                `[SYNC_TX_PUSH] POST ${this.config?.masterUrl}/api/sync/transactions tx=${txId} source_tx=${normalizedTransaction.source_transaction_id} source_terminal=${normalizedTransaction.source_terminal_id || normalizedTransaction.terminalId} items=${itemsCount} erp_base_url=${erpBaseUrl ? 'sent' : 'MISSING'}`
            );
            const response = await this.fetchWithRetry(`${this.config!.masterUrl}/api/sync/transactions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': this.authToken || ''
                },
                body: JSON.stringify({
                    items: [normalizedTransaction],
                    ...(erpBaseUrl ? { erp_base_url: erpBaseUrl } : {})
                })
            }, 2, 500, 20000);

            if (response.status === 401) {
                await this.authenticate();
                return this.pushTransaction(transaction);
            }

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
                console.error(
                    `[SYNC_TX_PUSH] ERP /api/sync/transactions applyFailedCount=${syncBody.applyFailedCount}`,
                    syncBody.applyIssues
                );
                throw new Error(`ERP did not persist sale (apply failures): ${JSON.stringify(syncBody.applyIssues || [])}`);
            }
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

    /**
     * Pull global configuration from Master
     */
    async pullConfig(): Promise<any> {
        if (!this.config) return null;
        if (!this.authToken) await this.authenticate();

        try {
            const response = await this.fetchWithRetry(`${this.config.masterUrl}/api/sync/config`, {
                headers: { 'X-Sync-Token': this.authToken || '' }
            });

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
