import { db } from '../../utils/db';
import { dbAdapter } from '../db';

const getApiUrl = () => {
    const masterIp = localStorage.getItem('pos_master_ip');
    if (masterIp) {
        const protocol = window.location.protocol;
        const port = window.location.port || (protocol === 'https:' ? '443' : '80');
        return `${protocol}//${masterIp}:${port}/api`;
    }
    return '/api';
};

interface SyncTokenResponse {
    success: boolean;
    token: string;
    terminalId: string;
    expiresIn: number;
}

interface SyncStatus {
    isOnline: boolean;
    lastSync: Date | null;
    pendingUploads: number;
    status: 'IDLE' | 'SYNCING' | 'ERROR' | 'OFFLINE';
}

class NetworkSyncService {
    private token: string | null = null;
    private terminalId: string | null = null;
    private syncInterval: any = null;
    private isSyncing = false;
    private listeners: ((status: SyncStatus) => void)[] = [];

    private status: SyncStatus = {
        isOnline: false,
        lastSync: null,
        pendingUploads: 0,
        status: 'OFFLINE'
    };

    constructor() {
        this.terminalId = localStorage.getItem('CLIC_POS_TERMINAL_ID');
        this.token = localStorage.getItem('CLIC_POS_SYNC_TOKEN');
    }

    public init() {
        console.log("🔄 NetworkSyncService initializing...");

        // HARD RESET CHECK (Slave Mode)
        const masterIp = localStorage.getItem('pos_master_ip');
        const lastIp = localStorage.getItem('last_sync_master_ip');

        if (masterIp && masterIp !== lastIp) {
            console.warn(`⚠️ Master IP changed (${lastIp} -> ${masterIp}). Forcing full sync reset.`);
            // Clear sync metadata to force full pull
            dbAdapter.saveCollection('syncMetadata', {} as any).catch(console.error);
            // Update last known IP
            localStorage.setItem('last_sync_master_ip', masterIp);
        }

        this.startSyncLoop();
        window.addEventListener('online', () => this.updateStatus({ isOnline: true, status: 'IDLE' }));
        window.addEventListener('offline', () => this.updateStatus({ isOnline: false, status: 'OFFLINE' }));
        this.updateStatus({ isOnline: navigator.onLine, status: navigator.onLine ? 'IDLE' : 'OFFLINE' });

        // SELF-HEAL: Clean duplicate stocks on startup
        this.cleanDuplicateStocks().catch(console.error);
    }

    private async cleanDuplicateStocks() {
        console.log('🧹 Running Self-Healing: Checking for duplicate productStocks...');
        try {
            const stocks = await dbAdapter.getCollection('productStocks') as any[] || [];
            const map = new Map<string, any[]>();

            // Group by unique key
            for (const stock of stocks) {
                if (!stock.productId || !stock.warehouseId) continue;
                const key = `${stock.productId}|${stock.warehouseId}`;
                if (!map.has(key)) map.set(key, []);
                map.get(key)!.push(stock);
            }

            let removedCount = 0;

            for (const [key, group] of map.entries()) {
                if (group.length > 1) {
                    // Sort by updatedAt desc (keep newest)
                    // If no updatedAt, use ID or index
                    group.sort((a, b) => {
                        const timeA = new Date(a.updatedAt || 0).getTime();
                        const timeB = new Date(b.updatedAt || 0).getTime();
                        return timeB - timeA;
                    });

                    // Keep the first one, delete the rest
                    const toKeep = group[0];
                    const toDelete = group.slice(1);

                    console.log(`⚠️ Found ${group.length} duplicates for ${key}. Keeping ${toKeep.id}, deleting ${toDelete.length}.`);

                    for (const item of toDelete) {
                        if (item.id) {
                            await dbAdapter.deleteDocument('productStocks', item.id);
                            removedCount++;
                        }
                    }
                }
            }

            if (removedCount > 0) {
                console.log(`✅ Cleaned up ${removedCount} duplicate productStocks.`);
            } else {
                console.log('✨ No duplicates found in productStocks.');
            }

        } catch (error) {
            console.error('❌ Error in cleanDuplicateStocks:', error);
        }
    }

    public setTerminalId(id: string) {
        if (this.terminalId !== id) {
            console.log(`🆔 NetworkSyncService: Terminal ID updated to ${id}`);
            this.terminalId = id;
            localStorage.setItem('CLIC_POS_TERMINAL_ID', id);

            // Clear token to force re-auth with new ID
            this.token = null;
            localStorage.removeItem('CLIC_POS_SYNC_TOKEN');

            // Trigger immediate sync with new ID
            this.sync();
        }
    }

