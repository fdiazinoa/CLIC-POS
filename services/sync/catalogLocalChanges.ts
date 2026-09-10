import type { CatalogMutation } from './CatalogEditQueue';
export const classificationKeys = ['departments', 'sections', 'families', 'subfamilies', 'brands', 'posCategories'] as const;
export type LocalCatalogChange = Omit<CatalogMutation, 'id' | 'actorId'> & { label: string };
type Row = {
    id: string; name?: string; price?: number; code?: string;
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
const firstValue = (row: Row, fields: readonly string[]) => {
    for (const field of fields) {
        const value = row[field as keyof Row];
        if (value !== undefined) return typeof value === 'string' && !value.trim() ? null : value;
    }
    return null;
};
export function changedCatalogFields(previous: Row[], next: Row[], domain: 'prices' | 'classifications' | 'items'): LocalCatalogChange[] {
    const oldRows = new Map(previous.map(row => [row.id, row]));
    const changes: LocalCatalogChange[] = [];
    for (const row of next) {
        const old = oldRows.get(row.id);
        if (!old) continue; // Creation is a separate contract.
        const fields = domain === 'prices'
            ? [{ local: ['price'], remote: 'precio_venta' }]
            : domain === 'classifications'
                ? [{ local: ['name'], remote: 'nombre' }, { local: ['code'], remote: 'codigo' }]
                : itemClassificationFields;
        for (const { local, remote } of fields) {
            const rawBefore = firstValue(old, local);
            const rawAfter = firstValue(row, local);
            const before = domain === 'prices' && rawBefore !== null ? Number(rawBefore) : rawBefore;
            const after = domain === 'prices' && rawAfter !== null ? Number(rawAfter) : rawAfter;
            // Optional empty code representations are equivalent: opening an
            // editor must not turn an absent/null code into an outgoing update.
            if (before === after || (local[0] === 'code' && (before ?? '') === (after ?? ''))) continue;

            if (!uuid.test(row.id)) throw new Error(`El registro ${row.name || row.id} no tiene una identidad ERP válida.`);
            if (domain === 'prices' && (typeof after !== 'number' || !Number.isFinite(after) || after < 0 || after > 1e12)) throw new Error('Precio inválido.');
            if (domain === 'classifications' && ((after !== null && typeof after !== 'string') || (typeof after === 'string' && after.length > 120) || (local[0] === 'name' && (typeof after !== 'string' || !after.trim())))) throw new Error('Clasificación inválida.');
            if (domain === 'items' && (after !== null && (typeof after !== 'string' || !uuid.test(after)))) throw new Error('La clasificación asignada no tiene una identidad ERP válida.');
            changes.push({ recordId: row.id, domain, field: remote, before, after: after as string | number | null, label: row.name || row.id });
        }
    }
    return changes;
}
