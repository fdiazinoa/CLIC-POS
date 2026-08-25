import { clearStoredErpSyncBinding } from './erpSyncLifecycle';
import { DEFAULT_PUBLIC_ERP_BASE_URL } from './erpBaseUrl';
import { ensureSupabaseSessionRestored, supabase } from './supabase';

export interface LicenseStatus {
    isValid: boolean;
    reason?: string;
    tenantId?: string;
    branchId?: string;
    checkedAt?: string;
    lastSuccessfulAt?: string | null;
    expiresAt?: string | null;
    source?: 'erp-cloud' | 'erp-cache' | 'pos-cache';
    inGracePeriod?: boolean;
    cloudReachable?: boolean;
    lastCloudError?: string | null;
}

interface TenantRecord {
    id: string;
    status?: string | null;
    slug?: string;
    is_active?: boolean | null;
    active?: boolean | null;
    enabled?: boolean | null;
    suspended?: boolean | null;
    blocked?: boolean | null;
}

interface SubscriptionRecord {
    is_active?: boolean | null;
    status?: string | null;
}

interface TenantIdentity {
    tenantId?: string;
    slug?: string;
    email?: string;
}

interface ErpLicenseStatusResponse {
    tenantId: string;
    branchId: string;
    licensed: boolean;
    reason: string | null;
    checkedAt: string;
    lastSuccessfulAt: string | null;
    expiresAt: string | null;
    source: 'erp-cloud' | 'erp-cache' | 'pos-cache';
    inGracePeriod: boolean;
    cloudReachable: boolean;
    lastCloudError?: string | null;
    activation?: {
        cloud_admin_tenant_id?: string | null;
        tenant_id?: string | null;
    } | null;
}

class LicenseTenantMismatchError extends Error {
    constructor() {
        super('ERP license response does not match the requested tenant');
        this.name = 'LicenseTenantMismatchError';
    }
}

const LANDLORD_PROFILE = 'landlord';
const BLOCKED_STATUSES = new Set([
    'SUSPENDED',
    'INACTIVE',
    'DISABLED',
    'BLOCKED',
    'CANCELLED',
    'CANCELED',
    'PAST_DUE',
    'EXPIRED',
]);

const POS_LICENSE_CACHE_KEY = 'clic:license:last-success';
const POS_LICENSE_GRACE_PERIOD_MS = 15 * 60_000;
const LICENSE_VALIDATION_UNAVAILABLE_MESSAGE = 'No se pudo validar la licencia. Verifique la conexión y reintente.';

const normalizeBaseUrl = (value?: string | null): string | null => {
    const raw = normalizeValue(value);
    if (!raw) return null;

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `${window.location.protocol}//${raw}`;

    try {
        const url = new URL(withProtocol);
        return url
            .toString()
            .replace(/\/api\/sync\/?$/i, '')
            .replace(/\/api\/?$/i, '')
            .replace(/\/+$/, '');
    } catch {
        return null;
    }
};

const resolveLicenseEndpointBaseUrl = (): string | null => {
    const env = (import.meta.env || {}) as Record<string, string | boolean | undefined>;
    const candidates = [
        localStorage.getItem('CLIC_ERP_BASE_URL'),
        localStorage.getItem('erp_base_url'),
        localStorage.getItem('CLIC_POS_MASTER_URL'),
        env['VITE_ERP_BASE_URL'] as string | undefined,
        env['VITE_ERP_SYNC_API_URL'] as string | undefined,
        env['VITE_SYNC_API_URL'] as string | undefined,
        DEFAULT_PUBLIC_ERP_BASE_URL,
    ];

    for (const candidate of candidates) {
        const normalized = normalizeBaseUrl(candidate);
        if (normalized) {
            return normalized;
        }
    }

    return null;
};

const safeParseJson = <T>(raw: string | null): T | null => {
    if (!raw) return null;

    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
};

const toTimestamp = (value?: string | null): number | null => {
    if (!value) return null;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
};

const isWithinGracePeriod = (lastSuccessfulAt?: string | null): boolean => {
    const ts = toTimestamp(lastSuccessfulAt);
    if (!ts) return false;
    return Date.now() - ts <= POS_LICENSE_GRACE_PERIOD_MS;
};

const getTenantLicenseCacheKey = (tenantId: string) => (
    `${POS_LICENSE_CACHE_KEY}:${normalizeValue(tenantId).toLowerCase()}`
);

