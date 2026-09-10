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
const { catalogEditQueue } = await import('../services/sync/catalogEdits');
const { saveLocalProducts, saveLocalClassifications } = await import('../services/sync/saveLocalCatalog');
const store = new Map<string, any>();
let sends = 0;
let failSave = false;
(db as any).get = async (key: string) => structuredClone(store.get(key) ?? []);
(dbAdapter as any).getCollection = async (key: string) => structuredClone(store.get(key) ?? []);
(dbAdapter as any).saveDocumentsAtomically = async (documents: any[]) => {
    if (failSave) throw new Error('Disk full');
    for (const { collectionName, document } of documents) {
        if (collectionName === 'config') { store.set(collectionName, document); continue; }
        const rows = (store.get(collectionName) || []).filter((row: any) => row.id !== document.id);
        store.set(collectionName, [...rows, structuredClone(document)]);
    }
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
test('saving the existing classification automatically captures name and code without ERP lookup', async () => {
    store.clear(); const old = { departments: [{ id: product.id, name: 'Bebida', code: 'B' }] };
    store.set('config', old);
    await saveLocalClassifications({ departments: [{ id: product.id, name: 'Bebidas', code: '' }] } as any, 'operator');
    assert.equal(store.get('config').departments[0].name, 'Bebidas');
    assert.deepEqual(store.get('catalogEdits').map((e: any) => e.mutation.field), ['nombre', 'codigo']);
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
test('failed atomic storage neither publishes nor loses the previous local price', async () => {
    store.clear(); store.set('products', [product]); sends = 0; failSave = true;
    try { await assert.rejects(() => saveLocalProducts([{ ...product, price: 99 } as any], 'operator'), /Disk full/); }
    finally { failSave = false; }
    assert.equal(store.get('products')[0].price, 10); assert.equal(store.get('catalogEdits'), undefined); assert.equal(sends, 0);
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
