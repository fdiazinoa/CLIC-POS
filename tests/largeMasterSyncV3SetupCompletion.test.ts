import assert from 'node:assert/strict';
import test from 'node:test';
import { completeLargeMasterSyncV3Setup, createLargeMasterSyncV3SessionCoordinator } from '../services/sync/LargeMasterSyncV3SetupCompletion';
import { prepareLargeMasterSyncV3Candidate } from '../services/sync/LargeMasterSyncV3Candidate';
import type { BusinessConfig } from '../types';
import type { LargeMasterSyncV3Store } from '../services/sync/LargeMasterSyncV3Types';
import type { LargeMasterSyncV3Runtime } from '../services/sync/LargeMasterSyncV3Runtime';

const version = { syncId: '00000000-0000-4000-8000-000000000001', syncVersion: 7, contractVersion: 2 };
const config = { metadata: { syncToken: 'preserved-token' }, fiscalRanges: [{ id: 'fiscal' }],
  warehouses: [{ id: 'warehouse' }], rooms: [{ id: 'room' }] } as unknown as BusinessConfig;

const fixture = (failure?: string) => {
  const calls: string[] = [];
  const boundary = (name: string) => {
    calls.push(name);
    if (failure === name) throw new Error(`${name} failed`);
  };
  const inventory = { version: 9, cursor: 'inventory-9', balances: [] };
  let owner = '';
  const store = {
    findIncomplete: async () => { boundary('staging'); return null; },
    replaceInventorySnapshot: async () => { boundary('persistInventory'); },
    getInventorySnapshotVersion: async () => { boundary('readInventory'); return inventory; },
  } as unknown as LargeMasterSyncV3Store;
  const dependencies: NonNullable<Parameters<typeof prepareLargeMasterSyncV3Candidate>[4]> = {
    enabled: true, assertPlatform: () => undefined,
    createClient: () => ({
      requestSync: async () => { boundary('requestSync'); return { ...version, schemaVersion: 3,
        status: 'READY', manifestUrl: '/manifest' }; },
      resumeSync: async () => { boundary('manifestChunksActivate'); return version; },
    }),
    fetchInventory: async () => { boundary('inventoryRailway'); return inventory; },
    waitForOperationalWindow: async () => { boundary('operationalWindow'); return 0; },
    openRuntime: async () => { boundary('runtime'); return { version } as LargeMasterSyncV3Runtime; },
  };
  const getSession = createLargeMasterSyncV3SessionCoordinator(async refresh => {
    if (refresh) boundary('explicitRefresh');
    const ready = await prepareLargeMasterSyncV3Candidate(store, 'https://railway.example.test',
      undefined, undefined, dependencies);
    boundary('owner'); owner = 'binding';
    return {
      assertCurrent: async () => { boundary('assertCurrent'); assert.equal(owner, 'binding');
        assert.equal(ready.inventoryVersion, 9); assert.equal(ready.inventoryCursor, 'inventory-9'); },
      projectConfig: async (original: BusinessConfig) => { boundary('projectConfig');
        return { ...original, taxes: [], tariffs: [] }; },
    };
  });
  return { calls, getSession, persist: async () => { boundary('persistProjection'); } };
};

test('catalog/inventory persistence and owner verification finish before setup can complete', async () => {
  const f = fixture();
  let finish = 0;
  const result = await completeLargeMasterSyncV3Setup(config, f.getSession, f.persist);
  finish++;
  assert.equal(finish, 1);
  assert.equal(result.metadata?.syncToken, config.metadata?.syncToken);
  assert.equal((result as any).rooms, (config as any).rooms);
  assert.deepEqual(f.calls.filter(name => name !== 'assertCurrent'), ['operationalWindow', 'requestSync', 'staging',
    'manifestChunksActivate', 'inventoryRailway', 'operationalWindow', 'persistInventory',
    'readInventory', 'runtime', 'owner', 'projectConfig', 'persistProjection']);
});

test('failure at every readiness boundary keeps finish/LOGIN at zero', async () => {
  for (const failure of ['requestSync', 'staging', 'manifestChunksActivate', 'inventoryRailway',
    'operationalWindow', 'persistInventory', 'readInventory', 'runtime', 'owner',
    'assertCurrent', 'projectConfig', 'persistProjection']) {
    const f = fixture(failure);
    let finish = 0;
    await assert.rejects(async () => {
      await completeLargeMasterSyncV3Setup(config, f.getSession, f.persist);
      finish++;
    }, new RegExp(`${failure} failed`));
    assert.equal(finish, 0, failure);
  }
});

test('pairing/startup concurrent callers share one preparation; explicit refresh still requests new data', async () => {
  const f = fixture();
  const sessions = await Promise.all([f.getSession(), f.getSession(), f.getSession()]);
  assert.equal(sessions[0], sessions[1]);
  assert.equal(f.calls.filter(name => name === 'requestSync').length, 1);
  await f.getSession();
  assert.equal(f.calls.filter(name => name === 'requestSync').length, 1);
  await Promise.all([f.getSession(true), f.getSession(true), f.getSession()]);
  assert.equal(f.calls.filter(name => name === 'requestSync').length, 2);
});

test('cache never returns a stale session on changed binding/token/runtime/inventory/owner', async () => {
  let current = true;
  let preparations = 0;
  const get = createLargeMasterSyncV3SessionCoordinator(async () => {
    preparations++;
    return { assertCurrent: async () => { if (!current) throw new Error('binding/runtime changed'); },
      projectConfig: async (value: BusinessConfig) => value };
  });
  await get();
  current = false;
  await assert.rejects(get(), /changed/);
  assert.equal(preparations, 1);
  current = true;
  await get();
  assert.equal(preparations, 2);
});
