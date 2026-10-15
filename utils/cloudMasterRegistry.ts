import { isNativeAndroidRuntime } from './erpBaseUrl';
import { ensureSupabaseSessionRestored, supabase } from './supabase';
import { resolveStoredTenantIdentity, type TenantIdentity } from './tenantIdentityStorage';
import { buildMasterUrlCandidates, buildMasterUrlFromHost, normalizeMasterHost } from './masterEndpointUrl';

export { buildMasterUrlCandidates, buildMasterUrlFromHost, normalizeMasterHost } from './masterEndpointUrl';

export type { TenantIdentity } from './tenantIdentityStorage';

export type CloudMasterEndpoint = {
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantEmail?: string | null;
    deviceId?: string | null;
    terminalId?: string | null;
    terminalName?: string | null;
    hostname?: string | null;
    protocol?: string | null;
    port?: number | null;
    localIp?: string | null;
    localIps?: string[];
    endpointUrl?: string | null;
    appVersion?: string | null;
    appVersionCode?: number | null;
    isPrimary?: boolean;
    lastSeenAt?: string | null;
    status?: string | null;
};

type RuntimeDeviceInfo = {
    versionName?: string | null;
    versionCode?: number | string | null;
    localIp?: string | null;
    localIps?: string[] | null;
};

type RuntimeNetworkInfo = {
    localIp?: string | null;
    localIps?: string[];
};

type PublishedEndpointState = {
    localIp: string | null;
    fingerprint: string;
    lastPublishedAt: number;
    abortController: AbortController | null;
    inFlight: Promise<CloudMasterEndpoint | null> | null;
    endpoint: CloudMasterEndpoint | null;
};

const DIRECT_RESOLVE_RPC_CANDIDATES = [
    'resolve_tenant_server_endpoint',
    'get_tenant_server_endpoint',
    'clic_resolve_tenant_server_endpoint',
    'clic_get_tenant_server_endpoint',
];

const DIRECT_PUBLISH_RPC_CANDIDATES = [
    'register_tenant_server_endpoint',
    'upsert_tenant_server_endpoint',
    'clic_register_tenant_server_endpoint',
    'clic_upsert_tenant_server_endpoint',
];

const normalizeOptional = (value?: string | null) => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const dedupeStrings = (values: Array<string | null | undefined>) =>
    Array.from(new Set(values.map((value) => normalizeOptional(value)).filter(Boolean)));

const getCloudConfig = () => {
    const env = (import.meta as any).env || {};
    return {
        supabaseUrl: String(env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, ''),
        supabaseAnonKey: String(env.VITE_SUPABASE_ANON_KEY || '').trim(),
    };
};

const safeJson = async (response: Response) => {
    const text = await response.text().catch(() => '');
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

let cachedRuntimeAppVersion: { appVersion: string | null; appVersionCode: number | null } | undefined;
const publishedStateByTerminal = new Map<string, PublishedEndpointState>();
type PublishPreparation = { fingerprint?: string; promise: Promise<CloudMasterEndpoint | null> };
const latestPreparationByTerminal = new Map<string, PublishPreparation>();

const readRuntimeDeviceInfo = async (): Promise<RuntimeDeviceInfo | null> => {
    try {
        const runtimeWindow = window as any;
        let deviceInfo: RuntimeDeviceInfo | null = null;

        if (typeof runtimeWindow.ClicPOSNativePrinter?.getDeviceInfo === 'function') {
            deviceInfo = await runtimeWindow.ClicPOSNativePrinter.getDeviceInfo();
        } else if (typeof runtimeWindow.AndroidPrinter?.getDeviceInfo === 'function') {
            const raw = runtimeWindow.AndroidPrinter.getDeviceInfo();
            deviceInfo = raw ? JSON.parse(raw) : null;
        }
        return deviceInfo;
    } catch (error) {
        console.warn('[cloudMasterRegistry] no se pudo leer la versión del APK:', error);
        return null;
    }
};

const resolveRuntimeDeviceInfo = async () => {
    if (cachedRuntimeAppVersion !== undefined) {
        return cachedRuntimeAppVersion;
    }

    const deviceInfo = await readRuntimeDeviceInfo();
    const appVersion = normalizeOptional(deviceInfo?.versionName || null) || null;
    const parsedVersionCode = Number(deviceInfo?.versionCode);
    const appVersionCode = Number.isFinite(parsedVersionCode) && parsedVersionCode > 0
        ? parsedVersionCode
        : null;

    cachedRuntimeAppVersion = {
        appVersion,
        appVersionCode,
    };

    return cachedRuntimeAppVersion;
};

// The Android bridge reports addresses, not URLs or hostnames. Never advertise loopback.
const normalizeNativeIpv4 = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const ip = value.trim();
    const parts = ip.split('.');
    if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255 || String(Number(part)) !== part)) return '';
    if (Number(parts[0]) === 0 || Number(parts[0]) === 127 || Number(parts[0]) >= 224) return '';
    return ip;
};

