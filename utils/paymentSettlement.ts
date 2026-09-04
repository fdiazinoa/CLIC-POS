import { BusinessConfig, PaymentEntry, Transaction } from '../types';
import { paymentEntryIsCxCCredit } from './creditRules';

const roundToTwo = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const toNumber = (value: unknown): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

const normalizeCurrencyCode = (value: unknown, fallback: string): string => {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toUpperCase();
    return normalized || fallback;
};

const getPaymentCurrencyCode = (payment: Partial<PaymentEntry>, baseCurrencyCode: string): string => {
    return normalizeCurrencyCode(payment.currencyCode ?? payment.currency_code, baseCurrencyCode);
};

const getPaymentExchangeRate = (payment: Partial<PaymentEntry>, baseCurrencyCode: string): number => {
    const currencyCode = getPaymentCurrencyCode(payment, baseCurrencyCode);
    const directRate = toNumber(payment.exchangeRate ?? payment.exchange_rate);
    if (directRate > 0) return directRate;

    const amountOriginal = toNumber(payment.amountOriginal);
    const amountBase = roundToTwo(toNumber(payment.amount));
    if (currencyCode !== baseCurrencyCode && amountOriginal > 0 && amountBase > 0) {
        return roundToTwo(amountBase / amountOriginal);
    }

    return 1;
};

export const getPaymentAppliedBaseAmount = (payment: Partial<PaymentEntry>): number => {
    const preferred = payment.appliedAmount ?? payment.applied_amount ?? payment.amountApplied;
    if (preferred !== undefined && preferred !== null) {
        return roundToTwo(toNumber(preferred));
    }
    return roundToTwo(toNumber(payment.amount));
};

export const getPaymentChangeBaseAmount = (payment: Partial<PaymentEntry>): number => {
    const preferred = payment.changeAmount ?? payment.change_amount;
    if (preferred !== undefined && preferred !== null) {
        return roundToTwo(toNumber(preferred));
    }
    const amount = roundToTwo(toNumber(payment.amount));
    const applied = getPaymentAppliedBaseAmount(payment);
    return roundToTwo(Math.max(0, amount - applied));
};

export const getPaymentOriginalAmount = (payment: Partial<PaymentEntry>, baseCurrencyCode: string): number => {
    const direct = toNumber(payment.amountOriginal);
    if (direct > 0) return roundToTwo(direct);

    const amount = roundToTwo(toNumber(payment.amount));
    const currencyCode = getPaymentCurrencyCode(payment, baseCurrencyCode);
    const exchangeRate = getPaymentExchangeRate(payment, baseCurrencyCode);
    if (currencyCode !== baseCurrencyCode && exchangeRate > 0) {
        return roundToTwo(amount / exchangeRate);
    }

    return amount;
};

export const getPaymentReceivedAmountForDrawer = (payment: Partial<PaymentEntry>, baseCurrencyCode: string): number => {
    const currencyCode = getPaymentCurrencyCode(payment, baseCurrencyCode);
    if (currencyCode === baseCurrencyCode) {
        return roundToTwo(toNumber(payment.amount));
    }
    return getPaymentOriginalAmount(payment, baseCurrencyCode);
};

export type PaymentSettlementLine = {
    paymentId: string;
    method: string;
    methodLabel: string;
    currencyCode: string;
    exchangeRate: number;
    receivedOriginal: number;
    receivedBase: number;
    appliedBase: number;
    changeBase: number;
    changeCurrencyCode: string;
    isForeignCurrency: boolean;
    isDeferredCredit: boolean;
    gatewayProvider?: string;
    gatewayAuthorizationCode?: string;
    gatewayReference?: string;
};

export type PaymentSettlementSummary = {
    payments: PaymentEntry[];
    lines: PaymentSettlementLine[];
    totalReceivedBase: number;
    totalAppliedBase: number;
    totalChangeBase: number;
    remainingBase: number;
    settlementCurrencyCode?: string;
    settlementExchangeRate?: number;
    settlementReceivedOriginal?: number;
    settlementReceivedBase: number;
    settlementAppliedBase: number;
    settlementChangeBase: number;
    settlementChangeCurrencyCode?: string;
    hasForeignCurrency: boolean;
};

