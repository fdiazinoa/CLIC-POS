import assert from 'node:assert/strict';
import test from 'node:test';

import type { Table } from '../types';
import { getRenderableFloorTables, hasExplicitTableLayout } from '../utils/tableLayout';

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
