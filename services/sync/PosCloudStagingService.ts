import { db } from '../../utils/db';
import { apiSyncAdapter } from './ApiSyncAdapter';
import { syncPolicy } from './SyncProfile';

export interface PosCloudStagingSnapshotResult {
    pushed: Record<string, number>;
    skipped: string[];
    targetKind: string;
    completedAt: string;
}

export const POS_CLOUD_STAGING_PUSH_COLLECTIONS = [
    'products',
    'customers',
    'suppliers',
    'users',
    'roles',
    'warehouses',
    'paymentMethods',
    'collections',
    'serviceTypes',
    'internalSequences',
    'fiscalRanges',
    'fiscalAllocations',
    'localFiscalBuffer',
    'productStocks',
    'productPrices',
    'supplierProductPrices',
    'inventoryTracking',
    'watchlists',
    'campaigns',
    'coupons',
    'rooms',
    'tables',
    'productionAreas'
] as const;

const POS_CLOUD_STAGING_PUSH_SET = new Set<string>(POS_CLOUD_STAGING_PUSH_COLLECTIONS);

export function isPosCloudStagingPushCollection(collection: string): boolean {
    return POS_CLOUD_STAGING_PUSH_SET.has(collection);
}

class PosCloudStagingService {
    async sendSnapshot(reason = 'MANUAL'): Promise<PosCloudStagingSnapshotResult> {
        const target = syncPolicy.resolve();
        if (target.kind !== 'POS_CLOUD_STAGING' || !target.canPushMasters) {
            return {
                pushed: {},
                skipped: [...POS_CLOUD_STAGING_PUSH_COLLECTIONS],
                targetKind: target.kind,
                completedAt: new Date().toISOString(),
            };
        }

        const pushed: Record<string, number> = {};
        const skipped: string[] = [];

        console.log(
            `[POS_CLOUD_STAGING] snapshot start reason=${reason} channel=${target.kind} dataMaster=${target.dataMaster} terminal=${target.terminalId || 'n/a'}`
        );

        for (const collection of POS_CLOUD_STAGING_PUSH_COLLECTIONS) {
            try {
                const data = await db.get(collection as any);
                const items = Array.isArray(data) ? data : [];
                if (items.length === 0) {
                    skipped.push(collection);
                    continue;
                }

                await apiSyncAdapter.push(collection, items, 'BULK_UPDATE', 'UPSERT');
                pushed[collection] = items.length;
            } catch (error) {
                console.warn(`[POS_CLOUD_STAGING] snapshot collection failed collection=${collection}:`, error);
                skipped.push(collection);
            }
        }

        const completedAt = new Date().toISOString();
        try {
            localStorage.setItem('clic_pos_cloud_staging_last_snapshot_at', completedAt);
            localStorage.setItem('clic_pos_cloud_staging_last_snapshot_counts', JSON.stringify(pushed));
        } catch {
            // Non-critical diagnostic cache only.
        }

        console.log(
            `[POS_CLOUD_STAGING] snapshot done pushed=${JSON.stringify(pushed)} skipped=${skipped.join(',') || 'none'}`
        );

        return {
            pushed,
            skipped,
            targetKind: target.kind,
            completedAt,
        };
    }
}

export const posCloudStagingService = new PosCloudStagingService();
