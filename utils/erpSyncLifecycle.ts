import { getStoredTenantIdentity } from './cloudMasterRegistry';
import { normalizeErpSyncApiBase, resolveErpSyncApiBase } from './erpBaseUrl';
import { extractErpRegisterAuth, resolveNormalizedRegisterDeviceToken } from '../services/sync/erpRegisterResponse';
import { persistSyncDeviceToken } from '../services/sync/deviceToken';
import { saveTerminalCredentialsSync } from '../services/sync/TerminalCredentialStore';
import { extractTerminalConfigRequestedScopes } from './terminalConfigPushScopes';
import { mergeTerminalConfigSnapshots } from './terminalConfigSnapshot';
import { db } from './db';
import { DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS } from '../constants';
import { getDefaultRoleConfig, normalizeDeviceRoleValue, resolveDeviceRoleValue } from './deviceRoleHelpers';
import {
    DEVICE_SUPERSEDED_MESSAGE,
    dispatchDeviceRevoked,
    isDeviceSupersededError,
    persistLocalDeviceId,
    resolveLocalDeviceId,
} from './deviceRevocation';
import {
    AuthLevel,
    BusinessConfig,
    DeviceRole,
    DeviceRoleConfig,
    TerminalConfig,
    TerminalConfigSnapshot,
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
    terminal_active?: boolean;
    reason?: string | null;
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
    terminalId?: string | null;
    erpTerminalId?: string | null;
    deviceToken?: string | null;
    device_token?: string | null;
    syncToken?: string | null;
    sync_token?: string | null;
    auth?: Record<string, unknown> | null;
    syncHeaders?: Record<string, unknown> | null;
    profile?: Record<string, unknown> | null;
    syncProfile?: Record<string, unknown> | null;
    incomingProfile?: Record<string, unknown> | null;
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
    masters?: Record<string, unknown> | null;
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
const SYNC_BINDING_TERMINAL_UUID_KEY = 'clic_erp_sync_terminal_uuid';
const ERP_FULL_BOOTSTRAP_REQUIRED_KEY = 'clic_erp_sync_full_bootstrap_required';
const ERP_FULL_BOOTSTRAP_REASON_KEY = 'clic_erp_sync_full_bootstrap_reason';
export const ERP_FULL_BOOTSTRAP_REQUIRED_EVENT = 'clic-pos-erp-full-bootstrap-required';
const TERMINAL_CONFIG_RESTART_NOTICE_KEY = 'clic_pos_terminal_config_restart_notice';
const TERMINAL_CONFIG_PENDING_SNAPSHOT_KEY = 'clic_pos_terminal_config_pending_snapshot';

let outboxProcessingPromise: Promise<{ processed: number; applied: number; failed: number } | null> | null = null;

const normalizeOptional = (value?: string | null) => (typeof value === 'string' ? value.trim() : '');
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

const normalizeActivationMode = (value?: string | null) => normalizeOptional(value).toUpperCase();
const normalizeActivationReason = (value?: string | null) => normalizeOptional(value).toUpperCase();
const normalizeActivationBillingStatus = (value?: string | null) => normalizeOptional(value).toUpperCase();

export const isLifecycleActivationBlocked = (activation?: SyncActivationState | null): boolean => {
    if (!activation) return false;

    const mode = normalizeActivationMode(activation.mode);
    const reason = normalizeActivationReason(activation.reason);
    const billingStatus = normalizeActivationBillingStatus(activation.billing_status);

    return (
        activation.erp_enabled === false
        || activation.terminal_active === false
        || activation.kill_switch_active === true
        || mode === 'LICENSE_BLOCKED'
        || mode === 'TERMINAL_BLOCKED'
        || mode === 'ERP_DISABLED'
        || reason === 'TERMINAL_DISABLED'
        || (Boolean(billingStatus) && billingStatus !== 'ACTIVE')
    );
};

export const getLifecycleActivationBlockMessage = (activation?: SyncActivationState | null): string => {
    if (!activation) {
        return 'Servicio Suspendido.';
    }

    const mode = normalizeActivationMode(activation.mode);
    const reason = normalizeActivationReason(activation.reason);
    const billingStatus = normalizeActivationBillingStatus(activation.billing_status);

    if (mode === 'TERMINAL_BLOCKED' || reason === 'TERMINAL_DISABLED' || activation.terminal_active === false) {
        return 'Esta terminal ha sido desactivada temporalmente desde el Panel de Control.';
    }

    if (mode === 'ERP_DISABLED' || activation.erp_enabled === false) {
        return 'El tenant está activo solo para POS local; la integración ERP está deshabilitada.';
    }

    if (billingStatus && billingStatus !== 'ACTIVE') {
        return billingStatus.replace(/_/g, ' ');
    }

    return normalizeOptional(activation.reason) || 'Servicio Suspendido.';
};

export const getLifecycleBlockingMessageFromError = (error: unknown): string | null => {
    const requestError = error as SyncRequestError | null;
    const code = normalizeActivationReason(requestError?.code || null);
    const message = normalizeOptional(requestError?.message || null).toLowerCase();
    const payloadActivation = asObject<{ activation?: SyncActivationState | null }>(requestError?.payload).activation || null;

    if (payloadActivation && isLifecycleActivationBlocked(payloadActivation)) {
        return getLifecycleActivationBlockMessage(payloadActivation);
    }

    if (
        code === 'DEVICE_SUPERSEDED'
        || message.includes('ya no es la terminal autorizada')
        || message.includes('dispositivo ya no está autorizado')
        || message.includes('dispositivo ya no esta autorizado')
    ) {
        return DEVICE_SUPERSEDED_MESSAGE;
    }

    if (
        code === 'LICENSE_BLOCKED'
        || code === 'TERMINAL_DISABLED'
        || code === 'LICENSE_EXCEEDED_INACTIVE'
        || message.includes('terminal ha sido desactivada')
        || message.includes('licencia actual no permite')
        || message.includes('integración erp está deshabilitada')
        || message.includes('integracion erp esta deshabilitada')
    ) {
        if (code === 'TERMINAL_DISABLED' || code === 'LICENSE_EXCEEDED_INACTIVE' || message.includes('terminal ha sido desactivada')) {
            return 'Esta terminal ha sido desactivada temporalmente desde el Panel de Control.';
        }

        if (message.includes('integración erp está deshabilitada') || message.includes('integracion erp esta deshabilitada')) {
            return 'El tenant está activo solo para POS local; la integración ERP está deshabilitada.';
        }

        return 'Servicio Suspendido.';
    }

    return null;
};
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
    return normalizeDeviceRoleValue(value);
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

const normalizeSyncApiBase = (value?: string | null): string =>
    normalizeErpSyncApiBase(value) || '';

const getSyncApiBase = () => resolveErpSyncApiBase() || '';

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
        requestError?.status === 404
        || message.includes('terminal no encontrada')
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
    terminalUuid?: string | null;
    localTerminalId?: string | null;
    terminalName?: string | null;
    companyId?: string | null;
    storeId?: string | null;
    lastSeen?: string | null;
    status?: string | null;
}) => {
    const tenantId = normalizeOptional(input.tenantId || null);
    const terminalId = normalizeOptional(input.terminalId || null);
    const terminalUuid = normalizeOptional(input.terminalUuid || null);
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

    if (terminalUuid) {
        localStorage.setItem(SYNC_BINDING_TERMINAL_UUID_KEY, terminalUuid);
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

export type ErpSyncAuthIdentity = {
    terminalId: string | null;
    terminalUuid: string | null;
    tenantId: string | null;
    companyId: string | null;
    storeId: string | null;
    deviceId: string | null;
};

export const persistErpSyncAuthIdentity = (
    payload: unknown,
    fallbackTerminalId?: string | null
): ErpSyncAuthIdentity => {
    const root = asObject<Record<string, unknown>>(payload);
    const operationalIdentity = asObject<Record<string, unknown>>(root.operational_identity);
    const terminal = asObject<Record<string, unknown>>(root.terminal);

    const terminalId =
        normalizeOptional(String(root.terminal_id || root.terminalId || terminal.id || fallbackTerminalId || ''))
        || null;
    const terminalUuid =
        normalizeOptional(String(root.terminal_uuid || root.terminalUuid || terminal.uuid || ''))
        || null;
    const tenantId =
        normalizeOptional(String(operationalIdentity.tenant_id || root.tenant_id || terminal.tenant_id || ''))
        || null;
    const companyId =
        normalizeOptional(String(operationalIdentity.company_id || root.company_id || terminal.company_id || ''))
        || null;
    const storeId =
        normalizeOptional(String(operationalIdentity.store_id || root.store_id || terminal.store_id || ''))
        || null;
    const deviceId =
        normalizeOptional(String(root.device_id || root.deviceId || terminal.device_id || ''))
        || null;

    persistStoredErpSyncBinding({
        tenantId,
        terminalId,
        terminalUuid,
        companyId,
        storeId,
    });

    if (tenantId) {
        localStorage.setItem('active_tenant_id', tenantId);
        localStorage.setItem('clic_tenant_id', tenantId);
    }

    if (deviceId) {
        persistLocalDeviceId(deviceId);
    }

    return {
        terminalId,
        terminalUuid,
        tenantId,
        companyId,
        storeId,
        deviceId,
    };
};

export const erpSyncAuthRequiresFullBootstrap = (payload: unknown): boolean => {
    const root = asObject<Record<string, unknown>>(payload);
    const syncState = asObject<Record<string, unknown>>(root.sync_state);
    const resetReason = normalizeOptional(String(syncState.reset_reason || root.bootstrap_reason || '')).toUpperCase();

    return (
        root.requires_full_bootstrap === true
        || root.sync_reset_required === true
        || resetReason === 'TERMINAL_TAKEOVER'
    );
};

export const clearErpIncrementalSyncState = () => {
    const removeByPrefix = (storage: Storage, prefixes: string[]) => {
        const keys: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
                keys.push(key);
            }
        }
        keys.forEach((key) => storage.removeItem(key));
    };

    removeByPrefix(localStorage, [
        'clic_pos_terminal_catalog_cursor:',
        'clic_pos_terminal_manifest_cursor_map:',
        'clic_pos_terminal_config_',
        'clic_erp_manifest_',
        'clic_erp_config_',
        'clic_erp_inventory_',
        'clic_erp_product_prices_',
        'erp_manifest_',
        'erp_inventory_',
        'erp_product_prices_',
    ]);

    removeByPrefix(sessionStorage, [
        'clic_pos_terminal_startup_manifest_synced:',
    ]);

    localStorage.removeItem(TERMINAL_CONFIG_PENDING_SNAPSHOT_KEY);
    localStorage.removeItem(TERMINAL_CONFIG_RESTART_NOTICE_KEY);
};

