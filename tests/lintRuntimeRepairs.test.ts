import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PrintOutputError } from '../services/printer/PrintFeedback';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const lifecycle = read('utils/erpSyncLifecycle.ts');
const telemetryStart = lifecycle.indexOf('const resolveRuntimeTelemetry = async () =>');
const telemetryEnd = lifecycle.indexOf('const readJson = async', telemetryStart);
assert.ok(telemetryStart >= 0 && telemetryEnd > telemetryStart);
const telemetrySource = lifecycle.slice(telemetryStart, telemetryEnd);
assert.ok(telemetrySource.startsWith('const resolveRuntimeTelemetry'));

test('actual telemetry accepts an unavailable native bridge', async () => {
  const run = Function('readRuntimeDeviceInfo', 'normalizeOptional', ts.transpile(`${telemetrySource}; return resolveRuntimeTelemetry();`));
  assert.deepEqual(await run(async () => null, (value: any) => String(value || '').trim()), { appVersion: null, ipAddress: null });
});

for (const localIps of [undefined, null, 'not-array', {}, ['10.0.0.123', '10.0.0.101', '10.0.0.123'], ['', null, '10.0.0.123']]) {
  test(`actual runtime telemetry safely accepts ${JSON.stringify(localIps)}`, async () => {
    const run = Function('readRuntimeDeviceInfo', 'normalizeOptional', ts.transpile(`${telemetrySource}; return resolveRuntimeTelemetry();`));
    const result = await run(async () => ({ localIp: '10.0.0.101', localIps, versionName: '1.1.test' }), (value: any) => String(value || '').trim());
    assert.deepEqual(result, { appVersion: '1.1.test', ipAddress: '10.0.0.101' });
    const fallback = await run(async () => ({ localIps }), (value: any) => String(value || '').trim());
    assert.equal(fallback.ipAddress, Array.isArray(localIps) ? localIps.find(Boolean) : null);
  });
}

test('telemetry snapshots localIps once before array validation and iteration', async () => {
  let reads = 0;
  const device = { get localIps() { reads++; return reads === 1 ? ['10.0.0.123'] : null; } };
  const run = Function('readRuntimeDeviceInfo', 'normalizeOptional', ts.transpile(`${telemetrySource}; return resolveRuntimeTelemetry();`));
  assert.equal((await run(async () => device, (value: any) => String(value || '').trim())).ipAddress, '10.0.0.123');
  assert.equal(reads, 1);
});

const sync = read('services/sync/BackgroundSyncManager.ts');
const finallyStart = sync.indexOf('        } finally {', sync.indexOf('    async sync()'));
const finallyEnd = sync.indexOf('\n    }\n', finallyStart);
const actualFinally = sync.slice(finallyStart + '        } finally {'.length, finallyEnd);
assert.ok(actualFinally.includes('this.scheduleSync'));
const finish = Function('navigator', 'isPosSaleActive', 'pausedForSaleActivity', 'shouldRetrySoon', 'collectionErrors',
  `return (async function() { try {} finally { ${actualFinally} }).call(this);`);

for (const scenario of [
  { paused: true, pending: 0, retry: true, online: true, schedules: 0 },
  { paused: true, pending: 2, retry: false, online: true, schedules: 1 },
  { paused: false, pending: 0, retry: true, online: true, schedules: 1 },
  { paused: false, pending: 2, retry: true, online: false, schedules: 0 },
  { paused: false, pending: 0, retry: false, online: true, schedules: 0 },
]) {
  test(`actual finally preserves retry scheduling ${JSON.stringify(scenario)}`, async () => {
    const delays: number[] = [];
    const errors = ['existing collection error'];
    const manager = { isProcessing: true, state: { pendingCount: scenario.pending }, nextRetryDelayMs: null,
      FAST_RETRY_DELAY_MS: 5000, updatePendingCount: async () => {},
      updateState(update: any) { Object.assign(this.state, update); }, scheduleSync(delay: number) { delays.push(delay); } };
    await finish.call(manager, { onLine: scenario.online }, () => scenario.paused, scenario.paused, scenario.retry, errors);
    assert.equal(manager.isProcessing, false);
    assert.equal((manager.state as any).isSyncing, false);
    assert.equal((manager.state as any).hasError, true);
    assert.deepEqual(errors, ['existing collection error']);
    assert.deepEqual(delays, scenario.schedules ? [5000] : []);
    manager.nextRetryDelayMs = 15000 as any;
    delays.length = 0;
    await finish.call(manager, { onLine: scenario.online }, () => scenario.paused, scenario.paused, scenario.retry, errors);
    assert.deepEqual(delays, scenario.schedules ? [15000] : []);
  });
}

test('both intentionally disabled legacy UI branches remain literal false and locally justified', () => {
  for (const path of ['components/CatalogManager.tsx', 'components/ZReportDashboard.tsx']) {
    assert.match(read(path), /intentionally disabled[^\n]*\n\s*\{\/\* eslint-disable-next-line no-constant-binary-expression \*\/\}\n\s*\{false &&/);
  }
});

test('actual finally never suppresses an exception from the protected work', async () => {
  const failure = new Error('protected work failed');
  const run = Function('failure', 'navigator', 'isPosSaleActive', 'pausedForSaleActivity', 'shouldRetrySoon', 'collectionErrors',
    `return (async function() { try { throw failure; } finally { ${actualFinally} }).call(this);`);
  const manager = { state: { pendingCount: 0 }, updatePendingCount: async () => {}, updateState() {},
    scheduleSync() { assert.fail('paused empty queue must not schedule'); } };
  await assert.rejects(run.call(manager, failure, { onLine: true }, () => true, true, true, []), error => error === failure);
});

test('actual finally retry predicate matches the previous schedule decision across its full boolean matrix', async () => {
  for (const online of [false, true]) for (const paused of [false, true])
    for (const pending of [0, 2]) for (const retry of [false, true]) {
      let scheduled = 0;
      const manager = { state: { pendingCount: pending }, FAST_RETRY_DELAY_MS: 5000,
        updatePendingCount: async () => {}, updateState() {}, scheduleSync(delay: number) { assert.equal(delay, 5000); scheduled++; } };
      await finish.call(manager, { onLine: online }, () => paused, paused, retry, []);
      assert.equal(scheduled, Number(online && (retry || pending > 0) && !(paused && pending === 0)));
    }
});

test('actual browser ticket fallback accepts one output or preserves POPUP_BLOCKED', () => {
  const printer = read('utils/printer.ts');
  const end = printer.indexOf('export const printIntegratedPaymentArtifacts');
  const start = printer.lastIndexOf("    const printWindow = window.open('', '_blank', 'width=400,height=600');", end);
  const fallback = printer.slice(start, printer.lastIndexOf('\n};', end));
  assert.ok(fallback.includes("throw new PrintOutputError('POPUP_BLOCKED')"));
  const run = Function('window', 'receiptHtml', 'notifyBrowserPrint', 'PrintOutputError', fallback);
  let wrote = 0, closed = 0, notified = 0;
  assert.equal(run({ open: () => ({ document: { write(html: string) { assert.equal(html, '<qa>'); wrote++; }, close() { closed++; } } }) },
    '<qa>', () => notified++, PrintOutputError), true);
  assert.deepEqual([wrote, closed, notified], [1, 1, 1]);
  assert.throws(() => run({ open: () => null }, '<qa>', () => assert.fail('no accepted output'), PrintOutputError),
    error => error instanceof PrintOutputError);
});
