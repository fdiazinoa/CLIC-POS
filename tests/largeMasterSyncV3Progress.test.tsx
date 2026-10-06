import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LargeMasterSyncV3SetupProgress from '../components/LargeMasterSyncV3SetupProgress';
import { createV3Progress } from '../services/sync/LargeMasterSyncV3Progress';
import { createLargeMasterSyncV3SessionCoordinator, completeLargeMasterSyncV3Setup } from '../services/sync/LargeMasterSyncV3SetupCompletion';
import type { BusinessConfig } from '../types';

const session = { assertCurrent: async () => undefined, projectConfig: async (config: BusinessConfig) => config };
const html = (progress: ReturnType<typeof createV3Progress>) => renderToStaticMarkup(<LargeMasterSyncV3SetupProgress progress={progress} />);

test('bounded publication retains exact latest count, ignores downloads/retries and fences old generations', () => {
  const progress = createV3Progress();
  const first = progress.begin();
  let notifications = 0;
  const stop = progress.subscribe(() => notifications++);
  const stopThrowing = progress.subscribe(() => { throw new Error('observer only'); });
  notifications = 0;
  for (let count = 0; count <= 10000; count++) first.metric({ event: 'chunk_progress',
    syncId: 's', syncVersion: 1, appliedChunks: count, totalChunks: 10000 });
  assert.equal(notifications, 101);
  first.metric({ event: 'chunk_downloaded', records: 99999 });
  first.metric({ event: 'chunk_retry', retryCount: 10 });
  assert.equal(notifications, 101);
  assert.equal(progress.getLatest().appliedChunks, 10000);
  const second = progress.begin();
  const current = progress.getSnapshot();
  first.metric({ event: 'chunk_progress', appliedChunks: 100, totalChunks: 100 });
  first.fail();
  assert.equal(progress.getSnapshot(), current);
  second.metric({ event: 'chunk_progress', appliedChunks: 990, totalChunks: 10000 });
  second.metric({ event: 'chunk_progress', appliedChunks: 999, totalChunks: 10000 });
  assert.equal(progress.getLatest().appliedChunks, 999);
  stop(); stopThrowing();
  const before = notifications;
  second.phase('inventory_download'); second.fail();
  assert.equal(notifications, before);
  second.close();
  second.phase('ready');
  assert.equal(progress.getSnapshot().failed, true);
});

test('real coordinator/component show catalog100 then indeterminate inventory failure; observers add no preparation', async () => {
  let preparations = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const get = createLargeMasterSyncV3SessionCoordinator(async (_refresh, metric) => {
    preparations++;
    metric?.({ event: 'chunk_progress', syncId: 's', syncVersion: 2, appliedChunks: 3, totalChunks: 10 });
    await pending;
    metric?.({ event: 'chunk_progress', syncId: 's', syncVersion: 2, appliedChunks: 10, totalChunks: 10 });
    assert.match(html(get.progress), /10 de 10 bloques \(100%\)/);
    metric?.({ event: 'setup_phase', phase: 'inventory_save' });
    throw new Error('inventory persistence failed');
  });
  let observed = 0;
  const stop = get.progress.subscribe(() => { observed++; });
  const first = get(); const second = get();
  await Promise.resolve();
  const late = get.progress.getSnapshot();
  assert.equal(late.percent, 30);
  assert.match(html(get.progress), /role="progressbar"/);
  assert.match(html(get.progress), /3 de 10 bloques \(30%\)/);
  release();
  await assert.rejects(first, /inventory/); await assert.rejects(second, /inventory/);
  assert.equal(preparations, 1);
  const failed = html(get.progress);
  assert.match(failed, /Error: Guardando inventario/);
  assert.doesNotMatch(failed, /aria-valuenow|animate-pulse|Terminal lista/);
  stop(); const before = observed;
  get.progress.begin().phase('config');
  assert.equal(observed, before);
});

test('unknown denominator is indeterminate and cached verification does not simulate downloading', async () => {
  const progress = createV3Progress();
  progress.begin().metric({ event: 'chunk_progress', appliedChunks: 0, totalChunks: 0 });
  assert.doesNotMatch(html(progress), /NaN|aria-valuenow/);
  let opens = 0;
  const get = createLargeMasterSyncV3SessionCoordinator(async () => { opens++; return session; });
  await get(); await get();
  assert.equal(opens, 1);
  assert.match(html(get.progress), /Catálogo existente verificado/);
  assert.doesNotMatch(html(get.progress), /aria-valuenow/);
  await Promise.all([get(true), get(true)]);
  assert.equal(opens, 2);
});

test('reentrant observer and thrown observer do not duplicate preparation or fail setup', async () => {
  let opens = 0;
  let reentered = false;
  const get = createLargeMasterSyncV3SessionCoordinator(async (_refresh, metric) => {
    opens++; await Promise.resolve(); metric?.({ event: 'setup_phase', phase: 'inventory_download' }); return session;
  });
  const tasks: Promise<unknown>[] = [];
  const stop = get.progress.subscribe(() => {
    if (!reentered && get.progress.getSnapshot().phase === 'inventory_download') { reentered = true; tasks.push(get()); }
    throw new Error('observer failure');
  });
  await get(); await Promise.all(tasks); stop();
  assert.equal(opens, 1);
});

