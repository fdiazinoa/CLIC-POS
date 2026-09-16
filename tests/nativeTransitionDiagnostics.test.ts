import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const kotlin = readFileSync(new URL('../native-stubs/android/ClicPOSNativePrinterBridge.kt', import.meta.url), 'utf8');
const templates = [...kotlin.matchAll(/fun injectContractShim\(webView: WebView\)\s*\{\s*val script = """([\s\S]*?)"""\.trimIndent\(\)/g)];
assert.equal(templates.length, 1, 'extract exactly the actual injectContractShim template');
const script = templates[0][1];
assert.doesNotMatch(script, /\$(?:\{|[a-zA-Z_])/, 'Kotlin interpolation needs a real emitter before this fixture can execute it');

function emitted(native: any = {}, actualScript = script) {
  const calls: unknown[] = [];
  const work = { promise: 0, timer: 0, interval: 0, event: 0, frame: 0, async: 0, stringify: 0 };
  const forbidden = (key: keyof typeof work) => () => { work[key]++; throw new Error(`unexpected diagnostic ${key} work`); };
  class NoPromise {
    constructor() { forbidden('promise')(); }
    static resolve = forbidden('promise');
  }
  const window: any = {
    AndroidPrinter: native === null ? undefined : { callAsync: forbidden('async'), ...native },
    setTimeout: forbidden('timer'), clearTimeout: forbidden('timer'), setInterval: forbidden('interval'),
    addEventListener: forbidden('event'), removeEventListener: forbidden('event'), requestAnimationFrame: forbidden('frame'),
  };
  if (window.AndroidPrinter?.debugLog) {
    const method = window.AndroidPrinter.debugLog;
    window.AndroidPrinter.debugLog = (value: unknown) => { calls.push(value); return method(value); };
  }
  vm.runInNewContext(actualScript, { window, Promise: NoPromise, JSON: {
    parse: JSON.parse,
    stringify(value: any) { work.stringify++; return JSON.stringify(value); },
  } }, { timeout: 1000 });
  const quiet = () => {
    for (const key of ['promise', 'timer', 'interval', 'event', 'frame', 'async'] as const) assert.equal(work[key], 0, key);
    assert.equal(window.__CLIC_NATIVE_ASYNC_IN_FLIGHT__?.size ?? 0, 0);
  };
  const invoke = (payload: any) => {
    const result = window.ClicPOSNativePrinter.debugLog(payload);
    assert.equal(typeof result?.then, 'undefined', 'diagnostic return must be synchronous, not a Promise');
    quiet(); return result;
  };
  quiet(); return { window, calls, work, invoke, quiet };
}
const nativeSuccess = { debugLog: () => '{"success":true,"tag":"ClicPOSConnection","message":"MASTER_CONNECTION_TRANSITION"}' };

test('the full emitted shim forwards App-style serialized transition JSON byte-exactly once synchronously', () => {
  const fixture = emitted(nativeSuccess);
  const payload = ' { "tag":"ClicPOSConnection", "message":"MASTER_CONNECTION_TRANSITION", "data":{"status":"ONLINE","phase":"TABLES_READY","code":"","scopePresent":{"tenant":true}} } ';
  const result = fixture.invoke(payload);
  assert.equal(result.success, true);
  assert.deepEqual(fixture.calls, [payload]); assert.equal(fixture.work.stringify, 0);
  assert.equal(fixture.window.ClicPOSNativePrinter.platform, 'android');
  for (const method of ['printEscPos', 'getDeviceInfo', 'getMasterServerStatus', 'verifyFingerprintAsync']) {
    assert.equal(typeof fixture.window.ClicPOSNativePrinter[method], 'function', `existing ${method} remains exposed`);
  }
});

test('object diagnostics serialize once; null and undefined have an explicit empty-object representation', () => {
  let serialized = 0;
  const payload = { toJSON() { serialized++; return { tag: 'ClicPOSConnection', message: 'MASTER_CONNECTION_TRANSITION', data: { phase: 'EXPLICIT_RETRY' } }; } };
  const fixture = emitted(nativeSuccess); assert.equal(fixture.invoke(payload).success, true);
  assert.equal(serialized, 1); assert.equal(fixture.work.stringify, 1);
  assert.equal(fixture.calls[0], '{"tag":"ClicPOSConnection","message":"MASTER_CONNECTION_TRANSITION","data":{"phase":"EXPLICIT_RETRY"}}');
  for (const value of [null, undefined]) {
    const empty = emitted(nativeSuccess); assert.equal(empty.invoke(value).success, true);
    assert.deepEqual(empty.calls, ['{}']); assert.equal(empty.work.stringify, 1);
  }
});

test('missing printer preserves shim absence; missing diagnostic method fails safely without other native calls', () => {
  const absent = emitted(null); assert.equal(absent.window.ClicPOSNativePrinter, undefined); absent.quiet();
  const missing = emitted(); assert.equal(missing.invoke('{}').success, false); assert.deepEqual(missing.calls, []);
  const disappearing = emitted(nativeSuccess); disappearing.window.AndroidPrinter = null;
  assert.equal(disappearing.invoke('{}').success, false); assert.deepEqual(disappearing.calls, []);
});

test('serialization and native exceptions cannot throw, schedule work, leak errors or claim success', () => {
  const circular: any = {}; circular.self = circular;
  const getter = { get data() { throw new Error('PRIVATE-PAYLOAD'); } };
  for (const payload of [circular, getter, 1n, () => {}]) {
    const fixture = emitted(nativeSuccess); const result = fixture.invoke(payload);
    assert.equal(result.success, false); assert.deepEqual(fixture.calls, []);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-PAYLOAD/);
  }
  const throwing = emitted({ debugLog() { throw new Error('PRIVATE-PAYLOAD'); } });
  assert.equal(throwing.invoke('{}').success, false); assert.equal(throwing.calls.length, 1);
  const methodGetter = emitted();
  Object.defineProperty(methodGetter.window.AndroidPrinter, 'debugLog', { get() { throw new Error('PRIVATE-PAYLOAD'); } });
  assert.equal(methodGetter.invoke('{}').success, false);
});

test('native empty, malformed, primitive, error and thenable responses never become diagnostic success', () => {
  for (const raw of [null, '', 'not JSON', 'null', 'true', '{"success":false,"message":"native rejected"}',
    '{"status":"error","success":true}', '{"status":"ERROR","success":true}',
    { success: true, then() {} }, Promise.resolve({ success: true })]) {
    const fixture = emitted({ debugLog: () => raw }); assert.equal(fixture.invoke('{}').success, false);
    assert.deepEqual(fixture.calls, ['{}']);
  }
  const malformedInput = emitted({ debugLog: (value: string) => {
    assert.equal(value, '{malformed'); return '{"success":false}';
  } });
  assert.equal(malformedInput.invoke('{malformed').success, false);
  assert.deepEqual(malformedInput.calls, ['{malformed']); assert.equal(malformedInput.work.stringify, 0);
});

test('negative canary removing only the real wrapper makes the required App-style diagnostic assertion fail', () => {
  const file = ts.createSourceFile('shim.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches: ts.PropertyAssignment[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'debugLog') matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file); assert.equal(matches.length, 1);
  const property = matches[0];
  const end = script[property.end] === ',' ? property.end + 1 : property.end;
  const mutated = script.slice(0, property.getStart(file)) + script.slice(end);
  const fixture = emitted(nativeSuccess, mutated);
  fixture.window.ClicPOSNativePrinter?.debugLog?.('{"tag":"ClicPOSConnection","message":"MASTER_CONNECTION_TRANSITION"}');
  assert.throws(() => assert.equal(fixture.calls.length, 1), /0 !== 1/, 'an omitted wrapper cannot accidentally produce a green regression');
  fixture.quiet();
});
