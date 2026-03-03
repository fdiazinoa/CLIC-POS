import {
    BusinessConfig,
    PurchaseOrder,
    Reception,
    Supplier,
    Transaction
} from '../types';
import * as XLSX from 'xlsx';

type ExcelCellType = 'String' | 'Number';

interface ExcelCell {
    value: string | number | null | undefined;
    type: ExcelCellType;
}

interface ExcelRow {
    cells: ExcelCell[];
    styleId?: string;
}

interface ExcelSheet {
    name: string;
    rows: ExcelRow[];
}

interface Form607Row {
    sourceId: string;
    rncCedulaPasaporte: string;
    tipoIdentificacion: number | '';
    ncf: string;
    ncfModificado: string;
    tipoIngreso: string;
    fechaComprobante: string;
    fechaRetencion: string;
    montoFacturado: number;
    itbisFacturado: number;
    itbisRetenidoPorTerceros: number;
    itbisPercibido: number;
    retencionRentaPorTerceros: number;
    isrPercibido: number;
    impuestoSelectivoConsumo: number;
    otrosImpuestosTasas: number;
    montoPropinaLegal: number;
    efectivo: number;
    chequeTransferenciaDeposito: number;
    tarjetaDebitoCredito: number;
    ventaCredito: number;
    bonosOCertificadosRegalo: number;
    permuta: number;
    otrasFormasVentas: number;
}

interface Form606Row {
    sourceId: string;
    rncCedula: string;
    tipoIdentificacion: number | '';
    tipoBienesServiciosComprados: string;
    ncf: string;
    ncfModificado: string;
    fechaComprobante: string;
    fechaPago: string;
    montoFacturadoServicios: number;
    montoFacturadoBienes: number;
    totalMontoFacturado: number;
    itbisFacturado: number;
    itbisRetenido: number;
    itbisSujetoProporcionalidad: number;
    itbisLlevadoCosto: number;
    itbisPorAdelantar: number;
    itbisPercibidoCompras: number;
    tipoRetencionISR: string;
    montoRetencionRenta: number;
    isrPercibidoCompras: number;
    impuestoSelectivoConsumo: number;
    otrosImpuestosTasas: number;
    montoPropinaLegal: number;
    formaPago: string;
}

interface Form608Row {
    sourceId: string;
    ncf: string;
    fechaAnulacion: string;
    tipoAnulacion: string;
}

interface FiscalPreflightError {
    code: string;
    message: string;
}

export interface FiscalExcelOptions {
    config: BusinessConfig;
    transactions: Transaction[];
    transactionHistory?: Transaction[];
    purchaseOrders?: PurchaseOrder[];
    receptions?: Reception[];
    suppliers?: Supplier[];
    period?: string; // AAAAMM
    consolidateB02?: boolean;
    formatType?: '607' | '606' | '608' | 'ALL';
    suggestedFileName?: string;
}

export interface FiscalExcelResult {
    fileName: string;
    period: string;
    counts: {
        form607: number;
        form606: number;
        form608: number;
    };
    warnings: string[];
}

export interface Fiscal607RepairCandidate {
    sourceId: string;
    sourceCollection: 'transactions' | 'transactionHistory';
    displayId: string;
    ncf: string;
    date: string;
    terminalId: string;
    persistedTotal: number;
    currentNetAmount: number;
    currentTaxAmount: number;
    impuestoSelectivoConsumo: number;
    otrosImpuestosTasas: number;
    montoPropinaLegal: number;
    currentPaymentsTotal: number;
    computedFiscalTotal: number;
    suggestedTotal: number;
    suggestedNetAmount: number;
    suggestedTaxAmount: number;
    payments: any[];
    suggestedPayments: any[];
}

const EPSILON = 0.01;
const B02_CONSOLIDATION_LIMIT = 250000;
const DEFAULT_TIPO_INGRESO = '01';
const DEFAULT_TIPO_BIEN_SERVICIO_606 = '11';
const DEFAULT_FORMA_PAGO_606 = '04';
const DEFAULT_TIPO_ANULACION_608 = '09';
const SALES_NCF_PREFIXES = ['B01', 'B02', 'B04', 'B14', 'B15'];

const INCOME_TYPE_MAP: Record<string, string> = {
    '1': '01',
    '01': '01',
    OPERACIONES: '01',
    OPERACION: '01',
    INGRESOSPOROPERACIONES: '01',
    '2': '02',
    '02': '02',
    FINANCIEROS: '02',
    INGRESOSFINANCIEROS: '02',
    '3': '03',
    '03': '03',
    EXTRAORDINARIOS: '03',
    INGRESOSEXTRAORDINARIOS: '03',
    '4': '04',
    '04': '04',
    ARRENDAMIENTOS: '04',
    '5': '05',
    '05': '05',
    VENTAACTIVOSDEPRECIABLES: '05',
    ACTIVOSDEPRECIABLES: '05',
    '6': '06',
    '06': '06',
    OTROSINGRESOS: '06',
    OTROS: '06'
};

const PURCHASE_TYPE_606_MAP: Record<string, string> = {
    '1': '01',
    '01': '01',
    GASTOSPERSONAL: '01',
    '2': '02',
    '02': '02',
    GASTOSPORTRABAJOS: '02',
    '3': '03',
    '03': '03',
    ARRENDAMIENTOS: '03',
    '4': '04',
    '04': '04',
    ACTIVOSFIJOS: '04',
    '5': '05',
    '05': '05',
    GASTOSREPRESENTACION: '05',
    '6': '06',
    '06': '06',
    OTRASDEDUCCIONES: '06',
    '7': '07',
    '07': '07',
    GASTOSFINANCIEROS: '07',
    '8': '08',
    '08': '08',
    GASTOSEXTRAORDINARIOS: '08',
    '9': '09',
    '09': '09',
    ADQUISICIONESACTIVOS: '09',
    '10': '10',
    COMPRASYGASTOSFORMANPARTEDECOSTO: '10',
    '11': '11',
    OTRASCOMPRASYGASTOS: '11'
};

const CANCELLATION_TYPE_608_KEYWORDS: Array<{ code: string; tokens: string[] }> = [
    { code: '01', tokens: ['DETERIORO'] },
    { code: '02', tokens: ['PERDIDA', 'EXTRAVIO'] },
    { code: '03', tokens: ['ROBO'] },
    { code: '04', tokens: ['ERRORIMPRESION', 'ERRORESIMPRESION', 'IMPRESION'] },
    { code: '05', tokens: ['OMISION', 'OMISIONES'] },
    { code: '06', tokens: ['CONTINGENCIA', 'FALLOSISTEMA', 'SISTEMA'] },
    { code: '07', tokens: ['DEVOLUCION'] },
    { code: '08', tokens: ['SECUENCIA', 'NOUSADA'] },
    { code: '09', tokens: ['ANULACIONADMINISTRATIVA', 'OTROS'] },
    { code: '10', tokens: ['NOTACREDITO', 'CREDITOFISCAL'] }
];

const stringCell = (value: string | number | null | undefined): ExcelCell => ({
    value: value == null ? '' : String(value),
    type: 'String'
});

const numberCell = (value: number | null | undefined): ExcelCell => ({
    value: Number.isFinite(Number(value)) ? round2(Number(value)) : 0,
    type: 'Number'
});

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const toNumber = (value: unknown): number => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const clonePayments = (payments: any[]): any[] => (payments || []).map(payment => ({ ...payment }));

const normalizeTextKey = (value: unknown): string =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase();

