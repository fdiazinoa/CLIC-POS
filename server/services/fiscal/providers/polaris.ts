import {
    ElectronicDocumentCode,
    FiscalDocumentIssueResult,
    FiscalDocumentIssueRequest,
    FiscalPaymentInput,
    FiscalProvider,
    FiscalProviderTestRequest,
    FiscalProviderTestResult,
    FiscalStatusRequest,
    FiscalStatusResult,
    FiscalTransactionInput
} from './base.js';
import { resolveFiscalProviderCredential } from '../credentials.js';

const POLARIS_API_BASE = 'https://api.polarisedi.com';
const cachedAccessTokens = new Map<string, { value: string; expiresAt: number }>();

const sanitizeNumber = (value: unknown): number => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const round2 = (value: number): number =>
    Math.round((value + Number.EPSILON) * 100) / 100;

const amountsMatch = (left: number, right: number, tolerance = 0.02): boolean =>
    Math.abs(round2(left) - round2(right)) <= tolerance;

const cleanString = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';

const normalizeLookupKey = (value: unknown): string =>
    cleanString(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();

const toIsoDate = (value: unknown): string => {
    const date = new Date(String(value || new Date().toISOString()));
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
};

const normalizeTaxId = (value: unknown): string =>
    String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const resolvePricingContext = (
    transaction: FiscalTransactionInput,
    taxRatePercent: number
) => {
    const total = round2(Math.abs(sanitizeNumber(transaction.total)));
    const hasReportedTaxAmount = transaction.taxAmount != null;
    const hasReportedNetAmount = transaction.netAmount != null;
    const reportedTaxAmount = hasReportedTaxAmount
        ? round2(Math.abs(sanitizeNumber(transaction.taxAmount)))
        : 0;
    const reportedNetAmount = hasReportedNetAmount
        ? round2(Math.abs(sanitizeNumber(transaction.netAmount)))
        : 0;
    const hasExplicitItemTaxes = (transaction.items || []).some(item => (item.appliedTaxIds || []).length > 0);
    const grossItemsTotal = round2(
        (transaction.items || []).reduce((sum, item) => {
            const quantity = Math.abs(sanitizeNumber(item.quantity)) || 1;
            const unitPrice = round2(Math.abs(sanitizeNumber(item.price)));
            return sum + (quantity * unitPrice);
        }, 0)
    );
    const inferredTaxIncluded =
        taxRatePercent > 0
        && (hasReportedTaxAmount || hasReportedNetAmount)
        && amountsMatch(grossItemsTotal, total)
        && !amountsMatch(grossItemsTotal, reportedNetAmount);
    const useTaxIncludedPricing = transaction.isTaxIncluded === true || inferredTaxIncluded;

    const derived = (transaction.items || []).reduce((acc, item) => {
        const quantity = Math.abs(sanitizeNumber(item.quantity)) || 1;
        const rawUnitPrice = round2(Math.abs(sanitizeNumber(item.price)));
        const isTaxed = hasExplicitItemTaxes
            ? Boolean(item.appliedTaxIds?.length)
            : taxRatePercent > 0;
        const lineNetUnitPrice = useTaxIncludedPricing && isTaxed && taxRatePercent > 0
            ? round2(rawUnitPrice / (1 + (taxRatePercent / 100)))
            : rawUnitPrice;
        const lineNet = round2(quantity * lineNetUnitPrice);
        const lineGross = useTaxIncludedPricing || !isTaxed
            ? round2(quantity * rawUnitPrice)
            : round2(lineNet * (1 + (taxRatePercent / 100)));
        const lineTax = round2(lineGross - lineNet);

        acc.netAmount = round2(acc.netAmount + lineNet);
        acc.taxAmount = round2(acc.taxAmount + (isTaxed ? lineTax : 0));
        acc.total = round2(acc.total + lineGross);
        return acc;
    }, {
        netAmount: 0,
        taxAmount: 0,
        total: 0
    });

    return {
        total,
        reportedTaxAmount,
        reportedNetAmount,
        hasExplicitItemTaxes,
        useTaxIncludedPricing,
        derivedNetAmount: derived.netAmount,
        derivedTaxAmount: derived.taxAmount,
        derivedTotal: derived.total
    };
};

const assertCompanyCredentialAlignment = (
    companyRnc: string | undefined,
    resolvedCredentialKey: string | undefined
) => {
    const normalizedCompanyRnc = normalizeTaxId(companyRnc);
    const normalizedCredentialKey = normalizeTaxId(resolvedCredentialKey);

    if (!normalizedCompanyRnc || !normalizedCredentialKey) return;
    if (normalizedCompanyRnc === normalizedCredentialKey) return;

    throw new Error(
        `El RNC del emisor (${normalizedCompanyRnc}) no coincide con la credencial fiscal activa (${normalizedCredentialKey}). Actualiza Ajustes > Empresa o la Referencia de credencial antes de emitir con Polaris.`
    );
};

const endOfYearIso = (value: string): string => {
    const date = new Date(value);
    const year = Number.isFinite(date.getTime()) ? date.getFullYear() : new Date().getFullYear();
    return new Date(Date.UTC(year, 11, 31, 0, 0, 0)).toISOString();
};

const extractMessage = (payload: any): string => {
    const nestedMessages = Array.isArray(payload?.data?.Mensajes)
        ? payload.data.Mensajes
            .map((item: any) => cleanString(item?.Mensaje || item?.message))
            .filter(Boolean)
        : [];

    const candidates = [
        payload?.message,
        payload?.mensaje,
        payload?.Message,
        payload?.descripcion,
        payload?.Description,
        payload?.StatusDescription,
        payload?.data?.message,
        payload?.data?.mensaje,
        nestedMessages.length > 0 ? nestedMessages.join('; ') : undefined
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        if (Array.isArray(candidate) && candidate.length > 0) {
            return candidate.map(item => String(item)).join('; ');
        }
    }

    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
        return payload.errors.map((item: unknown) => String(item)).join('; ');
    }

    return 'Sin mensaje devuelto por Polaris.';
};

