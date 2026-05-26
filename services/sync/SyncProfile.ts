export type ContractedProduct = 'POS_ONLY' | 'POS_ERP';
export type PosRuntime = 'LOCAL_SQLITE' | 'MASTER' | 'SLAVE';
export type CloudChannel = 'NONE' | 'POS_CLOUD_STAGING' | 'ERP_ACTIVE' | 'POS_MASTER';
export type DataMaster = 'POS' | 'ERP' | 'POS_MASTER';

export interface SyncProfile {
    contractedProduct: ContractedProduct;
    posRuntime: PosRuntime;
    cloudChannel: CloudChannel;
    dataMaster: DataMaster;
    cloudSyncEnabled: boolean;
    customerErpAccess: boolean;
    erpUiEnabled: boolean;
    localTenantId?: string;
    localStoreId?: string;
    localTerminalId?: string;
    cloudBaseUrl?: string;
    erpBaseUrl?: string;
    cloudTenantId?: string;
    erpTenantId?: string;
    erpTerminalId?: string;
    masterUrl?: string;
    masterTerminalId?: string;
    masterReady?: boolean;
    cloudStagingReady?: boolean;
    erpReadyForSales?: boolean;
    readyForErpActivation?: boolean;
    lastCloudPushAt?: string;
    lastActiveErpSyncAt?: string;
    lastReadinessCheckAt?: string;
    lastCatalogPullAt?: string;
}

export interface ResolvedSyncTarget {
    kind: CloudChannel;
    baseUrl?: string;
    terminalId?: string;
    useLocalTarget: boolean;
    canPullMasters: boolean;
    canPushMasters: boolean;
    canPushOperations: boolean;
    dataMaster: DataMaster;
    customerErpAccess: boolean;
    reason?: string;
}

const PROFILE_STORAGE_KEY = 'clic_sync_profile';

const readStorage = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const readBoolean = (keys: string[], fallback = false): boolean => {
    for (const key of keys) {
        const raw = readStorage(key);
        if (raw === null) continue;
        const normalized = raw.trim().toLowerCase();
        if (['true', '1', 'yes', 'si', 'sí', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return fallback;
};

const firstValue = (...values: Array<string | null | undefined>): string | undefined => {
    for (const value of values) {
        const trimmed = String(value || '').trim();
        if (trimmed) return trimmed;
    }
    return undefined;
};

const normalizeBaseUrl = (value?: string | null): string | undefined => {
    const raw = String(value || '').trim();
    if (!raw) return undefined;
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `${window.location.protocol}//${raw}`;
    try {
        return new URL(withProtocol).toString()
            .replace(/\/api\/sync\/?$/i, '')
            .replace(/\/api\/?$/i, '')
            .replace(/\/+$/, '');
    } catch {
        return undefined;
    }
};

const normalizeSyncApiBase = (value?: string | null): string | undefined => {
    const base = normalizeBaseUrl(value);
    return base ? `${base}/api/sync` : undefined;
};

export function loadSyncProfile(): SyncProfile {
    const persisted = readStorage(PROFILE_STORAGE_KEY);
    if (persisted) {
        try {
            const parsed = JSON.parse(persisted) as Partial<SyncProfile>;
            if (parsed && typeof parsed === 'object' && parsed.contractedProduct && parsed.cloudChannel) {
                return normalizeProfile(parsed);
            }
        } catch {
            console.warn('⚠️ SyncProfile: invalid persisted profile, falling back to legacy storage.');
        }
    }

    return inferLegacySyncProfile();
}

export function saveSyncProfile(profile: SyncProfile): void {
    try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalizeProfile(profile)));
    } catch (error) {
        console.warn('⚠️ SyncProfile: could not persist profile:', error);
    }
}

