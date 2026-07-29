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
  assert.match(serverSource, /\.put\("tables", JSONArray\(tablesSnapshot\.toString\(\)\)\)/);
  assert.match(serverSource, /\.put\("parkedTickets", JSONArray\(parkedTicketsSnapshot\.toString\(\)\)\)/);
});

test('la Master Android permite abrir y liberar mesas desde una terminal cliente', () => {
  assert.match(serverSource, /method == "POST" && path == "\/api\/mesas\/abrir"/);
  assert.match(serverSource, /method == "POST" && path == "\/api\/mesas\/liberar"/);
  assert.match(serverSource, /private fun handleOpenTable/);
  assert.match(serverSource, /private fun handleReleaseTable/);
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

test('la Master Android implementa autenticación y lectura de catálogos para clientes', () => {
  assert.match(serverSource, /method == "POST" && path == "\/api\/sync\/auth"/);
  assert.match(serverSource, /path\.startsWith\("\/api\/sync\/collections\/"\) && path\.endsWith\("\/data"\)/);
  assert.match(serverSource, /path\.startsWith\("\/api\/sync\/delta\/"\)/);
  assert.match(serverSource, /method == "GET" && path == "\/api\/sync\/config"/);
  assert.match(serverSource, /"users" -> JSONArray\(usersSnapshot\.toString\(\)\)/);
  assert.match(serverSource, /catalogSnapshots\.optJSONArray\(collection\)/);
  assert.match(serverSource, /X-Sync-Token/);
  assert.match(serverSource, /reconcileTablesWithParkedTickets\(tablesSnapshot, tickets\)/);
});

test('la Master Android se reactiva al volver al primer plano y el cliente reintenta con espera', () => {
  assert.match(appSource, /addListener\?\.\('resume', ensureMasterServerWithoutSnapshot\)/);
  assert.match(appSource, /attempt <= 6/);
  assert.match(appSource, /resolveOperationalApiUrl\('\/api\/sync\/ping'\)/);
});
