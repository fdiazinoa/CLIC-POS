export type ContractedProduct = 'POS_ONLY' | 'POS_ERP';
export type PosRuntime = 'LOCAL_SQLITE' | 'MASTER' | 'SLAVE';
export type CloudChannel = 'NONE' | 'POS_CLOUD_STAGING' | 'ERP_ACTIVE' | 'POS_MASTER';
export type DataMaster = 'POS' | 'ERP' | 'POS_MASTER';
export type SyncProfileSource = 'CLOUD_ADMIN' | 'ERP_REGISTER' | 'LOCAL_SNAPSHOT' | 'LEGACY_LOCAL_STORAGE';

export interface SyncPermissions {
    canPullMasters?: boolean;
    canPushMasters?: boolean;
    canPushOperations?: boolean;
    pullConfig?: boolean;
    pushMasters?: boolean;
    pushOperations?: boolean;
    [key: string]: unknown;
}

export interface SyncProfile {
    contractedProduct: ContractedProduct;
    posRuntime: PosRuntime;
    cloudChannel: CloudChannel;
    dataMaster: DataMaster;
    cloudSyncEnabled: boolean;
    customerErpAccess: boolean;
    erpUiEnabled: boolean;
    contractSource?: SyncProfileSource;
    syncPermissions?: SyncPermissions;
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

export interface SyncProfilePersistenceDiagnostic {
    contractSource: SyncProfileSource;
    existingProfile: SyncProfile | null;
    incomingProfile: SyncProfile;
    savedProfile: SyncProfile;
    mismatchDetected: boolean;
    mismatchFixed: boolean;
    fixedAt: string;
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
const PROFILE_MISMATCH_STORAGE_KEY = 'clic_last_sync_profile_mismatch';

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
                const normalized = normalizeProfile(parsed);
                const rawMode = String(readStorage('clic_sync_mode') || '').trim().toUpperCase();
                if (rawMode === 'POS_ERP' && normalized.contractedProduct !== 'POS_ERP') {
                    const corrected = normalizeProfile({
                        ...normalized,
                        contractedProduct: 'POS_ERP',
                        cloudChannel: 'ERP_ACTIVE',
                        dataMaster: 'ERP',
                        customerErpAccess: true,
                        erpUiEnabled: true,
                        contractSource: normalized.contractSource || 'LEGACY_LOCAL_STORAGE',
                    });
                    console.warn('[SYNC_PROFILE_MISMATCH_FIXED]', {
                        reason: 'LEGACY_PROFILE_CONFLICTS_WITH_POS_ERP_MODE',
                        existingProfile: normalized,
                        incomingProfile: corrected,
                        savedProfile: corrected,
                    });
                    saveSyncProfile(corrected);
                    writeProfileMismatchDiagnostic({
                        contractSource: corrected.contractSource || 'LEGACY_LOCAL_STORAGE',
                        existingProfile: normalized,
                        incomingProfile: corrected,
                        savedProfile: corrected,
                        mismatchDetected: true,
                        mismatchFixed: true,
                        fixedAt: new Date().toISOString(),
                    });
                    return corrected;
                }
                return normalized;
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

const writeProfileMismatchDiagnostic = (diagnostic: SyncProfilePersistenceDiagnostic): void => {
    try {
        localStorage.setItem(PROFILE_MISMATCH_STORAGE_KEY, JSON.stringify(diagnostic, null, 2));
    } catch {
        // Diagnostic persistence is best-effort only.
    }
};

export function getLastSyncProfilePersistenceDiagnostic(): SyncProfilePersistenceDiagnostic | null {
    const raw = readStorage(PROFILE_MISMATCH_STORAGE_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as SyncProfilePersistenceDiagnostic;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

const hasProfileMismatch = (existingProfile: SyncProfile | null, incomingProfile: SyncProfile): boolean => {
    if (!existingProfile) return false;

    return (
        existingProfile.contractedProduct !== incomingProfile.contractedProduct ||
        existingProfile.cloudChannel !== incomingProfile.cloudChannel ||
        existingProfile.dataMaster !== incomingProfile.dataMaster ||
        existingProfile.customerErpAccess !== incomingProfile.customerErpAccess ||
        existingProfile.erpUiEnabled !== incomingProfile.erpUiEnabled ||
        (incomingProfile.contractedProduct === 'POS_ERP' && existingProfile.cloudChannel === 'POS_CLOUD_STAGING')
    );
};

export function saveSyncProfileFromContract(
    incoming: Partial<SyncProfile>,
    contractSource: SyncProfileSource
): SyncProfilePersistenceDiagnostic {
    let existingProfile: SyncProfile | null = null;
    try {
        existingProfile = loadSyncProfile();
    } catch {
        existingProfile = null;
    }

    const incomingProfile = normalizeProfile({
        ...incoming,
        contractSource,
    });
    const mismatchDetected = hasProfileMismatch(existingProfile, incomingProfile);

    saveSyncProfile(incomingProfile);

    const diagnostic: SyncProfilePersistenceDiagnostic = {
        contractSource,
        existingProfile,
        incomingProfile,
        savedProfile: incomingProfile,
        mismatchDetected,
        mismatchFixed: mismatchDetected,
        fixedAt: new Date().toISOString(),
    };

    if (mismatchDetected) {
        console.warn('[SYNC_PROFILE_MISMATCH_FIXED]', {
            contractSource,
            existingProfile,
            incomingProfile,
            savedProfile: incomingProfile,
        });
    }

    writeProfileMismatchDiagnostic(diagnostic);
    return diagnostic;
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
            contractSource: 'LEGACY_LOCAL_STORAGE',
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
        contractSource: 'LEGACY_LOCAL_STORAGE',
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
    const cloudChannel: CloudChannel = posRuntime === 'SLAVE'
        ? 'POS_MASTER'
        : contractedProduct === 'POS_ERP'
            ? 'ERP_ACTIVE'
            : input.cloudChannel || defaultChannel;
    const dataMaster: DataMaster = contractedProduct === 'POS_ERP' && cloudChannel === 'ERP_ACTIVE'
        ? 'ERP'
        : cloudChannel === 'POS_MASTER'
            ? 'POS_MASTER'
            : input.dataMaster || 'POS';

    return {
        contractedProduct,
        posRuntime,
        cloudChannel,
        dataMaster,
        cloudSyncEnabled: Boolean(input.cloudSyncEnabled ?? cloudChannel !== 'NONE'),
        customerErpAccess: contractedProduct === 'POS_ERP' ? true : Boolean(input.customerErpAccess),
        erpUiEnabled: contractedProduct === 'POS_ERP' ? true : Boolean(input.erpUiEnabled),
        contractSource: input.contractSource,
        syncPermissions: input.syncPermissions,
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
        cloudStagingReady: contractedProduct === 'POS_ERP' ? false : Boolean(input.cloudStagingReady),
        erpReadyForSales: Boolean(input.erpReadyForSales),
        readyForErpActivation: Boolean(input.readyForErpActivation),
        lastCloudPushAt: input.lastCloudPushAt,
        lastActiveErpSyncAt: input.lastActiveErpSyncAt,
        lastReadinessCheckAt: input.lastReadinessCheckAt,
        lastCatalogPullAt: input.lastCatalogPullAt,
    };
}

export function resolveSyncTarget(profile: SyncProfile = loadSyncProfile()): ResolvedSyncTarget {
    const activeProfile = normalizeProfile(profile);

    if (activeProfile.posRuntime === 'SLAVE' || activeProfile.cloudChannel === 'POS_MASTER') {
        if (!activeProfile.masterUrl || !activeProfile.masterTerminalId) {
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
            baseUrl: normalizeSyncApiBase(activeProfile.masterUrl),
            terminalId: activeProfile.masterTerminalId,
            useLocalTarget: true,
            canPullMasters: true,
            canPushMasters: false,
            canPushOperations: true,
            dataMaster: 'POS_MASTER',
            customerErpAccess: false,
        };
    }

    if (activeProfile.contractedProduct === 'POS_ERP') {
        const baseUrl = normalizeSyncApiBase(activeProfile.erpBaseUrl || activeProfile.cloudBaseUrl);
        if (!baseUrl || !activeProfile.erpTerminalId) {
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

        return {
            kind: 'ERP_ACTIVE',
            baseUrl,
            terminalId: activeProfile.erpTerminalId,
            useLocalTarget: false,
            canPullMasters: true,
            canPushMasters: false,
            canPushOperations: Boolean(activeProfile.erpReadyForSales),
            dataMaster: 'ERP',
            customerErpAccess: true,
            reason: activeProfile.erpReadyForSales ? undefined : 'ERP_NOT_READY_FOR_SALES',
        };
    }

    if (activeProfile.contractedProduct === 'POS_ONLY' && activeProfile.cloudChannel === 'NONE') {
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

    if (activeProfile.contractedProduct === 'POS_ONLY' && activeProfile.cloudChannel === 'POS_CLOUD_STAGING') {
        const baseUrl = normalizeSyncApiBase(activeProfile.cloudBaseUrl || activeProfile.erpBaseUrl);
        const terminalId = activeProfile.erpTerminalId || activeProfile.localTerminalId;
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

    return {
        kind: 'NONE',
        useLocalTarget: true,
        canPullMasters: false,
        canPushMasters: false,
        canPushOperations: false,
        dataMaster: activeProfile.dataMaster,
        customerErpAccess: activeProfile.customerErpAccess,
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