export function inferLegacySyncProfile(): SyncProfile {
    const rawMode = String(readStorage('clic_sync_mode') || '').trim().toUpperCase();
    const erpTerminalId = firstValue(
        readStorage('clic_erp_sync_terminal_id'),
        readStorage('erp_terminal_id')
    );
    const erpBaseUrl = normalizeBaseUrl(firstValue(
        readStorage('CLIC_ERP_BASE_URL'),
        readStorage('erp_base_url'),
        readStorage('CLIC_ERP_SYNC_URL')
    ));
    const erpSyncUrl = normalizeSyncApiBase(erpBaseUrl);
    const masterUrl = normalizeBaseUrl(firstValue(
        readStorage('masterUrl'),
        readStorage('CLIC_POS_MASTER_URL'),
        readStorage('pos_master_ip')
    ));
    const masterTerminalId = firstValue(
        readStorage('masterTerminalId'),
        readStorage('terminalId')
    );
    const explicitErpAccess = readBoolean([
        'clic_customer_erp_access',
        'clic_erp_ui_enabled',
        'CLIC_ERP_ACTIVE',
        'customerErpAccess'
    ], false);
    const cloudSyncEnabled = readBoolean(['clic_cloud_sync_enabled', 'cloud_sync'], Boolean(erpBaseUrl || erpSyncUrl));

    if (rawMode === 'POS_SLAVE' || rawMode === 'SLAVE') {
        return normalizeProfile({
            contractedProduct: 'POS_ONLY',
            posRuntime: 'SLAVE',
            cloudChannel: 'POS_MASTER',
            dataMaster: 'POS_MASTER',
            cloudSyncEnabled: false,
            customerErpAccess: false,
            erpUiEnabled: false,
            masterUrl,
            masterTerminalId,
            masterReady: Boolean(masterUrl && masterTerminalId),
        });
    }

    const isPosErp = rawMode === 'POS_ERP' || explicitErpAccess;
    const contractedProduct: ContractedProduct = isPosErp ? 'POS_ERP' : 'POS_ONLY';
    const cloudChannel: CloudChannel = isPosErp
        ? 'ERP_ACTIVE'
        : (cloudSyncEnabled && erpBaseUrl && erpTerminalId ? 'POS_CLOUD_STAGING' : 'NONE');

    if (erpBaseUrl && erpTerminalId && !isPosErp) {
        console.warn('⚠️ SyncProfile: ERP legacy keys found, but contract is not ERP_ACTIVE. Using POS_CLOUD_STAGING semantics.');
    }

    return normalizeProfile({
        contractedProduct,
        posRuntime: 'MASTER',
        cloudChannel,
        dataMaster: isPosErp ? 'ERP' : 'POS',
        cloudSyncEnabled: cloudChannel !== 'NONE',
        customerErpAccess: isPosErp,
        erpUiEnabled: isPosErp,
        localTenantId: firstValue(readStorage('active_tenant_id'), readStorage('clic_tenant_id')),
        localStoreId: firstValue(readStorage('active_store_id'), readStorage('clic_store_id')),
        localTerminalId: firstValue(readStorage('active_terminal_id'), readStorage('CLIC_POS_TERMINAL_ID')),
        cloudBaseUrl: erpBaseUrl,
        erpBaseUrl,
        cloudTenantId: firstValue(readStorage('clic_cloud_tenant_id'), readStorage('clic_erp_sync_tenant_id')),
        erpTenantId: firstValue(readStorage('clic_erp_sync_tenant_id'), readStorage('erp_tenant_id')),
        erpTerminalId,
        cloudStagingReady: Boolean(!isPosErp && erpBaseUrl && erpTerminalId),
        erpReadyForSales: isPosErp ? readBoolean(['clic_erp_ready_for_sales', 'erpReadyForSales'], false) : false,
    });
}

function normalizeProfile(input: Partial<SyncProfile>): SyncProfile {
    const contractedProduct = input.contractedProduct === 'POS_ERP' ? 'POS_ERP' : 'POS_ONLY';
    const posRuntime: PosRuntime = input.posRuntime === 'SLAVE'
        ? 'SLAVE'
        : input.posRuntime === 'LOCAL_SQLITE'
            ? 'LOCAL_SQLITE'
            : 'MASTER';
    const defaultChannel: CloudChannel = posRuntime === 'SLAVE'
        ? 'POS_MASTER'
        : contractedProduct === 'POS_ERP'
            ? 'ERP_ACTIVE'
            : 'POS_CLOUD_STAGING';
    const cloudChannel = input.cloudChannel || defaultChannel;
    const dataMaster: DataMaster = input.dataMaster || (
        cloudChannel === 'ERP_ACTIVE' ? 'ERP' : cloudChannel === 'POS_MASTER' ? 'POS_MASTER' : 'POS'
    );

    return {
        contractedProduct,
        posRuntime,
        cloudChannel,
        dataMaster,
        cloudSyncEnabled: Boolean(input.cloudSyncEnabled ?? cloudChannel !== 'NONE'),
        customerErpAccess: Boolean(input.customerErpAccess ?? contractedProduct === 'POS_ERP'),
        erpUiEnabled: Boolean(input.erpUiEnabled ?? contractedProduct === 'POS_ERP'),
        localTenantId: input.localTenantId,
        localStoreId: input.localStoreId,
        localTerminalId: input.localTerminalId,
        cloudBaseUrl: normalizeBaseUrl(input.cloudBaseUrl || input.erpBaseUrl),
        erpBaseUrl: normalizeBaseUrl(input.erpBaseUrl || input.cloudBaseUrl),
        cloudTenantId: input.cloudTenantId,
        erpTenantId: input.erpTenantId,
        erpTerminalId: input.erpTerminalId,
        masterUrl: normalizeBaseUrl(input.masterUrl),
        masterTerminalId: input.masterTerminalId,
        masterReady: Boolean(input.masterReady),
        cloudStagingReady: Boolean(input.cloudStagingReady),
        erpReadyForSales: Boolean(input.erpReadyForSales),
        readyForErpActivation: Boolean(input.readyForErpActivation),
        lastCloudPushAt: input.lastCloudPushAt,
        lastActiveErpSyncAt: input.lastActiveErpSyncAt,
        lastReadinessCheckAt: input.lastReadinessCheckAt,
        lastCatalogPullAt: input.lastCatalogPullAt,
    };
}

