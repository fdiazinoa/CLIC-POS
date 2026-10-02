import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFloorPlanAcknowledged } from '../utils/floorPlanAck';

const rooms = [{ id: 'room-1', nombre: 'Sala principal', name: 'Sala principal', data: { width: 1200, height: 800 } }];
const tables = [{
  id: 'table-1', roomId: 'room-1', nombre: 'Mesa 1', name: 'Mesa 1', shape: 'SQUARE',
  posX: 20, posY: 30, width: 100, height: 100, rotation: 0, capacity: 4,
}];

test('layout ACK accepts exact layout while ignoring reconciled operational fields', () => {
  assert.doesNotThrow(() => assertFloorPlanAcknowledged(rooms, tables, rooms, [{
    ...tables[0],
    status: 'OCCUPIED',
    currentOrderId: 'order-1',
    currentOrderTotal: 500,
    editingLock: { ownerId: 'terminal-1' },
  }]));
});

test('layout ACK rejects missing, extra, duplicate, and empty IDs', () => {
  for (const acknowledgedTables of [
    [],
    [...tables, { ...tables[0], id: 'table-2' }],
    [...tables, { ...tables[0] }],
    [{ ...tables[0], id: '' }],
  ]) {
    assert.throws(() => assertFloorPlanAcknowledged(rooms, tables, rooms, acknowledgedTables), /LAYOUT_TABLES_ACK_MISMATCH/);
  }
  assert.throws(() => assertFloorPlanAcknowledged(rooms, tables, [], tables), /LAYOUT_ROOMS_ACK_MISMATCH/);
  assert.throws(() => assertFloorPlanAcknowledged(rooms, tables, [...rooms, { ...rooms[0] }], tables), /LAYOUT_ROOMS_ACK_MISMATCH/);
});

test('layout ACK rejects a changed layout field but ignores field order', () => {
  const reordered = {
    rotation: 0, height: 100, width: 100, posY: 30, posX: 20, shape: 'SQUARE',
    name: 'Mesa 1', nombre: 'Mesa 1', roomId: 'room-1', id: 'table-1', capacity: 4,
  };
  assert.doesNotThrow(() => assertFloorPlanAcknowledged(rooms, tables, rooms, [reordered]));
  assert.throws(() => assertFloorPlanAcknowledged(rooms, tables, rooms, [{ ...tables[0], posX: 21 }]), /LAYOUT_TABLES_ACK_MISMATCH/);
  assert.throws(() => assertFloorPlanAcknowledged(rooms, tables, [{ ...rooms[0], nombre: 'Otra sala' }], tables), /LAYOUT_ROOMS_ACK_MISMATCH/);
});
