/**
 * Inventory Sync Service
 * 
 * Handles synchronization of inventory movements from slave terminals to master.
 */

import { apiSyncAdapter } from './ApiSyncAdapter';
import { permissionService } from './PermissionService';
import { InventoryLedgerEntry } from '../../types';
import { isPosSaleActive } from '../../utils/posSaleActivity';

class InventorySyncService {
    private lastStockBalanceMaps = new Map<string, Record<string, number>>();
    private pollInFlight = false;

    private buildStockBalanceCacheKey(productId?: string): string {
        return String(productId || '__ALL__').trim() || '__ALL__';
    }

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
            if (this.pollInFlight || isPosSaleActive()) return;
            this.pollInFlight = true;
            try {
                const movements = await this.pullPendingMovements();

                // Movements remain pending remotely until the ticket becomes idle.
                if (movements.length > 0 && !isPosSaleActive()) {
                    await onNewMovements(movements);
                }
            } catch (error) {
                console.warn('⚠️ Inventory polling iteration failed:', error);
            } finally {
                this.pollInFlight = false;
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

    async fetchStockBalanceMapOnDemand(productId?: string): Promise<Record<string, number>> {
        const cacheKey = this.buildStockBalanceCacheKey(productId);
        const previous = this.lastStockBalanceMaps.get(cacheKey) || {};

        try {
            console.log(`🔍 InventorySync: Fetching stock balance map on-demand${productId ? ` for product ${productId}` : ''}`);
            if (this.shouldReadInventoryFromOperationalSource()) {
                const nextMap = await apiSyncAdapter.pullOperationalStockBalanceMap(productId);
                if (Object.keys(nextMap).length > 0) {
                    this.lastStockBalanceMaps.set(cacheKey, nextMap);
                    return nextMap;
                }
                return previous;
            }

            const balances = await apiSyncAdapter.pullStockBalances();
            const nextMap = balances.reduce((acc: Record<string, number>, entry: any) => {
                const warehouseId = String(entry?.warehouse_id || entry?.warehouseId || '').trim();
                const qtyOnHand = Number(entry?.qty_on_hand ?? entry?.qtyOnHand ?? entry?.quantity ?? entry?.qty ?? entry?.stock ?? entry?.balance);
                if (warehouseId && Number.isFinite(qtyOnHand)) {
                    acc[warehouseId] = qtyOnHand;
                }
                return acc;
            }, {});

            if (Object.keys(nextMap).length > 0) {
                this.lastStockBalanceMaps.set(cacheKey, nextMap);
                return nextMap;
            }

            return previous;
        } catch (error) {
            console.error(`❌ InventorySync: Error fetching stock balance map${productId ? ` for ${productId}` : ''}:`, {
                productId,
                error,
                previous,
            });
            return previous;
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
