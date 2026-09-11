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
        if (collection === 'products' && mutation.domain === 'item_lifecycle' && Array.isArray(result)) {
            const index = result.findIndex(row => row.id === mutation.recordId);
            if (mutation.field === 'create' && mutation.after && typeof mutation.after === 'object' && !Array.isArray(mutation.after)) {
                const lifecycle = mutation.after as Record<string, any>;
                const [barcode = '', barcode_2 = '', barcode_3 = ''] = Array.isArray(lifecycle.barcodes) ? lifecycle.barcodes : [];
                const local = {
                    id: mutation.recordId, ...lifecycle,
                    reference: lifecycle.externalCode ?? '', is_active: lifecycle.isActive !== false,
                    barcode, barcode_2, barcode_3,
                };
                if (index >= 0) result[index] = { ...result[index], ...local };
                else result.push(local);
            } else if (mutation.field === 'delete' && index >= 0) result.splice(index, 1);
        }
        if (collection === 'products' && mutation.domain === 'prices' && Array.isArray(result)) {
            const product = result.find(row => row.id === mutation.recordId);
            if (product) product.price = mutation.after;
        }
        if (collection === 'products' && mutation.domain === 'tariff_prices' && Array.isArray(result)) {
            const product = result.find(row => row.id === mutation.recordId);
            if (product) {
                const tariffs = Array.isArray(product.tariffs) ? [...product.tariffs] : [];
                const index = tariffs.findIndex(entry => String(entry?.tariffId || entry?.tariff_id || '').trim() === mutation.field);
                if (mutation.after && typeof mutation.after === 'object' && !Array.isArray(mutation.after)) {
                    const next = { ...(index >= 0 ? tariffs[index] : {}), tariffId: mutation.field, ...mutation.after };
                    if (index >= 0) tariffs[index] = next;
                    else tariffs.push(next);
                } else if (index >= 0) {
                    tariffs.splice(index, 1);
                }
                product.tariffs = tariffs;
            }
        }
        if (collection === 'productPrices' && mutation.domain === 'tariff_prices' && Array.isArray(result)) {
            const index = result.findIndex(row => row.productId === mutation.recordId && row.tariffId === mutation.field);
            if (mutation.after && typeof mutation.after === 'object' && !Array.isArray(mutation.after)) {
                const next = {
                    ...(index >= 0 ? result[index] : {}),
                    id: `${mutation.recordId}_${mutation.field}`,
                    productId: mutation.recordId,
                    tariffId: mutation.field,
                    price: mutation.after.price,
                    updatedAt: new Date().toISOString(),
                };
                if (index >= 0) result[index] = next;
                else result.push(next);
            } else if (index >= 0) {
                result.splice(index, 1);
            }
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
        if (collection === 'products' && mutation.domain === 'item_taxes' && Array.isArray(result)) {
            const product = result.find(row => row.id === mutation.recordId);
            if (product && mutation.field === 'tax_ids' && Array.isArray(mutation.after)) {
                product.appliedTaxIds = [...mutation.after];
                product.tax_ids = [...mutation.after];
            }
        }
        if (collection === 'products' && mutation.domain === 'item_operations' && Array.isArray(result)) {
            const product = result.find(row => row.id === mutation.recordId);
            if (product && typeof mutation.after === 'boolean') {
                product.operationalFlags = { ...(product.operationalFlags || {}), [mutation.field]: mutation.after };
                product.operational_flags = { ...(product.operational_flags || {}), [mutation.field]: mutation.after };
            }
        }
        if (collection === 'products' && mutation.domain === 'item_general' && Array.isArray(result)) {
            const product = result.find(row => row.id === mutation.recordId);
            if (product) {
                const localFields: Record<string, string[]> = {
                    nombre: ['name'], description: ['description'], sku: ['sku'],
                    external_code: ['reference', 'referenceCode', 'reference_code', 'external_code', 'externalCode'],
                    costo_unitario: ['cost'], type: ['type'], measurement_unit: ['measurementUnit'],
                    purchase_unit: ['purchaseUnit'], is_active: ['is_active'],
                };
                if (mutation.field === 'barcodes' && Array.isArray(mutation.after)) {
                    const [first = '', second = '', third = ''] = mutation.after;
                    Object.assign(product, { barcode: first, barcode_2: second, barcode2: second, barcode_3: third, barcode3: third });
                } else {
                    for (const field of localFields[mutation.field] || []) product[field] = mutation.after;
                }
            }
        }
        if (mutation.domain === 'classification_lifecycle') {
            const collectionKey = mutation.after && typeof mutation.after === 'object' && !Array.isArray(mutation.after)
                ? String((mutation.after as Record<string, any>).collection || '')
                : mutation.before && typeof mutation.before === 'object' && !Array.isArray(mutation.before)
                    ? String((mutation.before as Record<string, any>).collection || '') : '';
            const rows = collection === 'config' && classificationKeys.includes(collectionKey as any)
                ? (Array.isArray(result?.[collectionKey]) ? result[collectionKey] : (result[collectionKey] = []))
                : collection === 'categories' && collectionKey === 'posCategories' && Array.isArray(result) ? result : null;
            if (rows) {
                const index = rows.findIndex((row: any) => row.id === mutation.recordId);
                if (mutation.field === 'create' && mutation.after && typeof mutation.after === 'object' && !Array.isArray(mutation.after)) {
                    const local = { id: mutation.recordId, ...mutation.after };
                    if (index >= 0) rows[index] = { ...rows[index], ...local };
                    else rows.push(local);
                } else if (mutation.field === 'delete' && index >= 0) rows.splice(index, 1);
                else if (mutation.field === 'is_active' && index >= 0) rows[index].isActive = mutation.after;
            }
        }
        if (mutation.domain === 'classifications' || mutation.domain === 'classification_hierarchy') {
            const rows = collection === 'config'
                ? classificationKeys.flatMap(key => Array.isArray(result?.[key]) ? result[key] : [])
                : collection === 'categories' && Array.isArray(result) ? result : [];
            for (const row of rows) if (row.id === mutation.recordId) {
                if (mutation.domain === 'classification_hierarchy') {
                    row.parentId = mutation.after;
                    row.parent_id = mutation.after;
                } else {
                    row[mutation.field === 'nombre' ? 'name' : 'code'] = mutation.after;
                }
            }
        }
    }
    return result;
}
