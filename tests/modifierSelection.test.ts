import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isModifierSelectionCapped,
  modifierGroupRemainingSlots,
  modifierGroupSelectionLimit,
  modifierGroupSelectionMinimum,
  modifierSelectionCapNotice,
} from '../utils/modifierSelection';

test('a multiple group is capped by max_select, a single group by one', () => {
  assert.equal(modifierGroupSelectionLimit({ selection_type: 'SINGLE', max_select: 5 }), 1);
  assert.equal(modifierGroupSelectionLimit({ selection_type: 'MULTIPLE', max_select: 3 }), 3);
  assert.equal(modifierGroupSelectionLimit({ max_select: null }), 0, 'no declared cap means no cap');
  assert.equal(modifierGroupSelectionLimit(null), 0);
  assert.equal(modifierGroupSelectionMinimum({ required: true }), 1);
  assert.equal(modifierGroupSelectionMinimum({ min_select: 2 }), 2);
  assert.equal(modifierGroupSelectionMinimum({ required: true, min_select: 2 }), 2);
});

test('the cap counts distinct options, never repeated ones', () => {
  const group = { selection_type: 'MULTIPLE', max_select: 2 };
  assert.equal(isModifierSelectionCapped(group, 1), false);
  assert.equal(isModifierSelectionCapped(group, 2), true);
  assert.equal(modifierGroupRemainingSlots(group, 0), 2);
  assert.equal(modifierGroupRemainingSlots(group, 1), 1);
  assert.equal(modifierGroupRemainingSlots(group, 2), 0);
  // An uncapped group never blocks.
  assert.equal(isModifierSelectionCapped({ selection_type: 'MULTIPLE', max_select: null }, 99), false);
  assert.equal(modifierGroupRemainingSlots({ selection_type: 'MULTIPLE', max_select: null }, 99), null);
});

test('the blocked tap explains the contract limit instead of doing nothing', () => {
  assert.equal(
    modifierSelectionCapNotice({ selection_type: 'MULTIPLE', max_select: 3 }),
    'Máximo 3 opciones distintas en este grupo.',
  );
  assert.equal(
    modifierSelectionCapNotice({ selection_type: 'SINGLE', max_select: 1 }),
    'Solo puedes elegir una opción en este grupo.',
  );
  assert.equal(modifierSelectionCapNotice({ selection_type: 'MULTIPLE', max_select: null }), '');
});
