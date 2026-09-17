/**
 * Host-browser regression, not an Android/peripheral or full POS acceptance test.
 * Run after npm run build. Supply PLAYWRIGHT_MODULE (module path or package name)
 * and optionally CHROMIUM_EXECUTABLE; browser tooling is external to product deps.
 * RETAINED_POS_BASE defaults to the approved base. RETAINED_POS_OUT must be outside
 * the repository. The production host/boundary initializers and route predicate
 * are extracted by TypeScript AST, while the expensive POS child is a fixture.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../tailwind.config.cjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const base = process.env.RETAINED_POS_BASE || '16f7c21d6c9eb88bfc9295bb31e7d789fabf102f';
const requestedOut = process.env.RETAINED_POS_OUT;
if (requestedOut) assert.ok(!fs.existsSync(requestedOut), 'use a new evidence directory; never overwrite previous runs');
const taskOutPath = requestedOut || fs.mkdtempSync(path.join(os.tmpdir(), 'retained-pos-'));
fs.mkdirSync(taskOutPath, { recursive: true });
const out = fs.realpathSync(taskOutPath);
assert.ok(out !== fs.realpathSync(root) && !out.startsWith(fs.realpathSync(root) + path.sep), 'evidence must be outside the repo');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const source = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const original = git('show', `${base}:App.tsx`);
const initializer = (text, name) => {
  const ast = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) matches.push(node.initializer.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(matches.length, 1, `unique source initializer: ${name}`);
  return matches[0];
};
const cssFiles = fs.readdirSync(path.join(root, 'dist/assets')).filter(name => name.endsWith('.css')).sort();
assert.ok(cssFiles.length, 'compile candidate CSS first');
const css = cssFiles.map(name => fs.readFileSync(path.join(root, 'dist/assets', name), 'utf8')).join('\n');
// The candidate build purges the removed .invisible utility. Compile the real
// baseline host's utilities with the same Tailwind config and include them in
// BOTH arms, so the negative control remains sensitive without hand-written CSS.
const controlCss = (await postcss([tailwindcss({ ...tailwindConfig,
  content: [{ raw: initializer(original, 'PersistentPOSHost'), extension: 'tsx' }],
})]).process('@tailwind utilities;', { from: undefined })).css;
const makeBundle = async text => (await build({
  stdin: { contents: `
import React, { useRef, useLayoutEffect, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync, createPortal } from 'react-dom';
import { focusSalesScannerInput } from './utils/globalBarcodeCapture';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
const getLatestPosInteraction = () => undefined;
const markInteractionStage = () => {};
const markInteractionVisibleAndInteractive = () => {};
window.fixture = { mounts: 0, scans: [], events: [], clicks: 0, mapClicks: 0 };
function POSInterface({ mode, onAdd }) {
  const [cart, setCart] = useState(2);
  const [query, setQuery] = useState('café');
  const [modal, setModal] = useState(false);
  useEffect(() => { window.fixture.mounts++; }, []);
  window.fixture.setModal = value => flushSync(() => setModal(value));
  return <main data-pos-scanner-enabled={modal ? 'false' : 'true'}>
    <input id="search" data-barcode-scanner-target="true" inputMode="search" enterKeyHint="search"
      className={mode === 'main' ? 'w-full h-11 bg-gray-100 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500' : 'w-full h-11 bg-gray-100 outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 transition-all'}
      value={query} onChange={e => setQuery(e.target.value)} />
    <input id="manual" defaultValue="Cliente conservado" />
    <output id="cart">{cart}</output><output id="table">Mesa 7 / Ticket 12</output>
    <div id="grid">{Array.from({ length: 76 }, (_, i) => <button key={i} data-card={i}
      className="pos-product-card w-full min-w-0 bg-white border border-gray-100 transition-all group relative overflow-hidden cursor-pointer hover:border-purple-300 hover:-translate-y-1 active:scale-95 rounded-[2rem] p-3 min-h-[214px] shadow-sm flex flex-col hover:shadow-xl"
      style={{ touchAction: 'manipulation', contentVisibility: 'auto', containIntrinsicSize: '214px' }}
      onClick={() => { setCart(n => n + 1); onAdd(); }}>
      <div className="h-28 rounded-[1.5rem] mb-2.5 bg-gray-50 relative flex items-center justify-center"><span><svg width="48" height="48"><g><path d="M0 0h40v40H0z" /></g></svg></span></div>
      <div><span><b>Artículo {i}</b></span><span><small>Detalle {i}</small></span><div><strong>RD$100.00</strong><em>Disponible</em></div></div>
    </button>)}</div>
    <button id="fixed-child" style={{ position: 'fixed', bottom: 0, right: 0 }}>Acción fija POS</button>
    {modal && createPortal(<div role="dialog" aria-modal="true" id="portal-modal" style={{ position: 'fixed', inset: 20, background: 'white', zIndex: 100 }}><input id="modal-input" /><button>Modal</button></div>, document.body)}
  </main>;
}
const MemoizedPOSInterface = React.memo(POSInterface);
const PersistentPOSHost = ${initializer(text, 'PersistentPOSHost')};
const TableMapLifecycleBoundary = ${initializer(text, 'TableMapLifecycleBoundary')};
function Shell() {
  const [currentView, setCurrentView] = useState('POS');
  const scannerEnabledViews = ${initializer(text, 'scannerEnabledViews')};
  useBarcodeScanner({ enabled: scannerEnabledViews, onScan: code => window.fixture.scans.push(code) });
  window.fixture.toggle = show => flushSync(() => setCurrentView(show ? 'POS' : 'TABLE_MAP'));
  window.fixture.focus = () => focusSalesScannerInput(document);
  return <div className="h-screen overflow-hidden relative">
    <PersistentPOSHost visible={currentView === 'POS'} mode={window.mode} onAdd={() => window.fixture.clicks++} />
    <div id="map-layer" style={{ position: 'absolute', inset: 0, zIndex: 40, pointerEvents: currentView === 'POS' ? 'none' : 'auto' }}>
      <TableMapLifecycleBoundary visible={currentView === 'TABLE_MAP'}><div id="map" style={{ background: 'white', height: '100%' }}><button id="map-control" onClick={() => window.fixture.mapClicks++}>Control Mesas</button></div></TableMapLifecycleBoundary>
    </div>
  </div>;
}
document.addEventListener('transitionrun', e => window.fixture.events.push({ property: e.propertyName, card: e.target.hasAttribute('data-card') }));
flushSync(() => createRoot(document.querySelector('#root')).render(<Shell />));
window.fixture.host = document.querySelector('[data-pos-persistent-host]');
window.fixture.input = document.querySelector('#search');
window.fixture.nodes = [...window.fixture.host.querySelectorAll('*')];
`, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
})).outputFiles[0].text;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const results = [];
try {
  for (const [variant, text] of [['baseline', original], ['candidate', source]]) {
    const bundle = await makeBundle(text);
    for (const mode of ['main', 'retail', 'mobile']) {
      const page = await browser.newPage({ viewport: { width: mode === 'mobile' ? 390 : 1280, height: 800 } });
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.setContent(`<style>${controlCss}\n${css}</style><style>body{margin:0}#grid{display:grid;grid-template-columns:repeat(6,1fr);height:690px;overflow:auto}#outside{position:fixed;right:0;top:0;z-index:80}</style><button id="outside">Otro control</button><div id="root"></div>`);
      await page.evaluate(value => { window.mode = value; }, mode);
      await page.addScriptTag({ content: bundle });
      await page.waitForTimeout(300);
      await page.evaluate(() => { window.fixture.events = []; });
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.fixture.toggle(false));
        await page.waitForTimeout(250);
        await page.evaluate(() => window.fixture.toggle(true));
        await page.waitForTimeout(250);
      }
      const transitions = await page.evaluate(() => ({
        all: window.fixture.events.reduce((counts, event) => ({ ...counts, [event.property]: (counts[event.property] || 0) + 1 }), {}),
        cardVisibility: window.fixture.events.filter(event => event.card && event.property === 'visibility').length,
      }));
      assert.equal(transitions.cardVisibility, variant === 'baseline' ? 912 : 0, `${variant}/${mode}: sensitive twelve-toggle comparison`);
      if (variant === 'candidate') assert.equal(transitions.all.visibility || 0, 0);
      const retained = await page.evaluate(() => ({
        host: window.fixture.host === document.querySelector('[data-pos-persistent-host]'),
        input: window.fixture.input === document.querySelector('#search'),
        nodes: window.fixture.nodes.every((node, index) => node === window.fixture.host.querySelectorAll('*')[index]),
        mounts: window.fixture.mounts, inputs: document.querySelectorAll('#search').length,
        query: document.querySelector('#search').value, cart: document.querySelector('#cart').textContent,
        table: document.querySelector('#table').textContent,
      }));
      assert.deepEqual(retained, { host: true, input: true, nodes: true, mounts: 1, inputs: 1, query: 'café', cart: '2', table: 'Mesa 7 / Ticket 12' });
      const hidden = await page.evaluate(() => {
        document.querySelector('#outside').focus(); window.fixture.toggle(false); window.fixture.focus();
        const host = window.fixture.host;
        return { inert: host.inert, aria: host.getAttribute('aria-hidden'), opacity: getComputedStyle(host).opacity,
          focusInside: host.contains(document.activeElement), hitInside: host.contains(document.elementFromPoint(100, 100)),
          fixedHitInside: host.contains(document.elementFromPoint(innerWidth - 5, innerHeight - 5)),
          geometry: window.fixture.input.getClientRects().length > 0 };
      });
      assert.equal(hidden.inert, true); assert.equal(hidden.aria, 'true');
      assert.equal(hidden.focusInside, false); assert.equal(hidden.hitInside, false); assert.equal(hidden.fixedHitInside, false);
      if (variant === 'candidate') { assert.equal(hidden.opacity, '0'); assert.equal(hidden.geometry, true); }
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => window.fixture.host.contains(document.activeElement)), false);
      }
      const client = await page.context().newCDPSession(page);
      const ax = await client.send('Accessibility.getFullAXTree');
      assert.equal(ax.nodes.filter(node => !node.ignored && /Artículo|Acción fija POS/.test(node.name?.value || '')).length, 0);
      await page.locator('#map-control').click();
      await page.keyboard.type('ABC123', { delay: 10 }); await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      assert.deepEqual(await page.evaluate(() => window.fixture.scans), [], 'capture detached on TABLE_MAP');
      assert.equal(await page.evaluate(() => window.fixture.mapClicks), 2, 'visible map receives click and unconsumed Enter');
      await page.screenshot({ path: path.join(out, `${variant}-${mode}-hidden.png`) });
      await page.evaluate(() => { window.fixture.toggle(true); document.querySelector('#outside').focus(); window.fixture.focus(); });
      const immediateFocus = await page.evaluate(() => document.activeElement.id);
      if (variant === 'candidate') assert.equal(immediateFocus, 'search', 'candidate permits focus immediately after reveal');
      await page.waitForTimeout(250);
      await page.evaluate(() => window.fixture.focus());
      assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
      await page.locator('#manual').fill('Cliente editado');
      await page.evaluate(() => window.fixture.focus());
      assert.equal(await page.evaluate(() => document.activeElement.id), 'manual');
      await page.evaluate(() => { window.fixture.setModal(true); document.querySelector('#outside').focus(); window.fixture.focus(); });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'outside', 'real helper respects portal dialog guard');
      assert.equal(await page.evaluate(() => document.elementFromPoint(100, 100).closest('#portal-modal') !== null), true);
      await page.locator('#modal-input').fill('Modal editado');
      await page.evaluate(() => window.fixture.focus());
      assert.equal(await page.evaluate(() => document.activeElement.id), 'modal-input');
      await page.evaluate(() => { window.fixture.setModal(false); document.querySelector('#outside').focus(); });
      // No timers or transitions are added to the host: each flush must isolate it immediately.
      const rapid = await page.evaluate(() => {
        const observations = [];
        for (let i = 0; i < 20; i++) {
          window.fixture.toggle(false); window.fixture.focus();
          observations.push(window.fixture.host.inert && !window.fixture.host.contains(document.activeElement));
          window.fixture.toggle(true);
          observations.push(!window.fixture.host.inert);
        }
        return observations.every(Boolean);
      });
      assert.equal(rapid, true);
      await page.waitForTimeout(300);
      await page.locator('[data-card="0"]').hover(); await page.waitForTimeout(250);
      const hover = await page.locator('[data-card="0"]').evaluate(node => ({ property: getComputedStyle(node).transitionProperty, transform: getComputedStyle(node).transform }));
      assert.equal(hover.property, 'all'); assert.notEqual(hover.transform, 'none');
      await page.mouse.down(); await page.waitForTimeout(200);
      const activeTransform = await page.locator('[data-card="0"]').evaluate(node => getComputedStyle(node).transform);
      assert.notEqual(activeTransform, hover.transform, 'active scale feedback preserved');
      await page.mouse.up();
      assert.equal(await page.locator('#cart').textContent(), '3');
      assert.equal(await page.evaluate(() => window.fixture.clicks), 1);
      await page.mouse.move(1, 1);
      await page.evaluate(() => { document.querySelector('#outside').focus(); window.fixture.focus(); });
      await page.locator('#search').fill('');
      await page.keyboard.type('ABC123', { delay: 10 }); await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      assert.deepEqual(await page.evaluate(() => window.fixture.scans), ['ABC123'], 'real hook captures once on POS');
      assert.equal(await page.locator('#search').inputValue(), '');
      assert.equal(await page.locator('#manual').inputValue(), 'Cliente editado');
      assert.equal(await page.evaluate(() => window.fixture.mounts), 1);
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(out, `${variant}-${mode}-visible.png`) });
      results.push({ variant, mode, transitions, retained, hidden, immediateFocus, rapid, hover, activeTransform, assertions: 'completed' });
      console.log(JSON.stringify(results.at(-1)));
      await page.close();
    }
  }
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  const report = { base, candidate: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain'), browser: browser.version(), cssFiles,
    sourceSha256: sha256(source), baselineSourceSha256: sha256(original), compiledCssSha256: sha256(css), controlUtilitiesSha256: sha256(controlCss), results,
    limits: 'Synthetic child and host Chromium; no Android, HID/IME hardware, full POS modal coverage, runtime sync, GPU/PSS or latency acceptance.' };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  console.log(`Evidence: ${out}`);
} finally { await browser.close(); }