const onlyDigits = (value: unknown): string => String(value || '').replace(/\D/g, '');

const sanitizeTaxId = (value: unknown): string => String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const normalizeNcf = (value: unknown): string => String(value || '').trim().toUpperCase();

const resolveCurrentConfig = (config: BusinessConfig): BusinessConfig => config || ({} as BusinessConfig);

const getItemTaxRate = (item: any, taxesById: Map<string, any>): number => {
    const taxIds = Array.isArray(item?.appliedTaxIds) ? item.appliedTaxIds : [];
    return taxIds.reduce((sum: number, taxId: string) => {
        const tax = taxesById.get(taxId);
        return sum + Math.max(0, toNumber(tax?.rate));
    }, 0);
};

const deriveFiscalAmountsFromItems = (tx: Transaction, config: BusinessConfig): { total: number; netAmount: number; taxAmount: number } | null => {
    const items = Array.isArray(tx.items) ? tx.items : [];
    if (items.length === 0) return null;

    const grossLineTotal = round2(items.reduce((sum, item: any) => {
        const price = Math.abs(toNumber(item?.price));
        const quantity = Math.abs(toNumber(item?.quantity));
        return sum + (price * quantity);
    }, 0));
    const discountAmount = round2(Math.abs(toNumber((tx as any).discountAmount)));
    const totalAfterDiscount = round2(Math.max(0, grossLineTotal - discountAmount));
    if (totalAfterDiscount <= EPSILON) return null;

    const taxesById = new Map<string, any>(
        (Array.isArray(resolveCurrentConfig(config)?.taxes) ? resolveCurrentConfig(config).taxes : []).map((tax: any) => [tax.id, tax])
    );

    let netAmount = 0;
    let taxAmount = 0;

    items.forEach((item: any) => {
        const lineGross = Math.abs(toNumber(item?.price)) * Math.abs(toNumber(item?.quantity));
        if (lineGross <= EPSILON) return;

        const itemRatio = lineGross / (grossLineTotal || 1);
        const lineDiscount = discountAmount * itemRatio;
        const lineBaseAfterDiscount = round2(Math.max(0, lineGross - lineDiscount));
        const itemTaxRate = getItemTaxRate(item, taxesById);
        const lineNet = tx.isTaxIncluded
            ? round2(lineBaseAfterDiscount / (1 + itemTaxRate))
            : lineBaseAfterDiscount;
        const lineTax = round2(Math.max(0, lineBaseAfterDiscount - lineNet));

        netAmount += lineNet;
        taxAmount += lineTax;
    });

    netAmount = round2(netAmount);
    taxAmount = round2(taxAmount);

    return {
        total: round2(tx.isTaxIncluded ? totalAfterDiscount : netAmount + taxAmount),
        netAmount,
        taxAmount
    };
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const formatDateYYYYMMDD = (value: unknown): string => {
    if (!value) return '';
    const date = new Date(String(value));
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
};

const derivePeriod = (period: string | undefined): string => {
    if (period && /^\d{6}$/.test(period)) return period;
    const now = new Date();
    return `${now.getFullYear()}${pad2(now.getMonth() + 1)}`;
};

const dedupeTransactions = (transactions: Transaction[]): Transaction[] => {
    const map = new Map<string, Transaction>();
    transactions.forEach((tx) => {
        if (!tx?.id) return;
        map.set(tx.id, tx);
    });
    return Array.from(map.values());
};

const detectTipoIdentificacion = (rawTaxId: string): number | '' => {
    if (!rawTaxId) return '';
    const digits = onlyDigits(rawTaxId);
    if (digits.length === 9) return 1; // RNC
    if (digits.length === 11) return 2; // Cedula
    return 3; // Pasaporte
};

const mapTipoIngreso = (tx: Transaction): string => {
    const anyTx = tx as any;
    const raw = anyTx.tipoIngreso ?? anyTx.incomeType ?? anyTx.incomeCategory ?? anyTx.tipoIngresoCodigo;
    const key = normalizeTextKey(raw);
    if (INCOME_TYPE_MAP[key]) return INCOME_TYPE_MAP[key];

    const numericRaw = String(raw || '').trim();
    if (/^\d+$/.test(numericRaw)) {
        const padded = numericRaw.padStart(2, '0');
        if (INCOME_TYPE_MAP[padded]) return INCOME_TYPE_MAP[padded];
    }
    return DEFAULT_TIPO_INGRESO;
};

const mapTipoBienServicio606 = (raw: unknown): string => {
    const key = normalizeTextKey(raw);
    if (PURCHASE_TYPE_606_MAP[key]) return PURCHASE_TYPE_606_MAP[key];

    const numericRaw = String(raw || '').trim();
    if (/^\d+$/.test(numericRaw)) {
        const padded = numericRaw.padStart(2, '0');
        if (PURCHASE_TYPE_606_MAP[padded]) return PURCHASE_TYPE_606_MAP[padded];
    }
    return DEFAULT_TIPO_BIEN_SERVICIO_606;
};

const mapTipoAnulacion608 = (reason: unknown): string => {
    const normalized = normalizeTextKey(reason);
    if (!normalized) return DEFAULT_TIPO_ANULACION_608;
    for (const rule of CANCELLATION_TYPE_608_KEYWORDS) {
        if (rule.tokens.some(token => normalized.includes(token))) return rule.code;
    }
    return DEFAULT_TIPO_ANULACION_608;
};

type PaymentBucketKey =
    | 'efectivo'
    | 'chequeTransferenciaDeposito'
    | 'tarjetaDebitoCredito'
    | 'ventaCredito'
    | 'bonosOCertificadosRegalo'
    | 'permuta'
    | 'otrasFormasVentas';

type PaymentBuckets = Record<PaymentBucketKey, number>;

const emptyPaymentBuckets = (): PaymentBuckets => ({
    efectivo: 0,
    chequeTransferenciaDeposito: 0,
    tarjetaDebitoCredito: 0,
    ventaCredito: 0,
    bonosOCertificadosRegalo: 0,
    permuta: 0,
    otrasFormasVentas: 0
});

const classifyPayment = (payment: any): PaymentBucketKey => {
    const descriptor = normalizeTextKey(
        payment?.method ?? payment?.type ?? payment?.methodId ?? payment?.methodLabel ?? payment?.name
    );

    if (descriptor.includes('CASH') || descriptor.includes('EFECTIVO')) return 'efectivo';
    if (
        descriptor.includes('CHEQUE')
        || descriptor.includes('CHECK')
        || descriptor.includes('TRANSFER')
        || descriptor.includes('WIRE')
        || descriptor.includes('ACH')
        || descriptor.includes('DEPOSITO')
        || descriptor.includes('DEPOSIT')
    ) {
        return 'chequeTransferenciaDeposito';
    }
    if (
        descriptor.includes('CARD')
        || descriptor.includes('TARJETA')
        || descriptor.includes('DEBIT')
        || descriptor.includes('CREDITCARD')
    ) {
        return 'tarjetaDebitoCredito';
    }
    if (
        descriptor === 'CREDIT'
        || descriptor.includes('VENTACREDITO')
        || descriptor.includes('CREDITOCLIENTE')
        || descriptor.includes('CUENTAPORCOBRAR')
    ) {
        return 'ventaCredito';
    }
    if (
        descriptor.includes('GIFT')
        || descriptor.includes('BONO')
        || descriptor.includes('CERTIFICADO')
        || descriptor.includes('VOUCHER')
    ) {
        return 'bonosOCertificadosRegalo';
    }
    if (descriptor.includes('PERMUTA') || descriptor.includes('BARTER') || descriptor.includes('TRUEQUE')) {
        return 'permuta';
    }
    return 'otrasFormasVentas';
};

const sumPaymentBuckets = (buckets: PaymentBuckets): number =>
    round2(
        buckets.efectivo
        + buckets.chequeTransferenciaDeposito
        + buckets.tarjetaDebitoCredito
        + buckets.ventaCredito
        + buckets.bonosOCertificadosRegalo
        + buckets.permuta
        + buckets.otrasFormasVentas
    );

const resolvePaymentAmount = (payment: any): number => {
    const preferredAppliedAmount = toNumber(
        payment?.appliedAmount
        ?? payment?.amountApplied
        ?? payment?.fiscalAmount
    );
    if (preferredAppliedAmount > 0) {
        return Math.abs(preferredAppliedAmount);
    }
    return Math.abs(toNumber(payment?.amount));
};

const aggregatePayments = (payments: any[], expectedTotal: number): PaymentBuckets => {
    const buckets = emptyPaymentBuckets();
    const normalizedExpectedTotal = round2(Math.abs(toNumber(expectedTotal)));
    if (normalizedExpectedTotal <= EPSILON) return buckets;

    // DGII requiere montos aplicados; si hubo sobreentrega (vuelto), el excedente no se reporta.
    let remainingToApply = normalizedExpectedTotal;
    (payments || []).forEach((payment) => {
        if (remainingToApply <= EPSILON) return;
        const amount = resolvePaymentAmount(payment);
        if (amount <= 0) return;
        const appliedAmount = Math.min(amount, remainingToApply);
        if (appliedAmount <= 0) return;
        const bucket = classifyPayment(payment);
        buckets[bucket] = round2(buckets[bucket] + appliedAmount);
        remainingToApply = round2(Math.max(0, remainingToApply - appliedAmount));
    });

    const paymentsTotal = sumPaymentBuckets(buckets);
    if (paymentsTotal === 0 && normalizedExpectedTotal > 0) {
        buckets.ventaCredito = normalizedExpectedTotal;
        return buckets;
    }

    const diff = round2(normalizedExpectedTotal - paymentsTotal);
    if (Math.abs(diff) <= 0.02 && Math.abs(diff) > EPSILON) {
        buckets.otrasFormasVentas = round2(Math.max(0, buckets.otrasFormasVentas + diff));
    }
    return buckets;
};

const buildSuggestedPayments = (payments: any[], expectedTotal: number): any[] => {
    const normalizedExpectedTotal = round2(Math.abs(toNumber(expectedTotal)));
    const clonedPayments = clonePayments(payments);

    if (normalizedExpectedTotal <= EPSILON) return clonedPayments;
    if (clonedPayments.length === 0) {
        return [{
            id: `FISCAL-REPAIR-${Date.now()}`,
            method: 'CASH',
            amount: normalizedExpectedTotal,
            amountOriginal: normalizedExpectedTotal,
            exchangeRate: 1,
            currencyCode: 'DOP',
            timestamp: new Date().toISOString()
        }];
    }

    const currentTotal = round2(clonedPayments.reduce((sum, payment) => sum + Math.abs(toNumber(payment?.amount)), 0));
    if (Math.abs(currentTotal - normalizedExpectedTotal) <= EPSILON) return clonedPayments;

    if (clonedPayments.length === 1) {
        const payment = { ...clonedPayments[0] };
        payment.amount = normalizedExpectedTotal;
        if (payment.amountOriginal != null) {
            const exchangeRate = toNumber(payment.exchangeRate);
            payment.amountOriginal = exchangeRate > EPSILON
                ? round2(normalizedExpectedTotal / exchangeRate)
                : normalizedExpectedTotal;
        }
        return [payment];
    }

    let remaining = normalizedExpectedTotal;
    return clonedPayments.map((payment, index) => {
        const nextPayment = { ...payment };
        if (index === clonedPayments.length - 1) {
            nextPayment.amount = round2(Math.max(0, remaining));
        } else {
            const originalAmount = Math.abs(toNumber(payment?.amount));
            const proportionalAmount = currentTotal > EPSILON
                ? round2((originalAmount / currentTotal) * normalizedExpectedTotal)
                : 0;
            nextPayment.amount = proportionalAmount;
            remaining = round2(Math.max(0, remaining - proportionalAmount));
        }

        if (nextPayment.amountOriginal != null) {
            const exchangeRate = toNumber(nextPayment.exchangeRate);
            nextPayment.amountOriginal = exchangeRate > EPSILON
                ? round2(nextPayment.amount / exchangeRate)
                : nextPayment.amount;
        }

        return nextPayment;
    });
};

const extract607Totals = (tx: Transaction): {
    montoFacturado: number;
    itbisFacturado: number;
    impuestoSelectivoConsumo: number;
    otrosImpuestosTasas: number;
    montoPropinaLegal: number;
    totalFacturado: number;
} => {
    const anyTx = tx as any;
    const total = Math.abs(toNumber(tx.total));
    const net = Math.abs(toNumber(tx.netAmount));
    const tax = Math.abs(toNumber(tx.taxAmount));
    const impuestoSelectivoConsumo = Math.abs(
        toNumber(anyTx.impuestoSelectivoConsumo ?? anyTx.iscAmount ?? anyTx.selectiveTaxAmount)
    );
    const otrosImpuestosTasas = Math.abs(
        toNumber(anyTx.otrosImpuestosTasas ?? anyTx.otherTaxes ?? anyTx.otherTaxAmount)
    );
    const montoPropinaLegal = Math.abs(
        toNumber(anyTx.montoPropinaLegal ?? anyTx.tipAmount ?? anyTx.legalTipAmount ?? anyTx.serviceChargeAmount)
    );

    let itbisFacturado = tax;
    let montoFacturado = net;

    if (montoFacturado <= 0 && total > 0) {
        const rest = impuestoSelectivoConsumo + otrosImpuestosTasas + montoPropinaLegal;
        if (itbisFacturado <= 0) {
            itbisFacturado = Math.max(0, total - rest - (total / 1.18));
        }
        montoFacturado = Math.max(0, total - itbisFacturado - rest);
    }

    if (itbisFacturado <= 0 && total > 0 && montoFacturado > 0 && total >= montoFacturado) {
        itbisFacturado = Math.max(0, total - montoFacturado - impuestoSelectivoConsumo - otrosImpuestosTasas - montoPropinaLegal);
    }

    if (montoFacturado <= 0 && total > 0) {
        montoFacturado = total;
        itbisFacturado = 0;
    }

    const totalFacturado = round2(
        montoFacturado + itbisFacturado + impuestoSelectivoConsumo + otrosImpuestosTasas + montoPropinaLegal
    );

    return {
        montoFacturado: round2(montoFacturado),
        itbisFacturado: round2(itbisFacturado),
        impuestoSelectivoConsumo: round2(impuestoSelectivoConsumo),
        otrosImpuestosTasas: round2(otrosImpuestosTasas),
        montoPropinaLegal: round2(montoPropinaLegal),
        totalFacturado
    };
};

const normalizeForm607Row = (tx: Transaction): Form607Row | null => {
    const ncf = normalizeNcf(tx.ncf);
    if (!ncf) return null;

    const anyTx = tx as any;
    const rawTaxId = sanitizeTaxId(
        tx.customerSnapshot?.taxId
        ?? anyTx.customerTaxId
        ?? anyTx.taxId
        ?? ''
    );
    const tipoIdentificacion = rawTaxId ? detectTipoIdentificacion(rawTaxId) : '';

    const totals = extract607Totals(tx);
    const payments = aggregatePayments(tx.payments || [], totals.totalFacturado);
    const ncfModificado = tx.ncfType === 'B04'
        ? normalizeNcf(tx.affectedNCF ?? anyTx.ncfModificado)
        : normalizeNcf(anyTx.ncfModificado);

    return {
        sourceId: tx.id,
        rncCedulaPasaporte: rawTaxId,
        tipoIdentificacion,
        ncf,
        ncfModificado,
        tipoIngreso: mapTipoIngreso(tx),
        fechaComprobante: formatDateYYYYMMDD(tx.date),
        fechaRetencion: formatDateYYYYMMDD(anyTx.fechaRetencion ?? anyTx.retentionDate),
        montoFacturado: totals.montoFacturado,
        itbisFacturado: totals.itbisFacturado,
        itbisRetenidoPorTerceros: Math.abs(toNumber(anyTx.itbisRetenidoPorTerceros ?? anyTx.itbisRetenidoTerceros)),
        itbisPercibido: Math.abs(toNumber(anyTx.itbisPercibido)),
        retencionRentaPorTerceros: Math.abs(toNumber(anyTx.retencionRentaPorTerceros)),
        isrPercibido: Math.abs(toNumber(anyTx.isrPercibido)),
        impuestoSelectivoConsumo: totals.impuestoSelectivoConsumo,
        otrosImpuestosTasas: totals.otrosImpuestosTasas,
        montoPropinaLegal: totals.montoPropinaLegal,
        efectivo: payments.efectivo,
        chequeTransferenciaDeposito: payments.chequeTransferenciaDeposito,
        tarjetaDebitoCredito: payments.tarjetaDebitoCredito,
        ventaCredito: payments.ventaCredito,
        bonosOCertificadosRegalo: payments.bonosOCertificadosRegalo,
        permuta: payments.permuta,
        otrasFormasVentas: payments.otrasFormasVentas
    };
};

type TransactionSourceRecord = {
    tx: Transaction;
    sourceCollection: 'transactions' | 'transactionHistory';
};

const dedupeTransactionSources = (transactions: Transaction[], transactionHistory: Transaction[]): TransactionSourceRecord[] => {
    const records = new Map<string, TransactionSourceRecord>();

    (transactionHistory || []).forEach((tx) => {
        if (!tx?.id) return;
        records.set(tx.id, { tx, sourceCollection: 'transactionHistory' });
    });

    (transactions || []).forEach((tx) => {
        if (!tx?.id) return;
        records.set(tx.id, { tx, sourceCollection: 'transactions' });
    });

    return Array.from(records.values());
};

const buildFiscal607RepairCandidate = (
    tx: Transaction,
    sourceCollection: 'transactions' | 'transactionHistory',
    config: BusinessConfig
): Fiscal607RepairCandidate | null => {
    const normalizedRow = normalizeForm607Row(tx);
    if (!normalizedRow) return null;

    const totals = extract607Totals(tx);
    const reportablePayments = aggregatePayments(tx.payments || [], totals.totalFacturado);
    const reportablePaymentsTotal = sumPaymentBuckets(reportablePayments);
    if (Math.abs(reportablePaymentsTotal - totals.totalFacturado) <= EPSILON) return null;

    const staticCharges = round2(
        totals.impuestoSelectivoConsumo + totals.otrosImpuestosTasas + totals.montoPropinaLegal
    );
    const persistedTotal = round2(Math.abs(toNumber(tx.total)));
    const baseTarget = round2(Math.max(0, (persistedTotal || totals.totalFacturado) - staticCharges));
    const currentTaxAmount = round2(Math.abs(toNumber(tx.taxAmount)));
    const derived = deriveFiscalAmountsFromItems(tx, config);

    let suggestedNetAmount = derived?.netAmount ?? 0;
    let suggestedTaxAmount = derived?.taxAmount ?? 0;

    if (baseTarget > EPSILON) {
        if (suggestedNetAmount <= EPSILON && currentTaxAmount > EPSILON && currentTaxAmount < baseTarget) {
            suggestedTaxAmount = currentTaxAmount;
            suggestedNetAmount = round2(baseTarget - currentTaxAmount);
        } else if (suggestedNetAmount <= EPSILON && tx.isTaxIncluded) {
            suggestedTaxAmount = round2(Math.max(0, baseTarget - (baseTarget / 1.18)));
            suggestedNetAmount = round2(baseTarget - suggestedTaxAmount);
        } else {
            suggestedNetAmount = round2(Math.max(0, suggestedNetAmount));
            suggestedTaxAmount = round2(Math.max(0, baseTarget - suggestedNetAmount));
        }
    }

    const suggestedTotal = round2(
        (persistedTotal || round2(suggestedNetAmount + suggestedTaxAmount + staticCharges))
    );

    return {
        sourceId: tx.id,
        sourceCollection,
        displayId: String(tx.displayId || tx.id),
        ncf: normalizeNcf(tx.ncf),
        date: tx.date,
        terminalId: String(tx.terminalId || ''),
        persistedTotal,
        currentNetAmount: round2(Math.abs(toNumber(tx.netAmount))),
        currentTaxAmount,
        impuestoSelectivoConsumo: totals.impuestoSelectivoConsumo,
        otrosImpuestosTasas: totals.otrosImpuestosTasas,
        montoPropinaLegal: totals.montoPropinaLegal,
        currentPaymentsTotal: reportablePaymentsTotal,
        computedFiscalTotal: totals.totalFacturado,
        suggestedTotal,
        suggestedNetAmount,
        suggestedTaxAmount,
        payments: clonePayments(tx.payments || []),
        suggestedPayments: buildSuggestedPayments(tx.payments || [], suggestedTotal)
    };
};

export const findFiscal607RepairCandidates = (
    options: Pick<FiscalExcelOptions, 'config' | 'transactions' | 'transactionHistory'>
): Fiscal607RepairCandidate[] => {
    const transactionSources = dedupeTransactionSources(options.transactions || [], options.transactionHistory || []);

    return transactionSources
        .filter(({ tx }) => SALES_NCF_PREFIXES.some(prefix => normalizeNcf(tx.ncf).startsWith(prefix)))
        .map(({ tx, sourceCollection }) => buildFiscal607RepairCandidate(tx, sourceCollection, options.config))
        .filter(Boolean)
        .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || ''))) as Fiscal607RepairCandidate[];
};