const licenseStatusMatchesTenant = (status: ErpLicenseStatusResponse, tenantId: string): boolean => {
    const normalizedTenantId = normalizeValue(tenantId).toLowerCase();
    if (!normalizedTenantId) return false;

    return [
        status.tenantId,
        status.activation?.tenant_id,
        status.activation?.cloud_admin_tenant_id,
    ]
        .map((value) => normalizeValue(value).toLowerCase())
        .filter(Boolean)
        .includes(normalizedTenantId);
};

const readCachedLicenseStatus = (tenantId: string): ErpLicenseStatusResponse | null => {
    const scoped = safeParseJson<ErpLicenseStatusResponse>(
        localStorage.getItem(getTenantLicenseCacheKey(tenantId))
    );
    if (scoped && licenseStatusMatchesTenant(scoped, tenantId)) {
        return scoped;
    }

    const legacy = safeParseJson<ErpLicenseStatusResponse>(localStorage.getItem(POS_LICENSE_CACHE_KEY));
    if (legacy && licenseStatusMatchesTenant(legacy, tenantId)) {
        localStorage.setItem(getTenantLicenseCacheKey(tenantId), JSON.stringify(legacy));
        return legacy;
    }

    return null;
};

const writeCachedLicenseStatus = (tenantId: string, status: ErpLicenseStatusResponse) => {
    if (!status.lastSuccessfulAt || !licenseStatusMatchesTenant(status, tenantId)) return;
    localStorage.setItem(getTenantLicenseCacheKey(tenantId), JSON.stringify(status));
};

const mapErpLicenseStatus = (status: ErpLicenseStatusResponse): LicenseStatus => ({
    isValid: status.licensed,
    reason: status.reason || undefined,
    tenantId: status.tenantId,
    branchId: status.branchId,
    checkedAt: status.checkedAt,
    lastSuccessfulAt: status.lastSuccessfulAt,
    expiresAt: status.expiresAt,
    source: status.source,
    inGracePeriod: status.inGracePeriod,
    cloudReachable: status.cloudReachable,
    lastCloudError: status.lastCloudError || null,
});

const buildLicenseQuery = (tenantId: string, deviceId: string) => {
    const params = new URLSearchParams();
    const normalizedTenantId = normalizeValue(tenantId) || normalizeValue(localStorage.getItem('clic_tenant_id'));
    const normalizedDeviceId = normalizeValue(deviceId) || normalizeValue(localStorage.getItem('pos_device_id'));
    const normalizedBranchId = [
        localStorage.getItem('clic_branch_id'),
        localStorage.getItem('clic_store_id'),
        localStorage.getItem('clic_erp_sync_store_id'),
    ]
        .map(normalizeValue)
        .find(isUuid);

    if (normalizedTenantId) params.set('tenantId', normalizedTenantId);
    if (normalizedDeviceId) params.set('deviceId', normalizedDeviceId);
    if (normalizedBranchId) params.set('branchId', normalizedBranchId);
    return params.toString();
};

const fetchLicenseStatusFromErp = async (
    tenantId: string,
    deviceId: string,
    timeoutMs = 3500,
    bypassCache = false,
): Promise<ErpLicenseStatusResponse> => {
    const erpBaseUrl = resolveLicenseEndpointBaseUrl();
    if (!erpBaseUrl) {
        throw new Error('ERP license endpoint base URL is not configured');
    }

    const query = new URLSearchParams(buildLicenseQuery(tenantId, deviceId));
    if (bypassCache) {
        query.set('_licenseCheck', `${Date.now()}`);
    }

    const response = await fetchWithTimeout(
        `${erpBaseUrl}/api/license/status?${query.toString()}`,
        {
            method: 'GET',
            credentials: 'omit',
            cache: 'no-store',
            headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-cache',
            },
        },
        timeoutMs
    );

    const payload = await response.json().catch(() => null) as ErpLicenseStatusResponse | null;
    if (!response.ok || !payload) {
        throw new Error(`ERP license endpoint failed with HTTP ${response.status}`);
    }

    if (!licenseStatusMatchesTenant(payload, tenantId)) {
        throw new LicenseTenantMismatchError();
    }

    if (payload.lastSuccessfulAt) {
        writeCachedLicenseStatus(tenantId, payload);
    }

    return payload;
};