const hasErrorMessages = (payload: any): boolean => {
    const nestedMessages = Array.isArray(payload?.data?.Mensajes) ? payload.data.Mensajes : [];
    return nestedMessages.some((item: any) => {
        const type = Number(item?.Tipo);
        const message = cleanString(item?.Mensaje || item?.message);
        return type === 0 || /error|failed|rechaz|conversion failed/i.test(message);
    });
};

const extractStatus = (payload: any): string => {
    if (hasErrorMessages(payload)) return 'Error';

    const candidates = [
        payload?.estado,
        payload?.status,
        payload?.Status,
        payload?.data?.estado,
        payload?.data?.status,
        payload?.data?.Estado
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }

    if (payload?.success === true) return 'Procesado';
    if (payload?.success === false) return 'Rechazado';
    return '';
};

const extractProviderTransactionId = (payload: any): string | undefined => {
    const candidates = [
        payload?.TransaccionID,
        payload?.transaccionID,
        payload?.transactionId,
        payload?.data?.TransaccionID,
        payload?.data?.transaccionID,
        payload?.data?.transactionId
    ];

    for (const candidate of candidates) {
        if (candidate != null && String(candidate).trim()) return String(candidate).trim();
    }

    return undefined;
};

const isPendingLabel = (value: unknown): boolean =>
    /en espera|procesando|pendiente/i.test(cleanString(value));

const POLARIS_UNIT_ALIAS_MAP: Record<string, number> = {
    servicio: 43,
    service: 43,
    sv: 43,
    g: 31,
    gr: 31,
    gramo: 31,
    gramos: 31,
    kg: 31,
    kilo: 31,
    kilos: 31,
    kilogramo: 31,
    kilogramos: 31,
    mg: 31,
    lb: 31,
    libra: 31,
    libras: 31,
    oz: 31,
    onza: 31,
    onzas: 31,
    ton: 31,
    tonelada: 31,
    toneladas: 31,
    quintal: 31,
    quintales: 31,
    un: 47,
    und: 47,
    unidad: 47,
    unidades: 47,
    pc: 47,
    pieza: 47,
    piezas: 47,
    pza: 47,
    pzas: 47,
    caja: 47,
    cajas: 47,
    pack: 47,
    paquete: 47,
    paquetes: 47,
    botella: 47,
    botellas: 47,
    lata: 47,
    latas: 47,
    docena: 47,
    docenas: 47,
    par: 47,
    pares: 47
};

