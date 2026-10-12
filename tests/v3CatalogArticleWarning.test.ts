import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import V3CatalogArticleWarning from '../components/V3CatalogArticleWarning';

test('warning renders bounded catalog flex row with SKU/code/reason, and disappears for cleared query', () => {
  const html = renderToStaticMarkup(React.createElement(V3CatalogArticleWarning, { diagnostics: [
    { articleId: 'rice', sku: 'ARR-001', code: 'SYNC_V3_ADVANCED_ARTICLE_CONTRACT_REQUIRED', reason: 'unidades incompatibles' },
  ] }));
  assert.match(html, /<aside role="status"/); assert.match(html, /ARR-001/); assert.match(html, /SYNC_V3_ADVANCED_ARTICLE_CONTRACT_REQUIRED/);
  assert.match(html, /unidades incompatibles/); assert.match(html, /shrink-0 max-h-24 overflow-y-auto/);
  assert.doesNotMatch(html, /fixed|absolute/);
  assert.equal(renderToStaticMarkup(React.createElement(V3CatalogArticleWarning, { diagnostics: [] })), '');
});

test('warning lives INSIDE actual fixed opaque POS catalog shell below header; wrapper has no obscured sibling', () => {
  const shell = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const fixedRoot = shell.indexOf('clic-pos-device-shell fixed inset-0');
  const catalogArea = shell.indexOf('{/* LEFT AREA: PRODUCTS */}', fixedRoot);
  const headerEnd = shell.indexOf('</header>', catalogArea);
  const warning = shell.indexOf('<V3CatalogArticleWarning diagnostics=', headerEnd);
  const nextSection = shell.indexOf('{/*', warning);
  assert.ok(fixedRoot > 0 && catalogArea > fixedRoot && headerEnd > catalogArea && warning > headerEnd && warning < nextSection);
  assert.match(shell.slice(headerEnd, warning), /^<\/header>\s*$/);
  const wrapper = readFileSync(new URL('../components/LargeMasterSyncV3OperationalPOS.tsx', import.meta.url), 'utf8');
  assert.match(wrapper, /catalogArticleDiagnostics=\{articleDiagnostics\}/);
  assert.doesNotMatch(wrapper, /articleDiagnostics\.length > 0 && <div/);
});
