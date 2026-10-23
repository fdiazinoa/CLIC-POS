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
        return { ...original, taxes: [], tariffs: [], taxRate: 0 }; },
      assertSetupIdentity: () => { boundary('assertSetupIdentity'); },
    };
  });
  return { calls, getSession, persist: async (_expected: BusinessConfig, _projected: BusinessConfig, guard: () => void) => { guard(); boundary('persistProjection'); } };
};

test('catalog/inventory persistence and owner verification finish before setup can complete', async () => {
  const f = fixture();
  let finish = 0;
  const result = await completeLargeMasterSyncV3Setup(async () => config, f.getSession, f.persist);
  finish++;
  assert.equal(finish, 1);
  assert.equal(result.metadata?.syncToken, config.metadata?.syncToken);
  assert.equal((result as any).rooms, (config as any).rooms);
  assert.deepEqual(f.calls.filter(name => name !== 'assertCurrent'), ['operationalWindow', 'requestSync', 'staging',
    'manifestChunksActivate', 'inventoryRailway', 'operationalWindow', 'persistInventory',
    'readInventory', 'runtime', 'owner', 'projectConfig', 'assertSetupIdentity', 'persistProjection']);
});

test('failure at every readiness boundary keeps finish/LOGIN at zero', async () => {
  for (const failure of ['requestSync', 'staging', 'manifestChunksActivate', 'inventoryRailway',
    'operationalWindow', 'persistInventory', 'readInventory', 'runtime', 'owner',
    'assertCurrent', 'projectConfig', 'assertSetupIdentity', 'persistProjection']) {
    const f = fixture(failure);
    let finish = 0;
    await assert.rejects(async () => {
      await completeLargeMasterSyncV3Setup(async () => config, f.getSession, f.persist);
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


test('refresh recovers only durable runtime change and shares the retry flight', async () => {
  let runtime = 1; const opens: boolean[] = [];
  const get = createLargeMasterSyncV3SessionCoordinator(async refresh => {
    opens.push(refresh); const version = runtime;
    return { assertCurrent: async () => {
      if (version !== runtime) throw Object.assign(new Error('runtime'), {code:'SYNC_V3_RUNTIME_VERSION_CHANGED'});
    }, projectConfig: async (config: BusinessConfig) => config };
  }, () => 'bound-token');
  await get(); runtime = 2;
  await Promise.all([get(true), get(true), get()]);
  assert.deepEqual(opens, [false, false, true]);
});

test('refresh never recovers binding/token errors or changes identity during runtime recovery', async () => {
  for (const mode of ['binding', 'scope']) {
    const opens: boolean[] = []; let stale = false; let scope = 'A';
    const get = createLargeMasterSyncV3SessionCoordinator(async refresh => {
      opens.push(refresh);
      if (opens.length === 2 && mode === 'scope') scope = 'B';
      return { assertCurrent: async () => {
        if (stale && opens.length === 1) throw Object.assign(new Error('stale'), {
          code: mode === 'binding' ? 'SYNC_V3_BINDING_CHANGED' : 'SYNC_V3_RUNTIME_VERSION_CHANGED'});
      }, projectConfig: async (config: BusinessConfig) => config };
    }, () => scope);
    await get(); stale = true;
    await assert.rejects(get(true), /stale/);
    assert.deepEqual(opens, mode === 'binding' ? [false] : [false, false]);
  }
});


test('completion projects canonical lifecycle B rather than the earlier pairing A', async () => {
  const stale = { ...config, companyInfo: { name: 'old' }, permissions: ['old'] } as unknown as BusinessConfig;
  const latest = { ...stale, companyInfo: { name: 'current' }, permissions: ['new'],
    terminals: [{ id: 'terminal', config: { pricing: { version: 2 }, inventoryScope: { warehouseId: 'B' } } }] } as unknown as BusinessConfig;
  let persisted = latest;
  const session = {
    assertCurrent: async () => { assert.deepEqual(persisted.terminals, latest.terminals); },
    assertSetupIdentity: () => undefined,
    projectConfig: async (value: BusinessConfig) => {
      assert.strictEqual(value, latest);
      return { ...value, taxes: [], tariffs: [], taxRate: 0 };
    },
  };
  const result = await completeLargeMasterSyncV3Setup(async () => persisted, async () => session,
    async (expected, next, guard) => { assert.strictEqual(expected, latest); guard(); persisted = next; });
  assert.strictEqual(result, persisted);
  assert.deepEqual(result.terminals, latest.terminals);
  assert.deepEqual(result.companyInfo, latest.companyInfo);
  assert.deepEqual((result as any).permissions, ['new']);
  assert.equal(result.taxRate, 0);
});

test('completion rechecks session after asynchronous projection and never persists changed scope', async () => {
  let current = true, writes = 0;
  await assert.rejects(completeLargeMasterSyncV3Setup(async () => config, async () => ({
    assertCurrent: async () => { if (!current) throw Error('scope-changed'); },
    assertSetupIdentity: () => undefined,
    projectConfig: async value => { current = false; return value; },
  }), async () => { writes++; }), /scope-changed/);
  assert.equal(writes, 0);
});

const contextDeferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const contextSession = (name: string, guard: () => Promise<void> = async () => {}) => ({ name, assertCurrent: guard, projectConfig: async (value: BusinessConfig) => value });

test('published context is a verified shared flight; first financial caller waits and receives B', async () => {
  let current = 'A', opens = 0;
  const a = contextSession('A', async () => { if (current !== 'A') throw Error('stale-A'); });
  const get = createLargeMasterSyncV3SessionCoordinator(async () => { opens++; return a; }, () => 'same-transport');
  await get(); const expected = get.captureConfigContext(); current = 'B';
  const hold = contextDeferred<void>(), entered = contextDeferred<void>(); let checks = 0;
  const b = contextSession('B');
  const publishing = get.publishConfigContext(b, expected, async () => { if (++checks === 1) { entered.resolve(); await hold.promise; } });
  await entered.promise; let delivered = false; const first = get().then(session => { delivered = true; return session; });
  await Promise.resolve(); assert.equal(delivered, false);
  hold.resolve(); await publishing; assert.strictEqual(await first, b); assert.equal(opens, 1);
  await assert.rejects(a.assertCurrent(), /stale-A/);
});

test('older candidate cannot overwrite a newer explicit refresh generation', async () => {
  const refreshing = contextDeferred<ReturnType<typeof contextSession>>(), entered = contextDeferred<void>();
  const a = contextSession('A'), r = contextSession('REFRESH');
  const get = createLargeMasterSyncV3SessionCoordinator(async refresh => { if (refresh) { entered.resolve(); return refreshing.promise; } return a; }, () => 'transport');
  await get(); const before = get.captureConfigContext(); const fresh = get(true); await entered.promise;
  let checks = 0; await assert.rejects(get.publishConfigContext(contextSession('OLD-CANDIDATE'), before, async () => { checks++; }), /UI_CONTEXT_CHANGED/);
  assert.equal(checks, 0); refreshing.resolve(r); assert.strictEqual(await fresh, r); assert.strictEqual(await get(), r);
});

test('older candidate cannot overwrite another context publication', async () => {
  const get = createLargeMasterSyncV3SessionCoordinator(async () => contextSession('A'), () => 'transport');
  await get(); const expected = get.captureConfigContext(), hold = contextDeferred<void>(), entered = contextDeferred<void>(), b = contextSession('B');
  const winner = get.publishConfigContext(b, expected, async () => { entered.resolve(); await hold.promise; });
  await entered.promise; await assert.rejects(get.publishConfigContext(contextSession('STALE'), expected, async () => {}), /UI_CONTEXT_CHANGED/);
  hold.resolve(); await winner; assert.strictEqual(await get(), b);
});

test('refresh racing a reserved publication invalidates the old generation without resurrecting it', async () => {
  let opens = 0; const get = createLargeMasterSyncV3SessionCoordinator(async () => contextSession(`open-${++opens}`), () => 'transport');
  await get(); const expected = get.captureConfigContext(), hold = contextDeferred<void>(), entered = contextDeferred<void>();
  const publication = get.publishConfigContext(contextSession('B'), expected, async () => { entered.resolve(); await hold.promise; });
  const publicationReject = assert.rejects(publication, /UI_CONTEXT_CHANGED/); await entered.promise;
  const refreshReject = assert.rejects(get(true), /UI_CONTEXT_CHANGED/);
  hold.resolve(); await Promise.all([publicationReject, refreshReject]);
  assert.equal((await get()).name, 'open-2', 'no older B publication survived the competing refresh');
});

for (const change of ['transport-scope', 'authority-guard']) test(`publication rechecks ${change} after asynchronous validation`, async () => {
  let scope = 'transport', valid = true, opens = 0;
  const get = createLargeMasterSyncV3SessionCoordinator(async () => contextSession(`fresh-${++opens}`), () => scope);
  await get(); const expected = get.captureConfigContext(); const hold = contextDeferred<void>(), entered = contextDeferred<void>(); let checks = 0;
  const publishing = get.publishConfigContext(contextSession('B'), expected, async () => {
    if (!valid) throw Error('authority-changed');
    if (++checks === 1) { entered.resolve(); await hold.promise; }
    if (!valid) throw Error('authority-changed');
  });
  const rejected = assert.rejects(publishing, /UI_CONTEXT_CHANGED|authority-changed/); await entered.promise;
  if (change === 'transport-scope') scope = 'foreign-token'; else valid = false;
  hold.resolve(); await rejected; assert.equal((await get()).name, 'fresh-2');
});

test('old in-flight A assertion failure cannot clear the already published B flight', async () => {
  const entered = contextDeferred<void>(), hold = contextDeferred<void>(); let waiting = false;
  const a = contextSession('A', async () => { if (waiting) { entered.resolve(); await hold.promise; throw Error('stale-A'); } });
  const get = createLargeMasterSyncV3SessionCoordinator(async () => a, () => 'transport');
  await get(); const expected = get.captureConfigContext(); waiting = true;
  const oldFailure = assert.rejects(get(), /stale-A/); await entered.promise;
  const b = contextSession('B'); await get.publishConfigContext(b, expected, async () => {});
  assert.strictEqual(await get(), b); hold.resolve(); await oldFailure;
  assert.strictEqual(await get(), b, 'old consumer failure must not erase newer B');
});
