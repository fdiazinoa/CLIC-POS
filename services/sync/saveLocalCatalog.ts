import { v4 as uuid } from 'uuid';
import type { BusinessConfig, Product } from '../../types';
import { db } from '../../utils/db';
import { dbAdapter } from '../db';
import type { DurableDocumentMutation } from '../db/DatabaseAdapter';
import { catalogEditQueue, catalogEditsEnabled, currentCatalogScope, readCatalogEdits } from './catalogEdits';
import { changedCatalogFields, classificationKeys, type LocalCatalogChange } from './catalogLocalChanges';
import { loadSyncProfile } from './SyncProfile';
import type { CatalogEdit } from './CatalogEditQueue';
let writes: Promise<unknown> = Promise.resolve();
let lastTimestamp = 0;
function serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = writes.then(work, work);
    writes = pending.catch(() => undefined);
    return pending;
}
async function persist(documents: DurableDocumentMutation[], changes: LocalCatalogChange[], actorId?: string, replaceCollections: string[] = []) {
    const scope = changes.length ? currentCatalogScope() : null;
    const mutations: CatalogEdit[] = [];
    if (scope && changes.length) {
        if (!actorId) throw new Error('Se requiere un usuario para guardar cambios de catálogo.');
        const previous = (await readCatalogEdits()).filter(edit => edit.scope.tenantId === scope.tenantId && edit.scope.terminalId === scope.terminalId);
        for (const { label, ...change } of changes) {
            const predecessors = [...previous, ...mutations].filter(edit => edit.mutation.recordId === change.recordId && edit.mutation.field === change.field)
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            const predecessor = predecessors[predecessors.length - 1];
            const id = uuid();
            lastTimestamp = Math.max(Date.now(), lastTimestamp + 1, ...previous.map(edit => (Date.parse(edit.createdAt) || 0) + 1));
            mutations.push({ id, scope, label, mutation: { ...change, actorId, id },
                status: 'PENDING', syncStatus: 'PENDING', terminalId: scope.terminalId, attempts: 0, nextAttemptAt: 0, createdAt: new Date(lastTimestamp).toISOString(),
                ...(predecessor && predecessor.status === 'PENDING' ? { dependsOn: predecessor.id } : {}),
            });
        }
    }
    if (!dbAdapter.saveDocumentsAtomically) throw new Error('No está disponible el guardado atómico del catálogo.');
    await dbAdapter.saveDocumentsAtomically([...documents, ...mutations.map(edit => ({ collectionName: 'catalogEdits', document: edit }))], false, replaceCollections);
    if (mutations.length) void catalogEditQueue.process().catch(error => console.warn('Cambios guardados; envío pendiente:', error));
}
// Only user save handlers call these functions. ERP snapshot writes keep using db.
export function saveLocalProducts(next: Product[], actorId?: string, previousSnapshot?: Product[]): Promise<void> {
    return serial(async () => {
        if (!catalogEditsEnabled() || loadSyncProfile().cloudChannel !== 'ERP_ACTIVE') { await db.saveDocuments('products', next); return; }
        const previous = previousSnapshot || await db.get('products') as Product[];
        const tariffPriceChanges = changedCatalogFields(previous, next, 'tariff_prices');
        const basePriceChanges = changedCatalogFields(previous, next, 'prices').filter(priceChange => !tariffPriceChanges.some(tariffChange => {
            const before = tariffChange.before && typeof tariffChange.before === 'object' && !Array.isArray(tariffChange.before)
                ? tariffChange.before.price : null;
            const after = tariffChange.after && typeof tariffChange.after === 'object' && !Array.isArray(tariffChange.after)
                ? tariffChange.after.price : null;
            return before === priceChange.before && after === priceChange.after;
        }));
        const changes = [
            ...basePriceChanges,
            ...tariffPriceChanges,
            ...changedCatalogFields(previous, next, 'items'),
            ...changedCatalogFields(previous, next, 'item_taxes'),
            ...changedCatalogFields(previous, next, 'item_operations'),
            ...changedCatalogFields(previous, next, 'item_general'),
        ];
        await persist(next.map(document => ({ collectionName: 'products', document })), changes, actorId);
    });
}
export function saveLocalClassifications(next: BusinessConfig, actorId?: string): Promise<void> {
    return serial(async () => {
        if (!catalogEditsEnabled() || loadSyncProfile().cloudChannel !== 'ERP_ACTIVE') { await db.save('config', next); return; }
        const previous = await db.get('config') as unknown as BusinessConfig;
        const changes = classificationKeys.flatMap(key => changedCatalogFields(previous[key] || [], next[key] || [], 'classifications'));
        await persist([{ collectionName: 'config', document: { ...next, id: (next as { id?: string }).id || 'current' } }], changes, actorId, ['config']);
    });
}