const resolveRuntimeNetworkInfo = async (): Promise<RuntimeNetworkInfo> => {
    const deviceInfo = await readRuntimeDeviceInfo();
    const localIps = dedupeStrings([
        normalizeNativeIpv4(deviceInfo?.localIp),
        ...(Array.isArray(deviceInfo?.localIps)
            ? deviceInfo.localIps.map(normalizeNativeIpv4)
            : []),
    ]).filter((value) => value && value !== 'localhost' && value !== '127.0.0.1');

    return {
        localIp: localIps[0] || null,
        localIps,
    };
};

const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 3500) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const upstreamSignal = init.signal;
    let rejectAbort: ((reason: Error) => void) | undefined;
    const abortError = () => Object.assign(new Error('Request aborted'), { name: 'AbortError' });
    const abortFromUpstream = () => { controller?.abort(); rejectAbort?.(abortError()); };
    const abortPromise = new Promise<never>((_, reject) => { rejectAbort = reject; });

    if (upstreamSignal && controller) {
        if (upstreamSignal.aborted) {
            throw abortError();
        } else {
            upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
        }
    }

    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
            controller?.abort();
            reject(new Error(`Request timeout after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([
            fetch(input, {
                ...init,
                ...(controller ? { signal: controller.signal } : {}),
            }),
            timeoutPromise,
            abortPromise,
        ]) as Response;
    } finally {
        if (upstreamSignal && controller) {
            upstreamSignal.removeEventListener('abort', abortFromUpstream);
        }
        if (typeof timeoutId !== 'undefined') {
            globalThis.clearTimeout(timeoutId);
        }
    }
};

const normalizeEndpointRecord = (row: Record<string, any> | null | undefined): CloudMasterEndpoint | null => {
    if (!row) return null;

    const localIp = normalizeOptional(
        row.local_ip
        || row.localIp
        || row.server_ip
        || row.master_ip
    ) || null;
    const endpointUrl = normalizeOptional(row.endpoint_url || row.endpointUrl) || null;
    const protocol = normalizeOptional(row.protocol)
        || (endpointUrl?.startsWith('https://') ? 'https' : 'http')
        || 'http';
    const portValue = Number(row.port);
    const port = Number.isFinite(portValue) && portValue > 0
        ? portValue
        : (endpointUrl ? Number(new URL(endpointUrl).port || 3001) : 3001);
    const localIps = dedupeStrings([
        localIp,
        ...(Array.isArray(row.local_ips) ? row.local_ips : []),
        ...(Array.isArray(row.localIps) ? row.localIps : []),
    ]);
    const preferredIp = localIp || localIps[0] || normalizeMasterHost(endpointUrl || '') || null;

    if (!preferredIp && !endpointUrl) return null;

    return {
        tenantId: normalizeOptional(row.tenant_id || row.tenantId) || null,
        tenantSlug: normalizeOptional(row.tenant_slug || row.tenantSlug) || null,
        tenantEmail: normalizeOptional(row.tenant_email || row.tenantEmail).toLowerCase() || null,
        deviceId: normalizeOptional(row.device_id || row.deviceId) || null,
        terminalId: normalizeOptional(row.terminal_id || row.terminalId) || null,
        terminalName: normalizeOptional(row.terminal_name || row.terminalName) || null,
        hostname: normalizeOptional(row.hostname) || null,
        protocol,
        port,
        localIp: preferredIp,
        localIps,
        endpointUrl: endpointUrl || `${protocol}://${preferredIp}:${port}`,
        appVersion: normalizeOptional(row.app_version || row.appVersion) || null,
        appVersionCode: Number.isFinite(Number(row.app_version_code ?? row.appVersionCode))
            ? Number(row.app_version_code ?? row.appVersionCode)
            : null,
        isPrimary: Boolean(row.is_primary ?? row.isPrimary ?? true),
        lastSeenAt: normalizeOptional(row.last_seen_at || row.lastSeenAt) || null,
        status: normalizeOptional(row.status) || 'ONLINE',
    };
};

