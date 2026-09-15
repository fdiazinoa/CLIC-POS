import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const interactionPerformanceSource = readFileSync(
  new URL('../utils/interactionPerformance.ts', import.meta.url),
  'utf8',
);
const nativeBridgeSource = readFileSync(
  new URL('../native-stubs/android/ClicPOSNativePrinterBridge.kt', import.meta.url),
  'utf8',
);
const backgroundSyncSource = readFileSync(
  new URL('../services/sync/BackgroundSyncManager.ts', import.meta.url),
  'utf8',
);
const printQueueSource = readFileSync(
  new URL('../services/printer/OfflinePrintQueueService.ts', import.meta.url),
  'utf8',
);
const operatorUiTransitionSource = readFileSync(
  new URL('../utils/operatorUiTransition.ts', import.meta.url),
  'utf8',
);
const backgroundSyncSchedulerSource = readFileSync(
  new URL('../utils/backgroundSyncScheduler.ts', import.meta.url),
  'utf8',
);

test('Android printing never uses the synchronous WebView bridge path', () => {
  for (const method of ['printEscPos', 'printEscpos', 'printRaw', 'printHtml', 'print']) {
    assert.match(appSource, new RegExp(`'${method}'`));
    assert.match(nativeBridgeSource, new RegExp(`${method}: true`));
    assert.match(nativeBridgeSource, new RegExp(`"${method}" ->`));
  }
  assert.match(nativeBridgeSource, /private val printBridgeExecutor = Executors\.newSingleThreadExecutor\(\)/);
  assert.match(nativeBridgeSource, /"printEscPos", "printEscpos", "printRaw", "printHtml", "print" -> printBridgeExecutor/);
});