export const markErpFullBootstrapRequired = (payload: unknown) => {
    const root = asObject<Record<string, unknown>>(payload);
    const syncState = asObject<Record<string, unknown>>(root.sync_state);
    const reason =
        normalizeOptional(String(syncState.reset_reason || root.bootstrap_reason || 'TERMINAL_TAKEOVER'))
        || 'TERMINAL_TAKEOVER';

    const alreadyMarked =
        localStorage.getItem(ERP_FULL_BOOTSTRAP_REQUIRED_KEY) === 'true'
        && localStorage.getItem(ERP_FULL_BOOTSTRAP_REASON_KEY) === reason;

    localStorage.setItem(ERP_FULL_BOOTSTRAP_REQUIRED_KEY, 'true');
    localStorage.setItem(ERP_FULL_BOOTSTRAP_REASON_KEY, reason);
    if (alreadyMarked) return;

    window.dispatchEvent(new CustomEvent(ERP_FULL_BOOTSTRAP_REQUIRED_EVENT, {
        detail: {
            reason,
            payload,
        },
    }));
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

const buildDeviceHeaders = (deviceId?: unknown): Record<string, string> => {
    const resolvedDeviceId = normalizeOptional(String(deviceId || resolveLocalDeviceId() || ''));
    return resolvedDeviceId
        ? {
            'X-Device-Id': resolvedDeviceId,
            'X-POS-Device-Id': resolvedDeviceId,
        }
        : {};
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
            ...buildDeviceHeaders(body.device_id as string | null | undefined),
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
            ...buildDeviceHeaders(query.device_id as string | number | null | undefined),
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
    const binding = getStoredErpSyncBinding();

    if (Object.keys(terminalConfig).length === 0) {
        if (requestedScopes.selective) {
            window.dispatchEvent(new CustomEvent('terminalConfigSyncRequested', {
                detail: {
                    source: 'erp_outbox',
                    eventId: normalizeOptional(event.id || null) || null,
                    terminalId:
                        normalizeOptional(String(payload.terminal_id || ''))
                        || normalizeOptional(String(payload.terminalId || ''))
                        || binding.terminalId
                        || null,
                    localTerminalId:
                        normalizeOptional(String(payload.local_terminal_id || ''))
                        || binding.localTerminalId
                        || null,
                    masterScopes: requestedScopes.masterScopes || [],
                    blockScopes: requestedScopes.blockScopes || [],
                    resolvedScopes: requestedScopes.resolvedScopes || [],
                    selective: true,
                },
            }));
        }
        return;
    }

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
        blockScopes: requestedScopes.selective ? (requestedScopes.blockScopes || []) : undefined,
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
                blockScopes: requestedScopes.blockScopes || [],
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
    const roleChangedToHeadless = roleChanged && defaults.authLevel === AuthLevel.HEADLESS;
    const touchTargetSize = toFiniteNumber(
        incomingUi.touchTargetSize
        ?? (!roleChangedToHeadless ? incoming.touchTargetSize : undefined)
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
    const incomingAuthLevel = resolveAuthLevel(incoming.authLevel);
    const authLevel =
        roleChangedToHeadless && incomingAuthLevel === AuthLevel.USER_REQUIRED
            ? defaults.authLevel
            : incomingAuthLevel
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

const buildIncomingConfigPushDeviceRole = (
    snapshot: Record<string, unknown>,
    incomingConfig: Record<string, unknown>
): Record<string, unknown> => {
    const resolved = asObject<Record<string, unknown>>(snapshot.resolved);
    const resolvedIdentity = asObject<Record<string, unknown>>(resolved.identity);
    const resolvedTerminal = asObject<Record<string, unknown>>(resolved.terminal);
    const camelRole = asObject<Record<string, unknown>>(incomingConfig.deviceRole);
    const snakeRole = asObject<Record<string, unknown>>(incomingConfig.device_role);
    const resolvedCamelRole = asObject<Record<string, unknown>>(resolved.deviceRole);
    const resolvedSnakeRole = asObject<Record<string, unknown>>(resolved.device_role);
    const roleValue = resolveDeviceRoleValue([
        camelRole.role,
        camelRole.device_role,
        camelRole.deviceRole,
        camelRole.role_code,
        camelRole.device_role_code,
        snakeRole.role,
        snakeRole.device_role,
        snakeRole.deviceRole,
        snakeRole.role_code,
        snakeRole.device_role_code,
        incomingConfig.deviceRole,
        incomingConfig.device_role,
        resolvedCamelRole.role,
        resolvedCamelRole.device_role,
        resolvedCamelRole.deviceRole,
        resolvedCamelRole.role_code,
        resolvedCamelRole.device_role_code,
        resolvedSnakeRole.role,
        resolvedSnakeRole.device_role,
        resolvedSnakeRole.deviceRole,
        resolvedSnakeRole.role_code,
        resolvedSnakeRole.device_role_code,
        resolvedIdentity.deviceRole,
        resolvedIdentity.device_role,
        resolvedIdentity.role_code,
        resolvedIdentity.device_role_code,
        resolvedTerminal.deviceRole,
        resolvedTerminal.device_role,
        resolvedTerminal.role_code,
        resolvedTerminal.device_role_code,
        snapshot.deviceRole,
        snapshot.device_role,
        snapshot.role_code,
        snapshot.device_role_code,
        resolved.deviceRole,
        resolved.device_role,
        resolved.role_code,
        resolved.device_role_code,
        incomingConfig.device_role_code,
        resolvedIdentity.role,
        resolvedTerminal.role,
        snapshot.role,
        resolved.role,
        incomingConfig.role,
    ]);

    return {
        ...resolvedCamelRole,
        ...resolvedSnakeRole,
        ...camelRole,
        ...snakeRole,
        ...(roleValue ? { role: roleValue } : {}),
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
            || ''
        )
    );

    if (!defaultSalesWarehouseId && visibleWarehouseIds.length === 0) {
        return {
            defaultSalesWarehouseId: '',
            visibleWarehouseIds: [],
        };
    }

    return {
        defaultSalesWarehouseId: defaultSalesWarehouseId || visibleWarehouseIds[0] || '',
        visibleWarehouseIds,
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
    const snapshotRecord = snapshot as unknown as Record<string, unknown>;
    const incomingConfig = asObject<Record<string, unknown>>(snapshot.config);
    const incomingMasters = asObject<Record<string, unknown>>(snapshot.masters);
    const incomingResolved = asObject<Record<string, unknown>>(snapshot.resolved);
    const incomingIdentity = asObject<Record<string, unknown>>(incomingResolved.identity);
    const incomingTerminal = asObject<Record<string, unknown>>(incomingResolved.terminal);

    if (
        !snapshot.terminal_id &&
        Object.keys(incomingIdentity).length === 0 &&
        Object.keys(incomingTerminal).length === 0 &&
        Object.keys(incomingConfig).length === 0 &&
        Object.keys(incomingMasters).length === 0 &&
        Object.keys(incomingResolved).length === 0
    ) {
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

    const resolvedTerminalId = normalizeOptional(String(
        snapshot.terminal_id ||
        incomingIdentity.terminal_id ||
        incomingIdentity.id ||
        incomingTerminal.terminal_id ||
        incomingTerminal.id ||
        fallbackTerminalId ||
        ''
    ));
    const resolvedDeviceId = normalizeOptional(String(
        snapshot.device_id ||
        incomingIdentity.device_id ||
        incomingTerminal.device_id ||
        incomingConfig.device_id ||
        ''
    ));
    const exactTargetIndex = localConfig.terminals.findIndex((terminal) =>
        (resolvedTerminalId && terminal.id === resolvedTerminalId)
        || (resolvedTerminalId && terminal.config?.erpTerminalId === resolvedTerminalId)
        || (resolvedTerminalId && terminal.config?.erpBinding?.terminalId === resolvedTerminalId)
    );
    const canFallbackToDevice = !resolvedTerminalId || !resolvedDeviceId || resolvedDeviceId === deviceId;
    const deviceTargetIndex = canFallbackToDevice
        ? localConfig.terminals.findIndex((terminal) => terminal.config?.currentDeviceId === deviceId)
        : -1;
    const targetIndex = exactTargetIndex !== -1 ? exactTargetIndex : deviceTargetIndex;

    if (targetIndex === -1) {
        return false;
    }

    const targetTerminal = localConfig.terminals[targetIndex];
    const localTerminalId = targetTerminal.id || resolvedTerminalId || fallbackTerminalId || '';
    const currentConfig: TerminalConfig = targetTerminal.config || ({} as TerminalConfig);
    const incomingOperational = asObject<Record<string, unknown>>(incomingConfig.operational);
    const incomingCatalog = asObject<Record<string, unknown>>(incomingConfig.catalog);
    const incomingPricing = asObject<Record<string, unknown>>(incomingConfig.pricing);
    const incomingDocuments = asObject<Record<string, unknown>>(incomingConfig.documents);
    const incomingDeviceRole = buildIncomingConfigPushDeviceRole(snapshotRecord, incomingConfig);
    const resolvedSnapshot = asObject<Record<string, unknown>>(snapshot.resolved);
    const resolvedInventory = asObject<Record<string, unknown>>(resolvedSnapshot.inventory);
    const allowedCategories = Array.isArray(incomingCatalog.allowedCategories)
        ? asStringList(incomingCatalog.allowedCategories)
        : [];
    const allowedTariffIds = Array.isArray(incomingPricing.allowedTariffIds)
        ? asStringList(incomingPricing.allowedTariffIds)
        : [];
    const defaultTariffId = normalizeOptional(
        String(incomingPricing.defaultTariffId || '')
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
        defaultTariffId,
    } as TerminalConfig['pricing'];
    const nextDocumentAssignments = {
        ...DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS,
        ...(currentConfig.documentAssignments || {}),
        ...incomingAssignments,
    } as NonNullable<TerminalConfig['documentAssignments']>;
    const existingSnapshot =
        currentConfig.erpSnapshot ||
        (localTerminalId ? localConfig.terminalSnapshots?.[localTerminalId] : null) ||
        (resolvedTerminalId ? localConfig.terminalSnapshots?.[resolvedTerminalId] : null) ||
        null;
    const nextErpSnapshot = mergeTerminalConfigSnapshots(
        existingSnapshot,
        snapshot as TerminalConfigSnapshot
    ) || (snapshot as TerminalConfigSnapshot);
    const nextTerminalConfig: TerminalConfig = {
        ...currentConfig,
        deviceRole: buildCompatibleDeviceRoleConfig(currentConfig.deviceRole, incomingDeviceRole),
        operational: nextOperational,
        catalog: nextCatalog,
        pricing: nextPricing,
        documentAssignments: nextDocumentAssignments,
        inventoryScope: buildCompatibleInventoryScope(currentConfig.inventoryScope, resolvedInventory),
        erpBinding: {
            ...(currentConfig.erpBinding || {}),
            terminalId: normalizeOptional(snapshot.terminal_id || currentConfig.erpBinding?.terminalId || null) || undefined,
            terminalName:
                normalizeOptional(snapshot.terminal_name || currentConfig.erpBinding?.terminalName || null) ||
                currentConfig.terminalName ||
                localTerminalId ||
                undefined,
            deviceId: normalizeOptional(snapshot.device_id || currentConfig.erpBinding?.deviceId || deviceId || null) || undefined,
            role:
                normalizeOptional(
                    String(
                        snapshot.role ||
                        snapshotRecord.device_role ||
                        snapshotRecord.role_code ||
                        snapshotRecord.device_role_code ||
                        incomingIdentity.role ||
                        incomingIdentity.device_role ||
                        incomingIdentity.deviceRole ||
                        incomingIdentity.role_code ||
                        incomingIdentity.device_role_code ||
                        incomingTerminal.role ||
                        incomingTerminal.device_role ||
                        incomingTerminal.deviceRole ||
                        incomingTerminal.role_code ||
                        incomingTerminal.device_role_code ||
                        incomingResolved.role ||
                        incomingResolved.device_role ||
                        incomingResolved.deviceRole ||
                        incomingResolved.role_code ||
                        incomingResolved.device_role_code ||
                        incomingDeviceRole.role ||
                        currentConfig.erpBinding?.role ||
                        ''
                    )
                ) || undefined,
        },
        erpSnapshot: nextErpSnapshot,
    };

    const nextTerminals = localConfig.terminals.map((terminal, index) => {
        if (index !== targetIndex) {
            return terminal;
        }

        return {
            ...terminal,
            id: terminal.id || resolvedTerminalId,
            config: nextTerminalConfig,
        };
    });

    const terminalSnapshots = {
        ...(localConfig.terminalSnapshots || {}),
        ...(localTerminalId ? { [localTerminalId]: nextErpSnapshot } : {}),
        ...(resolvedTerminalId ? { [resolvedTerminalId]: nextErpSnapshot } : {}),
    };

    const nextConfig: BusinessConfig = {
        ...localConfig,
        terminals: nextTerminals,
        terminalSnapshots,
    };

    console.info('[ERP SYNC] CONFIG_PUSH terminal role applied', {
        localTerminalId,
        erpTerminalId: resolvedTerminalId || null,
        currentDeviceId: deviceId,
        incomingRole: incomingDeviceRole.role || null,
        appliedRole: nextTerminalConfig.deviceRole?.role || null,
    });

    await db.save('config', nextConfig);
    window.dispatchEvent(new CustomEvent('configUpdated', { detail: nextConfig }));

    return true;
};

const pullErpOutbox = async (bindingTerminalId: string | null, deviceId: string): Promise<SyncOutboxPullResponse | null> => {
    if (!isConfigured()) return null;
    if (!bindingTerminalId && !deviceId) return null;

    return getJson<SyncOutboxPullResponse>('/outbox/pull', {
        terminal_id: bindingTerminalId || undefined,
        device_id: deviceId || undefined,
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
    localStorage.removeItem(SYNC_BINDING_TERMINAL_UUID_KEY);
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
    terminalUuid: normalizeOptional(localStorage.getItem(SYNC_BINDING_TERMINAL_UUID_KEY)) || null,
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

    const registerAuth = extractErpRegisterAuth(payload);
    const deviceToken = resolveNormalizedRegisterDeviceToken(payload, registerAuth);
    const resolvedTerminalId =
        payload?.terminal?.id
        || payload?.erpTerminalId
        || payload?.terminalId
        || params.terminalId
        || storedBinding.terminalId
        || null;

    if (deviceToken) {
        persistSyncDeviceToken(deviceToken, 'ERP_REGISTER', registerAuth.tokenExpiresAt);
    }
    if (registerAuth.syncToken) {
        localStorage.setItem('clic_erp_sync_token', registerAuth.syncToken);
        localStorage.setItem('clic_erp_sync_token_updated_at', new Date().toISOString());
        if (registerAuth.tokenExpiresAt) {
            localStorage.setItem('clic_erp_sync_token_expires_at', registerAuth.tokenExpiresAt);
        }
    }
    if (deviceToken || registerAuth.syncToken) {
        saveTerminalCredentialsSync({
            terminalId: resolvedTerminalId,
            deviceId: params.deviceId,
            ...(deviceToken ? {
                deviceToken,
                deviceTokenSource: 'ERP_REGISTER',
                deviceTokenUpdatedAt: new Date().toISOString(),
                deviceTokenExpiresAt: registerAuth.tokenExpiresAt || null,
            } : {}),
            ...(registerAuth.syncToken ? {
                syncToken: registerAuth.syncToken,
                syncTokenUpdatedAt: new Date().toISOString(),
                syncTokenExpiresAt: registerAuth.tokenExpiresAt || null,
            } : {}),
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
    const resolvedDeviceId = params.deviceId || fallbackDeviceId || resolveLocalDeviceId();
    const terminalRef = storedBinding.terminalId || null;

    if (!terminalRef && !resolvedDeviceId) {
        return null;
    }

    const payload = await postJson<SyncHeartbeatResponse>('/terminals/heartbeat', {
        terminal_id: terminalRef || undefined,
        device_id: resolvedDeviceId || undefined,
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

    if (activation && activation.erp_enabled === false) {
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
        if (isDeviceSupersededError(error)) {
            dispatchDeviceRevoked({
                reason: 'DEVICE_SUPERSEDED',
                message: getLifecycleBlockingMessageFromError(error) || 'Este equipo fue reemplazado por otro dispositivo.',
                terminalId: storedBinding.terminalId || params.terminalId,
                previousDeviceId: params.deviceId,
                payload: (error as SyncRequestError)?.payload || null,
            });
            throw error;
        }

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

    const outbox = await processErpSyncOutbox(params);

    return { bootstrap, registered, heartbeat, outbox };
};