const getCloudConfig = () => {
    const env = (import.meta.env || {}) as Record<string, string | boolean | undefined>;
    return {
        supabaseUrl: (env['VITE_SUPABASE_URL'] as string | undefined) || localStorage.getItem('CLIC_POS_MASTER_URL'),
        supabaseKey: env['VITE_SUPABASE_ANON_KEY'] as string | undefined,
    };
};

const buildApiHeaders = (supabaseKey: string, includeJson = false) => ({
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
});

const buildLandlordHeaders = (supabaseKey: string, includeJson = false) => ({
    ...buildApiHeaders(supabaseKey, includeJson),
    'Accept-Profile': LANDLORD_PROFILE,
});

const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 5000) => {
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

const normalizeValue = (value?: string | null) => (typeof value === 'string' ? value.trim() : '');
const normalizeEmail = (value?: string | null) => normalizeValue(value).toLowerCase();
const normalizeStatus = (value?: string | null) => normalizeValue(value).toUpperCase();
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isTenantBlocked = (tenant: TenantRecord): boolean => {
    const normalizedStatus = normalizeStatus(tenant.status);

    if (normalizedStatus && BLOCKED_STATUSES.has(normalizedStatus)) {
        return true;
    }
    if (tenant.suspended === true || tenant.blocked === true) {
        return true;
    }
    if (tenant.is_active === false || tenant.active === false || tenant.enabled === false) {
        return true;
    }

    return false;
};

const hasExplicitlyInactiveSubscription = (subscriptions: SubscriptionRecord[]): boolean => {
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        return false;
    }

    const hasActiveSubscription = subscriptions.some((subscription) => {
        if (subscription.is_active === true) return true;
        const normalizedStatus = normalizeStatus(subscription.status);
        return normalizedStatus === 'ACTIVE' || normalizedStatus === 'TRIAL';
    });

    if (hasActiveSubscription) {
        return false;
    }

    return subscriptions.some((subscription) => {
        if (subscription.is_active === false) return true;
        const normalizedStatus = normalizeStatus(subscription.status);
        return Boolean(normalizedStatus && BLOCKED_STATUSES.has(normalizedStatus));
    });
};

const persistTenantIdentity = (tenant: TenantRecord, slug?: string) => {
    localStorage.setItem('clic_tenant_id', tenant.id);
    const resolvedSlug = slug || tenant.slug;
    if (resolvedSlug) {
        localStorage.setItem('clic_tenant_slug', resolvedSlug);
    }
};

const fetchTenantRecordViaRpc = async (
    supabaseUrl: string,
    supabaseKey: string,
    identity: TenantIdentity
): Promise<TenantRecord | null> => {
    const payload = {
        p_tenant_id: normalizeValue(identity.tenantId) || null,
        p_slug: normalizeValue(identity.slug) || null,
        p_email: normalizeEmail(identity.email) || null,
    };

    if (!payload.p_tenant_id && !payload.p_slug && !payload.p_email) {
        return null;
    }

    const res = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/resolve_tenant_license`, {
        method: 'POST',
        headers: buildApiHeaders(supabaseKey, true),
        body: JSON.stringify(payload),
    });

    if (res.status === 404 || res.status === 401 || res.status === 403) {
        // 404: RPC not deployed yet. 401/403: grants not in place.
        return null;
    }

    if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
            return null;
        }
        throw new Error(`Failed to resolve tenant via RPC (${res.status})`);
    }

    const tenants = await res.json();
    if (!Array.isArray(tenants) || tenants.length === 0) {
        return null;
    }

    return tenants[0] as TenantRecord;
};

const fetchTenantRecordLegacy = async (
    supabaseUrl: string,
    supabaseKey: string,
    filter: string
): Promise<TenantRecord | null> => {
    const res = await fetchWithTimeout(`${supabaseUrl}/rest/v1/tenants?${filter}&select=id,status,slug&limit=1`, {
        headers: buildLandlordHeaders(supabaseKey),
    });

    if (res.status === 401 || res.status === 403) {
        return null;
    }

    if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
            return null;
        }
        throw new Error(`Failed to resolve tenant record via legacy query (${res.status})`);
    }

    const tenants = await res.json();
    if (!Array.isArray(tenants) || tenants.length === 0) {
        return null;
    }

    return tenants[0] as TenantRecord;
};

const fetchTenantStatusById = async (
    supabaseUrl: string,
    supabaseKey: string,
    tenantId: string
): Promise<TenantRecord | null> => {
    const res = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/get_tenant_status`, {
        method: 'POST',
        headers: buildApiHeaders(supabaseKey, true),
        body: JSON.stringify({ p_tenant_id: tenantId }),
    });

    if (res.status === 401 || res.status === 403 || res.status === 404) {
        return null;
    }

    if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
            return null;
        }
        throw new Error(`Failed to resolve tenant status via get_tenant_status RPC (${res.status})`);
    }

    const tenants = await res.json();
    if (!Array.isArray(tenants) || tenants.length === 0) {
        return null;
    }

    return tenants[0] as TenantRecord;
};