const mapMeasurementUnitCode = (
    unit: unknown,
    isService: boolean,
    fallbackCode?: number,
    explicitCode?: number
): number => {
    const explicit = Number(explicitCode);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const numericUnit = Number(cleanString(unit));
    if (Number.isFinite(numericUnit) && numericUnit > 0) return numericUnit;

    const normalized = normalizeLookupKey(unit);
    if (isService) return fallbackCode || 43;
    if (normalized && POLARIS_UNIT_ALIAS_MAP[normalized]) return POLARIS_UNIT_ALIAS_MAP[normalized];
    return fallbackCode || 47;
};

const mapFormaPago = (method?: string): number => {
    const normalized = cleanString(method).toUpperCase();
    if (['CASH', 'EFECTIVO'].includes(normalized)) return 1;
    if (['TRANSFER', 'WIRE', 'ACH', 'CHEQUE', 'CHECK', 'DEPOSITO'].includes(normalized)) return 2;
    if (['CARD', 'CREDIT_CARD', 'DEBIT_CARD', 'TARJETA'].includes(normalized)) return 3;
    if (['CREDIT', 'CREDITO'].includes(normalized)) return 4;
    if (['GIFT', 'VOUCHER', 'STORE_CREDIT', 'CREDIT_NOTE', 'VALE_NC'].includes(normalized)) return 6;
    return 7;
};

const mapFormasPago = (payments: FiscalPaymentInput[] | undefined, total: number) => {
    const validPayments = (payments || [])
        .map(payment => ({
            FormaPago: mapFormaPago(payment?.method),
            MontoPago: round2(Math.abs(sanitizeNumber(payment?.amount)))
        }))
        .filter(payment => payment.MontoPago > 0);

    if (validPayments.length === 0) {
        return [{ FormaPago: 1, MontoPago: round2(Math.abs(total)) }];
    }

    return validPayments;
};

const mapTipoPago = (transaction: FiscalTransactionInput): number => {
    const creditLikeAmount = (transaction.payments || [])
        .filter(payment => mapFormaPago(payment?.method) === 4)
        .reduce((sum, payment) => sum + sanitizeNumber(payment?.amount), 0);
    return creditLikeAmount > 0 ? 2 : 1;
};

const buildCommonDocumentFields = (request: FiscalDocumentIssueRequest) => {
    const { companyInfo, transaction, options } = request;
    const customerSnapshot = transaction.customerSnapshot || {};
    const taxId = normalizeTaxId(customerSnapshot.taxId);
    const formasPago = mapFormasPago(transaction.payments, transaction.total);
    const tipoPago = mapTipoPago(transaction);

    return {
        eNCF: cleanString(transaction.electronicNcf || transaction.ncf),
        FechaEmision: toIsoDate(transaction.date),
        TipoPago: tipoPago,
        TipoIngreso: options?.tipoIngreso || 1,
        FechaVencimientoSecuencia: options?.sequenceExpiryDate || endOfYearIso(transaction.date),
        FechaLimitePago: transaction.dueDate ? toIsoDate(transaction.dueDate) : undefined,
        RNCEmisor: normalizeTaxId(companyInfo.rnc),
        RazonSocialEmisor: cleanString(companyInfo.name),
        NombreComercialEmisor: cleanString(companyInfo.name),
        DireccionEmisor: cleanString(companyInfo.address),
        TelefonosEmisor: companyInfo.phone ? [cleanString(companyInfo.phone)] : undefined,
        CorreoEmisor: cleanString(companyInfo.email) || undefined,
        WebsiteEmisor: cleanString(companyInfo.website) || undefined,
        RNCComprador: taxId || undefined,
        RazonSocialComprador: cleanString(customerSnapshot.name || transaction.customerName) || undefined,
        DireccionComprador: cleanString(customerSnapshot.address) || undefined,
        ContactoComprador: cleanString(customerSnapshot.name || transaction.customerName) || undefined,
        CorreoComprador: cleanString(customerSnapshot.email) || undefined,
        NumeroFacturaInterna: cleanString(transaction.displayId || transaction.id),
        NumeroPedidoInterno: cleanString(transaction.displayId || transaction.id),
        FormasPago: formasPago,
        InformacionesAdicionales: {
            NumeroReferencia: cleanString(transaction.displayId || transaction.id)
        }
    };
};

