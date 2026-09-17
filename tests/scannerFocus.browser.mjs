/** Real focus effect/helper/receiver JSX, retained host and App table destination callback.
 * Lock transport, catalog and camera event source are fixtures; this is not Android IME QA.
 * External PLAYWRIGHT_MODULE and optional CHROMIUM_EXECUTABLE; no product dependency added.
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

const root = fileURLToPath(new URL('..', import.meta.url));
const base = process.env.SCANNER_FOCUS_BASE || '5ae8203a93f130cdbe74cf6d223dd8316298ccce';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const out = process.env.SCANNER_FOCUS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-focus-'));
if (process.env.SCANNER_FOCUS_OUT) { assert.ok(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true }); }
assert.ok(!fs.realpathSync(out).startsWith(fs.realpathSync(root) + path.sep));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const pos = fs.readFileSync(path.join(root, 'components/POSInterface.tsx'), 'utf8');
const oldPos = git('show', `${base}:components/POSInterface.tsx`);
const helper = fs.readFileSync(path.join(root, 'utils/globalBarcodeCapture.ts'), 'utf8');
const oldHelper = git('show', `${base}:utils/globalBarcodeCapture.ts`);
const rejected = 'd0ecd72af12a250790fb281d4a92ebd3e90f08d0';
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
function extractApp(text) {
  const ast = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let host, onTableClick;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'PersistentPOSHost') host = node.initializer.getText(ast);
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onTableClick' && node.initializer?.getText(ast).includes('tableOpenDestinationRef.current')) onTableClick = node.initializer.expression.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(host && onTableClick);
  return { host, onTableClick };
}
assert.equal(extractApp(app).onTableClick, extractApp(git('show', `${base}:App.tsx`)).onTableClick, 'actual navigation callback unchanged');
assert.equal(helper.slice(helper.indexOf('export function attachGlobalBarcodeCapture')).trimEnd(), oldHelper.slice(oldHelper.indexOf('export function attachGlobalBarcodeCapture')).trimEnd(), 'HID/IME algorithm remains byte-identical');

function extract(text) {
  const ast = ts.createSourceFile('POSInterface.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects = [], receivers = [], manual = [];
  const initializers = {};
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
        /attachSalesScannerFocus|focusSalesScannerInput/.test(node.arguments[0]?.getText(ast) || '')) effects.push(node.getText(ast));
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'input') {
      const jsx = node.getText(ast);
      if (jsx.includes('data-pos-scanner-receiver="true"')) receivers.push(jsx);
      if (/ref=\{(?:searchInputRef|retailSearchInputRef)\}/.test(jsx)) manual.push(jsx);
    }
    if (ts.isVariableDeclaration(node) && node.initializer) initializers[node.name.getText(ast)] = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(effects.length, 1); assert.equal(manual.length, 2);
  return { effect: effects[0], receiver: receivers.join('\n'), manual, initializers };
}
const candidateParts = extract(pos), baselineParts = extract(oldPos);
assert.ok(candidateParts.receiver && !baselineParts.receiver);
assert.equal(candidateParts.manual[0], baselineParts.manual[0], 'manual search JSX unchanged');
assert.equal(candidateParts.manual[1], baselineParts.manual[1].replace(/\s+autoFocus\n/, '\n'), 'only retail automatic focus removed');
for (const name of ['clearCatalogSearch', 'handleRetailSearchSubmit', 'processBarcode'])
  assert.equal(candidateParts.initializers[name], baselineParts.initializers[name], `${name} remains unchanged`);

const bundle = async (parts, captureSource, appText = app, strict = false) => (await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
import React, { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync, createPortal } from 'react-dom';
import * as barcode from './utils/globalBarcodeCapture';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
const focusSalesScannerInput = barcode.focusSalesScannerInput;
const attachSalesScannerFocus = barcode.attachSalesScannerFocus;
const notifySalesScannerHostVisibility = barcode.notifySalesScannerHostVisibility;
const markInteractionStage = () => {}, commitInteractionDestination = () => {}, finishInteraction = () => {}, markInteractionStateUpdate = () => {};
const isInteractionPending = () => false;
window.fixture = { scans: [], tickets: [], manual: 0, geometry: 0, focusCalls: [], zeroTimers: 0, renders: 0, callbackValues: [] };
const originalRects = Element.prototype.getClientRects;
Element.prototype.getClientRects = function() { window.fixture.geometry++; return originalRects.call(this); };
const originalFocus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function(options) { window.fixture.focusCalls.push(this.id || this.dataset.posScannerReceiver || this.tagName); return originalFocus.call(this, options); };
const originalTimeout = window.setTimeout;
window.setTimeout = function(fn, delay, ...args) { if (delay === 0) window.fixture.zeroTimers++; return originalTimeout(fn, delay, ...args); };
function POS({ isAnyModalOpen, isRetailMode, isMobile, onProbe }) {
  window.fixture.renders++;
  window.fixture.probe = onProbe;
  const salesScannerReceiverRef = useRef(null), searchInputRef = useRef(null), retailSearchInputRef = useRef(null);
  const [searchTerm, setSearchTerm] = useState('');
  const setCatalogSearchQuery = () => {};
  const searchFilterTraceRef = useRef(null);
  const clearCatalogSearch = ${parts.initializers.clearCatalogSearch};
  const handleCatalogSearchInput = setSearchTerm;
  const handleSearchKeyDown = event => { if (event.key === 'Enter') window.fixture.manual++; };
  const handleRetailSearchSubmit = () => { window.fixture.manual++; retailSearchInputRef.current.focus(); };
  ${parts.effect};
  useEffect(() => { const scan = event => window.fixture.scans.push(event.detail.barcode); window.addEventListener('barcodeScanned', scan); return () => window.removeEventListener('barcodeScanned', scan); }, []);
  window.fixture.receiver = () => salesScannerReceiverRef.current;
  return <main data-pos-scanner-enabled={isAnyModalOpen ? 'false' : 'true'}>
    ${parts.receiver}
    {isRetailMode ? ${parts.manual[1]} : ${parts.manual[0]}}
    <button id="clear" onClick={clearCatalogSearch}>Clear manual search</button>
    <button id="compact" onClick={() => { requestAnimationFrame(() => searchInputRef.current?.focus()); }}>Open manual search</button>
    <input id="manual" /><textarea id="notes" /><select id="select"><option>One</option></select><div id="editable" contentEditable suppressContentEditableWarning>Manual</div>
    <output id="query">{searchTerm}</output>
  </main>;
}
const MemoizedPOSInterface = React.memo(POS);
const PersistentPOSHost = ${extractApp(appText).host};
function Host() {
  const [visible, setVisible] = useState(true), [modal, setModal] = useState(false), [layout, setLayout] = useState(window.mode), [epoch, setEpoch] = useState(0);
  const [callbackValue, setCallbackValue] = useState(0);
  const tableOpenDestinationRef = useRef(null), pendingClientTableSyncRef = useRef(null);
  const setSuppressProductInputUntilMs = () => {}, isClientTerminalMode = () => false;
  const parkedTickets = [{ id: 'existing-account', tableId: 'table-demo', items: [{ id: 'demo', quantity: 1, price: 5 }] }], transactions = [], customers = [];
  const markRestaurantLinesCommitted = value => value;
  const setCart = () => {}, setSelectedCustomer = () => {}, setActiveTable = () => {};
  const setCurrentView = view => setVisible(view === 'POS');
  const onTableClick = ${extractApp(appText).onTableClick};
  window.fixture.callbackValue = value => flushSync(() => setCallbackValue(value));
  window.fixture.lockStarted = false;
  const openAfterLock = async () => {
    window.fixture.lockStarted = true;
    try {
      const allowed = await new Promise((resolve, reject) => { window.fixture.resolveLock = resolve; window.fixture.rejectLock = reject; });
      if (allowed) onTableClick({ id: 'table-demo', name: 'Demo', currentOrderId: 'existing-account' }, null);
    } catch { window.fixture.lockFailed = true; }
  };
  useBarcodeScanner({ enabled: visible && !modal, onScan: code => window.fixture.scans.push(code), onTicketScan: code => window.fixture.tickets.push(code) });
  window.fixture.visible = value => flushSync(() => setVisible(value));
  window.fixture.modal = value => flushSync(() => setModal(value));
  window.fixture.layout = value => flushSync(() => setLayout(value));
  window.fixture.remount = () => flushSync(() => setEpoch(n => n + 1));
  return <><PersistentPOSHost key={epoch} visible={visible} isAnyModalOpen={modal} isRetailMode={layout === 'retail'} isMobile={layout === 'mobile'} onProbe={() => window.fixture.callbackValues.push(callbackValue)} />
  <button id="toggle" onClick={() => setVisible(v => !v)}>Toggle route</button><button id="open-table" onClick={openAfterLock}>Open existing account after lock</button><button id="open-modal" onClick={() => setModal(true)}>Open modal</button>
  {modal && createPortal(<div role="dialog" aria-modal="true" id="portal"><input id="modal-field"/><button id="close-modal" onClick={() => setModal(false)}>Close modal</button></div>, document.body)}</>;
}
const fixtureRoot = createRoot(document.querySelector('#root'));
flushSync(() => fixtureRoot.render(${strict ? '<React.StrictMode><Host /></React.StrictMode>' : '<Host />'}));
window.fixture.unmount = () => flushSync(() => fixtureRoot.unmount());
window.fixture.search = () => document.querySelector('[data-barcode-scanner-target="true"][inputmode="search"]');
window.fixture.resetCounters = () => { window.fixture.geometry = 0; window.fixture.focusCalls = []; window.fixture.zeroTimers = 0; };
` }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': strict ? '"development"' : '"production"' },
  plugins: [{ name: 'actual-barcode-source', setup(plugin) {
    plugin.onLoad({ filter: /[/\\]utils[/\\]globalBarcodeCapture\.ts$/ }, () => ({ contents: captureSource, loader: 'ts' }));
  } }],
})).outputFiles[0].text;

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const results = [];
try {
  for (const [variant, parts, captureSource] of [['baseline', baselineParts, oldHelper], ['candidate', candidateParts, helper]]) {
    const code = await bundle(parts, captureSource, variant === 'baseline' ? git('show', `${base}:App.tsx`) : app);
    for (const mode of ['main', 'retail', 'mobile']) {
      const page = await browser.newPage({ viewport: { width: mode === 'mobile' ? 390 : 1280, height: 800 } });
      const errors = []; page.on('pageerror', e => errors.push(String(e)));
      await page.setContent('<button id="outside">Outside</button><div id="root"></div>');
      await page.evaluate(value => { window.mode = value; }, mode);
      await page.addScriptTag({ content: code }); await page.waitForTimeout(40);
      const initial = await page.evaluate(() => ({ quiet: document.activeElement === window.fixture.receiver(), search: document.activeElement === window.fixture.search(), geometry: window.fixture.geometry }));
      assert.equal(initial.quiet, variant === 'candidate'); assert.equal(initial.search, variant === 'baseline');
      if (variant === 'candidate') assert.equal(initial.geometry, 0);
      // Genuine baseline sensitivity: neutral focus plus pointerup/click enters old geometry-based helper.
      await page.evaluate(() => { document.querySelector('#outside').focus(); window.fixture.resetCounters(); window.dispatchEvent(new Event('pointerup')); window.dispatchEvent(new Event('click')); });
      await page.waitForTimeout(30);
      const recovery = await page.evaluate(() => ({ geometry: window.fixture.geometry, quiet: document.activeElement === window.fixture.receiver(), search: document.activeElement === window.fixture.search() }));
      assert.equal(recovery.geometry > 0, variant === 'baseline');
      if (variant === 'candidate') {
        assert.equal(recovery.quiet, true);
        await page.evaluate(() => { window.fixture.resetCounters(); for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('click')); });
        await page.waitForTimeout(30);
        assert.deepEqual(await page.evaluate(() => ({ zeroTimers: window.fixture.zeroTimers, focus: window.fixture.focusCalls.length, geometry: window.fixture.geometry })), { zeroTimers: 0, focus: 0, geometry: 0 });
        const receiver = await page.evaluate(() => { const n = window.fixture.receiver(); return { inputMode: n.inputMode, tabIndex: n.tabIndex, disabled: n.disabled, readOnly: n.readOnly }; });
        assert.deepEqual(receiver, { inputMode: 'none', tabIndex: -1, disabled: false, readOnly: false });
        await page.evaluate(() => {
          document.querySelector('#outside').focus(); window.dispatchEvent(new Event('click'));
          Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        }); await page.waitForTimeout(30);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'outside');
        await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForTimeout(30);
        assert.equal(await page.evaluate(() => document.activeElement === window.fixture.receiver()), true);
        await page.evaluate(() => {
          document.querySelector('#outside').focus(); const local = document.createElement('div'); local.id = 'local-dialog'; local.setAttribute('aria-modal', 'true');
          document.querySelector('main').append(local); window.dispatchEvent(new Event('click'));
        }); await page.waitForTimeout(30);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'outside', 'local dialog guard independent of React modal flag');
        await page.evaluate(() => { document.querySelector('#local-dialog').remove(); window.dispatchEvent(new Event('click')); }); await page.waitForTimeout(30);
        // Schedule recovery then synchronously navigate/open a portal before its callback.
        for (const guard of ['route', 'modal']) {
          await page.evaluate(g => { document.querySelector('#outside').focus(); window.dispatchEvent(new Event('click')); if (g === 'route') window.fixture.visible(false); else window.fixture.modal(true); }, guard);
          await page.waitForTimeout(30);
          assert.equal(await page.evaluate(() => document.querySelector('[data-pos-persistent-host]').contains(document.activeElement)), false);
          await page.evaluate(g => { if (g === 'route') document.querySelector('#toggle').click(); else document.querySelector('#close-modal').click(); }, guard);
          await page.waitForTimeout(30);
          assert.equal(await page.evaluate(() => document.activeElement === window.fixture.receiver()), true);
        }
        for (const id of ['manual', 'notes', 'select', 'editable']) {
          await page.evaluate(id => { document.getElementById(id).focus(); window.dispatchEvent(new Event('click')); }, id); await page.waitForTimeout(30);
          assert.equal(await page.evaluate(() => document.activeElement.id), id);
        }
        await page.evaluate(() => { window.fixture.search().focus(); window.dispatchEvent(new Event('click')); }); await page.waitForTimeout(30);
        assert.equal(await page.evaluate(() => document.activeElement === window.fixture.search()), true);
        assert.equal(await page.evaluate(() => window.fixture.search().inputMode), 'search');
        if (mode !== 'retail') {
          await page.evaluate(() => { document.querySelector('#outside').focus(); document.querySelector('#clear').click(); }); await page.waitForTimeout(40);
          assert.equal(await page.evaluate(() => document.activeElement === window.fixture.search()), true, 'actual clear callback preserves manual focus');
          await page.evaluate(() => { document.querySelector('#outside').focus(); document.querySelector('#compact').click(); }); await page.waitForTimeout(40);
          assert.equal(await page.evaluate(() => document.activeElement === window.fixture.search()), true);
        }
        const layoutRetained = await page.evaluate(() => { const old = window.fixture.receiver(); window.fixture.layout('retail'); return old === window.fixture.receiver(); });
        assert.equal(layoutRetained, true, 'one receiver node survives layout changes');
        await page.evaluate(() => {
          document.querySelector('#outside').focus(); window.dispatchEvent(new Event('click'));
          window.fixture.staleFocus = 0; window.fixture.receiver().focus = () => { window.fixture.staleFocus++; };
          window.fixture.remount();
        });
        await page.waitForTimeout(40);
        assert.equal(await page.evaluate(() => document.activeElement === window.fixture.receiver()), true, 'layout/unmount cancels stale callback and arms fresh ref');
        assert.equal(await page.evaluate(() => window.fixture.staleFocus), 0, 'disposed effect never focuses old ref');
      }
      // Real global capture/hook, synthetic input delivery; no scan algorithm duplicated in fixture.
      await page.evaluate(v => {
        const input = v === 'candidate' ? window.fixture.receiver() : window.fixture.search(); input.focus();
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        const chunk = value => { setValue.call(input, value); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })); };
        chunk('UNKNOWN123'); chunk('KNOWN123'); chunk('KNOWN123');
      }, variant);
      await page.waitForTimeout(280);
      assert.deepEqual(await page.evaluate(() => window.fixture.scans), ['UNKNOWN123', 'KNOWN123', 'KNOWN123']);
      assert.equal(await page.evaluate(v => (v === 'candidate' ? window.fixture.receiver() : window.fixture.search()).value, variant), '');
      await page.keyboard.type('HID123', { delay: 15 }); await page.keyboard.press('Tab'); await page.waitForTimeout(280);
      assert.deepEqual(await page.evaluate(() => window.fixture.scans), ['UNKNOWN123', 'KNOWN123', 'KNOWN123', 'HID123']);
      await page.evaluate(v => {
        const input = v === 'candidate' ? window.fixture.receiver() : window.fixture.search(); input.focus();
        for (const key of 'TCK1234') input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
        window.dispatchEvent(new CustomEvent('barcodeScanned', { detail: { barcode: 'CAMERA123' } }));
      }, variant);
      assert.deepEqual(await page.evaluate(() => window.fixture.tickets), ['TCK1234']);
      assert.equal(await page.evaluate(() => window.fixture.scans.filter(s => s === 'CAMERA123').length), 1);
      assert.deepEqual(errors, []);
      results.push({ variant, mode, initial, recovery, assertions: 'completed' });
      console.log(JSON.stringify(results.at(-1))); await page.close();
    }
  }
  // Same real retained host and unchanged App callback for rejected d0 and candidate.
  // Only lock transport is controlled; reveal remains actual rAF -> timeout -> React commit.
  for (const variant of ['rejected', 'candidate']) {
    for (const mode of ['main', 'retail', 'mobile']) {
      const code = await bundle(candidateParts, variant === 'rejected' ? git('show', `${rejected}:utils/globalBarcodeCapture.ts`) : helper,
        variant === 'rejected' ? git('show', `${rejected}:App.tsx`) : app, true);
      const page = await browser.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.setContent('<button id="outside">Outside</button><div id="root"></div>');
      await page.evaluate(value => { window.mode = value; }, mode);
      await page.addScriptTag({ content: code }); await page.waitForTimeout(40);
      await page.evaluate(() => {
        window.fixture.savedReceiver = window.fixture.receiver(); window.fixture.savedProbe = window.fixture.probe;
        window.fixture.savedRenders = window.fixture.renders;
        window.fixture.visible(false); window.fixture.callbackValue(7);
      });
      await page.waitForTimeout(30);
      assert.deepEqual(await page.evaluate(() => ({ node: window.fixture.savedReceiver === window.fixture.receiver(), callback: window.fixture.savedProbe === window.fixture.probe,
        renders: window.fixture.renders - window.fixture.savedRenders })), { node: true, callback: true, renders: 0 });
      await page.evaluate(() => window.fixture.savedProbe());
      assert.deepEqual(await page.evaluate(() => window.fixture.callbackValues), [7], 'retained callback invokes newest closure without POS rerender');
      for (const outcome of ['cancel', 'fail', 'approve']) {
        await page.click('#open-table'); await page.waitForTimeout(60);
        assert.equal(await page.evaluate(() => document.querySelector('[data-pos-persistent-host]').hasAttribute('inert')), true);
        assert.equal(await page.evaluate(() => document.activeElement === window.fixture.receiver()), false, 'no receiver focus while awaiting lock');
        await page.evaluate(result => result === 'fail' ? window.fixture.rejectLock(new Error('lock denied')) : window.fixture.resolveLock(result === 'approve'), outcome);
        await page.waitForTimeout(80);
        assert.equal(await page.evaluate(() => document.querySelector('[data-pos-persistent-host]').hasAttribute('inert')), outcome !== 'approve');
        assert.equal(await page.evaluate(() => document.activeElement === window.fixture.receiver()), outcome === 'approve' && variant === 'candidate', 'd0 misses delayed reveal; candidate rearms without second click');
      }
      const delayed = await page.evaluate(() => ({ receiverFocused: document.activeElement === window.fixture.receiver(), retained: window.fixture.receiver() === window.fixture.savedReceiver,
        extraRenders: window.fixture.renders - window.fixture.savedRenders }));
      assert.equal(delayed.retained, true); assert.equal(delayed.extraRenders, 0);
      if (variant === 'candidate') {
        // Foreign owner cannot cancel an owned restore. Rapid hide/reveal coalesces.
        await page.evaluate(() => {
          document.querySelector('#outside').focus(); window.fixture.visible(false); window.fixture.visible(true);
          const other = document.createElement('div'); document.body.append(other);
          other.dispatchEvent(new CustomEvent('pos:scanner-host-visibility', { bubbles: true, detail: { visible: false } })); other.remove();
        }); await page.waitForTimeout(40);
        assert.equal(await page.evaluate(() => document.activeElement === window.fixture.receiver()), true);
        for (const guard of ['manual', 'portal', 'local']) {
          await page.evaluate(value => {
            document.querySelector('#outside').focus();
            window.fixture.visible(false);
            if (value === 'manual') { const input = document.createElement('input'); input.id = 'external-manual'; document.body.append(input); input.focus(); }
            else if (value === 'portal') window.fixture.modal(true);
            else { const dialog = document.createElement('div'); dialog.id = 'local'; dialog.setAttribute('role', 'dialog'); document.querySelector('main').append(dialog); }
            window.fixture.visible(true);
          }, guard); await page.waitForTimeout(40);
          assert.equal(await page.evaluate(() => document.activeElement === window.fixture.receiver()), false, guard);
          await page.evaluate(value => { if (value === 'manual') document.querySelector('#external-manual').remove(); else if (value === 'portal') window.fixture.modal(false); else document.querySelector('#local').remove(); }, guard);
        }
        await page.evaluate(() => {
          document.querySelector('#outside').focus(); window.fixture.visible(false); window.fixture.visible(true);
          window.fixture.oldHost = document.querySelector('[data-pos-persistent-host]');
          window.fixture.staleFocus = 0; window.fixture.receiver().focus = () => window.fixture.staleFocus++;
          window.fixture.unmount(); window.fixture.resetCounters();
          window.fixture.oldHost.dispatchEvent(new CustomEvent('pos:scanner-host-visibility', { bubbles: true, detail: { visible: true } }));
          window.dispatchEvent(new Event('click'));
        }); await page.waitForTimeout(40);
        assert.equal(await page.evaluate(() => window.fixture.staleFocus), 0);
        assert.equal(await page.evaluate(() => window.fixture.zeroTimers), 0, 'StrictMode cleanup leaves no restoring listener');
      }
      assert.deepEqual(errors, []); results.push({ variant, mode, strictMode: true, delayedLockReveal: delayed, assertions: 'completed' });
      console.log(JSON.stringify(results.at(-1))); await page.close();
    }
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ base, candidate: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain'),
    browser: browser.version(), sourceSha256: createHash('sha256').update(pos + helper).digest('hex'), results,
    rejected, limits: 'Host browser: real PersistentPOSHost, App onTableClick, focus effect/helper/receiver JSX and capture hook; controlled lock promise, fixture catalog/camera source. No Android IME/peripheral/keyboard latency or full POS QA.' }, null, 2));
  console.log(`Evidence: ${out}`);
} finally { await browser.close(); }
