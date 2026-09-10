import type { CatalogDomain, CatalogMutation, CatalogMutationValue } from './CatalogEditQueue';
import type { ProductOperationalFlags } from '../../types';
export const classificationKeys = ['departments', 'sections', 'families', 'subfamilies', 'brands', 'posCategories'] as const;
export type LocalCatalogChange = Omit<CatalogMutation, 'id' | 'actorId'> & { label: string };
type Row = {
    id: string; name?: string; price?: number; code?: string;
    appliedTaxIds?: unknown;
    operationalFlags?: Partial<ProductOperationalFlags>;
    departmentId?: string; department_id?: string;
    sectionId?: string; section_id?: string;
    familyId?: string; family_id?: string;
    subfamilyId?: string; subfamily_id?: string;
    brandId?: string; brand_id?: string;
    categoryId?: string; category_id?: string; posCategoryId?: string; pos_category_id?: string;
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
const valuesEqual = (left: CatalogMutationValue, right: CatalogMutationValue) => (
    Array.isArray(left) && Array.isArray(right)
        ? left.length === right.length && left.every((value, index) => value === right[index])
        : left === right
);
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
        const fields: Array<{ local: readonly string[]; remote: string }> = domain === 'prices'
            ? [{ local: ['price'], remote: 'precio_venta' }]
            : domain === 'classifications'
                ? [{ local: ['name'], remote: 'nombre' }, { local: ['code'], remote: 'codigo' }]
                : domain === 'items'
                    ? [...itemClassificationFields]
                    : domain === 'item_taxes'
                        ? [{ local: ['appliedTaxIds'], remote: 'tax_ids' }]
                        : itemOperationalFields.map(field => ({ local: [field], remote: field }));
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
            if (domain === 'items' && (after !== null && (typeof after !== 'string' || !uuid.test(after)))) throw new Error('La clasificación asignada no tiene una identidad ERP válida.');
            if (domain === 'item_taxes' && (!Array.isArray(after) || after.length > 32 || after.some(value => !value || value.length > 160))) throw new Error('Asignación de impuestos inválida.');
            if (domain === 'item_operations' && typeof after !== 'boolean') throw new Error('Operación del artículo inválida.');
            changes.push({ recordId: row.id, domain, field: remote, before, after, label: row.name || row.id });
        }
    }
    return changes;
}
