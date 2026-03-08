import { ensureSupabaseSessionRestored, supabase } from './supabase';
import { clearStoredErpSyncBinding } from './erpSyncLifecycle';

export interface LicenseStatus {
    isValid: boolean;
    reason?: string;
    tenantId?: string;
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

const getCloudConfig = () => {
    const env = import.meta.env as Record<string, string | boolean | undefined>;
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
        `${supabaseUrl}/rest/v1/subscriptions?tenant_id=eq.${encodeURIComponent(tenantId)}&select=is_active,status`,
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
    const tenant = await resolveTenantRecord(preferredTenantId);
    return tenant?.id || null;
};

export const checkLicenseStatus = async (
    tenantId: string,
    deviceId: string
): Promise<LicenseStatus> => {
    try {
        const { supabaseUrl, supabaseKey } = getCloudConfig();

        if (!supabaseUrl || !supabaseKey) {
            // Failsafe: Si no hay credenciales de la nube configuradas localmente, asumimos modo on-premise puro.
            console.warn("No Cloud Supabase configuration found. License check bypassed.");
            return { isValid: true };
        }

        const storedEmail = normalizeEmail(localStorage.getItem('clic_tenant_email'));
        const storedSlug = normalizeValue(localStorage.getItem('clic_tenant_slug'));
        const tenant = await resolveTenantRecord({
            tenantId,
            email: storedEmail || undefined,
            slug: storedSlug || undefined,
        });
        if (!tenant) {
            console.warn('[LICENSE] Tenant could not be resolved. Allowing offline-safe usage.');
            return { isValid: true };
        }

        if (isTenantBlocked(tenant)) {
            console.warn('[LICENSE] Tenant is blocked:', tenant.id, tenant.status);
            return {
                isValid: false,
                reason: 'Servicio Suspendido. Por favor, contacte a soporte o regularice su pago para restaurar el servicio.',
                tenantId: tenant.id,
            };
        }

        const subscriptions = await fetchSubscriptionRecords(supabaseUrl, supabaseKey, tenant.id);
        if (subscriptions && hasExplicitlyInactiveSubscription(subscriptions)) {
            console.warn('[LICENSE] Subscription inactive for tenant:', tenant.id);
            return {
                isValid: false,
                reason: 'Suscripción inactiva. Active el tenant en Cloud Admin para continuar.',
                tenantId: tenant.id,
            };
        }

        if (deviceId) {
            fetch(`${supabaseUrl}/rest/v1/terminals?device_token=eq.${encodeURIComponent(deviceId)}`, {
                method: 'PATCH',
                headers: {
                    ...buildApiHeaders(supabaseKey, true),
                    Prefer: 'return=minimal',
                },
                body: JSON.stringify({ last_checkin_at: new Date().toISOString() }),
            }).catch(e => console.warn("Check-in silenciado falló", e));
        }

        return { isValid: true, tenantId: tenant.id };
    } catch (error) {
        console.error("License validation local network/fetch fail, allowing offline tolerance usage: ", error);
        // Tolerancia a fallos: permitimos operar de forma offline si la red se corta y no se pudo validar
        return { isValid: true };
    }
};
