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

export type TerminalBindingStatus = 'UNBOUND' | 'BINDING' | 'BOUND' | 'BOUND_AUTH_MISMATCH' | 'BINDING_ERROR' | 'TOKEN_INVALID';
export type CatalogSyncStatus = 'IDLE' | 'SYNCING' | 'SYNCED' | 'ERROR' | 'AUTH_ERROR' | 'FISCAL_CONFIG_MISSING' | 'ERP_MASTER_PULL_FAILED';
export type SalesPushStatus = 'DISABLED' | 'LOCKED_UNTIL_ERP_READY' | 'LOCKED_AUTH_REQUIRED' | 'LOCKED_FISCAL_CONFIG_REQUIRED' | 'LOCKED_MASTER_SYNC_REQUIRED' | 'ENABLED';

export interface SyncRequestAuthDiagnostic {
    authorizationPresent: boolean;
    syncTokenPresent: boolean;
    syncTokenPreview?: string | null;
    terminalIdHeaderPresent: boolean;
    deviceIdHeaderPresent: boolean;
}

export interface SyncFetchDiagnostic {
    fetchStage?: 'PREPARE_HEADERS' | 'PREFLIGHT' | 'PREFLIGHT_FAILED' | 'FETCH_SENT' | 'FETCH_FAILED' | 'RESPONSE_RECEIVED' | 'RESPONSE_PARSED' | string;
    networkEngine?: 'capacitor-http' | 'fetch' | string;
    method?: string | null;
    headersPresent?: {
        authorization?: boolean;
        xSyncToken?: boolean;
        xTerminalId?: boolean;
        xDeviceId?: boolean;
        xDeviceToken?: boolean;
    };
    tokenPresent?: boolean;
    tokenPreview?: string | null;
    tokenLength?: number | null;
    tokenSource?: string | null;
    tokenUpdatedAt?: string | null;
    endpoint?: string | null;
    contractSource?: string | null;
    profileSourcePriority?: number | null;
    bodySize?: number | null;
    contentType?: string | null;
    networkOnline?: boolean | null;
    navigatorUserAgent?: string | null;
    platform?: string | null;
    capacitorPlatform?: string | null;
    origin?: string | null;
    errorName?: string | null;
    errorMessage?: string | null;
    errorCause?: string | null;
    corsExpectedHeaders?: string[];
}

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
    | 'profileSourcePriority'
    >;
    contractSource: SyncProfileSource | 'UNKNOWN';
    profileSourcePriority?: number;
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
    requestSkippedReason?: string | null;
    requestAuth?: SyncRequestAuthDiagnostic | null;
    authStatus?: string | null;
    backendCode?: string | null;
    debugId?: string | null;
    nextAction?: string | null;
    fetchDiagnostic?: SyncFetchDiagnostic | null;
    fetchStage?: string | null;
    networkEngine?: string | null;
    httpMethod?: string | null;
    networkOnline?: boolean | null;
    capacitorPlatform?: string | null;
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
export const SALES_PUSH_STATUS_KEY = 'clic_sales_push_status';
export const SYNC_AUTH_STATUS_KEY = 'clic_sync_auth_status';

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
    if (explicit && ['UNBOUND', 'BINDING', 'BOUND', 'BOUND_AUTH_MISMATCH', 'BINDING_ERROR', 'TOKEN_INVALID'].includes(explicit)) return explicit;
    return safeLocalStorageGet('clic_erp_sync_terminal_id') || safeLocalStorageGet('active_terminal_id')
        ? 'BOUND'
        : 'UNBOUND';
};

const resolveCatalogStatus = (): CatalogSyncStatus => {
    const explicit = safeLocalStorageGet(CATALOG_SYNC_STATUS_KEY) as CatalogSyncStatus | null;
    return explicit && ['IDLE', 'SYNCING', 'SYNCED', 'ERROR', 'AUTH_ERROR', 'FISCAL_CONFIG_MISSING', 'ERP_MASTER_PULL_FAILED'].includes(explicit) ? explicit : 'IDLE';
};