const consolidateB02Rows = (rows: Form607Row[]): Form607Row[] => {
    const eligible = rows.filter(row => row.ncf.startsWith('B02') && (
        row.montoFacturado
        + row.itbisFacturado
        + row.impuestoSelectivoConsumo
        + row.otrosImpuestosTasas
        + row.montoPropinaLegal
    ) < B02_CONSOLIDATION_LIMIT);

    if (eligible.length === 0) return rows;

    const retained = rows.filter(row => !eligible.some(source => source.sourceId === row.sourceId));
    const latestDate = eligible
        .map(row => row.fechaComprobante)
        .filter(Boolean)
        .sort()
        .pop() || '';

    const consolidated: Form607Row = {
        sourceId: `B02_CONSOLIDATED_${eligible.length}`,
        rncCedulaPasaporte: '',
        tipoIdentificacion: '',
        ncf: 'B0200000000',
        ncfModificado: '',
        tipoIngreso: DEFAULT_TIPO_INGRESO,
        fechaComprobante: latestDate,
        fechaRetencion: '',
        montoFacturado: round2(eligible.reduce((sum, row) => sum + row.montoFacturado, 0)),
        itbisFacturado: round2(eligible.reduce((sum, row) => sum + row.itbisFacturado, 0)),
        itbisRetenidoPorTerceros: round2(eligible.reduce((sum, row) => sum + row.itbisRetenidoPorTerceros, 0)),
        itbisPercibido: round2(eligible.reduce((sum, row) => sum + row.itbisPercibido, 0)),
        retencionRentaPorTerceros: round2(eligible.reduce((sum, row) => sum + row.retencionRentaPorTerceros, 0)),
        isrPercibido: round2(eligible.reduce((sum, row) => sum + row.isrPercibido, 0)),
        impuestoSelectivoConsumo: round2(eligible.reduce((sum, row) => sum + row.impuestoSelectivoConsumo, 0)),
        otrosImpuestosTasas: round2(eligible.reduce((sum, row) => sum + row.otrosImpuestosTasas, 0)),
        montoPropinaLegal: round2(eligible.reduce((sum, row) => sum + row.montoPropinaLegal, 0)),
        efectivo: round2(eligible.reduce((sum, row) => sum + row.efectivo, 0)),
        chequeTransferenciaDeposito: round2(eligible.reduce((sum, row) => sum + row.chequeTransferenciaDeposito, 0)),
        tarjetaDebitoCredito: round2(eligible.reduce((sum, row) => sum + row.tarjetaDebitoCredito, 0)),
        ventaCredito: round2(eligible.reduce((sum, row) => sum + row.ventaCredito, 0)),
        bonosOCertificadosRegalo: round2(eligible.reduce((sum, row) => sum + row.bonosOCertificadosRegalo, 0)),
        permuta: round2(eligible.reduce((sum, row) => sum + row.permuta, 0)),
        otrasFormasVentas: round2(eligible.reduce((sum, row) => sum + row.otrasFormasVentas, 0))
    };

    return [...retained, consolidated].sort((a, b) => a.fechaComprobante.localeCompare(b.fechaComprobante));
};

