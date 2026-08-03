import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync(
  new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url),
  'utf8',
);
const bridgeSource = readFileSync(
  new URL('../native-stubs/android/ClicPOSNativePrinterBridge.kt', import.meta.url),
  'utf8',
);
const discoverySource = readFileSync(
  new URL('../native-stubs/android/ClicPOSMasterDiscovery.kt', import.meta.url),
  'utf8',
);
const pairingSource = readFileSync(new URL('../components/TerminalBindingScreen.tsx', import.meta.url), 'utf8');
const lanDiscoverySource = readFileSync(new URL('../utils/masterLanDiscovery.ts', import.meta.url), 'utf8');
const scannerSource = readFileSync(new URL('../services/sync/NetworkScanner.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('la Master Android expone el estado compartido de restaurante', () => {
  assert.match(serverSource, /method == "GET" && path == "\/api\/mesas"/);
  assert.match(serverSource, /method == "PUT" && path == "\/api\/mesas\/parked-tickets"/);
  assert.match(serverSource, /buildRestaurantSnapshot\(\)/);
  assert.match(serverSource, /\.put\("rooms", JSONArray\(roomsSnapshot\.toString\(\)\)\)/);
  assert.match(serverSource, /\.put\("tables", buildTablesWithEditLocks\(\)\)/);
  assert.match(serverSource, /\.put\("parkedTickets", JSONArray\(parkedTicketsSnapshot\.toString\(\)\)\)/);
});

test('la Master Android permite abrir y liberar mesas desde una terminal cliente', () => {
  assert.match(serverSource, /method == "POST" && path == "\/api\/mesas\/abrir"/);
  assert.match(serverSource, /method == "POST" && path == "\/api\/mesas\/liberar"/);
  assert.match(serverSource, /private fun handleOpenTable/);
  assert.match(serverSource, /private fun handleReleaseTable/);
  assert.match(serverSource, /\.put\("orden_id", orderId\)\s+\.put\("revision", restaurantRevision\.get\(\)\)/);
  assert.match(serverSource, /\.put\("items", JSONArray\(\)\)/);
  assert.match(serverSource, /applyClientRestaurantMutation\(tables = updatedTables, parkedTickets = updatedTickets\)/);
});

test('la Master conserva una cuenta abierta aunque todavía no tenga artículos', () => {
  const reconciliationSource = serverSource.slice(
    serverSource.indexOf('private fun reconcileTablesWithParkedTickets'),
    serverSource.indexOf('private fun handleTableUpdate'),
  );
  assert.doesNotMatch(reconciliationSource, /if \(!hasItems\) continue/);
  assert.match(reconciliationSource, /Solo el endpoint explícito de liberación debe cerrar la mesa/);
  assert.match(serverSource, /if \(!belongsToTable && !belongsToOrder\) remainingTickets\.put\(ticket\)/);
});

test('la Master protege su borrador frente a revisiones provocadas por una Cliente', () => {
  const nativeReconciliationSource = appSource.slice(
    appSource.indexOf('const reconcileNativeRestaurantState'),
    appSource.indexOf('ensureMasterServer();'),
  );
  assert.match(nativeReconciliationSource, /pendingMasterTableSyncRef\.current/);
  assert.match(nativeReconciliationSource, /mergePendingClientTableTickets/);
  assert.match(nativeReconciliationSource, /reconcileTablesWithParkedTickets\(nextTables, nextParkedTickets\)/);

  const updateSource = appSource.slice(
    appSource.indexOf('const handleUpdateParkedTickets'),
    appSource.indexOf('const handleParkedOrderSplitFromMap'),
  );
  assert.match(updateSource, /pendingMasterTableSyncRef\.current = masterPendingSync/);
  assert.match(updateSource, /tableId: masterEditLock\.tableId/);
  assert.match(updateSource, /lockToken: masterEditLock\.token/);
  assert.match(updateSource, /baseRevision: masterRestaurantRevisionRef\.current/);
});

