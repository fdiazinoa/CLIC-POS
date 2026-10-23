import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeFixture } from './articleFormatsNativeFixture';
import { completeLargeMasterSyncV3Setup } from '../services/sync/LargeMasterSyncV3SetupCompletion';
import type { BusinessConfig } from '../types';

const read = async (f: Awaited<ReturnType<typeof nativeFixture>>) =>
  await f.adapter.getCollection('config') as unknown as BusinessConfig;
const project = (current: BusinessConfig): BusinessConfig => ({ ...current,
  taxes: [{ id: 'vat', name: 'VAT', rate: .18, active: true, type: 'VAT' }],
  tariffs: [{ id: 'public', name: 'Public', taxIncluded: true }] as BusinessConfig['tariffs'], taxRate: 0 });
const bounded = <T>(work: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error('writer-deadlock')), 2000);
  work.then(resolve, reject).finally(() => clearTimeout(timer));
});

test('native completion preserves lifecycle config and all financial/runtime rows without reentrant deadlock', async () => {
  const f = await nativeFixture();
  try {
    const current = await read(f);
    const latest = { ...current, permissionVersion: 2, metadata: { syncToken: 'synthetic' } };
    await f.adapter.saveCollection('config', latest as any);
    const before = f.state();
    const result = await bounded(completeLargeMasterSyncV3Setup(() => read(f), async () => ({
      assertCurrent: async () => { assert.deepEqual((await read(f)).terminals, latest.terminals); },
      assertSetupIdentity: () => undefined,
      projectConfig: async value => { await f.adapter.masterSyncV3Store.getActiveRuntimeVersion(); return project(value); },
    }), (expected, next, guard) => f.adapter.compareAndSwapV3SetupConfig(expected, next, guard)));
    assert.deepEqual(result, await read(f));
    assert.equal((result as any).permissionVersion, 2);
    assert.equal(result.taxRate, 0);
    const after = f.state();
    assert.deepEqual(after.documents.filter((r: any) => r.collection_name !== 'config'),
      before.documents.filter((r: any) => r.collection_name !== 'config'));
    for (const key of Object.keys(before).filter(key => key !== 'documents')) assert.deepEqual(after[key], before[key]);
  } finally { f.db.close(); }
});

test('queued concurrent C invalidates expected B and is never overwritten', async () => {
  const f = await nativeFixture();
  try {
    const expected = await read(f);
    const concurrent = { ...expected, merchantName: 'Concurrent C' };
    const saved = f.adapter.saveCollection('config', concurrent as any);
    const commit = f.adapter.compareAndSwapV3SetupConfig(expected, project(expected), () => { throw Error('guard-must-not-run'); });
    await saved;
    await assert.rejects(bounded(commit), /SYNC_V3_BINDING_CHANGED/);
    assert.deepEqual(await read(f), concurrent);
  } finally { f.db.close(); }
});

test('CAS rejects unrelated additions, deletions, nested scopes and invalid taxRate before writes', async () => {
  const f = await nativeFixture();
  try {
    const expected = await read(f), original = f.state();
    const deleted = project(expected); delete (deleted as any).terminals;
    for (const next of [ { ...project(expected), merchantName: 'unapproved' }, deleted,
      { ...project(expected), terminals: [] }, { ...project(expected), taxRate: .18 },
      { ...project(expected), taxes: null } ]) {
      await assert.rejects(f.adapter.compareAndSwapV3SetupConfig(expected, next as any, () => undefined), /SYNC_V3_SETUP_PROJECTION_INVALID/);
      assert.deepEqual(f.state(), original);
    }
  } finally { f.db.close(); }
});

test('local identity failure, read/write/commit errors roll back exactly; queue remains usable', async () => {
  for (const mode of ['identity', 'read', 'write', 'commit']) {
    const f = await nativeFixture();
    try {
      const expected = await read(f), before = f.state();
      if (mode === 'read') f.fault.failQuery = f.fault.queries;
      if (mode === 'write') f.fault.failWrite = f.fault.writes + 1;
      if (mode === 'commit') f.fault.failBeforeCommit = true;
      await assert.rejects(bounded(f.adapter.compareAndSwapV3SetupConfig(expected, project(expected), () => {
        if (mode === 'identity') throw Error('binding-token-device-company-origin-changed');
      })), /injected|changed/);
      assert.deepEqual(f.state(), before, mode);
      assert.equal(f.db.inTransaction, false);
      f.fault.failBeforeCommit = false;
      assert.deepEqual(await bounded(read(f)), expected);
    } finally { f.db.close(); }
  }
});

test('config selection and compacted legacy snapshots use the same canonical decoder', async () => {
  const f = await nativeFixture();
  try {
    const expected = await read(f);
    const put = (id: string, value: any) => f.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)')
      .run('config', id, JSON.stringify({ ...value, id }), 0, 'fixture');
    put('_db_initialized', { marker: true }); put('config_metadata', { marker: true });
    put('legacy', { ...expected, merchantName: 'wrong selection' });
    const raw = { ...expected, terminalSnapshots: { terminal: { masters: { items: [
      { id: 'article', _catalog_hash: 'hash', name: 'large old snapshot' },
    ] } } } };
    put('current', raw);
    const current = await read(f);
    assert.equal((current as any).id, 'current');
    assert.deepEqual((current as any).terminalSnapshots.terminal.masters.items, [{ id: 'article', _catalog_hash: 'hash' }]);
    await f.adapter.compareAndSwapV3SetupConfig(current, project(current), () => undefined);
    assert.deepEqual(await read(f), project(current));
    f.db.prepare("DELETE FROM documents WHERE collection_name='config'").run();
    put('legacy', expected);
    const legacy = await read(f);
    await f.adapter.compareAndSwapV3SetupConfig(legacy, project(legacy), () => undefined);
    assert.deepEqual(await read(f), project(legacy));
    f.db.prepare("DELETE FROM documents WHERE collection_name='config'").run();
    put('config_metadata', { marker: true });
    await assert.rejects(f.adapter.compareAndSwapV3SetupConfig({} as BusinessConfig, project({} as BusinessConfig), () => undefined), /SYNC_V3_BINDING_CHANGED/);
  } finally { f.db.close(); }
});

test('queued CAS snapshots cannot be modified while waiting for its writer lane', async () => {
  const f = await nativeFixture();
  try {
    const expected = await read(f), next = project(expected), original = structuredClone(next);
    const work = f.adapter.compareAndSwapV3SetupConfig(expected, next, () => undefined);
    next.terminals = []; expected.terminals = [];
    await work;
    assert.deepEqual(await read(f), original);
  } finally { f.db.close(); }
});

test('lost native commit response reports uncertainty without compensating or duplicating config', async () => {
  const f = await nativeFixture();
  try {
    const expected = await read(f), next = project(expected);
    f.fault.loseCommitResponse = true;
    await assert.rejects(bounded(f.adapter.compareAndSwapV3SetupConfig(expected, next, () => undefined)), /NATIVE_FINANCIAL_COMMIT_UNCERTAIN/);
    assert.equal(f.db.inTransaction, false);
    assert.deepEqual(await read(f), next);
    assert.equal(f.documents('config').length, 1);
    f.fault.loseCommitResponse = false;
    await assert.rejects(f.adapter.compareAndSwapV3SetupConfig(expected, next, () => undefined), /SYNC_V3_BINDING_CHANGED/);
    assert.deepEqual(await read(f), next);
  } finally { f.db.close(); }
});
