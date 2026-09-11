import type { CatalogMutation } from './CatalogEditQueue';

type SnapshotValue = { supported: boolean; value?: unknown };

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const sortedStrings = (value: unknown): string[] => Array.from(new Set(
    (Array.isArray(value) ? value : []).map(entry => String(entry || '').trim()).filter(Boolean),
)).sort((left, right) => left.localeCompare(right));

const sameValue = (left: unknown, right: unknown): boolean => {
    if (Array.isArray(left) && Array.isArray(right)) {
        return JSON.stringify(sortedStrings(left)) === JSON.stringify(sortedStrings(right));
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
        return JSON.stringify(left) === JSON.stringify(right);
    }
    return left === right;
};

function productSnapshotValue(payload: unknown, mutation: CatalogMutation): SnapshotValue {
    if (!Array.isArray(payload)) return { supported: false };
    const product = payload.find(row => row?.id === mutation.recordId);
    if (!product) return { supported: false };

    if (mutation.domain === 'prices') {
        return hasOwn(product, 'price') ? { supported: true, value: product.price } : { supported: false };
    }
    if (mutation.domain === 'tariff_prices') {
        const tariff = (Array.isArray(product.tariffs) ? product.tariffs : [])
            .find((entry: any) => String(entry?.tariffId || entry?.tariff_id || '').trim() === mutation.field);
        if (!tariff) return { supported: true, value: null };
        return {
            supported: true,
            value: {
                price: Number(tariff.price),
                margin: typeof tariff.margin === 'number' && Number.isFinite(tariff.margin) ? tariff.margin : null,
            },
        };
    }
    if (mutation.domain === 'item_taxes' && mutation.field === 'tax_ids') {
        if (!hasOwn(product, 'appliedTaxIds') && !hasOwn(product, 'tax_ids')) return { supported: false };
        return { supported: true, value: sortedStrings(product.appliedTaxIds ?? product.tax_ids) };
    }
    if (mutation.domain === 'item_operations') {
        const camelFlags = product.operationalFlags && typeof product.operationalFlags === 'object'
            ? product.operationalFlags : {};
        const snakeFlags = product.operational_flags && typeof product.operational_flags === 'object'
            ? product.operational_flags : {};
        if (hasOwn(camelFlags, mutation.field)) return { supported: true, value: camelFlags[mutation.field] };
        if (hasOwn(snakeFlags, mutation.field)) return { supported: true, value: snakeFlags[mutation.field] };
    }
    return { supported: false };
}

export function catalogSnapshotConfirmsMutation(
    collection: string,
    payload: unknown,
    mutation: CatalogMutation,
): boolean {
    if (collection !== 'products') return false;
    const snapshot = productSnapshotValue(payload, mutation);
    return snapshot.supported && sameValue(snapshot.value, mutation.after);
}
