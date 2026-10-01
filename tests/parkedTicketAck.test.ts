import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertParkedTicketsAcknowledged } from '../utils/parkedTicketAck';
import { mergeParkedTicketsForTable, parsePersistedParkedTickets } from '../server/tableTicketMerge';

const serverSource = readFileSync(new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url), 'utf8');
const expressSource = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');

test('la Master serializa el RMW de tickets con los snapshots publicados por la WebView', () => {
  assert.match(serverSource, /@Synchronized\s+fun start\(/);
  assert.match(serverSource, /@Synchronized\s+fun updateConfig\(/);
  assert.match(serverSource, /@Synchronized\s+private fun handleParkedTicketsUpdate\(/);
  assert.match(serverSource, /@Synchronized\s+private fun handleTableUpdate\(/);
  assert.match(serverSource, /@Synchronized\s+private fun handleOpenTable\(/);
  assert.match(serverSource, /@Synchronized\s+private fun handleReleaseTable\(/);
  assert.match(serverSource, /@Synchronized\s+private fun buildRestaurantSnapshot\(/);
  assert.match(serverSource, /@Synchronized\s+private fun serializeRestaurantSnapshot\(/);
});

test('el ACK confirma la cuenta y los artículos exactos, no solo success=true', () => {
  const sent = [{ id: 'cuenta-4', tableId: 'mesa-4', items: [{ id: 'agua', quantity: 2, price: 60 }], total: 120 }];
  assert.doesNotThrow(() => assertParkedTicketsAcknowledged(sent, [
    { id: 'cuenta-7', tableId: 'mesa-7', items: [], total: 0 },
    { id: 'cuenta-4', tableId: 'mesa-4', items: [{ price: 60, quantity: 2, id: 'agua' }], total: 120 },
  ], 'cuenta-4', 'mesa-4'));
  assert.throws(() => assertParkedTicketsAcknowledged(sent, [
    { id: 'cuenta-4', tableId: 'mesa-4', items: [], total: 0 },
  ], 'cuenta-4', 'mesa-4'), /PARKED_TICKETS_ACK_MISMATCH/);
  assert.throws(() => assertParkedTicketsAcknowledged(sent, [
    { id: 'cuenta-7', tableId: 'mesa-7', items: [], total: 0 },
  ], 'cuenta-4', 'mesa-4'), /PARKED_TICKETS_ACK_MISMATCH/);
  assert.throws(() => assertParkedTicketsAcknowledged(sent, [
    { id: 'cuenta-4', tableId: 'mesa-7', items: [{ id: 'agua', quantity: 2, price: 60 }], total: 120 },
  ], 'cuenta-4'), /PARKED_TICKETS_ACK_MISMATCH/);
});

test('el ACK no acepta una cuenta eliminada ni una cuenta extra de la misma mesa', () => {
  assert.throws(() => assertParkedTicketsAcknowledged([], [
    { id: 'cuenta-4', tableId: 'mesa-4', items: [], total: 0 },
  ], 'cuenta-4', 'mesa-4'), /PARKED_TICKETS_ACK_MISMATCH/);
  assert.throws(() => assertParkedTicketsAcknowledged([
    { id: 'cuenta-4', tableId: 'mesa-4', items: [], total: 0 },
  ], [
    { id: 'cuenta-4', tableId: 'mesa-4', items: [], total: 0 },
    { id: 'cuenta-4b', tableId: 'mesa-4', items: [], total: 0 },
  ], 'cuenta-4', 'mesa-4'), /PARKED_TICKETS_ACK_MISMATCH/);
});

test('Express confirma también la cuenta recién abierta sin artículos', () => {
  const parkedTicketRoute = expressSource.slice(
    expressSource.indexOf("server.put('/api/mesas/parked-tickets'"),
    expressSource.indexOf('// Mover mesa'),
  );
  assert.match(parkedTicketRoute, /mergeParkedTicketsForTable\(getPersistedParkedTickets\(true\), parkedTickets, tableId\)/);
  assert.match(parkedTicketRoute, /saveSetting\('parkedTickets', nextTickets\)/);
  assert.match(parkedTicketRoute, /success: true,\s*parkedTickets: nextTickets/);
  assert.match(expressSource, /const getPersistedParkedTickets = \(strict = false\)/);
  assert.match(expressSource, /return parsePersistedParkedTickets\(parkedTicketsBlob \? parkedTicketsBlob.value : null, strict\)/);
  assert.match(expressSource, /catch \(error\) \{\s*if \(strict\) throw error;/);
  assert.doesNotMatch(expressSource, /getOpenParkedTickets/);
});

test('Express rechaza un snapshot ilegible antes de sobrescribir otra mesa', () => {
  assert.deepEqual(parsePersistedParkedTickets(null, true), []);
  assert.deepEqual(parsePersistedParkedTickets('[{"id":"cuenta-4","items":[]}]', true), [{ id: 'cuenta-4', items: [] }]);
  assert.throws(() => parsePersistedParkedTickets('{mal-json', true));
  assert.throws(() => parsePersistedParkedTickets('{"id":"no-array"}', true), /PARKED_TICKETS_SNAPSHOT_INVALID/);
  const releaseRoute = expressSource.slice(
    expressSource.indexOf("server.post('/api/mesas/liberar'"),
    expressSource.indexOf('// Helper to process json-server style queries'),
  );
  assert.ok(releaseRoute.indexOf('getPersistedParkedTickets(true)') < releaseRoute.indexOf("saveSetting('parkedTickets', nextParkedTickets)"));
  assert.doesNotMatch(releaseRoute, /getSetting\('parkedTickets'\)/);
});

test('Express actualiza solo la mesa digitada y conserva cuentas ajenas y vacías', () => {
  const existing = [
    { id: 'cuenta-4', tableId: 'mesa-4', items: [], total: 0 },
    { id: 'cuenta-7', tableId: 'mesa-7', items: [{ id: 'cafe' }], total: 100 },
  ];
  const changed = [{ id: 'cuenta-4', tableId: 'mesa-4', items: [{ id: 'agua' }], total: 60 }];
  const merged = mergeParkedTicketsForTable(existing, changed, 'mesa-4');
  assert.deepEqual(merged, [existing[1], changed[0]]);
  assert.doesNotThrow(() => assertParkedTicketsAcknowledged(changed, merged, 'cuenta-4', 'mesa-4'));
  assert.deepEqual(mergeParkedTicketsForTable(existing, [], 'mesa-4'), [existing[1]]);
});
