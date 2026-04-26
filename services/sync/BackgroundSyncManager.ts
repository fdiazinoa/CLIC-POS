import { db } from '../../utils/db';
import { dbAdapter } from '../db';
import { apiSyncAdapter } from './ApiSyncAdapter';
import { permissionService } from './PermissionService';
import { InventoryLedgerEntry, CashMovement, ZReport, SyncStatus } from '../../types';

export interface SyncState {
    pendingCount: number;
    isSyncing: boolean;
    hasError: boolean;
    lastSyncTime: string | null;
}

class BackgroundSyncManager {
    private isProcessing = false;
    private interval: any = null;
    private retryTimeout: any = null;
    private initialized = false;
    private listeners: Set<(state: SyncState) => void> = new Set();
    private onlineHandler: (() => void) | null = null;
    private offlineHandler: (() => void) | null = null;
    private focusHandler: (() => void) | null = null;
    private visibilityHandler: (() => void) | null = null;
    private nextRetryDelayMs: number | null = null;
    private state: SyncState = {
        pendingCount: 0,
        isSyncing: false,
        hasError: false,
        lastSyncTime: null
    };
    private readonly WORKER_INTERVAL_MS = 30000;
    private readonly FAST_RETRY_DELAY_MS = 5000;
    private readonly RECOVERABLE_TRANSACTION_RETRY_DELAY_MS = 15000;