const mapFormaPago606FromPayments = (payments: any[]): string => {
    const methods = new Set<string>();
    (payments || []).forEach((payment) => {
        const descriptor = classifyPayment(payment);
        methods.add(descriptor);
    });

    if (methods.size === 0) return DEFAULT_FORMA_PAGO_606;
    if (methods.size > 1) return '07';
    const [single] = Array.from(methods);
    if (single === 'efectivo') return '01';
    if (single === 'chequeTransferenciaDeposito') return '02';
    if (single === 'tarjetaDebitoCredito') return '03';
    if (single === 'ventaCredito') return '04';
    if (single === 'permuta') return '05';
    if (single === 'bonosOCertificadosRegalo') return '06';
    return '07';
};

const mapFormaPago606FromRaw = (value: unknown): string => {
    const key = normalizeTextKey(value);
    if (!key) return DEFAULT_FORMA_PAGO_606;
    if (key.includes('CASH') || key.includes('EFECTIVO')) return '01';
    if (key.includes('CHEQUE') || key.includes('TRANSFER') || key.includes('DEPOSITO')) return '02';
    if (key.includes('CARD') || key.includes('TARJETA')) return '03';
    if (key.includes('CREDIT') || key.includes('CREDITO')) return '04';
    if (key.includes('PERMUTA') || key.includes('BARTER')) return '05';
    if (key.includes('NOTA') || key.includes('VALE') || key.includes('GIFT')) return '06';
    if (key.includes('MIXTO') || key.includes('MIXED')) return '07';
    return DEFAULT_FORMA_PAGO_606;
};