test('binding replacement fences old callbacks without starting a new prep; current failure remains visible', async () => {
  let binding = 'a';
  let release!: () => void;
  let emit!: NonNullable<Parameters<Parameters<typeof createLargeMasterSyncV3SessionCoordinator>[0]>[1]>;
  let opens = 0;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const get = createLargeMasterSyncV3SessionCoordinator(async (_refresh, metric) => {
    opens++; emit = metric!; await wait;
    return { ...session, assertCurrent: async () => { if (binding !== 'a') throw new Error('binding changed'); } };
  }, () => binding);
  const first = get(); await Promise.resolve();
  emit({ event: 'chunk_progress', syncId: 's', syncVersion: 1, appliedChunks: 3, totalChunks: 10 });
  assert.equal(get.progress.getSnapshot().percent, 30);
  emit({ event: 'chunk_progress', syncId: 'foreign', syncVersion: 1, appliedChunks: 10, totalChunks: 10 });
  assert.equal(get.progress.getSnapshot().percent, 30);
  binding = 'b'; const second = get();
  emit({ event: 'chunk_progress', syncId: 's', syncVersion: 1, appliedChunks: 10, totalChunks: 10 });
  assert.equal(get.progress.getSnapshot().percent, undefined);
  release(); await assert.rejects(first, /binding/); await assert.rejects(second, /binding/);
  assert.equal(opens, 1); assert.equal(get.progress.getSnapshot().failed, true);
});

test('reentrant subscription and late replay share the reserved preparation', async () => {
  let opens = 0; let entered = false; let nested: Promise<unknown> | undefined;
  const get = createLargeMasterSyncV3SessionCoordinator(async () => { opens++; return session; });
  const stop = get.progress.subscribe(() => { if (!entered) { entered = true; nested = get(); } });
  await get(); await nested;
  let replay = '';
  const stopLate = get.progress.subscribe(() => { replay = get.progress.getSnapshot().phase; });
  assert.equal(replay, 'verified'); assert.equal(opens, 1);
  stop(); stopLate();
});

test('cached explicit refresh reports its own verified/failure generation for concurrent callers', async () => {
  for (const rejectCurrent of [false, true]) {
    let opens = 0; let checks = 0;
    const get = createLargeMasterSyncV3SessionCoordinator(async (refresh, metric) => {
      opens++;
      metric?.({ event: 'chunk_progress', syncId: refresh ? 'refreshed' : 'cached', syncVersion: opens,
        appliedChunks: 10, totalChunks: 10 });
      return { ...session, assertCurrent: async () => { checks++;
        if (refresh && rejectCurrent) throw new Error('refreshed assertCurrent failed');
      } };
    });
    await get();
    assert.equal(get.progress.getLatest().phase, 'verified');
    const outcomes = await Promise.allSettled([get(true), get(true), get()]);
    assert.equal(opens, 2, 'refresh and ordinary callers share exactly one new preparation');
    assert.equal(checks, 5, 'cached verification plus the same existing per-caller assertions');
    const latest = get.progress.getLatest();
    assert.equal(latest.syncId, 'refreshed');
    if (rejectCurrent) {
      assert.ok(outcomes.every(row => row.status === 'rejected'));
      assert.equal(latest.failed, true);
      assert.equal(latest.phase, 'owner');
      assert.doesNotMatch(html(get.progress), /Terminal lista|animate-pulse/);
    } else {
      assert.ok(outcomes.every(row => row.status === 'fulfilled'));
      assert.equal(latest.failed, undefined);
      assert.equal(latest.phase, 'verified');
      assert.match(html(get.progress), /Catálogo existente verificado/);
    }
  }
});

test('config/current failures never finish and preserve prior roster/role references', async () => {
  const users = [{ id: 'fixture' }]; const roles = [{ id: 'role' }];
  const config = { users, roles } as unknown as BusinessConfig;
  for (const failure of ['owner', 'config', 'persist']) {
    let finish = 0;
    const get = createLargeMasterSyncV3SessionCoordinator(async (_refresh, metric) => {
      metric?.({ event: 'setup_phase', phase: 'owner' });
      if (failure === 'owner') throw new Error('owner');
      return { ...session, projectConfig: async (value: BusinessConfig) => {
        if (failure === 'config') throw new Error('config'); return value;
      } };
    });
    await assert.rejects(async () => { await completeLargeMasterSyncV3Setup(config, get, async () => {
      if (failure === 'persist') throw new Error('persist');
    }); finish++; });
    assert.equal(finish, 0);
    assert.equal((config as any).users, users); assert.equal((config as any).roles, roles);
  }
});
