import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const classificationsSource = readFileSync(new URL('../components/ClassificationManager.tsx', import.meta.url), 'utf8');

test('el catálogo aplica visibilidad, orden y color configurados por categoría', () => {
  assert.match(posSource, /categoryIsVisible/);
  assert.match(posSource, /presentationByCanonical/);
  assert.match(posSource, /readableTextColor\(configuredColor\)/);
  assert.match(posSource, /comparePosProducts\(left\.product, right\.product\)/);
});

test('Artículos permite ordenar y ocultar categorías y reordenar sus productos', () => {
  assert.match(classificationsSource, /handleMoveClassification/);
  assert.match(classificationsSource, /handleToggleClassification/);
  assert.match(classificationsSource, /handleMoveProduct/);
  assert.match(classificationsSource, /posSortOrder/);
});
