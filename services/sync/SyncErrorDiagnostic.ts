import {
    getLastSyncProfilePersistenceDiagnostic,
    loadSyncProfile,
    resolveSyncTarget,
    type ResolvedSyncTarget,
    type SyncProfile,
    type SyncProfileSource
} from './SyncProfile';

export type SyncDiagnosticOperation =
    | 'PULL_MASTERS'
    | 'PULL_CONFIG'
    | 'PUSH_OPERATIONS'
    | 'PUSH_MASTERS'
    | 'REGISTER_TERMINAL';

export type TerminalBindingStatus = 'UNBOUND' | 'BINDING' | 'BOUND' | 'BINDING_ERROR';
export type CatalogSyncStatus = 'IDLE' | 'SYNCING' | 'SYNCED' | 'ERROR';
export type SalesPushStatus = 'DISABLED' | 'LOCKED_UNTIL_ERP_READY' | 'ENABLED';

export interface SyncErrorDiagnostic {
    operation: SyncDiagnosticOperation;
    collection?: string | null;
    resolvedTargetKind: ResolvedSyncTarget['kind'];
    resolvedTarget: Pick<ResolvedSyncTarget,
        | 'baseUrl'
        | 'terminalId'
        | 'useLocalTarget'
        | 'canPullMasters'
        | 'canPushMasters'
        | 'canPushOperations'
        | 'dataMaster'
        | 'customerErpAccess'
        | 'reason'
    >;
    syncProfile: Pick<SyncProfile,
        | 'contractedProduct'
        | 'posRuntime'
        | 'cloudChannel'
        | 'dataMaster'
        | 'cloudSyncEnabled'
        | 'customerErpAccess'
        | 'erpUiEnabled'
        | 'contractSource'
        | 'syncPermissions'
        | 'erpReadyForSales'
        | 'cloudStagingReady'
        | 'erpBaseUrl'
        | 'cloudBaseUrl'
        | 'erpTenantId'
        | 'erpTerminalId'
        | 'localTerminalId'
        | 'masterUrl'
        | 'masterTerminalId'
    >;
    contractSource: SyncProfileSource | 'UNKNOWN';
    existingProfile?: Partial<SyncProfile> | null;
    incomingProfile?: Partial<SyncProfile> | null;
    mismatchDetected?: boolean;
    mismatchFixed?: boolean;
    isMasterCollection?: boolean;
    isOperationCollection?: boolean;
    isCriticalMaster?: boolean;
    skippedReason?: string | null;
    userVisibleSeverity?: 'info' | 'warning' | 'critical';
    blockedByLocalGuard?: boolean;
    guardReason?: string | null;
    terminalBindingStatus: TerminalBindingStatus;
    catalogSyncStatus: CatalogSyncStatus;
    salesPushStatus: SalesPushStatus;
    endpoint?: string | null;
    httpStatus?: number | string | null;
    responseBody?: string | null;
    errorMessage?: string | null;
    errorStack?: string | null;
    timestamp: string;
    appVersion?: string | null;
    deviceId?: string | null;
    tenantId?: string | null;
    terminalId?: string | null;
}

export const SYNC_DIAGNOSTIC_STORAGE_KEY = 'clic_last_sync_error_diagnostic';
export const SYNC_DIAGNOSTIC_EVENT = 'clic:sync-error-diagnostic';
export const TERMINAL_BINDING_STATUS_KEY = 'clic_terminal_binding_status';
export const CATALOG_SYNC_STATUS_KEY = 'clic_catalog_sync_status';

const safeLocalStorageGet = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const safeLocalStorageSet = (key: string, value: string): void => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Diagnostic persistence is non-critical.
    }
};

