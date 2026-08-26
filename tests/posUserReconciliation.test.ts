import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  explicitlyRemovesPosUser,
  hasErpSnapshotPosUsers,
  isDefaultSeedPosUser,
  posUserRostersMatch,
  reconcilePosUsers,
  resolvePosUserId,
  selectPosUsersForRuntime,
  withoutDefaultSeedPosUsers,
  type SyncedPosUser,
} from '../utils/posUserReconciliation';

const user = (id: string, name: string, extra: Partial<SyncedPosUser> = {}): SyncedPosUser => ({
  id,
  name,
  pin: '1234',
  role: 'CASHIER',
  roleId: 'CASHIER',
  ...extra,
});

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');

test('un padrón parcial conserva usuarios locales ausentes y agrega los entrantes', () => {
  const result = reconcilePosUsers({
    existingUsers: [user('ana', 'Ana'), user('luis', 'Luis')],
    incomingUsers: [user('jonas', 'Jonas')],
  });
  assert.deepEqual(result.map((entry) => entry.id), ['ana', 'luis', 'jonas']);
});

test('una respuesta parcial vacía no borra credenciales offline', () => {
  const existing = [user('ana', 'Ana'), user('luis', 'Luis')];
  assert.deepEqual(reconcilePosUsers({ existingUsers: existing, incomingUsers: [] }), existing);
});

test('solo una baja explícita elimina un usuario', () => {
  const result = reconcilePosUsers({
    existingUsers: [user('ana', 'Ana'), user('luis', 'Luis')],
    incomingUsers: [],
    explicitlyRemovedIds: ['ana'],
  });
  assert.deepEqual(result.map((entry) => entry.id), ['luis']);
  assert.equal(explicitlyRemovesPosUser({ id: 'ana', can_operate_pos: false }), true);
  assert.equal(explicitlyRemovesPosUser({ id: 'ana', is_active: false }), true);
  assert.equal(explicitlyRemovesPosUser({ id: 'ana', _op: 'DELETE' }), true);
});

test('una actualización parcial conserva PIN, foto y biometría existentes', () => {
  const result = reconcilePosUsers({
    existingUsers: [user('ana', 'Ana', {
      pin: '9876',
      photo: 'local-photo.png',
      biometrics: { credentialID: 'bio-1', publicKey: 'public-key', registeredAt: '2026-08-13T00:00:00.000Z' },
    })],
    incomingUsers: [user('ana', 'Ana ERP', { pin: '', photo: '' })],
  });
  assert.equal(result[0].name, 'Ana ERP');
  assert.equal(result[0].pin, '9876');
  assert.equal(result[0].photo, 'local-photo.png');
  assert.equal(result[0].biometrics?.credentialID, 'bio-1');
});

test('un snapshot global autoritativo reemplaza solo usuarios ERP anteriores', () => {
  const result = reconcilePosUsers({
    existingUsers: [user('erp-old', 'ERP anterior', { syncSource: 'ERP_SNAPSHOT' }), user('local', 'Usuario local')],
    incomingUsers: [user('erp-new', 'ERP nuevo', { syncSource: 'ERP_SNAPSHOT' })],
    allowAuthoritativeReplacement: true,
  });
  assert.deepEqual(result.map((entry) => entry.id), ['local', 'erp-new']);
});

test('identifica semillas actuales y heredadas sin confundir usuarios ERP', () => {
  const legacySeed = user('u1', 'Admin Master', { role: 'ADMIN', roleId: 'ADMIN' });
  const taggedSeed = user('custom', 'Demo', { syncSource: 'LOCAL_SEED' });
  const erpUserWithLegacyIdentity = user('u1', 'Admin Master', {
    role: 'ADMIN',
    roleId: 'ADMIN',
    syncSource: 'ERP_SNAPSHOT',
  });

  assert.equal(isDefaultSeedPosUser(legacySeed), true);
  assert.equal(isDefaultSeedPosUser(taggedSeed), true);
  assert.equal(isDefaultSeedPosUser(erpUserWithLegacyIdentity), false);
  assert.deepEqual(withoutDefaultSeedPosUsers([legacySeed, user('erp', 'ERP')]).map((entry) => entry.id), ['erp']);
});

