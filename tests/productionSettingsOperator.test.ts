import assert from 'node:assert/strict';
import test from 'node:test';
import { productionSettingsOperators } from '../utils/productionSettingsOperator';
import type { RoleDefinition, User } from '../types';

const roles = [{ id: 'manager', permissions: ['SETTINGS_ACCESS'] }, { id: 'cashier', permissions: ['POS_ACCESS'] },
  { id: 'admin', permissions: ['ALL'] }] as RoleDefinition[];
const user = (patch: Partial<User> = {}): User => ({ id: 'operator', name: 'Operator', pin: 'test-only', role: 'manager', ...patch });
test('permits active settings operators and ALL roles', () => {
  const users = [user(), user({ id: 'admin-user', role: 'admin' })];
  assert.deepEqual(productionSettingsOperators(users, roles), users);
});
test('does not treat escape access or an unknown role as an operator permission', () => {
  assert.deepEqual(productionSettingsOperators([user({ role: 'cashier' }), user({ role: 'unknown' })], roles), []);
});
test('inactive operators remain excluded', () => {
  assert.deepEqual(productionSettingsOperators([user({ isActive: false })], roles), []);
});
test('explicit roleId governs permission instead of a legacy role label', () => {
  assert.deepEqual(productionSettingsOperators([user({ role: 'admin', roleId: 'cashier' })], roles), []);
  assert.equal(productionSettingsOperators([user({ role: 'legacy', roleId: 'manager' })], roles).length, 1);
});
test('missing synchronized users or roles fails closed', () => {
  assert.deepEqual(productionSettingsOperators([], roles), []);
  assert.deepEqual(productionSettingsOperators([user()], []), []);
});
