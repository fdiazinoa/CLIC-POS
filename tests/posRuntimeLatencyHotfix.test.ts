import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');

test('product filtering consumes the deferred search value', () => {
  assert.match(posSource, /const deferredSearchTerm = useDeferredValue\(searchTerm\)/);
  assert.match(posSource, /normalizeSearchToken\(deferredSearchTerm\)/);
  assert.match(posSource, /\[salesCatalogProductEntries, categoryFilter, deferredSearchTerm,/);
});

test('startup performs one deferred manifest reconciliation after security bootstrap', () => {
  const initializeStart = syncSource.indexOf('async initialize(');
  const initializeEnd = syncSource.indexOf('public async fastSyncCoreData', initializeStart);
  const initializeBody = syncSource.slice(initializeStart, initializeEnd);

  assert.ok(initializeStart >= 0 && initializeEnd > initializeStart);
  assert.doesNotMatch(initializeBody, /syncTerminalMastersOnStartup/);
  assert.match(appSource, /syncManager\.syncTerminalMastersOnStartup\(finalConfig\)/);
});

test('background config and print retries defer while POS input is active', () => {
  assert.match(syncSource, /deferDuringSale\?: boolean/);
  assert.match(syncSource, /if \(options\?\.deferDuringSale\) \{\s*await waitForPosSaleIdle\(\);/);
  assert.match(appSource, /buildTerminalConfigRefreshRequest\(detail\)[\s\S]*deferDuringSale: true/);
  assert.match(appSource, /if \(!isDataLoaded \|\| isPosSaleActive\(\)\) return;/);
  assert.match(appSource, /addEventListener\(POS_SALE_ACTIVITY_EVENT, wakeQueue as EventListener\)/);
});
