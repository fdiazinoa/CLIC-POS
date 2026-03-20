import { ensureSupabaseSessionRestored, supabase } from './supabase';

export type TenantIdentity = {
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantEmail?: string | null;
};

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

const resolveRuntimeNetworkInfo = async (): Promise<RuntimeNetworkInfo> => {
    const deviceInfo = await readRuntimeDeviceInfo();
    const localIps = dedupeStrings([
        normalizeMasterHost(deviceInfo?.localIp || ''),
        ...(Array.isArray(deviceInfo?.localIps)
            ? deviceInfo.localIps.map((value) => normalizeMasterHost(value))
            : []),
    ]).filter((value) => value && value !== 'localhost' && value !== '127.0.0.1');

    return {
        localIp: localIps[0] || null,
        localIps,
    };
};

const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 3500) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;

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
        ]) as Response;
    } finally {
        if (typeof timeoutId !== 'undefined') {
            globalThis.clearTimeout(timeoutId);
        }
    }
};

export const normalizeMasterHost = (value?: string | null) => {
    const trimmed = normalizeOptional(value);
    if (!trimmed) return '';

    try {
        const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
        const parsed = new URL(withProtocol);
        return parsed.hostname || trimmed.replace(/^https?:\/\//i, '').replace(/:\d+$/, '');
    } catch {
        return trimmed.replace(/^https?:\/\//i, '').replace(/:\d+$/, '');
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

export const getStoredTenantIdentity = (): TenantIdentity => ({
    tenantId: normalizeOptional(localStorage.getItem('clic_tenant_id')) || null,
    tenantSlug: normalizeOptional(localStorage.getItem('clic_tenant_slug')) || null,
    tenantEmail: normalizeOptional(localStorage.getItem('clic_tenant_email')).toLowerCase() || null,
});

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
    includeRepresentation = false
): Promise<CloudMasterEndpoint | null> => {
    const { supabaseUrl } = getCloudConfig();
    const profiledHeaders = await buildDirectRpcHeaders(includeRepresentation);
    const publicHeaders = await buildPublicRpcHeaders(includeRepresentation);
    if (!supabaseUrl || (!profiledHeaders && !publicHeaders)) return null;

    for (const rpcName of rpcCandidates) {
        const headers = rpcName.startsWith('clic_') ? publicHeaders : profiledHeaders;
        if (!headers) continue;

        try {
            const response = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
            }, 5000);

            if (!response.ok) {
                if ([401, 403, 404].includes(response.status)) {
                    continue;
                }

                const body = await response.text().catch(() => '');
                console.warn(`[cloudMasterRegistry] direct RPC ${rpcName} failed:`, response.status, body);
                continue;
            }

            const data = await safeJson(response);
            if (Array.isArray(data) && data.length > 0) return normalizeEndpointRecord(data[0]);
            if (data && typeof data === 'object') return normalizeEndpointRecord(data as Record<string, any>);
        } catch (error) {
            console.warn(`[cloudMasterRegistry] direct RPC ${rpcName} threw:`, error);
        }
    }

    return null;
};

const getLocalNetworkCandidates = () => {
    const candidates = [
        '/api/network',
        'http://127.0.0.1:3001/api/network',
        'http://localhost:3001/api/network',
    ];

    if (window.location.protocol.startsWith('http') && window.location.hostname) {
        candidates.unshift(`${window.location.protocol}//${window.location.hostname}:3001/api/network`);
    }

    return dedupeStrings(candidates);
};

const getLocalCloudRegistryCandidates = (path: string, query = '') => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const suffix = query ? `${normalizedPath}?${query}` : normalizedPath;
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
    localStorage.setItem('CLIC_POS_MASTER_URL', `${protocol}://${host}:${port}`);
    localStorage.setItem('CLIC_POS_MASTER_DISCOVERY', 'CLOUD');
    if (endpoint.lastSeenAt) {
        localStorage.setItem('CLIC_POS_MASTER_LAST_SEEN', endpoint.lastSeenAt);
    }
    if (endpoint.status) {
        localStorage.setItem('CLIC_POS_MASTER_STATUS', endpoint.status);
    }
};

export const resolveMasterEndpointFromCloud = async (identity?: TenantIdentity): Promise<CloudMasterEndpoint | null> => {
    const effectiveIdentity = identity || getStoredTenantIdentity();
    const query = buildResolveQuery(effectiveIdentity);
    if (!query) return null;

    const directEndpoint = await callDirectRpc(DIRECT_RESOLVE_RPC_CANDIDATES, buildRpcPayload(effectiveIdentity));
    if (directEndpoint) {
        persistMasterEndpoint(directEndpoint);
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

            persistMasterEndpoint(endpoint);
            return endpoint;
        } catch (error) {
            console.warn('[cloudMasterRegistry] resolve fallback failed:', url, error);
        }
    }

    return null;
};

export const publishMasterEndpointToCloud = async (payload: {
    deviceId: string;
    terminalId: string;
    terminalName?: string;
    isPrimary?: boolean;
}): Promise<CloudMasterEndpoint | null> => {
    const identity = getStoredTenantIdentity();
    if (!identity.tenantId && !identity.tenantSlug && !identity.tenantEmail) {
        return null;
    }

    const protocol = window.location.protocol.replace(':', '') || 'http';
    const port = 3001;
    const runtimeDeviceInfo = await resolveRuntimeDeviceInfo();
    const runtimeNetworkInfo = await resolveRuntimeNetworkInfo();
    const discoveredLocalIps = await resolveLocalIpv4Addresses();
    const localIps = discoveredLocalIps.length > 0
        ? discoveredLocalIps
        : runtimeNetworkInfo.localIps || [];
    const localIp = localIps[0] || runtimeNetworkInfo.localIp || null;
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
        p_endpoint_url: localIp ? `${protocol}://${localIp}:${port}` : null,
        p_is_primary: payload.isPrimary ?? true,
        p_status: 'ONLINE',
        p_app_version: runtimeDeviceInfo.appVersion,
        p_app_version_code: runtimeDeviceInfo.appVersionCode,
    };

    if (localIp) {
        const directEndpoint =
            await callDirectRpc(DIRECT_PUBLISH_RPC_CANDIDATES, nextRpcPayload, true)
            || await callDirectRpc(DIRECT_PUBLISH_RPC_CANDIDATES, {
                ...nextRpcPayload,
                p_app_version: undefined,
                p_app_version_code: undefined,
            }, true);

        if (directEndpoint) {
            persistMasterEndpoint(directEndpoint);
            return directEndpoint;
        }
    } else {
        console.warn('[cloudMasterRegistry] publish skipped: no se pudo resolver IP LAN del dispositivo.');
    }

    const fallbackBody = JSON.stringify({
        ...identity,
        ...payload,
        protocol,
        port,
        hostname: window.location.hostname,
        localIp,
        localIps,
        appVersion: runtimeDeviceInfo.appVersion,
        appVersionCode: runtimeDeviceInfo.appVersionCode,
    });

    const forwardedHeaders = await buildForwardedCloudHeaders();

    for (const url of getLocalCloudRegistryCandidates('/api/cloud/master-endpoint/publish')) {
        try {
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...forwardedHeaders,
                },
                body: fallbackBody,
            }, 4000);

            if (!response.ok) continue;

            const result = await response.json();
            const endpoint = normalizeEndpointRecord(result?.endpoint as Record<string, any> | undefined);
            if (!endpoint) continue;

            persistMasterEndpoint(endpoint);
            return endpoint;
        } catch (error) {
            console.warn('[cloudMasterRegistry] publish fallback failed:', url, error);
        }
    }

    return null;
};