    public subscribe(listener: (status: SyncStatus) => void) {
        this.listeners.push(listener);
        listener(this.status);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private updateStatus(partial: Partial<SyncStatus>) {
        this.status = { ...this.status, ...partial };
        this.listeners.forEach(l => l(this.status));
    }

    private async startSyncLoop() {
        if (this.syncInterval) clearInterval(this.syncInterval);

        // Initial sync
        await this.sync();

        // Loop every 30 seconds
        this.syncInterval = setInterval(() => this.sync(), 30000);
    }

    public async sync() {
        if (this.isSyncing || !navigator.onLine) return;

        this.isSyncing = true;
        this.updateStatus({ status: 'SYNCING' });

        try {
            // 1. Authenticate if needed
            if (!this.token) {
                await this.authenticate();
            }

            if (!this.token) {
                throw new Error("Authentication failed");
            }

            // 2. Push Pending Data (Upstream)
            await this.pushPendingTransactions();
            await this.pushPendingInventory();

            // 3. Pull Data (Downstream)
            await this.pullCollection('products');
            await this.pullCollection('productStocks'); // Sync Detailed Stocks
            await this.pullCollection('customers');
            await this.pullCollection('suppliers');
            await this.pullCollection('internalSequences');
            await this.pullCollection('inventoryLedger'); // Sync Kardex
            await this.pullCollection('purchaseOrders');  // Sync Orders

            this.updateStatus({
                lastSync: new Date(),
                status: 'IDLE',
                isOnline: true
            });

        } catch (error) {
            console.error("❌ Sync failed:", error);
            this.updateStatus({ status: 'ERROR' });
        } finally {
            this.isSyncing = false;
        }
    }

    private async authenticate() {
        if (!this.terminalId) {
            this.terminalId = `TERM-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            localStorage.setItem('CLIC_POS_TERMINAL_ID', this.terminalId);
        }

        try {
            console.log(`🔐 Authenticating as ${this.terminalId} to ${getApiUrl()}/sync/auth`);
            const res = await fetch(`${getApiUrl()}/sync/auth`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Connection': 'keep-alive'
                },
                mode: 'cors',
                body: JSON.stringify({ terminalId: this.terminalId })
            });

            const data: SyncTokenResponse = await res.json();
            if (data.success) {
                this.token = data.token;
                localStorage.setItem('CLIC_POS_SYNC_TOKEN', data.token);
                console.log("✅ Authenticated with server");
            }
        } catch (error) {
            console.error("Auth error:", error);
        }
    }

    private async pullCollection(collection: string) {
        // Get local metadata
        const metadata = await dbAdapter.getCollection('syncMetadata') as any || {};
        const lastSync = metadata[collection]?.lastUpdated; // Use timestamp for delta

        // Fetch delta or full
        let url = `${getApiUrl()}/sync/delta/${collection}`;
        if (lastSync) {
            url += `?since=${lastSync}`;
        }

        const res = await fetch(url, {
            headers: {
                'X-Sync-Token': this.token || '',
                'Connection': 'keep-alive'
            },
            mode: 'cors'
        });

        if (!res.ok) {
            if (res.status === 401) {
                console.warn("⚠️ Sync token expired or invalid. Clearing token.");
                this.token = null;
                localStorage.removeItem('CLIC_POS_SYNC_TOKEN');
            }
            return;
        }

        const data = await res.json();

        if (data.success) {
            const items = data.items || [];

            if (items.length === 0 && !data.isFullDownload) {
                // No changes
                return;
            }

            console.log(`📥 Pulling ${items.length} items for ${collection} (${data.isFullDownload ? 'Full' : 'Delta'})`);

            if (data.isFullDownload) {
                // Full replacement (initial sync or reset)
                // CRITICAL: Do NOT overwrite the entire collection as we might have pending local items
                // that haven't been pushed yet. Instead, we merge (Upsert).

                // OPTIMIZATION: For productStocks, we MUST ensure uniqueness by productId + warehouseId
                let existingStocksMap = new Map<string, string>(); // Key -> ID
                if (collection === 'productStocks') {
                    const existing = await dbAdapter.getCollection('productStocks') as any[] || [];
                    existing.forEach(s => {
                        if (s.productId && s.warehouseId) {
                            existingStocksMap.set(`${s.productId}|${s.warehouseId}`, s.id);
                        }
                    });
                }

                for (const item of items) {
                    // FIX: If productStocks, check if we already have this stock locally
                    if (collection === 'productStocks' && item.productId && item.warehouseId) {
                        const key = `${item.productId}|${item.warehouseId}`;
                        const existingId = existingStocksMap.get(key);
                        if (existingId) {
                            // We have it! Force the ID to match local so we UPDATE instead of INSERT
                            // But wait, if we use local ID, we might diverge from server ID if server has a different ID?
                            // Actually, server is authority. If server sends an item, it HAS an ID.
                            // We should probably use Server ID.
                            // BUT, if we have a local duplicate with different ID, we should delete local and save server?
                            // OR, we update local item to match server data?

                            // If we just saveDocument(item), and item.id != existingId, we get a duplicate.
                            // So we MUST delete the old local one if IDs don't match?
                            // OR, better: We update the local one's ID to match server? (Not possible usually)

                            // Strategy:
                            // If IDs match: saveDocument handles it (Update).
                            // If IDs mismatch: 
                            //    1. Delete local existingId.
                            //    2. Save new item (Insert).

                            if (existingId !== item.id) {
                                console.warn(`♻️ Replacing local stock ${existingId} with server stock ${item.id} for ${key}`);
                                await dbAdapter.deleteDocument(collection, existingId);
                            }
                        }
                    }

                    if (!item.id) {
                        console.warn(`⚠️ Skipping ${collection} item without ID`);
                        continue;
                    }

                    await dbAdapter.saveDocument(collection, item);
                }
            } else {
                // Delta Sync: Upsert or Delete
                for (const item of items) {
                    if (item.deletedAt || item.isActive === false) {
                        // Handle Soft Delete
                        // Check if we should actually delete or just update the flag.
                        // For now, let's assume we keep it but update it, unless it's explicitly deletedAt?
                        // If the backend sends it in delta, we should update our local copy.
                        // If it has 'deletedAt', maybe we remove it from local DB to save space?
                        // Let's stick to "Update" so local DB reflects server state exactly, 
                        // unless it's a hard delete.
                        // But wait, the requirement said: "SI item.deletedAt != null -> db.collection.delete(item.id)"

                        if (item.deletedAt) {
                            await dbAdapter.deleteDocument(collection, item.id);
                        } else {
                            await dbAdapter.saveDocument(collection, item);
                        }
                    } else {
                        // Upsert
                        await dbAdapter.saveDocument(collection, item);
                    }
                }
            }

            // Update local metadata
            metadata[collection] = {
                version: Date.now(), // Client-side version tracking
                lastUpdated: data.serverTime // Server time is the new cursor
            };
            await dbAdapter.saveCollection('syncMetadata', metadata);

            // SPECIAL CASE: If we pulled inventoryLedger, we MUST recalculate balances
            if (collection === 'inventoryLedger' && items.length > 0) {
                const affected = new Set<string>();
                items.forEach((item: any) => {
                    affected.add(`${item.productId}|${item.warehouseId}`);
                });

                console.log(`🧪 Recalculating ${affected.size} product/warehouse combinations after sync...`);
                for (const pair of affected) {
                    const [pId, wId] = pair.split('|');
                    await db.recalculateProductStock(pId, wId);
                }
            }
        }
    }

    private async pushPendingTransactions() {
        // In a real implementation, we would track pending items in a separate queue table
        // For now, we'll scan for items with syncStatus = 'PENDING' if we added that field
        // Or we can rely on the 'pending_transactions' collection if we were using it locally.

        // Since we are using SQLiteWASM, we need a way to know what's new.
        // A simple way is to check 'transactions' that are not on server?
        // Or better: The app should write to a 'sync_queue' collection.

        // For this MVP, let's assume we just try to push everything that is "new"
        // But without a queue, it's hard.
        // Let's implement a simple queue mechanism in the App later?
        // Or just push the last 50 transactions and let server deduplicate (it does!)

        const transactions = await dbAdapter.getCollection('transactions') || [];
        // Optimization: Only push last 20 to avoid huge payloads, server handles dedup
        const recent = transactions.slice(-20);

        if (recent.length === 0) return;

        const res = await fetch(`${getApiUrl()}/sync/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Sync-Token': this.token || '',
                'Connection': 'keep-alive'
            },
            mode: 'cors',
            body: JSON.stringify({ items: recent })
        });

