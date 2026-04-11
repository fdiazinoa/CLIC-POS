import { Collection } from '../types';

const roundToTwo = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const toPositiveNumber = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const normalizeCurrencyCode = (value: unknown, fallback: string): string => {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toUpperCase();
    return normalized || fallback;
};

export interface CollectionSettlementSummary {
    currencyCode: string;
    exchangeRate: number;
    receivedOriginal: number;
    receivedBase: number;
    appliedBase: number;
    unappliedBase: number;
    hasForeignCurrency: boolean;
}

export const buildCollectionSettlementSummary = (
    collection: Partial<Collection> | null | undefined,
    baseCurrencyCode = 'DOP'
): CollectionSettlementSummary => {
    const currencyCode = normalizeCurrencyCode(collection?.currencyCode, baseCurrencyCode);
    const allocations = Array.isArray(collection?.allocations) ? collection.allocations : [];
    const appliedBase = roundToTwo(
        toPositiveNumber(collection?.appliedAmountBase)
        || allocations.reduce((sum, alloc) => sum + toPositiveNumber(alloc?.amount), 0)
    );
    const receivedBase = roundToTwo(
        toPositiveNumber(collection?.receivedAmountBase)
        || toPositiveNumber(collection?.totalAmount)
    );
    const exchangeRate = currencyCode === baseCurrencyCode
        ? 1
        : roundToTwo(toPositiveNumber(collection?.exchangeRate) || 1);
    const receivedOriginal = roundToTwo(
        toPositiveNumber(collection?.receivedAmountOriginal)
        || (currencyCode === baseCurrencyCode
            ? receivedBase
            : (exchangeRate > 0 ? receivedBase / exchangeRate : receivedBase))
    );
    const unappliedBase = roundToTwo(
        toPositiveNumber(collection?.unappliedAmountBase)
        || Math.max(0, receivedBase - appliedBase)
    );

    return {
        currencyCode,
        exchangeRate,
        receivedOriginal,
        receivedBase,
        appliedBase,
        unappliedBase,
        hasForeignCurrency: currencyCode !== baseCurrencyCode,
    };
};

export const hasCollectionSettlementDetails = (
    settlement: CollectionSettlementSummary,
    baseCurrencyCode = 'DOP'
): boolean => (
    settlement.currencyCode !== baseCurrencyCode
    || settlement.unappliedBase > 0.009
    || Math.abs(settlement.receivedBase - settlement.appliedBase) > 0.009
);