    /**
     * Initialize the background sync manager
     */
    async initialize() {
        if (dbAdapter.adapterType === 'network') {
            console.log("🛑 BackgroundSyncManager disabled: Running in Network Mode.");
            return;
        }

        if (this.initialized) {
            await this.updatePendingCount();
            this.startWorker();
            return;
        }

        console.log('🔄 BackgroundSyncManager: Initializing...');
        this.initialized = true;

        // Recover interrupted sync states from previous crashes/reloads.
        await this.recoverStuckSyncItems();
        await this.recoverCompletedTransactionsForReplay();

        // Initial count of pending items
        await this.updatePendingCount();

        // Start background worker
        this.startWorker();

        this.onlineHandler = () => {
            console.log('🌐 Network is back online. Triggering immediate sync...');
            apiSyncAdapter.resetCircuit();
            this.scheduleSync(0);
        };

        this.offlineHandler = () => {
            this.clearRetryTimeout();
            this.updateState({ hasError: true });
        };

        this.focusHandler = () => {
            if (!navigator.onLine) return;
            apiSyncAdapter.resetCircuit();
            this.scheduleSync(0);
        };

        this.visibilityHandler = () => {
            if (document.hidden || !navigator.onLine) return;
            apiSyncAdapter.resetCircuit();
            this.scheduleSync(0);
        };

        window.addEventListener('online', this.onlineHandler);
        window.addEventListener('offline', this.offlineHandler);
        window.addEventListener('focus', this.focusHandler);
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    private startWorker() {
        if (this.interval) clearInterval(this.interval);
        this.interval = setInterval(() => this.sync(), this.WORKER_INTERVAL_MS);
        console.log(`⚙️ BackgroundSyncManager: Worker started (${this.WORKER_INTERVAL_MS / 1000}s interval)`);
    }

    private clearRetryTimeout() {
        if (!this.retryTimeout) return;
        clearTimeout(this.retryTimeout);
        this.retryTimeout = null;
    }

    private scheduleSync(delayMs = this.FAST_RETRY_DELAY_MS) {
        if (!navigator.onLine) return;

        if (delayMs <= 0) {
            this.clearRetryTimeout();
            void this.sync();
            return;
        }

        if (this.retryTimeout) return;

        this.retryTimeout = setTimeout(() => {
            this.retryTimeout = null;
            void this.sync();
        }, delayMs);
    }

    private isRecoverableTransactionSyncError(error: unknown): boolean {
        const message = error instanceof Error
            ? error.message
            : typeof error === 'string'
                ? error
                : '';
        const normalized = message.toLowerCase();
        return (
            normalized.includes('invalid or missing sync token') ||
            normalized.includes('erp transaction sync failed: 401') ||
            normalized.includes('circuit breaker open') ||
            normalized.includes('erp temporalmente no disponible') ||
            normalized.includes('failed to fetch') ||
            normalized.includes('networkerror') ||
            normalized.includes('load failed') ||
            normalized.includes('aborterror')
        );
    }

    private isErpOperationalPushConfigured(): boolean {
        try {
            const erpBaseUrl =
                localStorage.getItem('CLIC_ERP_SYNC_URL') ||
                localStorage.getItem('CLIC_ERP_BASE_URL') ||
                localStorage.getItem('erp_base_url');
            const erpTerminalId = localStorage.getItem('clic_erp_sync_terminal_id');
            return Boolean(erpBaseUrl && erpTerminalId);
        } catch {
            return false;
        }
    }

    /**
     * On slave terminals, only sync operational docs owned by this terminal.
     * This prevents replaying historical/master documents accidentally present locally.
     */
    private shouldSyncItem(collectionName: string, item: any): boolean {
        if (permissionService.isMasterTerminal()) return true;

        const normalizeTerminalId = (value: any) =>
            typeof value === 'string' ? value.trim().toLowerCase() : '';

        const currentTerminalId = normalizeTerminalId(permissionService.getTerminalId());
        if (!currentTerminalId) return true;

        const terminalScopedCollections = new Set([
            'inventoryLedger',
            'cashMovements',
            'zReports',
            'transactions',
            'wallet_transactions',
            'loyalty_events'
        ]);

        if (!terminalScopedCollections.has(collectionName)) return true;
        if (!item || !item.terminalId) return false;

        const itemTerminalId = normalizeTerminalId(item.terminalId);
        if (!itemTerminalId) return false;

        return itemTerminalId === currentTerminalId;
    }

    /**
     * Resolve the best timestamp field across heterogeneous operational documents.
     * Z-Reports use closedAt/openedAt, while others usually use createdAt/timestamp/date.
     */
    private resolveItemDate(item: any): Date | null {
        const rawDate =
            item?.closedAt ||
            item?.openedAt ||
            item?.createdAt ||
            item?.timestamp ||
            item?.date ||
            item?.updatedAt;

        if (!rawDate) return null;
        const parsed = new Date(rawDate);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    /**
     * Main sync loop
     */
    async sync() {
        if (this.isProcessing || !navigator.onLine) return;

        // We only sync if we are a SLAVE or if we are a MASTER that needs to push to a central server
        // (In this architecture, Master also pushes to its own server to keep db.json as source of truth)

        this.isProcessing = true;
        this.clearRetryTimeout();
        this.nextRetryDelayMs = null;
        this.updateState({ isSyncing: true, hasError: false });

        const collectionErrors: string[] = [];
        let shouldRetrySoon = false;

        try {
            // 1) Transactions first to prioritize sales visibility at central terminal.
            await this.processCollection<any>('transactions', async (item) => {
                await apiSyncAdapter.pushTransaction(item);
            }).catch((error: any) => {
                collectionErrors.push(`transactions: ${error?.message || 'unknown error'}`);
            });

            // 2) Inventory Ledger
            await this.processCollection<InventoryLedgerEntry>('inventoryLedger', async (item) => {
                await apiSyncAdapter.pushInventoryMovement(item);
            }).catch((error: any) => {
                collectionErrors.push(`inventoryLedger: ${error?.message || 'unknown error'}`);
            });

            // 3) Cash Movements
            await this.processCollection<CashMovement>('cashMovements', async (item) => {
                await (apiSyncAdapter as any).pushCashMovement?.(item);
            }).catch((error: any) => {
                collectionErrors.push(`cashMovements: ${error?.message || 'unknown error'}`);
            });

            // 4) Z-Reports
            await this.processCollection<ZReport>('zReports', async (item) => {
                await (apiSyncAdapter as any).pushZReport?.(item);
            }).catch((error: any) => {
                collectionErrors.push(`zReports: ${error?.message || 'unknown error'}`);
            });

            // 5) Wallet operational events (ERP-normalized queue)
            await this.processCollection<any>('wallet_transactions', async (item) => {
                await (apiSyncAdapter as any).pushOperationalEvents?.([item]);
            }).catch((error: any) => {
                collectionErrors.push(`wallet_transactions: ${error?.message || 'unknown error'}`);
            });

            // 6) Loyalty points events (optional collection; often empty until wired to earn/burn)
            await this.processCollection<any>('loyalty_events', async (item) => {
                await (apiSyncAdapter as any).pushOperationalEvents?.([item]);
            }).catch((error: any) => {
                collectionErrors.push(`loyalty_events: ${error?.message || 'unknown error'}`);
            });

            this.updateState({
                isSyncing: false,
                hasError: collectionErrors.length > 0,
                lastSyncTime: new Date().toISOString()
            });

            // 5. Prune old data to keep the database small
            await this.pruneSyncedItems();
            if (collectionErrors.length > 0) {
                console.warn('⚠️ BackgroundSyncManager: Partial sync with errors:', collectionErrors);
                shouldRetrySoon = true;
            }
        } catch (error) {
            console.error('❌ BackgroundSyncManager: Sync failed:', error);
            this.updateState({ isSyncing: false, hasError: true });
            shouldRetrySoon = true;
        } finally {
            this.isProcessing = false;
            await this.updatePendingCount();
            if (navigator.onLine && (shouldRetrySoon || this.state.pendingCount > 0)) {
                this.scheduleSync(this.nextRetryDelayMs ?? this.FAST_RETRY_DELAY_MS);
            }
        }
    }

    /**
     * Process a collection sequentially (FIFO)
     */
    private async processCollection<T extends {
        id: string,
        syncStatus?: SyncStatus,
        syncError?: string,
        _forceSyncReplay?: boolean,
        syncRetryAfter?: string,
        createdAt?: string,
        timestamp?: string,
        date?: string,
        closedAt?: string,
        openedAt?: string,
        updatedAt?: string
    }>(
        collectionName: string,
        pushFn: (item: T) => Promise<void>
    ) {
        const data = await db.get(collectionName as any) as T[];
        if (!Array.isArray(data)) return;

        // Filter pending items and sort by date (FIFO)
        const isSyncPending = (item: T): boolean => {
            const retryAfter = Date.parse(String((item as any).syncRetryAfter || ''));
            if (Number.isFinite(retryAfter) && retryAfter > Date.now()) {
                const delay = Math.max(1000, retryAfter - Date.now());
                this.nextRetryDelayMs = this.nextRetryDelayMs === null
                    ? delay
                    : Math.min(this.nextRetryDelayMs, delay);
                return false;
            }

            const status = item.syncStatus;
            if (status === 'PENDING' || status === 'ERROR' || status === 'SYNCING') return true;
            // Legacy safeguard: older transactions may not have syncStatus set.
            if (collectionName === 'transactions' && (status === undefined || status === null || (item as any).syncStatus === '')) {
                return true;
            }
            if (
                (collectionName === 'wallet_transactions' || collectionName === 'loyalty_events') &&
                (status === undefined || status === null || (item as any).syncStatus === '')
            ) {
                return false;
            }
            return false;
        };
        const pending = data.filter(item =>
            (this.shouldSyncItem(collectionName, item) || (collectionName === 'transactions' && item._forceSyncReplay === true)) &&
            isSyncPending(item)
        );

        if (pending.length === 0) {
            return;
        }

        console.log(`🔄 BackgroundSyncManager: Processing ${pending.length} pending items in ${collectionName}`);

        // Sort by date to maintain integrity
        pending.sort((a, b) => {
            const dateA = this.resolveItemDate(a)?.getTime() ?? 0;
            const dateB = this.resolveItemDate(b)?.getTime() ?? 0;
            return dateA - dateB;
        });

        for (const item of pending) {
            try {
                // Mark as syncing
                item.syncStatus = 'SYNCING';
                delete (item as any).syncRetryAfter;
                await db.saveDocument(collectionName as any, item as any);

                // Attempt push
                await pushFn(item);

                // Mark as completed
                item.syncStatus = 'COMPLETED';
                item.syncError = undefined;
                if (item._forceSyncReplay) {
                    item._forceSyncReplay = false;
                }
                delete (item as any).syncRetryAfter;
                await db.saveDocument(collectionName as any, item as any);
                if (collectionName === 'transactions') {
                    const transaction = item as any;
                    console.log(
                        `[SYNC_BSM] marked COMPLETED collection=transactions id=${transaction.id} source_transaction_id=${transaction.source_transaction_id || 'n/a'}`
                    );
                }
            } catch (error: any) {
                if (collectionName === 'transactions' && this.isRecoverableTransactionSyncError(error)) {
                    console.warn(
                        `⏳ BackgroundSyncManager: Deferred recoverable transaction sync ${item.id}:`,
                        error?.message || error
                    );
                    item.syncStatus = 'PENDING';
                    item.syncError = undefined;
                    item._forceSyncReplay = true;
                    (item as any).syncRetryAfter = new Date(Date.now() + this.RECOVERABLE_TRANSACTION_RETRY_DELAY_MS).toISOString();
                    this.nextRetryDelayMs = this.nextRetryDelayMs === null
                        ? this.RECOVERABLE_TRANSACTION_RETRY_DELAY_MS
                        : Math.min(this.nextRetryDelayMs, this.RECOVERABLE_TRANSACTION_RETRY_DELAY_MS);
                    await db.saveDocument(collectionName as any, item as any);
                    break;
                }

                console.error(`❌ BackgroundSyncManager: Failed to sync ${collectionName} item ${item.id}:`, error);
                item.syncStatus = 'ERROR';
                item.syncError = error.message;
                await db.saveDocument(collectionName as any, item as any);

                // Stop processing this collection to maintain FIFO order on next retry
                throw error;
            }
        }
    }

    private async updatePendingCount() {
        let count = 0;
        const collections = ['inventoryLedger', 'cashMovements', 'zReports', 'transactions', 'wallet_transactions', 'loyalty_events'];

        for (const col of collections) {
            const data = await db.get(col as any) || [];
            if (Array.isArray(data)) {
                count += data.filter((item: any) =>
                    this.shouldSyncItem(col, item) &&
                    (item.syncStatus === 'PENDING' ||
                        item.syncStatus === 'ERROR' ||
                        item.syncStatus === 'SYNCING')
                ).length;
            }
        }

        this.updateState({ pendingCount: count });
    }

    private updateState(newState: Partial<SyncState>) {
        this.state = { ...this.state, ...newState };
        this.listeners.forEach(l => l(this.state));
    }

    subscribe(listener: (state: SyncState) => void) {
        this.listeners.add(listener);
        listener(this.state);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getState() {
        return this.state;
    }

    /**
     * Trigger an immediate sync attempt (e.g. after creating a document)
     */
    async triggerSync() {
        await this.updatePendingCount();
        if (navigator.onLine) {
            apiSyncAdapter.resetCircuit();
        }
        this.scheduleSync(0);
    }

    async triggerSyncAndWait() {
        await this.updatePendingCount();
        if (navigator.onLine) {
            apiSyncAdapter.resetCircuit();
        }
        await this.sync();
    }

    /**
     * Convert stale SYNCING records to ERROR so they are retried automatically.
     * This handles abrupt browser/tab shutdowns during sync.
     */
    private async recoverStuckSyncItems() {
        const collections = ['inventoryLedger', 'cashMovements', 'zReports', 'transactions', 'wallet_transactions', 'loyalty_events'];
        for (const colName of collections) {
            try {
                const data = await db.get(colName as any) as any[];
                if (!Array.isArray(data) || data.length === 0) continue;

                let changed = false;
                for (const item of data) {
                    if (!this.shouldSyncItem(colName, item)) {
                        continue;
                    }
                    if (item?.syncStatus === 'SYNCING') {
                        item.syncStatus = 'ERROR';
                        item.syncError = item.syncError || 'Recovered interrupted sync session';
                        changed = true;
                    }
                }

                if (changed) {
                    await db.save(colName as any, data);
                    console.log(`♻️ BackgroundSyncManager: Recovered interrupted SYNCING items in ${colName}`);
                }
            } catch (error) {
                console.warn(`⚠️ Failed recovering stuck sync items in ${colName}:`, error);
            }
        }
    }

    /**
     * One-time safeguard for terminals affected by silent push drops.
     * Re-queue recent COMPLETED transactions on slave nodes; duplicates are ignored on Master.
     */
    private async recoverCompletedTransactionsForReplay() {
        const terminalId = permissionService.getTerminalId();
        if (!terminalId) return;

        const shouldReplayForSlave = !permissionService.isMasterTerminal();
        const shouldReplayForErp = this.isErpOperationalPushConfigured();
        if (!shouldReplayForSlave && !shouldReplayForErp) return;

        const flagSuffix = shouldReplayForErp ? 'erp_v3' : 'v2';
        const flagKey = `sync_replay_completed_transactions_${flagSuffix}_${terminalId}`;
        if (localStorage.getItem(flagKey) === '1') return;

        try {
            const transactions = await db.get('transactions') as any[];
            if (!Array.isArray(transactions) || transactions.length === 0) {
                localStorage.setItem(flagKey, '1');
                return;
            }

            const cutoffMs = Date.now() - (72 * 60 * 60 * 1000); // 72h lookback
            let changed = 0;

            for (const txn of transactions) {
                const txnDate = this.resolveItemDate(txn);
                if (!txnDate || txnDate.getTime() < cutoffMs) continue;

                const hasLegacyMissingStatus = txn?.syncStatus === undefined || txn?.syncStatus === null || txn?.syncStatus === '';
                const shouldReplayCompleted = txn?.syncStatus === 'COMPLETED';

                // Requeue recent transactions once:
                // - on slave nodes for legacy silent push bugs
                // - on ERP-bound terminals after introducing the direct ERP operational channel
                // - Missing status gets normalized to PENDING.
                if (hasLegacyMissingStatus || shouldReplayCompleted) {
                    txn.syncStatus = 'PENDING';
                    txn._forceSyncReplay = true;
                    if (!txn.syncError) {
                        txn.syncError = 'Recovered by replay safeguard v2';
                    }
                    changed++;
                }
            }

            if (changed > 0) {
                await db.save('transactions', transactions);
                console.warn(`♻️ BackgroundSyncManager: Re-queued ${changed} recent completed transactions for replay.`);
            }
        } catch (error) {
            console.warn('⚠️ BackgroundSyncManager: Failed replay recovery for completed transactions:', error);
        } finally {
            localStorage.setItem(flagKey, '1');
        }
    }

    /**
     * Prune old COMPLETED items to keep the local database healthy
     */
    private async pruneSyncedItems() {
        const RETENTION_DAYS = 30;
        const now = new Date();
        const cutoff = new Date(now.getTime() - (RETENTION_DAYS * 24 * 60 * 60 * 1000));

        console.log(`🧹 BackgroundSyncManager: Pruning synced items older than ${RETENTION_DAYS} days (Cutoff: ${cutoff.toISOString()})`);

        const collections = ['inventoryLedger', 'cashMovements', 'zReports', 'transactions', 'wallet_transactions', 'loyalty_events'];

        for (const colName of collections) {
            try {
                const data = await db.get(colName as any) as any[];
                if (!Array.isArray(data)) continue;

                const toKeep: any[] = [];
                const toPruneIds: string[] = [];

                data.forEach(item => {
                    const itemDate = this.resolveItemDate(item);
                    const isOld = !!itemDate && itemDate < cutoff;
                    const isSynced = item.syncStatus === 'COMPLETED';

                    if (isSynced && isOld) {
                        toPruneIds.push(item.id);
                    } else {
                        toKeep.push(item);
                    }
                });

                if (toPruneIds.length > 0) {
                    console.log(`🗑️ Pruning ${toPruneIds.length} items from ${colName}`);
                    // Use saveCollection (expensive but correct for mass delete in legacy db.ts)
                    // Or call deleteDocument for each. Since we just migrated to IDB, 
                    // saveCollection with the new array will rewrite the store.
                    await db.save(colName as any, toKeep);
                }
            } catch (error) {
                console.error(`❌ Failed to prune ${colName}:`, error);
            }
        }
    }
}

export const backgroundSyncManager = new BackgroundSyncManager();
