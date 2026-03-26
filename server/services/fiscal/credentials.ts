import { getSetting, saveSetting } from '../../db.js';
import { FiscalCompanyInfo, FiscalCredentialSource, FiscalProviderId } from './providers/base.js';

interface StoredFiscalCredential {
    authToken: string;
    label?: string;
    updatedAt: string;
}

interface StoredProviderCredentialBucket {
    defaultCredential?: StoredFiscalCredential;
    companyCredentials?: Record<string, StoredFiscalCredential>;
}

interface FiscalCredentialStore {
    version: 1;
    providers: Partial<Record<FiscalProviderId, StoredProviderCredentialBucket>>;
}

export interface ResolvedFiscalCredential {
    authToken: string;
    source: FiscalCredentialSource;
    resolvedCredentialKey?: string;
}

export interface FiscalCredentialMeta {
    providerId: FiscalProviderId;
    hasCredential: boolean;
    source?: FiscalCredentialSource;
    resolvedCredentialKey?: string;
    updatedAt?: string;
    label?: string;
    availableSources?: FiscalCredentialSource[];
    hasLocalCredential?: boolean;
    hasSupabaseCredential?: boolean;
    hasEnvCredential?: boolean;
    supportsSupabaseWrite?: boolean;
}

const SETTINGS_KEY = 'fiscalProviderCredentials';
const DEFAULT_CREDENTIAL_KEY = 'DEFAULT';

const cleanString = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';

