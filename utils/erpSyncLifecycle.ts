import { getStoredTenantIdentity } from './cloudMasterRegistry';
import { extractTerminalConfigRequestedScopes } from './terminalConfigPushScopes';
import { db } from './db';
import { DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS } from '../constants';
import { getDefaultRoleConfig } from './deviceRoleHelpers';
import {
    AuthLevel,
    BusinessConfig,
    DeviceRole,
    DeviceRoleConfig,
    TerminalConfig,
} from '../types';

type TenantIdentity = {
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantEmail?: string | null;
};

type SyncActivationState = {
    tenant_id?: string | null;
    company_ref?: string | null;
    mode?: string | null;
    erp_enabled?: boolean;
    billing_status?: string | null;
    kill_switch_active?: boolean;
};

type SyncTerminalRecord = {
    id: string;
    tenant_id?: string | null;
    company_id?: string | null;
    company_name?: string | null;
    store_id?: string | null;
    store_name?: string | null;
    device_id: string;
    name: string;
    last_seen?: string | null;
    ip_address?: string | null;
    app_version?: string | null;
    pending_events?: number;
    status?: string | null;
};

type SyncBootstrapResponse = {
    status: string;
    activation?: SyncActivationState | null;
    terminal?: SyncTerminalRecord | null;
};

type SyncRegisterResponse = {
    status: string;
    action?: string;
    activation?: SyncActivationState | null;
    terminal?: SyncTerminalRecord | null;
};

type SyncHeartbeatResponse = {
    status: string;
    activation?: SyncActivationState | null;
    terminal?: SyncTerminalRecord | null;
};

type SyncOutboxEvent = {
    id: string;
    event_type: string;
    payload?: Record<string, unknown> | null;
    status?: string;
    created_at?: string;
};

type SyncOutboxPullResponse = {
    status: string;
    events?: SyncOutboxEvent[];
    count?: number;
};

type SyncOutboxAckResponse = {
    status: string;
    outbox_id: string;
    applied_status: 'APPLIED' | 'FAILED';
};

type RuntimeDeviceInfo = {
    versionName?: string | null;
    localIp?: string | null;
    localIps?: string[] | null;
};

type SyncRequestError = Error & {
    status?: number;
    code?: string | null;
    payload?: any;
};

type EnsureLifecycleParams = {
    deviceId: string;
    terminalId: string;
    localTerminalId?: string | null;
    terminalName?: string | null;
    isPrimary?: boolean;
    pendingEvents?: number;
    companyId?: string | null;
    storeId?: string | null;
};

type SyncTerminalSnapshot = {
    terminal_id?: string | null;
    terminal_name?: string | null;
    device_id?: string | null;
    role?: string | null;
    config?: Record<string, unknown> | null;
    resolved?: Record<string, unknown> | null;
};

const SYNC_API_URL_STORAGE_KEY = 'CLIC_ERP_SYNC_URL';
const SYNC_BINDING_TENANT_KEY = 'clic_erp_sync_tenant_id';
const SYNC_BINDING_TERMINAL_KEY = 'clic_erp_sync_terminal_id';
const SYNC_BINDING_LOCAL_TERMINAL_KEY = 'clic_erp_sync_local_terminal_id';
const SYNC_BINDING_TERMINAL_NAME_KEY = 'clic_erp_sync_terminal_name';
const SYNC_BINDING_COMPANY_KEY = 'clic_erp_sync_company_id';
const SYNC_BINDING_STORE_KEY = 'clic_erp_sync_store_id';
const SYNC_BINDING_LAST_SEEN_KEY = 'clic_erp_sync_last_seen';
const SYNC_BINDING_STATUS_KEY = 'clic_erp_sync_status';
const TERMINAL_CONFIG_RESTART_NOTICE_KEY = 'clic_pos_terminal_config_restart_notice';
const TERMINAL_CONFIG_PENDING_SNAPSHOT_KEY = 'clic_pos_terminal_config_pending_snapshot';

let outboxProcessingPromise: Promise<{ processed: number; applied: number; failed: number } | null> | null = null;

const normalizeOptional = (value?: string | null) => (typeof value === 'string' ? value.trim() : '');
const BLOCKED_BILLING_STATUSES = new Set([
    'SUSPENDED',
    'INACTIVE',
    'BLOCKED',
    'DISABLED',
    'CANCELLED',
    'CANCELED',
    'PAST_DUE',
    'EXPIRED',
]);

export const isBlockedErpSyncActivation = (activation?: SyncActivationState | null): boolean => {
    if (!activation) return false;

    const mode = normalizeOptional(activation.mode || null).toUpperCase();
    const billingStatus = normalizeOptional(activation.billing_status || null).toUpperCase();

    return (
        activation.erp_enabled === false
        || activation.kill_switch_active === true
        || mode === 'LICENSE_BLOCKED'
        || BLOCKED_BILLING_STATUSES.has(billingStatus)
    );
};