const build606Rows = (
    transactions: Transaction[],
    purchaseOrders: PurchaseOrder[],
    receptions: Reception[],
    suppliers: Supplier[],
    warnings: string[]
): Form606Row[] => {
    const rows: Form606Row[] = [];
    const suppliersById = new Map((suppliers || []).map(supplier => [supplier.id, supplier]));
    const ordersById = new Map((purchaseOrders || []).map(order => [order.id, order]));

    const purchaseTransactions = transactions.filter(tx => tx.documentType === 'PURCHASE');
    purchaseTransactions.forEach((tx) => {
        const anyTx = tx as any;
        const supplierId = String(anyTx.supplierId || anyTx.vendorId || '').trim();
        const supplier = suppliersById.get(supplierId);
        const taxId = sanitizeTaxId(
            anyTx.supplierTaxId
            ?? anyTx.vendorTaxId
            ?? supplier?.taxId
            ?? tx.customerSnapshot?.taxId
            ?? ''
        );
        const tipoIdentificacion = taxId ? detectTipoIdentificacion(taxId) : '';
        const ncf = normalizeNcf(tx.ncf ?? anyTx.ncfCompra);
        if (!ncf) {
            warnings.push(`606 omitido para compra ${tx.id}: no tiene NCF.`);
            return;
        }

        const totals = extract607Totals(tx);
        const montoServicios = round2(
            (tx.items || [])
                .filter(item => normalizeTextKey((item as any)?.type).includes('SERVICE'))
                .reduce((sum, item) => sum + (toNumber((item as any).price) * toNumber((item as any).quantity)), 0)
        );
        const montoBienes = round2(Math.max(0, totals.montoFacturado - montoServicios));

        rows.push({
            sourceId: tx.id,
            rncCedula: taxId,
            tipoIdentificacion,
            tipoBienesServiciosComprados: mapTipoBienServicio606(anyTx.tipoBienServicio ?? anyTx.purchaseType),
            ncf,
            ncfModificado: normalizeNcf(tx.affectedNCF ?? anyTx.ncfModificado),
            fechaComprobante: formatDateYYYYMMDD(tx.date),
            fechaPago: formatDateYYYYMMDD(anyTx.fechaPago ?? anyTx.paymentDate ?? tx.date),
            montoFacturadoServicios: montoServicios,
            montoFacturadoBienes: montoBienes,
            totalMontoFacturado: totals.totalFacturado,
            itbisFacturado: totals.itbisFacturado,
            itbisRetenido: Math.abs(toNumber(anyTx.itbisRetenido)),
            itbisSujetoProporcionalidad: Math.abs(toNumber(anyTx.itbisSujetoProporcionalidad)),
            itbisLlevadoCosto: Math.abs(toNumber(anyTx.itbisLlevadoCosto)),
            itbisPorAdelantar: Math.abs(toNumber(anyTx.itbisPorAdelantar)),
            itbisPercibidoCompras: Math.abs(toNumber(anyTx.itbisPercibidoCompras)),
            tipoRetencionISR: String(anyTx.tipoRetencionISR || ''),
            montoRetencionRenta: Math.abs(toNumber(anyTx.montoRetencionRenta)),
            isrPercibidoCompras: Math.abs(toNumber(anyTx.isrPercibidoCompras)),
            impuestoSelectivoConsumo: totals.impuestoSelectivoConsumo,
            otrosImpuestosTasas: totals.otrosImpuestosTasas,
            montoPropinaLegal: totals.montoPropinaLegal,
            formaPago: mapFormaPago606FromPayments(tx.payments || [])
        });
    });

    (receptions || [])
        .filter(reception => !String(reception.purchaseOrderId || '').startsWith('TRANSFER:'))
        .forEach((reception) => {
            const order = ordersById.get(reception.purchaseOrderId);
            const anyOrder = (order || {}) as any;
            const anyReception = reception as any;
            const supplier = order?.supplierId ? suppliersById.get(order.supplierId) : undefined;

            const ncf = normalizeNcf(anyOrder.ncf ?? anyOrder.ncfProveedor ?? anyReception.ncf ?? anyReception.ncfProveedor);
            if (!ncf) return;

            const subtotal = round2((reception.items || []).reduce(
                (sum, item) => sum + (toNumber(item.cost) * toNumber(item.quantityReceived)),
                0
            ));
            const itbis = Math.abs(toNumber(anyOrder.itbisFacturado ?? anyOrder.taxAmount));
            const isc = Math.abs(toNumber(anyOrder.impuestoSelectivoConsumo));
            const otros = Math.abs(toNumber(anyOrder.otrosImpuestosTasas));
            const propina = Math.abs(toNumber(anyOrder.montoPropinaLegal));
            const total = round2(
                Math.max(
                    toNumber(order?.totalCost),
                    subtotal + itbis + isc + otros + propina
                )
            );

            const taxId = sanitizeTaxId(supplier?.taxId ?? anyOrder.supplierTaxId ?? '');
            const tipoIdentificacion = taxId ? detectTipoIdentificacion(taxId) : '';

            rows.push({
                sourceId: reception.id,
                rncCedula: taxId,
                tipoIdentificacion,
                tipoBienesServiciosComprados: mapTipoBienServicio606(anyOrder.tipoBienServicio),
                ncf,
                ncfModificado: normalizeNcf(anyOrder.ncfModificado),
                fechaComprobante: formatDateYYYYMMDD(order?.date ?? reception.date),
                fechaPago: formatDateYYYYMMDD(anyOrder.paymentDate ?? reception.date),
                montoFacturadoServicios: 0,
                montoFacturadoBienes: subtotal,
                totalMontoFacturado: total,
                itbisFacturado: itbis,
                itbisRetenido: Math.abs(toNumber(anyOrder.itbisRetenido)),
                itbisSujetoProporcionalidad: Math.abs(toNumber(anyOrder.itbisSujetoProporcionalidad)),
                itbisLlevadoCosto: Math.abs(toNumber(anyOrder.itbisLlevadoCosto)),
                itbisPorAdelantar: Math.abs(toNumber(anyOrder.itbisPorAdelantar)),
                itbisPercibidoCompras: Math.abs(toNumber(anyOrder.itbisPercibidoCompras)),
                tipoRetencionISR: String(anyOrder.tipoRetencionISR || ''),
                montoRetencionRenta: Math.abs(toNumber(anyOrder.montoRetencionRenta)),
                isrPercibidoCompras: Math.abs(toNumber(anyOrder.isrPercibidoCompras)),
                impuestoSelectivoConsumo: isc,
                otrosImpuestosTasas: otros,
                montoPropinaLegal: propina,
                formaPago: mapFormaPago606FromRaw(anyOrder.paymentMethod ?? supplier?.paymentMethod)
            });
        });

    return rows;
};

