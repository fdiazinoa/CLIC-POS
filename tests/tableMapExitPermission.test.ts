import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoleDefinition, User } from '../types';
import { canExitTableMapToDirectSale } from '../utils/tableMapExitPermission';

const user = (roleId: string): User => ({ id: 'u1', name: 'QA', pin: '', role: roleId, roleId });
const role = (id: string, name: string, permissions: RoleDefinition['permissions'] = []): RoleDefinition => ({ id, name, permissions });

test('Administrator and Supervisor local defaults can leave Mesas for direct sale', () => {
  assert.equal(canExitTableMapToDirectSale(user('ADMIN'), [role('ADMIN', 'Administrador', ['ALL'])]), true);
  assert.equal(canExitTableMapToDirectSale(user('SUPERVISOR'), [role('SUPERVISOR', 'Supervisor', ['POS_EXIT_TABLE_MAP'])]), true);
});

test('cashier is denied unless the new role permission is explicitly granted', () => {
  assert.equal(canExitTableMapToDirectSale(user('CASHIER'), [role('CASHIER', 'Cajero')]), false);
  assert.equal(canExitTableMapToDirectSale(user('CASHIER'), [role('CASHIER', 'Cajero', ['POS_EXIT_TABLE_MAP'])]), true);
  assert.equal(canExitTableMapToDirectSale(user('SUPERVISOR'), [role('SUPERVISOR', 'Supervisor')]), false);
  assert.equal(canExitTableMapToDirectSale(user('ADMIN'), []), false);
  assert.equal(canExitTableMapToDirectSale(null, [role('ADMIN', 'Administrador', ['ALL'])]), false);
});
