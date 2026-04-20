/**
 * Inventory Sync Service
 * 
 * Handles synchronization of inventory movements from slave terminals to master.
 */

import { apiSyncAdapter } from './ApiSyncAdapter';
import { permissionService } from './PermissionService';
import { InventoryLedgerEntry } from '../../types';

class InventorySyncService {
    shouldReadInventoryFromOperationalSource(): boolean {
        return apiSyncAdapter.isUsingErpOperationalTarget();
    }

    /**
     * Pull pending inventory movements (Master only)
     */
    async pullPendingMovements(): Promise<InventoryLedgerEntry[]> {
        if (!permissionService.isMasterTerminal()) {
            console.warn('⚠️  Only master terminal can pull inventory movements');
            return [];
        }

        try {
            const movements = await apiSyncAdapter.pullPendingInventoryMovements();

            if (movements.length > 0) {
                console.log(`📥 InventorySync: Pulled ${movements.length} pending movements`);
            }

            return movements;
        } catch (error) {
            console.error('Error pulling inventory movements:', error);
            return [];
        }
    }

    /**
     * Start polling for inventory movements (Master only)
     */
    startInventoryPolling(
        intervalMs: number,
        onNewMovements: (movements: InventoryLedgerEntry[]) => Promise<void>
    ): number {
        if (!permissionService.isMasterTerminal()) {
            return -1;
        }

        const interval = setInterval(async () => {
            const movements = await this.pullPendingMovements();

            if (movements.length > 0) {
                await onNewMovements(movements);
            }
        }, intervalMs);

        console.log(`⏰ Inventory polling started (${intervalMs / 1000}s interval)`);
        return interval as unknown as number;
    }

    /**
     * Fetch Kardex for a specific product on-demand (Slaves only)
     */
    async fetchKardexOnDemand(productId: string): Promise<InventoryLedgerEntry[]> {
        try {
            console.log(`🔍 InventorySync: Fetching Kardex on-demand for product ${productId}`);
            return await apiSyncAdapter.pullKardexOnDemand(productId);
        } catch (error) {
            console.error(`❌ InventorySync: Error fetching Kardex for ${productId}:`, error);
            return [];
        }
    }

    async fetchStockBalancesOnDemand(productId?: string): Promise<any[]> {
        try {
            console.log(`🔍 InventorySync: Fetching stock balances on-demand${productId ? ` for product ${productId}` : ''}`);
            if (this.shouldReadInventoryFromOperationalSource()) {
                return await apiSyncAdapter.pullOperationalStockBalances(productId);
            }
            return await apiSyncAdapter.pullStockBalances();
        } catch (error) {
            console.error(`❌ InventorySync: Error fetching stock balances${productId ? ` for ${productId}` : ''}:`, error);
            return [];
        }
    }

    stopInventoryPolling(intervalId: number) {
        if (intervalId !== -1) {
            clearInterval(intervalId);
            console.log('⏹️  Inventory polling stopped');
        }
    }
}

export const inventorySyncService = new InventorySyncService();