const validateDocumentRequest = (request: FiscalDocumentIssueRequest) => {
    const { transaction, documentCode, companyInfo, options } = request;
    const items = Array.isArray(transaction.items) ? transaction.items : [];
    const total = round2(Math.abs(sanitizeNumber(transaction.total)));
    const customerSnapshot = transaction.customerSnapshot || {};
    const customerName = cleanString(customerSnapshot.name || transaction.customerName);
    const customerTaxId = normalizeTaxId(customerSnapshot.taxId);
    const issuerRnc = normalizeTaxId(companyInfo.rnc);
    const issuerName = cleanString(companyInfo.name);

    if (!issuerRnc || !issuerName) {
        throw new Error('El emisor debe tener nombre y RNC válidos antes de emitir con Polaris.');
    }

    if (!cleanString(transaction.electronicNcf || transaction.ncf)) {
        throw new Error('El e-NCF es obligatorio para emitir con Polaris.');
    }

    if (items.length === 0) {
        throw new Error('El documento electrónico debe tener al menos un ítem.');
    }

    if (total <= 0) {
        throw new Error('El total del documento electrónico debe ser mayor que cero.');
    }

    if (documentCode === 'E31') {
        if (!customerName) {
            throw new Error('El e-CF de Crédito Fiscal (E31) requiere nombre o razón social del comprador.');
        }

        if (!customerTaxId) {
            throw new Error('El e-CF de Crédito Fiscal (E31) requiere RNC o cédula del comprador.');
        }
    }

    if (documentCode === 'E34') {
        const affectedNCF = cleanString(transaction.affectedNCF);
        const affectedInvoiceDate = cleanString(transaction.affectedInvoiceDate);
        const refundReason = cleanString(transaction.refundReason);
        const modificationCode = Number(options?.modificationCode);

        if (!affectedNCF) {
            throw new Error('La Nota de Crédito electrónica (E34) requiere el NCF afectado.');
        }

        if (!affectedInvoiceDate) {
            throw new Error('La Nota de Crédito electrónica (E34) requiere la fecha del comprobante afectado.');
        }

        if (!refundReason) {
            throw new Error('La Nota de Crédito electrónica (E34) requiere una razón de modificación.');
        }

        if (!Number.isFinite(modificationCode) || modificationCode <= 0) {
            throw new Error('La Nota de Crédito electrónica (E34) requiere un código de modificación válido.');
        }
    }
};

const buildItemPayload = (
    transaction: FiscalTransactionInput,
    options: FiscalDocumentIssueRequest['options'],
    taxRatePercent: number
) => {
    const {
        hasExplicitItemTaxes,
        useTaxIncludedPricing
    } = resolvePricingContext(transaction, taxRatePercent);

    return (transaction.items || []).map(item => {
        const quantity = Math.abs(sanitizeNumber(item.quantity)) || 1;
        const rawUnitPrice = round2(Math.abs(sanitizeNumber(item.price)));
        const isTaxed = hasExplicitItemTaxes
            ? Boolean(item.appliedTaxIds?.length)
            : taxRatePercent > 0;
        const unitPrice = useTaxIncludedPricing && isTaxed && taxRatePercent > 0
            ? round2(rawUnitPrice / (1 + (taxRatePercent / 100)))
            : rawUnitPrice;
        const montoItem = round2(quantity * unitPrice);
        const isService = cleanString(item.type).toUpperCase() === 'SERVICE';

        return {
            IndicadorAgenteRetencionOPercepcion: 0,
            IndicadorFacturacion: isTaxed ? 2 : 5,
            Nombre: cleanString(item.name || item.id) || 'Item',
            IndicadorBienOServicio: isService ? 2 : 1,
            Cantidad: quantity,
            UnidadMedida: isService
                ? mapMeasurementUnitCode(item.measurementUnit, true, options?.unitCodeServices, item.fiscalUnitCode)
                : mapMeasurementUnitCode(item.measurementUnit, false, options?.unitCodeGoods, item.fiscalUnitCode),
            PrecioUnitario: unitPrice,
            MontoItem: montoItem
        };
    });
};

