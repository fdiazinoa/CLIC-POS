import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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

test('los botones permiten nombres de categoría en hasta dos líneas sin extender su columna', () => {
  const selectorStart = source.indexOf('CATEGORY SELECTOR BAR');
  const productsStart = source.indexOf('filteredProducts.map', selectorStart);
  const selectorSource = source.slice(selectorStart, productsStart);

  assert.ok(selectorStart >= 0, 'No se encontró el selector de categorías');
  assert.match(selectorSource, /w-full min-w-0/);
  assert.match(selectorSource, /leading-tight/);
  assert.match(selectorSource, /whitespace-normal text-center/);
  assert.match(selectorSource, /line-clamp-2/);
  assert.doesNotMatch(selectorSource, /whitespace-nowrap/);
});