export const normalizeFiscalCredentialKey = (value: unknown): string =>
    cleanString(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase();

export const deriveFiscalCredentialKey = (
    companyInfo?: FiscalCompanyInfo,
    explicitCredentialKey?: string
): string | undefined => {
    const explicit = normalizeFiscalCredentialKey(explicitCredentialKey);
    if (explicit) return explicit;

    const companyRnc = normalizeFiscalCredentialKey(companyInfo?.rnc);
    return companyRnc || undefined;
};

const getCredentialStore = (): FiscalCredentialStore => {
    const raw = getSetting(SETTINGS_KEY);
    if (raw?.providers && typeof raw.providers === 'object') {
        return {
            version: 1,
            providers: raw.providers
        };
    }

    return {
        version: 1,
        providers: {}
    };
};

const getSupabaseConfig = () => {
    const supabaseUrl = cleanString(process.env.SUPABASE_URL);
    const serviceRoleKey = cleanString(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const tableName = cleanString(process.env.FISCAL_SUPABASE_CREDENTIALS_TABLE) || 'fiscal_provider_credentials';

    return {
        supabaseUrl,
        serviceRoleKey,
        tableName,
        isConfigured: Boolean(supabaseUrl && serviceRoleKey)
    };
};

const requireSupabaseConfig = () => {
    const config = getSupabaseConfig();
    if (!config.isConfigured) {
        throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorios para escribir credenciales en Supabase.');
    }
    return config;
};

export const saveLocalFiscalCredential = (
    providerId: FiscalProviderId,
    authToken: string,
    credentialKey?: string,
    label?: string
) => {
    const normalizedAuthToken = cleanString(authToken);
    if (!normalizedAuthToken) {
        throw new Error('authToken es obligatorio para guardar la credencial fiscal.');
    }

    const store = getCredentialStore();
    const bucket = store.providers[providerId] || {};
    const normalizedCredentialKey = deriveFiscalCredentialKey(undefined, credentialKey);
    const nextCredential: StoredFiscalCredential = {
        authToken: normalizedAuthToken,
        label: cleanString(label) || undefined,
        updatedAt: new Date().toISOString()
    };

    if (normalizedCredentialKey) {
        bucket.companyCredentials = {
            ...(bucket.companyCredentials || {}),
            [normalizedCredentialKey]: nextCredential
        };
    } else {
        bucket.defaultCredential = nextCredential;
    }

    store.providers[providerId] = bucket;
    saveSetting(SETTINGS_KEY, store);
};

export const deleteLocalFiscalCredential = (
    providerId: FiscalProviderId,
    credentialKey?: string
) => {
    const store = getCredentialStore();
    const bucket = store.providers[providerId];
    if (!bucket) return;

    const normalizedCredentialKey = deriveFiscalCredentialKey(undefined, credentialKey);
    if (normalizedCredentialKey && bucket.companyCredentials?.[normalizedCredentialKey]) {
        delete bucket.companyCredentials[normalizedCredentialKey];
    } else if (!normalizedCredentialKey) {
        delete bucket.defaultCredential;
    }

    if (bucket.companyCredentials && Object.keys(bucket.companyCredentials).length === 0) {
        delete bucket.companyCredentials;
    }

    if (!bucket.defaultCredential && !bucket.companyCredentials) {
        delete store.providers[providerId];
    } else {
        store.providers[providerId] = bucket;
    }

    saveSetting(SETTINGS_KEY, store);
};

const getLocalStoredFiscalCredential = (
    providerId: FiscalProviderId,
    resolvedCredentialKey?: string
): { credential: StoredFiscalCredential; resolvedCredentialKey?: string } | null => {
    const store = getCredentialStore();
    const bucket = store.providers[providerId];
    if (!bucket) return null;

    const localCredential = resolvedCredentialKey
        ? bucket.companyCredentials?.[resolvedCredentialKey]
        : undefined;
    const fallbackCredential = bucket.defaultCredential;
    const credential = localCredential || fallbackCredential;
    if (!credential?.authToken) return null;

    return {
        credential,
        resolvedCredentialKey: localCredential ? resolvedCredentialKey : undefined
    };
};

const getLocalFiscalCredential = (
    providerId: FiscalProviderId,
    resolvedCredentialKey?: string
): ResolvedFiscalCredential | null => {
    const local = getLocalStoredFiscalCredential(providerId, resolvedCredentialKey);
    if (!local) return null;

    return {
        authToken: local.credential.authToken,
        source: 'sqlite',
        resolvedCredentialKey: local.resolvedCredentialKey
    };
};

const fetchSupabaseCredential = async (
    providerId: FiscalProviderId,
    resolvedCredentialKey?: string
): Promise<ResolvedFiscalCredential | null> => {
    const { supabaseUrl, serviceRoleKey, tableName, isConfigured } = getSupabaseConfig();
    if (!isConfigured) return null;

    const candidates = resolvedCredentialKey
        ? [resolvedCredentialKey, DEFAULT_CREDENTIAL_KEY]
        : [DEFAULT_CREDENTIAL_KEY];

    for (const candidateKey of candidates) {
        const query = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${tableName}`);
        query.searchParams.set('select', 'provider_id,company_key,auth_token,is_active');
        query.searchParams.set('provider_id', `eq.${providerId}`);
        query.searchParams.set('company_key', `eq.${candidateKey}`);
        query.searchParams.set('limit', '1');

        try {
            const response = await fetch(query.toString(), {
                headers: {
                    apikey: serviceRoleKey,
                    Authorization: `Bearer ${serviceRoleKey}`
                }
            });

            if (!response.ok) continue;

            const rows = await response.json().catch(() => []);
            const record = Array.isArray(rows) ? rows[0] : null;
            if (!record || record.is_active === false) continue;

            const authToken = cleanString(record.auth_token);
            if (!authToken) continue;

            return {
                authToken,
                source: 'supabase',
                resolvedCredentialKey: candidateKey !== DEFAULT_CREDENTIAL_KEY ? candidateKey : undefined
            };
        } catch (error) {
            console.warn('⚠️ [Fiscal] Supabase credential lookup failed:', error);
        }
    }

    return null;
};

export const saveSupabaseFiscalCredential = async (
    providerId: FiscalProviderId,
    authToken: string,
    credentialKey?: string
) => {
    const normalizedAuthToken = cleanString(authToken);
    if (!normalizedAuthToken) {
        throw new Error('authToken es obligatorio para guardar la credencial en Supabase.');
    }

    const { supabaseUrl, serviceRoleKey, tableName } = requireSupabaseConfig();
    const companyKey = deriveFiscalCredentialKey(undefined, credentialKey) || DEFAULT_CREDENTIAL_KEY;
    const endpoint = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${tableName}`);
    endpoint.searchParams.set('on_conflict', 'provider_id,company_key');

    const response = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify([{
            provider_id: providerId,
            company_key: companyKey,
            auth_token: normalizedAuthToken,
            is_active: true
        }])
    });

    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(`No se pudo guardar la credencial en Supabase: ${message || `HTTP ${response.status}`}`);
    }
};