export const buildPaymentSettlementSummary = (
    payments: PaymentEntry[],
    total: number,
    baseCurrencyCode = 'DOP'
): PaymentSettlementSummary => {
    const absoluteTotal = roundToTwo(Math.abs(toNumber(total)));
    let remainingToApply = absoluteTotal;

    const lines: PaymentSettlementLine[] = [];
    const normalizedPayments = (payments || []).map((payment) => {
        const isDeferredCredit = paymentEntryIsCxCCredit(payment);
        const currencyCode = getPaymentCurrencyCode(payment, baseCurrencyCode);
        const exchangeRate = getPaymentExchangeRate(payment, baseCurrencyCode);
        const receivedBase = roundToTwo(toNumber(payment.amount));
        const receivedOriginal = getPaymentOriginalAmount(payment, baseCurrencyCode);
        const appliedBase = isDeferredCredit
            ? 0
            : roundToTwo(Math.min(receivedBase, remainingToApply));
        const changeBase = isDeferredCredit
            ? 0
            : roundToTwo(Math.max(0, receivedBase - appliedBase));
        remainingToApply = roundToTwo(Math.max(0, remainingToApply - receivedBase));

        const normalizedPayment: PaymentEntry = {
            ...payment,
            currencyCode,
            amountOriginal: receivedOriginal,
            exchangeRate,
            appliedAmount: appliedBase,
            amountApplied: appliedBase,
            changeAmount: changeBase,
            changeCurrencyCode: changeBase > 0 ? baseCurrencyCode : undefined,
            currency_code: currencyCode,
            exchange_rate: exchangeRate,
            applied_amount: appliedBase,
            change_amount: changeBase,
            change_currency_code: changeBase > 0 ? baseCurrencyCode : undefined,
        };

        lines.push({
            paymentId: normalizedPayment.id,
            method: normalizedPayment.method,
            methodLabel: normalizedPayment.methodLabel || normalizedPayment.method,
            currencyCode,
            exchangeRate,
            receivedOriginal,
            receivedBase,
            appliedBase,
            changeBase,
            changeCurrencyCode: changeBase > 0 ? baseCurrencyCode : '',
            isForeignCurrency: currencyCode !== baseCurrencyCode,
            isDeferredCredit,
            gatewayProvider: normalizedPayment.gatewayProvider,
            gatewayAuthorizationCode: normalizedPayment.gatewayAuthorizationCode,
            gatewayReference: normalizedPayment.gatewayReference,
        });

        return normalizedPayment;
    });

    const settledLines = lines.filter(line => !line.isDeferredCredit);
    const totalReceivedBase = roundToTwo(settledLines.reduce((sum, line) => sum + line.receivedBase, 0));
    const totalAppliedBase = roundToTwo(settledLines.reduce((sum, line) => sum + line.appliedBase, 0));
    const totalChangeBase = roundToTwo(settledLines.reduce((sum, line) => sum + line.changeBase, 0));
    // The checkout remainder tracks how much of the ticket still needs a payment
    // method assigned. Deferred credit satisfies that allocation without becoming
    // cash settlement, so keep it separate from settlementAppliedBase.
    const remainingBase = remainingToApply;
    const foreignLines = settledLines.filter(line => line.isForeignCurrency && line.receivedOriginal > 0);
    const uniqueForeignCurrencies = Array.from(new Set(foreignLines.map(line => line.currencyCode)));
    const uniqueForeignRates = Array.from(new Set(foreignLines.map(line => line.exchangeRate.toFixed(6))));

    let settlementCurrencyCode: string | undefined;
    let settlementExchangeRate: number | undefined;
    let settlementReceivedOriginal: number | undefined;

    if (foreignLines.length > 0 && uniqueForeignCurrencies.length === 1) {
        settlementCurrencyCode = uniqueForeignCurrencies[0];
        settlementReceivedOriginal = roundToTwo(
            foreignLines.reduce((sum, line) => sum + line.receivedOriginal, 0)
        );
        if (uniqueForeignRates.length === 1) {
            settlementExchangeRate = foreignLines[0].exchangeRate;
        }
    } else if (foreignLines.length === 0 && totalReceivedBase > 0) {
        settlementCurrencyCode = baseCurrencyCode;
        settlementExchangeRate = 1;
        settlementReceivedOriginal = totalReceivedBase;
    }

    return {
        payments: normalizedPayments,
        lines,
        totalReceivedBase,
        totalAppliedBase,
        totalChangeBase,
        remainingBase,
        settlementCurrencyCode,
        settlementExchangeRate,
        settlementReceivedOriginal,
        settlementReceivedBase: totalReceivedBase,
        settlementAppliedBase: totalAppliedBase,
        settlementChangeBase: totalChangeBase,
        settlementChangeCurrencyCode: totalChangeBase > 0 ? baseCurrencyCode : undefined,
        hasForeignCurrency: foreignLines.length > 0,
    };
};

export const buildTransactionSettlementFields = (
    payments: PaymentEntry[],
    total: number,
    baseCurrencyCode = 'DOP'
): Pick<
    Transaction,
    | 'payments'
    | 'settlementCurrencyCode'
    | 'settlementExchangeRate'
    | 'settlementReceivedOriginal'
    | 'settlementReceivedBase'
    | 'settlementAppliedBase'
    | 'settlementChangeBase'
    | 'settlementChangeCurrencyCode'
    | 'settlement_currency_code'
    | 'settlement_exchange_rate'
    | 'settlement_received_original'
    | 'settlement_received_base'
    | 'settlement_applied_base'
    | 'settlement_change_base'
    | 'settlement_change_currency_code'
