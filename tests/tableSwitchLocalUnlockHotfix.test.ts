import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const tableMapSource = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const performanceSource = readFileSync(new URL('../utils/interactionPerformance.ts', import.meta.url), 'utf8');

const releaseStart = appSource.indexOf('const releaseActiveTableEditLock');
const acquireStart = appSource.indexOf('const acquireTableEditLock', releaseStart);
const releaseSource = appSource.slice(releaseStart, acquireStart);
const updateStart = appSource.indexOf('const handleUpdateParkedTickets');
const splitStart = appSource.indexOf('const handleParkedOrderSplitFromMap', updateStart);
const updateSource = appSource.slice(updateStart, splitStart);

test('cambio de mesa registra FIRST_RENDER y LOCAL_UNLOCK por separado', () => {
  assert.match(performanceSource, /'LOCAL_UNLOCK'/);
  assert.match(performanceSource, /inputToLocalUnlock/);
  assert.match(performanceSource, /localUnlockP50Ms/);
  assert.match(performanceSource, /localUnlockP95Ms/);
  assert.match(performanceSource, /localUnlockP99Ms/);
});

test('el lock local se retira antes de esperar persistencia o release remoto', () => {
  assert.ok(releaseStart >= 0 && acquireStart > releaseStart);
  assert.match(releaseSource, /activeTableEditLockRef\.current = null/);
  assert.match(releaseSource, /editingLock: undefined/);
  assert.match(releaseSource, /markInteractionStage\(options\.trace, 'LOCAL_UNLOCK'\)/);
  assert.ok(
    releaseSource.indexOf('activeTableEditLockRef.current = null')
      < releaseSource.indexOf('const persistenceBarrier = parkedTicketSyncQueueRef.current'),
  );
  assert.match(releaseSource, /await persistenceBarrier/);
  assert.match(releaseSource, /await invokeTableEditLock\('release'/);
});

test('reabrir la misma mesa cancela solo un release que todavía espera persistencia', () => {
  assert.match(appSource, /pendingTableLockReleasesRef = useRef<Map<string, PendingTableLockRelease>>/);
  assert.match(appSource, /pendingRelease\?\.phase === 'PERSIST_PENDING'/);
  assert.match(appSource, /pendingTableLockReleasesRef\.current\.delete\(tableId\)/);
  assert.match(appSource, /reusableLock = pendingRelease\.lock/);
  assert.match(appSource, /pendingRelease\?\.phase === 'RELEASING'/);
  assert.match(appSource, /await pendingRelease\.promise/);
});

test('un lock propio no bloquea localmente pero el lock de otra terminal sí', () => {
  assert.match(tableMapSource, /displayTable\.editingLock\.ownerId/);
  assert.match(tableMapSource, /localTableLockOwnerId/);
  assert.match(tableMapSource, /const isBeingEdited = Boolean/);
  assert.match(tableMapSource, /const isLocked = isBeingEdited \|\|/);
  assert.match(appSource, /localTableLockOwnerId=\{String\(deviceId/);
});

test('la persistencia Master de tickets usa un solo reemplazo transaccional', () => {
  const persistStart = updateSource.indexOf('const persistMasterTickets');
  const persistEnd = updateSource.indexOf('// La caja maestra Android', persistStart);
  const persistSource = updateSource.slice(persistStart, persistEnd);
  assert.match(persistSource, /await db\.save\('parkedTickets', validTickets\)/);
  assert.doesNotMatch(persistSource, /db\.saveDocument/);
  assert.doesNotMatch(persistSource, /db\.deleteDocument/);
  assert.doesNotMatch(persistSource, /db\.get\('parkedTickets'/);
  assert.match(updateSource, /\.then\(waitForTableInteractionIdle\)/);
  assert.match(updateSource, /writePendingTableSyncMirror\(masterPendingSync\)/);
  assert.match(appSource, /TABLE_PERSISTENCE_IDLE_MS = 1_000/);
});

test('el cambio visual dispara release local antes de reconciliar con la Master', () => {
  const openMapStart = appSource.indexOf('onOpenTableMap={async () =>');
  const orderSavedStart = appSource.indexOf('onTableOrderSaved=', openMapStart);
  const openMapSource = appSource.slice(openMapStart, orderSavedStart);
  assert.match(openMapSource, /releaseActiveTableEditLock\(\{ deferRemote: true, trace: changeTrace \}\)/);
  assert.match(openMapSource, /pendingRelease \? await pendingRelease\.promise : true/);
  assert.match(openMapSource, /currentViewRef\.current !== 'TABLE_MAP' \|\| activeTableEditLockRef\.current/);
  assert.ok(
    openMapSource.indexOf('releaseActiveTableEditLock')
      < openMapSource.indexOf("measureInteractionStage(changeTrace, 'SYNC_START', 'SYNC_END'"),
  );
});

test('un ACK atrasado no rerenderiza la operación interactiva siguiente', () => {
  assert.match(updateSource, /const canApplyAcknowledgedSnapshot =/);
  assert.match(updateSource, /currentViewRef\.current === 'TABLE_MAP'/);
  assert.match(updateSource, /!activeTableEditLockRef\.current/);
  assert.match(updateSource, /if \(canApplyAcknowledgedSnapshot\) \{/);
});
