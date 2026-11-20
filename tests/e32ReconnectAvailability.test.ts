import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const effect = pos.slice(
  pos.indexOf('   useEffect(() => {', pos.indexOf('const [fiscalReceiptRecoveryAvailable')),
  pos.indexOf('   const fiscalReserveAlert'),
);
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const onOnline = app.slice(app.indexOf('    const handleErpOnline ='), app.indexOf('    const handleErpAppResume ='));
const sync = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
const afterRehydrate = sync.slice(
  sync.indexOf('        await db.rehydrateOperationalDocumentState('),
  sync.indexOf('        if (snapshot && this.getPendingTerminalSnapshot(context.terminalId, snapshotTerminalId))'),
);
const compile = (source: string) => ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
const effectCode = compile(effect);
const reconnectCode = compile(onOnline + '\nhandleErpOnline;');
const persistCode = compile('(async () => {' + afterRehydrate + '})();');
const scope = { tenantId: 'test-tenant', companyId: 'test-company', storeId: 'test-store' };
const terminal = 'caja-6-test';
const configuration = { erpTerminalId: 'caja-6-erp-test', erpBinding: scope, currentDeviceId: 'test-device',
  fiscal: { environment: 1 }, };
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture() {
  let status: { type: string; hasNCF: boolean; verificationUnavailable?: boolean } | undefined;
  let typedE32 = true;
  let permits = 4;
  let failNextRead = false;
  let reads = 0;
  let leaseReads = 0;
  const publications: NonNullable<typeof status>[] = [];
  const navigator = { onLine: true };
  const window = new EventTarget();
  const db = {
    async canRequestMoreNCF(type: string, terminalId: string, context: unknown) {
      reads++;
      assert.equal(type, 'E32');
      assert.equal(terminalId, terminal);
      assert.equal(context, configuration);
      if (failNextRead) {
        failNextRead = false;
        throw Error('TEST_TRANSIENT_READ');
      }
      return typedE32;
    },
    async get(name: string) {
      return name === 'fiscalAllocations'
        ? [{ terminalId: configuration.erpTerminalId, ncfType: 'E32', status: 'ACTIVE', fiscalRangeId: 'test-E32',
          reservedStart: 1, reservedEnd: 20, nextNumber: typedE32 ? 6 : 21 }]
        : [{ id: 'test-E32', prefix: 'E32', expiryDate: '2099-12-31' }];
    },
  };
  const getStatus = () => status;
  const context = {
    window, navigator, console: { error() {} }, db,
    fiscalCheckScope: 'test-issuer-and-terminal',
    currentFiscalCheckScope: { current: 'test-issuer-and-terminal' },
    v3Operational: {}, fiscalCompliance: { mode: 'ECF' }, cart: [], usesDelegatedEcf: true,
    effectiveSelectedCustomer: undefined, activeTable: undefined, showPaymentModal: false,
    isFiscalModeDisabled: false, isOrderTakerMode: false,
    requiredSaleFiscalType: 'E32', terminalId: terminal, activeTerminalConfig: configuration,
    async resolveCommittedFiscalReceipt() { return null; },
    fiscalWorkflowV2Client: {
      async checkoutFiscalStatus() { return null; },
      async offlineStatus() { leaseReads++; return { remaining: permits, validUntil: '2099-12-31' }; },
    },
    setFiscalStatus(value: NonNullable<typeof status>) { status = value; publications.push(value); },
    setStatus() {}, setFiscalReceiptRecoveryAvailable() {},
  };
  let cleanup = () => {};
  runInNewContext(effectCode, { ...context, useEffect(mount: () => () => void) { cleanup = mount(); } });
  return {
    window, navigator, db, getStatus, publications, cleanup: () => cleanup(),
    changeScope: () => { context.currentFiscalCheckScope.current = 'new-issuer-and-terminal'; },
    counts: () => ({ reads, leaseReads }),
    setTypedE32: (available: boolean) => { typedE32 = available; },
    setPermits: (available: number) => { permits = available; },
    failNextRead: () => { failNextRead = true; },
    notify: (terminalId: string) => window.dispatchEvent(new CustomEvent('terminalFiscalDocumentsUpdated', { detail: { terminalId } })),
  };
}

