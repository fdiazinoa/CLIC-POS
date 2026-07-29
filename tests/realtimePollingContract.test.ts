import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
const realtimeSource = await readFile(
  new URL('../services/sync/RealtimeNotificationService.ts', import.meta.url),
  'utf8',
);

test('heartbeat remains independent and configuration safety polling is at least five minutes', () => {
  assert.match(appSource, /const HEARTBEAT_INTERVAL_MS = 60000/);
  assert.match(appSource, /const CONFIG_SAFETY_CHECK_INTERVAL_MS = 300000/);
  assert.match(appSource, /requestConditionalTerminalConfig\('safety_check'\)/);
  assert.doesNotMatch(
    appSource.match(/const scheduleNextHeartbeat[\s\S]*?scheduleNextHeartbeat\(\);/)?.[0] || '',
    /requestConditionalTerminalConfig/,
  );
});

test('runtime cleanup clears config timer and aborts the active conditional request', () => {
  assert.match(appSource, /clearTimeout\(configSafetyCheckTimeoutId\)/);
  assert.match(appSource, /terminalConfigRequestCoordinator\.cancel\(erpTerminalId\)/);
});

test('Realtime reuses one channel for the same store and terminal', () => {
  assert.match(
    realtimeSource,
    /this\.channel && this\.storeId === storeId && this\.terminalId === terminalId/,
  );
  assert.match(realtimeSource, /if \(this\.initializePromise && this\.initializeKey === key\)/);
  assert.match(realtimeSource, /await existing\.unsubscribe\(\)/);
});
