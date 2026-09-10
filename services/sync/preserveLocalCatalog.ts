import { dbAdapter } from '../db';
import { catalogScopeMatches } from './catalogEdits';
import { classificationKeys } from './catalogLocalChanges';
import type { CatalogEdit } from './CatalogEditQueue';
// Snapshot writes must not undo edits waiting for ERP acknowledgement. These
// writes never create outgoing mutations; capture exists only in user handlers.
export async function preserveLocalCatalog(collection: string, payload: unknown): Promise<unknown> {
    const pending = (await dbAdapter.getCollection<CatalogEdit>('catalogEdits'))
        .filter(edit => edit.status === 'PENDING' && catalogScopeMatches(edit.scope))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!pending.length) return payload;
    const result = structuredClone(payload) as any;
    for (const edit of pending) {
        const { mutation } = edit;
        if (collection === 'products' && mutation.domain === 'prices' && Array.isArray(result)) {
            const product = result.find(row => row.id === mutation.recordId);
            if (product) product.price = mutation.after;
        }
        if (collection === 'products' && mutation.domain === 'items' && Array.isArray(result)) {
            const product = result.find(row => row.id === mutation.recordId);
            if (product) {
                const localFields: Record<string, string[]> = {
                    department_id: ['departmentId', 'department_id'], section_id: ['sectionId', 'section_id'],
                    family_id: ['familyId', 'family_id'], subfamily_id: ['subfamilyId', 'subfamily_id'],
                    brand_id: ['brandId', 'brand_id'], pos_category_id: ['posCategoryId', 'pos_category_id', 'categoryId', 'category_id'],
                };
                for (const field of localFields[mutation.field] || []) product[field] = mutation.after;
            }
        }
        if (mutation.domain === 'classifications') {
            const rows = collection === 'config'
                ? classificationKeys.flatMap(key => Array.isArray(result?.[key]) ? result[key] : [])
                : collection === 'categories' && Array.isArray(result) ? result : [];
            for (const row of rows) if (row.id === mutation.recordId) row[mutation.field === 'nombre' ? 'name' : 'code'] = mutation.after;
        }
    }
    return result;
}
