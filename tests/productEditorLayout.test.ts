import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { resolveProductEditorCapabilities } from '../utils/productEditorTabs';
import { normalizeProductTaxRate, resolveProductSummaryStock } from '../utils/productEditorSummary';

const source = fs.readFileSync(new URL('../components/ProductForm.tsx', import.meta.url), 'utf8');

test('product editor capabilities keep tabs contextual to the real article type', () => {
  assert.deepEqual(resolveProductEditorCapabilities('SERVICE', false), {
    inventory: false,
    variants: false,
    production: false,
  });
  assert.deepEqual(resolveProductEditorCapabilities('PRODUCT', false), {
    inventory: true,
    variants: true,
    production: false,
  });
  assert.deepEqual(resolveProductEditorCapabilities('PRODUCT', true), {
    inventory: true,
    variants: false,
    production: true,
  });
  assert.equal(resolveProductEditorCapabilities('KIT', false).production, true);
});

test('editor summary accepts legacy tax percentages and falls back to general stock', () => {
  assert.equal(normalizeProductTaxRate(18), 0.18);
  assert.equal(normalizeProductTaxRate(0.18), 0.18);
  assert.equal(resolveProductSummaryStock([], 40), 40);
  assert.equal(resolveProductSummaryStock([2, 3], 40), 5);
  assert.equal(resolveProductSummaryStock([0], 40), 0);
});

test('editor shell keeps header, primary tabs and footer outside the central scroll region', () => {
  assert.match(source, /<ProductEditorHeader[\s\S]*<ProductEditorTabs tabs=\{primaryTabs\}/);
  assert.match(source, /<main className="min-h-0 flex-1 overflow-y-auto/);
  assert.match(source, /<\/main>[\s\S]*className="flex shrink-0 items-center justify-between/);
});

test('legacy classifications, taxes and multimedia are rehomed instead of exposed as primary tabs', () => {
  assert.doesNotMatch(source, /id: 'CLASSIFICATION', label: 'Clasificación'/);
  assert.doesNotMatch(source, /id: 'TAXES', label: 'Impuestos'/);
  assert.doesNotMatch(source, /activeTab === 'CLASSIFICATION'/);
  assert.match(source, /activeTab === 'OPERATIVE'[\s\S]*Impuestos Aplicables/);

  const kardexStart = source.indexOf("activeTab === 'KARDEX'");
  const generalStart = source.indexOf("activeTab === 'GENERAL'", kardexStart);
  assert.equal(source.slice(kardexStart, generalStart).includes('Video del producto'), false);
  assert.match(source.slice(generalStart), />Multimedia</);
});
