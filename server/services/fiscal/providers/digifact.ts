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

const normalizePercentRate = (value: unknown, fallback = 18): number => {
    const parsed = sanitizeNumber(value);
    if (parsed <= 0) return fallback;
    return parsed <= 1 ? round2(parsed * 100) : round2(parsed);
};

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

const appendDigifactPath = (baseOrUrl: string, fallbackPath: string): string => {
    const clean = baseOrUrl.replace(/\/+$/, '');
    if (!clean) return clean;
    if (clean.toLowerCase().endsWith(fallbackPath.toLowerCase())) return clean;
    if (/\/api$/i.test(clean)) return `${clean}${fallbackPath}`;
    return `${clean}${fallbackPath}`;
};

const resolveDigifactLoginUrl = (
    request: Pick<FiscalDocumentIssueRequest | FiscalProviderTestRequest | FiscalStatusRequest, 'environment'> & { options?: any }
): string => {
    const explicitLogin = cleanString(request.options?.loginUrl || process.env.DIGIFACT_LOGIN_URL);
    if (/^https?:\/\//i.test(explicitLogin)) {
        return appendDigifactPath(explicitLogin, '/login/get_token');
    }

    const explicitTest = cleanString(request.options?.testUrl);
    if (/^https?:\/\//i.test(explicitTest)) {
        return appendDigifactPath(explicitTest, '/login/get_token');
    }

    return `${resolveDigifactBaseUrl(request)}/login/get_token`;
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
    if (/rechaz|error|failed|invalid|invalido|inválido|no coincide|esquema\s+nuc|schema/i.test(status)) return true;
    if (/rechaz|error|failed|invalid|invalido|inválido|no coincide|esquema\s+nuc|schema/i.test(message)) return true;
    if (Array.isArray(payload?.infoDetails) && payload.infoDetails.length > 0) return true;
    const code = Number(payload?.code ?? payload?.Code);
    return Number.isFinite(code) && code !== 1;
};

const mapPaymentMethod = (method?: string): string => {
    const normalized = cleanString(method).toUpperCase();
    if (['CREDIT', 'CREDITO'].includes(normalized)) return '2';
    if (['GIFT', 'VOUCHER', 'STORE_CREDIT', 'CREDIT_NOTE', 'VALE_NC', 'GRATIS', 'GRATUITO'].includes(normalized)) return '3';
    return '1';
};

const mapPaymentCode = (method?: string): string => {
    const normalized = cleanString(method).toUpperCase();
    if (['CASH', 'EFECTIVO'].includes(normalized)) return '1';
    if (['TRANSFER', 'WIRE', 'ACH', 'CHEQUE', 'CHECK', 'DEPOSITO'].includes(normalized)) return '2';
    if (['CARD', 'CREDIT_CARD', 'DEBIT_CARD', 'TARJETA'].includes(normalized)) return '3';
    if (['CREDIT', 'CREDITO'].includes(normalized)) return '4';
    if (['GIFT', 'VOUCHER', 'CERTIFICATE', 'BONO', 'REGALO'].includes(normalized)) return '5';
    if (['BARTER', 'PERMUTA'].includes(normalized)) return '6';
    if (['STORE_CREDIT', 'CREDIT_NOTE', 'VALE_NC', 'NOTA_CREDITO'].includes(normalized)) return '7';
    return '8';
};

const documentTypeCode = (documentCode: ElectronicDocumentCode): string =>
    String(documentCode).replace(/^E/, '');

const extractSequence = (encf: string, documentCode: ElectronicDocumentCode): string => {
    const digits = encf.replace(new RegExp(`^E?${documentTypeCode(documentCode)}`, 'i'), '').replace(/\D/g, '');
    return (digits || encf.replace(/\D/g, '')).slice(-10).padStart(10, '0');
};