const buildTotals = (transaction: FiscalTransactionInput, taxRatePercent: number) => {
    const {
        total: reportedTotal,
        reportedTaxAmount,
        reportedNetAmount,
        derivedNetAmount,
        derivedTaxAmount,
        derivedTotal
    } = resolvePricingContext(transaction, taxRatePercent);
    const taxAmount = reportedTaxAmount > 0 ? reportedTaxAmount : derivedTaxAmount;
    const total = reportedTotal > 0 ? reportedTotal : derivedTotal;
    const netAmount = reportedNetAmount > 0
        ? reportedNetAmount
        : derivedNetAmount > 0
            ? derivedNetAmount
            : Math.max(0, total - taxAmount);
    const hasTax = taxAmount > 0 && taxRatePercent > 0;

    return {
        IndicadorMontoGravado: hasTax ? 1 : 0,
        MontoGravadoTotal: hasTax ? netAmount : 0,
        MontoGravadoI1: hasTax ? netAmount : 0,
        MontoExento: hasTax ? undefined : total,
        ITBIS1: hasTax ? taxRatePercent : 0,
        TotalITBIS: hasTax ? taxAmount : 0,
        TotalITBIS1: hasTax ? taxAmount : 0,
        MontoTotal: total
    };
};

const omitEmpty = <T extends Record<string, unknown>>(value: T): T => {
    const entries = Object.entries(value).filter(([, current]) => {
        if (current == null) return false;
        if (typeof current === 'string') return current.trim() !== '';
        if (Array.isArray(current)) return current.length > 0;
        return true;
    });

    return Object.fromEntries(entries) as T;
};

export class PolarisFiscalProvider implements FiscalProvider {
    readonly id = 'POLARIS' as const;

    private async getAccessToken(
        companyRnc?: string,
        credentialKey?: string
    ): Promise<{ accessToken: string; raw: unknown; credentialSource: string; resolvedCredentialKey?: string }> {
        const credential = await resolveFiscalProviderCredential(
            this.id,
            companyRnc ? { name: '', rnc: companyRnc } : undefined,
            credentialKey
        );

        const cached = cachedAccessTokens.get(credential.authToken);
        if (cached && Date.now() < cached.expiresAt) {
            return {
                accessToken: cached.value,
                raw: { cache: true },
                credentialSource: credential.source,
                resolvedCredentialKey: credential.resolvedCredentialKey
            };
        }

        const response = await fetch(`${POLARIS_API_BASE}/autenticacion/token?authtoken=${encodeURIComponent(credential.authToken)}`);
        const raw = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(`Polaris auth HTTP ${response.status}: ${extractMessage(raw)}`);
        }

        const accessToken = cleanString((raw as any)?.data || (raw as any)?.token || (raw as any)?.accessToken);
        if (!accessToken) {
            throw new Error(`Polaris no devolvió Access Token: ${extractMessage(raw)}`);
        }

        cachedAccessTokens.set(credential.authToken, {
            value: accessToken,
            expiresAt: Date.now() + (55 * 60 * 1000)
        });

