import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { CompanyInfo, FiscalProviderId, Transaction } from '../../types';
import { buildMasterUrlFromHost, resolveMasterEndpointFromCloud } from '../../utils/cloudMasterRegistry';
import { db } from '../../utils/db';

export interface FiscalCredentialMetaResponse {
    providerId: FiscalProviderId;
    hasCredential: boolean;
    source?: 'env' | 'sqlite' | 'supabase';
    resolvedCredentialKey?: string;
    updatedAt?: string;
    label?: string;
    availableSources?: Array<'env' | 'sqlite' | 'supabase'>;
    hasLocalCredential?: boolean;
    hasSupabaseCredential?: boolean;
    hasEnvCredential?: boolean;
    supportsSupabaseWrite?: boolean;
}

export interface FiscalCredentialMutationResponse {
    success: boolean;
    message: string;
    meta?: FiscalCredentialMetaResponse;
}

export interface FiscalIssueResponse {
    success: boolean;
    providerId: FiscalProviderId;
    environment: number;
    documentCode: 'E31' | 'E32' | 'E34';
    providerTransactionId?: string;
    status?: string;
    message: string;
    pending?: boolean;
    raw?: unknown;
}

export interface FiscalStatusResponse {
    success: boolean;
    providerId: FiscalProviderId;
    environment: number;
    providerTransactionId: string;
    status?: string;
    message: string;
    pending?: boolean;
    raw?: unknown;
}

interface IssueFiscalDocumentInput {
    providerId: FiscalProviderId;
    environment: number;
    companyInfo: CompanyInfo;
    transaction: Transaction;
    taxRate?: number;
    sequenceExpiryDate?: string;
    credentialKey?: string;
    tipoIngreso?: number;
    modificationCode?: number;
    unitCodeGoods?: number;
    unitCodeServices?: number;
}

const isNativeAndroidRuntime = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
const FISCAL_BACKEND_BASE_KEY = 'CLIC_POS_FISCAL_BASE_URL';
const LOCAL_FISCAL_CREDENTIAL_COLLECTION = 'fiscalCredentials';
const POLARIS_API_BASE = 'https://api.polarisedi.com';

interface LocalFiscalCredentialRecord {
    id: string;
    providerId: FiscalProviderId;
    companyRnc?: string;
    credentialKey?: string;
    authToken: string;
    label?: string;
    updatedAt: string;
}

const normalizeBaseUrl = (value?: string | null): string | null => {
    const raw = String(value || '').trim();
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

const uniqueStrings = (values: Array<string | null | undefined>) =>
    Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));

const normalizeCredentialKey = (value?: string | null) =>
    String(value || '').trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const deriveCredentialKey = (companyInfo?: CompanyInfo, credentialKey?: string) => {
    const explicit = normalizeCredentialKey(credentialKey);
    if (explicit) return explicit;
    const companyKey = normalizeCredentialKey(companyInfo?.rnc);
    return companyKey || undefined;
};

const buildLocalCredentialRecordId = (providerId: FiscalProviderId, credentialKey?: string) =>
    `${providerId}:${credentialKey || 'DEFAULT'}`;

const pickNewestCredentialRecord = (records: LocalFiscalCredentialRecord[]): LocalFiscalCredentialRecord | null => {
    if (!Array.isArray(records) || records.length === 0) return null;
    return [...records].sort((left, right) =>
        new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()
    )[0] || null;
};

const readLocalFiscalCredentialRecords = async (): Promise<LocalFiscalCredentialRecord[]> => {
    const raw = await db.get(LOCAL_FISCAL_CREDENTIAL_COLLECTION as any);
    return (Array.isArray(raw) ? raw : []).filter((entry): entry is LocalFiscalCredentialRecord =>
        Boolean(
            entry
            && typeof entry === 'object'
            && typeof (entry as any).id === 'string'
            && typeof (entry as any).providerId === 'string'
            && typeof (entry as any).authToken === 'string'
        )
    );
};

