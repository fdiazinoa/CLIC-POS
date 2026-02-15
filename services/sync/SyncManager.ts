/**
 * Sync Manager
 * 
 * Orchestrates all synchronization operations between master and slave terminals.
 * Manages catalog distribution (Master → Slaves) and operational data collection (Slaves → Master).
 */

import { db } from '../../utils/db';
import { dbAdapter } from '../db';
import { apiSyncAdapter, SyncMetadata } from './ApiSyncAdapter';
import { permissionService } from './PermissionService';
import { Product, Customer, Supplier, DocumentSeries, BusinessConfig, SyncConfig } from '../../types';

export type SyncableCollection = 'products' | 'customers' | 'suppliers' | 'users' | 'roles' | 'internalSequences' | 'inventoryLedger' | 'transactions' | 'zReports' | 'cashMovements' | 'productStocks' | 'transfers' | 'receptions' | 'purchaseOrders' | 'supplierProductPrices';

interface SyncStatus {
    collection: string;
    lastSyncedAt: string | null;
    localVersion: number;
    remoteVersion: number | null;
    lastSyncTimestamp?: string | null;
    status: 'SYNCED' | 'PENDING' | 'ERROR';
    error?: string;
}

class SyncManager {
    private autoSyncInterval: any = null;
    private syncVersions: Map<string, number> = new Map();
    private syncTimestamps: Map<string, string> = new Map();
    private syncConfig: SyncConfig | null = null;
    private isMaster: boolean = false;
    private isDisabled: boolean = false;