const sanitizeEndpoint = (endpoint?: string | null): string | null => {
    if (!endpoint) return null;
    try {
        const url = new URL(endpoint);
        ['token', 'sync_token', 'access_token', 'auth', 'authorization'].forEach((key) => {
            if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
        });
        return url.toString();
    } catch {
        return endpoint.replace(/([?&](?:token|sync_token|access_token|auth|authorization)=)[^&]+/gi, '$1[redacted]');
    }
};

const truncateBody = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    return raw.length > 1000 ? `${raw.slice(0, 1000)}…` : raw;
};

const resolveBindingStatus = (): TerminalBindingStatus => {
    const explicit = safeLocalStorageGet(TERMINAL_BINDING_STATUS_KEY) as TerminalBindingStatus | null;
    if (explicit && ['UNBOUND', 'BINDING', 'BOUND', 'BINDING_ERROR'].includes(explicit)) return explicit;
    return safeLocalStorageGet('clic_erp_sync_terminal_id') || safeLocalStorageGet('active_terminal_id')
        ? 'BOUND'
        : 'UNBOUND';
};

const resolveCatalogStatus = (): CatalogSyncStatus => {
    const explicit = safeLocalStorageGet(CATALOG_SYNC_STATUS_KEY) as CatalogSyncStatus | null;
    return explicit && ['IDLE', 'SYNCING', 'SYNCED', 'ERROR'].includes(explicit) ? explicit : 'IDLE';
};

const resolveSalesPushStatus = (target: ResolvedSyncTarget): SalesPushStatus => {
    if (target.canPushOperations) return 'ENABLED';
    if (target.kind === 'ERP_ACTIVE') return 'LOCKED_UNTIL_ERP_READY';
    return 'DISABLED';
};

export const setTerminalBindingDiagnosticStatus = (status: TerminalBindingStatus): void => {
    safeLocalStorageSet(TERMINAL_BINDING_STATUS_KEY, status);
};

export const setCatalogDiagnosticStatus = (status: CatalogSyncStatus): void => {
    safeLocalStorageSet(CATALOG_SYNC_STATUS_KEY, status);
};