const resolveLocalFiscalCredential = async (
    providerId: FiscalProviderId,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<{ record: LocalFiscalCredentialRecord; resolvedCredentialKey?: string } | null> => {
    const records = await readLocalFiscalCredentialRecords();
    const normalizedCredentialKey = deriveCredentialKey(companyInfo, credentialKey);
    const scopedId = buildLocalCredentialRecordId(providerId, normalizedCredentialKey);
    const defaultId = buildLocalCredentialRecordId(providerId);
    const providerRecords = records.filter((entry) => entry.providerId === providerId);

    const exactRecord = records.find((entry) => entry.id === scopedId);
    if (exactRecord) {
        return {
            record: exactRecord,
            resolvedCredentialKey: normalizedCredentialKey,
        };
    }

    const matchingCredentialKey = normalizedCredentialKey
        ? providerRecords.find((entry) => deriveCredentialKey(undefined, entry.credentialKey) === normalizedCredentialKey)
        : null;
    if (matchingCredentialKey) {
        return {
            record: matchingCredentialKey,
            resolvedCredentialKey: deriveCredentialKey(undefined, matchingCredentialKey.credentialKey),
        };
    }

    const normalizedCompanyRnc = normalizeCredentialKey(companyInfo?.rnc);
    const matchingCompany = normalizedCompanyRnc
        ? providerRecords.find((entry) => normalizeCredentialKey(entry.companyRnc) === normalizedCompanyRnc)
        : null;
    if (matchingCompany) {
        return {
            record: matchingCompany,
            resolvedCredentialKey: deriveCredentialKey(undefined, matchingCompany.credentialKey),
        };
    }

    const defaultRecord = records.find((entry) => entry.id === defaultId);
    if (defaultRecord) {
        return {
            record: defaultRecord,
            resolvedCredentialKey: undefined,
        };
    }

    const fallbackRecord = pickNewestCredentialRecord(providerRecords);
    if (!fallbackRecord) return null;

    return {
        record: fallbackRecord,
        resolvedCredentialKey: deriveCredentialKey(undefined, fallbackRecord.credentialKey),
    };
};

const buildLocalCredentialMeta = async (
    providerId: FiscalProviderId,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<FiscalCredentialMetaResponse | null> => {
    const resolved = await resolveLocalFiscalCredential(providerId, companyInfo, credentialKey);
    if (!resolved) return null;

    return {
        providerId,
        hasCredential: true,
        source: 'sqlite',
        resolvedCredentialKey: resolved.resolvedCredentialKey,
        updatedAt: resolved.record.updatedAt,
        label: resolved.record.label,
        availableSources: ['sqlite'],
        hasLocalCredential: true,
        hasSupabaseCredential: false,
        hasEnvCredential: false,
    };
};

const mergeCredentialMeta = (
    remote: FiscalCredentialMetaResponse,
    local: FiscalCredentialMetaResponse | null
): FiscalCredentialMetaResponse => {
    if (!local?.hasCredential) return remote;

    const availableSources = Array.from(new Set([
        ...(Array.isArray(local.availableSources) ? local.availableSources : []),
        ...(Array.isArray(remote.availableSources) ? remote.availableSources : []),
    ])) as Array<'env' | 'sqlite' | 'supabase'>;

    return {
        ...remote,
        hasCredential: remote.hasCredential || local.hasCredential,
        source: local.source || remote.source,
        resolvedCredentialKey: local.resolvedCredentialKey || remote.resolvedCredentialKey,
        updatedAt: local.updatedAt || remote.updatedAt,
        label: local.label || remote.label,
        availableSources,
        hasLocalCredential: true,
        hasSupabaseCredential: Boolean(remote.hasSupabaseCredential),
        hasEnvCredential: Boolean(remote.hasEnvCredential),
    };
};

const extractBaseUrlFromEndpoint = (endpoint: string): string | null => {
    try {
        const url = new URL(endpoint, window.location.origin);
        if (!/^https?:$/i.test(url.protocol)) return null;
        return `${url.protocol}//${url.host}`;
    } catch {
        return null;
    }
};

const resolveCloudMasterBase = async (): Promise<string | null> => {
    if (!isNativeAndroidRuntime()) return null;

    try {
        const endpoint = await resolveMasterEndpointFromCloud();
        if (!endpoint) return null;

        const directEndpoint = normalizeBaseUrl(endpoint.endpointUrl || null);
        if (directEndpoint) return directEndpoint;

        if (endpoint.localIp) {
            return normalizeBaseUrl(
                buildMasterUrlFromHost(endpoint.localIp, endpoint.port || 3001, endpoint.protocol || 'http')
            );
        }
    } catch (error) {
        console.warn('[fiscalService] No se pudo resolver el master desde cloud:', error);
    }

    return null;
};

const buildFiscalEndpointCandidates = async (path: string): Promise<string[]> => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const fiscalPath = `/api/fiscal${normalizedPath}`;
    const env = (import.meta as any)?.env || {};

    const pinnedFiscalBase = normalizeBaseUrl(localStorage.getItem(FISCAL_BACKEND_BASE_KEY));
    const persistedMasterBase = normalizeBaseUrl(localStorage.getItem('CLIC_POS_MASTER_URL'));
    const persistedErpBase =
        normalizeBaseUrl(localStorage.getItem('CLIC_ERP_BASE_URL'))
        || normalizeBaseUrl(localStorage.getItem('erp_base_url'))
        || normalizeBaseUrl(env.VITE_ERP_BASE_URL)
        || normalizeBaseUrl(env.VITE_ERP_SYNC_API_URL)
        || normalizeBaseUrl(env.VITE_SYNC_API_URL);
    const runtimeMasterBase = normalizeBaseUrl(buildMasterUrlFromHost(window.location.hostname));
    const cloudMasterBase = await resolveCloudMasterBase();

    if (isNativeAndroidRuntime()) {
        return uniqueStrings([
            pinnedFiscalBase ? `${pinnedFiscalBase}${fiscalPath}` : null,
            persistedMasterBase ? `${persistedMasterBase}${fiscalPath}` : null,
            cloudMasterBase ? `${cloudMasterBase}${fiscalPath}` : null,
            runtimeMasterBase ? `${runtimeMasterBase}${fiscalPath}` : null,
            `${buildMasterUrlFromHost('127.0.0.1')}${fiscalPath}`,
            `${buildMasterUrlFromHost('10.0.2.2')}${fiscalPath}`,
            `${buildMasterUrlFromHost('10.0.3.2')}${fiscalPath}`,
            persistedErpBase ? `${persistedErpBase}${fiscalPath}` : null,
        ]);
    }

    return uniqueStrings([
        fiscalPath,
        pinnedFiscalBase ? `${pinnedFiscalBase}${fiscalPath}` : null,
        persistedMasterBase ? `${persistedMasterBase}${fiscalPath}` : null,
        cloudMasterBase ? `${cloudMasterBase}${fiscalPath}` : null,
        runtimeMasterBase ? `${runtimeMasterBase}${fiscalPath}` : null,
        persistedErpBase ? `${persistedErpBase}${fiscalPath}` : null,
    ]);
};

const readJsonPayload = async <T>(response: Response): Promise<{ payload: T | null; rawText: string }> => {
    const rawText = await response.text().catch(() => '');
    if (!rawText) {
        return { payload: null, rawText: '' };
    }

    try {
        return {
            payload: JSON.parse(rawText) as T,
            rawText,
        };
    } catch {
        return {
            payload: null,
            rawText,
        };
    }
};

const buildInvalidFiscalPayload = <T extends Record<string, any>>(status: number, seed: T): T => ({
    ...seed,
    success: false,
    message: `Respuesta inválida del backend fiscal (HTTP ${status}).`
});

const extractFiscalMessage = (payload: any): string => {
    const candidates = [
        payload?.message,
        payload?.mensaje,
        payload?.Message,
        payload?.descripcion,
        payload?.Description,
        payload?.StatusDescription,
        payload?.data?.message,
        payload?.data?.mensaje,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }

    return '';
};

const fetchFiscalWithTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> => {
    if (typeof AbortController === 'undefined') {
        return fetch(input, init);
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(input, {
            ...init,
            signal: controller.signal,
        });
    } finally {
        window.clearTimeout(timeoutId);
    }
};

const requestFiscalJson = async <T extends Record<string, any>>(
    path: string,
    init: RequestInit,
    invalidPayloadFactory: (status: number) => T,
): Promise<{ response: Response; payload: T }> => {
    const endpoints = await buildFiscalEndpointCandidates(path);
    let lastInvalid: { response: Response; payload: T } | null = null;
    let lastError: Error | null = null;
    const timeoutMs = isNativeAndroidRuntime() ? 2200 : 5000;

    for (const endpoint of endpoints) {
        try {
            const response = await fetchFiscalWithTimeout(endpoint, init, timeoutMs);
            const { payload, rawText } = await readJsonPayload<T>(response);

            if (payload && typeof payload === 'object') {
                const resolvedBase = extractBaseUrlFromEndpoint(endpoint);
                if (resolvedBase) {
                    localStorage.setItem(FISCAL_BACKEND_BASE_KEY, resolvedBase);
                }
                return { response, payload };
            }

            lastInvalid = {
                response,
                payload: invalidPayloadFactory(response.status),
            };

            const trimmed = rawText.trim().toLowerCase();
            const looksLikeHtml =
                trimmed.startsWith('<!doctype html')
                || trimmed.startsWith('<html')
                || trimmed.startsWith('<');

            if (response.ok && looksLikeHtml) {
                continue;
            }
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
        }
    }

    if (lastInvalid) {
        return lastInvalid;
    }

    throw lastError || new Error('No se pudo contactar el backend fiscal.');
};

export const issueFiscalDocument = async (
    input: IssueFiscalDocumentInput
): Promise<FiscalIssueResponse> => {
    if (!input.transaction.ncfType || !String(input.transaction.ncfType).startsWith('E')) {
        throw new Error('Solo se pueden emitir documentos electrónicos con esta ruta.');
    }

    const localCredential = await resolveLocalFiscalCredential(
        input.providerId,
        input.companyInfo,
        input.credentialKey
    );

    const { response, payload } = await requestFiscalJson<FiscalIssueResponse>(
        '/documents/issue',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                providerId: input.providerId,
                environment: input.environment,
                documentCode: input.transaction.ncfType,
                authToken: localCredential?.record.authToken,
                companyInfo: input.companyInfo,
                transaction: input.transaction,
                options: {
                    taxRate: input.taxRate,
                    sequenceExpiryDate: input.sequenceExpiryDate,
                    credentialKey: input.credentialKey,
                    tipoIngreso: input.tipoIngreso,
                    modificationCode: input.modificationCode,
                    unitCodeGoods: input.unitCodeGoods,
                    unitCodeServices: input.unitCodeServices
                }
            })
        },
        (status) => buildInvalidFiscalPayload(status, {
            success: false,
            providerId: input.providerId,
            environment: input.environment,
            documentCode: input.transaction.ncfType as FiscalIssueResponse['documentCode'],
            message: ''
        })
    );

    if (!response.ok && payload?.success !== false) {
        throw new Error(payload?.message || `Error fiscal HTTP ${response.status}`);
    }

    return payload as FiscalIssueResponse;
};