export const getStoredTenantIdentity = (): TenantIdentity => resolveStoredTenantIdentity(localStorage);

const buildResolveQuery = (identity: TenantIdentity) => {
    const params = new URLSearchParams();
    if (identity.tenantId) params.set('tenantId', identity.tenantId);
    if (identity.tenantSlug) params.set('tenantSlug', identity.tenantSlug);
    if (identity.tenantEmail) params.set('tenantEmail', identity.tenantEmail);
    return params.toString();
};

const buildRpcPayload = (identity: TenantIdentity) => ({
    p_tenant_id: identity.tenantId || null,
    p_tenant_slug: identity.tenantSlug || null,
    p_tenant_email: identity.tenantEmail || null,
});

const buildPublishedStateKey = (identity: TenantIdentity, payload: {
    deviceId: string;
    terminalId: string;
}) => (
    [
        identity.tenantId || identity.tenantSlug || identity.tenantEmail || 'unknown',
        payload.terminalId,
        payload.deviceId,
    ].join(':')
);

const stablePublishFingerprint = (payload: {
    endpointUrl: string | null;
    localIp: string | null;
    localIps: string[];
    appVersion: string | null;
    appVersionCode: number | null;
    isPrimary: boolean;
    terminalId: string;
    terminalName: string;
}) => JSON.stringify({
    endpointUrl: payload.endpointUrl,
    localIp: payload.localIp,
    localIps: [...payload.localIps].sort(),
    appVersion: payload.appVersion,
    appVersionCode: payload.appVersionCode,
    isPrimary: payload.isPrimary,
    terminalId: payload.terminalId,
    terminalName: payload.terminalName,
});

const buildDirectRpcHeaders = async (includeRepresentation = false): Promise<Record<string, string> | null> => {
    const { supabaseAnonKey } = getCloudConfig();
    if (!supabaseAnonKey) return null;

    await ensureSupabaseSessionRestored();
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return null;

    return {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept-Profile': 'landlord',
        'Content-Profile': 'landlord',
        ...(includeRepresentation ? { Prefer: 'return=representation' } : {}),
    };
};

const buildPublicRpcHeaders = async (includeRepresentation = false): Promise<Record<string, string> | null> => {
    const { supabaseAnonKey } = getCloudConfig();
    if (!supabaseAnonKey) return null;

    await ensureSupabaseSessionRestored();
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return null;

    return {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(includeRepresentation ? { Prefer: 'return=representation' } : {}),
    };
};

const buildForwardedCloudHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {};
    const { supabaseUrl, supabaseAnonKey } = getCloudConfig();

    if (supabaseUrl) {
        headers['x-cloud-supabase-url'] = supabaseUrl;
    }

    if (supabaseAnonKey) {
        headers['x-cloud-apikey'] = supabaseAnonKey;
    }

    try {
        await ensureSupabaseSessionRestored();
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
        }
    } catch (error) {
        console.warn('[cloudMasterRegistry] no se pudo preparar auth forwarded headers:', error);
    }

    return headers;
};

