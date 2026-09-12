import assert from 'node:assert/strict';
import test from 'node:test';

import { getTableChairSlots } from '../utils/tableChairs';

test('el layout con sillas siempre muestra una silla por cada lado', () => {
  assert.deepEqual(getTableChairSlots(), [
    'TOP_CENTER',
    'BOTTOM_CENTER',
    'LEFT_CENTER',
    'RIGHT_CENTER'
  ]);
});

test('cada lectura devuelve una colección independiente', () => {
  const first = getTableChairSlots();
  first.pop();
  assert.equal(getTableChairSlots().length, 4);
});
