import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
const apiSyncSource = readFileSync(new URL('../services/sync/ApiSyncAdapter.ts', import.meta.url), 'utf8');
const backgroundSyncSource = readFileSync(new URL('../services/sync/BackgroundSyncManager.ts', import.meta.url), 'utf8');
const syncSettingsSource = readFileSync(new URL('../components/SyncSettings.tsx', import.meta.url), 'utf8');

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

test('background queues yield cooperatively between operational jobs', () => {
  const printQueueSource = readFileSync(new URL('../services/printer/OfflinePrintQueueService.ts', import.meta.url), 'utf8');
  assert.match(backgroundSyncSource, /yieldToOperatorUi\(\): Promise<void>/);
  assert.match(backgroundSyncSource, /await this\.yieldToOperatorUi\(\)/);
  assert.match(printQueueSource, /if \(isPosSaleActive\(\)\) break/);
  assert.match(printQueueSource, /await yieldToOperatorUi\(\)/);
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

test('background fetch diagnostics do not rescan terminal credentials', () => {
  const fetchStart = apiSyncSource.indexOf('private async fetchWithRetry(');
  const fetchEnd = apiSyncSource.indexOf('private async fetchWithoutCircuitBreaker(', fetchStart);
  const fetchBody = apiSyncSource.slice(fetchStart, fetchEnd);
  const tokenDiagnosticStart = apiSyncSource.indexOf('private resolveStoredErpSyncTokenDiagnostic()');
  const tokenDiagnosticEnd = apiSyncSource.indexOf('private persistErpSyncToken(', tokenDiagnosticStart);
  const tokenDiagnosticBody = apiSyncSource.slice(tokenDiagnosticStart, tokenDiagnosticEnd);

  assert.ok(fetchStart >= 0 && fetchEnd > fetchStart);
  assert.doesNotMatch(fetchBody, /resolveStoredErpSyncTokenDiagnostic\(\)/);
  assert.match(fetchBody, /length: headersSummary\.tokenLength \|\| 0/);
  assert.match(fetchBody, /REQUEST_X_SYNC_TOKEN/);
  assert.match(fetchBody, /REQUEST_AUTHORIZATION/);
  assert.match(tokenDiagnosticBody, /storedCredentials\.syncToken/);
  assert.doesNotMatch(tokenDiagnosticBody, /resolvePersistedTerminalSyncToken\(\)/);
});

test('interaction telemetry stays outside the critical UI path and preserves first response', () => {
  const perfSource = readFileSync(new URL('../utils/interactionPerformance.ts', import.meta.url), 'utf8');
  assert.match(perfSource, /requestIdleCallback\(flushEmissions, \{ timeout: 2000 \}\)/);
  assert.match(perfSource, /setTimeout\(flushEmissions, 500\)/);
  assert.match(perfSource, /if \(trace\.stages\[stage\] !== undefined\) return;/);
  assert.match(perfSource, /if \(trace\.renderTarget\) return;/);
  assert.doesNotMatch(perfSource, /const emit = \(trace:[\s\S]{0,160}console\.info/);
});

test('catalog cards use browser rendering virtualization and lazy image decode', () => {
  assert.match(posSource, /contentVisibility: 'auto'/);
  assert.match(posSource, /loading="lazy" decoding="async"/);
});

test('table state is applied before deferred persistence and reconciliation', () => {
  assert.match(appSource, /if \(!changedTicketId\) writeCriticalCollectionsMirror\(validTickets, cashMovements\);\s*setParkedTickets\(validTickets\)/);
  assert.match(appSource, /const persistMasterTickets = async/);
  assert.match(appSource, /setCurrentView\('TABLE_MAP'\);[\s\S]*window\.setTimeout\(\(\) =>/);
  assert.match(posSource, /handleDispatchCommand\('table_exit', \{ backgroundTableExit: true \}\)/);
  assert.match(posSource, /if \(!options\.backgroundTableExit\) onUpdateCart\(updatedCart\)/);
  assert.ok(
    posSource.indexOf('await Promise.resolve(onOpenTableMap())')
      < posSource.indexOf("handleDispatchCommand('table_exit', { backgroundTableExit: true })"),
  );
});

test('active table autosave persists one ticket and sends only that table snapshot', () => {
  assert.match(posSource, /changedTicketId: orderId/);
  assert.match(appSource, /db\.saveDocument\('parkedTickets', changedTicket\)/);
  assert.match(appSource, /scopeTicketsForTableSync\(validTickets, editLock\?\.tableId\)/);
  assert.match(appSource, /parkedTickets: tableSyncTickets/);
});

test('sync maintenance and inventory polling defer during active ticket input', () => {
  const inventorySource = readFileSync(new URL('../services/sync/InventorySyncService.ts', import.meta.url), 'utf8');
  assert.match(backgroundSyncSource, /PRUNE_INTERVAL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(backgroundSyncSource, /if \(!isPosSaleActive\(\)\) await this\.pruneSyncedItems\(\)/);
  assert.match(backgroundSyncSource, /await db\.deleteDocument\(colName as any, toPruneIds\[index\]\)/);
  assert.doesNotMatch(backgroundSyncSource, /await db\.save\(colName as any, toKeep\)/);
  assert.match(inventorySource, /if \(this\.pollInFlight \|\| isPosSaleActive\(\)\) return/);
  assert.match(inventorySource, /movements\.length > 0 && !isPosSaleActive\(\)/);
});

test('pending catalog edits honor their scheduled retry instead of waking sync every five seconds', () => {
  assert.match(backgroundSyncSource, /collectionName === 'catalogEdits' && status === 'PENDING'/);
  assert.match(backgroundSyncSource, /nextAttemptAt - Date\.now\(\)/);
  assert.match(backgroundSyncSource, /this\.nextRetryDelayMs = this\.nextRetryDelayMs === null/);
});

test('catalog classifications accept explicit empty levels without scanning product rows', () => {
  assert.match(syncSource, /const hasPersistedCatalogClassifications = \[/);
  assert.match(syncSource, /\.some\(rows => rows\.length > 0\)/);
  assert.match(syncSource, /if \(Array\.isArray\(value\)\) continue/);
  assert.match(syncSource, /values\.find\(\(value\): value is unknown\[\] => Array\.isArray\(value\)\)/);
  assert.doesNotMatch(syncSource, /const missingCommercialClassifications/);
});

test('sync center derives the master label from the effective runtime profile', () => {
  assert.match(syncSettingsSource, /profile\.posRuntime === 'MASTER'/);
  assert.match(syncSettingsSource, /String\(connStatus\?\.mode \|\| ''\)\.toUpperCase\(\) === 'MASTER'/);
  assert.match(syncSettingsSource, /if \(effectiveIsMaster\) \{/);
});

test('settings interaction uses the same background-work pause as sales screens', () => {
  const guard = appSource.slice(appSource.indexOf('const inputSensitiveViews'), appSource.indexOf('const markInteraction', appSource.indexOf('const inputSensitiveViews')));
  assert.match(guard, /'SETTINGS'/);
  assert.match(guard, /'SETTINGS_SYNC'/);
  assert.match(guard, /'POS'/);
});
