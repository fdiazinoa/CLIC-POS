import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL } from '../services/db/LargeMasterSyncV3Schema';
import { LargeMasterSyncV3SqliteStore } from '../services/db/LargeMasterSyncV3SqliteStore';
import { resetLargeMasterSyncV3OperationGateForTests, runWithLargeMasterSyncV3CriticalOperation,
  waitForLargeMasterSyncV3OperationalWindow } from '../services/sync/LargeMasterSyncV3OperationGate';
import { setPosSaleActivity } from '../utils/posSaleActivity';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const runtime = { syncId: 'S', syncVersion: 2, contractVersion: 2 };
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
  sql.exec(`INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at)
    VALUES('S',2,3,2,'ACTIVE','{}','now','now'),('N',3,3,2,'VALIDATED','{}','now','now'),('OLD',1,3,2,'ROLLED_BACK','{}','now','now');
    UPDATE master_v3_state SET active_sync_id='S',active_version=2,staging_sync_id='N',staging_version=3,previous_sync_id='OLD',previous_version=1 WHERE singleton=1;
    INSERT INTO master_v3_operational_owner VALUES(1,'S',2,'binding');
    INSERT INTO master_v3_inventory_state VALUES(1,'S',2,4,'C','now');`);
  const bridge = {
    query: async (query: string, values: any[] = []) => ({ values: sql.prepare(query).all(...values) }),
    execute: async (query: string) => { sql.exec(query); },
    run: async (query: string, values: any[] = []) => { sql.prepare(query).run(...values); },
  };
  const store = new LargeMasterSyncV3SqliteStore(() => bridge, async operation => operation());
  return { sql, bridge, store };
}
const operations = {
  activation: (store: LargeMasterSyncV3SqliteStore) => store.activate('N'),
  rollback: (store: LargeMasterSyncV3SqliteStore) => store.rollback(),
  inventory: (store: LargeMasterSyncV3SqliteStore) => store.replaceInventorySnapshot(runtime, { version: 5, cursor: 'new', balances: [] }),
  owner: (store: LargeMasterSyncV3SqliteStore) => store.setOperationalOwner(runtime, 'other'),
};
for (const [name, operation] of Object.entries(operations)) {
  for (const phase of ['write', 'commit'] as const) {
    test(`${name} reserves the window during awaited native ${phase} and rejects PAYMENT before its provider`, async () => {
      const f = fixture();
      const entered = deferred();
      const resume = deferred();
      let paused = false;
      const baseRun = f.bridge.run;
      const baseExecute = f.bridge.execute;
      f.bridge.run = async (query, values = []) => {
        await baseRun(query, values);
        if (phase === 'write' && !paused) { paused = true; entered.resolve(); await resume.promise; }
      };
      f.bridge.execute = async query => {
        if (phase === 'commit' && query === 'COMMIT;') { entered.resolve(); await resume.promise; }
        await baseExecute(query);
      };
      let pending: Promise<unknown> | undefined;
      try {
        pending = operation(f.store);
        await entered.promise;
        let providers = 0;
        await assert.rejects(runWithLargeMasterSyncV3CriticalOperation('PAYMENT', async () => { ++providers; }), /OPERATIONAL_WINDOW_HELD/);
        assert.equal(providers, 0);
        await assert.rejects(f.store.setOperationalOwner(runtime, 'conflicting'), /OPERATIONAL_WINDOW_HELD/);
        let idle = false;
        const wait = waitForLargeMasterSyncV3OperationalWindow().then(() => { idle = true; });
        await Promise.resolve();
        assert.equal(idle, false);
        resume.resolve();
        await pending;
        await wait;
        await runWithLargeMasterSyncV3CriticalOperation('PAYMENT', async () => { ++providers; });
        assert.equal(providers, 1);
        if (name === 'owner') assert.equal((await f.store.getOperationalOwner())?.binding, 'other');
      } finally {
        resume.resolve();
        await pending?.catch(() => undefined);
        resetLargeMasterSyncV3OperationGateForTests();
        f.sql.close();
      }
    });
  }
  test(`${name} rolls back if a cart becomes active during native writes and releases its reservation`, async () => {
    const f = fixture();
    const baseRun = f.bridge.run;
    let injected = false;
    f.bridge.run = async (query, values = []) => {
      await baseRun(query, values);
      if (!injected) { injected = true; setPosSaleActivity({ active: true, cartCount: 1 }); }
    };
    try {
      await assert.rejects(operation(f.store), /OPERATIONAL_WINDOW_HELD/);
      assert.equal((f.sql.prepare('SELECT active_sync_id FROM master_v3_state').get() as any).active_sync_id, 'S');
      assert.equal((await f.store.getOperationalOwner())?.binding, 'binding');
      assert.equal((f.sql.prepare('SELECT cursor FROM master_v3_inventory_state').get() as any).cursor, 'C');
      setPosSaleActivity({ active: false });
      f.bridge.run = baseRun;
      await operation(f.store);
      await runWithLargeMasterSyncV3CriticalOperation('PAYMENT', async () => undefined);
    } finally { setPosSaleActivity({ active: false }); resetLargeMasterSyncV3OperationGateForTests(); f.sql.close(); }
  });
}
test('failed owner COMMIT retains exclusion through awaited ROLLBACK, then releases the native transaction and window', async () => {
  const f = fixture();
  const entered = deferred();
  const resume = deferred();
  const baseExecute = f.bridge.execute;
  f.bridge.execute = async query => {
    if (query === 'COMMIT;') throw new Error('injected commit failure');
    if (query === 'ROLLBACK;') { entered.resolve(); await resume.promise; }
    await baseExecute(query);
  };
  const pending = f.store.setOperationalOwner(runtime, 'other');
  const rejection = assert.rejects(pending, /injected commit failure/);
  try {
    await entered.promise;
    await assert.rejects(runWithLargeMasterSyncV3CriticalOperation('PAYMENT', async () => assert.fail('provider entered')), /OPERATIONAL_WINDOW_HELD/);
    resume.resolve();
    await rejection;
    assert.equal((await f.store.getOperationalOwner())?.binding, 'binding');
    f.bridge.execute = baseExecute;
    await f.store.setOperationalOwner(runtime, 'recovered');
    await runWithLargeMasterSyncV3CriticalOperation('PAYMENT', async () => undefined);
  } finally { resume.resolve(); await rejection; resetLargeMasterSyncV3OperationGateForTests(); f.sql.close(); }
});
