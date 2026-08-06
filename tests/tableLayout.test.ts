import assert from 'node:assert/strict';
import test from 'node:test';

import type { Table } from '../types';
import {
  findAvailableTablePosition,
  getRenderableFloorTables,
  hasExplicitTableLayout,
  selectAuthoritativeFloorPlan,
} from '../utils/tableLayout';

const erpTable = {
  id: 'TABLE_01',
  code: 'M01',
  label: 'Mesa 1',
  room_id: 'MAIN_DINING_ROOM',
  roomId: 'MAIN_DINING_ROOM',
  nombre: 'Mesa',
  name: 'Mesa',
  width: 100,
  height: 100,
  capacity: 1
} as Table;

const designedTable: Table = {
  id: 'tbl-local-1',
  roomId: 'MAIN_DINING_ROOM',
  nombre: 'Mesa 1',
  name: 'Mesa 1',
  posX: 80,
  posY: 20,
  width: 100,
  height: 100,
  shape: 'SQUARE',
  rotation: 0
};

test('un plano diseñado excluye registros ERP sin geometría sin borrarlos', () => {
  const source = [erpTable, designedTable];
  const rendered = getRenderableFloorTables(source);

  assert.deepEqual(rendered.map(table => table.id), ['tbl-local-1']);
  assert.equal(source.length, 2);
});

test('la Master conserva su layout diseñado frente a una cuadrícula bootstrap distinta', () => {
  const localTables = Array.from({ length: 3 }, (_, index) => ({
    id: `designed-${index + 1}`,
    roomId: 'room-designed',
    name: `Terraza ${index + 1}`,
    nombre: `Terraza ${index + 1}`,
    posX: 40 + (index * 140),
    posY: 40,
    width: 100,
    height: 100,
    shape: 'SQUARE' as const,
  })) as Table[];
  const bootstrapTables = Array.from({ length: 12 }, (_, index) => ({
    id: `bootstrap-${index + 1}`,
    roomId: 'default-room',
    name: `Mesa ${index + 1}`,
    nombre: `Mesa ${index + 1}`,
    posX: 80 + ((index % 4) * 140),
    posY: 80 + (Math.floor(index / 4) * 140),
    width: 100,
    height: 100,
    shape: 'SQUARE' as const,
  })) as Table[];

  const selected = selectAuthoritativeFloorPlan({
    local: { rooms: [{ id: 'room-designed', name: 'Terraza' } as any], tables: localTables },
    incoming: { rooms: [{ id: 'default-room', name: 'Sala 1' } as any], tables: bootstrapTables },
    isClientTerminal: false,
  });

  assert.equal(selected.reason, 'PRESERVE_MASTER_DESIGN');
  assert.deepEqual(selected.tables.map(table => table.id), localTables.map(table => table.id));
});

test('la Cliente acepta siempre el layout de su Master', () => {
  const selected = selectAuthoritativeFloorPlan({
    local: { rooms: [], tables: [designedTable] },
    incoming: { rooms: [], tables: [erpTable] },
    isClientTerminal: true,
  });

  assert.equal(selected.reason, 'CLIENT_ACCEPTS_MASTER');
  assert.deepEqual(selected.tables, [erpTable]);
});

test('la Master acepta estado operativo sin perder geometría cuando los UUID coinciden', () => {
  const incoming = {
    ...designedTable,
    name: 'Nombre genérico',
    nombre: 'Nombre genérico',
    posX: 0,
    posY: 0,
    status: 'OCCUPIED' as const,
    currentOrderId: 'ORDER-1',
    currentOrderTotal: 725,
  };
  const selected = selectAuthoritativeFloorPlan({
    local: { rooms: [], tables: [designedTable] },
    incoming: { rooms: [], tables: [incoming] },
    isClientTerminal: false,
  });

  assert.equal(selected.reason, 'SAME_LAYOUT_IDENTITY');
  assert.equal(selected.tables[0].posX, designedTable.posX);
  assert.equal(selected.tables[0].nombre, designedTable.nombre);
  assert.equal(selected.tables[0].status, 'OCCUPIED');
  assert.equal(selected.tables[0].currentOrderTotal, 725);
});