const build608Rows = (transactions: Transaction[]): Form608Row[] => {
    const creditNotesByOriginal = new Map<string, Transaction>();
    transactions
        .filter(tx => tx.ncfType === 'B04' && tx.originalTransactionId)
        .forEach((creditNote) => {
            creditNotesByOriginal.set(String(creditNote.originalTransactionId), creditNote);
        });

    return transactions
        .filter(tx => tx.status === 'REFUNDED' && !!tx.ncf)
        .map((tx) => {
            const creditNote = creditNotesByOriginal.get(tx.id);
            const reason = creditNote?.refundReason || tx.refundReason || '';
            const date = creditNote?.date || tx.date;
            return {
                sourceId: tx.id,
                ncf: normalizeNcf(tx.ncf),
                fechaAnulacion: formatDateYYYYMMDD(date),
                tipoAnulacion: mapTipoAnulacion608(reason)
            };
        });
};

const validate607Rows = (rows: Form607Row[]): FiscalPreflightError[] => {
    const errors: FiscalPreflightError[] = [];
    rows.forEach((row, index) => {
        const rowLabel = `607 fila ${index + 1} (${row.sourceId})`;

        if (row.ncf.length !== 11) {
            errors.push({
                code: 'NCF_INVALID_LENGTH',
                message: `${rowLabel}: NCF invalido. Debe tener 11 caracteres.`
            });
        }

        if (row.ncf.startsWith('B04') && row.ncfModificado.length !== 11) {
            errors.push({
                code: 'NCF_MODIFIED_REQUIRED',
                message: `${rowLabel}: NCF Modificado es obligatorio para B04 (11 caracteres).`
            });
        }

        if (row.tipoIdentificacion === 1 && onlyDigits(row.rncCedulaPasaporte).length !== 9) {
            errors.push({
                code: 'RNC_INVALID_LENGTH',
                message: `${rowLabel}: Tipo Identificacion=1 requiere RNC de 9 digitos.`
            });
        }

        if (row.tipoIdentificacion === 2 && onlyDigits(row.rncCedulaPasaporte).length !== 11) {
            errors.push({
                code: 'CEDULA_INVALID_LENGTH',
                message: `${rowLabel}: Tipo Identificacion=2 requiere Cedula de 11 digitos.`
            });
        }

        if (row.rncCedulaPasaporte && row.tipoIdentificacion === '') {
            errors.push({
                code: 'IDENTIFICATION_TYPE_REQUIRED',
                message: `${rowLabel}: Tipo Identificacion es obligatorio cuando hay RNC/Cedula/Pasaporte.`
            });
        }

        const totalFacturado = round2(
            row.montoFacturado
            + row.itbisFacturado
            + row.impuestoSelectivoConsumo
            + row.otrosImpuestosTasas
            + row.montoPropinaLegal
        );
        const totalPagos = round2(
            row.efectivo
            + row.chequeTransferenciaDeposito
            + row.tarjetaDebitoCredito
            + row.ventaCredito
            + row.bonosOCertificadosRegalo
            + row.permuta
            + row.otrasFormasVentas
        );

        if (Math.abs(totalPagos - totalFacturado) > EPSILON) {
            errors.push({
                code: 'PAYMENT_SUM_MISMATCH',
                message: `${rowLabel}: suma de pagos (17-23=${totalPagos.toFixed(2)}) no coincide con total facturado (${totalFacturado.toFixed(2)}).`
            });
        }

        if (!/^(0[1-6])$/.test(row.tipoIngreso)) {
            errors.push({
                code: 'TIPO_INGRESO_INVALID',
                message: `${rowLabel}: Tipo de Ingreso debe estar entre 01 y 06.`
            });
        }
    });

    return errors;
};

const validate608Rows = (rows: Form608Row[]): FiscalPreflightError[] => {
    const errors: FiscalPreflightError[] = [];
    rows.forEach((row, index) => {
        const rowLabel = `608 fila ${index + 1} (${row.sourceId})`;
        if (row.ncf.length !== 11) {
            errors.push({
                code: '608_NCF_INVALID',
                message: `${rowLabel}: NCF invalido. Debe tener 11 caracteres.`
            });
        }
        if (!/^\d{8}$/.test(row.fechaAnulacion)) {
            errors.push({
                code: '608_DATE_INVALID',
                message: `${rowLabel}: Fecha Anulacion debe estar en formato AAAAMMDD.`
            });
        }
        if (!/^(0[1-9]|10)$/.test(row.tipoAnulacion)) {
            errors.push({
                code: '608_TYPE_INVALID',
                message: `${rowLabel}: Tipo de Anulacion debe estar entre 01 y 10.`
            });
        }
    });
    return errors;
};