test('la Master Android reemplaza el layout completo en una sola mutación persistida', () => {
  assert.match(serverSource, /method == "PUT" && path == "\/api\/mesas\/layout"/);
  assert.match(serverSource, /private fun handleFloorPlanReplace/);
  assert.match(serverSource, /reconcileTablesWithParkedTickets\(tables, parkedTicketsSnapshot\)/);
  assert.match(serverSource, /applyClientRestaurantMutation\(rooms = rooms, tables = reconciledTables\)/);
  assert.match(appSource, /resolveOperationalApiUrl\('\/api\/mesas\/layout'\)/);
  assert.doesNotMatch(appSource, /normalizedTablesInput\.length === 0 && existingDbTables\.length > 0/);
  assert.match(appSource, /window\.localStorage\.removeItem\(FLOOR_PLAN_STORAGE_KEY\)/);
});

test('la Master Android bloquea la digitación simultánea y limita la mutación a una mesa', () => {
  assert.match(serverSource, /TABLE_EDIT_LOCK_TTL_MS = 45_000L/);
  assert.match(serverSource, /method == "POST" && path == "\/api\/mesas\/bloquear"/);
  assert.match(serverSource, /method == "POST" && path == "\/api\/mesas\/desbloquear"/);
  assert.match(serverSource, /fun acquireTableEditLock/);
  assert.match(serverSource, /fun releaseTableEditLock/);
  assert.match(serverSource, /TABLE_EDIT_LOCKED/);
  assert.match(serverSource, /TABLE_EDIT_LOCK_REQUIRED/);
  assert.match(serverSource, /publicTableLock\(lock: JSONObject\)/);
  assert.match(serverSource, /remove\("token"\)/);
  assert.match(serverSource, /mergeTicketsForTable\(tableId, tickets\)/);
  assert.match(serverSource, /if \(!ticketReferencesTable\(ticket, tableId\)\)/);
  assert.match(serverSource, /if \(ticketReferencesTable\(ticket, tableId\)\)/);
  assert.match(serverSource, /\.put\("tables", buildTablesWithEditLocks\(\)\)/);
});

test('la Master conserva y libera de forma simétrica las mesas unidas', () => {
  assert.match(serverSource, /private fun ticketReferencesTable/);
  assert.match(serverSource, /ticket\.optJSONArray\("joinedTableIds"\)/);
  assert.match(serverSource, /activeByTableId\[it\] = ticket/);
  assert.match(serverSource, /linkedTableIds\.contains\(table\.optString\("id"\)\)/);
  assert.match(serverSource, /val belongsToTable = ticketReferencesTable\(ticket, tableId\)/);
  assert.match(serverSource, /table\.remove\("joinedTableId"\)/);
  assert.match(appSource, /joinedTableId: undefined,[\s\S]*joinedSourceTableName: undefined/);
});

test('la WebView entrega el snapshot operativo al servidor nativo sin sobreescribir cambios clientes en el watchdog', () => {
  assert.match(bridgeSource, /payload\.optJSONArray\("rooms"\)/);
  assert.match(bridgeSource, /payload\.optJSONArray\("tables"\)/);
  assert.match(bridgeSource, /payload\.optJSONArray\("parkedTickets"\)/);
  assert.match(appSource, /restaurantRevision: masterRestaurantRevisionRef\.current/);
  assert.match(appSource, /const ensureMasterServerWithoutSnapshot = \(\) =>/);
  assert.match(serverSource, /acknowledgedRevision < restaurantRevision\.get\(\)/);
  assert.match(serverSource, /PREFS_RESTAURANT_KEY/);
  assert.match(appSource, /getMasterRestaurantState/);
  assert.match(appSource, /db\.save\('parkedTickets', nextParkedTickets\)/);
  assert.match(appSource, /resolveOperationalApiUrl\('\/api\/mesas\/parked-tickets'\)/);
  assert.match(appSource, /No se pudo confirmar la orden local/);
});

