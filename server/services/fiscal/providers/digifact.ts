import {
    ElectronicDocumentCode,
    FiscalDocumentIssueRequest,
    FiscalDocumentIssueResult,
    FiscalProvider,
    FiscalProviderTestRequest,
    FiscalProviderTestResult,
    FiscalStatusRequest,
    FiscalStatusResult
} from './base.js';
import { resolveFiscalProviderCredential } from '../credentials.js';

const cleanString = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';

const normalizeTaxId = (value: unknown): string =>
    String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const sanitizeNumber = (value: unknown): number => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const round2 = (value: number): number =>
    Math.round((value + Number.EPSILON) * 100) / 100;

const resolveDigifactBaseUrl = (): string => {
    const baseUrl = cleanString(process.env.DIGIFACT_API_BASE_URL || process.env.DIGIFACT_API_BASE);
    if (!baseUrl) {
        throw new Error('Configura DIGIFACT_API_BASE_URL en el backend local para emitir DigiFact directo desde el POS.');
    }
    return baseUrl.replace(/\/+$/, '');
};

const resolveDigifactUrl = (pathEnvName: string, fallbackPath: string): string => {
    const explicitUrl = cleanString(process.env[pathEnvName]);
    if (/^https?:\/\//i.test(explicitUrl)) return explicitUrl;

    const path = explicitUrl || fallbackPath;
    return `${resolveDigifactBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
};

const extractMessage = (payload: any): string => {
    const candidates = [
        payload?.message,
        payload?.mensaje,
        payload?.Message,
        payload?.descripcion,
        payload?.Description,
        payload?.statusMessage,
        payload?.data?.message,
        payload?.data?.mensaje,
        payload?.error,
        payload?.errors
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        if (Array.isArray(candidate) && candidate.length > 0) {
            return candidate.map(item => String(item)).join('; ');
        }
    }

    return 'Sin mensaje devuelto por DigiFact.';
};

const extractProviderTransactionId = (payload: any): string | undefined => {
    const candidates = [
        payload?.trackId,
        payload?.track_id,
        payload?.id,
        payload?.uuid,
        payload?.providerTransactionId,
        payload?.transactionId,
        payload?.transaccionID,
        payload?.data?.trackId,
        payload?.data?.id,
        payload?.data?.uuid,
        payload?.data?.providerTransactionId,
        payload?.data?.transactionId
    ];

    for (const candidate of candidates) {
        if (candidate != null && String(candidate).trim()) return String(candidate).trim();
    }

    return undefined;
};

const extractStatus = (payload: any): string => {
    const candidates = [
        payload?.status,
        payload?.estado,
        payload?.Status,
        payload?.data?.status,
        payload?.data?.estado,
        payload?.dgiiStatus,
        payload?.dgii_status
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }

    if (payload?.success === true || payload?.ok === true) return 'Aceptado';
    if (payload?.success === false || payload?.ok === false) return 'Rechazado';
    return '';
};

const isPendingStatus = (value: unknown): boolean =>
    /pendiente|procesando|en espera|queued|pending|processing/i.test(cleanString(value));

const buildAuthorizationHeaders = (authToken: string): Record<string, string> => ({
    Authorization: `Bearer ${authToken}`,
    'X-API-Key': authToken,
    'X-Auth-Token': authToken
});

const mapPaymentMethod = (method?: string): string => {
    const normalized = cleanString(method).toUpperCase();
    if (['CASH', 'EFECTIVO'].includes(normalized)) return '01';
    if (['TRANSFER', 'WIRE', 'ACH', 'CHEQUE', 'CHECK', 'DEPOSITO'].includes(normalized)) return '02';
    if (['CARD', 'CREDIT_CARD', 'DEBIT_CARD', 'TARJETA'].includes(normalized)) return '03';
    if (['CREDIT', 'CREDITO'].includes(normalized)) return '04';
    if (['GIFT', 'VOUCHER', 'STORE_CREDIT', 'CREDIT_NOTE', 'VALE_NC'].includes(normalized)) return '06';
    return '07';
};

const buildDigifactPayload = (request: FiscalDocumentIssueRequest) => {
    const { companyInfo, transaction, documentCode, options } = request;
    const customer = transaction.customerSnapshot || {};
    const total = round2(Math.abs(sanitizeNumber(transaction.total)));
    const taxAmount = round2(Math.abs(sanitizeNumber(transaction.taxAmount)));
    const netAmount = round2(Math.abs(sanitizeNumber(transaction.netAmount)) || Math.max(0, total - taxAmount));

    return {
        provider: 'DIGIFACT',
        environment: request.environment,
        documentCode,
        ecfType: Number(String(documentCode).replace(/^E/, '')),
        eNCF: cleanString(transaction.electronicNcf || transaction.ncf),
        issueDate: transaction.date,
        dueDate: transaction.dueDate,
        issuer: {
            rnc: normalizeTaxId(companyInfo.rnc),
            name: cleanString(companyInfo.name),
            commercialName: cleanString(companyInfo.name),
            address: cleanString(companyInfo.address),
            phone: cleanString(companyInfo.phone),
            email: cleanString(companyInfo.email)
        },
        customer: {
            rnc: normalizeTaxId(customer.taxId),
            name: cleanString(customer.name || transaction.customerName),
            address: cleanString(customer.address),
            phone: cleanString(customer.phone),
            email: cleanString(customer.email)
        },
        totals: {
            netAmount,
            taxAmount,
            discountAmount: round2(Math.abs(sanitizeNumber(transaction.discountAmount))),
            totalAmount: total,
            isTaxIncluded: transaction.isTaxIncluded === true
        },
        payments: (transaction.payments || []).map(payment => ({
            method: mapPaymentMethod(payment.method),
            amount: round2(Math.abs(sanitizeNumber(payment.amount)))
        })),
        items: (transaction.items || []).map(item => ({
            id: cleanString(item.id),
            description: cleanString(item.name || item.id) || 'Item',
            type: cleanString(item.type),
            quantity: Math.abs(sanitizeNumber(item.quantity)) || 1,
            unitPrice: round2(Math.abs(sanitizeNumber(item.price))),
            fiscalUnitCode: item.fiscalUnitCode || (
                cleanString(item.type).toUpperCase() === 'SERVICE'
                    ? options?.unitCodeServices || 43
                    : options?.unitCodeGoods || 47
            ),
            measurementUnit: cleanString(item.measurementUnit),
            taxIndicator: (item.appliedTaxIds || []).length > 0 ? 2 : 5
        })),
        creditNote: documentCode === 'E34'
            ? {
                affectedNCF: cleanString(transaction.affectedNCF),
                affectedInvoiceNumber: cleanString(transaction.affectedInvoiceNumber),
                affectedInvoiceDate: cleanString(transaction.affectedInvoiceDate),
                reason: cleanString(transaction.refundReason) || 'Nota de crédito generada desde POS',
                modificationCode: options?.modificationCode || 2
            }
            : undefined,
        options: {
            taxRate: options?.taxRate,
            sequenceExpiryDate: options?.sequenceExpiryDate,
            tipoIngreso: options?.tipoIngreso || 1,
            credentialKey: options?.credentialKey
        },
        references: {
            transactionId: transaction.id,
            displayId: transaction.displayId
        }
    };
};

const validateDocumentRequest = (request: FiscalDocumentIssueRequest) => {
    const { companyInfo, transaction, documentCode } = request;
    if (!normalizeTaxId(companyInfo.rnc) || !cleanString(companyInfo.name)) {
        throw new Error('El emisor debe tener nombre y RNC válidos antes de emitir con DigiFact.');
    }
    if (!cleanString(transaction.electronicNcf || transaction.ncf)) {
        throw new Error('El e-NCF es obligatorio para emitir con DigiFact.');
    }
    if (!Array.isArray(transaction.items) || transaction.items.length === 0) {
        throw new Error('El documento electrónico debe tener al menos un ítem.');
    }
    if (round2(Math.abs(sanitizeNumber(transaction.total))) <= 0) {
        throw new Error('El total del documento electrónico debe ser mayor que cero.');
    }
    if (documentCode === 'E34' && !cleanString(transaction.affectedNCF)) {
        throw new Error('La Nota de Crédito electrónica (E34) requiere el NCF afectado.');
    }
};

export class DigifactFiscalProvider implements FiscalProvider {
    readonly id = 'DIGIFACT' as const;

    private async resolveCredential(
        companyRnc?: string,
        credentialKey?: string,
        authTokenOverride?: string
    ) {
        return resolveFiscalProviderCredential(
            this.id,
            companyRnc ? { name: '', rnc: companyRnc } : undefined,
            credentialKey,
            authTokenOverride
        );
    }

    async testConnection(request: FiscalProviderTestRequest): Promise<FiscalProviderTestResult> {
        const credential = await this.resolveCredential(
            request.companyInfo?.rnc,
            request.credentialKey,
            request.authToken
        );
        const url = resolveDigifactUrl('DIGIFACT_TEST_URL', process.env.DIGIFACT_TEST_PATH || '/api/v1/auth/test');
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...buildAuthorizationHeaders(credential.authToken)
            },
            body: JSON.stringify({
                provider: 'DIGIFACT',
                environment: request.environment,
                companyRnc: normalizeTaxId(request.companyInfo?.rnc),
                credentialKey: credential.resolvedCredentialKey
            })
        });
        const raw = await response.json().catch(() => ({}));

        if (!response.ok || (raw as any)?.success === false || (raw as any)?.ok === false) {
            throw new Error(extractMessage(raw) || `DigiFact HTTP ${response.status}`);
        }

        return {
            success: true,
            providerId: this.id,
            environment: request.environment,
            message: extractMessage(raw) || 'Autenticación con DigiFact completada correctamente.',
            credentialSource: credential.source,
            resolvedCredentialKey: credential.resolvedCredentialKey,
            raw
        };
    }

    async issueDocument(request: FiscalDocumentIssueRequest): Promise<FiscalDocumentIssueResult> {
        validateDocumentRequest(request);
        const credential = await this.resolveCredential(
            request.companyInfo?.rnc,
            request.options?.credentialKey,
            request.options?.authToken
        );
        const url = resolveDigifactUrl('DIGIFACT_ISSUE_URL', process.env.DIGIFACT_ISSUE_PATH || '/api/v1/ecf/documents');
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...buildAuthorizationHeaders(credential.authToken)
            },
            body: JSON.stringify(buildDigifactPayload(request))
        });
        const raw = await response.json().catch(() => ({}));
        const status = extractStatus(raw);
        const message = extractMessage(raw);
        const providerTransactionId = extractProviderTransactionId(raw);
        const pending = isPendingStatus(status) || isPendingStatus(message);
        const success = response.ok && (raw as any)?.success !== false && (raw as any)?.ok !== false && !/rechaz|error|failed/i.test(status);

        return {
            success,
            providerId: this.id,
            environment: request.environment,
            documentCode: request.documentCode,
            providerTransactionId,
            status,
            message,
            pending,
            raw
        };
    }

    async getStatus(request: FiscalStatusRequest): Promise<FiscalStatusResult> {
        const credential = await this.resolveCredential(
            request.companyRnc,
            request.credentialKey,
            request.authToken
        );
        const url = new URL(resolveDigifactUrl('DIGIFACT_STATUS_URL', process.env.DIGIFACT_STATUS_PATH || '/api/v1/ecf/status'));
        url.searchParams.set('providerTransactionId', request.providerTransactionId);
        url.searchParams.set('environment', String(request.environment));
        if (request.credentialKey) url.searchParams.set('credentialKey', request.credentialKey);
        if (request.companyRnc) url.searchParams.set('companyRnc', request.companyRnc);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: buildAuthorizationHeaders(credential.authToken)
        });
        const raw = await response.json().catch(() => ({}));
        const status = extractStatus(raw);
        const message = extractMessage(raw);
        const pending = isPendingStatus(status) || isPendingStatus(message);

        return {
            success: response.ok && (raw as any)?.success !== false && (raw as any)?.ok !== false,
            providerId: this.id,
            environment: request.environment,
            providerTransactionId: request.providerTransactionId,
            status: pending ? (status || 'Pendiente') : status,
            message,
            raw: {
                ...((raw as any) || {}),
                pending
            }
        };
    }
}