const validate606Rows = (rows: Form606Row[]): FiscalPreflightError[] => {
    const errors: FiscalPreflightError[] = [];
    rows.forEach((row, index) => {
        const rowLabel = `606 fila ${index + 1} (${row.sourceId})`;

        if (row.rncCedula && row.tipoIdentificacion === '') {
            errors.push({
                code: '606_IDENT_TYPE_REQUIRED',
                message: `${rowLabel}: Tipo Identificacion es obligatorio cuando hay RNC/Cedula.`
            });
        }
        if (row.tipoIdentificacion === 1 && onlyDigits(row.rncCedula).length !== 9) {
            errors.push({
                code: '606_RNC_INVALID',
                message: `${rowLabel}: Tipo Identificacion=1 requiere RNC de 9 digitos.`
            });
        }
        if (row.tipoIdentificacion === 2 && onlyDigits(row.rncCedula).length !== 11) {
            errors.push({
                code: '606_CEDULA_INVALID',
                message: `${rowLabel}: Tipo Identificacion=2 requiere Cedula de 11 digitos.`
            });
        }
        if (!row.ncf) {
            errors.push({
                code: '606_NCF_REQUIRED',
                message: `${rowLabel}: NCF es obligatorio en el formato 606.`
            });
        }
        if (row.fechaComprobante && !/^\d{8}$/.test(row.fechaComprobante)) {
            errors.push({
                code: '606_FECHA_COMPROBANTE_INVALID',
                message: `${rowLabel}: Fecha Comprobante debe estar en formato AAAAMMDD.`
            });
        }
        if (row.fechaPago && !/^\d{8}$/.test(row.fechaPago)) {
            errors.push({
                code: '606_FECHA_PAGO_INVALID',
                message: `${rowLabel}: Fecha Pago debe estar en formato AAAAMMDD.`
            });
        }
    });
    return errors;
};

const escapeXml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

const renderCell = (cell: ExcelCell, styleId?: string): string => {
    const value = cell.value ?? '';
    if (value === '') return styleId ? `<Cell ss:StyleID="${styleId}"/>` : '<Cell/>';

    const serializedValue = cell.type === 'Number'
        ? String(toNumber(value))
        : escapeXml(String(value));

    const styleAttr = styleId ? ` ss:StyleID="${styleId}"` : '';
    return `<Cell${styleAttr}><Data ss:Type="${cell.type}">${serializedValue}</Data></Cell>`;
};

const renderRow = (row: ExcelRow): string =>
    `<Row>${row.cells.map(cell => renderCell(cell, row.styleId)).join('')}</Row>`;

const renderSheet = (sheet: ExcelSheet): string =>
    `<Worksheet ss:Name="${escapeXml(sheet.name)}"><Table>${sheet.rows.map(renderRow).join('')}</Table></Worksheet>`;

