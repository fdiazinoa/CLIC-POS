// Run through esbuild with import.meta.env defined (see docs/POS_CATALOG_EDITS.md).
import test from 'node:test';
import assert from 'node:assert/strict';
class Storage {
    values = new Map<string, string>();
    getItem(k: string) { return this.values.get(k) ?? null; }
    setItem(k: string, v: string) { this.values.set(k, v); }
    removeItem(k: string) { this.values.delete(k); }
}
const localStorage = new Storage();
Object.assign(globalThis, { localStorage, sessionStorage: new Storage(), window: { localStorage, setTimeout, clearTimeout, dispatchEvent: () => true } });
const tenantId = '00000000-0000-4000-8000-000000000001';
const terminalId = '00000000-0000-4000-8000-000000000002';
localStorage.setItem('clic_sync_profile', JSON.stringify({ contractedProduct: 'POS_ERP', posRuntime: 'LOCAL_SQLITE', cloudChannel: 'ERP_ACTIVE', dataMaster: 'ERP', erpTerminalId: terminalId, erpTenantId: tenantId, erpBaseUrl: 'https://erp.example.test', cloudSyncEnabled: true }));
localStorage.setItem('clic_erp_sync_company_id', '00000000-0000-4000-8000-000000000003');
localStorage.setItem('CLIC_POS_DEVICE_ID', 'device-1');
const { dbAdapter } = await import('../services/db');
const { db } = await import('../utils/db');
const { catalogEditQueue, restoreRejectedProductValue } = await import('../services/sync/catalogEdits');
const { deleteLocalProduct, saveLocalProducts, saveLocalClassifications } = await import('../services/sync/saveLocalCatalog');
const store = new Map<string, any>();
let sends = 0;
let failSave = false;
const authorizedTerminal = {
    id: terminalId,
    config: {
        erpTerminalId: terminalId,
        posCatalogEdits: { enabled: true },
    },
};
(db as any).get = async (key: string) => {
    const value = structuredClone(store.get(key) ?? []);
    if (key !== 'config') return value;
    const config = Array.isArray(value) ? {} : value;
    return { ...config, terminals: config.terminals || [authorizedTerminal] };
};
(db as any).saveDocument = async (key: string, document: any) => {
    const rows = (store.get(key) || []).filter((row: any) => row.id !== document.id);
    store.set(key, [...rows, structuredClone(document)]);
};
(dbAdapter as any).getCollection = async (key: string) => structuredClone(store.get(key) ?? []);
(dbAdapter as any).saveDocumentsAtomically = async (documents: any[], _requireAbsent = false, replaceCollections: string[] = []) => {
    if (failSave) throw new Error('Disk full');
    for (const collection of replaceCollections) store.set(collection, collection === 'config' ? {} : []);
    for (const { collectionName, document } of documents) {
        if (collectionName === 'config') { store.set(collectionName, document); continue; }
        const rows = (store.get(collectionName) || []).filter((row: any) => row.id !== document.id);
        store.set(collectionName, [...rows, structuredClone(document)]);
    }
};
(dbAdapter as any).saveDocument = async (collectionName: string, document: any) => {
    const rows = (store.get(collectionName) || []).filter((row: any) => row.id !== document.id);
    store.set(collectionName, [...rows, structuredClone(document)]);
};
(catalogEditQueue as any).process = async () => { sends++; };
const product = { id: '00000000-0000-4000-8000-000000000005', name: 'Café', price: 10 };
const departmentA = '00000000-0000-4000-8000-000000000010';
const departmentB = '00000000-0000-4000-8000-000000000011';
test('saving the existing product writes local value and automatically schedules ERP; repeated edits chain', async () => {
    store.clear(); store.set('products', [product]); sends = 0;
    const arrayAt = Array.prototype.at;
    try {
        Object.defineProperty(Array.prototype, 'at', { configurable: true, writable: true, value: undefined });
        await saveLocalProducts([{ ...product, price: 12 } as any], 'operator');
    } finally {
        Object.defineProperty(Array.prototype, 'at', { configurable: true, writable: true, value: arrayAt });
    }
    await saveLocalProducts([{ ...product, price: 15 } as any], 'operator');
    assert.equal(store.get('products')[0].price, 15);
    const queue = store.get('catalogEdits');
    assert.equal(queue.length, 2); assert.equal(sends, 2);
    assert.equal(queue[0].mutation.before, 10); assert.equal(queue[1].mutation.before, 12);
    assert.equal(queue[1].dependsOn, queue[0].id);
    await saveLocalProducts([{ ...product, price: 15 } as any], 'operator');
    assert.equal(store.get('catalogEdits').length, 2);
});
test('creating and deleting an item use the durable lifecycle and preserve optimistic state across snapshots', async () => {
    store.clear(); sends = 0;
    const created = { ...product, type: 'PRODUCT', sku: 'ART-000001', master_number_range_id: departmentA, master_number_value: 1, source_terminal_id: terminalId };
    await saveLocalProducts([created] as any, 'operator', []);
    let queue = store.get('catalogEdits');
    assert.equal(queue[0].mutation.domain, 'item_lifecycle');
    assert.equal(queue[0].mutation.field, 'create');
    assert.ok(queue.slice(1).every((entry: any) => entry.dependsOn === queue[0].id));
    const { preserveLocalCatalog } = await import('../services/sync/preserveLocalCatalog');
    assert.equal((await preserveLocalCatalog('products', []) as any[])[0].sku, 'ART-000001');

    store.set('catalogEdits', []);
    store.set('products', [created]);
    await deleteLocalProduct(created as any, [], 'operator');
    queue = store.get('catalogEdits');
    assert.equal(queue[0].mutation.field, 'delete');
    assert.deepEqual(await preserveLocalCatalog('products', [created]), []);
    assert.deepEqual(store.get('products'), []);
});
test('classification create, visibility, and delete operations are durable', async () => {
    store.clear(); sends = 0;
    store.set('config', { departments: [] });
    const row = { id: departmentA, name: 'Bebidas', code: 'BEB', isActive: true };
    await saveLocalClassifications({ departments: [row] } as any, 'operator');
    await saveLocalClassifications({ departments: [{ ...row, isActive: false }] } as any, 'operator');
    await saveLocalClassifications({ departments: [] } as any, 'operator');
    const queue = store.get('catalogEdits');
    assert.deepEqual(queue.map((entry: any) => [entry.mutation.domain, entry.mutation.field]), [
        ['classification_lifecycle', 'create'], ['classification_lifecycle', 'is_active'], ['classification_lifecycle', 'delete'],
    ]);
    assert.equal(queue[1].dependsOn, queue[0].id);
    assert.equal(queue[2].dependsOn, queue[1].id);
});
test('saving the existing classification automatically captures name and code without ERP lookup', async () => {
    store.clear(); const old = { departments: [{ id: product.id, name: 'Bebida', code: 'B' }] };
    store.set('config', old);
    await saveLocalClassifications({ departments: [{ id: product.id, name: 'Bebidas', code: '' }] } as any, 'operator');
    assert.equal(store.get('config').departments[0].name, 'Bebidas');
    assert.deepEqual(store.get('catalogEdits').map((e: any) => e.mutation.field), ['nombre', 'codigo']);
});
test('moving a classification queues its parent and preserves it against an older snapshot', async () => {
    store.clear(); sends = 0;
    const parentA = '00000000-0000-4000-8000-000000000010';
    const parentB = '00000000-0000-4000-8000-000000000011';
    const old = { sections: [{ id: product.id, name: 'Bebidas', parentId: parentA }] };
    store.set('config', old);
    await saveLocalClassifications({ sections: [{ id: product.id, name: 'Bebidas', parentId: parentB }] } as any, 'operator');
    const queue = store.get('catalogEdits');
    assert.deepEqual(queue.map((entry: any) => [entry.mutation.domain, entry.mutation.field, entry.mutation.after]), [
        ['classification_hierarchy', 'parent_id', parentB],
    ]);
    const { preserveLocalCatalog } = await import('../services/sync/preserveLocalCatalog');
    const merged = await preserveLocalCatalog('config', old) as any;
    assert.equal(merged.sections[0].parentId, parentB);
    assert.equal(merged.sections[0].parent_id, parentB);
});
test('reclassifying an existing item queues only changed ERP assignment fields', async () => {
    store.clear(); sends = 0;
    store.set('products', [{ ...product, departmentId: departmentA, brandId: null }]);
    await saveLocalProducts([{ ...product, departmentId: departmentB, brandId: departmentA } as any], 'operator');
    const queue = store.get('catalogEdits');
    assert.deepEqual(queue.map((entry: any) => [entry.mutation.domain, entry.mutation.field, entry.mutation.before, entry.mutation.after]), [
        ['items', 'department_id', departmentA, departmentB],
        ['items', 'brand_id', null, departmentA],
    ]);
    assert.equal(sends, 1);
});
test('single-product save uses the UI snapshot when storage already contains the edited alias', async () => {
    store.clear(); sends = 0;
    const previous = { ...product, departmentId: departmentA, department_id: departmentA };
    const edited = { ...previous, departmentId: departmentB };
    store.set('products', [edited]);
    await saveLocalProducts([edited] as any, 'operator', [previous] as any);
    const queue = store.get('catalogEdits');
    assert.deepEqual(queue.map((entry: any) => [entry.mutation.domain, entry.mutation.field, entry.mutation.before, entry.mutation.after]), [
        ['items', 'department_id', departmentA, departmentB],
    ]);
    assert.equal(sends, 1);
});
test('partial bulk product saves never enqueue deletions for untouched catalog rows', async () => {
    const products = Array.from({ length: 165 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`,
        name: `Producto ${index + 1}`,
        sku: `ART-${String(index + 1).padStart(6, '0')}`,
        price: 10,
        appliedTaxIds: [],
        operationalFlags: { trackInventory: true },
    }));
    for (const touchedCount of [0, 3, 10, 20, 25, 50, 100]) {
        store.clear(); sends = 0;
        store.set('products', structuredClone(products));
        const touched = products.slice(0, touchedCount).map(row => ({
            ...row,
            operationalFlags: { ...row.operationalFlags, trackInventory: false },
        }));

        // Tariff and bulk editors submit only the changed rows and may omit the
        // previous snapshot, so this must remain a patch instead of a full replace.
        await saveLocalProducts(touched as any, 'operator');

        const queue = store.get('catalogEdits') || [];
        assert.equal(store.get('products').length, 165);
        assert.equal(queue.length, touchedCount);
        assert.ok(queue.every((entry: any) => entry.mutation.domain === 'item_operations'));
        assert.ok(queue.every((entry: any) => entry.mutation.field === 'trackInventory'));
        assert.ok(queue.every((entry: any) => entry.mutation.field !== 'delete'));
        assert.equal(sends, touchedCount > 0 ? 1 : 0);
    }

    store.clear(); sends = 0;
    store.set('products', structuredClone(products));
    const catalogManagerSelection = products.slice(0, 25).map(row => ({
        ...row,
        name: `${row.name} actualizado`,
        price: 12,
        appliedTaxIds: ['00000000-0000-4000-8000-000000009999'],
        operationalFlags: { ...row.operationalFlags, trackInventory: false },
    }));
    await saveLocalProducts(catalogManagerSelection as any, 'operator', products as any);
    const catalogManagerQueue = store.get('catalogEdits') || [];
    assert.equal(store.get('products').length, 165);
    assert.equal(catalogManagerQueue.length, 100);
    for (const domain of ['prices', 'item_taxes', 'item_operations', 'item_general']) {
        assert.equal(catalogManagerQueue.filter((entry: any) => entry.mutation.domain === domain).length, 25);
    }
    assert.ok(catalogManagerQueue.every((entry: any) => entry.mutation.field !== 'delete'));

    store.clear(); sends = 0;
    store.set('products', structuredClone(products));
    await deleteLocalProduct(products[0] as any, products.slice(1) as any, 'operator');
    const deleteQueue = store.get('catalogEdits') || [];
    assert.equal(store.get('products').length, 164);
    assert.equal(deleteQueue.length, 1);
    assert.equal(deleteQueue[0].mutation.recordId, products[0].id);
    assert.equal(deleteQueue[0].mutation.field, 'delete');
});
test('failed atomic storage neither publishes nor loses the previous local price', async () => {
    store.clear(); store.set('products', [product]); sends = 0; failSave = true;
    try { await assert.rejects(() => saveLocalProducts([{ ...product, price: 99 } as any], 'operator'), /Disk full/); }
    finally { failSave = false; }
    assert.equal(store.get('products')[0].price, 10); assert.equal(store.get('catalogEdits'), undefined); assert.equal(sends, 0);
});
test('a forbidden ERP edit restores optimistic price and tax values in the local catalog', async () => {
    const taxId = '00000000-0000-4000-8000-000000000099';
    store.clear();
    store.set('products', [{ ...product, price: 19, taxable: false, appliedTaxIds: [], tax_ids: [] }]);
    const baseEdit = {
        id: 'rejected-price',
        scope: { tenantId, terminalId, companyId: localStorage.getItem('clic_erp_sync_company_id'), deviceId: 'device-1', baseUrl: 'https://erp.example.test' },
        label: product.name,
        status: 'REJECTED', syncStatus: 'ERROR', syncError: 'CATALOG_EDIT_FORBIDDEN', attempts: 0, nextAttemptAt: 0, createdAt: new Date().toISOString(),
    } as any;
    await restoreRejectedProductValue({
        ...baseEdit,
        mutation: { id: baseEdit.id, recordId: product.id, domain: 'prices', field: 'precio_venta', before: 10, after: 19, actorId: 'operator' },
    }, false);
    await restoreRejectedProductValue({
        ...baseEdit,
        id: 'rejected-tax',
        mutation: { id: 'rejected-tax', recordId: product.id, domain: 'item_taxes', field: 'tax_ids', before: [taxId], after: [], actorId: 'operator' },
    }, false);
    assert.equal(store.get('products')[0].price, 10);
    assert.equal(store.get('products')[0].taxable, true);
    assert.deepEqual(store.get('products')[0].appliedTaxIds, [taxId]);
    assert.deepEqual(store.get('products')[0].tax_ids, [taxId]);
});
test('incoming ERP snapshot preserves pending local fields without creating an outgoing echo', async () => {
    store.clear(); store.set('products', [product]);
    await saveLocalProducts([{ ...product, price: 19 } as any], 'operator');
    const { preserveLocalCatalog } = await import('../services/sync/preserveLocalCatalog');
    const incoming = [{ ...product, price: 10 }];
    const merged = await preserveLocalCatalog('products', incoming) as any[];
    assert.equal(merged[0].price, 19); assert.equal(incoming[0].price, 10);
    assert.equal(store.get('catalogEdits').length, 1);
});
test('an applied edit blocks stale snapshots until ERP confirms it, then accepts later ERP changes', async () => {
    store.clear(); store.set('products', [product]);
    await saveLocalProducts([{ ...product, price: 19 } as any], 'operator');
    store.set('catalogEdits', store.get('catalogEdits').map((edit: any) => ({
        ...edit, status: 'APPLIED', syncStatus: 'SYNCED',
    })));
    const { preserveLocalCatalog } = await import('../services/sync/preserveLocalCatalog');

    const stale = await preserveLocalCatalog('products', [{ ...product, price: 10 }]) as any[];
    assert.equal(stale[0].price, 19);
    assert.equal(store.get('catalogEdits')[0].snapshotConfirmedAt, undefined);

    const confirmed = await preserveLocalCatalog('products', [{ ...product, price: 19 }]) as any[];
    assert.equal(confirmed[0].price, 19);
    assert.ok(store.get('catalogEdits')[0].snapshotConfirmedAt);

    const laterErp = await preserveLocalCatalog('products', [{ ...product, price: 21 }]) as any[];
    assert.equal(laterErp[0].price, 21);
});
test('incoming ERP snapshot preserves a pending item reclassification', async () => {
    store.clear();
    store.set('products', [{ ...product, departmentId: departmentA }]);
    await saveLocalProducts([{ ...product, departmentId: departmentB } as any], 'operator');
    const { preserveLocalCatalog } = await import('../services/sync/preserveLocalCatalog');
    const merged = await preserveLocalCatalog('products', [{ ...product, departmentId: departmentA, department_id: departmentA }]) as any[];
    assert.equal(merged[0].departmentId, departmentB);
    assert.equal(merged[0].department_id, departmentB);
});
test('tax assignments and operations persist atomically and survive an older ERP snapshot', async () => {
    store.clear(); sends = 0;
    const previous = {
        ...product,
        appliedTaxIds: ['tax-a'],
        operationalFlags: { trackInventory: true, promptPrice: false },
    };
    const edited = {
        ...previous,
        appliedTaxIds: ['tax-b'],
        operationalFlags: { ...previous.operationalFlags, trackInventory: false, promptPrice: true },
    };
    store.set('products', [previous]);
    await saveLocalProducts([edited] as any, 'operator', [previous] as any);
    const queue = store.get('catalogEdits');
    assert.deepEqual(queue.map((entry: any) => [entry.mutation.domain, entry.mutation.field]), [
        ['item_taxes', 'tax_ids'],
        ['item_operations', 'trackInventory'],
        ['item_operations', 'promptPrice'],
    ]);
    const { preserveLocalCatalog } = await import('../services/sync/preserveLocalCatalog');
    const merged = await preserveLocalCatalog('products', [previous]) as any[];
    assert.deepEqual(merged[0].appliedTaxIds, ['tax-b']);
    assert.equal(merged[0].operationalFlags.trackInventory, false);
    assert.equal(merged[0].operationalFlags.promptPrice, true);
    assert.equal(sends, 1);
});
test('tariff overrides persist durably and pending activation or removal survives snapshots', async () => {
    store.clear(); sends = 0;
    const tariffA = '00000000-0000-4000-8000-000000000020';
    const tariffB = '00000000-0000-4000-8000-000000000021';
    const previous = { ...product, tariffs: [{ tariffId: tariffA, price: 10, margin: 20 }] };
    const edited = { ...product, tariffs: [{ tariffId: tariffB, price: 8, margin: 15 }] };
    store.set('products', [previous]);
    await saveLocalProducts([edited] as any, 'operator', [previous] as any);
    const queue = store.get('catalogEdits');
    assert.deepEqual(queue.map((entry: any) => [entry.mutation.domain, entry.mutation.field, entry.mutation.after]), [
        ['tariff_prices', tariffA, null],
        ['tariff_prices', tariffB, { price: 8, margin: 15 }],
    ]);
    const { preserveLocalCatalog } = await import('../services/sync/preserveLocalCatalog');
    const mergedProducts = await preserveLocalCatalog('products', [previous]) as any[];
    assert.deepEqual(mergedProducts[0].tariffs, [{ tariffId: tariffB, price: 8, margin: 15 }]);
    const mergedPrices = await preserveLocalCatalog('productPrices', [
        { id: `${product.id}_${tariffA}`, productId: product.id, tariffId: tariffA, price: 10 },
    ]) as any[];
    assert.equal(mergedPrices.some(row => row.tariffId === tariffA), false);
    assert.equal(mergedPrices.find(row => row.tariffId === tariffB)?.price, 8);
    assert.equal(sends, 1);
});
test('the latest pending tariff value wins while an older ERP price snapshot arrives', async () => {
    store.clear(); sends = 0;
    const tariffId = '00000000-0000-4000-8000-000000000020';
    const baseEdit = {
        scope: {
            terminalId,
            tenantId,
            companyId: '00000000-0000-4000-8000-000000000003',
            deviceId: 'device-1',
            baseUrl: 'https://erp.example.test',
        },
        label: 'Café', status: 'PENDING', syncStatus: 'PENDING', terminalId,
        attempts: 0, nextAttemptAt: 0,
    };
    store.set('catalogEdits', [
        { ...baseEdit, id: 'edit-1', createdAt: '2026-09-11T19:20:00.000Z', mutation: { id: 'edit-1', recordId: product.id, domain: 'tariff_prices', field: tariffId, before: { price: 6500, margin: 0 }, after: { price: 7000, margin: 0 }, actorId: 'operator' } },
        { ...baseEdit, id: 'edit-2', createdAt: '2026-09-11T19:21:00.000Z', dependsOn: 'edit-1', mutation: { id: 'edit-2', recordId: product.id, domain: 'tariff_prices', field: tariffId, before: { price: 7000, margin: 0 }, after: { price: 6500, margin: 0 }, actorId: 'operator' } },
        { ...baseEdit, id: 'edit-3', createdAt: '2026-09-11T19:22:00.000Z', dependsOn: 'edit-2', mutation: { id: 'edit-3', recordId: product.id, domain: 'tariff_prices', field: tariffId, before: { price: 6500, margin: 0 }, after: { price: 7500, margin: 0 }, actorId: 'operator' } },
    ]);
    const { preserveLocalCatalog } = await import('../services/sync/preserveLocalCatalog');
    const incomingProducts = [{ ...product, price: 6000, tariffs: [{ tariffId, price: 6000, margin: 0 }] }];
    const incomingPrices = [{ id: `${product.id}_${tariffId}`, productId: product.id, tariffId, price: 6000 }];

    const preservedProducts = await preserveLocalCatalog('products', incomingProducts) as any[];
    const preservedPrices = await preserveLocalCatalog('productPrices', incomingPrices) as any[];

    assert.equal(preservedProducts[0].price, 7500);
    assert.equal(preservedProducts[0].tariffs[0].price, 7500);
    assert.equal(preservedPrices[0].price, 7500);
});
test('editing the default tariff does not enqueue a conflicting duplicate base-price mutation', async () => {
    store.clear(); sends = 0;
    const tariffId = '00000000-0000-4000-8000-000000000020';
    const previous = { ...product, price: 10, tariffs: [{ tariffId, price: 10, margin: 20 }] };
    const edited = { ...product, price: 12, tariffs: [{ tariffId, price: 12, margin: 30 }] };
    store.set('products', [previous]);
    await saveLocalProducts([edited] as any, 'operator', [previous] as any);
    assert.deepEqual(store.get('catalogEdits').map((entry: any) => entry.mutation.domain), ['tariff_prices']);
});
test('general item edits are durable and survive an older ERP snapshot', async () => {
    store.clear(); sends = 0;
    const previous = { ...product, sku: 'CAF-1', reference: 'REF-1', barcode: '100', cost: 5, type: 'PRODUCT', is_active: true };
    const edited = { ...previous, name: 'Café premium', reference: '', barcode: '101', barcode_2: '202', cost: 6, is_active: false };
    store.set('products', [previous]);
    await saveLocalProducts([edited] as any, 'operator', [previous] as any);
    const queue = store.get('catalogEdits');
    assert.deepEqual(queue.map((entry: any) => [entry.mutation.domain, entry.mutation.field]), [
        ['item_general', 'barcodes'], ['item_general', 'nombre'], ['item_general', 'external_code'],
        ['item_general', 'costo_unitario'], ['item_general', 'is_active'],
    ]);
    const { preserveLocalCatalog } = await import('../services/sync/preserveLocalCatalog');
    const merged = await preserveLocalCatalog('products', [previous]) as any[];
    assert.equal(merged[0].name, 'Café premium');
    assert.equal(merged[0].reference, null);
    assert.equal(merged[0].barcode, '101');
    assert.equal(merged[0].barcode_2, '202');
    assert.equal(merged[0].cost, 6);
    assert.equal(merged[0].is_active, false);
    assert.equal(sends, 1);
});
test('opening classification editor and saving identical values adds nothing to the queue', async () => {
    store.clear(); sends = 0;
    const config = { departments: [{ id: product.id, name: 'Bebidas' }] };
    store.set('config', config);
    await saveLocalClassifications(structuredClone(config) as any, 'operator');
    await saveLocalClassifications({ departments: [{ id: product.id, name: 'Bebidas', code: '' }] } as any, 'operator');
    assert.equal(store.get('catalogEdits'), undefined); assert.equal(sends, 0);
});
test('disabled ERP permission rejects a product mutation before changing local data', async () => {
    store.clear(); sends = 0;
    store.set('config', {
        terminals: [{ ...authorizedTerminal, config: { ...authorizedTerminal.config, posCatalogEdits: { enabled: false } } }],
    });
    store.set('products', [product]);
    await assert.rejects(
        saveLocalProducts([{ ...product, price: 99 } as any], 'operator', [product] as any),
        /El ERP no autoriza cambios de catálogo/,
    );
    assert.equal(store.get('products')[0].price, 10);
    assert.equal(store.get('catalogEdits'), undefined);
    assert.equal(sends, 0);
});
