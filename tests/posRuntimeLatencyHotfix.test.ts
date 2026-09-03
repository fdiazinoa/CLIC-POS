import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');

test('product filtering consumes the current search value without stale deferred results', () => {
  assert.doesNotMatch(posSource, /useDeferredValue\(searchTerm\)/);
  assert.match(posSource, /normalizeSearchToken\(searchTerm\)/);
  assert.match(posSource, /\[salesCatalogProductEntries, categoryFilter, searchTerm,/);
});

test('startup manifest is owned by the ERP lifecycle without a duplicate boot call', () => {
  const initializeStart = syncSource.indexOf('async initialize(');
  const initializeEnd = syncSource.indexOf('public async fastSyncCoreData', initializeStart);
  const initializeBody = syncSource.slice(initializeStart, initializeEnd);

  assert.ok(initializeStart >= 0 && initializeEnd > initializeStart);
  assert.doesNotMatch(initializeBody, /syncTerminalMastersOnStartup/);
  assert.doesNotMatch(appSource, /syncManager\.syncTerminalMastersOnStartup/);
  assert.match(appSource, /syncLifecycle\(\{ forceManifestRefresh: isStartup, reason \}\)/);
});

test('background config and print retries defer while POS input is active', () => {
  assert.match(syncSource, /deferDuringSale\?: boolean/);
  assert.match(syncSource, /if \(options\?\.deferDuringSale\) \{\s*await waitForPosSaleIdle\(\);/);
  assert.match(syncSource, /syncTerminalManifestInBackground[\s\S]*deferDuringSale: true/);
  assert.match(syncSource, /lastBackgroundTerminalManifestSyncAt < 60_000/);
  assert.match(appSource, /buildTerminalConfigRefreshRequest\(detail\)[\s\S]*deferDuringSale: true/);
  assert.match(appSource, /if \(!isDataLoaded \|\| isPosSaleActive\(\)\) return;/);
  assert.match(appSource, /addEventListener\(POS_SALE_ACTIVITY_EVENT, wakeQueue as EventListener\)/);
});
