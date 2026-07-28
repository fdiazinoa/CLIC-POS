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
