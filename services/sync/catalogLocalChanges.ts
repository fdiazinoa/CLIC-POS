import type { CatalogMutation } from './CatalogEditQueue';
export const classificationKeys = ['departments', 'sections', 'families', 'subfamilies', 'brands', 'posCategories'] as const;
export type LocalCatalogChange = Omit<CatalogMutation, 'id' | 'actorId'> & { label: string };
type Row = { id: string; name?: string; price?: number; code?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function changedCatalogFields(previous: Row[], next: Row[], domain: 'prices' | 'classifications'): LocalCatalogChange[] {
    const oldRows = new Map(previous.map(row => [row.id, row]));
    const changes: LocalCatalogChange[] = [];
    for (const row of next) {
        const old = oldRows.get(row.id);
        if (!old) continue; // Creation is a separate contract.
        for (const [local, remote] of domain === 'prices' ? [['price', 'precio_venta']] : [['name', 'nombre'], ['code', 'codigo']]) {
            const rawBefore = old[local as keyof Row] ?? null;
            const rawAfter = row[local as keyof Row] ?? null;
            const before = domain === 'prices' && rawBefore !== null ? Number(rawBefore) : rawBefore;
            const after = domain === 'prices' && rawAfter !== null ? Number(rawAfter) : rawAfter;
            // Optional empty code representations are equivalent: opening an
            // editor must not turn an absent/null code into an outgoing update.
            if (before === after || (local === 'code' && (before ?? '') === (after ?? ''))) continue;

            if (!uuid.test(row.id)) throw new Error(`El registro ${row.name || row.id} no tiene una identidad ERP válida.`);
            if (domain === 'prices' && (typeof after !== 'number' || !Number.isFinite(after) || after < 0 || after > 1e12)) throw new Error('Precio inválido.');
            if (domain === 'classifications' && ((after !== null && typeof after !== 'string') || (typeof after === 'string' && after.length > 120) || (local === 'name' && (typeof after !== 'string' || !after.trim())))) throw new Error('Clasificación inválida.');
            changes.push({ recordId: row.id, domain, field: remote, before, after: (after ?? '') as string | number, label: row.name || row.id });
        }
    }
    return changes;
}
