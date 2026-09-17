import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createScannerFocusCapture, installScannerFocusDiagnostics } from '../diagnostics/scannerFocus';
import { transformScannerFocus } from '../diagnostics/scannerFocusInstrumentation';
import ts from 'typescript';

function fixture() {
  let now = 0, reads = 0, clears = 0;
  const timers = new Map<number, () => void>();
  let next = 0;
  const capture = createScannerFocusCapture({ timeOrigin: 1000, now: () => { reads++; return now; },
    setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => { clears++; timers.delete(id as number); } });
  const body = { tagName: 'BODY' };
  const doc = { body, activeElement: body, visibilityState: 'visible' } as unknown as Document;
  return { capture, doc, timers, reads: () => reads, clears: () => clears, advance: (ms: number) => { now += ms; } };
}
test('unarmed runtime does not call clock, classification getters or context supplier', () => {
  const f = fixture();
  const bad = () => { throw new Error('must not read context'); };
  assert.equal(f.capture.begin('focus-total', bad), undefined);
  assert.equal(f.capture.point('schedule', bad), undefined);
  assert.equal(f.capture.measure(undefined, 'DOM-focus', () => 42), 42);
  assert.equal(f.reads(), 0);
  assert.equal(f.timers.size, 0);
});
test('inclusive segments preserve value, operation order and the exact original throw', () => {
  const f = fixture(); f.capture.arm('host-reveal');
  const scope = f.capture.begin('focus-total', () => ({ doc: f.doc, reason: 'host-visible' }));
  const calls: string[] = [];
  assert.equal(f.capture.measure(scope, 'guards-simple', () => { calls.push('guards'); f.advance(1); return false; }), false);
  const failure = new Error('operational');
  assert.throws(() => f.capture.measure(scope, 'DOM-focus', () => { calls.push('focus'); f.advance(70); throw failure; }), error => error === failure);
  f.capture.end(scope);
  assert.deepEqual(calls, ['guards', 'focus']);
  const rows = f.capture.snapshot().records;
  assert.deepEqual(rows.map(row => [row.point, row.durationMs]), [['guards-simple', 1], ['DOM-focus', 70], ['focus-total', 71]]);
  assert.equal(rows[2].actionKind, 'host-reveal');
});
test('classification failures do not prevent the operation or replace its exception', () => {
  const f = fixture(); f.capture.arm('control');
  const scope = f.capture.begin('focus-total', () => { throw new Error('observer'); });
  let calls = 0;
  const original = {};
  assert.throws(() => f.capture.measure(scope, 'DOM-focus', () => { calls++; throw original; }), error => error === original);
  assert.equal(calls, 1);
  assert.equal(f.capture.snapshot().records.length, 0);
  assert.equal(f.capture.snapshot().observerErrors, 1);
});
test('5s window expires with one timer; disarm and cleanup cancel it without polling', () => {
  const f = fixture(); f.capture.arm('default-resume', 9000);
  assert.equal(f.timers.size, 1);
  f.advance(5001);
  assert.equal(f.capture.point('restore', () => ({ doc: f.doc })), undefined);
  assert.equal(f.capture.snapshot().armed, false);
  assert.equal(f.timers.size, 0);
  f.capture.arm('manual-touch', 5); [...f.timers.values()][0]();
  assert.equal(f.capture.snapshot().armed, false);
  assert.equal(f.timers.size, 0);
  f.capture.cleanup(); assert.equal(f.capture.snapshot().records.length, 0);
});
test('hard per-action and per-capture limits count dropped details without extra DOM/clock reads', () => {
  const f = fixture();
  let contexts = 0;
  for (let action = 0; action < 10; action++) {
    f.capture.arm('control');
    for (let detail = 0; detail < 80; detail++) f.capture.point('restore', () => { contexts++; return { doc: f.doc }; });
  }
  const out = f.capture.snapshot();
  assert.equal(out.records.length, 512);
  assert.equal(contexts, 512);
  assert.equal(out.dropped, 288);
  assert.ok(out.records.every(row => Object.keys(row).every(key => !['value', 'text', 'id', 'sku', 'token'].includes(key))));
});
test('active/target categories and manual bridge-presence are enums, not field contents', () => {
  const f = fixture(); f.capture.arm('manual-touch');
  const input = { tagName: 'INPUT', dataset: { posScannerReceiver: 'true' }, value: 'secret', id: 'secret' } as unknown as HTMLElement;
  f.capture.point('manual-bridge-call-site', () => ({ doc: f.doc, input, bridgePresent: false, reason: 'other' }));
  const row = f.capture.snapshot().records[0];
  assert.equal(row.intent, 'manual'); assert.equal(row.target, 'receiver'); assert.equal(row.active, 'body');
  assert.equal(row.bridgePresent, false); assert.equal(JSON.stringify(row).includes('secret'), false);
});
test('end/child clock failures cannot replace a return or the exact operation exception', () => {
  let fail = false;
  const c = createScannerFocusCapture({ now: () => { if (fail) throw new Error('observer clock'); return 0; }, timeOrigin: 0,
    setTimeout: () => 1, clearTimeout: () => {} });
  c.arm('control');
  const doc = { body: null, activeElement: null, visibilityState: 'visible' } as unknown as Document;
  const scope = c.begin('focus-total', () => ({ doc })); fail = true;
  assert.equal(c.measure(scope, 'DOM-focus', () => 7), 7);
  const error = new Error('operation');
  assert.throws(() => c.measure(scope, 'DOM-focus', () => { throw error; }), failure => failure === error);
  c.end(scope);
  assert.equal(c.snapshot().observerErrors, 3);
});
test('installation/cleanup failure cannot block application bootstrap', () => {
  const win: any = { performance: { now: () => 0, timeOrigin: 0 }, setTimeout: () => 1, clearTimeout: () => {} };
  Object.defineProperty(win, '__CLIC_POS_SCANNER_FOCUS__', { configurable: false, value: 'unavailable' });
  assert.doesNotThrow(() => installScannerFocusDiagnostics(win));
});
for (const file of ['utils/globalBarcodeCapture.ts', 'components/GlobalVirtualKeyboard.tsx', 'index.tsx']) {
  test(`disabled transform preserves ${file} exactly and enabled TypeScript parses`, () => {
    const code = readFileSync(file, 'utf8');
    assert.equal(transformScannerFocus(code, `/root/${file}`, false), undefined);
    const enabled = transformScannerFocus(code, `/root/${file}`, true)!;
    const source = ts.createSourceFile(file, enabled, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.equal((source as any).parseDiagnostics.length, 0);
    assert.ok(enabled.includes('scannerFocus'));
  });
}
test('drift fails compilation instead of silently claiming incomplete attribution', () => {
  assert.throws(() => transformScannerFocus('export function other() {}', '/root/utils/globalBarcodeCapture.ts', true), /anchor drift/);
});

function instrumentedModule(file: string, enabled: boolean, capture: ReturnType<typeof createScannerFocusCapture>, globals: Record<string, unknown>) {
  const source = readFileSync(file, 'utf8');
  const code = transformScannerFocus(source, `/root/${file}`, enabled) ?? source;
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: any = {};
  const bindings = { scannerFocusBegin: capture.begin, scannerFocusEnd: capture.end, scannerFocusMeasure: capture.measure, scannerFocusPoint: capture.point };
  const require = (path: string) => {
    if (path.endsWith('/diagnostics/scannerFocus')) return bindings;
    if (path === 'react') return { __esModule: true, default: {}, useEffect: globals.useEffect, useState: () => [false, () => {}], useRef: () => ({ current: null }) };
    if (path === '@capacitor/core') return { Capacitor: { getPlatform: () => 'android' } };
    if (path === './VirtualKeyboard' || path === 'react/jsx-runtime') return {};
    throw new Error('Unexpected module');
  };
  new Function('require', 'exports', ...Object.keys(globals), js)(require, exports, ...Object.values(globals));
  return exports;
}
test('enabled/unarmed/armed helper preserves original DOM operation order and timer cancellation', () => {
  function run(enabled: boolean, armed: boolean) {
    const f = fixture(); if (armed) f.capture.arm('host-reveal');
    const calls: string[] = [];
    const callbacks = new Map<number, () => void>(); let next = 0;
    const listeners = new Map<string, (event?: unknown) => void>();
    const body = { tagName: 'BODY' };
    const root = { getAttribute: () => { calls.push('root-attribute'); return 'true'; } };
    const doc: any = { body, activeElement: body, visibilityState: 'visible', querySelector: (selector: string) => { calls.push(`query:${selector}`); return null; },
      addEventListener: (name: string, fn: any) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
    const input: any = { ownerDocument: doc, isConnected: true, dataset: { posScannerReceiver: 'true' }, inputMode: 'none', tagName: 'INPUT',
      closest: (selector: string) => { calls.push(`closest:${selector}`); return selector === '[data-pos-scanner-enabled]' ? root : null; },
      focus: () => { calls.push('focus'); doc.activeElement = input; } };
    const win: any = { document: doc, addEventListener: (name: string, fn: any) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
    const module = instrumentedModule('utils/globalBarcodeCapture.ts', enabled, f.capture, {
      setTimeout: (fn: () => void) => { calls.push('setTimeout'); callbacks.set(++next, fn); return next; },
      clearTimeout: (id: number) => { calls.push('clearTimeout'); callbacks.delete(id); } });
    let receiverReads = 0;
    const cleanup = module.attachSalesScannerFocus(win, () => { receiverReads++; return input; });
    listeners.get('click')?.({ type: 'click' });
    assert.equal(callbacks.size, 1);
    const callback = [...callbacks.values()][0]; callbacks.clear(); callback();
    listeners.get('blur')?.({ type: 'blur' }); cleanup();
    assert.equal(callbacks.size, 0); assert.equal(listeners.size, 0);
    return { calls, receiverReads, records: f.capture.snapshot().records };
  }
  const normal = run(false, false), dormant = run(true, false), armed = run(true, true);
  assert.deepEqual(dormant.calls, normal.calls); assert.deepEqual(armed.calls, normal.calls);
  assert.equal(dormant.receiverReads, normal.receiverReads); assert.equal(armed.receiverReads, normal.receiverReads);
  assert.equal(dormant.records.length, 0);
  assert.ok(armed.records.some(row => row.point === 'DOM-focus'));
  assert.ok(armed.records.some(row => row.point === 'run' && row.reason === 'mount'));
});
test('manual instrumentation preserves accepted/rejected pointer paths and records only existing JS boundaries', () => {
  function run(enabled: boolean, armed: boolean, reject: string) {
    const f = fixture(); if (armed) f.capture.arm('manual-touch');
    const calls: string[] = [], timers: (() => void)[] = [];
    const listeners = new Map<string, (event: any) => void>();
    class Input {
      disabled = reject === 'disabled'; readOnly = reject === 'readonly'; isConnected = true; type = 'search'; tagName = 'INPUT'; dataset = {};
      closest() { calls.push('closest'); return reject === 'excluded' ? {} : null; }
      focus() { calls.push('focus'); }
    }
    class TextArea {}
    const field = new Input();
    const doc: any = { activeElement: f.doc.body, body: f.doc.body, visibilityState: 'visible',
      addEventListener: (name: string, fn: any) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
    let cleanup: () => void = () => {};
    const module = instrumentedModule('components/GlobalVirtualKeyboard.tsx', enabled, f.capture, {
      HTMLInputElement: Input, HTMLTextAreaElement: TextArea, document: doc,
      window: { setTimeout: (fn: () => void) => { calls.push('setTimeout'); timers.push(fn); }, ClicPOSAppBridge: { showSoftKeyboard: () => calls.push('bridge') } },
      useEffect: (fn: () => () => void) => { cleanup = fn(); } });
    module.default(); listeners.get('pointerup')?.({ target: reject === 'noneditable' ? {} : field });
    timers.forEach(fn => fn()); cleanup();
    return { calls, records: f.capture.snapshot().records };
  }
  for (const reject of ['', 'disabled', 'readonly', 'excluded', 'noneditable']) {
    const normal = run(false, false, reject), dormant = run(true, false, reject), armed = run(true, true, reject);
    assert.deepEqual(dormant.calls, normal.calls, reject); assert.deepEqual(armed.calls, normal.calls, reject);
    assert.equal(dormant.records.length, 0);
    assert.deepEqual(armed.records.map(row => row.point), reject ? [] : ['manual-pointer', 'manual-callback', 'manual-bridge-call-site']);
    if (!reject) assert.equal(armed.records[2].bridgePresent, true);
  }
});
