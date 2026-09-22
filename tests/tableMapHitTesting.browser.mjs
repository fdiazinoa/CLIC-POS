/**
 * Focused browser regression for the real TableMapLifecycleBoundary from App.tsx.
 * The child deliberately uses pointer-events:auto: a hidden map must still be
 * absent from hit testing, while a visible map must accept clicks and focus.
 *
 * Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package if
 * it is not on this project's module path:
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/tableMapHitTesting.browser.mjs
 * This is a host-browser contract, not Android or full-POS acceptance QA.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../tailwind.config.cjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const boundaries = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'TableMapLifecycleBoundary' && node.initializer) {
    boundaries.push(node.initializer.getText(ast));
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(boundaries.length, 1, 'use the one production TableMapLifecycleBoundary');

const css = (await postcss([tailwindcss({
  ...tailwindConfig,
  content: [{ raw: boundaries[0], extension: 'tsx' }],
})]).process('@tailwind utilities;', { from: undefined })).css;

const fixture = `
import React, { useRef, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
const markInteractionStage = () => {};
const TableMapLifecycleBoundary = ${boundaries[0]};
window.fixture = { navClicks: 0, mapClicks: 0 };
function Shell() {
  const [mapActive, setMapActive] = useState(false);
  window.fixture.setMapActive = active => flushSync(() => setMapActive(active));
  return <div id="shell" style={{ position: 'relative', width: 800, height: 500 }}>
    <nav id="sales-nav" style={{ position: 'absolute', inset: 0 }}>
      {['Venta', 'Mesas', 'Tickets', 'Cobrar', 'Menú'].map((name, index) =>
        <button key={name} id={'nav-' + index}
          style={{ position: 'absolute', left: 30 + index * 145, top: 60, width: 120, height: 50 }}
          onClick={() => window.fixture.navClicks++}>{name}</button>)}
    </nav>
    <TableMapLifecycleBoundary visible={mapActive}>
      <div id="map-surface" style={{ position: 'absolute', inset: 0, background: '#eee' }}>
        <button id="map-control" className="pointer-events-auto"
          style={{ position: 'absolute', left: 30, top: 60, width: 700, height: 50 }}
          onClick={() => window.fixture.mapClicks++}>Editar layout</button>
      </div>
    </TableMapLifecycleBoundary>
  </div>;
}
flushSync(() => createRoot(document.getElementById('root')).render(<Shell />));
`;
const bundle = (await build({
  stdin: { contents: fixture, resolveDir: root, loader: 'tsx' },
  bundle: true,
  write: false,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
})).outputFiles[0].text;

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setContent(`<style>${css}</style><div id="root"></div>`);
  await page.addScriptTag({ content: bundle });

  for (let cycle = 0; cycle < 50; cycle++) {
    await page.evaluate(() => window.fixture.setMapActive(true));
    assert.equal(await page.locator('[data-table-map-persistent-host]').evaluate(node => getComputedStyle(node).display === 'none'), false);
    assert.equal(await page.evaluate(() => document.elementFromPoint(90, 90)?.id), 'map-control');
    await page.locator('#map-control').click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'map-control');

    await page.evaluate(() => window.fixture.setMapActive(false));
    const hidden = await page.locator('[data-table-map-persistent-host]').evaluate(node => ({
      opacity: getComputedStyle(node).opacity,
      visibility: getComputedStyle(node).visibility,
      inert: node.inert,
      ariaHidden: node.getAttribute('aria-hidden'),
      focusInside: node.contains(document.activeElement),
    }));
    assert.deepEqual(hidden, { opacity: '0', visibility: 'visible', inert: true, ariaHidden: 'true', focusInside: false });
    for (let index = 0; index < 5; index++) {
      const id = `nav-${index}`;
      const point = { x: 90 + index * 145, y: 90 };
      assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), id,
        `cycle ${cycle + 1}: ${id} must not be covered by TableMap`);
      await page.locator(`#${id}`).click();
    }
  }

  assert.equal(await page.evaluate(() => window.fixture.mapClicks), 50);
  assert.equal(await page.evaluate(() => window.fixture.navClicks), 250);
  assert.deepEqual(errors, []);
  console.log('TableMap hit testing: 50/50 visible and hidden cycles passed');
} finally {
  await browser.close();
}