export function resolveSyncTarget(profile: SyncProfile = loadSyncProfile()): ResolvedSyncTarget {
    if (profile.posRuntime === 'SLAVE' || profile.cloudChannel === 'POS_MASTER') {
        if (!profile.masterUrl || !profile.masterTerminalId) {
            return {
                kind: 'NONE',
                useLocalTarget: true,
                canPullMasters: false,
                canPushMasters: false,
                canPushOperations: false,
                dataMaster: 'POS_MASTER',
                customerErpAccess: false,
                reason: 'POS_MASTER_NOT_CONFIGURED',
            };
        }
        return {
            kind: 'POS_MASTER',
            baseUrl: normalizeSyncApiBase(profile.masterUrl),
            terminalId: profile.masterTerminalId,
            useLocalTarget: true,
            canPullMasters: true,
            canPushMasters: false,
            canPushOperations: true,
            dataMaster: 'POS_MASTER',
            customerErpAccess: false,
        };
    }

    if (profile.contractedProduct === 'POS_ONLY' && profile.cloudChannel === 'NONE') {
        return {
            kind: 'NONE',
            useLocalTarget: true,
            canPullMasters: false,
            canPushMasters: false,
            canPushOperations: false,
            dataMaster: 'POS',
            customerErpAccess: false,
            reason: 'CLOUD_SYNC_DISABLED',
        };
    }

    if (profile.contractedProduct === 'POS_ONLY' && profile.cloudChannel === 'POS_CLOUD_STAGING') {
        const baseUrl = normalizeSyncApiBase(profile.cloudBaseUrl || profile.erpBaseUrl);
        const terminalId = profile.erpTerminalId || profile.localTerminalId;
        if (!baseUrl || !terminalId) {
            return {
                kind: 'NONE',
                useLocalTarget: true,
                canPullMasters: false,
                canPushMasters: false,
                canPushOperations: false,
                dataMaster: 'POS',
                customerErpAccess: false,
                reason: 'POS_CLOUD_STAGING_NOT_CONFIGURED',
            };
        }
        return {
            kind: 'POS_CLOUD_STAGING',
            baseUrl,
            terminalId,
            useLocalTarget: false,
            canPullMasters: false,
            canPushMasters: true,
            canPushOperations: true,
            dataMaster: 'POS',
            customerErpAccess: false,
        };
    }

    if (profile.contractedProduct === 'POS_ERP' && profile.cloudChannel === 'ERP_ACTIVE') {
        const baseUrl = normalizeSyncApiBase(profile.erpBaseUrl || profile.cloudBaseUrl);
        if (!baseUrl || !profile.erpTerminalId) {
            return {
                kind: 'NONE',
                useLocalTarget: true,
                canPullMasters: false,
                canPushMasters: false,
                canPushOperations: false,
                dataMaster: 'ERP',
                customerErpAccess: true,
                reason: 'ERP_ACTIVE_NOT_CONFIGURED',
            };
        }
        if (!profile.erpReadyForSales) {
            return {
                kind: 'ERP_ACTIVE',
                baseUrl,
                terminalId: profile.erpTerminalId,
                useLocalTarget: false,
                canPullMasters: true,
                canPushMasters: false,
                canPushOperations: false,
                dataMaster: 'ERP',
                customerErpAccess: true,
                reason: 'ERP_NOT_READY_FOR_SALES',
            };
        }
        return {
            kind: 'ERP_ACTIVE',
            baseUrl,
            terminalId: profile.erpTerminalId,
            useLocalTarget: false,
            canPullMasters: true,
            canPushMasters: false,
            canPushOperations: true,
            dataMaster: 'ERP',
            customerErpAccess: true,
        };
    }

    return {
        kind: 'NONE',
        useLocalTarget: true,
        canPullMasters: false,
        canPushMasters: false,
        canPushOperations: false,
        dataMaster: profile.dataMaster,
        customerErpAccess: profile.customerErpAccess,
        reason: 'UNSUPPORTED_SYNC_PROFILE',
    };
}

export const syncPolicy = {
    load: loadSyncProfile,
    save: saveSyncProfile,
    resolve: resolveSyncTarget,
    canPullMasters: () => resolveSyncTarget().canPullMasters,
    canPushMasters: () => resolveSyncTarget().canPushMasters,
    targetKind: () => resolveSyncTarget().kind,
};
