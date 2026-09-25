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

test('active ERP Administrator and Supervisor roles have temporary name-based compatibility', () => {
  for (const [index, name] of ['Admin', 'Administrador', 'Administrátor', 'Administrator', 'Supervisor', ' sUpErViSoR '].entries()) {
    const erpRole: RoleDefinition = { ...role(`ERP-${index}`, name), syncSource: 'ERP_SNAPSHOT', isActive: true };
    assert.equal(canExitTableMapToDirectSale(user(erpRole.id), [erpRole]), true, name);
  }
});

test('temporary compatibility does not grant local roles or noncanonical ERP roles', () => {
  for (const name of ['Administrador regional', 'Supervisor turno', 'Supervisora', 'Cashier', '']) {
    const erpRole: RoleDefinition = { ...role('ADMIN', name), syncSource: 'ERP_SNAPSHOT' };
    assert.equal(canExitTableMapToDirectSale(user('ADMIN'), [erpRole]), false, name);
  }
  assert.equal(canExitTableMapToDirectSale(user('SUPERVISOR'), [role('SUPERVISOR', 'Supervisor')]), false);
  assert.equal(canExitTableMapToDirectSale(user('ADMIN'), [{ ...role('ADMIN', 'Administrador'), syncSource: 'LOCAL' }]), false);
});

test('missing or inactive ERP role and inactive user are denied even with matching name', () => {
  const erpRole: RoleDefinition = { ...role('ERP-ADMIN', 'Administrador'), syncSource: 'ERP_SNAPSHOT' };
  assert.equal(canExitTableMapToDirectSale(user('ERP-ADMIN'), []), false);
  assert.equal(canExitTableMapToDirectSale(user('ERP-ADMIN'), [{ ...erpRole, isActive: false }]), false);
  assert.equal(canExitTableMapToDirectSale({ ...user('ERP-ADMIN'), isActive: false }, [erpRole]), false);
  assert.equal(canExitTableMapToDirectSale(user('ERP-ADMIN'), [{ ...erpRole, isActive: false, permissions: ['ALL'] }]), false);
});

test('explicit ERP permission still grants a custom active role', () => {
  const customRole: RoleDefinition = { ...role('ERP-CUSTOM', 'Encargado de salón', ['POS_EXIT_TABLE_MAP']), syncSource: 'ERP_SNAPSHOT' };
  assert.equal(canExitTableMapToDirectSale(user('ERP-CUSTOM'), [customRole]), true);
});
