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

test('closing the table map acknowledges input before concurrent POS rendering', () => {
  const tableMapStart = appSource.indexOf("case 'TABLE_MAP':");
  const tableDesignerStart = appSource.indexOf("case 'TABLE_DESIGNER':", tableMapStart);
  const tableMapSource = appSource.slice(tableMapStart, tableDesignerStart);

  assert.match(tableMapSource, /setTableMapExitPending\(true\)/);
  assert.match(tableMapSource, /requestAnimationFrame\(\(\) => handleViewChange\('POS'\)\)/);
  assert.match(tableMapSource, /Abriendo venta…/);
  assert.doesNotMatch(tableMapSource, /onClick=\{\(\) => setCurrentView\('POS'\)\}/);
});

test('background queues yield between jobs and respect active operator input', () => {
  assert.match(backgroundSyncSource, /yieldToOperatorUi\(\): Promise<void>/);
  assert.match(backgroundSyncSource, /await this\.yieldToOperatorUi\(\)/);
  assert.match(printQueueSource, /if \(isPosSaleActive\(\)\) break/);
  assert.match(printQueueSource, /await yieldToOperatorUi\(\)/);
});