const resolveSalesPushStatus = (target: ResolvedSyncTarget): SalesPushStatus => {
    const explicit = safeLocalStorageGet(SALES_PUSH_STATUS_KEY) as SalesPushStatus | null;
    if (explicit && ['DISABLED', 'LOCKED_UNTIL_ERP_READY', 'LOCKED_AUTH_REQUIRED', 'LOCKED_FISCAL_CONFIG_REQUIRED', 'LOCKED_MASTER_SYNC_REQUIRED', 'ENABLED'].includes(explicit)) return explicit;
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

export const clearSyncErrorDiagnostic = (): void => {
    try {
        localStorage.removeItem(SYNC_DIAGNOSTIC_STORAGE_KEY);
    } catch {
        // Ignore storage failures in WebViews.
    }

    try {
        window.dispatchEvent(new CustomEvent(SYNC_DIAGNOSTIC_EVENT, { detail: null }));
    } catch {
        // Ignore event dispatch failures in WebViews.
    }
};

export const isRecoverableStaleSyncDiagnostic = (
    diagnostic: SyncErrorDiagnostic | null | undefined,
): boolean => {
    if (!diagnostic?.errorMessage) return false;

    const message = diagnostic.errorMessage.trim().toLowerCase();
    if (!message.startsWith('chain validation failed')) return false;

    const bindingStatus = safeLocalStorageGet(TERMINAL_BINDING_STATUS_KEY);
    if (bindingStatus === 'BOUND') return true;

    return Boolean(
        safeLocalStorageGet('clic_erp_sync_terminal_id')
        || safeLocalStorageGet('active_terminal_id')
    );
};

export const setSalesPushDiagnosticStatus = (status: SalesPushStatus): void => {
    safeLocalStorageSet(SALES_PUSH_STATUS_KEY, status);
};

export const setSyncAuthDiagnosticStatus = (status: string): void => {
    safeLocalStorageSet(SYNC_AUTH_STATUS_KEY, status);
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
    requestSkippedReason?: string | null;
    requestAuth?: SyncRequestAuthDiagnostic | null;
    authStatus?: string | null;
    backendCode?: string | null;
    debugId?: string | null;
    nextAction?: string | null;
    fetchDiagnostic?: SyncFetchDiagnostic | null;
}): SyncErrorDiagnostic => {
    const syncProfile = loadSyncProfile();
    const resolvedTarget = resolveSyncTarget(syncProfile);
    const lastProfileDiagnostic = getLastSyncProfilePersistenceDiagnostic();
    const error = input.error instanceof Error ? input.error : null;
    const attachedFetchDiagnostic = input.fetchDiagnostic || (input.error && typeof input.error === 'object'
        ? ((input.error as any).__syncFetchDiagnostic as SyncFetchDiagnostic | undefined)
        : undefined);

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
            profileSourcePriority: syncProfile.profileSourcePriority,
        },
        contractSource: input.contractSource || syncProfile.contractSource || lastProfileDiagnostic?.contractSource || 'UNKNOWN',
        profileSourcePriority: syncProfile.profileSourcePriority ?? lastProfileDiagnostic?.profileSourcePriority,
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
        requestSkippedReason: input.requestSkippedReason || null,
        requestAuth: input.requestAuth || null,
        authStatus: input.authStatus || safeLocalStorageGet(SYNC_AUTH_STATUS_KEY),
        backendCode: input.backendCode || null,
        debugId: input.debugId || null,
        nextAction: input.nextAction || null,
        fetchDiagnostic: attachedFetchDiagnostic || null,
        fetchStage: attachedFetchDiagnostic?.fetchStage || null,
        networkEngine: attachedFetchDiagnostic?.networkEngine || null,
        httpMethod: attachedFetchDiagnostic?.method || null,
        networkOnline: attachedFetchDiagnostic?.networkOnline ?? null,
        capacitorPlatform: attachedFetchDiagnostic?.capacitorPlatform || null,
        terminalBindingStatus: resolveBindingStatus(),
        catalogSyncStatus: resolveCatalogStatus(),
        salesPushStatus: resolveSalesPushStatus(resolvedTarget),
        endpoint: sanitizeEndpoint(input.endpoint || attachedFetchDiagnostic?.endpoint),
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
    if (input.collection === 'products' && input.backendCode !== 'SYNC_COLLECTION_PULL_FAILED') {
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
