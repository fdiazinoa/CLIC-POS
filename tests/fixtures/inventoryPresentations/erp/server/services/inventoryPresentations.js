import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { snapshotArticleFormat, toBaseQuantity, baseArticleFormat } from '../../shared/articleFormats.js';

export const INVENTORY_PRESENTATIONS_CONTRACT = 'INVENTORY_PRESENTATIONS_V1';
export const INVENTORY_PRESENTATIONS_HEADER = 'x-clic-inventory-presentations';
export const PRESENTATION_EXCLUDED_COMPANIES = new Set([
    '6ba89a9d-41b5-4193-877c-c7409f288478', // PANCUVI
    'c41c168d-970f-432f-ae1c-3c9f5529d9b4', // MYKON
]);
export const presentationError = (code, status = 409) => Object.assign(new Error(code), { code, status });
export const presentationNeed = (ok, code) => { if (!ok) throw presentationError(code); };
const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const presentationRevision = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));

export function assertPresentationEnabled(company, terminal) {
    presentationNeed(!PRESENTATION_EXCLUDED_COMPANIES.has(company.id), 'INVENTORY_PRESENTATIONS_SCOPE_EXCLUDED');
    presentationNeed(company.config?.featureFlags?.ARTICLE_FORMATS === true
        && terminal.config?.featureFlags?.inventoryPresentationsV1 === true, 'INVENTORY_PRESENTATIONS_DISABLED');
}

/** Commercial catalog only: no payment, accounting, fiscal or transaction-writer authority. */
export function buildInventoryPresentationMaster(item, tariffs, { contextRevision = null } = {}) {
    const meta = item.metadata || {};
    const configured = Array.isArray(meta.articleFormats) ? meta.articleFormats : [];
    const formats = configured.length ? configured : [baseArticleFormat()];
    const allowed = new Set(tariffs.map(t => t.id));
    const body = {
        schemaVersion: 1, contextRevision, itemId: item.id, sku: item.sku, name: item.nombre,
        inventoryQuantityUnit: 'BASE',
        formats: formats.map(f => ({ ...snapshotArticleFormat(f), active: f.active !== false,
            isBase: f.isBase === true, allowSale: f.allowSale === true, allowPurchase: f.allowPurchase === true,
            defaultSale: f.defaultSale === true, defaultPurchase: f.defaultPurchase === true,
            sortOrder: f.sortOrder ?? 0,
            prices: (f.prices || []).filter(p => allowed.has(p.tariffId)).map(p => ({ tariffId: p.tariffId, price: p.price })),
        })),
        basePrices: tariffs.map(t => ({ tariffId: t.id,
            price: (meta.tariffs || []).find(p => (p.tariffId || p.tariff_id) === t.id)?.price ?? item.precio_venta,
            taxIncluded: t.tax_included === true })),
    };
    for (const p of [...body.basePrices, ...body.formats.flatMap(f => f.prices)]) {
        presentationNeed(new Decimal(p.price).isFinite() && new Decimal(p.price).gte(0)
            && new Decimal(p.price).decimalPlaces() <= 4, 'INVENTORY_PRESENTATION_PRICE_INVALID');
    }
    return { ...body, masterRevision: presentationRevision(body) };
}

export function validateInventoryPresentation(line, master) {
    const p = line.inventoryPresentation;
    presentationNeed(exactKeys(p, ['schemaVersion', 'itemId', 'variantId', 'format', 'commercialQuantity', 'baseQuantity', 'tariffId', 'masterRevision']), 'INVENTORY_PRESENTATION_INVALID');
    presentationNeed(p.schemaVersion === 1 && p.itemId === master.itemId && p.variantId === null
        && p.masterRevision === master.masterRevision, 'INVENTORY_PRESENTATION_MASTER_CHANGED');
    const format = master.formats.find(f => f.id === p.format?.id && f.variantId === p.variantId);
    presentationNeed(format?.active === true && format.allowSale === true, 'INVENTORY_PRESENTATION_SALE_NOT_ALLOWED');
    presentationNeed(presentationRevision(p.format) === presentationRevision(snapshotArticleFormat(format)), 'INVENTORY_PRESENTATION_SNAPSHOT_INVALID');
    presentationNeed(typeof line.quantity === 'number' && line.quantity > 0 && Number.isFinite(line.quantity)
        && p.commercialQuantity === line.quantity && typeof p.baseQuantity === 'number'
        && p.baseQuantity === toBaseQuantity(line.quantity, format.factor), 'INVENTORY_PRESENTATION_BASE_MISMATCH');
    presentationNeed(master.basePrices.some(t => t.tariffId === p.tariffId), 'INVENTORY_PRESENTATION_TARIFF_FORBIDDEN');
    const base = master.basePrices.find(t => t.tariffId === p.tariffId);
    const expected = format.prices.find(t => t.tariffId === p.tariffId)?.price ?? new Decimal(base.price).times(format.factor).toNumber();
    presentationNeed(new Decimal(line.originalPrice ?? line.price).eq(expected), 'INVENTORY_PRESENTATION_PRICE_MISMATCH');
    return structuredClone(p);
}

/** Retain the explicit commercial snapshot; only inventory entries use BASE. */
export function presentationLineMetadata(line) {
    const p = line.inventoryPresentation;
    return p ? { inventory_presentation_contract: 1,
        inventory_presentation: p, source_cart_id: line.sourceFiscalSnapshot?.sourceCartId,
        document_quantity: p.commercialQuantity, base_quantity: p.baseQuantity } : {};
}

export function validatePresentationEnvelope(transaction) {
    const lines = Array.isArray(transaction?.items) ? transaction.items : [];
    const selected = lines.filter(line => line.inventoryPresentation !== undefined);
    if (!selected.length) {
        presentationNeed(transaction?.inventoryPresentationContract === undefined, 'INVENTORY_PRESENTATION_EMPTY_CONTRACT');
        return false;
    }
    presentationNeed(transaction.inventoryPresentationContract === 1, 'INVENTORY_PRESENTATION_NEGOTIATION_REQUIRED');
    presentationNeed(transaction.documentType !== 'REFUND' && !transaction.originalTransactionId
        && !transaction.articleFormatWire && !transaction.articleFormatEventId, 'INVENTORY_PRESENTATION_SOURCE_PROFILE_UNSUPPORTED');
    presentationNeed(selected.every(line => typeof line.cartId === 'string' && line.cartId.length > 0)
        && new Set(lines.map(line => line.cartId)).size === lines.length, 'INVENTORY_PRESENTATION_LINE_ID_REQUIRED');
    return true;
}
