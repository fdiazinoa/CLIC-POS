import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexedDBAdapter } from '../services/db/adapters/IndexedDBAdapter';
import type { RoleDefinition, User } from '../types';
import { buildAuthoritativeErpSecuritySnapshot, ErpSecuritySnapshotError } from '../utils/erpSecuritySnapshot';
import { hasTicketRolePermission } from '../utils/ticketHistoryPermission';

test('ERP report restrictions and role revocations survive IndexedDB reload and an absent offline snapshot', async () => {
  const globals = ['indexedDB', 'IDBKeyRange', 'localStorage', 'window'] as const;
  const previous = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    window: { setTimeout, clearTimeout } });
  let adapter = new IndexedDBAdapter();
  try {
    const custom = { id: 'CUSTOM', name: 'Personalizado', permissions: ['CASH_IN_OUT', 'POS_CATALOG_CONFLICT_VIEW', 'CUSTOM_KEEP'],
      max_discount_percent: 7.5, z_report_config: { hiddenModules: ['FINANCIAL', 'AUDIT'] } };
    const admin = { id: 'ADMIN', name: 'Administrador', permissions: ['ALL'], is_system: true };
    const first = buildAuthoritativeErpSecuritySnapshot({ roleRows: [custom, admin], userRows: [
      { id: 'u1', name: 'Ana', role_id: 'CUSTOM', pin: '1234' },
    ], existingRoles: [], existingUsers: [] });
    await adapter.connect();
    await adapter.saveCollection('roles', first.roles);
    await adapter.saveCollection('users', first.users);
    await adapter.disconnect();
    adapter = new IndexedDBAdapter();
    await adapter.connect();
    const roles = await adapter.getCollection<RoleDefinition>('roles');
    const users = await adapter.getCollection<User>('users');
    assert.deepEqual(roles.find(role => role.id === 'CUSTOM')?.zReportConfig, custom.z_report_config);
    assert.equal(hasTicketRolePermission(users[0], roles, 'CASH_IN_OUT'), true);
    assert.equal(hasTicketRolePermission(users[0], roles, 'POS_CATALOG_CONFLICT_VIEW'), true);
    const revoked = buildAuthoritativeErpSecuritySnapshot({ roleRows: [
      { ...custom, permissions: ['CUSTOM_KEEP'], z_report_config: { hiddenModules: [] } }, admin,
    ], userRows: null, existingRoles: roles, existingUsers: users });
    await adapter.saveCollection('roles', revoked.roles);
    await adapter.disconnect();
    adapter = new IndexedDBAdapter();
    await adapter.connect();
    const reloaded = await adapter.getCollection<RoleDefinition>('roles');
    const offline = buildAuthoritativeErpSecuritySnapshot({ roleRows: null, userRows: null,
      existingRoles: reloaded, existingUsers: await adapter.getCollection<User>('users') });
    const customReloaded = offline.roles.find(role => role.id === 'CUSTOM')!;
    assert.deepEqual(customReloaded.permissions, ['CUSTOM_KEEP']);
    assert.deepEqual(customReloaded.zReportConfig, { hiddenModules: [] });
    assert.equal(customReloaded.maxDiscountPercent, 7.5);
    assert.equal(hasTicketRolePermission(offline.users[0], offline.roles, 'CASH_IN_OUT'), false);
    assert.equal(hasTicketRolePermission(offline.users[0], offline.roles, 'POS_CATALOG_CONFLICT_VIEW'), false);
    assert.deepEqual(offline.roles.find(role => role.id === 'ADMIN')?.permissions, ['ALL']);
    assert.throws(() => buildAuthoritativeErpSecuritySnapshot({ roleRows: [{ ...custom, z_report_config: { hiddenModules: ['INVALID'] } }],
      userRows: null, existingRoles: offline.roles, existingUsers: offline.users }), ErpSecuritySnapshotError);
    assert.deepEqual(await adapter.getCollection('roles'), reloaded, 'invalid snapshot does not mutate persisted roles');
    const legacy = buildAuthoritativeErpSecuritySnapshot({ roleRows: [{ id: 'CUSTOM', name: 'Anterior', permissions: [] }, admin],
      userRows: null, existingRoles: offline.roles, existingUsers: offline.users });
    assert.equal(legacy.roles[0].zReportConfig, undefined, 'complete legacy snapshot does not merge the previous config');
    assert.deepEqual(legacy.roles[0].permissions, []);
  } finally {
    await adapter.disconnect();
    globals.forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