const asObject = <T extends Record<string, unknown>>(value: unknown): T =>
    (value && typeof value === 'object' && !Array.isArray(value) ? value as T : {} as T);
const asStringList = (value: unknown) => (
    Array.isArray(value)
        ? value.map((entry) => normalizeOptional(String(entry || ''))).filter(Boolean)
        : []
);
const normalizeAllowedModules = (value: unknown): string[] => (
    asStringList(value).map((moduleName) => (
        moduleName === '*'
            ? '*'
            : moduleName.toLowerCase()
    ))
);
const toFiniteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
const pickBoolean = (...values: unknown[]): boolean | undefined => {
    for (const value of values) {
        if (typeof value === 'boolean') {
            return value;
        }
    }
    return undefined;
};
const resolveDeviceRole = (value: unknown): DeviceRole => {
    const normalized = normalizeOptional(String(value || '')).toUpperCase();

    switch (normalized) {
        case DeviceRole.SELF_CHECKOUT:
            return DeviceRole.SELF_CHECKOUT;
        case DeviceRole.PRICE_CHECKER:
            return DeviceRole.PRICE_CHECKER;
        case DeviceRole.HANDHELD_INVENTORY:
            return DeviceRole.HANDHELD_INVENTORY;
        case DeviceRole.KITCHEN_DISPLAY:
            return DeviceRole.KITCHEN_DISPLAY;
        case DeviceRole.STANDARD_POS:
        default:
            return DeviceRole.STANDARD_POS;
    }
};
const resolveAuthLevel = (value: unknown): AuthLevel | null => {
    const normalized = normalizeOptional(String(value || '')).toUpperCase();
    if (normalized === AuthLevel.HEADLESS) {
        return AuthLevel.HEADLESS;
    }
    if (normalized === AuthLevel.USER_REQUIRED) {
        return AuthLevel.USER_REQUIRED;
    }
    return null;
};

const normalizeSyncApiBase = (value?: string | null): string => {
    const raw = normalizeOptional(value || null);
    if (!raw) return '';

    const trimmed = raw.replace(/\/$/, '');
    return trimmed.endsWith('/api/sync') ? trimmed : `${trimmed}/api/sync`;
};

const getSyncApiBase = () => {
    const env = (import.meta as any).env || {};
    const candidates = [
        localStorage.getItem(SYNC_API_URL_STORAGE_KEY),
        localStorage.getItem('CLIC_ERP_BASE_URL'),
        localStorage.getItem('erp_base_url'),
        env.VITE_SYNC_API_URL,
        env.VITE_ERP_SYNC_API_URL,
        env.VITE_ERP_BASE_URL,
    ];

    for (const candidate of candidates) {
        const normalized = normalizeSyncApiBase(candidate);
        if (normalized) {
            return normalized;
        }
    }

    return '';
};

const isConfigured = () => Boolean(getSyncApiBase());

const readRuntimeDeviceInfo = async (): Promise<RuntimeDeviceInfo | null> => {
    try {
        const runtimeWindow = window as any;

        if (typeof runtimeWindow.ClicPOSNativePrinter?.getDeviceInfo === 'function') {
            return await runtimeWindow.ClicPOSNativePrinter.getDeviceInfo();
        }

        if (typeof runtimeWindow.AndroidPrinter?.getDeviceInfo === 'function') {
            const raw = runtimeWindow.AndroidPrinter.getDeviceInfo();
            return raw ? JSON.parse(raw) : null;
        }
    } catch (error) {
        console.warn('[erpSyncLifecycle] no se pudo leer el runtime nativo:', error);
    }

    return null;
};

const resolveRuntimeTelemetry = async () => {
    const deviceInfo = await readRuntimeDeviceInfo();
    const localIps = Array.from(
        new Set(
            [
                normalizeOptional(deviceInfo?.localIp || null),
                ...((Array.isArray(deviceInfo?.localIps) ? deviceInfo?.localIps : []).map((value) => normalizeOptional(value || null))),
            ].filter(Boolean)
        )
    );

    return {
        appVersion: normalizeOptional(deviceInfo?.versionName || null) || null,
        ipAddress: localIps[0] || null,
    };
};

const readJson = async <T>(response: Response): Promise<T> => {
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : 'ERP sync lifecycle request failed';
        const error = new Error(message) as SyncRequestError;
        error.status = response.status;
        error.code = typeof payload?.code === 'string' ? payload.code : null;
        error.payload = payload;
        throw error;
    }

    return payload as T;
};