        return {
            accessToken,
            raw,
            credentialSource: credential.source,
            resolvedCredentialKey: credential.resolvedCredentialKey
        };
    }

    private resolveEndpoint(documentCode: ElectronicDocumentCode): string {
        switch (documentCode) {
            case 'E31':
                return 'FacturasCreditoFiscal/Firmar';
            case 'E32':
                return 'FacturasConsumo/Firmar';
            case 'E34':
                return 'NotasCredito/Firmar';
            default:
                throw new Error(`Tipo de documento ${documentCode} no soportado por Polaris.`);
        }
    }

    private buildPayload(request: FiscalDocumentIssueRequest): Record<string, unknown> {
        const common = buildCommonDocumentFields(request);
        const taxRatePercent = round2((sanitizeNumber(request.options?.taxRate) || 0) * 100);
        const items = buildItemPayload(request.transaction, request.options, taxRatePercent);
        const totals = buildTotals(request.transaction, taxRatePercent);

        if (request.documentCode === 'E34') {
            return omitEmpty({
                ...common,
                ...totals,
                IndicadorNotaCredito: false,
                RazonModificacionReferencia: cleanString(request.transaction.refundReason) || 'Ajuste comercial',
                NCFModificadoReferencia: cleanString(request.transaction.affectedNCF),
                FechaNCFModificadoReferencia: toIsoDate(request.transaction.affectedInvoiceDate || request.transaction.date),
                CodigoModificacionReferencia: request.options?.modificationCode || 2,
                TextoModificacion: cleanString(request.transaction.refundReason) || 'Nota de crédito generada desde POS',
                Items: items
            });
        }

        return omitEmpty({
            ...common,
            ...totals,
            ValorPagar: totals.MontoTotal,
            MontoPeriodo: request.documentCode === 'E31' ? totals.MontoTotal : undefined,
            Items: items
        });
    }

    async testConnection(request: FiscalProviderTestRequest): Promise<FiscalProviderTestResult> {
        const { raw, credentialSource, resolvedCredentialKey } = await this.getAccessToken(
            request.companyInfo?.rnc,
            request.credentialKey
        );
        return {
            success: true,
            providerId: this.id,
            environment: request.environment,
            message: 'Autenticación con Polaris completada correctamente.',
            credentialSource: credentialSource as any,
            resolvedCredentialKey,
            raw
        };
    }

    async issueDocument(request: FiscalDocumentIssueRequest): Promise<FiscalDocumentIssueResult> {
        validateDocumentRequest(request);

        const { accessToken, resolvedCredentialKey } = await this.getAccessToken(
            request.companyInfo?.rnc,
            request.options?.credentialKey
        );
        assertCompanyCredentialAlignment(request.companyInfo?.rnc, resolvedCredentialKey);
        const endpoint = this.resolveEndpoint(request.documentCode);
        const body = this.buildPayload(request);

        const response = await fetch(
            `${POLARIS_API_BASE}/${endpoint}?ambiente=${request.environment}&token=${encodeURIComponent(accessToken)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            }
        );

        const raw = await response.json().catch(() => ({}));
        const status = extractStatus(raw);
        const message = extractMessage(raw);
        const providerTransactionId = extractProviderTransactionId(raw);
        const success = (raw as any)?.success === true && !hasErrorMessages(raw);
        const pending = isPendingLabel(status) || isPendingLabel(message);

        if (!response.ok) {
            return {
                success: false,
                providerId: this.id,
                environment: request.environment,
                documentCode: request.documentCode,
                providerTransactionId,
                status: status || `HTTP ${response.status}`,
                message,
                pending: false,
                raw
            };
        }

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
        const { accessToken, resolvedCredentialKey } = await this.getAccessToken(
            request.companyRnc,
            request.credentialKey
        );
        assertCompanyCredentialAlignment(request.companyRnc, resolvedCredentialKey);
        const response = await fetch(
            `${POLARIS_API_BASE}/ComprobantesElectronicos/ConsultarResultado?ambiente=${request.environment}&token=${encodeURIComponent(accessToken)}&transaccionID=${encodeURIComponent(request.providerTransactionId)}`
        );

        const raw = await response.json().catch(() => ({}));
        const message = extractMessage(raw);
        const status = extractStatus(raw);
        const pending = isPendingLabel(status) || isPendingLabel(message);
        const success = response.ok && (raw as any)?.success !== false && !hasErrorMessages(raw);

        return {
            success,
            providerId: this.id,
            environment: request.environment,
            providerTransactionId: request.providerTransactionId,
            status: pending ? (status || 'En Espera') : status,
            message,
            raw: {
                ...((raw as any) || {}),
                pending
            }
        };
    }
}
