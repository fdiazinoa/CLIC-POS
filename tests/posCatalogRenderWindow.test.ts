import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

test('el ticket monta solo una ventana inicial y conserva la búsqueda sobre todo el catálogo', () => {
  assert.match(source, /const CATALOG_RENDER_BATCH_SIZE = 64/);
  assert.match(source, /const visibleCatalogProducts = useMemo\([\s\S]*?filteredProducts\.slice\(0, visibleCatalogLimit\)/);
  assert.match(source, /!isRetailMode && visibleCatalogProducts\.map\(/);
  assert.doesNotMatch(source, /!isRetailMode && filteredProducts\.map\(/);
  assert.match(source, /sortedSalesCatalogProductEntries\.filter\(/);
  assert.match(source, /Ver más artículos/);
});

test('la ventana se reinicia por categoría o búsqueda y crece sin perder artículos', () => {
  assert.match(source, /catalogWindowKey = `\$\{categoryFilter\}\\u0000\$\{catalogSearchQuery\}`/);
  assert.match(source, /catalogWindow\.key === catalogWindowKey[\s\S]*?CATALOG_RENDER_BATCH_SIZE/);
  assert.match(source, /Math\.min\([\s\S]*?filteredProducts\.length,[\s\S]*?previous\.limit : CATALOG_RENDER_BATCH_SIZE\) \+ CATALOG_RENDER_BATCH_SIZE/);
  assert.match(source, /onScroll=\{handleCatalogScroll\}/);
  assert.match(source, /catalogViewportRef\.current\?\.scrollTo\(\{ top: 0 \}\)/);
  assert.match(source, /catalogGridRef\.current\?\.scrollTo\(\{ top: 0 \}\)/);
});
