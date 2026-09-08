import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/closePreparationSQLite';
import { AutomaticRecovery } from '../services/recovery/AutomaticRecovery';

test('empty SQLite automatically restores once; concurrent discovery and restart do not repeat import', async () => {
  const f = fixture();
  let db = f.open().db, downloads = 0, restores = 0, reloads = 0;
  const operations = {
    context: () => 'terminal-A',
    download: async () => { downloads++; return { totalRecords: 8 }; },
    restore: async () => { restores++; return 5; },
    published: () => { reloads++; },
  };
  try {
    const flow = new AutomaticRecovery(db, operations);
    const phases: string[] = [];
    flow.subscribe(() => phases.push(flow.getSnapshot().phase));
    await Promise.all([flow.start(), flow.start()]);
    assert.deepEqual(phases, ['downloading', 'restoring', 'ready']);
    db = f.restart().db;
    await new AutomaticRecovery(db, operations).start();
    assert.deepEqual([downloads, restores, reloads], [1, 1, 1]);
  } finally { f.close(); }
});

test('APK update with existing sales or closed history never starts an automatic download', async () => {
  for (const collection of ['transactions', 'transactionHistory', 'cashMovements', 'collections', 'wallet_transactions', 'zReports']) {
    const f = fixture(), db = f.open().db;
    try {
      await db.saveDocument(collection, { id: 'existing', terminalId: 'T1', total: 10 });
      const flow = new AutomaticRecovery(db, {
        context: () => 'terminal-A', download: async () => { throw Error('must not download'); },
        restore: async () => { throw Error('must not restore'); }, published: () => assert.fail('reload'),
      });
      await flow.start();
      assert.equal(flow.getSnapshot().phase, 'idle');
      assert.equal((await db.getCollection(collection)).length, 1);
    } finally { f.close(); }
  }
});

test('failed download resumes after process restart, and rejects a changed terminal before import', async () => {
  const f = fixture();
  let db = f.open().db, scope = 'terminal-A', fail = true, restored = 0;
  const operations = {
    context: () => scope,
    download: async () => { if (fail) throw Error('NETWORK_UNAVAILABLE'); scope = 'terminal-B'; return { totalRecords: 2 }; },
    restore: async () => { restored++; return 2; }, published: () => assert.fail('reload'),
  };
  try {
    const first = new AutomaticRecovery(db, operations);
    await first.start();
    assert.equal(first.getSnapshot().error, 'NETWORK_UNAVAILABLE');
    db = f.restart().db; fail = false;
    const second = new AutomaticRecovery(db, operations);
    await second.start();
    assert.equal(second.getSnapshot().error, 'RECOVERY_SCOPE_CHANGED');
    assert.equal(restored, 0);
  } finally { f.close(); }
});

test('failure after atomic import remains resumable even with restored local rows', async () => {
  const f = fixture();
  let db = f.open().db, fail = true, reloads = 0;
  try {
    const operations = {
      context: () => 'terminal-A', download: async () => ({ totalRecords: 2 }),
      restore: async () => {
        await db.saveDocument('transactions', { id: 'restored', terminalId: 'T1' });
        if (fail) throw Error('CONTINUITY_UNAVAILABLE');
        return 1;
      }, published: () => { reloads++; },
    };
    const first = new AutomaticRecovery(db, operations);
    await first.start();
    assert.equal(first.getSnapshot().phase, 'error');
    db = f.restart().db; fail = false;
    await new AutomaticRecovery(db, operations).start();
    assert.equal(reloads, 1);
    assert.equal((await db.getCollection('transactions')).length, 1);
  } finally { f.close(); }
});

test('new terminal with no remote originals completes without import or reload', async () => {
  const f = fixture(), db = f.open().db;
  try {
    const flow = new AutomaticRecovery(db, {
      context: () => 'terminal-A', download: async () => ({ totalRecords: 0 }),
      restore: async () => { throw Error('unexpected import'); }, published: () => assert.fail('reload'),
    });
    await flow.start();
    assert.equal(flow.getSnapshot().phase, 'idle');
  } finally { f.close(); }
});
