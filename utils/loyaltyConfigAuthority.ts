import type { BusinessConfig } from '../types';
import type { DatabaseAdapter } from '../services/db/DatabaseAdapter';
import type { SyncProfile } from '../services/sync/SyncProfile';

export const isErpLoyaltyManaged = (profile: Pick<SyncProfile, 'contractedProduct' | 'cloudChannel'>): boolean =>
    profile.contractedProduct === 'POS_ERP' || profile.cloudChannel === 'ERP_ACTIVE';

export async function saveLocalConfigPreservingErpLoyalty(
    database: Pick<DatabaseAdapter, 'getDocument' | 'saveConfigIfUnchanged'>,
    requested: BusinessConfig,
): Promise<BusinessConfig | null> {
    if (!database.saveConfigIfUnchanged) return null;

    for (let attempt = 0; attempt < 2; attempt++) {
        const current = await database.getDocument<BusinessConfig>('config', 'current');
        if (!Array.isArray(current?.terminals)) return null;

        const next = { ...requested, loyalty: current.loyalty };
        if (await database.saveConfigIfUnchanged(current, next)) return next;
    }
    return null;
}