test('un padrón ERP válido retira semillas pero una respuesta vacía no las borra', () => {
  const legacySeed = user('u2', 'Cajero Principal', { role: 'CASHIER', roleId: 'CASHIER' });
  const erpUser = user('erp', 'Operador ERP', { syncSource: 'ERP_SNAPSHOT' });

  const refreshed = reconcilePosUsers({
    existingUsers: [legacySeed],
    incomingUsers: [erpUser],
    removeDefaultSeedUsers: true,
  });
  assert.deepEqual(refreshed.map((entry) => entry.id), ['erp']);

  const offline = reconcilePosUsers({
    existingUsers: [legacySeed],
    incomingUsers: [],
    removeDefaultSeedUsers: true,
  });
  assert.deepEqual(offline, [legacySeed]);
});

test('un tenant ERP sin usuarios conserva el roster por defecto', () => {
  const defaultUsers = [
    user('u1', 'Admin Master', { role: 'ADMIN', roleId: 'ADMIN', syncSource: 'LOCAL_SEED' }),
    user('u2', 'Cajero Principal', { syncSource: 'LOCAL_SEED' }),
  ];

  assert.deepEqual(selectPosUsersForRuntime(defaultUsers, {
    erpManaged: true,
    fallbackUsers: defaultUsers,
  }), defaultUsers);
  assert.deepEqual(selectPosUsersForRuntime([], {
    erpManaged: true,
    fallbackUsers: defaultUsers,
  }), defaultUsers);
});

test('un usuario local no oculta los defaults ni simula un padrón ERP', () => {
  const defaultUser = user('u1', 'Admin Master', {
    role: 'ADMIN',
    roleId: 'ADMIN',
    syncSource: 'LOCAL_SEED',
  });
  const localUser = user('felix', 'Felix', { syncSource: 'LOCAL' });

  assert.equal(hasErpSnapshotPosUsers([defaultUser, localUser]), false);
  assert.deepEqual(selectPosUsersForRuntime([defaultUser, localUser], {
    erpManaged: true,
  }), [defaultUser, localUser]);
});

test('los usuarios ERP sustituyen visualmente los defaults cuando existen', () => {
  const defaultUser = user('u1', 'Admin Master', {
    role: 'ADMIN',
    roleId: 'ADMIN',
    syncSource: 'LOCAL_SEED',
  });
  const erpUser = user('erp-1', 'Operador ERP', { syncSource: 'ERP_SNAPSHOT' });
  const localUser = user('felix', 'Felix', { syncSource: 'LOCAL' });

  assert.deepEqual(selectPosUsersForRuntime([defaultUser, localUser, erpUser], {
    erpManaged: true,
    fallbackUsers: [defaultUser],
  }), [localUser, erpUser]);
  assert.deepEqual(selectPosUsersForRuntime([defaultUser, erpUser], {
    erpManaged: false,
  }), [defaultUser, erpUser]);
});

test('la comparación del padrón detecta cambios aunque la cantidad sea igual', () => {
  assert.equal(posUserRostersMatch([user('erp', 'Ana')], [user('erp', 'Ana')]), true);
  assert.equal(posUserRostersMatch([user('erp', 'Ana')], [user('erp', 'Ana actualizada')]), false);
});

test('resuelve identificadores de contratos ERP por alias conocidos', () => {
  assert.equal(resolvePosUserId({ user_id: 'erp-user' }), 'erp-user');
  assert.equal(resolvePosUserId({ email: 'user@example.com' }), 'user@example.com');
  assert.equal(
    resolvePosUserId({ id: 'erp-uuid', source_user_id: 'felix-local' }),
    'felix-local',
  );
});

test('pairing y full pull usan la reconciliación protegida', () => {
  assert.match(appSource, /pairing_roster_reconciled/);
  assert.match(appSource, /pairing_remote_roster_refreshed/);
  assert.match(appSource, /const reconciledUsers = reconcilePosUsers\(\{/);
  assert.doesNotMatch(appSource, /setUsers\(setupResult\.boundUsers\)/);
  assert.match(syncSource, /safeItems = await this\.reconcileFullDownloadPosUsers\(safeItems, items\)/);
  assert.match(syncSource, /safeItems = await this\.reconcileFullDownloadPosUsers\(safeItems, fullItems\)/);
  assert.match(syncSource, /removeDefaultSeedUsers: true/);
  assert.match(syncSource, /requestTimeoutMs: 8_000/);
  assert.match(appSource, /refreshErpPosUserRoster\(finalConfig\)/);
  assert.match(appSource, /refreshErpPosUserRoster\(updatedConfig\)/);
  assert.match(appSource, /hasErpSnapshotPosUsers\(refreshedUsers\)/);
  assert.match(appSource, /queueUnsyncedLocalPosUsers/);
  assert.match(appSource, /removeDefaultSeedUsers: isErpDirectBinding/);
  assert.match(appSource, /ERP returned no POS users; preserving local operators and default roster/);
});