const shouldRecoverErpBinding = (error: unknown) => {
    const requestError = error as SyncRequestError | null;
    const code = normalizeOptional(requestError?.code || null).toUpperCase();
    const message = normalizeOptional(requestError?.message || null).toLowerCase();

    return (
        code === 'DEVICE_SUPERSEDED'
        || requestError?.status === 404
        || message.includes('terminal no encontrada')
        || message.includes('ya no es la terminal autorizada')
        || message.includes('dispositivo ya no está autorizado')
    );
};

const recoverErpSyncBinding = async (params: EnsureLifecycleParams) => {
    clearStoredErpSyncBinding();

    const bootstrap = await bootstrapErpSyncLifecycle(params.deviceId);
    const recoveredBinding = getStoredErpSyncBinding();

    let registered: SyncRegisterResponse | null = null;

    if (!recoveredBinding.terminalId) {
        registered = await registerErpSyncTerminal({
            ...params,
            companyId: params.companyId || recoveredBinding.companyId,
            storeId: params.storeId || recoveredBinding.storeId,
        });
    }

    const heartbeat = await heartbeatErpSyncTerminal(params, params.deviceId);
    return { bootstrap, registered, heartbeat };
};

const persistBinding = (
    terminal: SyncTerminalRecord | null | undefined,
    identity?: TenantIdentity | null,
    overrides?: {
        localTerminalId?: string | null;
        terminalName?: string | null;
    }
) => {
    if (!terminal?.id) return;

    const currentIdentity = identity || getStoredTenantIdentity();
    const tenantId = normalizeOptional(currentIdentity.tenantId || terminal.tenant_id || null);
    const localTerminalId = normalizeOptional(
        overrides?.localTerminalId
        || localStorage.getItem(SYNC_BINDING_LOCAL_TERMINAL_KEY)
        || null
    );
    const terminalName = normalizeOptional(
        overrides?.terminalName
        || terminal.name
        || localStorage.getItem(SYNC_BINDING_TERMINAL_NAME_KEY)
        || null
    );

    if (tenantId) {
        localStorage.setItem(SYNC_BINDING_TENANT_KEY, tenantId);
    }

    localStorage.setItem(SYNC_BINDING_TERMINAL_KEY, terminal.id);

    if (localTerminalId) {
        localStorage.setItem(SYNC_BINDING_LOCAL_TERMINAL_KEY, localTerminalId);
    }

    if (terminalName) {
        localStorage.setItem(SYNC_BINDING_TERMINAL_NAME_KEY, terminalName);
    }

    if (terminal.company_id) {
        localStorage.setItem(SYNC_BINDING_COMPANY_KEY, terminal.company_id);
    }

    if (terminal.store_id) {
        localStorage.setItem(SYNC_BINDING_STORE_KEY, terminal.store_id);
    }

    if (terminal.last_seen) {
        localStorage.setItem(SYNC_BINDING_LAST_SEEN_KEY, terminal.last_seen);
    }

    if (terminal.status) {
        localStorage.setItem(SYNC_BINDING_STATUS_KEY, terminal.status);
    }
};

export const persistStoredErpSyncBinding = (input: {
    tenantId?: string | null;
    terminalId?: string | null;
    localTerminalId?: string | null;
    terminalName?: string | null;
    companyId?: string | null;
    storeId?: string | null;
    lastSeen?: string | null;
    status?: string | null;
}) => {
    const tenantId = normalizeOptional(input.tenantId || null);
    const terminalId = normalizeOptional(input.terminalId || null);
    const localTerminalId = normalizeOptional(input.localTerminalId || null);
    const terminalName = normalizeOptional(input.terminalName || null);
    const companyId = normalizeOptional(input.companyId || null);
    const storeId = normalizeOptional(input.storeId || null);
    const lastSeen = normalizeOptional(input.lastSeen || null);
    const status = normalizeOptional(input.status || null);

    if (tenantId) {
        localStorage.setItem(SYNC_BINDING_TENANT_KEY, tenantId);
    }

    if (terminalId) {
        localStorage.setItem(SYNC_BINDING_TERMINAL_KEY, terminalId);
    }

    if (localTerminalId) {
        localStorage.setItem(SYNC_BINDING_LOCAL_TERMINAL_KEY, localTerminalId);
    }

    if (terminalName) {
        localStorage.setItem(SYNC_BINDING_TERMINAL_NAME_KEY, terminalName);
    }

    if (companyId) {
        localStorage.setItem(SYNC_BINDING_COMPANY_KEY, companyId);
    }

    if (storeId) {
        localStorage.setItem(SYNC_BINDING_STORE_KEY, storeId);
    }

    if (lastSeen) {
        localStorage.setItem(SYNC_BINDING_LAST_SEEN_KEY, lastSeen);
    }

    if (status) {
        localStorage.setItem(SYNC_BINDING_STATUS_KEY, status);
    }
};

