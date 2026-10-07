import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLocalUserProfiles, saveLocalUserProfile } from '../utils/localUserProfiles';
import type { User } from '../types';
const user: User = { id: 'erp-user-1', name: 'ERP User', pin: '1234', role: 'CASHIER' };
function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
test('ERP refresh keeps local photo and enrollment but takes new ERP identity and role', () => {
  const storage = memory();
  const biometrics = { credentialID: 'credential', publicKey: 'key', registeredAt: '2026-10-07' };
  saveLocalUserProfile(user.id, { photo: 'local-photo', biometrics, role: 'ADMIN' } as any, 'tenant-a', storage);
  const changed = { ...user, name: 'Renamed by ERP', pin: '5678', role: 'MANAGER', photo: 'erp-photo' };
  assert.deepEqual(applyLocalUserProfiles([changed], 'tenant-a', storage), [{ ...changed, photo: 'local-photo', biometrics }]);
  assert.equal(changed.photo, 'erp-photo');
});
test('profiles are isolated by tenant and never restore a removed ERP user', () => {
  const storage = memory();
  saveLocalUserProfile(user.id, { photo: 'local-photo' }, 'tenant-a', storage);
  assert.deepEqual(applyLocalUserProfiles([user], 'tenant-b', storage), [user]);
  assert.deepEqual(applyLocalUserProfiles([], 'tenant-a', storage), []);
});
test('save never silently succeeds when storage is full', () => {
  assert.throws(() => saveLocalUserProfile(user.id, { photo: 'photo' }, 'tenant-a', {
    getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); },
  }), /QuotaExceededError/);
});
test('corrupt storage leaves authoritative users intact', () => {
  assert.deepEqual(applyLocalUserProfiles([user], 'tenant-a', { getItem: () => 'invalid json' }), [user]);
});
