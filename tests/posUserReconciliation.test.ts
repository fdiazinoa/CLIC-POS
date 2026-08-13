import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  explicitlyRemovesPosUser,
  reconcilePosUsers,
  resolvePosUserId,
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

test('resuelve identificadores de contratos ERP por alias conocidos', () => {
  assert.equal(resolvePosUserId({ user_id: 'erp-user' }), 'erp-user');
  assert.equal(resolvePosUserId({ email: 'user@example.com' }), 'user@example.com');
});

test('pairing y full pull usan la reconciliación protegida', () => {
  assert.match(appSource, /pairing_roster_reconciled/);
  assert.match(appSource, /const reconciledUsers = reconcilePosUsers\(\{/);
  assert.doesNotMatch(appSource, /setUsers\(setupResult\.boundUsers\)/);
  assert.match(syncSource, /safeItems = await this\.reconcileFullDownloadPosUsers\(safeItems, items\)/);
  assert.match(syncSource, /safeItems = await this\.reconcileFullDownloadPosUsers\(safeItems, fullItems\)/);
});
