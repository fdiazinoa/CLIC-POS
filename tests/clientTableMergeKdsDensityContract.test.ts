import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tableMapSource = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const nativeServerSource = readFileSync(
  new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url),
  'utf8',
);
const webServerSource = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');

test('la Cliente solicita una unión atómica y refresca el estado autoritativo de la Master', () => {
  const mergeSource = tableMapSource.slice(
    tableMapSource.indexOf("if (mode === 'MERGE') {"),
    tableMapSource.indexOf("if (mode === 'MOVE' && requestedItems)"),
  );

  assert.match(mergeSource, /requestJson<any>/);
  assert.match(mergeSource, /resolveOperationalApiUrl\('\/api\/mesas\/unir'\)/);
  assert.match(mergeSource, /mainTableId: primarySourceTableId/);
  assert.match(mergeSource, /secondaryTableIds: \[targetTable\.id\]/);
  assert.match(mergeSource, /await Promise\.resolve\(onRefreshTables\?\.\(\)\)/);
  assert.match(mergeSource, /response\.status !== 404 && response\.status !== 501/);
});

test('la Master Android consolida artículos y referencias de mesas en un solo ticket', () => {
  assert.match(nativeServerSource, /method == "POST" && path == "\/api\/mesas\/unir"/);
  assert.match(nativeServerSource, /@Synchronized\s+private fun handleJoinTables/);
  assert.match(nativeServerSource, /ticketsToJoin\.values\.forEach/);
  assert.match(nativeServerSource, /\.put\("primaryTableId", mainTableId\)/);
  assert.match(nativeServerSource, /\.put\("joinedTableIds", JSONArray\(memberTableIds\.toList\(\)\)\)/);
  assert.match(nativeServerSource, /applyClientRestaurantMutation\(tables = reconciledTables, parkedTickets = nextTickets\)/);
});

test('el servidor web conserva el mismo contrato de unión atómica', () => {
  const routeSource = webServerSource.slice(
    webServerSource.indexOf("server.post('/api/mesas/unir'"),
    webServerSource.indexOf("server.post('/api/mesas/liberar'"),
  );

  assert.match(routeSource, /getSetting\('parkedTickets'\)/);
  assert.match(routeSource, /const mergedItems = Array\.from\(ticketsToJoin\.values\(\)\)\.flatMap/);
  assert.match(routeSource, /primaryTableId: mainTableId/);
  assert.match(routeSource, /joinedTableIds: Array\.from\(memberTableIds\)/);
  assert.match(routeSource, /const updateTables = db\.transaction/);
});
