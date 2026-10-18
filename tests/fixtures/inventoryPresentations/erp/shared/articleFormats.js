import Decimal from 'decimal.js';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const fail = message => { const error = new Error(message); error.code = 'ARTICLE_FORMAT_INVALID'; error.statusCode = 422; throw error; };
const decimal = value => {
    try { const number = new D(value); if (number.isFinite()) return number; } catch { /* rejected below */ }
    return fail('Cantidad, factor o precio inválido.');
};
export const articleFormatsEnabled = config => record(record(config).featureFlags).ARTICLE_FORMATS === true;
export const formatFactor = value => {
    const factor = decimal(value);
    if (factor.lte(0) || factor.dp() > 4 || factor.gt('99999999999')) fail('El factor debe ser positivo y admitir hasta 4 decimales.');
    return factor.toNumber();
};
export const toBaseQuantity = (quantity, factor = 1) => {
    const result = decimal(quantity).times(formatFactor(factor));
    if (result.dp() > 4 || result.abs().gt('99999999999.9999')) fail('La cantidad base excede la precisión de inventario (4 decimales).');
    return result.toNumber();
};
export const fromBaseQuantity = (quantity, factor = 1) => decimal(quantity).div(formatFactor(factor)).toNumber();
export const toBaseUnitCost = (cost, factor = 1) => decimal(cost).div(formatFactor(factor)).toDecimalPlaces(8).toNumber();
export const formatPrice = (format, tariffId, basePrice) => {
    const override = (format?.prices || []).find(entry => entry.tariffId === tariffId);
    return override ? decimal(override.price).toNumber() : decimal(basePrice).times(format?.factor || 1).toNumber();
};
export const availableFormats = (baseStock, factor = 1) => decimal(baseStock).div(formatFactor(factor)).floor().toNumber();
const variantIds = variants => (variants || []).map(value => String(value.id || value.variant_id || value.sku || '').trim()).filter(Boolean);
export const baseArticleFormat = (variantId = null) => ({
    id: `base:${variantId || 'item'}`, variantId, name: 'Unidad', abbreviation: 'UND', factor: 1,
    barcode: '', isBase: true, defaultPurchase: true, defaultSale: true,
    allowPurchase: true, allowSale: true, allowTransfer: true, active: true, sortOrder: 0, prices: [],
});
export const getArticleFormats = (item, variantId = null, enabled = true) => {
    const formats = item?.articleFormats || item?.metadata?.articleFormats;
    const result = enabled && Array.isArray(formats) ? formats.filter(format => (format.variantId || null) === (variantId || null)) : [];
    return (result.length ? result : [baseArticleFormat(variantId)]).slice().sort((a, b) => a.sortOrder - b.sortOrder);
};
export const snapshotArticleFormat = format => ({
    schemaVersion: 1, id: String(format.id), variantId: format.variantId || null,
    name: String(format.name), abbreviation: String(format.abbreviation),
    factor: formatFactor(format.factor), barcode: String(format.barcode || ''),
});
export const readArticleFormatSnapshot = value => {
    if (value == null) return null;
    const input = record(value);
    if (input.schemaVersion !== 1 || !input.id || !input.name) fail('Snapshot de presentación inválido.');
    return snapshotArticleFormat(input);
};
export const lineBaseQuantity = (quantity, snapshot) => snapshot ? toBaseQuantity(quantity, readArticleFormatSnapshot(snapshot).factor) : Number(quantity);
export const findFormatBarcode = (items, barcode, operation = 'Sale') => {
    const code = String(barcode || '').trim();
    if (!code) return null;
    for (const item of items) {
        const formats = item.articleFormats || item.metadata?.articleFormats;
        const format = Array.isArray(formats) && formats.find(entry => entry.barcode === code && entry.active && entry[`allow${operation}`]);
        if (format) return { item, format, snapshot: snapshotArticleFormat(format) };
    }
    return null;
};
export const validateArticleFormats = (values, variants = [], legacyBarcodes = []) => {
    if (!Array.isArray(values) || !values.length || values.length > 200) fail('Se requieren entre 1 y 200 presentaciones.');
    const contexts = new Set([null, ...variantIds(variants)]);
    const ids = new Set();
    const barcodes = new Set(legacyBarcodes.filter(Boolean));
    const result = values.map((value, index) => {
        const input = record(value);
        const id = String(input.id || '').trim();
        const variantId = input.variantId ? String(input.variantId).trim() : null;
        if (!id || id.length > 128 || ids.has(id)) fail('Identificador de presentación vacío o duplicado.');
        ids.add(id);
        if (!contexts.has(variantId)) fail('La variante de la presentación no existe; conserva su identificador.');
        const name = String(input.name || '').trim();
        const abbreviation = String(input.abbreviation || '').trim();
        if (!name || name.length > 100 || !abbreviation || abbreviation.length > 20) fail('Nombre y abreviatura de presentación obligatorios.');
        const factor = formatFactor(input.factor);
        const barcode = String(input.barcode || '').trim();
        if (barcode) {
            const sum = [...barcode.slice(0, 12)].reduce((total, digit, position) => total + Number(digit) * (position % 2 ? 3 : 1), 0);
            if (!/^\d{13}$/.test(barcode) || (10 - sum % 10) % 10 !== Number(barcode[12])) fail('El código de la presentación debe ser EAN-13 válido.');
            if (barcodes.has(barcode)) fail('El código de barras ya identifica otro artículo, variante o presentación.');
            barcodes.add(barcode);
        }
        const active = input.active !== false;
        const isBase = input.isBase === true;
        const allowPurchase = input.allowPurchase !== false;
        const allowSale = input.allowSale !== false;
        const allowTransfer = input.allowTransfer !== false;
        if (isBase && (factor !== 1 || !active)) fail('El formato base debe estar activo con factor 1.');
        if (input.defaultPurchase && (!active || !allowPurchase)) fail('El predeterminado de compra debe estar activo y permitido.');
        if (input.defaultSale && (!active || !allowSale)) fail('El predeterminado de venta debe estar activo y permitido.');
        const tariffIds = new Set();
        const prices = (Array.isArray(input.prices) ? input.prices : []).map(entry => {
            if (!entry.tariffId || tariffIds.has(entry.tariffId)) fail('Tarifa vacía o duplicada en presentación.');
            tariffIds.add(entry.tariffId);
            const price = decimal(entry.price);
            if (price.lt(0) || price.dp() > 4) fail('El precio debe ser positivo o cero, con hasta 4 decimales.');
            return { tariffId: String(entry.tariffId), price: price.toNumber() };
        });
        return { id, variantId, name, abbreviation, factor, barcode, isBase, active,
            defaultPurchase: input.defaultPurchase === true, defaultSale: input.defaultSale === true,
            allowPurchase, allowSale, allowTransfer, sortOrder: Number.isInteger(input.sortOrder) ? input.sortOrder : index, prices };
    });
    for (const context of contexts) {
        const group = result.filter(format => format.variantId === context);
        if (group.filter(format => format.isBase).length !== 1) fail('Cada artículo y variante debe tener exactamente un formato base.');
        if (group.filter(format => format.defaultPurchase).length > 1 || group.filter(format => format.defaultSale).length > 1) fail('Solo se permite un formato predeterminado por operación y variante.');
    }
    return result;
};

export const assertArticleFormatSelection = (item, snapshot, operation, enabled, historical = false, variantId = null) => {
    if (historical || !enabled || !Array.isArray(item?.metadata?.articleFormats || item?.articleFormats)) return;
    const formats = getArticleFormats(item, variantId || snapshot?.variantId || null).filter(format=>format.active && format[`allow${operation}`]);
    const selected = snapshot ? formats.find(format=>format.id===snapshot.id && format.factor===snapshot.factor) : formats.find(format=>format.isBase && format.factor===1);
    if (!selected) fail(`Selecciona una presentación activa permitida para ${operation==='Sale'?'venta':operation==='Purchase'?'compra':'inventario'}.`);
};
export const captureArticleFormatSelection = (item, snapshot, operation, enabled, historical = false, variantId = null) => {
    assertArticleFormatSelection(item,snapshot,operation,enabled,historical,variantId);
    if (snapshot || historical || !enabled || !Array.isArray(item?.metadata?.articleFormats || item?.articleFormats)) return snapshot || null;
    const base=getArticleFormats(item,variantId).find(format=>format.active && format.isBase && format[`allow${operation}`]);
    return base ? snapshotArticleFormat(base) : null;
};