    /**
     * Initialize sync manager
     */
    async initialize(config: BusinessConfig, terminalId: string) {
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

        // Fallback: Check for 'pos_master_ip' (set by TerminalBindingScreen)
        if (!savedMasterUrl) {
            const legacyIp = localStorage.getItem('pos_master_ip');
            if (legacyIp) {
                // Assume standard port 3001 or infer from location if local
                savedMasterUrl = `http://${legacyIp}:3001`;
                console.log(`ℹ️ SyncManager: Inferred Master URL from IP: ${savedMasterUrl}`);
            }
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
            const masterUrl = this.syncConfig.masterUrl || 'http://localhost:3001';

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

        // If Master, try to restore data from server if local is empty (HTTPS switch scenario)
        if (this.isMaster) {
            await this.initializeMasterData();
        }

        console.log('🔄 SyncManager initialized');
    }

    /**
     * Restore Master data from Server if local is empty
     * This handles the case where Master storage is wiped (e.g. new origin) but Server has data.
     */
    private async initializeMasterData() {
        const collections: SyncableCollection[] = ['internalSequences', 'products', 'customers', 'suppliers'];

        for (const collection of collections) {
            const localData = await db.get(collection);
            const isEmpty = !localData || (Array.isArray(localData) && localData.length === 0);

            // Also check if it only contains defaults (for sequences)
            // If we have very few items, we might want to check server
            const isMinimal = Array.isArray(localData) && localData.length <= 3;

            if (isEmpty || isMinimal) {
                console.log(`🔍 Master Init: Local ${collection} is empty/minimal. Checking server...`);
                try {
                    // Force pull to see if server has data
                    const serverItems = await apiSyncAdapter.pull(collection);
                    if (serverItems && serverItems.length > (localData?.length || 0)) {
                        console.log(`📥 Master Init: Restoring ${serverItems.length} items from Server for ${collection}`);
                        await db.save(collection, serverItems);

                        // Update version
                        const metadata = await apiSyncAdapter.getMetadata(collection);
                        if (metadata) {
                            this.syncVersions.set(collection, metadata.version);
                        }
                    }
                } catch (error) {
                    console.warn(`⚠️ Master Init: Could not restore ${collection} from server:`, error);
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
        const collections: (SyncableCollection | 'config')[] = ['products', 'customers', 'suppliers', 'users', 'roles', 'internalSequences', 'config'];

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

        try {
            const data = await db.get(collection);
            const items = Array.isArray(data) ? data : [];

            // Push to server API
            await apiSyncAdapter.push(collection, items, 'BULK_UPDATE', 'FULL_REPLACE');

            // Update local version tracking
            const metadata = await apiSyncAdapter.getMetadata(collection);
            if (metadata) {
                this.syncVersions.set(collection, metadata.version);
            }

            console.log(`✅ SyncManager: Pushed ${items.length} items from ${collection}`);
        } catch (error: any) {
            if (error.message === 'Cannot push while offline') {
                console.warn(`⚠️ SyncManager: Pushing ${collection} deferred (Offline)`);
            } else {
                console.error(`❌ SyncManager: Error pushing ${collection}:`, error);
            }
            throw error;
        }
    }

    async pullCatalog(collection: SyncableCollection): Promise<number> {
        if (this.isDisabled) return 0;

        const lastVersion = this.syncVersions.get(collection) || 0;
        console.log(`🔽 SyncManager.pullCatalog('${collection}') - Last Version: ${lastVersion}`);

        try {
            // Pull Delta from API
            const response = await apiSyncAdapter.pullDelta(collection, lastVersion || undefined);
            const { items, serverTime, isFullDownload, latestVersion } = response;

            console.log(`📦 SyncManager: Received ${items.length} items for ${collection} (${isFullDownload ? 'Full' : 'Delta'})`);

            if (items.length === 0 && !isFullDownload) {
                console.log(`ℹ️  SyncManager: No updates for ${collection}`);
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
                const cleanItems = items.map((item: any) => {
                    const { _op, ...rest } = item;
                    // Add repair logic for internalSequences
                    if (collection === 'internalSequences') {
                        return this.repairSequenceData(rest);
                    }
                    return rest;
                });
                await db.save(collection, cleanItems);
            } else {
                // Incremental update (Upsert / Delete)
                console.log(`💾 SyncManager: Performing INCREMENTAL update for ${collection}...`);
                for (const item of items) {
                    const op = item._op;
                    const { _op, ...cleanItem } = item;
                    if (op === 'DELETE' || item.deletedAt || item.isActive === false) {
                        console.log(`🗑️ SyncManager: Deleting item ${item.id} from ${collection}`);
                        await db.deleteDocument(collection, item.id);
                    } else {
                        // Add repair logic for internalSequences
                        const finalItem = collection === 'internalSequences' ? this.repairSequenceData(cleanItem) : cleanItem;
                        await db.saveDocument(collection, finalItem);
                    }
                }
            }

            // CRITICAL: If we just pulled inventory ledger entries, we MUST recalculate stock
            // for all affected products to ensure "Unidades en Red" and "Existencias" are correct.
            // NOTE: We skip this on SLAVE terminals because they rely on pre-calculated stock from Master.
            if (collection === 'inventoryLedger' && items.length > 0 && !permissionService.isSlaveTerminal()) {
                console.log(`🔄 SyncManager: Recalculating stock for ${items.length} ledger entries...`);
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

            console.log(`✅ SyncManager: Pulled ${items.length} items for ${collection}. New version: ${newVersion ?? 'unknown'}`);

            // Dispatch event for UI to refresh
            window.dispatchEvent(new CustomEvent(`${collection}Updated`));
            if (collection === 'internalSequences') {
                window.dispatchEvent(new CustomEvent('seriesUpdated'));
            }

            return items.length;
        } catch (error) {
            console.error(`❌ SyncManager: Error pulling ${collection}:`, error);
            throw error;
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
        const catalogs: SyncableCollection[] = [
            'products',
            'customers',
            'suppliers',
            'users',
            'roles',
            'internalSequences',
            'productStocks',
            ...(isMaster ? ['inventoryLedger' as SyncableCollection] : []),
            'transfers',
            'receptions'
        ];

        // Operations: Master PULLS, Slaves PUSH (via separate methods, but we sync here for visibility)
        const operations: SyncableCollection[] = ['inventoryLedger', 'zReports'];

        const results: SyncStatus[] = [];

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
                // Always PULL to get updates from Server/Other Terminals
                // (Master pushes changes via broadcastChange immediately)
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

        // 2. Sync Operations (Master Only - PULL)
        if (permissionService.isMasterTerminal()) {
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

        return results;
    }

    /**
     * Check for catalog updates without pulling
     */
    async checkForUpdates(): Promise<string[]> {
        const collections: SyncableCollection[] = [
            'products',
            'customers',
            'suppliers',
            'users',
            'roles',
            'internalSequences',
            'productStocks',
            'transfers',
            'receptions'
        ];
        const updatesAvailable: string[] = [];

        for (const collection of collections) {
            const localVersion = this.syncVersions.get(collection) || 0;
            const hasNew = await apiSyncAdapter.hasNewData(collection, localVersion);

            // CRITICAL: Also check if local collection is empty. 
            // This handles the case where remote version is 0 but server has data (Slave first pull).
            const localData = await db.get(collection);
            const isEmpty = !localData || (Array.isArray(localData) && localData.length === 0);

            if (hasNew || (isEmpty && localVersion === 0)) {
                updatesAvailable.push(collection);
            }
        }

        // Config is a singleton object. Slaves must also track updates for terminal assignments.
        if (!permissionService.isMasterTerminal()) {
            const localVersion = this.syncVersions.get('config') || 0;
            const hasNewConfig = await apiSyncAdapter.hasNewData('config', localVersion);
            const localConfig = await db.get('config');
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

        // Define modules to sync
        const modules = [
            { id: 'config', label: 'Configuración Global (Tarifas)' },
            { id: 'products', label: 'Catálogo de Productos' },
            { id: 'customers', label: 'Base de Clientes' },
            { id: 'suppliers', label: 'Proveedores' },
            { id: 'users', label: 'Operadores de Sistema' },
            { id: 'roles', label: 'Roles y Permisos' },
            { id: 'internalSequences', label: 'Secuencias de Documentos' },
        ];

        if (permissionService.isMasterTerminal()) {
            modules.push(
                { id: 'transactions', label: 'Historial de Ventas' },
                { id: 'zReports', label: 'Cierres de Caja (Z)' },
                { id: 'inventoryLedger', label: 'Movimientos de Inventario' },
                { id: 'cashMovements', label: 'Movimientos de Efectivo' }
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
                // Update UI: Error
                window.dispatchEvent(new CustomEvent('syncProgress', {
                    detail: { id: module.id, status: 'ERROR', message: error.message || 'Error desconocido' }
                }));
            }
        }

        console.log('✅ Force pull process finished');
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
            const localConfig = await db.get('config');
            const metadata = await apiSyncAdapter.getMetadata('config');
            const remoteVersion = metadata?.version;

            console.log('⬇️ Pulling global configuration...');
            const config = await apiSyncAdapter.pullConfig();
            if (!config) return;

            const localConfigJson = JSON.stringify(localConfig || {});
            const incomingConfigJson = JSON.stringify(config || {});
            const changed = force || localConfigJson !== incomingConfigJson;

            if (!changed) {
                if (typeof remoteVersion === 'number') {
                    this.syncVersions.set('config', remoteVersion);
                    localStorage.setItem('sync_version_config', remoteVersion.toString());
                }
                return;
            }

            console.log('💾 Saving global configuration...');
            await db.save('config', config);

            const finalVersion = (typeof remoteVersion === 'number')
                ? remoteVersion
                : Math.max(localVersion + 1, 1);
            this.syncVersions.set('config', finalVersion);
            localStorage.setItem('sync_version_config', finalVersion.toString());

            console.log('✅ Global configuration saved.');

            // Notify runtime so the app can apply it immediately without restart.
            window.dispatchEvent(new CustomEvent('configUpdated', { detail: config }));
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
            const localData = await db.get(collection);
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

    /**
     * Start automatic sync (for slave terminals)
     */
    startAutoSync(intervalMs: number = 30000) {
        if (this.isDisabled) return;

        if (this.autoSyncInterval) {
            this.stopAutoSync();
        }

        this.autoSyncInterval = setInterval(async () => {
            // Auto-sync for ALL terminals (including Master w/ LocalStorage)
            // console.log('🔄 Auto-sync: Checking for updates...');
            if (!permissionService.isMasterTerminal()) {
                try {
                    await this.pullConfig();
                } catch (error) {
                    console.warn('⚠️ Auto-sync: Failed to refresh config:', error);
                }
            }

            const updates = await this.checkForUpdates();

            if (updates.length > 0) {
                console.log(`📥 Auto-sync: Found updates for ${updates.join(', ')}`);
                await this.syncAllCatalogs();
            }
        }, intervalMs);

        console.log(`⏰ Auto-sync started (${intervalMs / 1000}s interval)`);
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

        console.log(`🔄 Updating Master URL to: ${url}`);

        // Save to localStorage for persistence
        localStorage.setItem('CLIC_POS_MASTER_URL', url);

        if (this.syncConfig) {
            this.syncConfig.masterUrl = url;
        }

        await apiSyncAdapter.initialize({
            masterUrl: url,
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
            const collections: SyncableCollection[] = ['products', 'customers', 'suppliers', 'internalSequences'];
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
    /**
     * Repair missing documentType in sequence data (Legacy/Imported Fix)
     */
    private repairSequenceData(item: any): any {
        if (item.documentType) return item;

        console.log(`🛠️ SyncManager: Repairing missing documentType for sequence ${item.id} (${item.prefix})`);

        // Match by ID first (Defaults)
        if (item.id === 'TICKET') return { ...item, documentType: 'TICKET' };
        if (item.id === 'REFUND') return { ...item, documentType: 'REFUND' };
        if (item.id === 'TRANSFER') return { ...item, documentType: 'TRANSFER' };
        if (item.id === 'VOID') return { ...item, documentType: 'VOID' };

        // Match by Prefix
        const prefix = item.prefix || '';
        if (prefix.startsWith('TCK')) return { ...item, documentType: 'TICKET' };
        if (prefix.startsWith('NC') || prefix.startsWith('REF')) return { ...item, documentType: 'REFUND' };
        if (prefix.startsWith('TR')) return { ...item, documentType: 'TRANSFER' };
        if (prefix.startsWith('VOID')) return { ...item, documentType: 'VOID' };
        if (prefix.startsWith('AJ')) return { ...item, documentType: 'ADJUSTMENT_IN' };
        if (prefix.startsWith('CR') || prefix.startsWith('CK')) return { ...item, documentType: 'Z_REPORT' };
        if (prefix.startsWith('XP')) return { ...item, documentType: 'X_REPORT' };

        // Fallback for everything else
        return { ...item, documentType: 'TICKET' };
    }
}

export const syncManager = new SyncManager();
