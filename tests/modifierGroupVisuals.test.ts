import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getModifierGroupVisualStyle,
  MODIFIER_GROUP_VISUAL_STYLES,
} from '../components/ModifierModal';

test('cada grupo consecutivo recibe un color visual diferente', () => {
  const first = getModifierGroupVisualStyle(0);
  const second = getModifierGroupVisualStyle(1);
  const third = getModifierGroupVisualStyle(2);

  assert.notEqual(first.section, second.section);
  assert.notEqual(second.section, third.section);
  assert.match(first.section, /border-blue/);
  assert.match(second.section, /border-amber/);
});

test('la paleta de grupos rota de forma estable', () => {
  assert.deepEqual(
    getModifierGroupVisualStyle(MODIFIER_GROUP_VISUAL_STYLES.length),
    getModifierGroupVisualStyle(0),
  );
});
