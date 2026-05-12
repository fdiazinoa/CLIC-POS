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

const DIGIFACT_TEST_BASE_URL = 'https://testnucdo.digifact.com/api';
const DIGIFACT_PROD_BASE_URL = 'https://nucdo.digifact.com/api';
const TOKEN_CACHE_TTL_MS = 29 * 24 * 60 * 60 * 1000;

type DigifactCredentialShape = {
    token?: string;
    authToken?: string;
    username?: string;
    Username?: string;
    user?: string;
    password?: string;
    Password?: string;
    taxId?: string;
    rnc?: string;
};

type ResolvedDigifactAuth = {
    authorization: string;
    username?: string;
    resolvedTaxId: string;
    source: 'token' | 'login';
};

const tokenCache = new Map<string, { token: string; expiresAt: number; username?: string }>();

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

const resolveDigifactBaseUrl = (request: Pick<FiscalDocumentIssueRequest | FiscalProviderTestRequest | FiscalStatusRequest, 'environment'> & { options?: any }): string => {
    const explicit = cleanString(request.options?.apiBaseUrl || process.env.DIGIFACT_API_BASE_URL || process.env.DIGIFACT_API_BASE);
    if (explicit) return explicit.replace(/\/+$/, '');
    return Number(request.environment) === 1 ? DIGIFACT_PROD_BASE_URL : DIGIFACT_TEST_BASE_URL;
};

const resolveDigifactUrl = (
    request: Pick<FiscalDocumentIssueRequest | FiscalProviderTestRequest | FiscalStatusRequest, 'environment'> & { options?: any },
    optionKey: 'testUrl' | 'issueUrl' | 'statusUrl',
    envName: string,
    fallbackPath: string
): string => {
    const explicit = cleanString(request.options?.[optionKey] || process.env[envName]);
    if (/^https?:\/\//i.test(explicit)) return explicit;
    const path = explicit || fallbackPath;
    return `${resolveDigifactBaseUrl(request)}${path.startsWith('/') ? path : `/${path}`}`;
};

const parseCredentialShape = (authToken: string): DigifactCredentialShape => {
    const raw = authToken.trim();
    if (!raw) return {};
    if (raw.startsWith('{')) {
        try {
            return JSON.parse(raw) as DigifactCredentialShape;
        } catch {
            return { token: raw };
        }
    }
    return { token: raw };
};

const resolveUsername = (credential: DigifactCredentialShape, taxId: string): string | undefined => {
    const rawUsername = cleanString(credential.Username || credential.username || credential.user);
    if (!rawUsername) return undefined;
    if (rawUsername.includes('.')) return rawUsername;
    return `DO.${taxId}.${rawUsername}`;
};

const queryUsername = (username?: string): string | undefined => {
    if (!username) return undefined;
    const parts = username.split('.');
    return parts[parts.length - 1] || username;
};

const extractToken = (payload: any): string => {
    const candidates = [
        payload?.token,
        payload?.Token,
        payload?.accessToken,
        payload?.AccessToken,
        payload?.data,
        payload?.Data,
        payload?.responseData,
        payload?.responseData1
    ];
    for (const candidate of candidates) {
        if (candidate != null && String(candidate).trim()) return String(candidate).trim();
    }
    return '';
};

const extractMessage = (payload: any): string => {
    const candidates = [
        payload?.message,
        payload?.mensaje,
        payload?.Message,
        payload?.description,
        payload?.Description,
        payload?.descripcion,
        payload?.infoDetails,
        payload?.error,
        payload?.errors
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        if (Array.isArray(candidate) && candidate.length > 0) {
            return candidate.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('; ');
        }
        if (candidate && typeof candidate === 'object') return JSON.stringify(candidate);
    }

    return 'Sin mensaje devuelto por DigiFact.';
};

const extractProviderTransactionId = (payload: any, fallbackENCF?: string): string | undefined => {
    const candidates = [
        payload?.batch,
        payload?.Batch,
        payload?.eNCF,
        payload?.encf,
        payload?.authNumber,
        payload?.AuthNumber,
        payload?.authorizationNumber,
        payload?.data?.batch,
        payload?.data?.authNumber,
        fallbackENCF
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
        payload?.code,
        payload?.Code,
        payload?.data?.status,
        payload?.data?.estado
    ];

    for (const candidate of candidates) {
        if (candidate != null && String(candidate).trim()) return String(candidate).trim();
    }

    return '';
};

const isPendingStatus = (value: unknown): boolean =>
    /pendiente|procesando|en espera|queued|pending|processing/i.test(cleanString(value));

const isDigifactFailure = (payload: any, status: string, message: string): boolean => {
    if (payload?.success === false || payload?.ok === false) return true;
    if (/rechaz|error|failed|invalid|invalido|inválido/i.test(status)) return true;
    if (/rechaz|error|failed|invalid|invalido|inválido/i.test(message)) return true;
    if (Array.isArray(payload?.infoDetails) && payload.infoDetails.length > 0) return true;
    const code = Number(payload?.code ?? payload?.Code);
    return Number.isFinite(code) && code < 0;
};

const mapPaymentMethod = (method?: string): string => {
    const normalized = cleanString(method).toUpperCase();
    if (['CASH', 'EFECTIVO'].includes(normalized)) return '01';
    if (['TRANSFER', 'WIRE', 'ACH', 'CHEQUE', 'CHECK', 'DEPOSITO'].includes(normalized)) return '02';
    if (['CARD', 'CREDIT_CARD', 'DEBIT_CARD', 'TARJETA'].includes(normalized)) return '03';
    if (['CREDIT', 'CREDITO'].includes(normalized)) return '04';
    if (['GIFT', 'VOUCHER', 'STORE_CREDIT', 'CREDIT_NOTE', 'VALE_NC'].includes(normalized)) return '06';
    return '07';
};

const documentTypeCode = (documentCode: ElectronicDocumentCode): string =>
    String(documentCode).replace(/^E/, '');

const extractSequence = (encf: string, documentCode: ElectronicDocumentCode): string => {
    const digits = encf.replace(new RegExp(`^E?${documentTypeCode(documentCode)}`, 'i'), '').replace(/\D/g, '');
    return (digits || encf.replace(/\D/g, '')).slice(-10).padStart(10, '0');
};

const toDigifactDateTime = (value?: string): string => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return new Date().toISOString();
    return date.toISOString();
};