export const getFiscalDocumentStatus = async (
    providerId: FiscalProviderId,
    environment: number,
    providerTransactionId: string,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<FiscalStatusResponse> => {
    const localCredential = await resolveLocalFiscalCredential(providerId, companyInfo, credentialKey);
    const params = new URLSearchParams({
        providerId,
        environment: String(environment),
        providerTransactionId
    });
    if (companyInfo?.rnc) params.set('companyRnc', companyInfo.rnc);
    if (credentialKey) params.set('credentialKey', credentialKey);

    const { response, payload } = await requestFiscalJson<FiscalStatusResponse>(
        `/documents/status?${params.toString()}`,
        {
            method: 'GET',
            headers: localCredential?.record.authToken
                ? { 'X-Fiscal-AuthToken': localCredential.record.authToken }
                : undefined,
        },
        (status) => buildInvalidFiscalPayload(status, {
            success: false,
            providerId,
            environment,
            providerTransactionId,
            message: ''
        })
    );

    if (!response.ok && payload?.success !== false) {
        throw new Error(payload?.message || `Error fiscal HTTP ${response.status}`);
    }

    return {
        ...(payload as FiscalStatusResponse),
        pending: /en espera|procesando|pendiente/i.test(String((payload as any)?.status || '')) || /en espera|procesando|pendiente/i.test(String((payload as any)?.message || ''))
    };
};

export const testFiscalProviderConnection = async (
    providerId: FiscalProviderId,
    environment: number,
    companyInfo?: CompanyInfo,
    credentialKey?: string
) => {
    const localCredential = await resolveLocalFiscalCredential(providerId, companyInfo, credentialKey);
    const testDirectPolaris = async () => {
        if (providerId !== 'POLARIS' || !localCredential?.record.authToken) {
            throw new Error('No se pudo contactar el backend fiscal.');
        }

        if (!isNativeAndroidRuntime()) {
            throw new Error('El token está guardado en SQLite, pero la prueba remota necesita acceso al backend fiscal en el puerto 3001.');
        }

        const response = await CapacitorHttp.get({
            url: `${POLARIS_API_BASE}/autenticacion/token`,
            params: {
                authtoken: localCredential.record.authToken,
            },
            readTimeout: 6000,
            connectTimeout: 6000,
            headers: {
                Accept: 'application/json',
            },
        });
        const payload = response.data;
        const accessToken = String(payload?.data || payload?.token || payload?.accessToken || '').trim();
        const message = extractFiscalMessage(payload) || `Polaris auth HTTP ${response.status}`;

        if (Number(response.status) >= 400) {
            throw new Error(message);
        }

        if (!accessToken) {
            throw new Error(message || 'Polaris no devolvió Access Token.');
        }

        return {
            success: true,
            message: 'Autenticación con Polaris completada correctamente.',
            providerId,
            environment,
            credentialSource: 'sqlite',
            resolvedCredentialKey: localCredential.resolvedCredentialKey,
            raw: payload,
        };
    };

    try {
        const { response, payload } = await requestFiscalJson<{ success: boolean; message: string; providerId?: FiscalProviderId; environment?: number; credentialSource?: string; resolvedCredentialKey?: string; raw?: unknown }>(
            '/providers/test',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    providerId,
                    environment,
                    authToken: localCredential?.record.authToken,
                    companyInfo,
                    options: {
                        credentialKey
                    }
                })
            },
            (status) => buildInvalidFiscalPayload(status, {
                success: false,
                message: ''
            })
        );

        const backendLooksUnavailable = !response.ok || /backend fiscal/i.test(String(payload?.message || ''));
        if (backendLooksUnavailable && providerId === 'POLARIS' && localCredential?.record.authToken) {
            return await testDirectPolaris();
        }

        if (!response.ok && payload?.success !== false) {
            throw new Error(payload?.message || `Error fiscal HTTP ${response.status}`);
        }

        return payload;
    } catch (error) {
        if (providerId === 'POLARIS' && localCredential?.record.authToken) {
            return await testDirectPolaris();
        }
        throw error;
    }
};