test('el puente Android publica reconciliación, locks y sincronización serializada al frontend', () => {
  assert.match(bridgeSource, /fun getMasterRestaurantState/);
  assert.match(bridgeSource, /fun acquireMasterTableLock/);
  assert.match(bridgeSource, /fun releaseMasterTableLock/);
  assert.match(appSource, /getMasterRestaurantState: \(payload: unknown\) => call\('getMasterRestaurantState', payload\)/);
  assert.match(appSource, /acquireMasterTableLock: \(payload: unknown\) => call\('acquireMasterTableLock', payload\)/);
  assert.match(appSource, /releaseMasterTableLock: \(payload: unknown\) => call\('releaseMasterTableLock', payload\)/);
  assert.match(appSource, /parkedTicketSyncQueueRef\.current/);
  assert.match(appSource, /lockToken: editLock\?\.token/);
  assert.match(appSource, /await releaseActiveTableEditLock\(\)/);
  assert.match(appSource, /Master evita que un snapshot anterior vuelva a insertar una orden ya cobrada/);
  assert.match(appSource, /const queuedSync = parkedTicketSyncQueueRef\.current/);
  assert.match(appSource, /No reconciliar contra el closure anterior/);
  assert.match(appSource, /const ticketsForReconciliation = hasAuthoritativeParkedTickets \? nextParkedTickets : parkedTickets/);
  assert.match(appSource, /reconcileTablesWithParkedTickets\(merged, ticketsForReconciliation\)/);
});

test('la Master Android implementa autenticación y lectura de catálogos para clientes', () => {
  assert.match(serverSource, /method == "POST" && path == "\/api\/sync\/auth"/);
  assert.match(serverSource, /path\.startsWith\("\/api\/sync\/collections\/"\) && path\.endsWith\("\/data"\)/);
  assert.match(serverSource, /path\.startsWith\("\/api\/sync\/delta\/"\)/);
  assert.match(serverSource, /method == "GET" && path == "\/api\/sync\/config"/);
  assert.match(serverSource, /"users" -> JSONArray\(usersSnapshot\.toString\(\)\)/);
  assert.match(serverSource, /catalogSnapshots\.optJSONArray\(collection\)/);
  assert.match(serverSource, /X-Sync-Token/);
  assert.match(serverSource, /reconcileTablesWithParkedTickets\(tablesSnapshot, nextTickets\)/);
});

test('la Master Android se reactiva al volver al primer plano y el cliente reintenta con espera', () => {
  assert.match(appSource, /addListener\?\.\('resume', ensureMasterServerWithoutSnapshot\)/);
  assert.match(appSource, /discoverLanMasterCandidates\(\{ timeoutMs: 2500 \}\)/);
  assert.match(appSource, /localStorage\.setItem\('CLIC_POS_MASTER_URL', baseUrl\)/);
  assert.match(appSource, /`\$\{baseUrl\}\/api\/sync\/ping`/);
});

test('un fallo transitorio no muestra de inmediato la Master como desconectada', () => {
  assert.match(appSource, /clientMasterFailureCountRef\.current \+= 1/);
  assert.match(appSource, /failureCount >= \(hadRecentSuccess \? 3 : 2\)/);
  assert.match(appSource, /clientMasterFailureCountRef\.current = 0/);
});

test('el polling en segundo plano no hace parpadear el modal de reconexión', () => {
  const fetchTablesSource = appSource.slice(
    appSource.indexOf('const fetchTables = async () =>'),
    appSource.indexOf('const invokeTableEditLock'),
  );
  assert.match(fetchTablesSource, /clientMasterTablesFetchInFlightRef\.current/);
  assert.match(fetchTablesSource, /recordClientMasterFailure\('tables_poll', e\)/);
  assert.doesNotMatch(fetchTablesSource, /clientMasterTablesStatus !== 'ONLINE'/);
  assert.doesNotMatch(fetchTablesSource, /setClientMasterTablesStatus\('CHECKING'\)/);

  const retrySource = appSource.slice(
    appSource.indexOf('const retryClientMasterConnection'),
    appSource.indexOf('const openTableForService'),
  );
  assert.match(retrySource, /setClientMasterTablesStatus\('CHECKING'\)/);
});

