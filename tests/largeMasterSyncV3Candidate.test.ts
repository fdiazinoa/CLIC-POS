import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLargeMasterSyncV3Candidate } from '../services/sync/LargeMasterSyncV3Candidate';
import type { LargeMasterSyncV3Runtime } from '../services/sync/LargeMasterSyncV3Runtime';
import type { LargeMasterSyncV3InventorySnapshot, LargeMasterSyncV3Store } from '../services/sync/LargeMasterSyncV3Types';

const syncId = '00000000-0000-4000-8000-000000000001';

test('observing candidate phases adds zero store/network/runtime work and observer exceptions stay isolated', async () => {
  const phases: string[] = [];
  const first = fixture(); const second = fixture();
  await prepareLargeMasterSyncV3Candidate(first.store, 'https://railway.example.test', undefined, undefined, first.dependencies);
  await prepareLargeMasterSyncV3Candidate(second.store, 'https://railway.example.test', metric => {
    if (metric.phase) phases.push(metric.phase);
    throw new Error('observation only');
  }, undefined, second.dependencies);
  assert.deepEqual(second.calls, first.calls);
  assert.deepEqual(phases, ['negotiation', 'inventory_download', 'inventory_save', 'inventory_readback', 'runtime']);
});
const version = { syncId, syncVersion: 186, contractVersion: 2 };
const inventory: LargeMasterSyncV3InventorySnapshot = { version: 5, cursor: 'inventory-5', balances: [] };

const fixture = () => {
  const calls: string[] = [];
  const store = {
    findIncomplete: async () => { calls.push('findIncomplete'); return null; },
    replaceInventorySnapshot: async () => { calls.push('replaceInventory'); },
    getInventorySnapshotVersion: async () => {
      calls.push('readInventory');
      return { version: inventory.version, cursor: inventory.cursor };
    },
  } as unknown as LargeMasterSyncV3Store;
  const runtime = { version } as LargeMasterSyncV3Runtime;
  const dependencies: NonNullable<Parameters<typeof prepareLargeMasterSyncV3Candidate>[4]> = {
    enabled: true,
    assertEmulator: () => { calls.push('assertEmulator'); },
    createClient: () => {
      calls.push('createClient');
      return {
        requestSync: async () => {
          calls.push('requestSync');
          return { syncId, syncVersion: 186, schemaVersion: 3, status: 'READY', manifestUrl: 'manifest' };
        },
        resumeSync: async () => { calls.push('resumeSync'); return version; },
      };
    },
    fetchInventory: async () => { calls.push('fetchInventory'); return inventory; },
    waitForOperationalWindow: async () => { calls.push('waitForWindow'); return 0; },
    openRuntime: async () => { calls.push('openRuntime'); return runtime; },
  };
  return { calls, store, runtime, dependencies };
};

test('candidate stays dark without opening SQLite or requesting ERP data', async () => {
  const { calls, store, dependencies } = fixture();
  await assert.rejects(() => prepareLargeMasterSyncV3Candidate(store, 'https://railway.example.test',
    undefined, undefined, { ...dependencies, enabled: false }), /SYNC_V3_CANDIDATE_DISABLED/);
  assert.deepEqual(calls, []);
});

test('candidate prepares one V3 catalog and separate empty inventory before exposing runtime', async () => {
  const { calls, store, runtime, dependencies } = fixture();
  assert.deepEqual(await prepareLargeMasterSyncV3Candidate(store, 'https://railway.example.test',
    undefined, undefined, dependencies), {
    runtime, inventoryVersion: 5, inventoryCursor: 'inventory-5',
  });
  assert.deepEqual(calls, ['assertEmulator', 'createClient', 'requestSync', 'findIncomplete',
    'resumeSync', 'fetchInventory', 'waitForWindow', 'replaceInventory', 'readInventory', 'openRuntime']);
});

test('candidate rejects ERP legacy fallback without opening the store', async () => {
  const { calls, store, dependencies } = fixture();
  dependencies.createClient = () => ({
    requestSync: async () => ({ fallback: 'legacy' as const }),
    resumeSync: async () => { throw new Error('must not resume'); },
  });
  await assert.rejects(() => prepareLargeMasterSyncV3Candidate(store, 'https://railway.example.test',
    undefined, undefined, dependencies), /SYNC_V3_LEGACY_FALLBACK_REJECTED/);
  assert.deepEqual(calls, ['assertEmulator']);
});

test('candidate preserves incompatible staging and never loads legacy masters', async () => {
  const { calls, store, dependencies } = fixture();
  store.findIncomplete = async () => ({ syncId: '00000000-0000-4000-8000-000000000002',
    syncVersion: 185, status: 'STAGING', datasets: [], chunks: [] });
  await assert.rejects(() => prepareLargeMasterSyncV3Candidate(store, 'https://railway.example.test',
    undefined, undefined, dependencies), /SYNC_V3_STAGING_CONFLICT/);
  assert.deepEqual(calls, ['assertEmulator', 'createClient', 'requestSync']);
});

test('candidate does not report ready if inventory fetch or persistence fails', async () => {
  const { calls, store, dependencies } = fixture();
  dependencies.fetchInventory = async () => { throw new Error('inventory offline'); };
  await assert.rejects(() => prepareLargeMasterSyncV3Candidate(store, 'https://railway.example.test',
    undefined, undefined, dependencies), /inventory offline/);
  assert.equal(calls.includes('replaceInventory'), false);
  assert.equal(calls.includes('openRuntime'), false);
});

test('candidate refuses a laboratory V1 session before fetching inventory', async () => {
  const { calls, store, dependencies } = fixture();
  dependencies.createClient = () => ({
    requestSync: async () => ({ syncId, syncVersion: 186, schemaVersion: 3,
      status: 'READY', manifestUrl: 'manifest' }),
    resumeSync: async () => ({ ...version, contractVersion: 1 }),
  });
  await assert.rejects(() => prepareLargeMasterSyncV3Candidate(store, 'https://railway.example.test',
    undefined, undefined, dependencies), /SYNC_V3_OPERATIONAL_CONTRACT_REQUIRED/);
  assert.equal(calls.includes('fetchInventory'), false);
});

test('candidate does not expose runtime when persisted inventory does not match the fetch', async () => {
  const { calls, store, dependencies } = fixture();
  store.getInventorySnapshotVersion = async () => ({ version: 4, cursor: 'older' });
  await assert.rejects(() => prepareLargeMasterSyncV3Candidate(store, 'https://railway.example.test',
    undefined, undefined, dependencies), /SYNC_V3_INVENTORY_NOT_READY/);
  assert.equal(calls.includes('openRuntime'), false);
});

test('candidate rejects a changed active version after inventory is saved', async () => {
  const { store, dependencies } = fixture();
  dependencies.openRuntime = async () => ({
    version: { ...version, syncVersion: 187 },
  } as LargeMasterSyncV3Runtime);
  await assert.rejects(() => prepareLargeMasterSyncV3Candidate(store, 'https://railway.example.test',
    undefined, undefined, dependencies), /SYNC_V3_RUNTIME_VERSION_CHANGED/);
});
