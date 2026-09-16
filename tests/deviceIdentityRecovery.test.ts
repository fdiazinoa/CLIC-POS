import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createPersistentDeviceIdentityResolver, resolveOrCreateLocalDeviceId, resolveLocalDeviceId, persistLocalDeviceId } from '../utils/deviceRevocation';

test('database/cache reset retains native identity; early sync cannot overwrite it', async () => {
  const values = new Map<string, string>();
  const originalStorage = globalThis.localStorage;
  let nativeId: string | null = 'DEV-HQY8OXQR'; let writes = 0; let failRead = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
  } });
  const resolveOrCreatePersistentDeviceId = createPersistentDeviceIdentityResolver({ readPersistent: async () => {
    await Promise.resolve();
    if (failRead) throw new Error('native read unavailable');
    return nativeId || '';
  }, writePersistent: async value => { writes++; nativeId = value; },
  readLocal: resolveLocalDeviceId, writeLocal: persistLocalDeviceId, generate: () => 'DEV-TEST0001' });
  try {
    // Empty SQLite/web cache does not mean first installation.
    assert.throws(resolveOrCreateLocalDeviceId, /IDENTITY_NOT_READY/);
    assert.equal(nativeId, 'DEV-HQY8OXQR'); assert.equal(writes, 0);
    assert.equal(await resolveOrCreatePersistentDeviceId(), nativeId);
    assert.equal(values.get('CLIC_POS_DEVICE_ID'), nativeId);
    assert.equal(writes, 0);
    values.clear();
    failRead = true;
    await assert.rejects(resolveOrCreatePersistentDeviceId(), /native read unavailable/);
    assert.equal(writes, 0); assert.equal(values.size, 0);
    failRead = false;
    nativeId = null;
    // Concurrent initializers on genuine first installation allocate exactly one ID.
    const identities = await Promise.all(Array.from({ length: 12 }, () => resolveOrCreatePersistentDeviceId()));
    assert.equal(new Set(identities).size, 1); assert.equal(writes, 1);
    const allocated = nativeId;
    values.clear();
    assert.equal(await resolveOrCreatePersistentDeviceId(), allocated);
    assert.equal(writes, 1);
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
    else delete (globalThis as any).localStorage;
  }
});

test('network identity readers never generate or persist a fallback device ID', () => {
  const api = readFileSync(new URL('../services/sync/ApiSyncAdapter.ts', import.meta.url), 'utf8');
  const reader = api.slice(api.indexOf('private resolveCurrentDeviceId'), api.indexOf('private resolveCurrentTenantId'));
  assert.doesNotMatch(reader, /resolveOrCreate|persist|random/);
  const consignment = readFileSync(new URL('../services/sync/ConsignmentSyncService.ts', import.meta.url), 'utf8');
  const fallback = consignment.slice(consignment.indexOf('const requireLocalDeviceId'), consignment.indexOf('const buildHeaders'));
  assert.doesNotMatch(fallback, /random|persistLocalDeviceId/);
  assert.match(fallback, /DEVICE_IDENTITY_NOT_READY/);
  const settings = readFileSync(new URL('../components/SyncSettings.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /resetDeviceIdentityBySupport/);
  assert.match(settings, /fuera de la BD local/);
});
