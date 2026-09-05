import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_ROLES } from '../constants';
import {
  buildAuthoritativeErpSecuritySnapshot,
  ErpSecuritySnapshotError,
  normalizeErpPermissions,
} from '../utils/erpSecuritySnapshot';

const customRole = (permissions: string[] = ['POS_CHECKOUT', 'POS_CLOSE_Z']) => ({
  id: 'CASHIER_Z_CLOSING',
  name: 'Cajero con Cierre Z',
  permissions,
  is_system: false,
  is_active: true,
  version: 1,
});

const martha = (roleId = 'CASHIER_Z_CLOSING') => ({
  id: 'martha',
  name: 'Martha Pérez',
  pin: '2468',
  role_id: roleId,
  is_active: true,
  version: 2,
});

const build = (roleRows: unknown[], userRows: unknown[]) => buildAuthoritativeErpSecuritySnapshot({
  roleRows,
  userRows,
  existingRoles: [],
  existingUsers: [],
});

test('los roles base locales conservan el contrato canónico', () => {
  const admin = DEFAULT_ROLES.find((role) => role.id === 'ADMIN');
  const supervisor = DEFAULT_ROLES.find((role) => role.id === 'SUPERVISOR');
  const cashier = DEFAULT_ROLES.find((role) => role.id === 'CASHIER');
  assert.deepEqual(admin?.permissions, ['ALL']);
  assert.deepEqual(supervisor?.permissions, [
    'POS_VOID_ITEM', 'POS_DISCOUNT', 'POS_OPEN_DRAWER', 'POS_RETURNS',
    'POS_REPRINT_RECEIPT', 'POS_NEW_SALE', 'POS_CHECKOUT', 'POS_CHANGE_TARIFF',
    'POS_VIEW_X_REPORT', 'POS_CLOSE_X', 'POS_ALLOW_SALES_WITH_OPEN_Z', 'TABLE_CONTROL_CENTER',
  ]);
  assert.equal(cashier?.permissions.includes('POS_CLOSE_Z'), false);
});

test('Martha recibe POS_CLOSE_Z por ID de rol y CASHIER no lo recibe', () => {
  const snapshot = build([
    customRole(),
    { id: 'CASHIER', name: 'Cajero', permissions: ['POS_CHECKOUT'], is_active: true },
  ], [martha(), { id: 'cajero', name: 'Otro Cajero', pin: '1111', role_id: 'CASHIER' }]);
  const permissionsFor = (userId: string) => {
    const user = snapshot.users.find((candidate) => candidate.id === userId)!;
    return snapshot.roles.find((role) => role.id === user.roleId)?.permissions || [];
  };
  assert.equal(permissionsFor('martha').includes('POS_CLOSE_Z'), true);
  assert.equal(permissionsFor('cajero').includes('POS_CLOSE_Z'), false);
});

test('permissions vacío permanece vacío y elimina duplicados sin completar defaults', () => {
  assert.deepEqual(normalizeErpPermissions([]), []);
  assert.deepEqual(normalizeErpPermissions(['POS_CHECKOUT', 'pos_checkout']), ['POS_CHECKOUT']);
  assert.deepEqual(build([{ ...customRole([]) }], [martha()]).roles[0].permissions, []);
});

test('un snapshot sin permissions o con relación desconocida se rechaza antes de mutar estado', () => {
  assert.throws(() => build([{ id: 'CASHIER_Z_CLOSING', name: 'Sin permisos' }], [martha()]), ErpSecuritySnapshotError);
  assert.throws(() => build([customRole()], [martha('ROL_INEXISTENTE')]), ErpSecuritySnapshotError);
});

test('un rol personalizado persiste entre reaplicaciones y una revocación sustituye permisos previos', () => {
  const first = build([customRole()], [martha()]);
  const second = buildAuthoritativeErpSecuritySnapshot({
    roleRows: [customRole(['POS_CHECKOUT'])],
    userRows: null,
    existingRoles: first.roles,
    existingUsers: first.users,
  });
  assert.equal(second.roles[0].id, 'CASHIER_Z_CLOSING');
  assert.deepEqual(second.roles[0].permissions, ['POS_CHECKOUT']);
  assert.equal(second.users[0].roleId, 'CASHIER_Z_CLOSING');
});

test('un snapshot completo elimina roles y usuarios ERP que ya no están presentes', () => {
  const previousRoles = build([customRole(), { id: 'OLD', name: 'Anterior', permissions: [] }], [
    martha(),
    { id: 'old-user', name: 'Usuario anterior', pin: '2222', role_id: 'OLD' },
  ]);
  const replacement = buildAuthoritativeErpSecuritySnapshot({
    roleRows: [customRole()],
    userRows: [martha()],
    existingRoles: previousRoles.roles,
    existingUsers: previousRoles.users,
  });
  assert.deepEqual(replacement.roles.map((role) => role.id), ['CASHIER_Z_CLOSING']);
  assert.deepEqual(replacement.users.map((user) => user.id), ['martha']);
});

test('una falla previa o ausencia de catálogos conserva el último snapshot offline', () => {
  const roles = build([customRole()], [martha()]).roles;
  const users = build([customRole()], [martha()]).users;
  const offline = buildAuthoritativeErpSecuritySnapshot({ roleRows: null, userRows: null, existingRoles: roles, existingUsers: users });
  assert.deepEqual(offline.roles, roles);
  assert.deepEqual(offline.users, users);
  assert.equal(offline.rolesChanged, false);
  assert.equal(offline.usersChanged, false);
});

test('la UI bloquea mutaciones en ERP y conserva los handlers en LOCAL_ONLY', () => {
  const teamHub = readFileSync(new URL('../components/TeamHub.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(teamHub, /Administrado por el ERP/);
  assert.match(teamHub, /const handleAddRole = \(\) => \{\s+if \(erpManaged\) return;/);
  assert.match(teamHub, /const togglePermission = \(roleId: string, permKey: string\) => \{\s+if \(erpManaged\) return;/);
  assert.match(teamHub, /const handleSaveUser = \(\) => \{\s+if \(erpManaged\) return;/);
  assert.match(app, /const handleTeamRolesUpdate[\s\S]*if \(isErpManagedPosUserRuntime\(\)\)[\s\S]*db\.save\('roles'/);
});

test('CONFIG_PUSH_V2 y startup convergen en la rutina autoritativa compartida', () => {
  const source = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
  assert.match(source, /refreshTerminalStructuredMasterData[\s\S]*applyAuthoritativeErpSecuritySnapshot\(roleRows, userRows\)/);
  assert.match(source, /Promise\.allSettled\([\s\S]*db\.save\('roles', previousRoles\)[\s\S]*db\.save\('users', previousUsers\)/);
});

test('metadatos de roles y usuarios ERP se conservan', () => {
  const snapshot = build([customRole()], [martha()]);
  assert.deepEqual(
    { version: snapshot.roles[0].version, isActive: snapshot.roles[0].isActive, isSystem: snapshot.roles[0].isSystem, syncSource: snapshot.roles[0].syncSource },
    { version: 1, isActive: true, isSystem: false, syncSource: 'ERP_SNAPSHOT' },
  );
  assert.deepEqual(
    { version: snapshot.users[0].version, isActive: snapshot.users[0].isActive, syncSource: snapshot.users[0].syncSource },
    { version: 2, isActive: true, syncSource: 'ERP_SNAPSHOT' },
  );
});