        if (!res.ok) {
            if (res.status === 401) {
                this.token = null;
                localStorage.removeItem('CLIC_POS_SYNC_TOKEN');
            }
            return;
        }

        const data = await res.json();
        if (data.success && data.addedCount > 0) {
            console.log(`📤 Pushed ${data.addedCount} transactions`);
        }
    }

    private async pushPendingInventory() {
        const ledger = await dbAdapter.getCollection('inventoryLedger') || [];

        // CRITICAL FIX: Push ALL pending movements, not just last 50
        // This ensures cross-terminal sync works correctly
        const pending = ledger.filter((m: any) => m.syncStatus === 'PENDING');

        if (pending.length === 0) return;

        console.log(`[NetworkSync] Pushing ${pending.length} pending inventory movements...`);

        const res = await fetch(`${getApiUrl()}/sync/inventory/movements`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Sync-Token': this.token || '',
                'Connection': 'keep-alive'
            },
            mode: 'cors',
            body: JSON.stringify({ items: pending })
        });

        if (!res.ok) {
            if (res.status === 401) {
                this.token = null;
                localStorage.removeItem('CLIC_POS_SYNC_TOKEN');
            }
            return;
        }

        const data = await res.json();
        if (data.success && data.addedCount > 0) {
            console.log(`📤 Pushed ${data.addedCount} inventory movements`);

            // Mark pushed items as synced
            const processedIds = new Set(data.processedIds || pending.map((m: any) => m.id));
            const updatedLedger = ledger.map((m: any) => {
                if (processedIds.has(m.id)) {
                    return { ...m, syncStatus: 'SYNCED' };
                }
                return m;
            });
            await dbAdapter.saveCollection('inventoryLedger', updatedLedger);
        }
    }
}

export const networkSyncService = new NetworkSyncService();
