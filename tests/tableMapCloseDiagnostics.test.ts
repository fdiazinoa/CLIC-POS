import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const interactionSource = readFileSync(new URL('../utils/interactionPerformance.ts', import.meta.url), 'utf8');
const diagnosticsRuntimeSource = readFileSync(new URL('../diagnostics/runtime.ts', import.meta.url), 'utf8');
const diagnosticsTransformSource = readFileSync(new URL('../diagnostics/viteInstrumentation.ts', import.meta.url), 'utf8');

test('table-map close trace separates controller, navigation, unmount, POS update and frames', () => {
  for (const marker of [
    'CLOSE_TABLE_MAP',
    'VISUAL_ACK',
    'NAVIGATION_START',
    'NAVIGATION_END',
    'TABLE_MAP_UNMOUNT_START',
    'TABLE_MAP_UNMOUNT_END',
    'POS_UPDATE_START',
    'POS_UPDATE_END',
    'FIRST_FRAME_VISIBLE',
    'FIRST_FRAME_INTERACTIVE',
  ]) {
    assert.match(interactionSource, new RegExp(`'${marker}'`));
  }
  assert.match(interactionSource, /PerformanceObserver\.supportedEntryTypes\?\.includes\('longtask'\)/);
  assert.match(interactionSource, /usedJsHeapBytes/);
});

test('diagnostic APK observes the close handler and redacted localStorage reads', () => {
  assert.match(diagnosticsTransformSource, /handleCloseTableMap/);
  assert.match(diagnosticsRuntimeSource, /App\.\*handleCloseTableMap/);
  assert.match(diagnosticsRuntimeSource, /LOCAL_STORAGE_READ/);
  assert.match(diagnosticsRuntimeSource, /keyHash/);
  assert.doesNotMatch(diagnosticsRuntimeSource, /LOCAL_STORAGE_READ.*\bkey\b/);
});
