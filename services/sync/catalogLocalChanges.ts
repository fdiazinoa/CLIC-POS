import type { CatalogDomain, CatalogMutation, CatalogMutationValue, CatalogTariffPriceValue } from './CatalogEditQueue';
import type { ProductOperationalFlags } from '../../types';
export const classificationKeys = ['departments', 'sections', 'families', 'subfamilies', 'brands', 'posCategories'] as const;
export type LocalCatalogChange = Omit<CatalogMutation, 'id' | 'actorId'> & { label: string };
type Row = {
    id: string; name?: string; price?: number; cost?: number; code?: string; description?: string;
    sku?: string; external_code?: string; externalCode?: string; reference?: string; referenceCode?: string; reference_code?: string;
    barcode?: string; barcode_2?: string; barcode2?: string; barcode_3?: string; barcode3?: string;
    type?: string; measurementUnit?: string; purchaseUnit?: string; is_active?: boolean;
    parentId?: string; parent_id?: string;
    appliedTaxIds?: unknown;
    tariffs?: unknown;
    operationalFlags?: Partial<ProductOperationalFlags>;
    departmentId?: string; department_id?: string;
    sectionId?: string; section_id?: string;
    familyId?: string; family_id?: string;
    subfamilyId?: string; subfamily_id?: string;
    brandId?: string; brand_id?: string;
    categoryId?: string; category_id?: string; posCategoryId?: string; pos_category_id?: string;
    color?: string; sortOrder?: number; isActive?: boolean;
    master_number_range_id?: string; master_number_value?: number; source_terminal_id?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const itemClassificationFields = [
    { remote: 'department_id', local: ['departmentId', 'department_id'] },
    { remote: 'section_id', local: ['sectionId', 'section_id'] },
    { remote: 'family_id', local: ['familyId', 'family_id'] },
    { remote: 'subfamily_id', local: ['subfamilyId', 'subfamily_id'] },
    { remote: 'brand_id', local: ['brandId', 'brand_id'] },
    { remote: 'pos_category_id', local: ['posCategoryId', 'pos_category_id', 'categoryId', 'category_id'] },
] as const;
export const itemOperationalFlagDefaults = {
    isWeighted: false,
    trackInventory: true,
    autoPrintLabel: false,
    promptPrice: false,
    integersOnly: false,
    ageRestricted: false,
    allowNegativeStock: false,
    excludeFromPromotions: false,
    excludeFromLoyalty: false,
    usesLots: false,
    usesSerial: false,
} as const;
export const itemOperationalFields = Object.keys(itemOperationalFlagDefaults) as Array<keyof typeof itemOperationalFlagDefaults>;
const normalizeTaxIds = (value: unknown): string[] => Array.from(new Set(
    (Array.isArray(value) ? value : [])
        .map(entry => String(entry || '').trim())
        .filter(Boolean),
)).sort((left, right) => left.localeCompare(right));
const normalizeOptionalText = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
};
const normalizeBarcodes = (row: Row): string[] => [
    normalizeOptionalText(row.barcode),
    normalizeOptionalText(row.barcode_2 ?? row.barcode2),
    normalizeOptionalText(row.barcode_3 ?? row.barcode3),
].filter((value): value is string => Boolean(value));
const itemGeneralFields = [
    { remote: 'nombre', local: ['name'] },
    { remote: 'description', local: ['description'] },
    { remote: 'sku', local: ['sku'] },
    { remote: 'external_code', local: ['reference', 'referenceCode', 'reference_code', 'external_code', 'externalCode'] },
    { remote: 'costo_unitario', local: ['cost'] },
    { remote: 'type', local: ['type'] },
    { remote: 'measurement_unit', local: ['measurementUnit'] },
    { remote: 'purchase_unit', local: ['purchaseUnit'] },
    { remote: 'is_active', local: ['is_active'] },
] as const;
const valuesEqual = (left: CatalogMutationValue, right: CatalogMutationValue) => (
    Array.isArray(left) && Array.isArray(right)
        ? left.length === right.length && left.every((value, index) => value === right[index])
        : left && right && !Array.isArray(left) && !Array.isArray(right) && typeof left === 'object' && typeof right === 'object'
            ? left.price === right.price && left.margin === right.margin
            : left === right
);
const normalizeTariffPrices = (value: unknown): Map<string, CatalogTariffPriceValue> => {
    const result = new Map<string, CatalogTariffPriceValue>();
    for (const rawEntry of Array.isArray(value) ? value : []) {
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
        const entry = rawEntry as Record<string, unknown>;
        const tariffId = String(entry.tariffId || entry.tariff_id || '').trim();
        const price = Number(entry.price);
        const rawMargin = entry.margin;
        const margin = rawMargin === null || rawMargin === undefined || rawMargin === '' ? null : Number(rawMargin);
        if (!tariffId || !Number.isFinite(price) || (margin !== null && !Number.isFinite(margin))) continue;
        result.set(tariffId, { price, margin });
    }
    return result;
};
const firstValue = (row: Row, fields: readonly string[]) => {
    for (const field of fields) {
        const value = row[field as keyof Row];
        if (value !== undefined) return typeof value === 'string' && !value.trim() ? null : value;
    }
    return null;
};
export function changedCatalogFields(previous: Row[], next: Row[], domain: CatalogDomain): LocalCatalogChange[] {
    const oldRows = new Map(previous.map(row => [row.id, row]));
    const changes: LocalCatalogChange[] = [];
    for (const row of next) {
        const old = oldRows.get(row.id);
        if (!old) continue; // Creation is a separate contract.
        if (domain === 'tariff_prices') {
            const beforeTariffs = normalizeTariffPrices(old.tariffs);
            const afterTariffs = normalizeTariffPrices(row.tariffs);
            const tariffIds = Array.from(new Set([...beforeTariffs.keys(), ...afterTariffs.keys()])).sort();
            for (const tariffId of tariffIds) {
                const before = beforeTariffs.get(tariffId) || null;
                const after = afterTariffs.get(tariffId) || null;
                if (valuesEqual(before, after)) continue;
                if (!uuid.test(row.id) || !uuid.test(tariffId)) throw new Error('El artículo o la tarifa no tiene una identidad ERP válida.');
                if (after && (after.price < 0 || after.price > 1e12 || (after.margin !== null && (after.margin < -100 || after.margin > 1e6)))) {
                    throw new Error('Precio o margen de tarifa inválido.');
                }
                changes.push({ recordId: row.id, domain, field: tariffId, before, after, label: row.name || row.id });
            }
            continue;
        }
        if (domain === 'item_general') {
            const barcodesBefore = normalizeBarcodes(old);
            const barcodesAfter = normalizeBarcodes(row);
            if (!valuesEqual(barcodesBefore, barcodesAfter)) {
                if (!uuid.test(row.id)) throw new Error(`El registro ${row.name || row.id} no tiene una identidad ERP válida.`);
                if (barcodesAfter.length > 3 || barcodesAfter.some(value => value.length > 160)) throw new Error('Códigos de barra inválidos.');
                changes.push({ recordId: row.id, domain, field: 'barcodes', before: barcodesBefore, after: barcodesAfter, label: row.name || row.id });
            }
        }
        const fields: Array<{ local: readonly string[]; remote: string }> = domain === 'prices'
            ? [{ local: ['price'], remote: 'precio_venta' }]
            : domain === 'classifications'
                ? [{ local: ['name'], remote: 'nombre' }, { local: ['code'], remote: 'codigo' }]
                : domain === 'classification_hierarchy'
                    ? [{ local: ['parentId', 'parent_id'], remote: 'parent_id' }]
                : domain === 'items'
                    ? [...itemClassificationFields]
                    : domain === 'item_taxes'
                        ? [{ local: ['appliedTaxIds'], remote: 'tax_ids' }]
                        : domain === 'item_operations'
                            ? itemOperationalFields.map(field => ({ local: [field], remote: field }))
                            : [...itemGeneralFields];
        for (const { local, remote } of fields) {
            let before: CatalogMutationValue;
            let after: CatalogMutationValue;
            if (domain === 'item_taxes') {
                before = normalizeTaxIds(old.appliedTaxIds);
                after = normalizeTaxIds(row.appliedTaxIds);
            } else if (domain === 'item_operations') {
                const field = remote as keyof typeof itemOperationalFlagDefaults;
                before = typeof old.operationalFlags?.[field] === 'boolean'
                    ? old.operationalFlags[field] as boolean
                    : itemOperationalFlagDefaults[field];
                after = typeof row.operationalFlags?.[field] === 'boolean'
                    ? row.operationalFlags[field] as boolean
                    : itemOperationalFlagDefaults[field];
            } else if (domain === 'item_general') {
                const rawBefore = firstValue(old, local);
                const rawAfter = firstValue(row, local);
                if (remote === 'costo_unitario') {
                    before = rawBefore === null ? 0 : Number(rawBefore);
                    after = rawAfter === null ? 0 : Number(rawAfter);
                } else if (remote === 'is_active') {
                    before = typeof rawBefore === 'boolean' ? rawBefore : true;
                    after = typeof rawAfter === 'boolean' ? rawAfter : true;
                } else if (remote === 'nombre' || remote === 'type') {
                    before = normalizeOptionalText(rawBefore) || '';
                    after = normalizeOptionalText(rawAfter) || '';
                } else {
                    before = normalizeOptionalText(rawBefore);
                    after = normalizeOptionalText(rawAfter);
                }
            } else {
                const rawBefore = firstValue(old, local);
                const rawAfter = firstValue(row, local);
                before = domain === 'prices' && rawBefore !== null ? Number(rawBefore) : rawBefore as CatalogMutationValue;
                after = domain === 'prices' && rawAfter !== null ? Number(rawAfter) : rawAfter as CatalogMutationValue;
            }
            // Optional empty code representations are equivalent: opening an
            // editor must not turn an absent/null code into an outgoing update.
            if (valuesEqual(before, after) || (local[0] === 'code' && (before ?? '') === (after ?? ''))) continue;

            if (!uuid.test(row.id)) throw new Error(`El registro ${row.name || row.id} no tiene una identidad ERP válida.`);
            if (domain === 'prices' && (typeof after !== 'number' || !Number.isFinite(after) || after < 0 || after > 1e12)) throw new Error('Precio inválido.');
            if (domain === 'classifications' && ((after !== null && typeof after !== 'string') || (typeof after === 'string' && after.length > 120) || (local[0] === 'name' && (typeof after !== 'string' || !after.trim())))) throw new Error('Clasificación inválida.');
            if (domain === 'classification_hierarchy' && (after !== null && (typeof after !== 'string' || !uuid.test(after)))) throw new Error('La clasificación padre no tiene una identidad ERP válida.');
            if (domain === 'items' && (after !== null && (typeof after !== 'string' || !uuid.test(after)))) throw new Error('La clasificación asignada no tiene una identidad ERP válida.');
            if (domain === 'item_taxes' && (!Array.isArray(after) || after.length > 32 || after.some(value => !value || value.length > 160))) throw new Error('Asignación de impuestos inválida.');
            if (domain === 'item_operations' && typeof after !== 'boolean') throw new Error('Operación del artículo inválida.');
            if (domain === 'item_general') {
                if (remote === 'nombre' && (typeof after !== 'string' || !after || after.length > 240)) throw new Error('Nombre de artículo inválido.');
                if (remote === 'description' && after !== null && (typeof after !== 'string' || after.length > 2000)) throw new Error('Descripción de artículo inválida.');
                if (['sku', 'external_code'].includes(remote) && after !== null && (typeof after !== 'string' || after.length > 160)) throw new Error('Código de artículo inválido.');
                if (remote === 'costo_unitario' && (typeof after !== 'number' || !Number.isFinite(after) || after < 0 || after > 1e12)) throw new Error('Costo de artículo inválido.');
                if (remote === 'type' && (typeof after !== 'string' || !after || after.length > 80)) throw new Error('Tipo de artículo inválido.');
                if (['measurement_unit', 'purchase_unit'].includes(remote) && after !== null && (typeof after !== 'string' || after.length > 80)) throw new Error('Unidad de medida inválida.');
                if (remote === 'is_active' && typeof after !== 'boolean') throw new Error('Estado de artículo inválido.');
            }
            changes.push({ recordId: row.id, domain, field: remote, before, after, label: row.name || row.id });
        }
    }
    return changes;
}

