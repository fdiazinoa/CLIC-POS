import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPartialMoveItems } from '../components/TableMoveConfirmationModal';
import { CartItem } from '../types';

const items: CartItem[] = [
    {
        id: 'water',
        cartId: 'line-water',
        name: 'Agua',
        price: 50,
        quantity: 3
    } as CartItem,
    {
        id: 'coffee',
        cartId: 'line-coffee',
        name: 'Café',
        price: 100,
        quantity: 2
    } as CartItem
];

test('partial table move includes only selected items and quantities', () => {
    const selected = buildPartialMoveItems(items, {
        'line-water': 2,
        'line-coffee': 0
    });

    assert.equal(selected.length, 1);
    assert.equal(selected[0]?.id, 'water');
    assert.equal(selected[0]?.quantity, 2);
});

test('partial table move clamps quantities to the source ticket', () => {
    const selected = buildPartialMoveItems(items, {
        'line-water': 99,
        'line-coffee': -2
    });

    assert.equal(selected.length, 1);
    assert.equal(selected[0]?.id, 'water');
    assert.equal(selected[0]?.quantity, 3);
});

test('partial table move remains empty until the operator selects articles', () => {
    assert.deepEqual(buildPartialMoveItems(items, {}), []);
});
