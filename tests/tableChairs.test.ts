import assert from 'node:assert/strict';
import test from 'node:test';

import { getTableChairSlots, resolveVisibleTableChairCount } from '../utils/tableChairs';

test('muestra cuatro sillas cuando la mesa no tiene capacidad configurada', () => {
  assert.equal(resolveVisibleTableChairCount(undefined), 4);
  assert.deepEqual(getTableChairSlots(undefined), [
    'TOP_CENTER',
    'BOTTOM_CENTER',
    'LEFT_CENTER',
    'RIGHT_CENTER'
  ]);
});

test('representa la capacidad sin saturar el plano', () => {
  assert.equal(getTableChairSlots(2).length, 2);
  assert.deepEqual(getTableChairSlots(6), [
    'TOP_LEFT',
    'TOP_RIGHT',
    'BOTTOM_LEFT',
    'BOTTOM_RIGHT',
    'LEFT_CENTER',
    'RIGHT_CENTER'
  ]);
  assert.equal(getTableChairSlots(20).length, 8);
});
