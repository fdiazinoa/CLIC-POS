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
    isPrimary?: boolean;
    lastSeenAt?: string | null;
    status?: string | null;
};

const normalizeOptional = (value?: string | null) => {
    if (typeof value !== 'string') return '';
    return value.trim();
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

export const persistMasterEndpoint = (endpoint: CloudMasterEndpoint | null) => {
    if (!endpoint) return;

    const host = normalizeMasterHost(endpoint.localIp || endpoint.endpointUrl || '');
    if (!host) return;

    localStorage.setItem('pos_master_ip', host);
    const protocol = endpoint.protocol || 'http';
    const port = endpoint.port || 3001;
    localStorage.setItem('CLIC_POS_MASTER_URL', `${protocol}://${host}:${port}`);
    localStorage.setItem('CLIC_POS_MASTER_DISCOVERY', endpoint.status || 'CLOUD');
    if (endpoint.lastSeenAt) {
        localStorage.setItem('CLIC_POS_MASTER_LAST_SEEN', endpoint.lastSeenAt);
    }
};

export const resolveMasterEndpointFromCloud = async (identity?: TenantIdentity): Promise<CloudMasterEndpoint | null> => {
    const effectiveIdentity = identity || getStoredTenantIdentity();
    const query = buildResolveQuery(effectiveIdentity);
    if (!query) return null;

    try {
        const response = await fetch(`/api/cloud/master-endpoint/resolve?${query}`);
        if (!response.ok) return null;

        const payload = await response.json();
        const endpoint = payload?.endpoint as CloudMasterEndpoint | undefined;
        if (!endpoint) return null;

        persistMasterEndpoint(endpoint);
        return endpoint;
    } catch (error) {
        console.warn('[cloudMasterRegistry] resolve failed:', error);
        return null;
    }
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

    try {
        const response = await fetch('/api/cloud/master-endpoint/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...identity,
                ...payload,
                protocol: window.location.protocol.replace(':', '') || 'http',
                port: 3001,
                hostname: window.location.hostname,
            }),
        });

        if (!response.ok) return null;

        const result = await response.json();
        return (result?.endpoint as CloudMasterEndpoint | undefined) || null;
    } catch (error) {
        console.warn('[cloudMasterRegistry] publish failed:', error);
        return null;
    }
};