const itemLifecycleRecord = (row: Row) => ({
    kind: 'ITEM', name: String(row.name || '').trim(), sku: normalizeOptionalText(row.sku),
    description: normalizeOptionalText(row.description), externalCode: normalizeOptionalText(firstValue(row, ['reference', 'referenceCode', 'reference_code', 'external_code', 'externalCode'])),
    barcodes: normalizeBarcodes(row), price: Number(row.price || 0), cost: Number(row.cost || 0),
    type: normalizeOptionalText(row.type) || 'PRODUCT', measurementUnit: normalizeOptionalText(row.measurementUnit) || 'Unidad',
    purchaseUnit: normalizeOptionalText(row.purchaseUnit) || 'Unidad', isActive: row.is_active !== false,
    departmentId: firstValue(row, ['departmentId', 'department_id']), sectionId: firstValue(row, ['sectionId', 'section_id']),
    familyId: firstValue(row, ['familyId', 'family_id']), subfamilyId: firstValue(row, ['subfamilyId', 'subfamily_id']),
    brandId: firstValue(row, ['brandId', 'brand_id']), posCategoryId: firstValue(row, ['posCategoryId', 'pos_category_id', 'categoryId', 'category_id']),
    appliedTaxIds: normalizeTaxIds(row.appliedTaxIds), operationalFlags: { ...itemOperationalFlagDefaults, ...(row.operationalFlags || {}) },
    tariffs: Array.from(normalizeTariffPrices(row.tariffs), ([tariffId, value]) => ({ tariffId, ...value })),
    master_number_range_id: normalizeOptionalText(row.master_number_range_id), master_number_value: row.master_number_value ?? null,
    source_terminal_id: normalizeOptionalText(row.source_terminal_id),
});

