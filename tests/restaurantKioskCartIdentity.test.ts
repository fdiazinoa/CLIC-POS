import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProductionDispatchIntentId,
  buildProductionDispatchItems,
} from '../services/restaurant/ProductionOrderDispatcher';

test('production identity is stable for transaction, area and cart lines regardless of input order', () => {
  const left = buildProductionDispatchIntentId('TXN-1', 'KITCHEN', ['line-b', 'line-a', 'line-a']);
  const right = buildProductionDispatchIntentId('TXN-1', 'KITCHEN', ['line-a', 'line-b']);
  assert.equal(left, right);
  assert.notEqual(left, buildProductionDispatchIntentId('TXN-2', 'KITCHEN', ['line-a', 'line-b']));
});

test('production payload preserves cartId and restaurant preparation metadata', () => {
  const [line] = buildProductionDispatchItems([{
    id: 'burger', cartId: 'cart-unique', name: 'Burger', price: 250, quantity: 1,
    modifiers: ['Queso: Extra'], note: 'Sin cebolla', images: [], attributes: [], variants: [],
    tariffs: [], appliedTaxIds: [],
  } as any], 'grill');
  assert.equal(line.id, 'cart-unique');
  assert.equal(line.production_area_id, 'grill');
  assert.deepEqual(line.modifiers, ['Queso: Extra']);
  assert.equal(line.note, 'Sin cebolla');
});