const callDirectRpc = async (
    rpcCandidates: string[],
    payload: Record<string, unknown>,
    includeRepresentation = false,
    signal?: AbortSignal
): Promise<CloudMasterEndpoint | null> => {
    if (signal?.aborted) return null;
    const { supabaseUrl } = getCloudConfig();
    const profiledHeaders = await buildDirectRpcHeaders(includeRepresentation);
    const publicHeaders = await buildPublicRpcHeaders(includeRepresentation);
    if (!supabaseUrl || (!profiledHeaders && !publicHeaders)) return null;

    for (const rpcName of rpcCandidates) {
        if (signal?.aborted) return null;
        const headers = rpcName.startsWith('clic_') ? publicHeaders : profiledHeaders;
        if (!headers) continue;

        try {
            const response = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal,
            }, 5000);

            if (signal?.aborted) return null;
            if (!response.ok) {
                if ([401, 403, 404].includes(response.status)) {
                    continue;
                }

                const body = await response.text().catch(() => '');
                console.warn(`[cloudMasterRegistry] direct RPC ${rpcName} failed:`, response.status, body);
                continue;
            }

            const data = await safeJson(response);
            if (signal?.aborted) return null;
            if (Array.isArray(data) && data.length > 0) return normalizeEndpointRecord(data[0]);
            if (data && typeof data === 'object') return normalizeEndpointRecord(data as Record<string, any>);
        } catch (error) {
            if (signal?.aborted) return null;
            console.warn(`[cloudMasterRegistry] direct RPC ${rpcName} threw:`, error);
        }
    }

    return null;
};

const getLocalNetworkCandidates = () => getLocalCloudRegistryCandidates('/api/network');

const getLocalCloudRegistryCandidates = (path: string, query = '') => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const suffix = query ? `${normalizedPath}?${query}` : normalizedPath;
    if (isNativeAndroidRuntime()) {
        // Kotlin exposes neither Node network discovery nor the Cloud registry proxy.
        return [];
    }
    const candidates = [
        suffix,
        `http://127.0.0.1:3001${suffix}`,
        `http://localhost:3001${suffix}`,
    ];

    if (window.location.protocol.startsWith('http') && window.location.hostname) {
        candidates.unshift(`${window.location.protocol}//${window.location.hostname}:3001${suffix}`);
    }

    return dedupeStrings(candidates);
};

const resolveLocalIpv4Addresses = async (): Promise<string[]> => {
    if (isNativeAndroidRuntime()) return (await resolveRuntimeNetworkInfo()).localIps || [];
    for (const url of getLocalNetworkCandidates()) {
        try {
            const response = await fetchWithTimeout(url, {}, 2500);
            if (!response.ok) continue;

            const payload = await safeJson(response) as { addresses?: string[] } | null;
            const addresses = dedupeStrings((payload?.addresses || []).map((value) => normalizeMasterHost(value)));
            const filtered = addresses.filter((value) => value && value !== 'localhost' && value !== '127.0.0.1');
            if (filtered.length > 0) {
                return filtered;
            }
        } catch (error) {
            console.warn('[cloudMasterRegistry] local network discovery failed:', error);
        }
    }

    return [];
};

export const persistMasterEndpoint = (endpoint: CloudMasterEndpoint | null) => {
    if (!endpoint) return;

    const host = normalizeMasterHost(endpoint.localIp || endpoint.endpointUrl || '');
    if (!host) return;

    localStorage.setItem('pos_master_ip', host);
    const protocol = endpoint.protocol || 'http';
    const port = endpoint.port || 3001;
    localStorage.setItem('CLIC_POS_MASTER_URL', buildMasterUrlFromHost(host, port, protocol));
    localStorage.setItem('CLIC_POS_MASTER_DISCOVERY', 'CLOUD');
    if (endpoint.lastSeenAt) {
        localStorage.setItem('CLIC_POS_MASTER_LAST_SEEN', endpoint.lastSeenAt);
    }
    if (endpoint.status) {
        localStorage.setItem('CLIC_POS_MASTER_STATUS', endpoint.status);
    }
};

