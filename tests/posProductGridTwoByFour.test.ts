import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

test('el catálogo expandido distribuye cuatro columnas en dos filas completas', () => {
  const gridStart = source.indexOf('const gridClass');
  const gridEnd = source.indexOf('const categoryContainerClass', gridStart);
  const gridSource = source.slice(gridStart, gridEnd);

  assert.ok(gridStart >= 0, 'No se encontró la configuración del grid de artículos');
  assert.match(gridSource, /grid-cols-4 gap-3 content-start overflow-y-auto px-4 py-3/);
  assert.match(gridSource, /gridAutoRows: 'calc\(\(100% - 0\.75rem\) \/ 2\)'/);
});

test('las tarjetas expandidas ocupan su fila sin conservar alturas fijas que corten la segunda línea', () => {
  const cardStart = source.indexOf("showProductImages\n            ? usesSupermarketLayout");
  const cardEnd = source.indexOf('warehouseSaleBlocked && (', cardStart);
  const cardSource = source.slice(cardStart, cardEnd);

  assert.ok(cardStart >= 0, 'No se encontró la tarjeta de artículo');
  assert.match(cardSource, /h-full min-h-0 rounded-\[1\.4rem\]/);
  assert.match(cardSource, /grid-rows-\[52%_48%\]/);
  assert.doesNotMatch(cardSource, /usesExpandedCatalog\s*\?\s*'[^']*h-\[214px\]/);
  assert.doesNotMatch(cardSource, /usesExpandedCatalog\s*\?\s*'[^']*h-\[168px\]/);
});

test('el área de artículos conserva márgenes simétricos y calcula las filas sobre el viewport desplazable', () => {
  const gridStart = source.indexOf('const gridClass');
  const gridEnd = source.indexOf('const categoryContainerClass', gridStart);
  const gridSource = source.slice(gridStart, gridEnd);
  const productsStart = source.indexOf('filteredProducts.map');
  const productsSource = source.slice(productsStart - 800, productsStart + 200);
  const paddingStart = source.indexOf('const bottomAwareScrollStyle');
  const paddingEnd = source.indexOf('const mobileFooterStyle', paddingStart);
  const paddingSource = source.slice(paddingStart, paddingEnd);

  assert.match(gridSource, /overflow-y-auto px-4 py-3/);
  assert.match(productsSource, /usesExpandedCatalog \? 'overflow-hidden'/);
  assert.match(paddingSource, /usesExpandedCatalog\s*\? '0px'/);
  assert.doesNotMatch(paddingSource, /usesExpandedCatalog[\s\S]*var\(--bottom-safe-offset/);
});