export const getFiscalCredentialMetadata = async (
    providerId: FiscalProviderId,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<FiscalCredentialMetaResponse> => {
    const localMeta = await buildLocalCredentialMeta(providerId, companyInfo, credentialKey);
    if (localMeta?.hasCredential) {
        return localMeta;
    }
    const params = new URLSearchParams({ providerId });
    if (companyInfo?.rnc) params.set('companyRnc', companyInfo.rnc);
    if (credentialKey) params.set('credentialKey', credentialKey);

    try {
        const { response, payload } = await requestFiscalJson<FiscalCredentialMetaResponse>(
            `/credentials/meta?${params.toString()}`,
            {
                method: 'GET',
            },
            (status) => buildInvalidFiscalPayload(status, {
                providerId,
                hasCredential: false
            } as FiscalCredentialMetaResponse)
        );

        if (!response.ok) {
            throw new Error((payload as any)?.message || `Error consultando credencial fiscal (HTTP ${response.status})`);
        }

        return mergeCredentialMeta(payload as FiscalCredentialMetaResponse, localMeta);
    } catch (error) {
        if (localMeta?.hasCredential) {
            return localMeta;
        }
        throw error;
    }
};

export const saveLocalFiscalCredential = async (
    providerId: FiscalProviderId,
    authToken: string,
    companyInfo?: CompanyInfo,
    credentialKey?: string,
    label?: string
): Promise<FiscalCredentialMutationResponse> => {
    const normalizedToken = String(authToken || '').trim();
    if (!normalizedToken) {
        throw new Error('Ingresa un Authentication Token válido.');
    }

    const resolvedCredentialKey = deriveCredentialKey(companyInfo, credentialKey);
    const baseRecord: LocalFiscalCredentialRecord = {
        id: buildLocalCredentialRecordId(providerId, resolvedCredentialKey),
        providerId,
        companyRnc: companyInfo?.rnc,
        credentialKey: resolvedCredentialKey,
        authToken: normalizedToken,
        label: String(label || '').trim() || undefined,
        updatedAt: new Date().toISOString(),
    };

    const recordsToPersist: LocalFiscalCredentialRecord[] = [
        baseRecord,
        {
            ...baseRecord,
            id: buildLocalCredentialRecordId(providerId),
            credentialKey: undefined,
        }
    ];

    for (const record of recordsToPersist) {
        await db.saveDocument(LOCAL_FISCAL_CREDENTIAL_COLLECTION as any, record);
    }

    const localMeta = await buildLocalCredentialMeta(providerId, companyInfo, credentialKey);
    return {
        success: true,
        message: 'Credencial fiscal guardada en SQLite.',
        meta: localMeta || undefined,
    };
};

export const saveSupabaseFiscalCredential = async (
    providerId: FiscalProviderId,
    authToken: string,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<FiscalCredentialMutationResponse> => {
    const { response, payload } = await requestFiscalJson<FiscalCredentialMutationResponse>(
        '/credentials/supabase',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                providerId,
                authToken,
                companyInfo,
                options: {
                    credentialKey
                }
            })
        },
        (status) => buildInvalidFiscalPayload(status, {
            success: false,
            message: ''
        })
    );

    if (!response.ok) {
        throw new Error((payload as any)?.message || `Error guardando credencial fiscal en Supabase (HTTP ${response.status})`);
    }

    return payload as FiscalCredentialMutationResponse;
};