const toDigifactDateTime = (value?: string): string => {
    const date = value ? new Date(value) : new Date();
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    const pad = (number: number) => String(number).padStart(2, '0');
    const offsetMinutes = -safeDate.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffset = Math.abs(offsetMinutes);
    return `${safeDate.getFullYear()}-${pad(safeDate.getMonth() + 1)}-${pad(safeDate.getDate())}` +
        `T${pad(safeDate.getHours())}:${pad(safeDate.getMinutes())}:${pad(safeDate.getSeconds())}` +
        `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
};

const itemTaxIndicator = (item: any): number => {
    if (Array.isArray(item?.appliedTaxIds) && item.appliedTaxIds.length > 0) return 1;
    return 4;
};

const digifactInfoList = (items: Array<{ Name: string; Value: unknown }>) =>
    items
        .map(item => ({ Name: item.Name, Value: String(item.Value ?? '').trim() }))
        .filter(item => item.Name && item.Value)
        .map(item => ({ Name: item.Name, Data: null, Value: item.Value }));

const digifactOptionalInfoList = (items: Array<{ Name: string; Value: unknown }>) => {
    const list = digifactInfoList(items);
    return list.length > 0 ? list : undefined;
};

const digifactTipoIngreso = (value?: number): string => {
    const normalized = Math.trunc(Number(value || 1));
    const safe = normalized >= 1 && normalized <= 6 ? normalized : 1;
    return String(safe).padStart(2, '0');
};

const digifactIndicatorMontoGravado = (transaction: any): string => {
    const raw = transaction?.isTaxIncluded ?? transaction?.taxIncluded ?? true;
    return raw === false ? '0' : '1';
};

const buildDigifactPayload = (request: FiscalDocumentIssueRequest) => {
    const { companyInfo, transaction, documentCode, options } = request;
    const customer = transaction.customerSnapshot || {};
    const eNCF = cleanString(transaction.electronicNcf || transaction.ncf);
    const total = round2(Math.abs(sanitizeNumber(transaction.total)));
    const taxAmount = round2(Math.abs(sanitizeNumber(transaction.taxAmount)));
    const netAmount = round2(Math.abs(sanitizeNumber(transaction.netAmount)) || Math.max(0, total - taxAmount));
    const taxRate = normalizePercentRate(options?.taxRate, 18);
    const taxableAmount = taxAmount > 0 ? netAmount : 0;
    const sequence = extractSequence(eNCF, documentCode);

    const items = (transaction.items || []).map((item) => {
        const quantity = Math.abs(sanitizeNumber(item.quantity)) || 1;
        const unitPrice = round2(Math.abs(sanitizeNumber(item.price)));
        const lineTotal = round2(quantity * unitPrice);
        const type = cleanString(item.type).toUpperCase() === 'SERVICE' ? 2 : 1;
        const taxIndicator = itemTaxIndicator(item) === 1 || taxAmount > 0 ? 1 : 4;
        const payloadItem: any = {
            Type: String(type),
            Description: (cleanString(item.name || item.id) || 'Item POS').slice(0, 80),
            Qty: quantity,
            Price: unitPrice,
            Totals: {
                TotalItem: lineTotal
            },
            AdditionalInfo: digifactInfoList([{ Name: 'IndicadorFacturacion', Value: String(taxIndicator) }])
        };
        const configuredUnitCode = Number(item.fiscalUnitCode || 0);
        if (Number.isFinite(configuredUnitCode) && configuredUnitCode > 0) {
            payloadItem.UnitOfMeasure = configuredUnitCode;
        }
        return payloadItem;
    });

    const payload: any = {
        Version: '1.0',
        CountryCode: 'DO',
        Header: {
            DocType: documentTypeCode(documentCode),
            IssuedDateTime: toDigifactDateTime(transaction.date),
            AdditionalIssueDocInfo: digifactInfoList([
                { Name: 'Secuencia', Value: sequence },
                { Name: 'IndicadorMontoGravado', Value: digifactIndicatorMontoGravado(transaction) },
                { Name: 'TipoIngresos', Value: digifactTipoIngreso(options?.tipoIngreso) },
                { Name: 'TipoPago', Value: mapPaymentMethod(transaction.payments?.[0]?.method) }
            ])
        },
        Seller: {
            TaxID: normalizeTaxId(companyInfo.rnc),
            Name: cleanString(companyInfo.name).slice(0, 150),
            AdditionalInfo: digifactInfoList([
                { Name: 'NumeroFacturaInterna', Value: cleanString(transaction.displayId || transaction.id).slice(0, 20) }
            ])
        },
        Items: items,
        Totals: {
            QtyItems: items.length,
            TotalTaxableAmount: taxableAmount,
            TotalTaxes: taxAmount > 0
                ? { TotalTax: [{ Code: 'ITBIS1', TaxableAmount: taxableAmount, Rate: taxRate, Amount: taxAmount }] }
                : { TotalTax: [{ Code: 'EXENTO', TaxableAmount: netAmount, Amount: 0 }] },
            GrandTotal: {
                InvoiceTotal: total
            }
        },
        Payments: [{
            Code: mapPaymentCode(transaction.payments?.[0]?.method),
            Amount: total
        }]
    };

    const buyerTaxId = normalizeTaxId((customer as any).taxId || (customer as any).rnc || (transaction as any).customerTaxId);
    const buyerName = cleanString((customer as any).name || transaction.customerName);
    if (buyerTaxId || total >= 250000) {
        const buyer: any = {
            TaxID: buyerTaxId || 'NO_APLICA',
            Name: (buyerName || 'Consumidor final').slice(0, 150)
        };
        payload.Buyer = buyer;
    }

    if (options?.sequenceExpiryDate && documentCode !== 'E32' && documentCode !== 'E34') {
        payload.Header.AdditionalIssueDocInfo.push({
            Name: 'FechaVencimientoSecuencia',
            Data: null,
            Value: options.sequenceExpiryDate.slice(0, 10)
        });
    }

    if (documentCode === 'E34') {
        const referenceInfo = digifactOptionalInfoList([
            { Name: 'NCFModificado', Value: cleanString(transaction.affectedNCF || transaction.affectedInvoiceNumber) },
            { Name: 'FechaNCFModificado', Value: cleanString(transaction.affectedInvoiceDate).slice(0, 10) },
            { Name: 'CodigoModificacion', Value: String(options?.modificationCode || 2) },
            { Name: 'RazonModificacion', Value: (cleanString(transaction.refundReason) || 'Nota de crédito generada desde POS').slice(0, 90) }
        ]);
        if (referenceInfo) {
            payload.AdditionalDocumentInfo = {
                AdditionalInfo: {
                    AditionalData: {
                        Data: [{
                            Name: 'INFORMACION_REFERENCIA',
                            Info: referenceInfo
                        }]
                    }
                }
            };
        }
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

        const loginUrl = resolveDigifactLoginUrl(request);
        const response = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ Username: username, Password: password })
        });
        const raw = await response.json().catch(() => ({}));
        const token = extractToken(raw);
        if (!response.ok || !token) {
            const safeUsername = queryUsername(username) || username;
            throw new Error(
                `DigiFact auth HTTP ${response.status}: ${extractMessage(raw) || 'Sin mensaje devuelto por DigiFact'} ` +
                `(ambiente=${Number(request.environment) === 1 ? 'produccion' : 'test'}, taxId=${taxId}, username=${safeUsername}, endpoint=${loginUrl})`
            );
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
