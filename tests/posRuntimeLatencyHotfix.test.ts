import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');

test('the input paints immediately and catalog filtering is debounced independently', () => {
  assert.doesNotMatch(posSource, /useDeferredValue\(searchTerm\)/);
  assert.match(posSource, /setSearchTerm\(value\)/);
  assert.match(posSource, /setCatalogSearchQuery\(searchTerm\)/);
  assert.match(posSource, /}, 175\)/);
  assert.match(posSource, /normalizeSearchToken\(catalogSearchQuery\)/);
  assert.doesNotMatch(posSource, /onInput=\{\(e\) => setSearchTerm/);
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

test('terminal config snapshots are serialized to avoid overlapping heavy applies', () => {
  assert.match(syncSource, /terminalConfigRefreshQueue: Promise<void> = Promise\.resolve\(\)/);
  assert.match(syncSource, /await previousRefresh\.catch\(\(\) => undefined\)/);
  assert.match(syncSource, /finally \{\s*releaseRefresh\(\);\s*\}/);
});

test('startup does not render an unchanged product catalog twice', () => {
  assert.match(appSource, /const startupProducts = Array\.isArray\(data\.products\)/);
  assert.match(appSource, /JSON\.stringify\(dbProducts\) !== JSON\.stringify\(startupProducts\)/);
});

test('ERP startup work waits until the local UI is ready and leaves an operator grace period', () => {
  assert.match(appSource, /if \(!isDataLoaded \|\| setupPending \|\| !erpLifecycleReady/);
  assert.match(appSource, /syncTriggerCoordinator\.request\(\{ reason: 'STARTUP' \}\);\s*\}, 8000\)/);
  assert.match(appSource, /markPosInteractionActivity\(5000\)/);
  assert.match(appSource, /refreshErpStartupSecurity\(finalConfig, \{ deferDuringSale: true \}\)/);
});

test('restaurant login paints the local floor map before remote reconciliation', () => {
  const loginStart = appSource.indexOf('onLogin: async (u: User) =>');
  const tableCase = appSource.indexOf("case 'TABLE_MAP':", loginStart);
  const loginBlock = appSource.slice(loginStart, tableCase);
  assert.ok(loginStart >= 0 && tableCase > loginStart);
  assert.match(loginBlock, /setCurrentView\(salesStartView\)/);
  assert.match(loginBlock, /window\.setTimeout\(\(\) => \{[\s\S]*measureInteractionStage\(trace, 'SYNC_START', 'SYNC_END', fetchTables\)/);
  assert.ok(loginBlock.indexOf('setCurrentView(salesStartView)') < loginBlock.indexOf("'SYNC_START'"));
});

test('PIN validation contains no artificial success or failure delay', () => {
  const modernLogin = readFileSync(new URL('../components/ModernLoginScreen.tsx', import.meta.url), 'utf8');
  const standardLogin = readFileSync(new URL('../components/LoginScreen.tsx', import.meta.url), 'utf8');
  for (const source of [modernLogin, standardLogin]) {
    const checkStart = source.indexOf('const checkLogin');
    const checkEnd = source.indexOf('const handleKeyPress', checkStart);
    const block = source.slice(checkStart, checkEnd);
    assert.doesNotMatch(block, /setTimeout/);
    assert.match(block, /onLogin\(user\)/);
  }
});

test('critical POS interactions expose structured timing markers', () => {
  const perfSource = readFileSync(new URL('../utils/interactionPerformance.ts', import.meta.url), 'utf8');
  for (const marker of [
    'INPUT_RECEIVED', 'HANDLER_START', 'HANDLER_END', 'STATE_UPDATE',
    'RENDER_START', 'RENDER_END', 'SQL_START', 'SQL_END',
    'FILTER_START', 'FILTER_END', 'SYNC_START', 'SYNC_END'
  ]) assert.match(perfSource, new RegExp(marker));
  assert.match(perfSource, /inputLatencyP50Ms/);
  assert.match(perfSource, /inputLatencyP95Ms/);
  assert.match(perfSource, /inputLatencyP99Ms/);
  assert.match(perfSource, /__CLIC_POS_PERFORMANCE__/);
});

test('catalog cards use browser rendering virtualization and lazy image decode', () => {
  assert.match(posSource, /contentVisibility: 'auto'/);
  assert.match(posSource, /loading="lazy" decoding="async"/);
});

test('table state is applied before deferred persistence and reconciliation', () => {
  assert.match(appSource, /writeCriticalCollectionsMirror\(validTickets, cashMovements\);\s*setParkedTickets\(validTickets\)/);
  assert.match(appSource, /const persistMasterTickets = async/);
  assert.match(appSource, /setCurrentView\('TABLE_MAP'\);[\s\S]*window\.setTimeout\(\(\) =>/);
  assert.match(posSource, /handleDispatchCommand\('table_exit', \{ backgroundTableExit: true \}\)/);
  assert.match(posSource, /if \(!options\.backgroundTableExit\) onUpdateCart\(updatedCart\)/);
  assert.ok(
    posSource.indexOf('await Promise.resolve(onOpenTableMap())')
      < posSource.indexOf("handleDispatchCommand('table_exit', { backgroundTableExit: true })"),
  );
});