test('closing the table map acknowledges input and records visible/interactable frames', () => {
  const tableMapStart = appSource.indexOf("case 'TABLE_MAP':");
  const tableDesignerStart = appSource.indexOf("case 'TABLE_DESIGNER':", tableMapStart);
  const tableMapSource = appSource.slice(tableMapStart, tableDesignerStart);
  const closeHandlerStart = appSource.indexOf('const handleCloseTableMap');
  const closeHandlerEnd = appSource.indexOf('const validateSupervisorPin', closeHandlerStart);
  const closeHandlerSource = appSource.slice(closeHandlerStart, closeHandlerEnd);

  assert.match(tableMapSource, /onClick=\{handleCloseTableMap\}/);
  assert.match(tableMapSource, /Abriendo venta…/);
  assert.match(closeHandlerSource, /beginPosInteraction\('CLOSE_TABLE_MAP'/);
  assert.match(closeHandlerSource, /setTableMapExitPending\(true\)/);
  assert.doesNotMatch(closeHandlerSource, /requestAnimationFrame\(\(\) => \{/);
  assert.match(closeHandlerSource, /markInteractionStage\(trace, 'NAVIGATION_START'\)/);
  assert.match(closeHandlerSource, /setCurrentView\('POS'\)/);
  assert.match(interactionPerformanceSource, /markInteractionStage\(trace, 'VISUAL_ACK'\)/);
  assert.match(interactionPerformanceSource, /window\.setTimeout\(\(\) => \{/);
  assert.doesNotMatch(tableMapSource, /onClick=\{\(\) => setCurrentView\('POS'\)\}/);
});

test('the table map overlays a retained memoized POS instead of remounting it', () => {
  const layoutStart = appSource.indexOf('const renderWithLayout');
  const layoutSource = appSource.slice(layoutStart, appSource.indexOf('if (!isDataLoaded)', layoutStart));

  assert.match(appSource, /const MemoizedPOSInterface = React\.memo\(POSInterface\)/);
  assert.match(appSource, /data-pos-persistent-host="true"/);
  assert.match(layoutSource, /currentView === 'POS' \|\| currentView === 'TABLE_MAP'/);
  assert.match(layoutSource, /\{renderView\('POS'\)\}/);
  assert.match(layoutSource, /data-table-map-persistent-host="true"|TableMapLifecycleBoundary/);
  const persistentHostStart = appSource.indexOf('const PersistentPOSHost');
  const persistentHostEnd = appSource.indexOf('const TableMapLifecycleBoundary', persistentHostStart);
  const persistentHostSource = appSource.slice(persistentHostStart, persistentHostEnd);
  assert.doesNotMatch(persistentHostSource, /visible \? 'h-full' : 'hidden'/);
  assert.match(persistentHostSource, /invisible pointer-events-none select-none/);
  assert.match(persistentHostSource, /contain: 'layout style'/);
  assert.doesNotMatch(persistentHostSource, /translateZ|willChange/);
  assert.match(persistentHostSource, /setAttribute\('inert', ''\)/);
});

test('the table map stays mounted and rejects overlapping table opens', () => {
  const tableMapSource = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
  const layoutStart = appSource.indexOf('const renderWithLayout');
  const layoutSource = appSource.slice(layoutStart, appSource.indexOf('if (!isDataLoaded)', layoutStart));

  assert.match(appSource, /data-table-map-persistent-host="true"/);
  assert.match(appSource, /const MemoizedTableMap = React\.memo\(TableMap\)/);
  assert.match(appSource, /<StableTableMap/);
  assert.match(layoutSource, /tableMapHasMounted \|\| currentView === 'TABLE_MAP'/);
  assert.match(layoutSource, /<TableMapLifecycleBoundary visible=\{currentView === 'TABLE_MAP'\}>/);
  assert.doesNotMatch(layoutSource, /currentView === 'TABLE_MAP' \? \(\s*<div[^>]*data-table-map-overlay/);
  assert.match(tableMapSource, /if \(openingTableIdRef\.current\) return;/);
  assert.match(tableMapSource, /openingTableIdRef\.current = String\(model\.table\.id\)/);
  assert.match(appSource, /setSuppressProductInputUntilMs\(Date\.now\(\) \+ 300\)/);
  assert.match(appSource, /suppressProductInputUntilMs=\{suppressProductInputUntilMs\}/);
});

test('a queued table tap cannot activate the catalog after navigation', () => {
  const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const handlerStart = posSource.indexOf('const handleProductClick = useCallback');
  const handlerEnd = posSource.indexOf('const handleSearchConsignments', handlerStart);
  const handlerSource = posSource.slice(handlerStart, handlerEnd);

  assert.match(posSource, /suppressProductInputUntilMs\?: number/);
  assert.match(handlerSource, /if \(Date\.now\(\) < suppressProductInputUntilMs\) return;/);
});

test('opening a table hydrates the retained POS before removing the map overlay', () => {
  const tableMapStart = appSource.indexOf("case 'TABLE_MAP':");
  const tableDesignerStart = appSource.indexOf("case 'TABLE_DESIGNER':", tableMapStart);
  const tableMapSource = appSource.slice(tableMapStart, tableDesignerStart);
  const cartUpdate = tableMapSource.indexOf('setCart(nextCart)');
  const deferredNavigation = tableMapSource.indexOf('window.requestAnimationFrame', cartUpdate);
  const posNavigation = tableMapSource.indexOf("setCurrentView('POS')", deferredNavigation);

  assert.ok(cartUpdate >= 0);
  assert.ok(deferredNavigation > cartUpdate);
  assert.ok(posNavigation > deferredNavigation);
  assert.match(tableMapSource, /markInteractionStage\(openTrace, 'POS_UPDATE_START'\)/);
  assert.match(tableMapSource, /markInteractionStage\(openTrace, 'NAVIGATION_START'\)/);
});

test('automatic synchronization waits for the retained POS to become interactive', () => {
  const closeHandlerStart = appSource.indexOf('const handleCloseTableMap');
  const closeHandlerEnd = appSource.indexOf('const validateSupervisorPin', closeHandlerStart);
  const closeHandlerSource = appSource.slice(closeHandlerStart, closeHandlerEnd);

  assert.match(closeHandlerSource, /beginOperatorUiTransition\('CLOSE_TABLE_MAP'\)/);
  assert.match(closeHandlerSource, /completeOperatorUiTransition\(tableMapExitTransitionRef\.current\)/);
  assert.match(appSource, /syncTriggerCoordinator\.configure\(async[\s\S]*?const deferred = await waitForBackgroundSyncWindow\(\)/);
  assert.match(appSource, /source: 'periodic_outbox'/);
  assert.match(appSource, /source: `terminal_config:\$\{reason\}`/);
  assert.match(operatorUiTransitionSource, /DEFAULT_MAX_HOLD_MS = 1_500/);
  assert.match(backgroundSyncSchedulerSource, /await waitForOperatorUiTransition\(\)/);
  assert.match(backgroundSyncSchedulerSource, /await waitForPosSaleIdle\(\)/);
  assert.match(backgroundSyncSchedulerSource, /requestIdleCallback/);
});

test('background queues yield between jobs and respect active operator input', () => {
  assert.match(backgroundSyncSource, /yieldToOperatorUi\(\): Promise<void>/);
  assert.match(backgroundSyncSource, /await this\.yieldToOperatorUi\(\)/);
  assert.match(printQueueSource, /if \(isPosSaleActive\(\)\) break/);
  assert.match(printQueueSource, /await yieldToOperatorUi\(\)/);
});
