import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

test('la terminal cliente persiste cada cambio localmente y agrupa el envío remoto', () => {
  assert.match(posSource, /deferRemote:\s*true,\s*reason:\s*'cart_changed'/);
  assert.match(posSource, /batchClientSync \? 2_000 : 120/);
  assert.match(posSource, /Cambios guardados localmente\. Pendiente de sincronizar\./);
  assert.match(appSource, /PENDING_CLIENT_TABLE_SYNC_STORAGE_KEY/);
  assert.match(appSource, /persistPendingClientTableSync\(pendingSync\)/);
  assert.match(appSource, /await readPendingClientTableSync\(\)/);
  assert.match(appSource, /db\.save\('parkedTickets', validTickets\)/);
  assert.match(appSource, /pendingClientTableSyncRef\.current = pendingSync/);
  assert.match(appSource, /setParkedTickets\(validTickets\)/);
  assert.match(appSource, /mergePendingClientTableTickets\(responseParkedTickets, pendingTableSync\)/);
});

test('el polling no cancela el envío diferido de la primera digitación', () => {
  const autoSyncSource = posSource.slice(
    posSource.indexOf('useEffect(() => {\n      const orderId = activeTable?.currentOrderId;'),
    posSource.indexOf('const handleCreateReservation'),
  );
  assert.match(autoSyncSource, /parkedTicketsRef\.current\.find/);
  assert.match(autoSyncSource, /onUpdateParkedTicketsRef\.current/);
  assert.match(autoSyncSource, /onTableOrderSavedRef\.current/);
  assert.match(autoSyncSource, /ticketAutoSyncTimeoutRef\.current === timeoutId/);
  assert.doesNotMatch(autoSyncSource, /\n\s+parkedTickets,\n/);
  assert.doesNotMatch(autoSyncSource, /\n\s+onUpdateParkedTickets,\n/);
});

test('volver al mapa libera el estado local y conserva el envío durable antes del release remoto', () => {
  const saveForMap = posSource.slice(
    posSource.indexOf('const saveActiveTableOrderForMap'),
    posSource.indexOf('const handleSendAndExit'),
  );
  assert.match(saveForMap, /cancelTicketAutoSync\(\)/);
  assert.match(
    saveForMap,
    /await Promise\.resolve\(onUpdateParkedTickets\(updatedTickets,\s*\{\s*reason:\s*'explicit'\s*\}\)\)/,
  );
  assert.match(saveForMap, /La mesa permanece abierta y pendiente\./);

  const openMapStart = appSource.indexOf('onOpenTableMap={async () =>');
  const openMapHandler = appSource.slice(
    openMapStart,
    appSource.indexOf('onTableOrderSaved=', openMapStart),
  );
  assert.match(openMapHandler, /releaseActiveTableEditLock\(\{ deferRemote: true, trace: changeTrace \}\)/);
  assert.ok(openMapHandler.indexOf('releaseActiveTableEditLock') < openMapHandler.indexOf("setCurrentView('TABLE_MAP')"));
  assert.match(appSource, /const persistenceBarrier = parkedTicketSyncQueueRef\.current/);
  assert.match(appSource, /await persistenceBarrier/);
  assert.match(posSource, /await Promise\.resolve\(onOpenTableMap\(\)\)/);
});

test('un heartbeat tardío no puede volver a bloquear una mesa liberada', () => {
  const releaseSource = appSource.slice(
    appSource.indexOf('const releaseActiveTableEditLock'),
    appSource.indexOf('const acquireTableEditLock'),
  );
  const heartbeatSource = appSource.slice(
    appSource.indexOf("if (!activeTableEditLock || (currentView !== 'POS'"),
    appSource.indexOf('const retryClientMasterConnection'),
  );

  assert.match(releaseSource, /pendingTableLockReleasesRef\.current/);
  assert.match(releaseSource, /phase: 'PERSIST_PENDING'/);
  assert.match(releaseSource, /tableLockLifecycleVersionRef\.current \+= 1/);
  assert.match(heartbeatSource, /lifecycleVersion !== tableLockLifecycleVersionRef\.current/);
  assert.match(heartbeatSource, /currentLock\?\.token !== heartbeatToken/);
});

test('la cola pendiente solo se limpia después de una confirmación exitosa de la Master', () => {
  const updateHandler = appSource.slice(
    appSource.indexOf('const handleUpdateParkedTickets'),
    appSource.indexOf('const handleParkedOrderSplitFromMap'),
  );
  assert.match(updateHandler, /writeCriticalCollectionsMirror\(validTickets, cashMovements\);\s*setParkedTickets\(validTickets\);/);
  assert.match(updateHandler, /if \(options\.deferRemote\) \{\s*window\.setTimeout\(\(\) => void persistLocal\(\), 0\);\s*return;/);
  assert.match(updateHandler, /requestAnimationFrame\(\(\) => window\.setTimeout\(resolve, 0\)\)/);
  assert.match(updateHandler, /if \(!response\.ok \|\| result\?\.success === false\)/);
  assert.match(updateHandler, /await clearPendingClientTableSync\(\)/);
  assert.ok(
    updateHandler.indexOf('await clearPendingClientTableSync()')
      > updateHandler.indexOf('if (!response.ok || result?.success === false)'),
  );
});
