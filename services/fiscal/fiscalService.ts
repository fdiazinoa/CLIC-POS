import { CompanyInfo, FiscalProviderId, Transaction } from '../../types';

export interface FiscalCredentialMetaResponse {
    providerId: FiscalProviderId;
    hasCredential: boolean;
    source?: 'env' | 'sqlite' | 'supabase';
    resolvedCredentialKey?: string;
    updatedAt?: string;
    label?: string;
}

export interface SaveLocalFiscalCredentialResponse {
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

export const issueFiscalDocument = async (
    input: IssueFiscalDocumentInput
): Promise<FiscalIssueResponse> => {
    if (!input.transaction.ncfType || !String(input.transaction.ncfType).startsWith('E')) {
        throw new Error('Solo se pueden emitir documentos electrónicos con esta ruta.');
    }

    const response = await fetch('/api/fiscal/documents/issue', {
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
    });

    const payload = await response.json().catch(() => ({
        success: false,
        providerId: input.providerId,
        environment: input.environment,
        documentCode: input.transaction.ncfType,
        message: `Respuesta inválida del backend fiscal (HTTP ${response.status}).`
    }));

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

    const response = await fetch(
        `/api/fiscal/documents/status?${params.toString()}`
    );

    const payload = await response.json().catch(() => ({
        success: false,
        providerId,
        environment,
        providerTransactionId,
        message: `Respuesta inválida del backend fiscal (HTTP ${response.status}).`
    }));

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
    const response = await fetch('/api/fiscal/providers/test', {
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
    });

    const payload = await response.json().catch(() => ({
        success: false,
        message: `Respuesta inválida del backend fiscal (HTTP ${response.status}).`
    }));

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

    const response = await fetch(`/api/fiscal/credentials/meta?${params.toString()}`);
    const payload = await response.json().catch(() => ({
        providerId,
        hasCredential: false
    }));

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
): Promise<SaveLocalFiscalCredentialResponse> => {
    const response = await fetch('/api/fiscal/credentials/local', {
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
    });

    const payload = await response.json().catch(() => ({
        success: false,
        message: `Respuesta inválida del backend fiscal (HTTP ${response.status}).`
    }));

    if (!response.ok) {
        throw new Error((payload as any)?.message || `Error guardando credencial fiscal (HTTP ${response.status})`);
    }

    return payload as SaveLocalFiscalCredentialResponse;
};
