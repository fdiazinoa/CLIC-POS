import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
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
  assert.match(closeHandlerSource, /requestAnimationFrame\(\(\) => \{/);
  assert.match(closeHandlerSource, /markInteractionStage\(trace, 'VISUAL_ACK'\)/);
  assert.match(closeHandlerSource, /setCurrentView\('POS'\)/);
  assert.doesNotMatch(tableMapSource, /onClick=\{\(\) => setCurrentView\('POS'\)\}/);
});

test('the table map overlays a retained memoized POS instead of remounting it', () => {
  const layoutStart = appSource.indexOf('const renderWithLayout');
  const layoutSource = appSource.slice(layoutStart, appSource.indexOf('if (!isDataLoaded)', layoutStart));

  assert.match(appSource, /const MemoizedPOSInterface = React\.memo\(POSInterface\)/);
  assert.match(appSource, /data-pos-persistent-host="true"/);
  assert.match(layoutSource, /currentView === 'POS' \|\| currentView === 'TABLE_MAP'/);
  assert.match(layoutSource, /\{renderView\('POS'\)\}/);
  assert.match(layoutSource, /data-table-map-overlay="true"/);
});

test('background queues yield between jobs and respect active operator input', () => {
  assert.match(backgroundSyncSource, /yieldToOperatorUi\(\): Promise<void>/);
  assert.match(backgroundSyncSource, /await this\.yieldToOperatorUi\(\)/);
  assert.match(printQueueSource, /if \(isPosSaleActive\(\)\) break/);
  assert.match(printQueueSource, /await yieldToOperatorUi\(\)/);
});