const classificationLifecycleRecord = (row: Row, kind: string, collection: string) => ({
    kind, collection, name: String(row.name || '').trim(), code: normalizeOptionalText(row.code) || '',
    parentId: firstValue(row, ['parentId', 'parent_id']), color: normalizeOptionalText(row.color),
    sortOrder: Number.isInteger(row.sortOrder) ? row.sortOrder : null, isActive: row.isActive !== false,
});

export function changedCatalogLifecycle(
    previous: Row[], next: Row[], domain: 'item_lifecycle' | 'classification_lifecycle',
    classification?: { kind: string; collection: string },
): LocalCatalogChange[] {
    const oldRows = new Map(previous.map(row => [row.id, row]));
    const nextRows = new Map(next.map(row => [row.id, row]));
    const payload = (row: Row) => domain === 'item_lifecycle'
        ? itemLifecycleRecord(row)
        : classificationLifecycleRecord(row, classification?.kind || '', classification?.collection || '');
    const changes: LocalCatalogChange[] = [];
    for (const row of next) {
        const old = oldRows.get(row.id);
        if (!old) {
            if (!uuid.test(row.id)) throw new Error(`El registro ${row.name || row.id} no tiene una identidad ERP válida.`);
            const value = payload(row);
            if (!String(value.name || '').trim()) throw new Error('El nombre del nuevo registro es obligatorio.');
            changes.push({ recordId: row.id, domain, field: 'create', before: null, after: value, label: row.name || row.id });
        } else if (domain === 'classification_lifecycle' && (old.isActive !== false) !== (row.isActive !== false)) {
            changes.push({ recordId: row.id, domain, field: 'is_active', before: old.isActive !== false, after: row.isActive !== false, label: row.name || row.id });
        }
    }
    for (const row of previous) if (!nextRows.has(row.id)) {
        if (!uuid.test(row.id)) throw new Error(`El registro ${row.name || row.id} no tiene una identidad ERP válida.`);
        changes.push({ recordId: row.id, domain, field: 'delete', before: payload(row), after: null, label: row.name || row.id });
    }
    return changes;
}
