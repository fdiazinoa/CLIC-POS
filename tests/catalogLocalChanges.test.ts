import test from 'node:test';
import assert from 'node:assert/strict';
import { changedCatalogFields, changedCatalogLifecycle } from '../services/sync/catalogLocalChanges';
const id = '00000000-0000-4000-8000-000000000005';
test('edit then save without changes sends no price or classification mutation', () => {
    for (const row of [{ id, name: 'Bebidas' }, { id, name: 'Bebidas', code: '' }, { id, name: 'Bebidas', code: 'B' }]) {
        assert.deepEqual(changedCatalogFields([row], [{ ...row }], 'classifications'), []);
    }
    assert.deepEqual(changedCatalogFields([{ id, price: 10 }], [{ id, price: 10.00 }], 'prices'), []);
});
test('timestamps, names in product form, order, and absent vs empty code do not send prices', () => {
    assert.deepEqual(changedCatalogFields([{ id, name: 'Antes', price: 10 }], [{ id, name: 'Después', price: 10 }], 'prices'), []);
    assert.deepEqual(changedCatalogFields([{ id, name: 'Bebidas' }], [{ id, name: 'Bebidas', code: '' }], 'classifications'), []);
});
test('only modified fields are included and new local records are excluded', () => {
    const changes = changedCatalogFields([{ id, name: 'Bebida', code: 'B' }], [{ id, name: 'Bebidas', code: 'B' }], 'classifications');
    assert.equal(changes.length, 1); assert.equal(changes[0].field, 'nombre');
    assert.deepEqual(changedCatalogFields([], [{ id, price: 10 }], 'prices'), []);
});
test('catalog lifecycle emits validated creates, deletes, and classification status changes', () => {
    const created = changedCatalogLifecycle([], [{ id, name: 'Café', sku: 'ART-000001', master_number_range_id: id, master_number_value: 1 }], 'item_lifecycle');
    assert.deepEqual(created.map(change => [change.domain, change.field, change.before]), [['item_lifecycle', 'create', null]]);
    assert.equal((created[0].after as any).sku, 'ART-000001');
    assert.equal(changedCatalogLifecycle([{ id, name: 'Café', sku: 'ART-000001' }], [], 'item_lifecycle')[0].field, 'delete');
    const classification = changedCatalogLifecycle(
        [{ id, name: 'Bebidas', isActive: true }], [{ id, name: 'Bebidas', isActive: false }],
        'classification_lifecycle', { kind: 'DEPARTMENTS', collection: 'departments' },
    );
    assert.deepEqual(classification.map(change => [change.field, change.before, change.after]), [['is_active', true, false]]);
});
test('classification hierarchy emits only a real parent move', () => {
    const parentA = '00000000-0000-4000-8000-000000000010';
    const parentB = '00000000-0000-4000-8000-000000000011';
    assert.deepEqual(changedCatalogFields([{ id, parentId: parentA }], [{ id, parentId: parentA, parent_id: parentA }], 'classification_hierarchy'), []);
    assert.deepEqual(changedCatalogFields([{ id, parentId: parentA }], [{ id, parentId: parentB }], 'classification_hierarchy').map(change => [change.field, change.before, change.after]), [
        ['parent_id', parentA, parentB],
    ]);
    assert.equal(changedCatalogFields([{ id, parentId: parentA }], [{ id, parentId: '' }], 'classification_hierarchy')[0].after, null);
});
test('item taxes compare as a canonical set and emit only a real assignment change', () => {
    assert.deepEqual(changedCatalogFields(
        [{ id, appliedTaxIds: ['tax-b', 'tax-a'] }],
        [{ id, appliedTaxIds: ['tax-a', 'tax-b', 'tax-a'] }],
        'item_taxes',
    ), []);
    const changes = changedCatalogFields(
        [{ id, name: 'Café', appliedTaxIds: ['tax-a'] }],
        [{ id, name: 'Café', appliedTaxIds: ['tax-b'] }],
        'item_taxes',
    );
    assert.deepEqual(changes.map(change => [change.domain, change.field, change.before, change.after]), [
        ['item_taxes', 'tax_ids', ['tax-a'], ['tax-b']],
    ]);
});
test('item operations use stable defaults and enqueue each changed switch independently', () => {
    assert.deepEqual(changedCatalogFields(
        [{ id }],
        [{ id, operationalFlags: { trackInventory: true, promptPrice: false } }],
        'item_operations',
    ), []);
    const changes = changedCatalogFields(
        [{ id, operationalFlags: { trackInventory: true, promptPrice: false } }],
        [{ id, operationalFlags: { trackInventory: false, promptPrice: true } }],
        'item_operations',
    );
    assert.deepEqual(changes.map(change => [change.field, change.before, change.after]), [
        ['trackInventory', true, false],
        ['promptPrice', false, true],
    ]);
});
test('tariff prices enqueue price, margin, activation, and removal per tariff', () => {
    const wholesale = '00000000-0000-4000-8000-000000000020';
    const erp = '00000000-0000-4000-8000-000000000021';
    const previous = [{ id, name: 'Café', tariffs: [{ tariffId: wholesale, price: 100, margin: 25 }] }];
    const next = [{ id, name: 'Café', tariffs: [
        { tariffId: wholesale, price: 110, margin: 30 },
        { tariffId: erp, price: 95, margin: null },
    ] }];
    assert.deepEqual(changedCatalogFields(previous, structuredClone(previous), 'tariff_prices'), []);
    assert.deepEqual(changedCatalogFields(previous, next, 'tariff_prices').map(change => [change.field, change.before, change.after]), [
        [wholesale, { price: 100, margin: 25 }, { price: 110, margin: 30 }],
        [erp, null, { price: 95, margin: null }],
    ]);
    const removals = changedCatalogFields(next, previous, 'tariff_prices');
    assert.deepEqual(removals.find(change => change.field === erp)?.after, null);
});
test('general item data normalizes optional text and groups barcodes atomically', () => {
    const previous = [{
        id, name: 'Café', description: '', sku: 'CAF-1', reference: 'REF-1',
        barcode: '100', barcode_2: '200', cost: 5, type: 'PRODUCT',
        measurementUnit: 'Unidad', purchaseUnit: 'Caja', is_active: true,
    }];
    assert.deepEqual(changedCatalogFields(previous, [{ ...previous[0], description: '   ' }], 'item_general'), []);
    const next = [{
        ...previous[0], name: 'Café premium', description: 'Tueste oscuro', reference: '',
        barcode: '101', barcode_2: '', barcode_3: '300', cost: 6, type: 'PRODUCTO_TERMINADO',
        measurementUnit: 'Libra', is_active: false,
    }];
    assert.deepEqual(changedCatalogFields(previous, next, 'item_general').map(change => [change.field, change.before, change.after]), [
        ['barcodes', ['100', '200'], ['101', '300']],
        ['nombre', 'Café', 'Café premium'],
        ['description', null, 'Tueste oscuro'],
        ['external_code', 'REF-1', null],
        ['costo_unitario', 5, 6],
        ['type', 'PRODUCT', 'PRODUCTO_TERMINADO'],
        ['measurement_unit', 'Unidad', 'Libra'],
        ['is_active', true, false],
    ]);
});