const buildWorkbookXml = (sheets: ExcelSheet[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11"/>
  </Style>
  <Style ss:ID="Title">
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1"/>
   <Interior ss:Color="#E2F0D9" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 ${sheets.map(renderSheet).join('')}
</Workbook>`;

const downloadWorkbookXml = (workbookXml: string, fileName: string): void => {
    const blob = new Blob([workbookXml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
};

const ensureXlsxFileName = (fileName: string): string => {
    if (fileName.toLowerCase().endsWith('.xlsx')) return fileName;
    return `${fileName.replace(/\.(xls|csv)$/i, '')}.xlsx`;
};

const toAoaValue = (cell: ExcelCell): string | number => {
    if (cell.type === 'Number') return toNumber(cell.value);
    return String(cell.value ?? '');
};

const buildWorksheetFromSheet = (sheet: ExcelSheet): XLSX.WorkSheet => {
    const aoa = sheet.rows.map(row => row.cells.map(toAoaValue));
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false });

    sheet.rows.forEach((row, r) => {
        row.cells.forEach((cell, c) => {
            const ref = XLSX.utils.encode_cell({ r, c });
            const existing = ws[ref] || ({} as XLSX.CellObject);

            if (cell.type === 'Number') {
                existing.t = 'n';
                existing.v = toNumber(cell.value);
            } else {
                existing.t = 's';
                existing.v = String(cell.value ?? '');
            }

            ws[ref] = existing;
        });
    });

    return ws;
};

const downloadWorkbookXlsx = (sheets: ExcelSheet[], fileName: string): void => {
    const workbook = XLSX.utils.book_new();
    sheets.forEach(sheet => {
        const ws = buildWorksheetFromSheet(sheet);
        XLSX.utils.book_append_sheet(workbook, ws, sheet.name);
    });
    XLSX.writeFile(workbook, ensureXlsxFileName(fileName), {
        bookType: 'xlsx',
        compression: true
    });
};

const to607DataRows = (rows: Form607Row[]): ExcelRow[] => rows.map(row => ({
    cells: [
        stringCell(row.rncCedulaPasaporte),
        row.tipoIdentificacion === '' ? stringCell('') : numberCell(row.tipoIdentificacion),
        stringCell(row.ncf),
        stringCell(row.ncfModificado),
        stringCell(row.tipoIngreso),
        stringCell(row.fechaComprobante),
        stringCell(row.fechaRetencion),
        numberCell(row.montoFacturado),
        numberCell(row.itbisFacturado),
        numberCell(row.itbisRetenidoPorTerceros),
        numberCell(row.itbisPercibido),
        numberCell(row.retencionRentaPorTerceros),
        numberCell(row.isrPercibido),
        numberCell(row.impuestoSelectivoConsumo),
        numberCell(row.otrosImpuestosTasas),
        numberCell(row.montoPropinaLegal),
        numberCell(row.efectivo),
        numberCell(row.chequeTransferenciaDeposito),
        numberCell(row.tarjetaDebitoCredito),
        numberCell(row.ventaCredito),
        numberCell(row.bonosOCertificadosRegalo),
        numberCell(row.permuta),
        numberCell(row.otrasFormasVentas)
    ]
}));

const to606DataRows = (rows: Form606Row[]): ExcelRow[] => rows.map(row => ({
    cells: [
        stringCell(row.rncCedula),
        row.tipoIdentificacion === '' ? stringCell('') : numberCell(row.tipoIdentificacion),
        stringCell(row.tipoBienesServiciosComprados),
        stringCell(row.ncf),
        stringCell(row.ncfModificado),
        stringCell(row.fechaComprobante),
        stringCell(row.fechaPago),
        numberCell(row.montoFacturadoServicios),
        numberCell(row.montoFacturadoBienes),
        numberCell(row.totalMontoFacturado),
        numberCell(row.itbisFacturado),
        numberCell(row.itbisRetenido),
        numberCell(row.itbisSujetoProporcionalidad),
        numberCell(row.itbisLlevadoCosto),
        numberCell(row.itbisPorAdelantar),
        numberCell(row.itbisPercibidoCompras),
        stringCell(row.tipoRetencionISR),
        numberCell(row.montoRetencionRenta),
        numberCell(row.isrPercibidoCompras),
        numberCell(row.impuestoSelectivoConsumo),
        numberCell(row.otrosImpuestosTasas),
        numberCell(row.montoPropinaLegal),
        stringCell(row.formaPago)
    ]
}));

const to608DataRows = (rows: Form608Row[]): ExcelRow[] => rows.map(row => ({
    cells: [
        stringCell(row.ncf),
        stringCell(row.fechaAnulacion),
        stringCell(row.tipoAnulacion)
    ]
}));

const buildSheetWithControl = (
    sheetName: string,
    headers: string[],
    dataRows: ExcelRow[],
    companyRnc: string,
    period: string
): ExcelSheet => {
    const rows: ExcelRow[] = [
        { styleId: 'Title', cells: [stringCell(`FORMATO ${sheetName}`)] },
        { cells: [stringCell('RNC_Empresa'), stringCell(companyRnc)] },
        { cells: [stringCell('Periodo'), stringCell(period)] },
        { cells: [stringCell('Cantidad_Registros'), numberCell(dataRows.length)] },
        { cells: [stringCell('')] },
        { styleId: 'Header', cells: headers.map(header => stringCell(header)) },
        ...dataRows
    ];

    return { name: sheetName, rows };
};

const formatPreflightErrors = (errors: FiscalPreflightError[]): string => {
    const preview = errors.slice(0, 12).map(error => `- ${error.message}`).join('\n');
    const extra = errors.length > 12 ? `\n... y ${errors.length - 12} errores adicionales.` : '';
    return `Validacion fiscal fallida:\n${preview}${extra}`;
};

export const formatFiscalExcel = (options: FiscalExcelOptions): FiscalExcelResult => {
    const period = derivePeriod(options.period);
    const warnings: string[] = [];
    const formatType = (options.formatType || 'ALL').toUpperCase() as '607' | '606' | '608' | 'ALL';
    const include607 = formatType === 'ALL' || formatType === '607';
    const include606 = formatType === 'ALL' || formatType === '606';
    const include608 = formatType === 'ALL' || formatType === '608';

    const allTransactions = dedupeTransactions([
        ...(options.transactions || []),
        ...(options.transactionHistory || [])
    ]);

    const companyRnc = sanitizeTaxId(options.config?.companyInfo?.rnc || '');

    const raw607Rows = allTransactions
        .filter(tx => {
            const ncf = normalizeNcf(tx.ncf);
            return SALES_NCF_PREFIXES.some(prefix => ncf.startsWith(prefix));
        })
        .map(normalizeForm607Row)
        .filter(Boolean) as Form607Row[];

    const rows607 = options.consolidateB02 ? consolidateB02Rows(raw607Rows) : raw607Rows;
    const rows606 = build606Rows(
        allTransactions,
        options.purchaseOrders || [],
        options.receptions || [],
        options.suppliers || [],
        warnings
    );
    const rows608 = build608Rows(allTransactions);

    const errors: FiscalPreflightError[] = [];
    if (include607) errors.push(...validate607Rows(rows607));
    if (include606) errors.push(...validate606Rows(rows606));
    if (include608) errors.push(...validate608Rows(rows608));
    if (errors.length > 0) {
        throw new Error(formatPreflightErrors(errors));
    }

    const controlSheet: ExcelSheet = {
        name: 'Control',
        rows: [
            { styleId: 'Title', cells: [stringCell('DGII - CONTROL DE EXPORTACION FISCAL')] },
            { cells: [stringCell('RNC_Empresa'), stringCell(companyRnc)] },
            { cells: [stringCell('Periodo'), stringCell(period)] },
            { cells: [stringCell('Fecha_Generacion'), stringCell(formatDateYYYYMMDD(new Date().toISOString()))] },
            { cells: [stringCell('')] },
            { styleId: 'Header', cells: [stringCell('Formato'), stringCell('Cantidad_Registros')] },
            ...(include607 ? [{ cells: [stringCell('607'), numberCell(rows607.length)] }] : []),
            ...(include606 ? [{ cells: [stringCell('606'), numberCell(rows606.length)] }] : []),
            ...(include608 ? [{ cells: [stringCell('608'), numberCell(rows608.length)] }] : [])
        ]
    };

    const sheet607 = buildSheetWithControl(
        '607',
        [
            'RNC/Cedula/Pasaporte',
            'Tipo Identificacion',
            'NCF',
            'NCF Modificado',
            'Tipo de Ingreso',
            'Fecha Comprobante',
            'Fecha Retencion',
            'Monto Facturado',
            'ITBIS Facturado',
            'ITBIS Retenido por Terceros',
            'ITBIS Percibido',
            'Retencion Renta por Terceros',
            'ISR Percibido',
            'Impuesto Selectivo al Consumo',
            'Otros Impuestos/Tasas',
            'Monto Propina Legal',
            'Efectivo',
            'Cheque/Transferencia/Deposito',
            'Tarjeta Debito/Credito',
            'Venta a Credito',
            'Bonos o Certificados de Regalo',
            'Permuta',
            'Otras Formas de Ventas'
        ],
        to607DataRows(rows607),
        companyRnc,
        period
    );

    const sheet606 = buildSheetWithControl(
        '606',
        [
            'RNC/Cedula',
            'Tipo Identificacion',
            'Tipo Bienes y Servicios Comprados',
            'NCF',
            'NCF o Documento Modificado',
            'Fecha Comprobante',
            'Fecha Pago',
            'Monto Facturado en Servicios',
            'Monto Facturado en Bienes',
            'Total Monto Facturado',
            'ITBIS Facturado',
            'ITBIS Retenido',
            'ITBIS Sujeto a Proporcionalidad',
            'ITBIS Llevado al Costo',
            'ITBIS por Adelantar',
            'ITBIS Percibido en Compras',
            'Tipo de Retencion en ISR',
            'Monto Retencion Renta',
            'ISR Percibido en Compras',
            'Impuesto Selectivo al Consumo',
            'Otros Impuestos/Tasas',
            'Monto Propina Legal',
            'Forma de Pago'
        ],
        to606DataRows(rows606),
        companyRnc,
        period
    );

    const sheet608 = buildSheetWithControl(
        '608',
        [
            'NCF',
            'Fecha Anulacion',
            'Tipo de Anulacion'
        ],
        to608DataRows(rows608),
        companyRnc,
        period
    );

    const sheets: ExcelSheet[] = formatType === 'ALL'
        ? [
            controlSheet,
            ...(include607 ? [sheet607] : []),
            ...(include606 ? [sheet606] : []),
            ...(include608 ? [sheet608] : [])
        ]
        : (
            formatType === '607'
                ? [sheet607]
                : formatType === '606'
                    ? [sheet606]
                    : [sheet608]
        );
    const defaultFileName = formatType === 'ALL'
        ? `DGII_607_606_608_${period}.xlsx`
        : `DGII_${formatType}_${period}.xlsx`;
    const preferredFileName = ensureXlsxFileName(options.suggestedFileName || defaultFileName);

    let outputFileName = preferredFileName;
    try {
        downloadWorkbookXlsx(sheets, preferredFileName);
    } catch (xlsxError) {
        console.error('Error generating native .xlsx, falling back to SpreadsheetML .xls:', xlsxError);
        const fallbackFileName = preferredFileName.replace(/\.xlsx$/i, '.xls');
        const workbookXml = buildWorkbookXml(sheets);
        downloadWorkbookXml(workbookXml, fallbackFileName);
        outputFileName = fallbackFileName;
        warnings.push('No se pudo generar .xlsx nativo; se exporto .xls compatible.');
    }

    return {
        fileName: outputFileName,
        period,
        counts: {
            form607: rows607.length,
            form606: rows606.length,
            form608: rows608.length
        },
        warnings
    };
};
