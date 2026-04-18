import { Capacitor } from '@capacitor/core';
import { CompanyInfo, FiscalProviderId, Transaction } from '../../types';
import { buildMasterUrlFromHost } from '../../utils/cloudMasterRegistry';

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

const buildFiscalEndpointCandidates = (path: string): string[] => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const fiscalPath = `/api/fiscal${normalizedPath}`;
    const env = (import.meta as any)?.env || {};

    const persistedMasterBase = normalizeBaseUrl(localStorage.getItem('CLIC_POS_MASTER_URL'));
    const persistedErpBase =
        normalizeBaseUrl(localStorage.getItem('CLIC_ERP_BASE_URL'))
        || normalizeBaseUrl(localStorage.getItem('erp_base_url'))
        || normalizeBaseUrl(env.VITE_ERP_BASE_URL)
        || normalizeBaseUrl(env.VITE_ERP_SYNC_API_URL)
        || normalizeBaseUrl(env.VITE_SYNC_API_URL);
    const runtimeMasterBase = normalizeBaseUrl(buildMasterUrlFromHost(window.location.hostname));

    if (isNativeAndroidRuntime()) {
        return uniqueStrings([
            persistedMasterBase ? `${persistedMasterBase}${fiscalPath}` : null,
            runtimeMasterBase ? `${runtimeMasterBase}${fiscalPath}` : null,
            `${buildMasterUrlFromHost('127.0.0.1')}${fiscalPath}`,
            `${buildMasterUrlFromHost('10.0.2.2')}${fiscalPath}`,
            `${buildMasterUrlFromHost('10.0.3.2')}${fiscalPath}`,
            persistedErpBase ? `${persistedErpBase}${fiscalPath}` : null,
            fiscalPath,
        ]);
    }

    return uniqueStrings([
        fiscalPath,
        persistedMasterBase ? `${persistedMasterBase}${fiscalPath}` : null,
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

const requestFiscalJson = async <T extends Record<string, any>>(
    path: string,
    init: RequestInit,
    invalidPayloadFactory: (status: number) => T,
): Promise<{ response: Response; payload: T }> => {
    const endpoints = buildFiscalEndpointCandidates(path);
    let lastInvalid: { response: Response; payload: T } | null = null;
    let lastError: Error | null = null;

    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, init);
            const { payload, rawText } = await readJsonPayload<T>(response);

            if (payload && typeof payload === 'object') {
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
    const { response, payload } = await requestFiscalJson<{ success: boolean; message: string }>(
        '/providers/test',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                providerId,
                environment,
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

    if (!response.ok && payload?.success !== false) {
        throw new Error(payload?.message || `Error fiscal HTTP ${response.status}`);
    }

    return payload;
};

export const getFiscalCredentialMetadata = async (
    providerId: FiscalProviderId,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<FiscalCredentialMetaResponse> => {
    const params = new URLSearchParams({ providerId });
    if (companyInfo?.rnc) params.set('companyRnc', companyInfo.rnc);
    if (credentialKey) params.set('credentialKey', credentialKey);

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

    return payload as FiscalCredentialMetaResponse;
};

export const saveLocalFiscalCredential = async (
    providerId: FiscalProviderId,
    authToken: string,
    companyInfo?: CompanyInfo,
    credentialKey?: string,
    label?: string
): Promise<FiscalCredentialMutationResponse> => {
    const { response, payload } = await requestFiscalJson<FiscalCredentialMutationResponse>(
        '/credentials/local',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                providerId,
                authToken,
                companyInfo,
                label,
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
        throw new Error((payload as any)?.message || `Error guardando credencial fiscal (HTTP ${response.status})`);
    }

    return payload as FiscalCredentialMutationResponse;
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
    const { response, payload } = await requestFiscalJson<FiscalCredentialMutationResponse>(
        '/credentials/local',
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
        throw new Error((payload as any)?.message || `Error eliminando credencial fiscal local (HTTP ${response.status})`);
    }

    return payload as FiscalCredentialMutationResponse;
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
