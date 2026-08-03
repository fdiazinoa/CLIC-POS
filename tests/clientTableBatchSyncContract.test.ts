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

test('volver al mapa fuerza el último envío antes de liberar el bloqueo', () => {
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

  const openMapStart = appSource.indexOf('onOpenTableMap={() =>');
  const openMapHandler = appSource.slice(
    openMapStart,
    appSource.indexOf('onTableOrderSaved=', openMapStart),
  );
  assert.match(openMapHandler, /await releaseActiveTableEditLock\(\)/);
  assert.match(appSource, /await parkedTicketSyncQueueRef\.current/);
});

test('la cola pendiente solo se limpia después de una confirmación exitosa de la Master', () => {
  const updateHandler = appSource.slice(
    appSource.indexOf('const handleUpdateParkedTickets'),
    appSource.indexOf('const handleParkedOrderSplitFromMap'),
  );
  assert.match(updateHandler, /if \(options\.deferRemote\) \{\s*return;/);
  assert.match(updateHandler, /if \(!response\.ok \|\| result\?\.success === false\)/);
  assert.match(updateHandler, /await clearPendingClientTableSync\(\)/);
  assert.ok(
    updateHandler.indexOf('await clearPendingClientTableSync()')
      > updateHandler.indexOf('if (!response.ok || result?.success === false)'),
  );
});