export const deleteSupabaseFiscalCredential = async (
    providerId: FiscalProviderId,
    credentialKey?: string
) => {
    const { supabaseUrl, serviceRoleKey, tableName } = requireSupabaseConfig();
    const companyKey = deriveFiscalCredentialKey(undefined, credentialKey) || DEFAULT_CREDENTIAL_KEY;
    const endpoint = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${tableName}`);
    endpoint.searchParams.set('provider_id', `eq.${providerId}`);
    endpoint.searchParams.set('company_key', `eq.${companyKey}`);

    const response = await fetch(endpoint.toString(), {
        method: 'DELETE',
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`
        }
    });

    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(`No se pudo eliminar la credencial en Supabase: ${message || `HTTP ${response.status}`}`);
    }
};

export const inspectFiscalProviderCredential = async (
    providerId: FiscalProviderId,
    companyInfo?: FiscalCompanyInfo,
    credentialKey?: string
): Promise<FiscalCredentialMeta> => {
    const resolvedCredentialKey = deriveFiscalCredentialKey(companyInfo, credentialKey);
    const local = getLocalStoredFiscalCredential(providerId, resolvedCredentialKey);
    const supabaseCredential = await fetchSupabaseCredential(providerId, resolvedCredentialKey);
    const envAuthToken = cleanString(process.env.POLARIS_AUTH_TOKEN);
    const hasEnvCredential = providerId === 'POLARIS' && Boolean(envAuthToken);
    const availableSources: FiscalCredentialSource[] = [];
    if (local) availableSources.push('sqlite');
    if (supabaseCredential) availableSources.push('supabase');
    if (hasEnvCredential) availableSources.push('env');

    const source = availableSources[0];

    return {
        providerId,
        hasCredential: availableSources.length > 0,
        source,
        resolvedCredentialKey: local?.resolvedCredentialKey || supabaseCredential?.resolvedCredentialKey || resolvedCredentialKey,
        updatedAt: local?.credential.updatedAt,
        label: local?.credential.label,
        availableSources,
        hasLocalCredential: Boolean(local),
        hasSupabaseCredential: Boolean(supabaseCredential),
        hasEnvCredential,
        supportsSupabaseWrite: getSupabaseConfig().isConfigured
    };
};

export const resolveFiscalProviderCredential = async (
    providerId: FiscalProviderId,
    companyInfo?: FiscalCompanyInfo,
    credentialKey?: string
): Promise<ResolvedFiscalCredential> => {
    const resolvedCredentialKey = deriveFiscalCredentialKey(companyInfo, credentialKey);

    const localCredential = getLocalFiscalCredential(providerId, resolvedCredentialKey);
    if (localCredential) return localCredential;

    const supabaseCredential = await fetchSupabaseCredential(providerId, resolvedCredentialKey);
    if (supabaseCredential) return supabaseCredential;

    const envAuthToken = cleanString(process.env.POLARIS_AUTH_TOKEN);
    if (providerId === 'POLARIS' && envAuthToken) {
        return {
            authToken: envAuthToken,
            source: 'env',
            resolvedCredentialKey
        };
    }

    const keyHint = resolvedCredentialKey ? ` para la clave ${resolvedCredentialKey}` : '';
    throw new Error(`No se encontró credencial fiscal de ${providerId}${keyHint}. Revisé sqlite, Supabase y variables de entorno.`);
};
