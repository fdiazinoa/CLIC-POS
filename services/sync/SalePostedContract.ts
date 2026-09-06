import { recordCheckoutDiagnostic } from '../CheckoutDiagnostics';
import type { Transaction } from '../../types';
import { customerNumberIdentity } from './customerIdentityContract';

export const SALE_POSTED_MONEY_TOLERANCE = 0.05;

type UnknownRecord = Record<string, any>;

export interface SalePostedSummary extends UnknownRecord {
    transaction_id: string;
    display_id: string;
    document_type: string;
    status: string;
    total: number;
    tax_amount: number;
    net_amount: number;
    discount_amount: number;
    item_count: number;
    payment_count: number;
}

export interface SalePostedPayload extends UnknownRecord {
    transaction: Transaction | UnknownRecord;
    summary: SalePostedSummary;
    occurred_at: string;
}

export interface PaymentPostedPayload extends UnknownRecord {
    summary: SalePostedSummary;
    payments: UnknownRecord[];
    occurred_at: string;
}

export class SalePostedContractError extends Error {
    readonly code = 'POS_SALE_FINANCIAL_INVARIANT_FAILED';
    readonly retryable = false;

    constructor(readonly details: string[]) {
        super(`El contrato financiero SALE_POSTED no cuadra: ${details.join('; ')}`);
        this.name = 'SalePostedContractError';
    }
}

const asRecord = (value: unknown): UnknownRecord => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
);

const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];

const asString = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const firstString = (...values: unknown[]): string => {
    for (const value of values) {
        const normalized = asString(value);
        if (normalized) return normalized;
    }
    return '';
};