export const resolveMasterEndpointFromCloud = async (
    identity?: TenantIdentity,
    options: { persist?: boolean } = {},
): Promise<CloudMasterEndpoint | null> => {
    const effectiveIdentity = identity || getStoredTenantIdentity();
    const query = buildResolveQuery(effectiveIdentity);
    if (!query) return null;

    const directEndpoint = await callDirectRpc(DIRECT_RESOLVE_RPC_CANDIDATES, buildRpcPayload(effectiveIdentity));
    if (directEndpoint) {
        if (options.persist !== false) persistMasterEndpoint(directEndpoint);
        return directEndpoint;
    }

    for (const url of getLocalCloudRegistryCandidates('/api/cloud/master-endpoint/resolve', query)) {
        try {
            const response = await fetchWithTimeout(url, {
                headers: await buildForwardedCloudHeaders(),
            }, 4000);
            if (!response.ok) continue;

            const payload = await response.json();
            const endpoint = normalizeEndpointRecord(payload?.endpoint as Record<string, any> | undefined);
            if (!endpoint) continue;

            if (options.persist !== false) persistMasterEndpoint(endpoint);
            return endpoint;
        } catch (error) {
            console.warn('[cloudMasterRegistry] resolve fallback failed:', url, error);
        }
    }

    return null;
};

type PublishPayload = {
    deviceId: string; terminalId: string; terminalName?: string; isPrimary?: boolean;
};

