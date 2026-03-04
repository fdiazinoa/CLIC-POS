import { supabase } from './supabase';

export interface LicenseStatus {
    isValid: boolean;
    reason?: string;
    tenantId?: string;
}

interface TenantRecord {
    id: string;
    status: string;
}

const LANDLORD_PROFILE = 'landlord';

const getCloudConfig = () => {
    const _meta = import.meta as any;
    const env = _meta?.env || {};
    return {
        supabaseUrl: env.VITE_SUPABASE_URL || localStorage.getItem('CLIC_POS_MASTER_URL'),
        supabaseKey: env.VITE_SUPABASE_ANON_KEY,
    };
};

const buildHeaders = (supabaseKey: string, includeJson = false) => ({
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Accept-Profile': LANDLORD_PROFILE,
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
});

const normalizeValue = (value?: string | null) => (typeof value === 'string' ? value.trim() : '');

const persistTenantIdentity = (tenant: TenantRecord, slug?: string) => {
    localStorage.setItem('clic_tenant_id', tenant.id);
    if (slug) {
        localStorage.setItem('clic_tenant_slug', slug);
    }
};

const fetchTenantRecord = async (
    supabaseUrl: string,
    supabaseKey: string,
    filter: string
): Promise<TenantRecord | null> => {
    const res = await fetch(`${supabaseUrl}/rest/v1/tenants?${filter}&select=id,status&limit=1`, {
        headers: buildHeaders(supabaseKey),
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

export const clearTenantIdentity = () => {
    localStorage.removeItem('clic_tenant_id');
    localStorage.removeItem('clic_tenant_email');
    localStorage.removeItem('clic_tenant_slug');
};

export const resolveTenantRecord = async (preferredTenantId?: string): Promise<TenantRecord | null> => {
    const { supabaseUrl, supabaseKey } = getCloudConfig();

    if (!supabaseUrl || !supabaseKey) {
        return null;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData.session?.user;
    const metadataTenantId = normalizeValue(sessionUser?.user_metadata?.tenant_id);
    const metadataSlug = normalizeValue(sessionUser?.user_metadata?.slug);
    const storedSlug = normalizeValue(localStorage.getItem('clic_tenant_slug'));

    const candidateIds = Array.from(
        new Set(
            [metadataTenantId, normalizeValue(preferredTenantId), normalizeValue(localStorage.getItem('clic_tenant_id'))]
                .filter(Boolean)
        )
    );

    for (const candidateId of candidateIds) {
        const tenant = await fetchTenantRecord(
            supabaseUrl,
            supabaseKey,
            `id=eq.${encodeURIComponent(candidateId)}`
        );

        if (tenant) {
            persistTenantIdentity(tenant, metadataSlug || storedSlug);
            return tenant;
        }
    }

    const candidateSlugs = Array.from(new Set([metadataSlug, storedSlug].filter(Boolean)));

    for (const candidateSlug of candidateSlugs) {
        const tenant = await fetchTenantRecord(
            supabaseUrl,
            supabaseKey,
            `slug=eq.${encodeURIComponent(candidateSlug)}`
        );

        if (tenant) {
            persistTenantIdentity(tenant, candidateSlug);
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

        const tenant = await resolveTenantRecord(tenantId);
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