> => {
    const summary = buildPaymentSettlementSummary(payments, total, baseCurrencyCode);
    return {
        payments: summary.payments,
        settlementCurrencyCode: summary.settlementCurrencyCode,
        settlementExchangeRate: summary.settlementExchangeRate,
        settlementReceivedOriginal: summary.settlementReceivedOriginal,
        settlementReceivedBase: summary.settlementReceivedBase,
        settlementAppliedBase: summary.settlementAppliedBase,
        settlementChangeBase: summary.settlementChangeBase,
        settlementChangeCurrencyCode: summary.settlementChangeCurrencyCode,
        settlement_currency_code: summary.settlementCurrencyCode,
        settlement_exchange_rate: summary.settlementExchangeRate,
        settlement_received_original: summary.settlementReceivedOriginal,
        settlement_received_base: summary.settlementReceivedBase,
        settlement_applied_base: summary.settlementAppliedBase,
        settlement_change_base: summary.settlementChangeBase,
        settlement_change_currency_code: summary.settlementChangeCurrencyCode,
    };
};

export const resolveCurrencySymbol = (
    config: BusinessConfig | undefined,
    currencyCode: string | undefined,
    fallbackSymbol = '$'
): string => {
    const normalizedCode = currencyCode ? currencyCode.trim().toUpperCase() : '';
    if (!normalizedCode) return fallbackSymbol;
    return config?.currencies?.find(currency => currency.code === normalizedCode)?.symbol || normalizedCode;
};

export type PaymentReceiptRow = {
    label: string;
    value: string;
    emphasis?: boolean;
};

export type PaymentReceiptGroup = {
    paymentId: string;
    rows: PaymentReceiptRow[];
};

export type PaymentReceiptPresentation = {
    heading: 'PAGO' | 'PAGOS';
    groups: PaymentReceiptGroup[];
    change?: PaymentReceiptRow;
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
    CASH: 'EFECTIVO',
    CARD: 'TARJETA',
    STORE_CREDIT: 'NOTA DE CRÉDITO',
};

const resolvePaymentMethodReceiptLabel = (line: PaymentSettlementLine): string => {
    const method = String(line.method || '').trim().toUpperCase();
    const configuredLabel = String(line.methodLabel || '').trim();
    if (configuredLabel && configuredLabel.toUpperCase() !== method) return configuredLabel.toUpperCase();
    return PAYMENT_METHOD_LABELS[method] || method || 'PAGO';
};

const formatReceiptMoney = (symbol: string, value: number): string => (
    `${symbol}${roundToTwo(value).toFixed(2)}`
);

export const buildPaymentReceiptPresentation = (
    summary: PaymentSettlementSummary,
    config: BusinessConfig | undefined,
    baseCurrencyCode = 'DOP',
    fallbackSymbol = '$'
): PaymentReceiptPresentation => {
    const baseSymbol = resolveCurrencySymbol(config, baseCurrencyCode, fallbackSymbol);
    const groups = summary.lines.map((line): PaymentReceiptGroup => {
        const methodLabel = resolvePaymentMethodReceiptLabel(line);
        const isTenderedAmountRelevant = line.isForeignCurrency || line.changeBase > 0.0001;
        const rows: PaymentReceiptRow[] = [];

        if (line.isDeferredCredit) {
            rows.push({
                label: methodLabel,
                value: formatReceiptMoney(baseSymbol, line.receivedBase),
            });
        } else if (isTenderedAmountRelevant) {
            const receivedSymbol = line.isForeignCurrency
                ? resolveCurrencySymbol(config, line.currencyCode, line.currencyCode)
                : baseSymbol;
            const receivedAmount = line.isForeignCurrency ? line.receivedOriginal : line.receivedBase;
            rows.push({
                label: `${methodLabel} RECIBIDO`,
                value: formatReceiptMoney(receivedSymbol, receivedAmount),
            });
        } else {
            rows.push({
                label: methodLabel,
                value: formatReceiptMoney(baseSymbol, line.appliedBase),
            });
        }

        if (line.isForeignCurrency) {
            rows.push({
                label: 'EQUIVALENTE',
                value: formatReceiptMoney(baseSymbol, line.receivedBase),
            });
        }

        return { paymentId: line.paymentId, rows };
    });

    return {
        heading: groups.length === 1 ? 'PAGO' : 'PAGOS',
        groups,
        change: summary.totalChangeBase > 0.0001
            ? {
                label: 'CAMBIO',
                value: formatReceiptMoney(baseSymbol, summary.totalChangeBase),
                emphasis: true,
            }
            : undefined,
    };
};