const publishPreparedEndpoint = async (
    payload: PublishPayload,
    identity: TenantIdentity,
    preparation: PublishPreparation,
    publishStateKey: string,
): Promise<CloudMasterEndpoint | null> => {
    const protocol = isNativeAndroidRuntime() ? 'http' : window.location.protocol.replace(':', '') || 'http';
    const port = 3001;
    const runtimeDeviceInfo = await resolveRuntimeDeviceInfo();
    const runtimeNetworkInfo = await resolveRuntimeNetworkInfo();
    const discoveredLocalIps = isNativeAndroidRuntime() ? runtimeNetworkInfo.localIps || [] : await resolveLocalIpv4Addresses();
    const localIps = discoveredLocalIps.length > 0
        ? discoveredLocalIps
        : runtimeNetworkInfo.localIps || [];
    const localIp = localIps[0] || runtimeNetworkInfo.localIp || null;
    const endpointUrl = localIp ? `${protocol}://${localIp}:${port}` : null;
    const fingerprint = stablePublishFingerprint({
        endpointUrl,
        localIp,
        localIps,
        appVersion: runtimeDeviceInfo.appVersion,
        appVersionCode: runtimeDeviceInfo.appVersionCode,
        isPrimary: payload.isPrimary ?? true,
        terminalId: payload.terminalId,
        terminalName: payload.terminalName || payload.terminalId,
    });
    preparation.fingerprint = fingerprint;
    const latestPreparation = latestPreparationByTerminal.get(publishStateKey);
    if (latestPreparation !== preparation) {
        const endpoint = await latestPreparation?.promise;
        return latestPreparation?.fingerprint === fingerprint ? endpoint || null : null;
    }
    if (isNativeAndroidRuntime() && !localIp) {
        publishedStateByTerminal.get(publishStateKey)?.abortController?.abort();
        return null;
    }
    const existingState = publishedStateByTerminal.get(publishStateKey);

    if (existingState?.fingerprint === fingerprint && !existingState.abortController?.signal.aborted) {
        if (existingState.inFlight) return existingState.inFlight;
        if (existingState.endpoint) return existingState.endpoint;
    }

    existingState?.abortController?.abort();
    const publishController = new AbortController();
    const state: PublishedEndpointState = {
        localIp, fingerprint, lastPublishedAt: 0,
        abortController: publishController, endpoint: null, inFlight: null,
    };
    publishedStateByTerminal.set(publishStateKey, state);
    const ownsAttempt = () => publishedStateByTerminal.get(publishStateKey) === state
        && !publishController.signal.aborted;
    const confirm = (endpoint: CloudMasterEndpoint): CloudMasterEndpoint | null => {
        if (!ownsAttempt()) return null;
        persistMasterEndpoint(endpoint);
        state.endpoint = endpoint;
        state.lastPublishedAt = Date.now();
        return endpoint;
    };

    const nextRpcPayload = {
        ...buildRpcPayload(identity),
        p_device_id: payload.deviceId,
        p_terminal_id: payload.terminalId,
        p_terminal_name: payload.terminalName || payload.terminalId,
        p_hostname: window.location.hostname || null,
        p_protocol: protocol,
        p_port: port,
        p_local_ip: localIp,
        p_local_ips: localIps,
        p_endpoint_url: endpointUrl,
        p_is_primary: payload.isPrimary ?? true,
        p_status: 'ONLINE',
        p_app_version: runtimeDeviceInfo.appVersion,
        p_app_version_code: runtimeDeviceInfo.appVersionCode,
    };

    const publish = async (): Promise<CloudMasterEndpoint | null> => {
        if (localIp) {
            let directEndpoint = await callDirectRpc(DIRECT_PUBLISH_RPC_CANDIDATES, nextRpcPayload, true, publishController.signal);
            if (!ownsAttempt()) return null;
            if (!directEndpoint) {
                directEndpoint = await callDirectRpc(DIRECT_PUBLISH_RPC_CANDIDATES, {
                    ...nextRpcPayload, p_app_version: undefined, p_app_version_code: undefined,
                }, true, publishController.signal);
            }
            if (!ownsAttempt()) return null;
            if (directEndpoint) return confirm(directEndpoint);
        }

        const candidates = getLocalCloudRegistryCandidates('/api/cloud/master-endpoint/publish');
        if (!candidates.length || !ownsAttempt()) return null;
        const fallbackBody = JSON.stringify({
            ...identity, ...payload, protocol, port, hostname: window.location.hostname,
            localIp, localIps, appVersion: runtimeDeviceInfo.appVersion,
            appVersionCode: runtimeDeviceInfo.appVersionCode,
        });
        const forwardedHeaders = await buildForwardedCloudHeaders();
        for (const url of candidates) {
            if (!ownsAttempt()) return null;
            try {
                const response = await fetchWithTimeout(url, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...forwardedHeaders },
                    body: fallbackBody, signal: publishController.signal,
                }, 4000);
                if (!ownsAttempt()) return null;
                if (!response.ok) continue;
                const result = await response.json();
                if (!ownsAttempt()) return null;
                const endpoint = normalizeEndpointRecord(result?.endpoint);
                if (endpoint) return confirm(endpoint);
            } catch (error) {
                if (!ownsAttempt()) return null;
                console.warn('[cloudMasterRegistry] publish fallback failed:', url, error);
            }
        }
        return null;
    };
    state.inFlight = publish().catch(error => {
        if (ownsAttempt()) console.warn('[cloudMasterRegistry] publish failed:', error);
        return null;
    }).finally(() => {
        // An old completion must not release ownership of a newer publication.
        if (publishedStateByTerminal.get(publishStateKey) === state) {
            state.inFlight = null;
            state.abortController = null;
        }
    });
    return state.inFlight;
};

export const publishMasterEndpointToCloud = (payload: PublishPayload): Promise<CloudMasterEndpoint | null> => {
    // Reserve invocation order before asynchronous device discovery can finish out of order.
    if (payload.isPrimary !== true) return Promise.resolve(null);
    const identity = getStoredTenantIdentity();
    if (!identity.tenantId && !identity.tenantSlug && !identity.tenantEmail) return Promise.resolve(null);
    const key = buildPublishedStateKey(identity, payload);
    const preparation: PublishPreparation = { promise: Promise.resolve(null) };
    latestPreparationByTerminal.set(key, preparation);
    preparation.promise = publishPreparedEndpoint(payload, identity, preparation, key).catch(error => {
        console.warn('[cloudMasterRegistry] endpoint preparation failed:', error);
        return null;
    });
    return preparation.promise;
};
