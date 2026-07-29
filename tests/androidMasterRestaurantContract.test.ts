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
  assert.match(appSource, /\{ port: 3001, config, users, rooms, tables, parkedTickets \}/);
  assert.match(appSource, /const ensureMasterServerWithoutSnapshot = \(\) => ensureMasterServer\(false\);/);
});
