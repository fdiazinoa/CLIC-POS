import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
const heartbeatSchedulerSource = await readFile(
  new URL('../utils/erpHeartbeatScheduler.ts', import.meta.url),
  'utf8',
);
const lifecycleSource = await readFile(
  new URL('../utils/erpSyncLifecycle.ts', import.meta.url),
  'utf8',
);
const realtimeSource = await readFile(
  new URL('../services/sync/RealtimeNotificationService.ts', import.meta.url),
  'utf8',
);

test('heartbeat remains independent and configuration safety polling is at least five minutes', () => {
  const schedulerStart = appSource.indexOf('const heartbeatScheduler = createErpHeartbeatScheduler');
  const lifecycleStart = appSource.indexOf('const syncLifecycle = async', schedulerStart);
  const heartbeatSchedulerBlock = appSource.slice(schedulerStart, lifecycleStart);

  assert.match(appSource, /const ACTIVE_HEARTBEAT_INTERVAL_MS = 4 \* 60 \* 1000/);
  assert.match(appSource, /healthy reconciliation/);
  assert.match(appSource, /const BACKGROUND_HEARTBEAT_INTERVAL_MS = 15 \* 60 \* 1000/);
  assert.match(appSource, /const CONFIG_SAFETY_CHECK_INTERVAL_MS = 15 \* 60 \* 1000/);
  assert.match(appSource, /requestConditionalTerminalConfig\('safety_check'\)/);
  assert.doesNotMatch(
    heartbeatSchedulerBlock,
    /syncLifecycle|triggerErpSyncOutbox|requestConditionalTerminalConfig|syncTerminalManifestInBackground/,
  );
  assert.match(appSource, /sendPeriodicErpHeartbeat[\s\S]*heartbeatErpSyncTerminal\(/);
  assert.match(appSource, /flightRef: erpHeartbeatInFlightRef/);
  assert.match(appSource, /getLastAuthenticatedActivityAt:/);
  assert.match(appSource, /endpoint: '\/terminals\/heartbeat'/);
  assert.match(heartbeatSchedulerSource, /\.finally\(scheduleNext\)/);
});

test('runtime cleanup clears config timer and aborts the active conditional request', () => {
  assert.match(appSource, /heartbeatScheduler\.stop\(\)/);
  assert.match(appSource, /clearTimeout\(configSafetyCheckTimeoutId\)/);
  assert.match(appSource, /terminalConfigRequestCoordinator\.cancel\(erpTerminalId\)/);
});

test('changing currentView does not recreate the ERP lifecycle timers', () => {
  const lifecycleEffectStart = appSource.lastIndexOf('useEffect(() => {', appSource.indexOf('const setupPending = hasPendingTerminalSetup'));
  const lifecycleEffectEnd = appSource.indexOf('// --- RECONNECTION BANNER ---', lifecycleEffectStart);
  const lifecycleEffect = appSource.slice(lifecycleEffectStart, lifecycleEffectEnd);
  assert.match(lifecycleEffect, /\}, \[erpLifecycleReady, deviceId, getCurrentTerminal\]\);/);
  assert.doesNotMatch(lifecycleEffect, /\[[^\]]*currentView[^\]]*\]/);
});

test('lifecycle HTTP requests have a bounded AbortController timeout', () => {
  assert.match(lifecycleSource, /ERP_SYNC_LIFECYCLE_REQUEST_TIMEOUT_MS = 15_000/);
  assert.match(lifecycleSource, /const controller = new AbortController\(\)/);
  assert.match(lifecycleSource, /\(\) => controller\.abort\(\)/);
  assert.match(lifecycleSource, /signal: controller\.signal/);
  assert.match(lifecycleSource, /code = 'ERP_SYNC_TIMEOUT'/);
});

test('Realtime reuses one private channel pair for the same store and terminal', () => {
  assert.match(
    realtimeSource,
    /this\.channels\.length > 0 && this\.storeId === storeId && this\.terminalId === terminalId/,
  );
  assert.match(realtimeSource, /if \(this\.initializePromise && this\.initializeKey === key\)/);
  assert.match(realtimeSource, /Promise\.all\(existing\.map\(\(channel\) => channel\.unsubscribe\(\)\)\)/);
  assert.match(realtimeSource, /channelNames = \[[\s\S]*terminalTopic/);
  assert.match(realtimeSource, /event: 'SYNC_HINT'/);
  assert.match(realtimeSource, /private: true/);
  assert.doesNotMatch(realtimeSource, /channel\.track\(/);
});