test('offline E32 stays available with a local numbered range and permits, and loses readiness when either is exhausted', async () => {
  const f = fixture();
  await settle();
  assert.equal(f.getStatus()?.hasNCF, true);
  f.navigator.onLine = false;
  f.window.dispatchEvent(new Event('offline'));
  await settle();
  assert.equal(f.getStatus()?.hasNCF, true);
  assert.equal(f.counts().leaseReads, 1);
  f.setPermits(0);
  f.notify(terminal);
  await settle();
  assert.equal(f.getStatus()?.hasNCF, false);
  f.setPermits(4);
  f.setTypedE32(false);
  f.notify(terminal);
  await settle();
  assert.equal(f.getStatus()?.hasNCF, false, 'generic sale permits never substitute for a numbered E32 range');
  f.cleanup();
});

test('the existing reconnect request rechecks a transiently unavailable local E32 after 304 without remount or payment', async () => {
  const f = fixture();
  await settle();
  f.navigator.onLine = false;
  f.window.dispatchEvent(new Event('offline'));
  await settle();
  let finishReconnect!: () => void;
  const pending = new Promise<void>(resolve => { finishReconnect = resolve; });
  let calls = 0;
  const listener = runInNewContext(reconnectCode, {
    disposed: false, window: f.window, CustomEvent, currentTerminal: { id: terminal },
    adaptivePollingScheduler: { notifyOnline() {} },
    syncTriggerCoordinator: { async request() {} },
    async requestConditionalTerminalConfig(reason: string) {
      assert.equal(reason, 'connection_restored');
      calls++;
      await pending;
      return { status: 'unchanged' };
    },
  });
  f.window.addEventListener('online', listener);
  f.failNextRead();
  f.navigator.onLine = true;
  f.window.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(f.getStatus()?.verificationUnavailable, true);
  assert.equal(f.getStatus()?.hasNCF, false);
  finishReconnect();
  await settle();
  assert.equal(calls, 1);
  assert.equal(f.getStatus()?.hasNCF, true);
  assert.equal(f.getStatus()?.verificationUnavailable, undefined);
  f.cleanup();
});

test('unchanged configuration republishes only after successful fiscal rehydration and for the matching terminal', async () => {
  const f = fixture();
  await settle();
  f.setTypedE32(false);
  f.notify(terminal);
  await settle();
  assert.equal(f.getStatus()?.hasNCF, false);
  f.setTypedE32(true);
  f.notify('other-terminal');
  await settle();
  assert.equal(f.getStatus()?.hasNCF, false);
  let finishRehydration!: () => void;
  const pending = new Promise<void>(resolve => { finishRehydration = resolve; });
  const save = runInNewContext(persistCode, {
    db: { async rehydrateOperationalDocumentState() { await pending; } },
    operationalDocumentState: { terminalId: terminal, documentSeries: [], fiscalRanges: [], fiscalAllocations: [] },
    options: { requireOperationalTerminalConfig: true }, async assertRefreshAuthorityCurrent() {},
    window: f.window, CustomEvent,
  });
  await settle();
  assert.equal(f.getStatus()?.hasNCF, false);
  finishRehydration();
  await save;
  await settle();
  assert.equal(f.getStatus()?.hasNCF, true);
  f.cleanup();
});

test('new scoped signals supersede an in-flight availability result and cleanup retires later events', async () => {
  const f = fixture();
  await settle();
  let release!: (available: boolean) => void;
  const delayed = new Promise<boolean>(resolve => { release = resolve; });
  const original = f.db.canRequestMoreNCF;
  let calls = 0;
  f.db.canRequestMoreNCF = async (...args) => {
    calls++;
    return calls === 1 ? delayed : original(...args);
  };
  f.notify(terminal);
  await settle();
  f.notify(terminal);
  f.notify(terminal);
  release(false);
  await settle();
  assert.equal(calls, 2);
  assert.equal(f.publications.some(status => !status.hasNCF), false, 'outdated unavailable result must not repaint the badge');
  f.cleanup();
  f.notify(terminal);
  await settle();
  assert.equal(calls, 2);
});


test('a scope change fences a completed read immediately, before the previous listeners are removed', async () => {
  const f = fixture();
  await settle();
  let release!: (available: boolean) => void;
  f.db.canRequestMoreNCF = () => new Promise<boolean>(resolve => { release = resolve; });
  f.notify(terminal);
  await settle();
  const publicationCount = f.publications.length;
  f.changeScope();
  release(false);
  await settle();
  assert.equal(f.publications.length, publicationCount);
  f.cleanup();
});