const fetchSubscriptionRecords = async (
    supabaseUrl: string,
    supabaseKey: string,
    tenantId: string
): Promise<SubscriptionRecord[] | null> => {
    const res = await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/subscriptions?tenant_id=eq.${encodeURIComponent(tenantId)}&select=is_active`,
        {
            headers: buildLandlordHeaders(supabaseKey),
        }
    );

    if (res.status === 401 || res.status === 403 || res.status === 404) {
        return null;
    }

    if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
            return null;
        }
        throw new Error(`Failed to resolve subscription status (${res.status})`);
    }

    const subscriptions = await res.json();
    return Array.isArray(subscriptions) ? (subscriptions as SubscriptionRecord[]) : null;
};

export const clearTenantIdentity = () => {
    localStorage.removeItem('clic_tenant_id');
    localStorage.removeItem('clic_tenant_email');
    localStorage.removeItem('clic_tenant_slug');
    clearStoredErpSyncBinding();
};

export const resolveTenantRecord = async (identity?: string | TenantIdentity): Promise<TenantRecord | null> => {
    try {
        const { supabaseUrl, supabaseKey } = getCloudConfig();

        if (!supabaseUrl || !supabaseKey) {
            return null;
        }

        const preferredIdentity = typeof identity === 'string'
            ? { tenantId: identity }
            : (identity || {});

        await ensureSupabaseSessionRestored();
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionUser = sessionData.session?.user;
        const metadataTenantId = normalizeValue(sessionUser?.user_metadata?.tenant_id);
        const metadataSlug = normalizeValue(sessionUser?.user_metadata?.slug);
        const sessionEmail = normalizeEmail(sessionUser?.email);
        const storedSlug = normalizeValue(localStorage.getItem('clic_tenant_slug'));
        const storedEmail = normalizeEmail(localStorage.getItem('clic_tenant_email'));

        const candidateIds = Array.from(
            new Set(
                [
                    metadataTenantId,
                    normalizeValue(preferredIdentity.tenantId),
                    normalizeValue(localStorage.getItem('clic_tenant_id'))
                ]
                    .filter(Boolean)
            )
        );

        for (const candidateId of candidateIds) {
            if (!isUuid(candidateId)) continue;

            const tenant =
                (await fetchTenantRecordViaRpc(supabaseUrl, supabaseKey, { tenantId: candidateId })) ??
                (await fetchTenantRecordLegacy(
                    supabaseUrl,
                    supabaseKey,
                    `id=eq.${encodeURIComponent(candidateId)}`
                )) ??
                (await fetchTenantStatusById(supabaseUrl, supabaseKey, candidateId));

            if (tenant) {
                persistTenantIdentity(tenant, metadataSlug || storedSlug);
                return tenant;
            }
        }

        const candidateSlugs = Array.from(
            new Set([normalizeValue(preferredIdentity.slug), metadataSlug, storedSlug].filter(Boolean))
        );

        for (const candidateSlug of candidateSlugs) {
            const tenant =
                (await fetchTenantRecordViaRpc(supabaseUrl, supabaseKey, { slug: candidateSlug })) ??
                (await fetchTenantRecordLegacy(
                    supabaseUrl,
                    supabaseKey,
                    `slug=eq.${encodeURIComponent(candidateSlug)}`
                ));

            if (tenant) {
                persistTenantIdentity(tenant, candidateSlug);
                return tenant;
            }
        }

        const candidateEmails = Array.from(
            new Set([normalizeEmail(preferredIdentity.email), sessionEmail, storedEmail].filter(Boolean))
        );

        for (const candidateEmail of candidateEmails) {
            const tenant =
                (await fetchTenantRecordViaRpc(supabaseUrl, supabaseKey, { email: candidateEmail })) ??
                (await fetchTenantRecordLegacy(
                    supabaseUrl,
                    supabaseKey,
                    `email=eq.${encodeURIComponent(candidateEmail)}`
                ));

            if (tenant) {
                persistTenantIdentity(tenant);
                return tenant;
            }
        }

        return null;
    } catch (error) {
        console.warn('Tenant resolution failed, continuing with offline-safe fallback:', error);
        return null;
    }
};

export const resolveTenantId = async (preferredTenantId?: string): Promise<string | null> => {
    const requestedTenantId = normalizeValue(preferredTenantId)
        || normalizeValue(localStorage.getItem('clic_tenant_id'));
    const cached = requestedTenantId ? readCachedLicenseStatus(requestedTenantId) : null;
    if (cached?.tenantId) {
        return cached.tenantId;
    }

    const tenant = await resolveTenantRecord(preferredTenantId);
    return tenant?.id || null;
};

export const checkLicenseStatus = async (
    tenantId: string,
    deviceId: string
): Promise<LicenseStatus> => {
    try {
        let status: ErpLicenseStatusResponse;
        try {
            status = await fetchLicenseStatusFromErp(tenantId, deviceId);
        } catch (error) {
            if (!(error instanceof LicenseTenantMismatchError)) throw error;
            console.warn('[licenseGuard] LICENSE_TENANT_MISMATCH_RETRY', {
                requestedTenantId: normalizeValue(tenantId),
            });
            status = await fetchLicenseStatusFromErp(tenantId, deviceId, 3500, true);
        }
        return mapErpLicenseStatus(status);
    } catch (error) {
        const cached = readCachedLicenseStatus(tenantId);
        if (cached && cached.licensed === false) {
            console.warn('[licenseGuard] CACHED_LICENSE_BLOCK_ACTIVE', {
                reason: cached.reason,
                lastSuccessfulAt: cached.lastSuccessfulAt,
                lastCloudError: error instanceof Error ? error.message : String(error),
            });

            return mapErpLicenseStatus({
                ...cached,
                source: 'pos-cache',
                inGracePeriod: false,
                cloudReachable: false,
                checkedAt: new Date().toISOString(),
                lastCloudError: error instanceof Error ? error.message : String(error),
            });
        }

        if (cached?.licensed === true && isWithinGracePeriod(cached.lastSuccessfulAt)) {
            const lastSuccessfulTs = toTimestamp(cached.lastSuccessfulAt);
            const gracePeriodRemainingMs = lastSuccessfulTs
                ? Math.max(0, POS_LICENSE_GRACE_PERIOD_MS - (Date.now() - lastSuccessfulTs))
                : 0;

            // Grace Period + fallback a caché POS para que el POS no dependa del cloud directo.
            console.warn('[licenseGuard] GRACE_PERIOD_ACTIVE', {
                source: 'pos-cache',
                lastSuccessfulAt: cached.lastSuccessfulAt,
                gracePeriodRemainingMs,
                lastCloudError: error instanceof Error ? error.message : String(error),
            });

            return mapErpLicenseStatus({
                ...cached,
                source: 'pos-cache',
                inGracePeriod: true,
                cloudReachable: false,
                checkedAt: new Date().toISOString(),
                lastCloudError: error instanceof Error ? error.message : String(error),
            });
        }

        console.warn('[licenseGuard] LICENSE_VALIDATION_UNAVAILABLE_BLOCKING', {
            lastSuccessfulAt: cached?.lastSuccessfulAt || null,
            lastCloudError: error instanceof Error ? error.message : String(error),
        });
        return {
            isValid: false,
            tenantId: normalizeValue(tenantId) || normalizeValue(localStorage.getItem('clic_tenant_id')) || undefined,
            reason: LICENSE_VALIDATION_UNAVAILABLE_MESSAGE,
            source: 'pos-cache',
            inGracePeriod: false,
            cloudReachable: false,
            lastCloudError: error instanceof Error ? error.message : String(error),
            checkedAt: new Date().toISOString(),
            lastSuccessfulAt: cached?.lastSuccessfulAt || null,
            expiresAt: cached?.expiresAt || null,
        };
    }
};