test('sin plano diseñado genera una cuadrícula operativa para mesas ERP', () => {
  const rendered = getRenderableFloorTables([erpTable]);

  assert.equal(rendered[0].id, 'TABLE_01');
  assert.equal(rendered[0].name, 'Mesa 1');
  assert.equal(rendered[0].shape, 'SQUARE');
  assert.equal(hasExplicitTableLayout(rendered[0]), true);
});

test('mantiene las mesas automáticas visibles si una de ellas recibe layout antes que las demás', () => {
  const bootstrapTables = Array.from({ length: 12 }, (_, index) => ({
    id: `bootstrap-${index + 1}`,
    roomId: 'MAIN_DINING_ROOM',
    code: `M${String(index + 1).padStart(2, '0')}`,
    label: `Mesa ${index + 1}`,
    nombre: `Mesa ${index + 1}`,
    name: `Mesa ${index + 1}`,
    posX: index === 0 ? 80 : Number.NaN,
    posY: index === 0 ? 80 : Number.NaN,
    width: index === 0 ? 100 : 0,
    height: index === 0 ? 100 : 0,
    shape: 'SQUARE' as const,
    rotation: 0
  }));

  const rendered = getRenderableFloorTables(bootstrapTables);

  assert.equal(rendered.length, 12);
  assert.deepEqual(rendered.map(table => table.nombre), Array.from({ length: 12 }, (_, index) => `Mesa ${index + 1}`));
});

test('consolida el plano persistido y la cuadrícula Master sin superponer mesas equivalentes', () => {
  const designedTables = Array.from({ length: 12 }, (_, index) => ({
    id: `local-${index + 1}`,
    roomId: 'MAIN_DINING_ROOM',
    nombre: `Mesa ${index + 1}`,
    name: `Mesa ${index + 1}`,
    posX: 80 + ((index % 4) * 140),
    posY: 80 + (Math.floor(index / 4) * 140),
    width: 100,
    height: 100,
    shape: 'SQUARE' as const,
    rotation: 0
  }));
  const masterTables = Array.from({ length: 12 }, (_, index) => ({
    id: `TABLE_${String(index + 1).padStart(2, '0')}`,
    roomId: 'MAIN_DINING_ROOM',
    room_id: 'MAIN_DINING_ROOM',
    code: `M${String(index + 1).padStart(2, '0')}`,
    label: `Mesa ${index + 1}`,
    nombre: 'Mesa',
    name: 'Mesa',
    width: 100,
    height: 100,
    ...(index === 2 ? {
      status: 'OCCUPIED' as const,
      currentOrderId: 'ORDER-3',
      currentOrderTotal: 350
    } : {})
  })) as Table[];

  const rendered = getRenderableFloorTables([...designedTables, ...masterTables]);
  const tableThree = rendered.find(table => table.nombre === 'Mesa 3');

  assert.equal(rendered.length, 12);
  assert.equal(tableThree?.id, 'TABLE_03');
  assert.equal(tableThree?.status, 'OCCUPIED');
  assert.equal(tableThree?.posX, designedTables[2].posX);
  assert.equal(tableThree?.posY, designedTables[2].posY);
});

test('ubica cada mesa nueva en el primer espacio libre sin concentrarlas', () => {
  const tables: Table[] = [];

  for (let index = 0; index < 4; index += 1) {
    const position = findAvailableTablePosition(tables, {
      roomId: 'MAIN_DINING_ROOM',
      width: 100,
      height: 100
    });
    tables.push({
      id: `new-${index + 1}`,
      roomId: 'MAIN_DINING_ROOM',
      name: `Mesa ${index + 1}`,
      nombre: `Mesa ${index + 1}`,
      shape: 'SQUARE',
      width: 100,
      height: 100,
      rotation: 0,
      ...position
    });
  }

  assert.deepEqual(
    tables.map(table => [table.posX, table.posY]),
    [[40, 40], [160, 40], [280, 40], [400, 40]]
  );
});
