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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeErpUuid = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return UUID_PATTERN.test(trimmed) ? trimmed : undefined;
};

const normalizeErpUuidList = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const ids = value
        .map(normalizeErpUuid)
        .filter(Boolean) as string[];
    return ids.length > 0 ? ids : undefined;
};

export function coerceTransactionItemsForErp<T extends { items?: unknown }>(txn: T): T {
    const raw = txn.items;
    if (Array.isArray(raw)) {
        return txn;
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) {
            return { ...txn, items: [] };
        }
        try {
            let parsed: unknown = JSON.parse(trimmed);
            if (typeof parsed === 'string') {
                try {
                    parsed = JSON.parse(parsed);
                } catch {
                    // keep inner string as-is if not valid JSON
                }
            }
            if (Array.isArray(parsed)) {
                return { ...txn, items: parsed };
            }
        } catch {
            // keep original txn when parsing fails
        }
    }
    return txn;
}

const pickTransactionCurrency = (tx: Transaction): string => {
    const fromSettlement = (tx.settlementCurrencyCode || (tx as any).settlement_currency_code || '').trim();
    if (fromSettlement) {
        return fromSettlement;
    }
    const fromPayments = Array.isArray(tx.payments)
        ? tx.payments.map((p: any) => p?.currencyCode).find((c: unknown) => typeof c === 'string' && c.trim())
        : undefined;
    return (typeof fromPayments === 'string' && fromPayments.trim()) || DEFAULT_CURRENCY;
};

const pickTransactionExchangeRate = (tx: Transaction): number | undefined => {
    const settlementRate = (tx.settlementExchangeRate ?? (tx as any).settlement_exchange_rate);
    if (typeof settlementRate === 'number' && !Number.isNaN(settlementRate)) {
        return settlementRate;
    }
    const rates = Array.isArray(tx.payments)
        ? tx.payments.map((p: any) => p?.exchangeRate).filter((r: unknown) => typeof r === 'number' && !Number.isNaN(r))
        : [];
    if (rates.length === 0) return undefined;
    return rates[0];
};

const sanitizeTariffRefs = (record: Record<string, any>): Record<string, any> => {
    const next = { ...record };
    const uuidKeys = [
        'tariffId',
        'tariff_id',
        'activeTariffId',
        'active_tariff_id',
        'selectedTariffId',
        'selected_tariff_id',
        'defaultTariffId',
        'default_tariff_id',
        'customerDefaultTariffId',
        'customer_default_tariff_id'
    ];
    for (const key of uuidKeys) {
        if (key in next) {
            const normalized = normalizeErpUuid(next[key]);
            if (normalized) next[key] = normalized;
            else delete next[key];
        }
    }

    const listKeys = [
        'allowedTariffIds',
        'allowed_tariff_ids',
        'customerAllowedTariffIds',
        'customer_allowed_tariff_ids'
    ];
    for (const key of listKeys) {
        if (key in next) {
            const normalized = normalizeErpUuidList(next[key]);
            if (normalized) next[key] = normalized;
            else delete next[key];
        }
    }

    return next;
};

const sanitizeTransactionItemForErp = (item: Record<string, any>): Record<string, any> => {
    const {
        attributes,
        variants,
        tariffs,
        images,
        stockBalances,
        warehouseSettings,
        activeInWarehouses,
        availableModifiers,
        modifier_groups,
        modifierGroups,
        fraction_rule,
        fractionRule,
        combo_groups,
        comboGroups,
        note_presets,
        notePresets,
        operationalFlags,
        ...line
    } = item;

    return sanitizeTariffRefs(line);
};

const sanitizeTransactionForErp = <T extends Transaction>(transaction: T): T => {
    const metadata = transaction && typeof (transaction as any).metadata === 'object' && !Array.isArray((transaction as any).metadata)
        ? sanitizeTariffRefs({ ...(transaction as any).metadata })
        : (transaction as any).metadata;

    return sanitizeTariffRefs({
        ...transaction,
        metadata,
        items: Array.isArray(transaction.items)
            ? transaction.items.map((item: any) => sanitizeTransactionItemForErp(item))
            : []
    }) as T;
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
    const base = sanitizeTransactionForErp(normalizeTransactionForSync(coerceTransactionItemsForErp(transaction)));
    const isFiscalDisabled = base.fiscalMode === 'NONE';
    const fiscalFields = isFiscalDisabled
        ? {
              ncf: undefined,
              ncfType: undefined,
              legacyNcf: undefined,
              electronicNcf: undefined,
              fiscalProvider: 'NONE' as const,
          }
        : {};
    const isCreditNote = !isFiscalDisabled && (base.documentType === 'REFUND' || base.ncfType === 'B04' || base.ncfType === 'E34');
    return {
        ...base,
        ...fiscalFields,
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
