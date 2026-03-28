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
    private listeners: Set<(state: SyncState) => void> = new Set();
    private state: SyncState = {
        pendingCount: 0,
        isSyncing: false,
        hasError: false,
        lastSyncTime: null
    };

    /**
     * Initialize the background sync manager
     */
    async initialize() {
        if (dbAdapter.adapterType === 'network') {
            console.log("🛑 BackgroundSyncManager disabled: Running in Network Mode.");
            return;
        }

        console.log('🔄 BackgroundSyncManager: Initializing...');

        // Recover interrupted sync states from previous crashes/reloads.
        await this.recoverStuckSyncItems();
        await this.recoverCompletedTransactionsForReplay();

        // Initial count of pending items
        await this.updatePendingCount();

        // Start background worker
        this.startWorker();

        // Listen for online events
        window.addEventListener('online', () => {
            console.log('🌐 Network is back online. Triggering immediate sync...');
            this.sync();
        });

        // Listen for offline events to update UI
        window.addEventListener('offline', () => {
            this.updateState({ hasError: true });
        });
    }

    private startWorker() {
        if (this.interval) clearInterval(this.interval);
        this.interval = setInterval(() => this.sync(), 30000); // Every 30 seconds
        console.log('⚙️ BackgroundSyncManager: Worker started (30s interval)');
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
        this.updateState({ isSyncing: true, hasError: false });

        const collectionErrors: string[] = [];

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
                await apiSyncAdapter.pushOperationalEvents([item]);
            }).catch((error: any) => {
                collectionErrors.push(`wallet_transactions: ${error?.message || 'unknown error'}`);
            });

            // 6) Loyalty points events (optional collection; often empty until wired to earn/burn)
            await this.processCollection<any>('loyalty_events', async (item) => {
                await apiSyncAdapter.pushOperationalEvents([item]);
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
            }
        } catch (error) {
            console.error('❌ BackgroundSyncManager: Sync failed:', error);
            this.updateState({ isSyncing: false, hasError: true });
        } finally {
            this.isProcessing = false;
            await this.updatePendingCount();
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
            const status = item.syncStatus;
            if (status === 'PENDING' || status === 'ERROR' || status === 'SYNCING') return true;
            // Legacy safeguard: older transactions may not have syncStatus set.
            if (collectionName === 'transactions' && (status === undefined || status === null || (item as any).syncStatus === '')) {
                return true;
            }
            // Wallet / loyalty: only sync rows explicitly queued (avoid replaying legacy rows without status).
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
                await db.saveDocument(collectionName as any, item as any);

                // Attempt push
                await pushFn(item);

                // Mark as completed
                item.syncStatus = 'COMPLETED';
                item.syncError = undefined;
                if (item._forceSyncReplay) {
                    item._forceSyncReplay = false;
                }
                await db.saveDocument(collectionName as any, item as any);
                if (collectionName === 'transactions') {
                    const t = item as any;
                    console.log(
                        `[SYNC_BSM] marked COMPLETED collection=transactions id=${t.id} source_transaction_id=${t.source_transaction_id || 'n/a'}`
                    );
                }
            } catch (error: any) {
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
        // Don't await the sync itself to avoid blocking UI
        this.sync();
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
        if (permissionService.isMasterTerminal()) return;

        const terminalId = permissionService.getTerminalId();
        if (!terminalId) return;

        const flagKey = `sync_replay_completed_transactions_v2_${terminalId}`;
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

                // v2 broadened recovery:
                // - COMPLETED items can be replayed once (for silent push bugs).
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