const finiteNumber = (value: unknown): number | null => {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const numberOrZero = (value: unknown): number => finiteNumber(value) ?? 0;

const roundAmount = (value: unknown): number => (
    Math.round((numberOrZero(value) + Number.EPSILON) * 100) / 100
);

const hasValue = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

const compactDefined = <T extends UnknownRecord>(record: T): T => Object.fromEntries(
    Object.entries(record).filter(([, value]) => hasValue(value)),
) as T;

const extractCouponCodes = (transaction: UnknownRecord): string[] => {
    const candidates = [
        transaction.coupon,
        transaction.couponCode,
        transaction.coupon_code,
        transaction.couponId,
        transaction.coupon_id,
        ...asArray(transaction.coupons),
    ];

    return Array.from(new Set(candidates.flatMap(candidate => {
        if (typeof candidate === 'string') return [candidate.trim()];
        const coupon = asRecord(candidate);
        return [coupon.code, coupon.id, coupon.couponCode, coupon.coupon_code]
            .map(asString)
            .filter(Boolean);
    }).filter(Boolean)));
};

const readLoyaltyPointsUsed = (transaction: UnknownRecord): number => {
    const loyalty = asRecord(transaction.loyalty);
    return numberOrZero(
        transaction.loyaltyPointsUsed
        ?? transaction.loyalty_points_used
        ?? transaction.pointsUsed
        ?? transaction.points_used
        ?? transaction.redeemedPoints
        ?? loyalty.pointsUsed
        ?? loyalty.points_used,
    );
};

const paymentMethodSignature = (payment: UnknownRecord): string => [
    payment.method,
    payment.paymentMethod,
    payment.payment_method,
    payment.methodId,
    payment.method_id,
    payment.methodLabel,
    payment.method_label,
    payment.type,
    payment.label,
].map(value => asString(value).toUpperCase()).filter(Boolean).join(' ');

const paymentAppliedAmount = (payment: UnknownRecord): number => numberOrZero(
    payment.applied_amount
    ?? payment.appliedAmount
    ?? payment.amountApplied
    ?? payment.amount,
);

const isDeferredCreditPayment = (payment: UnknownRecord): boolean => {
    const signature = paymentMethodSignature(payment);
    return ['CREDIT', 'CREDITO', 'CRÉDITO', 'PENDING', 'PENDIENTE', 'CXC', 'DEFERRED']
        .some(token => signature.includes(token));
};

export const getSaleSettlementPayments = (transaction: Transaction | UnknownRecord): UnknownRecord[] => (
    asArray(asRecord(transaction).payments)
        .map(payment => asRecord(payment))
        .filter(payment => paymentAppliedAmount(payment) > 0)
        .filter(payment => !isDeferredCreditPayment(payment))
);

const toOccurredAt = (transaction: UnknownRecord): string => {
    const effectiveDate = firstString(
        transaction.date,
        transaction.occurred_at,
        transaction.occurredAt,
        transaction.createdAt,
        transaction.created_at,
        transaction.updatedAt,
        transaction.updated_at,
    );
    const parsed = new Date(effectiveDate);
    if (!effectiveDate || Number.isNaN(parsed.getTime())) {
        throw new SalePostedContractError(['fecha efectiva de la transacción ausente o inválida']);
    }
    return parsed.toISOString();
};

export const buildSalePostedSummary = (transaction: Transaction | UnknownRecord): SalePostedSummary => {
    const record = asRecord(transaction);
    const customer = asRecord(record.customer);
    const customerSnapshot = asRecord(record.customerSnapshot || record.customer_snapshot);
    const fiscalCompliance = asRecord(record.fiscalCompliance || record.fiscal_compliance);
    const items = asArray(record.items);
    const payments = asArray(record.payments);

    return compactDefined({
        transaction_id: firstString(record.id, record.transactionId, record.transaction_id),
        display_id: firstString(record.displayId, record.display_id, record.id),
        document_type: firstString(record.documentType, record.document_type).toUpperCase() || 'TICKET',
        status: firstString(record.status).toUpperCase() || 'COMPLETED',
        total: numberOrZero(record.total),
        tax_amount: numberOrZero(record.taxAmount ?? record.tax_amount),
        net_amount: numberOrZero(record.netAmount ?? record.net_amount),
        discount_amount: numberOrZero(record.discountAmount ?? record.discount_amount),
        service_type: firstString(record.serviceType, record.service_type).toUpperCase() || undefined,
        service_charge_amount: hasValue(record.serviceChargeAmount ?? record.service_charge_amount)
            ? numberOrZero(record.serviceChargeAmount ?? record.service_charge_amount)
            : undefined,
        service_tax_policy_snapshot:
            record.serviceTaxPolicySnapshot ?? record.service_tax_policy_snapshot ?? undefined,
        item_count: items.length,
        payment_count: payments.length,
        customer_id: firstString(record.customerId, record.customer_id, customer.id) || undefined,
        customer_code: firstString(record.customer_code, record.customerCode,
            customerNumberIdentity(customer).customer_code,
            customerNumberIdentity(customerSnapshot).customer_code) || undefined,
        customer: customerNumberIdentity(customer).customer_code
            ? customerNumberIdentity(customer)
            : customerNumberIdentity(customerSnapshot).customer_code
                ? customerNumberIdentity(customerSnapshot) : undefined,
        customer_name: firstString(
            record.customerName,
            record.customer_name,
            customer.name,
            customer.nombre_razon_social,
            customerSnapshot.name,
        ) || undefined,
        customer_tax_id: firstString(
            record.customerTaxId,
            record.customer_tax_id,
            customer.taxId,
            customer.tax_id,
            customerSnapshot.taxId,
            customerSnapshot.tax_id,
        ) || undefined,
        user_id: firstString(record.userId, record.user_id) || undefined,
        user_name: firstString(record.userName, record.user_name) || undefined,
        ncf: firstString(record.ncf) || undefined,
        ncf_type: firstString(record.ncfType, record.ncf_type) || undefined,
        due_date: firstString(record.dueDate, record.due_date) || undefined,
        pending_balance: numberOrZero(record.pendingBalance ?? record.pending_balance),
        settlement_applied_base: hasValue(record.settlementAppliedBase ?? record.settlement_applied_base)
            ? numberOrZero(record.settlementAppliedBase ?? record.settlement_applied_base)
            : undefined,
        wallet_payment_amount: numberOrZero(record.walletPaymentAmount ?? record.wallet_payment_amount),
        wallet_deposit_amount: numberOrZero(record.walletDepositAmount ?? record.wallet_deposit_amount),
        loyalty_points_used: readLoyaltyPointsUsed(record),
        coupon_codes: extractCouponCodes(record),
        fiscal_mode: firstString(record.fiscalMode, record.fiscal_mode, fiscalCompliance.mode) || undefined,
        fiscal_provider: firstString(record.fiscalProvider, record.fiscal_provider) || undefined,
        fiscal_compliance: Object.keys(fiscalCompliance).length > 0 ? fiscalCompliance : undefined,
        tax_breakdown: Array.isArray(record.taxBreakdown ?? record.tax_breakdown)
            ? (record.taxBreakdown ?? record.tax_breakdown)
            : undefined,
        legacy_ncf: firstString(record.legacyNcf, record.legacy_ncf) || undefined,
        electronic_ncf: firstString(record.electronicNcf, record.electronic_ncf) || undefined,
        affected_ncf: firstString(record.affectedNCF, record.affected_ncf) || undefined,
        affected_invoice_number: firstString(
            record.affectedInvoiceNumber,
            record.affected_invoice_number,
        ) || undefined,
        affected_invoice_date: firstString(record.affectedInvoiceDate, record.affected_invoice_date) || undefined,
    } as SalePostedSummary);
};

const LINE_TOTAL_FIELDS = [
    'totalAmount',
    'total_amount',
    'totalLinea',
    'total_linea',
    'lineTotal',
    'line_total',
] as const;

const readAuthoritativeLineTotal = (item: UnknownRecord, index: number, transaction: UnknownRecord): number => {
    for (const field of LINE_TOTAL_FIELDS) {
        const total = finiteNumber(item[field]);
        if (total !== null) return total;
    }

    const net = finiteNumber(item.netAmount ?? item.net_amount ?? item.subtotal_neto);
    const tax = finiteNumber(item.taxAmount ?? item.tax_amount ?? item.impuesto);
    if (net !== null && tax !== null) return net + tax;

    const hasAdjustedHeader = Math.abs(numberOrZero(transaction.discountAmount ?? transaction.discount_amount)) > 0
        || Math.abs(numberOrZero(transaction.serviceChargeAmount ?? transaction.service_charge_amount)) > 0
        || (transaction.isTaxIncluded === false
            && Math.abs(numberOrZero(transaction.taxAmount ?? transaction.tax_amount)) > 0);
    const hasLineFinancials = [
        item.discountAmount,
        item.discount_amount,
        item.discountRate,
        item.discount_rate,
        item.netAmount,
        item.net_amount,
        item.taxAmount,
        item.tax_amount,
    ].some(hasValue);

    if (hasAdjustedHeader || hasLineFinancials) {
        throw new SalePostedContractError([
            `línea ${index + 1} sin total financiero autoritativo para una transacción con impuestos/descuentos/redondeos`,
        ]);
    }

    // Compatibility for unadjusted legacy tickets whose frozen unit price is
    // the only persisted line amount. Adjusted/fiscal lines never use this path.
    const price = finiteNumber(item.price);
    const quantity = finiteNumber(item.quantity);
    if (price !== null && quantity !== null) return price * quantity;

    throw new SalePostedContractError([`línea ${index + 1} sin total financiero autoritativo`]);
};

export const assertSalePostedPayload = (
    payload: unknown,
    tolerance = SALE_POSTED_MONEY_TOLERANCE,
): {
    transactionId: string;
    total: number;
    lineTotal: number;
    itemCount: number;
    paymentCount: number;
} => {
    const envelope = asRecord(payload);
    const transaction = asRecord(envelope.transaction);
    const summary = asRecord(envelope.summary);
    const items = asArray(transaction.items);
    const payments = asArray(transaction.payments);
    const details: string[] = [];
    const transactionId = firstString(summary.transaction_id, transaction.id, transaction.transactionId);
    const transactionTotalValue = finiteNumber(transaction.total);
    const summaryTotalValue = finiteNumber(summary.total);

    if (!transactionId) details.push('transaction_id ausente');
    if (!asString(envelope.occurred_at) || Number.isNaN(new Date(envelope.occurred_at).getTime())) {
        details.push('occurred_at ausente o inválido');
    }
    if (transactionTotalValue === null) details.push('transaction.total inválido');
    if (summaryTotalValue === null) details.push('summary.total inválido');

    const transactionTotal = roundAmount(transactionTotalValue);
    const summaryTotal = roundAmount(summaryTotalValue);
    let lineTotal = 0;
    let hasInvalidLineTotal = false;
    try {
        lineTotal = roundAmount(items.reduce(
            (sum, item, index) => sum + readAuthoritativeLineTotal(asRecord(item), index, transaction),
            0,
        ));
    } catch (error) {
        if (error instanceof SalePostedContractError) {
            hasInvalidLineTotal = true;
            details.push(...error.details);
        }
        else throw error;
    }

    if (summaryTotalValue !== null && transactionTotalValue !== null
        && Math.abs(summaryTotal - transactionTotal) > tolerance) {
        details.push(`summary.total=${summaryTotal} vs transaction.total=${transactionTotal}`);
    }
    if (!hasInvalidLineTotal && summaryTotalValue !== null && Math.abs(summaryTotal - lineTotal) > tolerance) {
        details.push(`summary.total=${summaryTotal} vs lines.total=${lineTotal}`);
    }
    if (Number(summary.item_count) !== items.length) {
        details.push(`summary.item_count=${summary.item_count} vs transaction.items=${items.length}`);
    }
    if (Number(summary.payment_count) !== payments.length) {
        details.push(`summary.payment_count=${summary.payment_count} vs transaction.payments=${payments.length}`);
    }

    const settlementValue = finiteNumber(
        transaction.settlementAppliedBase ?? transaction.settlement_applied_base,
    );
    if (settlementValue !== null && transactionTotalValue !== null) {
        const pending = roundAmount(transaction.pendingBalance ?? transaction.pending_balance);
        const settlementTotal = roundAmount(settlementValue + pending);
        if (Math.abs(transactionTotal - settlementTotal) > tolerance) {
            details.push(`transaction.total=${transactionTotal} vs settlement+pending=${settlementTotal}`);
        }
    }

    if (details.length > 0) throw new SalePostedContractError(Array.from(new Set(details)));

    return {
        transactionId,
        total: summaryTotal,
        lineTotal,
        itemCount: items.length,
        paymentCount: payments.length,
    };
};

export const buildSalePostedPayload = (
    transaction: Transaction | UnknownRecord,
    additionalPayload: UnknownRecord = {},
): SalePostedPayload => {
    const {
        transaction: _transaction,
        summary: _summary,
        occurred_at: _occurredAt,
        occurredAt: _legacyOccurredAt,
        ...additionalFields
    } = additionalPayload;
    const payload: SalePostedPayload = {
        ...additionalFields,
        transaction,
        summary: buildSalePostedSummary(transaction),
        occurred_at: toOccurredAt(asRecord(transaction)),
    };
    recordCheckoutDiagnostic('OUTBOX_BUILD', { items: transaction.items, total: transaction.total, transactionId: transaction.id, displayId: transaction.displayId, summaryItemCount: payload.summary.item_count });
    assertSalePostedPayload(payload);
    return payload;
};

export const buildPaymentPostedPayload = (
    transaction: Transaction | UnknownRecord,
    additionalPayload: UnknownRecord = {},
): PaymentPostedPayload | null => {
    const record = asRecord(transaction);
    const payments = getSaleSettlementPayments(record);
    if (payments.length === 0) return null;

    const {
        summary: _summary,
        payments: _payments,
        occurred_at: _occurredAt,
        occurredAt: _legacyOccurredAt,
        transaction: _transaction,
        ...additionalFields
    } = additionalPayload;
    const summary = buildSalePostedSummary(record);
    const settlementApplied = finiteNumber(
        record.settlementAppliedBase ?? record.settlement_applied_base,
    );
    const paymentTotal = roundAmount(payments.reduce(
        (sum, payment) => sum + paymentAppliedAmount(payment),
        0,
    ));
    if (settlementApplied !== null
        && Math.abs(paymentTotal - roundAmount(settlementApplied)) > SALE_POSTED_MONEY_TOLERANCE) {
        throw new SalePostedContractError([
            `PAYMENT_POSTED payments.total=${paymentTotal} vs settlement_applied_base=${roundAmount(settlementApplied)}`,
        ]);
    }

    return {
        ...additionalFields,
        summary,
        payments: payments.map(payment => JSON.parse(JSON.stringify(payment)) as UnknownRecord),
        occurred_at: toOccurredAt(record),
    };
};
