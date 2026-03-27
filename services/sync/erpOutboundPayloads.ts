/**
 * ERP-normalized outbound payloads for sync to Master (and onward to ERP).
 * Technical IDs are always taken from persistent POS fields (id, source_*); display_id is never used as identity.
 */
import type { CashMovement, InventoryLedgerEntry, Transaction, ZReport } from '../../types';
import {
    normalizeCashMovementForSync,
    normalizeInventoryLedgerForSync,
    normalizeLoyaltyEventForSync,
    normalizeTransactionForSync,
    normalizeWalletEventForSync,
    normalizeZReportForSync,
} from './sourceIdentity';

const DEFAULT_CURRENCY = 'DOP';

const pickTransactionCurrency = (tx: Transaction): string => {
    const fromPayments = Array.isArray(tx.payments)
        ? tx.payments.map((p: any) => p?.currencyCode).find((c: unknown) => typeof c === 'string' && c.trim())
        : undefined;
    return (typeof fromPayments === 'string' && fromPayments.trim()) || DEFAULT_CURRENCY;
};

const pickTransactionExchangeRate = (tx: Transaction): number | undefined => {
    const rates = Array.isArray(tx.payments)
        ? tx.payments.map((p: any) => p?.exchangeRate).filter((r: unknown) => typeof r === 'number' && !Number.isNaN(r))
        : [];
    if (rates.length === 0) return undefined;
    return rates[0];
};

/** Sales, refunds, voids: stable source_transaction_id; display is reference only. */
export function buildErpSalePayload(transaction: Transaction): Transaction & {
    transaction_date: string;
    currency_code: string;
    exchange_rate?: number;
    customer_ref?: string;
    original_source_transaction_id?: string;
    original_source_display_id?: string;
} {
    const base = normalizeTransactionForSync(transaction);
    const isCreditNote = base.documentType === 'REFUND' || base.ncfType === 'B04';
    return {
        ...base,
        transaction_date: base.date,
        currency_code: pickTransactionCurrency(base),
        exchange_rate: pickTransactionExchangeRate(base),
        customer_ref: base.customerId || undefined,
        ...(isCreditNote
            ? {
                  original_source_transaction_id: base.original_transaction_id,
                  original_source_display_id: base.original_display_id,
              }
            : {}),
    };
}

/** Credit notes share the same payload shape as sales (NC id = source_credit_note_id on the transaction). */
export function buildErpCreditNotePayload(transaction: Transaction): ReturnType<typeof buildErpSalePayload> {
    return buildErpSalePayload(transaction);
}

export function buildErpCashMovementPayload(movement: CashMovement): CashMovement & {
    movement_type: string;
    currency_code: string;
    exchange_rate?: number;
} {
    const base = normalizeCashMovementForSync(movement);
    const ex = (movement as any).exchangeRate ?? (movement as any).exchange_rate;
    return {
        ...base,
        movement_type: base.type,
        currency_code: base.currencyCode || DEFAULT_CURRENCY,
        exchange_rate: typeof ex === 'number' && !Number.isNaN(ex) ? ex : undefined,
    };
}

export function buildErpZReportPayload(report: ZReport): ZReport & {
    currency_code: string;
    exchange_rate?: number;
} {
    const base = normalizeZReportForSync(report);
    const ex = (report as any).exchangeRate ?? (report as any).exchange_rate;
    return {
        ...base,
        currency_code: base.baseCurrency || DEFAULT_CURRENCY,
        exchange_rate: typeof ex === 'number' && !Number.isNaN(ex) ? ex : undefined,
    };
}

export function buildErpInventoryLedgerPayload(entry: InventoryLedgerEntry): InventoryLedgerEntry {
    return normalizeInventoryLedgerForSync(entry);
}

export function buildErpWalletEventPayload(event: Record<string, unknown>): Record<string, unknown> {
    return normalizeWalletEventForSync(event);
}

export function buildErpLoyaltyEventPayload(event: Record<string, unknown>): Record<string, unknown> {
    return normalizeLoyaltyEventForSync(event);
}