export const deleteLocalFiscalCredential = async (
    providerId: FiscalProviderId,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<FiscalCredentialMutationResponse> => {
    const resolvedCredentialKey = deriveCredentialKey(companyInfo, credentialKey);
    await db.deleteDocument(LOCAL_FISCAL_CREDENTIAL_COLLECTION as any, buildLocalCredentialRecordId(providerId, resolvedCredentialKey));
    await db.deleteDocument(LOCAL_FISCAL_CREDENTIAL_COLLECTION as any, buildLocalCredentialRecordId(providerId));
    const localMetaAfterDelete = await buildLocalCredentialMeta(providerId, companyInfo, credentialKey);
    return {
        success: true,
        message: 'Credencial fiscal local eliminada de SQLite.',
        meta: localMetaAfterDelete || {
            providerId,
            hasCredential: false,
            availableSources: [],
            hasLocalCredential: false,
            hasSupabaseCredential: false,
            hasEnvCredential: false,
        },
    };
};

export const deleteSupabaseFiscalCredential = async (
    providerId: FiscalProviderId,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<FiscalCredentialMutationResponse> => {
    const { response, payload } = await requestFiscalJson<FiscalCredentialMutationResponse>(
        '/credentials/supabase',
        {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                providerId,
                companyInfo,
                options: {
                    credentialKey
                }
            })
        },
        (status) => buildInvalidFiscalPayload(status, {
            success: false,
            message: ''
        })
    );

    if (!response.ok) {
        throw new Error((payload as any)?.message || `Error eliminando credencial fiscal en Supabase (HTTP ${response.status})`);
    }

    return payload as FiscalCredentialMutationResponse;
};