const itemTaxIndicator = (item: any): number => {
    if (Array.isArray(item?.appliedTaxIds) && item.appliedTaxIds.length > 0) return 1;
    return 4;
};

const buildDigifactPayload = (request: FiscalDocumentIssueRequest) => {
    const { companyInfo, transaction, documentCode, options } = request;
    const customer = transaction.customerSnapshot || {};
    const eNCF = cleanString(transaction.electronicNcf || transaction.ncf);
    const total = round2(Math.abs(sanitizeNumber(transaction.total)));
    const taxAmount = round2(Math.abs(sanitizeNumber(transaction.taxAmount)));
    const discountAmount = round2(Math.abs(sanitizeNumber(transaction.discountAmount)));
    const netAmount = round2(Math.abs(sanitizeNumber(transaction.netAmount)) || Math.max(0, total - taxAmount));
    const taxRate = Number(options?.taxRate ?? 18);
    const taxableAmount = taxAmount > 0 ? netAmount : 0;
    const sequence = extractSequence(eNCF, documentCode);

    const items = (transaction.items || []).map((item, index) => {
        const quantity = Math.abs(sanitizeNumber(item.quantity)) || 1;
        const unitPrice = round2(Math.abs(sanitizeNumber(item.price)));
        const lineTotal = round2(quantity * unitPrice);
        const type = cleanString(item.type).toUpperCase() === 'SERVICE' ? 2 : 1;
        const unitCode = Number(item.fiscalUnitCode || (type === 2 ? options?.unitCodeServices || 43 : options?.unitCodeGoods || 47));
        return {
            Number: index + 1,
            Codes: [
                {
                    Name: 'Interno',
                    Value: cleanString(item.id) || `ITEM-${index + 1}`
                }
            ],
            Type: type,
            Description: cleanString(item.name || item.id) || 'Item POS',
            Qty: quantity,
            UnitOfMeasure: unitCode,
            Price: unitPrice,
            Taxes: itemTaxIndicator(item) === 1
                ? [{ Code: 'ITBIS1', Rate: taxRate }]
                : [],
            Totals: {
                TotalItem: lineTotal
            },
            AdditionalInfo: [
                { Name: 'IndicadorFacturacion', Value: String(itemTaxIndicator(item)) }
            ]
        };
    });

    const payload: any = {
        Version: '1.00',
        CountryCode: 'DO',
        Header: {
            DocType: documentTypeCode(documentCode),
            IssuedDateTime: toDigifactDateTime(transaction.date),
            Currency: 'DOP',
            AdditionalIssueDocInfo: [
                { Name: 'Secuencia', Value: sequence },
                { Name: 'TipoIngresos', Value: String(options?.tipoIngreso || 1) },
                { Name: 'TipoPago', Value: mapPaymentMethod(transaction.payments?.[0]?.method) }
            ].filter(info => cleanString(info.Value))
        },
        Seller: {
            TaxID: normalizeTaxId(companyInfo.rnc),
            Name: cleanString(companyInfo.name),
            Contact: {
                PhoneList: cleanString(companyInfo.phone) ? [cleanString(companyInfo.phone)] : [],
                EmailList: cleanString(companyInfo.email) ? [cleanString(companyInfo.email)] : []
            },
            BranchInfo: {
                Name: 'POS',
                AddressInfo: {
                    Address: cleanString(companyInfo.address),
                    Country: 'DO'
                }
            },
            AdditionalInfo: [
                { Name: 'NumeroFacturaInterna', Value: cleanString(transaction.displayId || transaction.id) }
            ]
        },
        Buyer: {
            TaxID: normalizeTaxId(customer.taxId),
            Name: cleanString(customer.name || transaction.customerName) || 'Consumidor final',
            Contact: {
                PhoneList: cleanString(customer.phone) ? [cleanString(customer.phone)] : [],
                EmailList: cleanString(customer.email) ? [cleanString(customer.email)] : []
            },
            AddressInfo: {
                Address: cleanString(customer.address),
                Country: 'DO'
            }
        },
        Items: items,
        Totals: {
            QtyItems: items.length,
            TotalTaxableAmount: taxableAmount,
            TotalExemptAmount: taxAmount > 0 ? 0 : netAmount,
            TotalDiscountAmount: discountAmount,
            TotalTaxes: taxAmount > 0
                ? [{ Code: 'ITBIS1', TaxableAmount: taxableAmount, Rate: taxRate, Amount: taxAmount }]
                : [],
            GrandTotal: {
                InvoiceTotal: total
            }
        },
        AdditionalData: {
            AdditionalInfo: [
                { Name: 'eNCF', Value: eNCF },
                { Name: 'POSReference', Value: cleanString(transaction.id) }
            ]
        }
    };

    if (options?.sequenceExpiryDate) {
        payload.Header.AdditionalIssueDocInfo.push({
            Name: 'FechaVencimientoSecuencia',
            Value: options.sequenceExpiryDate.slice(0, 10)
        });
    }

    if (documentCode === 'E34') {
        payload.References = [
            {
                ReferenceType: 'NCFModificado',
                NCF: cleanString(transaction.affectedNCF || transaction.affectedInvoiceNumber),
                Date: cleanString(transaction.affectedInvoiceDate),
                Reason: cleanString(transaction.refundReason) || 'Nota de crédito generada desde POS',
                ModificationCode: String(options?.modificationCode || 2)
            }
        ];
        payload.AdditionalData.AdditionalInfo.push(
            { Name: 'CodigoModificacion', Value: String(options?.modificationCode || 2) },
            { Name: 'RazonModificacion', Value: cleanString(transaction.refundReason) || 'Nota de crédito generada desde POS' }
        );
    }

    return payload;
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
    if (documentCode === 'E34' && !cleanString(transaction.affectedNCF || transaction.affectedInvoiceNumber)) {
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

    private async resolveAuth(
        request: Pick<FiscalDocumentIssueRequest | FiscalProviderTestRequest | FiscalStatusRequest, 'environment'> & {
            options?: any;
            companyRnc?: string;
            credentialKey?: string;
            authToken?: string;
        }
    ): Promise<ResolvedDigifactAuth> {
        const credential = await this.resolveCredential(
            request.companyRnc,
            request.credentialKey,
            request.authToken
        );
        const shape = parseCredentialShape(credential.authToken);
        const taxId = normalizeTaxId(shape.taxId || shape.rnc || request.companyRnc || request.credentialKey || credential.resolvedCredentialKey);
        const username = resolveUsername(shape, taxId);
        const password = cleanString(shape.Password || shape.password);
        const inlineToken = cleanString(shape.token || shape.authToken);

        if (!taxId) {
            throw new Error('DigiFact requiere RNC/TAXID para resolver la credencial local.');
        }

        if (inlineToken && !password) {
            return {
                authorization: inlineToken,
                username: queryUsername(username),
                resolvedTaxId: taxId,
                source: 'token'
            };
        }

        if (!username || !password) {
            throw new Error('Para DigiFact local guarda un token vigente o credenciales JSON: {"username":"USER_TEST","password":"..."}');
        }

        const cacheKey = `${request.environment}:${taxId}:${username}:${password}`;
        const cached = tokenCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return {
                authorization: cached.token,
                username: queryUsername(cached.username || username),
                resolvedTaxId: taxId,
                source: 'login'
            };
        }

        const loginUrl = resolveDigifactUrl(request, 'testUrl', 'DIGIFACT_LOGIN_URL', '/login/get_token');
        const response = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ Username: username, Password: password })
        });
        const raw = await response.json().catch(() => ({}));
        const token = extractToken(raw);
        if (!response.ok || !token) {
            throw new Error(extractMessage(raw) || `DigiFact login HTTP ${response.status}`);
        }

        tokenCache.set(cacheKey, { token, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS, username });
        return {
            authorization: token,
            username: queryUsername(username),
            resolvedTaxId: taxId,
            source: 'login'
        };
    }

    async testConnection(request: FiscalProviderTestRequest): Promise<FiscalProviderTestResult> {
        const auth = await this.resolveAuth({
            environment: request.environment,
            options: request.options,
            companyRnc: request.companyInfo?.rnc,
            credentialKey: request.credentialKey,
            authToken: request.authToken
        });

        return {
            success: true,
            providerId: this.id,
            environment: request.environment,
            message: auth.source === 'login'
                ? 'Autenticación con DigiFact completada correctamente.'
                : 'Token local DigiFact disponible. La validación final ocurre al emitir el NUC.',
            resolvedCredentialKey: request.credentialKey || auth.resolvedTaxId,
            raw: {
                source: auth.source,
                taxId: auth.resolvedTaxId,
                username: auth.username || null
            }
        };
    }

    async issueDocument(request: FiscalDocumentIssueRequest): Promise<FiscalDocumentIssueResult> {
        validateDocumentRequest(request);
        const auth = await this.resolveAuth({
            environment: request.environment,
            options: request.options,
            companyRnc: request.companyInfo?.rnc,
            credentialKey: request.options?.credentialKey,
            authToken: request.options?.authToken
        });
        const eNCF = cleanString(request.transaction.electronicNcf || request.transaction.ncf);
        const url = new URL(resolveDigifactUrl(request, 'issueUrl', 'DIGIFACT_ISSUE_URL', '/v2/transform/nuc_json'));
        url.searchParams.set('TAXID', auth.resolvedTaxId);
        url.searchParams.set('FORMAT', 'XML|HTML|PDF');
        if (auth.username) url.searchParams.set('USERNAME', auth.username);

        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: auth.authorization
            },
            body: JSON.stringify(buildDigifactPayload(request))
        });
        const raw = await response.json().catch(() => ({}));
        const status = extractStatus(raw);
        const message = extractMessage(raw);
        const providerTransactionId = extractProviderTransactionId(raw, eNCF);
        const pending = isPendingStatus(status) || isPendingStatus(message);
        const failure = isDigifactFailure(raw, status, message);
        const success = response.ok && !failure;

        return {
            success,
            providerId: this.id,
            environment: request.environment,
            documentCode: request.documentCode,
            providerTransactionId,
            status: status || (success ? 'Aceptado' : 'Rechazado'),
            message: message || (success ? 'DigiFact emitió el NUC correctamente.' : `DigiFact HTTP ${response.status}`),
            pending,
            raw
        };
    }

    async getStatus(request: FiscalStatusRequest): Promise<FiscalStatusResult> {
        const auth = await this.resolveAuth({
            environment: request.environment,
            options: request.options,
            companyRnc: request.companyRnc,
            credentialKey: request.credentialKey,
            authToken: request.authToken
        });
        const url = new URL(resolveDigifactUrl(request, 'statusUrl', 'DIGIFACT_STATUS_URL', '/SHAREDINFO'));
        url.searchParams.set('TAXID', auth.resolvedTaxId);
        if (auth.username) url.searchParams.set('USERNAME', auth.username);
        url.searchParams.set('DATA1', 'SHARED_GETRESULTADOENVIO');
        url.searchParams.set('DATA2', `ENCF|${request.providerTransactionId}`);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: auth.authorization
            }
        });
        const raw = await response.json().catch(() => ({}));
        const status = extractStatus(raw);
        const message = extractMessage(raw);
        const pending = isPendingStatus(status) || isPendingStatus(message);
        const failure = isDigifactFailure(raw, status, message);

        return {
            success: response.ok && !failure,
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
