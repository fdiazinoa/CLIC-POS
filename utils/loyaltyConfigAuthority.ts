import type { BusinessConfig, ErpLoyaltyPolicyVersion } from '../types';
import type { DatabaseAdapter } from '../services/db/DatabaseAdapter';
import type { SyncProfile } from '../services/sync/SyncProfile';

export const isErpLoyaltyManaged = (profile: Pick<SyncProfile, 'contractedProduct' | 'cloudChannel'>): boolean =>
    profile.contractedProduct === 'POS_ERP' || profile.cloudChannel === 'ERP_ACTIVE';

export type ErpLoyaltyScope = { tenantId: string | null; terminalId: string | null; storeId: string | null };

export function readErpLoyaltyPolicyVersion(config: BusinessConfig | null, scope: ErpLoyaltyScope): ErpLoyaltyPolicyVersion | undefined {
    const policy = config?.erpLoyaltyPolicyVersion;
    const key = (id: string | null | undefined) => typeof id === 'string' ? id.trim().toLowerCase() : '';
    if (!policy || !Number.isSafeInteger(policy.version) || policy.version <= 0 || !key(scope.tenantId) || !key(scope.terminalId)) return;
    if (key(policy.tenantId) === key(scope.tenantId) && key(policy.terminalId) === key(scope.terminalId)
        && (!key(policy.storeId) || !key(scope.storeId) || key(policy.storeId) === key(scope.storeId))) return policy;
}

export function preserveErpLoyaltyFromLegacyConfig(current: BusinessConfig | null, incoming: BusinessConfig, scope: ErpLoyaltyScope): BusinessConfig {
    const policy = readErpLoyaltyPolicyVersion(current, scope);
    if (policy && current) return { ...incoming, loyalty: current.loyalty, erpLoyaltyPolicyVersion: policy };
    if (!incoming.erpLoyaltyPolicyVersion) return incoming;
    const unversioned = { ...incoming };
    delete unversioned.erpLoyaltyPolicyVersion;
    return unversioned;
}

// V2 config writes and delayed HTTP/bootstrap responses must compare and persist in one lane.
let configWriteLane: Promise<unknown> = Promise.resolve();
export function withErpLoyaltyConfigWrite<T>(write: () => Promise<T>): Promise<T> {
    const result = configWriteLane.then(write, write);
    configWriteLane = result.then(() => undefined, () => undefined);
    return result;
}

export async function saveLocalConfigPreservingErpLoyalty(
    database: Pick<DatabaseAdapter, 'getDocument' | 'saveConfigIfUnchanged'>,
    requested: BusinessConfig,
): Promise<BusinessConfig | null> {
    const saveIfUnchanged = database.saveConfigIfUnchanged?.bind(database);
    if (!saveIfUnchanged) return null;

    return withErpLoyaltyConfigWrite(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
            const current = await database.getDocument<BusinessConfig>('config', 'current');
            if (!Array.isArray(current?.terminals)) return null;

            const next = { ...requested, loyalty: current.loyalty, erpLoyaltyPolicyVersion: current.erpLoyaltyPolicyVersion };
            if (await saveIfUnchanged(current, next)) return next;
        }
        return null;
    });
}
