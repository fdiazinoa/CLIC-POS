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
  assert.match(serverSource, /if \(ticket\.optString\("tableId"\) != tableId\)/);
  assert.match(serverSource, /\.put\("tables", buildTablesWithEditLocks\(\)\)/);
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
  assert.match(appSource, /attempt <= 6/);
  assert.match(appSource, /resolveOperationalApiUrl\('\/api\/sync\/ping'\)/);
});
