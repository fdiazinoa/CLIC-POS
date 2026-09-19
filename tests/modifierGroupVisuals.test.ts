import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  isModifierSelectionCountValid,
  MODIFIER_MODAL_LAYOUT,
  paginateModifierOptions,
} from '../utils/modifierModalPresentation';

test('el modal limita cada página a ocho opciones sin alterar el orden', () => {
  const options = Array.from({ length: 17 }, (_, index) => index + 1);
  assert.deepEqual(paginateModifierOptions(options, 0), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(paginateModifierOptions(options, 1), [9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(paginateModifierOptions(options, 2), [17]);
  assert.deepEqual(paginateModifierOptions(options, 99), [17]);
});

test('el contrato visual conserva cuadrícula táctil 4x2 y responsive a dos columnas', () => {
  assert.deepEqual(MODIFIER_MODAL_LAYOUT, {
    optionsPerPage: 8,
    minimumCardHeight: 88,
    landscapeColumns: 4,
    portraitColumns: 2,
  });

  const css = readFileSync(new URL('../components/ModifierModal.css', import.meta.url), 'utf8');
  assert.match(css, /grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /grid-template-rows:\s*repeat\(4,/);
  assert.match(css, /minmax\(88px,/);
  assert.match(css, /orientation:\s*landscape/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,/);
  assert.match(css, /grid-template-rows:\s*repeat\(2,/);
});

test('la validación conserva mínimos obligatorios y opcionales', () => {
  assert.equal(isModifierSelectionCountValid(0, { required: false, min_select: 0 }), true);
  assert.equal(isModifierSelectionCountValid(0, { required: true, min_select: 0 }), false);
  assert.equal(isModifierSelectionCountValid(1, { required: true, min_select: 0 }), true);
  assert.equal(isModifierSelectionCountValid(1, { required: false, min_select: 2 }), false);
  assert.equal(isModifierSelectionCountValid(2, { required: false, min_select: 2 }), true);
});
