// Exact scope-helper excerpt from ERP largeMasterSyncV3.js; see scope-provenance.json.
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const string = (value) => String(value ?? '').trim();
const categoryOrder = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));

export function getV3TariffScope(terminal) {
    const pricing = object(object(terminal?.config).pricing);
    const raw = pricing.allowedTariffIds;
    const values = Array.isArray(raw) ? raw : string(raw) ? [raw] : [];
    return [...new Set(values.map(string).filter(Boolean))].sort();
}

export function getV3CategoryScope(terminal) {
    const raw = object(object(terminal?.config).catalog).allowedCategories;
    const values = Array.isArray(raw) ? raw : string(raw) ? [raw] : [];
    return [...new Set(values.map((value) => string(value).toLowerCase()).filter(Boolean))].sort(categoryOrder);
}