test('abrir una mesa usa tolerancia de fallos antes de declarar la Master desconectada', () => {
  const openTableSource = appSource.slice(
    appSource.indexOf('const openTableForService'),
    appSource.indexOf('useKioskMode', appSource.indexOf('const openTableForService')),
  );
  assert.match(openTableSource, /markClientMasterOnline\(\)/);
  assert.match(openTableSource, /recordClientMasterFailure\('open_table', error\)/);
  assert.doesNotMatch(openTableSource, /setClientMasterTablesStatus\('OFFLINE'\)/);
});

test('el sondeo nativo no reemplaza el borrador mientras se edita el plano de mesas', () => {
  assert.match(appSource, /currentViewRef\.current === 'TABLE_DESIGNER'/);
  assert.match(appSource, /ensureMasterServer\(false\)/);
  assert.match(appSource, /const floorPlanSaved = await handleSaveFloorPlan\(rooms, tables\)/);
  assert.match(appSource, /if \(!floorPlanSaved\) return/);
  assert.match(appSource, /La Master devolvió un plano incompleto/);
});

test('los renders de la Master no reemplazan el estado operativo nativo', () => {
  const masterServerEffect = appSource.slice(
    appSource.indexOf('const ensureMasterServer ='),
    appSource.indexOf('useEffect(() => {\n    if (currentView !== \'TABLE_DESIGNER\')'),
  );
  assert.match(masterServerEffect, /includeOperationalSnapshot \? \{ rooms, tables, parkedTickets \} : \{\}/);
  assert.match(masterServerEffect, /revision === 0/);
  assert.match(masterServerEffect, /masterRestaurantBootstrapRequestedRef\.current/);
  assert.match(masterServerEffect, /activeTableEditLockRef\.current/);
  assert.match(masterServerEffect, /Restored designed floor plan after rejecting ERP seed tables/);
  assert.match(masterServerEffect, /writeFloorPlanMirror\(nextRooms, reconciledTables\)/);
});

test('la Caja Master Android se anuncia y puede identificarse automáticamente en la red local', () => {
  assert.match(discoverySource, /SERVICE_TYPE = "_clicpos-master\._tcp\."/);
  assert.match(discoverySource, /manager\.registerService/);
  assert.match(discoverySource, /manager\.discoverServices/);
  assert.match(discoverySource, /\.put\("tenantId", readTenantId\(config\)\)/);
  assert.match(serverSource, /ClicPOSMasterDiscovery\.advertise\(context, activePort, configSnapshot\)/);
  assert.match(serverSource, /path == "\/api\/sync\/identify"/);
  assert.match(bridgeSource, /discoverMasterServers/);
});

test('la terminal cliente intenta IP guardada, Cloud y descubrimiento LAN antes de pedir la IP manual', () => {
  assert.match(pairingSource, /resolveMasterEndpointFromCloud\(\)/);
  assert.match(pairingSource, /discoverLanMasterCandidates\(\{ timeoutMs: 2500 \}\)/);
  assert.match(pairingSource, /No se encontró una Caja Master disponible en esta red/);
  assert.match(lanDiscoverySource, /discoverMasterServers\(\{ timeoutMs: options\.timeoutMs \|\| 2500 \}\)/);
  assert.match(lanDiscoverySource, /NetworkScanner\.findMaster/);
  assert.match(lanDiscoverySource, /discoveredTenantId === expectedTenantId/);
  assert.match(scannerSource, /\/api\/sync\/identify/);
  assert.doesNotMatch(scannerSource, /\/api\/network\/identify/);
});
