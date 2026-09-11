import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = readFileSync(new URL('../components/CatalogManager.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

test('mantiene los controles fuera del scroll vertical del listado', () => {
  assert.match(catalog, /data-catalog-controls[^>]+shrink-0/);
  assert.match(catalog, /data-catalog-scroll[^>]+min-h-0[^>]+flex-1[^>]+overflow-y-auto[^>]+overscroll-contain/);
  assert.match(catalog, /viewMode === 'PRODUCTS' \? 'overflow-hidden'/);
});

test('organiza cada artículo en ocho bloques sin sombra de tarjeta', () => {
  assert.match(styles, /\.catalog-product-row\s*\{/);
  assert.match(styles, /minmax\(170px, 1\.7fr\)/);
  assert.match(catalog, /catalog-product-row relative select-none bg-white px-3 py-4/);
  assert.match(catalog, /rounded-2xl border border-gray-200 bg-white divide-y/);
  assert.doesNotMatch(catalog, /rounded-2xl border border-gray-200 bg-white shadow-sm divide-y/);
});

test('sube la navegación y sustituye Salir por una X a la derecha', () => {
  assert.match(catalog, /data-catalog-navigation[^>]+flex items-center[^>]+px-6 py-3/);
  assert.match(catalog, /data-catalog-navigation[\s\S]*aria-label="Cerrar catálogo"[\s\S]*<X size=\{22\}/);
  assert.doesNotMatch(catalog, /<ArrowLeft size=\{22\} strokeWidth=\{2\.8\} \/> Salir/);
});
