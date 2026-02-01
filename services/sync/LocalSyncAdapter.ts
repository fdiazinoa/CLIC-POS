/**
 * Local Synchronization Adapter
 * 
 * Provides cross-device synchronization using localStorage as a shared communication layer.
 * This adapter enables terminals on the same network to sync data without a backend server.
 * 
 * Architecture:
 * - Master terminal writes catalog updates to localStorage
 * - Slave terminals poll localStorage for changes
 * - Uses timestamp-based change detection
 * - Foundation for future backend migration
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
}

class LocalSyncAdapter {
    private readonly SYNC_PREFIX = 'CLIC_POS_SYNC_';
    private readonly METADATA_PREFIX = 'CLIC_POS_SYNC_META_';

    /**
     * Push changes to shared sync storage (Master → Slaves)
     */
    async push(collection: string, items: any[], action: SyncChange['action'] = 'BULK_UPDATE'): Promise<void> {
        const terminalId = this.getCurrentTerminalId();

        const change: SyncChange = {
            collection,
            action,
            items,
            timestamp: new Date().toISOString(),
            sourceTerminalId: terminalId,
            version: Date.now()
        };

        // Write change to localStorage
        const key = `${this.SYNC_PREFIX}${collection}`;
        localStorage.setItem(key, JSON.stringify(change));

        // Update metadata
        const metadata: SyncMetadata = {
            collection,
            lastSyncedAt: change.timestamp,
            version: change.version,
            itemCount: items.length
        };

        localStorage.setItem(`${this.METADATA_PREFIX}${collection}`, JSON.stringify(metadata));

        console.log(`📤 LocalSyncAdapter: Pushed ${items.length} items to ${collection} (v${change.version})`);

        // Dispatch event for same-browser sync
        window.dispatchEvent(new CustomEvent('syncDataAvailable', {
            detail: { collection, action }
        }));
    }

    /**
     * Pull latest changes from shared sync storage (Slaves ← Master)
     */
    async pull(collection: string, sinceVersion?: number): Promise<any[]> {
        const key = `${this.SYNC_PREFIX}${collection}`;
        const data = localStorage.getItem(key);

        if (!data) {
            console.log(`ℹ️  LocalSyncAdapter: No data found for ${collection}`);
            return [];
        }

        try {
            const change: SyncChange = JSON.parse(data);

            // If version specified, only return if newer
            if (sinceVersion && change.version <= sinceVersion) {
                console.log(`✅ LocalSyncAdapter: ${collection} is up to date (v${sinceVersion})`);
                return [];
            }

            console.log(`📥 LocalSyncAdapter: Pulled ${change.items.length} items from ${collection} (v${change.version})`);
            return change.items;

        } catch (error) {
            console.error(`❌ LocalSyncAdapter: Error pulling ${collection}:`, error);
            return [];
        }
    }

    /**
     * Get metadata for a collection (version, last sync time, etc.)
     */
    async getMetadata(collection: string): Promise<SyncMetadata | null> {
        const key = `${this.METADATA_PREFIX}${collection}`;
        const data = localStorage.getItem(key);

        if (!data) return null;

        try {
            return JSON.parse(data);
        } catch (error) {
            console.error(`Error reading metadata for ${collection}:`, error);
            return null;
        }
    }

    /**
     * Check if new data is available for a collection
     */
    async hasNewData(collection: string, localVersion: number): Promise<boolean> {
        const metadata = await this.getMetadata(collection);
        if (!metadata) return false;

        return metadata.version > localVersion;
    }

    /**
     * Get or create unique terminal ID
     */
    private getCurrentTerminalId(): string {
        let terminalId = localStorage.getItem('CLIC_POS_TERMINAL_ID');
        if (!terminalId) {
            terminalId = `TERM-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            localStorage.setItem('CLIC_POS_TERMINAL_ID', terminalId);
        }
        return terminalId;
    }

    /**
     * Clear all sync data (useful for debugging)
     */
    async clearAllSyncData(): Promise<void> {
        const keys = Object.keys(localStorage);
        const syncKeys = keys.filter(k =>
            k.startsWith(this.SYNC_PREFIX) ||
            k.startsWith(this.METADATA_PREFIX)
        );

        syncKeys.forEach(key => localStorage.removeItem(key));
        console.log(`🧹 Cleared ${syncKeys.length} sync storage keys`);
    }
}

export const localSyncAdapter = new LocalSyncAdapter();
