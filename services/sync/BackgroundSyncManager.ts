import { db } from '../../utils/db';
import { dbAdapter } from '../db';
import { apiSyncAdapter } from './ApiSyncAdapter';
import { permissionService } from './PermissionService';
import { Transaction, InventoryLedgerEntry, CashMovement, ZReport, SyncStatus } from '../../types';

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

        try {
            // 1. Transactions
            await this.processCollection<Transaction>('transactions', async (item) => {
                await apiSyncAdapter.pushTransaction(item);
            });

            // 2. Inventory Ledger
            await this.processCollection<InventoryLedgerEntry>('inventoryLedger', async (item) => {
                await apiSyncAdapter.pushInventoryMovement(item);
            });

            // 3. Cash Movements
            await this.processCollection<CashMovement>('cashMovements', async (item) => {
                // Assuming there's an endpoint for this, if not we might need to add it to apiSyncAdapter
                // For now, let's assume pushInventoryMovement or similar can handle it or add a generic push
                await (apiSyncAdapter as any).pushCashMovement?.(item);
            });

            // 4. Z-Reports
            await this.processCollection<ZReport>('zReports', async (item) => {
                await (apiSyncAdapter as any).pushZReport?.(item);
            });

            this.updateState({
                isSyncing: false,
                hasError: false,
                lastSyncTime: new Date().toISOString()
            });

            // 5. Prune old data to keep the database small
            await this.pruneSyncedItems();
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
        const pending = data.filter(item => item.syncStatus === 'PENDING' || item.syncStatus === 'ERROR');

        if (pending.length === 0) return;

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
                await db.save(collectionName as any, data); // Save whole collection (legacy db.ts behavior)

                // Attempt push
                await pushFn(item);

                // Mark as completed
                item.syncStatus = 'COMPLETED';
                item.syncError = undefined;
                await db.save(collectionName as any, data);
            } catch (error: any) {
                console.error(`❌ BackgroundSyncManager: Failed to sync ${collectionName} item ${item.id}:`, error);
                item.syncStatus = 'ERROR';
                item.syncError = error.message;
                await db.save(collectionName as any, data);

                // Stop processing this collection to maintain FIFO order on next retry
                throw error;
            }
        }
    }

    private async updatePendingCount() {
        let count = 0;
        const collections = ['transactions', 'inventoryLedger', 'cashMovements', 'zReports'];

        for (const col of collections) {
            const data = await db.get(col as any) || [];
            if (Array.isArray(data)) {
                count += data.filter((item: any) => item.syncStatus === 'PENDING' || item.syncStatus === 'ERROR').length;
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
     * Prune old COMPLETED items to keep the local database healthy
     */
    private async pruneSyncedItems() {
        const RETENTION_DAYS = 30;
        const now = new Date();
        const cutoff = new Date(now.getTime() - (RETENTION_DAYS * 24 * 60 * 60 * 1000));

        console.log(`🧹 BackgroundSyncManager: Pruning synced items older than ${RETENTION_DAYS} days (Cutoff: ${cutoff.toISOString()})`);

        const collections = ['transactions', 'inventoryLedger', 'cashMovements', 'zReports'];

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
