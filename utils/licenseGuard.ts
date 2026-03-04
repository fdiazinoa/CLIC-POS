import { supabase } from './supabase';

export interface LicenseStatus {
    isValid: boolean;
    reason?: string;
    tenantId?: string;
}

interface TenantRecord {
    id: string;
    status: string;
    slug?: string;
}

interface TenantIdentity {
    tenantId?: string;
    slug?: string;
    email?: string;
}

const LANDLORD_PROFILE = 'landlord';

const getCloudConfig = () => {
    const env = import.meta.env as Record<string, string | boolean | undefined>;
    return {
        supabaseUrl: (env['VITE_SUPABASE_URL'] as string | undefined) || localStorage.getItem('CLIC_POS_MASTER_URL'),
        supabaseKey: env['VITE_SUPABASE_ANON_KEY'] as string | undefined,
    };
};

const buildHeaders = (supabaseKey: string, includeJson = false) => ({
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
});

const buildLandlordHeaders = (supabaseKey: string) => ({
    ...buildHeaders(supabaseKey),
    'Accept-Profile': LANDLORD_PROFILE,
});

const normalizeValue = (value?: string | null) => (typeof value === 'string' ? value.trim() : '');
const normalizeEmail = (value?: string | null) => normalizeValue(value).toLowerCase();

const persistTenantIdentity = (tenant: TenantRecord, slug?: string) => {
    localStorage.setItem('clic_tenant_id', tenant.id);
    const resolvedSlug = slug || tenant.slug;
    if (resolvedSlug) {
        localStorage.setItem('clic_tenant_slug', resolvedSlug);
    }
};

const fetchTenantRecord = async (
    supabaseUrl: string,
    supabaseKey: string,
    filter: string
): Promise<TenantRecord | null> => {
    const res = await fetch(`${supabaseUrl}/rest/v1/tenants?${filter}&select=id,status,slug&limit=1`, {
        headers: buildLandlordHeaders(supabaseKey),
        signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
        throw new Error(`Failed to resolve tenant record (${res.status})`);
    }

    const tenants = await res.json();
    if (!Array.isArray(tenants) || tenants.length === 0) {
        return null;
    }

    return tenants[0] as TenantRecord;
};

const invokeRpc = async (
    supabaseUrl: string,
    supabaseKey: string,
    rpcName: 'get_tenant_status' | 'resolve_tenant_license',
    payload: Record<string, string | null>
): Promise<TenantRecord | null> => {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
        method: 'POST',
        headers: buildHeaders(supabaseKey, true),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
        throw new Error(`Failed to resolve tenant via ${rpcName} (${res.status})`);
    }

    const tenants = await res.json();
    if (!Array.isArray(tenants) || tenants.length === 0) {
        return null;
    }

    return tenants[0] as TenantRecord;
};

export const clearTenantIdentity = () => {
    localStorage.removeItem('clic_tenant_id');
    localStorage.removeItem('clic_tenant_email');
    localStorage.removeItem('clic_tenant_slug');
};

export const resolveTenantRecord = async (identity?: string | TenantIdentity): Promise<TenantRecord | null> => {
    const { supabaseUrl, supabaseKey } = getCloudConfig();

    if (!supabaseUrl || !supabaseKey) {
        return null;
    }

    const preferredIdentity = typeof identity === 'string'
        ? { tenantId: identity }
        : (identity || {});

    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData.session?.user;
    const metadataTenantId = normalizeValue(sessionUser?.user_metadata?.tenant_id);
    const metadataSlug = normalizeValue(sessionUser?.user_metadata?.slug);
    const sessionEmail = normalizeEmail(sessionUser?.email);
    const storedSlug = normalizeValue(localStorage.getItem('clic_tenant_slug'));
    const storedEmail = normalizeEmail(localStorage.getItem('clic_tenant_email'));

    const resolveViaRpc = async (payload: TenantIdentity): Promise<TenantRecord | null> => {
        try {
            return await invokeRpc(supabaseUrl, supabaseKey, 'resolve_tenant_license', {
                p_tenant_id: payload.tenantId || null,
                p_slug: payload.slug || null,
                p_email: payload.email || null,
            });
        } catch (error) {
            console.warn('resolve_tenant_license RPC unavailable, falling back to landlord query', error);
            return null;
        }
    };

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
        const tenant = await resolveViaRpc({ tenantId: candidateId }) || await fetchTenantRecord(
            supabaseUrl,
            supabaseKey,
            `id=eq.${encodeURIComponent(candidateId)}`
        );

        if (tenant) {
            persistTenantIdentity(tenant, metadataSlug || storedSlug);
            return tenant;
        }
    }

    const candidateSlugs = Array.from(
        new Set([normalizeValue(preferredIdentity.slug), metadataSlug, storedSlug].filter(Boolean))
    );

    for (const candidateSlug of candidateSlugs) {
        const tenant = await resolveViaRpc({ slug: candidateSlug }) || await fetchTenantRecord(
            supabaseUrl,
            supabaseKey,
            `slug=eq.${encodeURIComponent(candidateSlug)}`
        );

        if (tenant) {
            persistTenantIdentity(tenant, candidateSlug);
            return tenant;
        }
    }

    const candidateEmails = Array.from(
        new Set([normalizeEmail(preferredIdentity.email), sessionEmail, storedEmail].filter(Boolean))
    );

    for (const candidateEmail of candidateEmails) {
        const tenant = await resolveViaRpc({ email: candidateEmail }) || await fetchTenantRecord(
            supabaseUrl,
            supabaseKey,
            `email=eq.${encodeURIComponent(candidateEmail)}`
        );

        if (tenant) {
            persistTenantIdentity(tenant);
            return tenant;
        }
    }

    return null;
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

        let tenant = tenantId
            ? await invokeRpc(supabaseUrl, supabaseKey, 'get_tenant_status', {
                p_tenant_id: tenantId || null,
            }).catch(async (error) => {
                console.warn('get_tenant_status RPC unavailable, falling back to resolveTenantRecord', error);
                return resolveTenantRecord(tenantId);
            })
            : null;

        if (!tenant) {
            tenant = await resolveTenantRecord(tenantId);
        }

        if (!tenant) {
            return { isValid: true };
        }

        if (tenant.status === 'SUSPENDED') {
            return {
                isValid: false,
                reason: 'Servicio Suspendido. Por favor, contacte a soporte o regularice su pago para restaurar el servicio.',
                tenantId: tenant.id,
            };
        }

        if (deviceId) {
            fetch(`${supabaseUrl}/rest/v1/terminals?device_token=eq.${encodeURIComponent(deviceId)}`, {
                method: 'PATCH',
                headers: {
                    ...buildHeaders(supabaseKey, true),
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
