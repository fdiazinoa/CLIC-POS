import test from 'node:test';
import assert from 'node:assert/strict';
import type { CartItem, V3SaleAuthorityStamp } from '../types';
import { planV3CartReanchor } from '../services/sync/LargeMasterSyncV3CartReanchor';

const binding = 'BINDING';
const warehouseId = 'ALM_A01';
const live: V3SaleAuthorityStamp = {
  syncId: 'S2', syncVersion: 11, tariffId: 'T1', taxIncluded: true,
  inventoryVersion: 5, inventoryCursor: 'C5', inventorySyncId: 'S2', inventorySyncVersion: 11,
};
const yesterday: V3SaleAuthorityStamp = {
  syncId: 'S1', syncVersion: 10, tariffId: 'T1', taxIncluded: true,
  inventoryVersion: 4, inventoryCursor: 'C4', inventorySyncId: 'S1', inventorySyncVersion: 10,
};

const restaurantLine = (overrides: Partial<CartItem> = {}) => ({
  id: 'ART-1', cartId: 'CART-1', name: 'Pechuga a la plancha', price: 395, quantity: 2,
  taxable: true, appliedTaxIds: ['ITBIS'], v3SaleAuthority: yesterday, note: 'sin sal',
  discountAmount: 25, restaurantConfig: { note: 'sin sal', selected_modifiers: [{ name: 'Término medio' }] },
  selected_modifiers: [{ name: 'Término medio' }],
  ...overrides,
}) as unknown as CartItem;

test('a table restored from a previous day keeps every agreed amount and only adopts today authority', () => {
  const line = restaurantLine();
  const outcome = planV3CartReanchor([line], () => live, binding, warehouseId);
  assert.equal(outcome.changed, true);
  assert.deepEqual(outcome.unavailable, []);
  const [next] = outcome.lines;
  assert.equal(next.price, 395, 'the agreed price never changes');
  assert.equal(next.quantity, 2);
  assert.equal(next.note, 'sin sal');
  assert.equal(next.discountAmount, 25);
  assert.deepEqual(next.appliedTaxIds, ['ITBIS']);
  assert.deepEqual(next.selected_modifiers, [{ name: 'Término medio' }]);
  assert.deepEqual(next.restaurantConfig, line.restaurantConfig);
  assert.deepEqual(next.v3SaleAuthority, { ...live, binding, warehouseId });
});

test('a line already carrying today authority is not touched', () => {
  const line = restaurantLine({ v3SaleAuthority: { ...live, binding, warehouseId } });
  const outcome = planV3CartReanchor([line], () => live, binding, warehouseId);
  assert.equal(outcome.changed, false);
  assert.equal(outcome.lines[0], line);
});

test('an article that no longer exists is reported, never silently repriced or dropped', () => {
  const line = restaurantLine();
  const outcome = planV3CartReanchor([line], () => null, binding, warehouseId);
  assert.equal(outcome.changed, false);
  assert.deepEqual(outcome.unavailable, ['ART-1']);
  assert.equal(outcome.lines[0], line);
});

test('a tariff that switched between tax included and excluded is held instead of restating the price', () => {
  const line = restaurantLine();
  const outcome = planV3CartReanchor([line], () => ({ ...live, taxIncluded: false }), binding, warehouseId);
  assert.equal(outcome.changed, false);
  assert.deepEqual(outcome.unavailable, ['ART-1']);
  assert.equal(outcome.lines[0], line);
});

test('a cart mixing generations is aligned in one pass', () => {
  const older = restaurantLine({ cartId: 'C1', id: 'A' });
  const newer = restaurantLine({ cartId: 'C2', id: 'B', v3SaleAuthority: { ...live, binding, warehouseId } });
  const third = restaurantLine({ cartId: 'C3', id: 'C', v3SaleAuthority: { ...yesterday, inventoryVersion: 3, inventoryCursor: 'C3' } });
  const outcome = planV3CartReanchor([older, newer, third], () => live, binding, warehouseId);
  assert.equal(outcome.changed, true);
  assert.deepEqual(outcome.lines.map(line => line.v3SaleAuthority!.inventoryVersion), [5, 5, 5]);
  assert.deepEqual(outcome.lines.map(line => line.v3SaleAuthority!.binding), [binding, binding, binding]);
});