export const buildSyncErrorDiagnostic = (input: {
    operation: SyncDiagnosticOperation;
    collection?: string | null;
    endpoint?: string | null;
    httpStatus?: number | string | null;
    responseBody?: unknown;
    error?: unknown;
    contractSource?: SyncProfileSource;
    existingProfile?: Partial<SyncProfile> | null;
    incomingProfile?: Partial<SyncProfile> | null;
    mismatchDetected?: boolean;
    mismatchFixed?: boolean;
    isMasterCollection?: boolean;
    isOperationCollection?: boolean;
    isCriticalMaster?: boolean;
    skippedReason?: string | null;
    userVisibleSeverity?: 'info' | 'warning' | 'critical';
    blockedByLocalGuard?: boolean;
    guardReason?: string | null;
}): SyncErrorDiagnostic => {
    const syncProfile = loadSyncProfile();
    const resolvedTarget = resolveSyncTarget(syncProfile);
    const lastProfileDiagnostic = getLastSyncProfilePersistenceDiagnostic();
    const error = input.error instanceof Error ? input.error : null;

    return {
        operation: input.operation,
        collection: input.collection || null,
        resolvedTargetKind: resolvedTarget.kind,
        resolvedTarget: {
            baseUrl: resolvedTarget.baseUrl,
            terminalId: resolvedTarget.terminalId,
            useLocalTarget: resolvedTarget.useLocalTarget,
            canPullMasters: resolvedTarget.canPullMasters,
            canPushMasters: resolvedTarget.canPushMasters,
            canPushOperations: resolvedTarget.canPushOperations,
            dataMaster: resolvedTarget.dataMaster,
            customerErpAccess: resolvedTarget.customerErpAccess,
            reason: resolvedTarget.reason,
        },
        syncProfile: {
            contractedProduct: syncProfile.contractedProduct,
            posRuntime: syncProfile.posRuntime,
            cloudChannel: syncProfile.cloudChannel,
            dataMaster: syncProfile.dataMaster,
            cloudSyncEnabled: syncProfile.cloudSyncEnabled,
            customerErpAccess: syncProfile.customerErpAccess,
            erpUiEnabled: syncProfile.erpUiEnabled,
            contractSource: syncProfile.contractSource,
            syncPermissions: syncProfile.syncPermissions,
            erpReadyForSales: syncProfile.erpReadyForSales,
            cloudStagingReady: syncProfile.cloudStagingReady,
            erpBaseUrl: syncProfile.erpBaseUrl,
            cloudBaseUrl: syncProfile.cloudBaseUrl,
            erpTenantId: syncProfile.erpTenantId,
            erpTerminalId: syncProfile.erpTerminalId,
            localTerminalId: syncProfile.localTerminalId,
            masterUrl: syncProfile.masterUrl,
            masterTerminalId: syncProfile.masterTerminalId,
        },
        contractSource: input.contractSource || syncProfile.contractSource || lastProfileDiagnostic?.contractSource || 'UNKNOWN',
        existingProfile: input.existingProfile ?? lastProfileDiagnostic?.existingProfile ?? null,
        incomingProfile: input.incomingProfile ?? lastProfileDiagnostic?.incomingProfile ?? null,
        mismatchDetected: input.mismatchDetected ?? lastProfileDiagnostic?.mismatchDetected ?? false,
        mismatchFixed: input.mismatchFixed ?? lastProfileDiagnostic?.mismatchFixed ?? false,
        isMasterCollection: input.isMasterCollection,
        isOperationCollection: input.isOperationCollection,
        isCriticalMaster: input.isCriticalMaster,
        skippedReason: input.skippedReason || null,
        userVisibleSeverity: input.userVisibleSeverity || 'critical',
        blockedByLocalGuard: Boolean(input.blockedByLocalGuard),
        guardReason: input.guardReason || null,
        terminalBindingStatus: resolveBindingStatus(),
        catalogSyncStatus: resolveCatalogStatus(),
        salesPushStatus: resolveSalesPushStatus(resolvedTarget),
        endpoint: sanitizeEndpoint(input.endpoint),
        httpStatus: input.httpStatus ?? null,
        responseBody: truncateBody(input.responseBody),
        errorMessage: error?.message || (typeof input.error === 'string' ? input.error : null),
        errorStack: error?.stack || null,
        timestamp: new Date().toISOString(),
        appVersion: safeLocalStorageGet('clic_pos_app_version') || safeLocalStorageGet('apk_version_name'),
        deviceId: safeLocalStorageGet('pos_device_id') || safeLocalStorageGet('CLIC_POS_DEVICE_ID'),
        tenantId: safeLocalStorageGet('active_tenant_id') || safeLocalStorageGet('clic_tenant_id') || syncProfile.erpTenantId || syncProfile.cloudTenantId || null,
        terminalId: safeLocalStorageGet('active_terminal_id') || safeLocalStorageGet('CLIC_POS_TERMINAL_ID') || syncProfile.erpTerminalId || syncProfile.localTerminalId || null,
    };
};

export const reportSyncErrorDiagnostic = (input: Parameters<typeof buildSyncErrorDiagnostic>[0]): SyncErrorDiagnostic => {
    if (input.collection === 'products') {
        setCatalogDiagnosticStatus('ERROR');
    }

    const diagnostic = buildSyncErrorDiagnostic(input);
    safeLocalStorageSet(SYNC_DIAGNOSTIC_STORAGE_KEY, JSON.stringify(diagnostic, null, 2));

    try {
        console.group('[SYNC_DIAGNOSTIC]');
        console.log(diagnostic);
        console.groupEnd();
    } catch {
        // Ignore console grouping failures in WebViews.
    }

    window.dispatchEvent(new CustomEvent<SyncErrorDiagnostic>(SYNC_DIAGNOSTIC_EVENT, { detail: diagnostic }));
    return diagnostic;
};
