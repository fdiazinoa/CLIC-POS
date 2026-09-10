import test from 'node:test';
import assert from 'node:assert/strict';
import { changedCatalogFields } from '../services/sync/catalogLocalChanges';
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
