import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertParkedTicketsAcknowledged } from '../utils/parkedTicketAck';

const serverSource = readFileSync(new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url), 'utf8');

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
