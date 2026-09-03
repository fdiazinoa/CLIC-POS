import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const bridgeSource = readFileSync(
  new URL('../native-stubs/android/ClicPOSNativePrinterBridge.kt', import.meta.url),
  'utf8',
);
const serverSource = readFileSync(
  new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url),
  'utf8',
);

test('el watchdog consulta solo la revisión antes de serializar el snapshot restaurante', () => {
  assert.match(serverSource, /fun getRestaurantRevision\(\): JSONObject/);
  assert.match(bridgeSource, /fun getMasterRestaurantRevision\(payloadJson: String\?\): String/);
  assert.match(appSource, /getMasterRestaurantRevision: \(payload: unknown\) => call\('getMasterRestaurantRevision', payload\)/);
  assert.match(appSource, /const pollNativeRestaurantRevision = async \(\) =>/);
  assert.match(appSource, /revision <= masterRestaurantRevisionRef\.current/);
  assert.match(appSource, /await reconcileNativeRestaurantState\(\)/);
  assert.match(appSource, /setInterval\(\(\) => void pollNativeRestaurantRevision\(\), 1000\)/);
  assert.match(appSource, /ensureMasterServer\(false\)\.then\(\(\) => reconcileNativeRestaurantState\(\)\)/);
});

test('cambios de mesa o caja no reinician la publicación pesada del catálogo Master', () => {
  const dependencyBlock = appSource.slice(
    appSource.indexOf('  }, [\n    collections,'),
    appSource.indexOf('  ]);', appSource.indexOf('  }, [\n    collections,')),
  );
  assert.doesNotMatch(dependencyBlock, /cashMovements/);
  assert.doesNotMatch(dependencyBlock, /parkedTickets/);
  assert.doesNotMatch(dependencyBlock, /rooms/);
  assert.doesNotMatch(dependencyBlock, /tables/);
  assert.match(appSource, /masterOperationalSnapshotRef\.current/);
});

test('la Master Android no duplica el polling nativo con GET api mesas', () => {
  const pollingEffect = appSource.slice(
    appSource.indexOf('// Poll tables if in restaurant mode'),
    appSource.indexOf('// --- SYNC EVENT LISTENERS', appSource.indexOf('// Poll tables if in restaurant mode')),
  );
  assert.match(pollingEffect, /isNativeAndroidRuntime\(\) && isNativeStandaloneTerminalRuntime\(getCurrentTerminal\(\)\)/);
  assert.match(pollingEffect, /return;/);
  assert.match(pollingEffect, /setInterval\(fetchTables, isClientTerminalMode\(\) \? 3000 : 10000\)/);
});
