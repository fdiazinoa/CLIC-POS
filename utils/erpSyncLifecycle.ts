import { getStoredTenantIdentity } from './cloudMasterRegistry';
import { DEFAULT_ERP_SYNC_API_URL, normalizeCloudUrl } from './cloudDefaults';

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
    app_version_code?: number | null;
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

type RuntimeDeviceInfo = {
    versionName?: string | null;
    versionCode?: number | string | null;
    localIp?: string | null;
    localIps?: string[] | null;
};

type EnsureLifecycleParams = {
    deviceId: string;
    terminalId: string;
    terminalName?: string | null;
    isPrimary?: boolean;
    pendingEvents?: number;
    companyId?: string | null;
    storeId?: string | null;
};

const SYNC_API_URL_STORAGE_KEY = 'CLIC_ERP_SYNC_URL';
const SYNC_BINDING_TENANT_KEY = 'clic_erp_sync_tenant_id';
const SYNC_BINDING_TERMINAL_KEY = 'clic_erp_sync_terminal_id';
const SYNC_BINDING_COMPANY_KEY = 'clic_erp_sync_company_id';
const SYNC_BINDING_STORE_KEY = 'clic_erp_sync_store_id';
const SYNC_BINDING_LAST_SEEN_KEY = 'clic_erp_sync_last_seen';
const SYNC_BINDING_STATUS_KEY = 'clic_erp_sync_status';

const normalizeOptional = (value?: string | null) => (typeof value === 'string' ? value.trim() : '');

const getSyncApiBase = () => {
    const env = (import.meta as any).env || {};
    const explicitBase = normalizeOptional(normalizeCloudUrl(
        String(env.VITE_SYNC_API_URL
            || env.VITE_ERP_SYNC_API_URL
            || localStorage.getItem(SYNC_API_URL_STORAGE_KEY)
            || DEFAULT_ERP_SYNC_API_URL
            || '')
    ));

    if (!explicitBase) return '';

    const trimmed = explicitBase.replace(/\/$/, '');
    return trimmed.endsWith('/api/sync') ? trimmed : `${trimmed}/api/sync`;
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
        appVersionCode: Number.isFinite(Number(deviceInfo?.versionCode))
            ? Number(deviceInfo?.versionCode)
            : null,
        ipAddress: localIps[0] || null,
    };
};

const readJson = async <T>(response: Response): Promise<T> => {
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : 'ERP sync lifecycle request failed';
        throw new Error(message);
    }

    return payload as T;
};

const persistBinding = (terminal: SyncTerminalRecord | null | undefined, identity?: TenantIdentity | null) => {
    if (!terminal?.id) return;

    const currentIdentity = identity || getStoredTenantIdentity();
    const tenantId = normalizeOptional(currentIdentity.tenantId || terminal.tenant_id || null);

    if (tenantId) {
        localStorage.setItem(SYNC_BINDING_TENANT_KEY, tenantId);
    }

    localStorage.setItem(SYNC_BINDING_TERMINAL_KEY, terminal.id);

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

const clearBindingIfTenantChanged = (identity: TenantIdentity) => {
    const currentTenantId = normalizeOptional(identity.tenantId || null);
    const boundTenantId = normalizeOptional(localStorage.getItem(SYNC_BINDING_TENANT_KEY));

    if (currentTenantId && boundTenantId && currentTenantId !== boundTenantId) {
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

export const clearStoredErpSyncBinding = () => {
    localStorage.removeItem(SYNC_BINDING_TENANT_KEY);
    localStorage.removeItem(SYNC_BINDING_TERMINAL_KEY);
    localStorage.removeItem(SYNC_BINDING_COMPANY_KEY);
    localStorage.removeItem(SYNC_BINDING_STORE_KEY);
    localStorage.removeItem(SYNC_BINDING_LAST_SEEN_KEY);
    localStorage.removeItem(SYNC_BINDING_STATUS_KEY);
};

export const getStoredErpSyncBinding = () => ({
    tenantId: normalizeOptional(localStorage.getItem(SYNC_BINDING_TENANT_KEY)) || null,
    terminalId: normalizeOptional(localStorage.getItem(SYNC_BINDING_TERMINAL_KEY)) || null,
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
        name: params.terminalName || params.terminalId,
        app_version: runtimeTelemetry.appVersion || null,
        app_version_code: runtimeTelemetry.appVersionCode,
        ip_address: runtimeTelemetry.ipAddress || null,
        metadata: {
            source: 'CLIC_POS_APK',
            terminal_id: params.terminalId,
            is_primary: params.isPrimary ?? true,
        },
    });

    if (payload?.terminal) {
        persistBinding(payload.terminal, identity);
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
        app_version_code: runtimeTelemetry.appVersionCode,
        ip_address: runtimeTelemetry.ipAddress || null,
        pending_events: params.pendingEvents || 0,
    });

    if (payload?.terminal) {
        persistBinding(payload.terminal);
    }

    return payload;
};

export const ensureErpSyncLifecycle = async (params: EnsureLifecycleParams): Promise<{
    bootstrap?: SyncBootstrapResponse | null;
    registered?: SyncRegisterResponse | null;
    heartbeat?: SyncHeartbeatResponse | null;
} | null> => {
    if (!isConfigured()) return null;

    const bootstrap = await bootstrapErpSyncLifecycle(params.deviceId);
    const activation = bootstrap?.activation;

    if (activation && activation.erp_enabled === false) {
        return { bootstrap, registered: null, heartbeat: null };
    }

    const storedBinding = getStoredErpSyncBinding();
    let registered: SyncRegisterResponse | null = null;

    if (!storedBinding.terminalId) {
        registered = await registerErpSyncTerminal({
            ...params,
            companyId: params.companyId || storedBinding.companyId,
            storeId: params.storeId || storedBinding.storeId,
        });
    }

    const heartbeat = await heartbeatErpSyncTerminal(params, params.deviceId);

    return { bootstrap, registered, heartbeat };
};
