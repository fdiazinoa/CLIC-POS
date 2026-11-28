import type { BusinessConfig, ErpLoyaltyPolicyVersion, LoyaltyConfig } from '../types';
import type { DatabaseAdapter } from '../services/db/DatabaseAdapter';
import type { SyncProfile } from '../services/sync/SyncProfile';
import type { db } from './db';

export const isErpLoyaltyManaged = (profile: Pick<SyncProfile, 'contractedProduct' | 'cloudChannel'>): boolean =>
    profile.contractedProduct === 'POS_ERP' || profile.cloudChannel === 'ERP_ACTIVE';

export type ErpLoyaltyScope = { tenantId: string | null; terminalId: string | null; storeId: string | null };

const bindingStoreKey = 'clic_erp_sync_store_id';
const bindingStoreEvent = 'erpLoyaltyBindingStoreChanged';
const scopeKey = (id: string | null | undefined) => typeof id === 'string' ? id.trim().toLowerCase() : '';

function hasKnownScopeMismatch(policy: ErpLoyaltyPolicyVersion, scope: ErpLoyaltyScope): boolean {
    return (['tenantId', 'terminalId', 'storeId'] as const).some(key => {
        const proven = scopeKey(policy[key]);
        const active = scopeKey(scope[key]);
        return Boolean(proven && active && proven !== active);
    });
}

export function setErpLoyaltyBindingStoreId(storage: Pick<Storage, 'getItem' | 'setItem'>, storeId: string): void {
    const previous = storage.getItem(bindingStoreKey);
    storage.setItem(bindingStoreKey, storeId);
    if (scopeKey(previous) !== scopeKey(storeId) && typeof window !== 'undefined') {
        window.dispatchEvent(new Event(bindingStoreEvent));
    }
}

export function subscribeErpLoyaltyBindingStore(listener: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener(bindingStoreEvent, listener);
    window.addEventListener('storage', listener);
    return () => {
        window.removeEventListener(bindingStoreEvent, listener);
        window.removeEventListener('storage', listener);
    };
}

export function getEffectiveLoyaltyConfig(config: BusinessConfig): LoyaltyConfig | undefined {
    const policy = config.erpLoyaltyPolicyVersion;
    if (!policy || typeof localStorage === 'undefined') return config.loyalty;

    const scope = {
        tenantId: localStorage.getItem('clic_erp_sync_tenant_id'),
        terminalId: localStorage.getItem('clic_erp_sync_terminal_uuid') || localStorage.getItem('clic_erp_sync_terminal_id'),
        storeId: localStorage.getItem(bindingStoreKey),
    };
    return hasKnownScopeMismatch(policy, scope) ? undefined : config.loyalty;
}

export function readErpLoyaltyPolicyVersion(config: BusinessConfig | null, scope: ErpLoyaltyScope): ErpLoyaltyPolicyVersion | undefined {
    const policy = config?.erpLoyaltyPolicyVersion;
    if (!policy || typeof config?.loyalty?.isEnabled !== 'boolean' || !Number.isSafeInteger(policy.version) || policy.version <= 0 || !scopeKey(scope.tenantId) || !scopeKey(scope.terminalId)) return;
    if (scopeKey(policy.tenantId) === scopeKey(scope.tenantId) && scopeKey(policy.terminalId) === scopeKey(scope.terminalId)
        && scopeKey(policy.storeId) === scopeKey(scope.storeId)) return policy;
}

export function preserveErpLoyaltyFromLegacyConfig(current: BusinessConfig | null, incoming: BusinessConfig, scope: ErpLoyaltyScope): BusinessConfig {
    const marker = current?.erpLoyaltyPolicyVersion;
    const previous = marker && readErpLoyaltyPolicyVersion(current, marker);
    const policy = readErpLoyaltyPolicyVersion(current, scope);
    // Keep prior branch evidence until a verified policy for the new branch replaces it.
    if (current && (policy || (previous && hasKnownScopeMismatch(previous, scope)))) {
        return { ...incoming, loyalty: current.loyalty, erpLoyaltyPolicyVersion: previous };
    }
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

export async function updateCurrentBusinessConfig(
    database: Pick<typeof db, 'get' | 'save'>,
    fallback: BusinessConfig,
    update: (current: BusinessConfig) => BusinessConfig,
    notify: (config: BusinessConfig) => void,
): Promise<BusinessConfig | null> {
    return withErpLoyaltyConfigWrite(async () => {
        const persisted = await database.get('config') as unknown as BusinessConfig | null;
        const current = Array.isArray(persisted?.terminals) ? persisted : fallback;
        const next = update(current);
        if (next === current) return null;

        await database.save('config', next);
        notify(next);
        return next;
    });
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