const clearBindingIfTenantChanged = (identity: TenantIdentity) => {
    const currentTenantId = normalizeOptional(identity.tenantId || null);
    const activeErpTenantId = normalizeOptional(localStorage.getItem('active_tenant_id'));
    const boundTenantId = normalizeOptional(localStorage.getItem(SYNC_BINDING_TENANT_KEY));

    const matchesRuntimeTenant =
        (currentTenantId && currentTenantId === boundTenantId) ||
        (activeErpTenantId && activeErpTenantId === boundTenantId);

    if (boundTenantId && !matchesRuntimeTenant && currentTenantId) {
        clearStoredErpSyncBinding();
    }
};

const postJson = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    const baseUrl = getSyncApiBase();
    if (!baseUrl) {
        throw new Error('ERP sync lifecycle URL is not configured');
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    return readJson<T>(response);
};

const getJson = async <T>(path: string, query: Record<string, string | number | null | undefined>): Promise<T> => {
    const baseUrl = getSyncApiBase();
    if (!baseUrl) {
        throw new Error('ERP sync lifecycle URL is not configured');
    }

    const searchParams = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') return;
        searchParams.set(key, String(value));
    });

    const response = await fetch(`${baseUrl}${path}?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    return readJson<T>(response);
};

const persistTerminalConfigRestartNotice = (event: SyncOutboxEvent) => {
    const payload = asObject<Record<string, unknown>>(event.payload);
    const terminalConfig = asObject<Record<string, unknown>>(payload.terminal_config);
    const terminalId =
        normalizeOptional(String(payload.terminalId || ''))
        || normalizeOptional(String(payload.terminal_id || ''))
        || normalizeOptional(String(terminalConfig.terminal_id || ''))
        || null;

    const notice = {
        receivedAt: new Date().toISOString(),
        eventId: normalizeOptional(event.id || null) || null,
        terminalId,
    };

    localStorage.setItem(TERMINAL_CONFIG_RESTART_NOTICE_KEY, JSON.stringify(notice));
    window.dispatchEvent(new CustomEvent('terminalConfigRestartRequired', { detail: notice }));
};

const persistPendingTerminalConfigSnapshot = (event: SyncOutboxEvent) => {
    const payload = asObject<Record<string, unknown>>(event.payload);
    const terminalConfig = asObject<Record<string, unknown>>(payload.terminal_config);
    const requestedScopes = extractTerminalConfigRequestedScopes(payload);

    if (Object.keys(terminalConfig).length === 0) {
        return;
    }

    const binding = getStoredErpSyncBinding();
    const pendingSnapshot = {
        receivedAt: new Date().toISOString(),
        eventId: normalizeOptional(event.id || null) || null,
        erpTerminalId:
            normalizeOptional(String(payload.terminal_id || ''))
            || normalizeOptional(String(terminalConfig.terminal_id || ''))
            || binding.terminalId
            || null,
        localTerminalId:
            normalizeOptional(String(payload.local_terminal_id || ''))
            || binding.localTerminalId
            || null,
        masterScopes: requestedScopes.selective ? (requestedScopes.masterScopes || []) : undefined,
        resolvedScopes: requestedScopes.selective ? (requestedScopes.resolvedScopes || []) : undefined,
        snapshot: terminalConfig,
    };

    localStorage.setItem(TERMINAL_CONFIG_PENDING_SNAPSHOT_KEY, JSON.stringify(pendingSnapshot));
    window.dispatchEvent(new CustomEvent('terminalConfigSyncRequested', {
        detail: {
            source: 'erp_outbox',
            eventId: normalizeOptional(event.id || null) || null,
            terminalId: pendingSnapshot.erpTerminalId,
            localTerminalId: pendingSnapshot.localTerminalId,
            ...(requestedScopes.selective ? {
                masterScopes: requestedScopes.masterScopes || [],
                resolvedScopes: requestedScopes.resolvedScopes || [],
                selective: true,
            } : {}),
        },
    }));
};

const buildCompatibleDeviceRoleConfig = (
    currentRoleConfig: DeviceRoleConfig | null | undefined,
    incomingRoleConfig: unknown
): DeviceRoleConfig => {
    const current = currentRoleConfig && typeof currentRoleConfig === 'object'
        ? currentRoleConfig
        : null;
    const incoming = asObject<Record<string, unknown>>(incomingRoleConfig);
    const incomingUi = asObject<Record<string, unknown>>(incoming.uiSettings);
    const incomingHardware = asObject<Record<string, unknown>>(incoming.hardwareConfig);
    const role = resolveDeviceRole(incoming.role || current?.role || DeviceRole.STANDARD_POS);
    const defaults = getDefaultRoleConfig(role);
    const roleChanged = Boolean(current?.role) && current?.role !== role;
    const currentUi = !roleChanged ? asObject<Record<string, unknown>>(current?.uiSettings) : {};
    const currentHardware = !roleChanged ? asObject<Record<string, unknown>>(current?.hardwareConfig) : {};
    const currentEscapeHatch = !roleChanged
        ? asObject<Record<string, unknown>>(currentUi.escapeHatch)
        : {};
    const incomingEscapeHatch = asObject<Record<string, unknown>>(incomingUi.escapeHatch);
    const currentAdminPin = normalizeOptional(String(current?.uiSettings?.escapeHatch?.adminPin || ''));
    const allowedModules = normalizeAllowedModules(incoming.allowedModules);
    const currentAllowedModules = Array.isArray(current?.allowedModules)
        ? normalizeAllowedModules(current.allowedModules)
        : [];
    const defaultAllowedModules = normalizeAllowedModules(defaults.allowedModules);
    const resolvedAllowedModules = allowedModules.length > 0
        ? allowedModules
        : currentAllowedModules.length > 0 && !roleChanged
            ? currentAllowedModules
            : defaultAllowedModules;
    const touchTargetSize = toFiniteNumber(
        incoming.touchTargetSize
        ?? incomingUi.touchTargetSize
        ?? currentUi.touchTargetSize
        ?? defaults.uiSettings.touchTargetSize
    ) ?? defaults.uiSettings.touchTargetSize;
    const fullscreenForced = pickBoolean(
        incoming.fullscreenForced,
        incomingUi.fullscreenForced,
        currentUi.fullscreenForced,
        defaults.uiSettings.fullscreenForced
    ) ?? defaults.uiSettings.fullscreenForced;
    const navigationLocked = pickBoolean(
        incoming.navigationLocked,
        incomingUi.navigationLocked,
        currentUi.navigationLocked,
        defaults.uiSettings.navigationLocked
    ) ?? defaults.uiSettings.navigationLocked;
    const authLevel = resolveAuthLevel(incoming.authLevel)
        || (!roleChanged ? resolveAuthLevel(current?.authLevel) : null)
        || defaults.authLevel;
    const defaultRoute = normalizeOptional(String(incoming.defaultRoute || ''))
        || (!roleChanged ? normalizeOptional(String(current?.defaultRoute || '')) : '')
        || defaults.defaultRoute;
    const apiToken = normalizeOptional(String(incoming.apiToken || ''))
        || normalizeOptional(String(current?.apiToken || ''))
        || undefined;

    return {
        ...defaults,
        ...(roleChanged ? {} : current || {}),
        ...incoming,
        role,
        authLevel,
        defaultRoute,
        apiToken,
        allowedModules: resolvedAllowedModules,
        uiSettings: {
            ...defaults.uiSettings,
            ...currentUi,
            ...incomingUi,
            fullscreenForced,
            touchTargetSize,
            navigationLocked,
            escapeHatch: {
                ...defaults.uiSettings.escapeHatch,
                ...currentEscapeHatch,
                ...incomingEscapeHatch,
                ...(currentAdminPin && !normalizeOptional(String(incomingEscapeHatch.adminPin || ''))
                    ? { adminPin: currentAdminPin }
                    : {}),
            },
        },
        hardwareConfig: {
            ...defaults.hardwareConfig,
            ...currentHardware,
            ...incomingHardware,
        },
    };
};

const buildCompatibleInventoryScope = (
    currentInventoryScope: TerminalConfig['inventoryScope'],
    resolvedInventory: Record<string, unknown>
): TerminalConfig['inventoryScope'] => {
    const warehouses = Array.isArray(resolvedInventory.warehouses)
        ? resolvedInventory.warehouses as Array<Record<string, unknown>>
        : [];
    const visibleWarehouseIds = Array.from(
        new Set(
            warehouses
                .map((warehouse) => normalizeOptional(String(warehouse?.id || '')))
                .filter(Boolean)
        )
    );
    const defaultSalesWarehouseId = normalizeOptional(
        String(
            resolvedInventory.default_warehouse_id
            || asObject<Record<string, unknown>>(resolvedInventory.default_warehouse).id
            || currentInventoryScope?.defaultSalesWarehouseId
            || ''
        )
    );

    if (!defaultSalesWarehouseId && visibleWarehouseIds.length === 0) {
        return currentInventoryScope;
    }

    return {
        defaultSalesWarehouseId: defaultSalesWarehouseId || currentInventoryScope?.defaultSalesWarehouseId || '',
        visibleWarehouseIds: visibleWarehouseIds.length > 0
            ? visibleWarehouseIds
            : currentInventoryScope?.visibleWarehouseIds || [],
    };
};

const applyErpConfigPushToLocalTerminal = async ({
    deviceId,
    fallbackTerminalId,
    payload,
}: {
    deviceId: string;
    fallbackTerminalId?: string | null;
    payload: Record<string, unknown>;
}): Promise<boolean> => {
    const snapshot = asObject<SyncTerminalSnapshot>(payload.terminal_config);
    const incomingConfig = asObject<Record<string, unknown>>(snapshot.config);

    if (!snapshot.terminal_id && Object.keys(incomingConfig).length === 0) {
        return false;
    }

    const localConfigRaw = await db.get('config');
    if (!localConfigRaw || Array.isArray(localConfigRaw)) {
        return false;
    }

    const localConfig = localConfigRaw as BusinessConfig;
    if (!Array.isArray(localConfig.terminals)) {
        return false;
    }

    const resolvedTerminalId = normalizeOptional(snapshot.terminal_id || fallbackTerminalId || null);
    const targetIndex = localConfig.terminals.findIndex((terminal) =>
        (resolvedTerminalId && terminal.id === resolvedTerminalId)
        || terminal.config?.currentDeviceId === deviceId
    );

    if (targetIndex === -1) {
        return false;
    }

    const targetTerminal = localConfig.terminals[targetIndex];
    const currentConfig: TerminalConfig = targetTerminal.config || ({} as TerminalConfig);
    const incomingOperational = asObject<Record<string, unknown>>(incomingConfig.operational);
    const incomingCatalog = asObject<Record<string, unknown>>(incomingConfig.catalog);
    const incomingPricing = asObject<Record<string, unknown>>(incomingConfig.pricing);
    const incomingDocuments = asObject<Record<string, unknown>>(incomingConfig.documents);
    const resolvedSnapshot = asObject<Record<string, unknown>>(snapshot.resolved);
    const resolvedInventory = asObject<Record<string, unknown>>(resolvedSnapshot.inventory);
    const allowedCategories = asStringList(
        incomingCatalog.allowedCategories
        ?? currentConfig.catalog?.allowedCategories
    );
    const allowedTariffIds = asStringList(
        incomingPricing.allowedTariffIds
        ?? currentConfig.pricing?.allowedTariffIds
    );
    const defaultTariffId = normalizeOptional(
        String(incomingPricing.defaultTariffId || currentConfig.pricing?.defaultTariffId || '')
    );
    const incomingAssignments = asObject<Record<string, string>>(incomingDocuments.assignments);
    const nextOperational = {
        ...(currentConfig.operational || {}),
        ...incomingOperational,
    } as TerminalConfig['operational'];
    const nextCatalog = {
        ...(currentConfig.catalog || {}),
        ...incomingCatalog,
        allowedCategories,
    } as NonNullable<TerminalConfig['catalog']>;
    const nextPricing = {
        ...(currentConfig.pricing || {}),
        ...incomingPricing,
        allowedTariffIds,
        defaultTariffId: defaultTariffId || currentConfig.pricing?.defaultTariffId || '',
    } as TerminalConfig['pricing'];
    const nextDocumentAssignments = {
        ...DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS,
        ...(currentConfig.documentAssignments || {}),
        ...incomingAssignments,
    } as NonNullable<TerminalConfig['documentAssignments']>;
    const nextTerminalConfig: TerminalConfig = {
        ...currentConfig,
        deviceRole: buildCompatibleDeviceRoleConfig(currentConfig.deviceRole, incomingConfig.deviceRole),
        operational: nextOperational,
        catalog: nextCatalog,
        pricing: nextPricing,
        documentAssignments: nextDocumentAssignments,
        inventoryScope: buildCompatibleInventoryScope(currentConfig.inventoryScope, resolvedInventory),
    };

    const nextTerminals = localConfig.terminals.map((terminal, index) => {
        if (index !== targetIndex) {
            return terminal;
        }

        return {
            ...terminal,
            id: resolvedTerminalId || terminal.id,
            config: nextTerminalConfig,
        };
    });

    const nextConfig: BusinessConfig = {
        ...localConfig,
        terminals: nextTerminals,
    };

    await db.save('config', nextConfig);
    window.dispatchEvent(new CustomEvent('configUpdated', { detail: nextConfig }));

    return true;
};

const pullErpOutbox = async (bindingTerminalId: string | null, deviceId: string): Promise<SyncOutboxPullResponse | null> => {
    if (!isConfigured()) return null;
    if (!bindingTerminalId && !deviceId) return null;

    return getJson<SyncOutboxPullResponse>('/outbox/pull', {
        terminal_id: bindingTerminalId || undefined,
        device_id: bindingTerminalId ? undefined : deviceId,
        limit: 20,
    });
};

const ackErpOutboxEvent = async (
    outboxId: string,
    status: 'APPLIED' | 'FAILED',
    errorDetail?: string
): Promise<SyncOutboxAckResponse | null> => {
    if (!outboxId) return null;

    return postJson<SyncOutboxAckResponse>('/outbox/ack', {
        outbox_id: outboxId,
        status,
        error_detail: errorDetail || null,
    });
};

export const clearStoredErpSyncBinding = () => {
    localStorage.removeItem(SYNC_BINDING_TENANT_KEY);
    localStorage.removeItem(SYNC_BINDING_TERMINAL_KEY);
    localStorage.removeItem(SYNC_BINDING_LOCAL_TERMINAL_KEY);
    localStorage.removeItem(SYNC_BINDING_TERMINAL_NAME_KEY);
    localStorage.removeItem(SYNC_BINDING_COMPANY_KEY);
    localStorage.removeItem(SYNC_BINDING_STORE_KEY);
    localStorage.removeItem(SYNC_BINDING_LAST_SEEN_KEY);
    localStorage.removeItem(SYNC_BINDING_STATUS_KEY);
};

export const getStoredErpSyncBinding = () => ({
    tenantId: normalizeOptional(localStorage.getItem(SYNC_BINDING_TENANT_KEY)) || null,
    terminalId: normalizeOptional(localStorage.getItem(SYNC_BINDING_TERMINAL_KEY)) || null,
    localTerminalId: normalizeOptional(localStorage.getItem(SYNC_BINDING_LOCAL_TERMINAL_KEY)) || null,
    terminalName: normalizeOptional(localStorage.getItem(SYNC_BINDING_TERMINAL_NAME_KEY)) || null,
    companyId: normalizeOptional(localStorage.getItem(SYNC_BINDING_COMPANY_KEY)) || null,
    storeId: normalizeOptional(localStorage.getItem(SYNC_BINDING_STORE_KEY)) || null,
    lastSeen: normalizeOptional(localStorage.getItem(SYNC_BINDING_LAST_SEEN_KEY)) || null,
    status: normalizeOptional(localStorage.getItem(SYNC_BINDING_STATUS_KEY)) || null,
});

export const bootstrapErpSyncLifecycle = async (deviceId: string): Promise<SyncBootstrapResponse | null> => {
    if (!isConfigured() || !deviceId) return null;

    const identity = getStoredTenantIdentity();
    if (!identity.tenantId && !identity.tenantSlug && !identity.tenantEmail) {
        return null;
    }

    clearBindingIfTenantChanged(identity);

    const payload = await postJson<SyncBootstrapResponse>('/bootstrap/check', {
        tenant_id: identity.tenantId || null,
        company_ref: identity.tenantSlug || null,
        email: identity.tenantEmail || null,
        device_id: deviceId,
    });

    if (payload?.terminal) {
        persistBinding(payload.terminal, identity);
    }

    return payload;
};

export const registerErpSyncTerminal = async (params: EnsureLifecycleParams): Promise<SyncRegisterResponse | null> => {
    if (!isConfigured() || !params.deviceId) return null;

    const identity = getStoredTenantIdentity();
    if (!identity.tenantId && !identity.tenantSlug && !identity.tenantEmail) {
        return null;
    }

    clearBindingIfTenantChanged(identity);

    const runtimeTelemetry = await resolveRuntimeTelemetry();
    const storedBinding = getStoredErpSyncBinding();

    const payload = await postJson<SyncRegisterResponse>('/terminals/register', {
        device_id: params.deviceId,
        tenant_id: identity.tenantId || null,
        company_ref: identity.tenantSlug || null,
        company_id: params.companyId || storedBinding.companyId || null,
        store_id: params.storeId || storedBinding.storeId || null,
        name: params.terminalName || params.localTerminalId || params.terminalId,
        app_version: runtimeTelemetry.appVersion || null,
        ip_address: runtimeTelemetry.ipAddress || null,
        metadata: {
            source: 'CLIC_POS_APK',
            terminal_id: params.localTerminalId || params.terminalId,
            erp_terminal_id: params.terminalId,
            terminal_name: params.terminalName || params.localTerminalId || params.terminalId,
            is_primary: params.isPrimary ?? true,
        },
    });

    if (payload?.terminal) {
        persistBinding(payload.terminal, identity, {
            localTerminalId: params.localTerminalId || storedBinding.localTerminalId || null,
            terminalName: params.terminalName || storedBinding.terminalName || null,
        });
    }

    return payload;
};

export const heartbeatErpSyncTerminal = async (
    params: EnsureLifecycleParams,
    fallbackDeviceId?: string
): Promise<SyncHeartbeatResponse | null> => {
    if (!isConfigured()) return null;

    const runtimeTelemetry = await resolveRuntimeTelemetry();
    const storedBinding = getStoredErpSyncBinding();
    const resolvedDeviceId = params.deviceId || fallbackDeviceId || '';
    const terminalRef = storedBinding.terminalId || null;

    if (!terminalRef && !resolvedDeviceId) {
        return null;
    }

    const payload = await postJson<SyncHeartbeatResponse>('/terminals/heartbeat', {
        terminal_id: terminalRef || undefined,
        device_id: terminalRef ? undefined : resolvedDeviceId,
        app_version: runtimeTelemetry.appVersion || null,
        ip_address: runtimeTelemetry.ipAddress || null,
        pending_events: params.pendingEvents || 0,
    });

    if (payload?.terminal) {
        persistBinding(payload.terminal, undefined, {
            localTerminalId: params.localTerminalId || storedBinding.localTerminalId || null,
            terminalName: params.terminalName || storedBinding.terminalName || null,
        });
    }

    return payload;
};

export const processErpSyncOutbox = async (
    params: Pick<EnsureLifecycleParams, 'deviceId' | 'terminalId' | 'localTerminalId' | 'terminalName'>
): Promise<{ processed: number; applied: number; failed: number } | null> => {
    if (!isConfigured() || !params.deviceId) return null;

    if (outboxProcessingPromise) {
        return outboxProcessingPromise;
    }

    outboxProcessingPromise = (async () => {
        const binding = getStoredErpSyncBinding();
        const outbox = await pullErpOutbox(binding.terminalId, params.deviceId);
        const events = Array.isArray(outbox?.events) ? outbox.events : [];

        if (events.length === 0) {
            return { processed: 0, applied: 0, failed: 0 };
        }

        let applied = 0;
        let failed = 0;

        for (const event of events) {
            const eventType = normalizeOptional(event.event_type || null).toUpperCase();

            try {
                if (eventType === 'CONFIG_PUSH') {
                    const payload = asObject<Record<string, unknown>>(event.payload);
                    const appliedLocally = await applyErpConfigPushToLocalTerminal({
                        deviceId: params.deviceId,
                        fallbackTerminalId: binding.terminalId || params.terminalId,
                        payload,
                    });

                    console.info(
                        appliedLocally
                            ? '[ERP SYNC] CONFIG_PUSH aplicado localmente y se marca reinicio requerido.'
                            : '[ERP SYNC] CONFIG_PUSH recibido sin cambios locales aplicables. Se marca reinicio requerido.'
                    );
                    persistPendingTerminalConfigSnapshot(event);
                    persistTerminalConfigRestartNotice(event);
                    await ackErpOutboxEvent(event.id, 'APPLIED');
                    applied += 1;
                    continue;
                }

                await ackErpOutboxEvent(event.id, 'FAILED', `Evento no soportado por el POS: ${eventType || 'UNKNOWN'}`);
                failed += 1;
            } catch (error: any) {
                console.warn(`[ERP SYNC] Error procesando ${eventType || 'UNKNOWN'}:`, error);
                await ackErpOutboxEvent(event.id, 'FAILED', error?.message || 'Error procesando evento ERP outbox');
                failed += 1;
            }
        }

        return {
            processed: events.length,
            applied,
            failed,
        };
    })();

    try {
        return await outboxProcessingPromise;
    } finally {
        outboxProcessingPromise = null;
    }
};

export const ensureErpSyncLifecycle = async (params: EnsureLifecycleParams): Promise<{
    bootstrap?: SyncBootstrapResponse | null;
    registered?: SyncRegisterResponse | null;
    heartbeat?: SyncHeartbeatResponse | null;
    outbox?: { processed: number; applied: number; failed: number } | null;
} | null> => {
    if (!isConfigured()) return null;

    const storedBinding = getStoredErpSyncBinding();
    const bootstrap = storedBinding.terminalId ? null : await bootstrapErpSyncLifecycle(params.deviceId);
    const activation = bootstrap?.activation;

    if (isBlockedErpSyncActivation(activation)) {
        return { bootstrap, registered: null, heartbeat: null };
    }

    let registered: SyncRegisterResponse | null = null;

    if (!storedBinding.terminalId) {
        registered = await registerErpSyncTerminal({
            ...params,
            companyId: params.companyId || storedBinding.companyId,
            storeId: params.storeId || storedBinding.storeId,
        });
    }

    let heartbeat: SyncHeartbeatResponse | null = null;

    try {
        heartbeat = await heartbeatErpSyncTerminal(params, params.deviceId);
    } catch (error) {
        if (!shouldRecoverErpBinding(error)) {
            throw error;
        }

        console.warn('[ERP SYNC] binding obsoleto detectado, reintentando registro de terminal.', error);
        const rebound = await recoverErpSyncBinding({
            ...params,
            companyId: params.companyId || storedBinding.companyId,
            storeId: params.storeId || storedBinding.storeId,
        });

        heartbeat = rebound.heartbeat;
        registered = rebound.registered || registered;
    }

    if (isBlockedErpSyncActivation(registered?.activation) || isBlockedErpSyncActivation(heartbeat?.activation)) {
        return { bootstrap, registered, heartbeat, outbox: null };
    }

    const outbox = await processErpSyncOutbox(params);

    return { bootstrap, registered, heartbeat, outbox };
};
