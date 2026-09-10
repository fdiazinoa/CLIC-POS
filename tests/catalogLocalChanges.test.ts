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
