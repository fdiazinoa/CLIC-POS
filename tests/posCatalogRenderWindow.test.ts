import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

test('venta conserva el catálogo completo para búsqueda y lector, pero virtualiza ProductCard', () => {
  assert.match(source, /catalogProductsForGrid\.slice\(virtualCatalogWindow\.startIndex, virtualCatalogWindow\.endIndex\)/);
  assert.match(source, /!isRetailMode && visibleCatalogProducts\.map\(/);
  assert.doesNotMatch(source, /!isRetailMode && filteredProducts\.map\(/);
  assert.match(source, /sortedSalesCatalogProductEntries\.filter\(/);
  assert.match(source, /salesCatalogProductEntries\.find\(/);
  assert.doesNotMatch(source, /Ver más artículos/);
});

test('la ventana depende del viewport y preserva scroll entre Venta y Mesas', () => {
   assert.match(source, /catalogWindowKey = `\$\{categoryFilter\}\\u0000\$\{catalogSearchQuery\}`/);
  assert.match(source, /catalogViewportWindow\(\{/);
  assert.match(source, /overscanRows: CATALOG_OVERSCAN_ROWS/);
  assert.match(source, /new ResizeObserver\(measure\)/);
  assert.match(source, /catalogScroll\.key === catalogWindowKey \? catalogScroll\.top : 0/);
  assert.match(source, /onScroll=\{handleCatalogScroll\}/);
  assert.match(source, /catalogViewportRef\.current\?\.scrollTo\(\{ top: 0 \}\)/);
  assert.match(source, /data-catalog-product-count=\{catalogProductsForGrid\.length\}/);
  assert.match(source, /data-catalog-card-count=\{visibleCatalogProducts\.length\}/);
});
