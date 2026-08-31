import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolvePosCategoryGridPosition } from '../utils/posCategoryGrid';

const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

test('la barra de categorías usa dos filas con separación y conserva el desplazamiento horizontal', () => {
  const containerStart = source.indexOf('const categoryContainerClass');
  const containerEnd = source.indexOf('const allowedTariffs', containerStart);
  const containerSource = source.slice(containerStart, containerEnd);

  assert.ok(containerStart >= 0, 'No se encontró la configuración de la barra de categorías');
  assert.match(containerSource, /grid-flow-col grid-rows-2/);
  assert.match(containerSource, /gap-x-3 gap-y-2/);
  assert.match(containerSource, /overflow-x-auto overflow-y-hidden/);
});

test('las primeras seis categorías llenan la fila superior antes de usar la segunda', () => {
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => resolvePosCategoryGridPosition(index)),
    Array.from({ length: 6 }, (_, index) => ({ gridColumn: index + 1, gridRow: 1 })),
  );
  assert.deepEqual(resolvePosCategoryGridPosition(6), { gridColumn: 1, gridRow: 2 });
  assert.deepEqual(resolvePosCategoryGridPosition(11), { gridColumn: 6, gridRow: 2 });
});

test('más de doce categorías continúa horizontalmente en otro bloque de seis por dos', () => {
  assert.deepEqual(resolvePosCategoryGridPosition(12), { gridColumn: 7, gridRow: 1 });
  assert.deepEqual(resolvePosCategoryGridPosition(17), { gridColumn: 12, gridRow: 1 });
  assert.deepEqual(resolvePosCategoryGridPosition(18), { gridColumn: 7, gridRow: 2 });
  assert.deepEqual(resolvePosCategoryGridPosition(23), { gridColumn: 12, gridRow: 2 });
});

test('los botones permiten nombres de categoría en hasta dos líneas sin extender su columna', () => {
  const selectorStart = source.indexOf('CATEGORY SELECTOR BAR');
  const productsStart = source.indexOf('filteredProducts.map', selectorStart);
  const selectorSource = source.slice(selectorStart, productsStart);

  assert.ok(selectorStart >= 0, 'No se encontró el selector de categorías');
  assert.match(selectorSource, /w-full min-w-0/);
  assert.match(selectorSource, /leading-tight/);
  assert.match(selectorSource, /whitespace-normal text-center/);
  assert.match(selectorSource, /line-clamp-2/);
  assert.match(selectorSource, /resolvePosCategoryGridPosition\(idx\)/);
  assert.match(selectorSource, /style=\{\{ \.\.\.configuredStyle, \.\.\.categoryGridPosition \}\}/);
  assert.doesNotMatch(selectorSource, /whitespace-nowrap/);
});
