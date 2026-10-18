import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Execute the production completion block and manager, with imported ports and clocks
// isolated. This is a component integration test, not a mounted App/SQLite/network test.
function findNode(root: ts.Node, match: (node: ts.Node) => boolean): ts.Node | undefined {
  if (match(root)) return root;
  let result: ts.Node | undefined;
  ts.forEachChild(root, node => { result ||= findNode(node, match); });
  return result;
}
function compile(code: string) {
  return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
function completion() {
  const text = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = findNode(file, n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'handlePairTerminal') as ts.VariableDeclaration;
  assert.ok(declaration && declaration.initializer && ts.isArrowFunction(declaration.initializer));
  const block = findNode(declaration.initializer, n => ts.isTryStatement(n)) as ts.TryStatement;
  assert.ok(block);
  const statements = block.tryBlock.statements;
  const start = statements.map(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'persistStoredErpSyncBinding').lastIndexOf(true);
  assert.ok(start >= 0, 'production successful binding continuation must exist');
  // No manually duplicated startup call: removing it from production must fail below.
  return compile(`async function finish() { ${statements.slice(start).map(n => n.getText(file)).join('\n')} }`);
}
function harness(adapterType = 'sqlite') {
  const text = readFileSync(new URL('../services/sync/BackgroundSyncManager.ts', import.meta.url), 'utf8');
  const file = ts.createSourceFile('BackgroundSyncManager.ts', text, ts.ScriptTarget.Latest, true);
  const declaration = findNode(file, n => ts.isClassDeclaration(n) && n.name?.text === 'BackgroundSyncManager');
  assert.ok(declaration);
  const intervals = new Map<number, () => unknown>();
  const timeouts = new Map<number, () => unknown>();
  const values = new Map<string, string>();
  const events = new Map<string, Set<unknown>>();
  let id = 0, sends = 0, saleActive = false, canPush = true, bound = false, authorized = false;
  const order: string[] = [];
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  const surface = { localStorage: storage, addEventListener(name: string, handler: unknown) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(handler); }, removeEventListener(name: string, handler: unknown) { events.get(name)?.delete(handler); } };
  const noop = () => undefined;
  const ports = {
    db: { get: async () => [], save: async () => undefined }, dbAdapter: { adapterType },
    apiSyncAdapter: { resetCircuit: noop }, permissionService: { isMasterTerminal: () => true },
    isRecoveredOperation: () => false, isFormatOwnedDocument: () => false,
    isPosSaleActive: () => saleActive, POS_SALE_ACTIVITY_EVENT: 'sale-activity',
    waitForBackgroundSyncWindow: async () => false,
    // Pause after durable sender: unrelated catalog/legacy queues are outside scope.
    yieldBackgroundSyncChunk: async () => { saleActive = true; },
    syncPolicy: { resolve: () => ({ kind: 'ERP_ACTIVE', canPushOperations: canPush }), targetKind: () => 'ERP_ACTIVE' },
    authenticatedActivityTracker: { record: noop },
    syncMetrics: { getSnapshot: () => ({ outbox_pending_count: 1, outbox_oldest_age: 0 }), setOutboxState: noop },
    isSyncFeatureEnabled: () => true,
    durableOutboxBatchSender: { sendNext: async () => { assert.ok(bound && authorized, 'sender cannot run before completed binding/auth persistence'); sends++; order.push('send'); return { retrying: 0 }; } },
    durableOutboxRepository: { isSupported: () => true, refreshMetrics: async () => undefined },
    transferReceiptService: { recoverInterrupted: async () => undefined, list: async () => [], processDue: async () => [] },
    getPendingMasterNumberRanges: async () => [], markNumberedMasterSynced: noop, reportPendingMasterNumberRangeProgress: noop,
    navigator: { onLine: true }, window: surface, document: { ...surface, hidden: false },
    setInterval: (fn: () => unknown) => { const key = ++id; intervals.set(key, fn); return key; }, clearInterval: (key: number) => intervals.delete(key),
    setTimeout: (fn: () => unknown) => { const key = ++id; timeouts.set(key, fn); return key; }, clearTimeout: (key: number) => timeouts.delete(key),
    console: { log: noop, info: noop, warn: noop, error: (error: unknown) => { throw error; } },
  };
  const Manager = new Function(...Object.keys(ports), `${compile(declaration.getText(file))}; return BackgroundSyncManager;`)(...Object.values(ports));
  const manager = new Manager();
  const ui: Record<string, unknown> = {
    setupResult: { tenantId: 'tenant', companyId: 'company', storeId: 'store' }, localStorage: storage,
    resolvedErpTerminalId: 'erp-terminal', resolvedOperationalTerminalId: 'terminal', resolvedTerminalName: 'Demo',
    isSlave: adapterType === 'network', isErpDirectBinding: true, resolvedErpReadyForSales: true,
    TERMINAL_SETUP_PENDING_KEY: 'setup-pending', TERMINAL_BINDING_STATUS_KEY: 'binding-status',
    persistStoredErpSyncBinding: () => { bound = true; order.push('binding'); },
    clearClientBindingRecovery: noop, setTerminalBindingDiagnosticStatus: noop, setCatalogDiagnosticStatus: noop,
    setSalesPushDiagnosticStatus: noop, clearSyncErrorDiagnostic: noop, setSyncDiagnostic: noop,
    clearPersistedTerminalAuthorizationBlock: () => order.push('auth-clear'),
    markDeviceReauthorized: () => { authorized = true; order.push('authorized'); }, deviceId: 'device',
    backgroundSyncManager: manager, console: ports.console, posCloudStagingService: {}, shouldTakeover: false,
    setCurrentView: (view: string) => { assert.equal(view, 'LOGIN'); order.push('login'); },
  };
  const finish = () => new Function(...Object.keys(ui), `${completion()}; return finish();`)(...Object.values(ui));
  const flush = async () => { for (let n = 0; n < 100; n++) await Promise.resolve(); };
  return { manager, finish, flush, intervals, timeouts, events, order, get sends() { return sends; }, setCanPush(value: boolean) { canPush = value; }, async tick() { saleActive = false; for (const fn of [...intervals.values()]) await fn(); await flush(); } };
}

test('fresh binding starts real durable sender without reload, then retains one worker on repeat initialization', async () => {
  const h = harness();
  await h.tick(); assert.equal(h.sends, 0, 'before binding there is no worker');
  await h.finish(); await h.flush();
  assert.equal(h.manager.isRemoteSyncActive(), true);
  assert.equal(h.sends, 1);
  assert.equal(h.intervals.size, 1);
  assert.ok(h.order.indexOf('binding') < h.order.indexOf('authorized'));
  assert.ok(h.order.indexOf('authorized') < h.order.indexOf('send'));
  await h.manager.initialize(); await h.manager.initialize();
  assert.equal(h.intervals.size, 1); assert.equal(h.events.get('online')?.size, 1);
  await h.tick(); assert.equal(h.sends, 2, 'one worker tick invokes sender once');
  h.manager.stopForAuthorizationLoss();
  assert.equal(h.intervals.size, 0); assert.equal(h.timeouts.size, 0);
  await h.tick(); assert.equal(h.sends, 2);
});

test('fresh binding preserves network-adapter and disabled-remote guards', async () => {
  const slave = harness('network'); await slave.finish(); await slave.flush();
  assert.equal(slave.intervals.size, 0); assert.equal(slave.sends, 0);
  const stopped = harness(); stopped.manager.disableRemoteSync('authority-unavailable');
  await stopped.finish(); await stopped.flush();
  assert.equal(stopped.intervals.size, 0); assert.equal(stopped.sends, 0);
});

test('initialization cannot bypass operational authorization and resumes through existing worker after permission recovers', async () => {
  const h = harness(); h.setCanPush(false);
  await h.finish(); await h.flush();
  assert.equal(h.intervals.size, 1); assert.equal(h.sends, 0);
  h.setCanPush(true); await h.tick(); assert.equal(h.sends, 1);
  h.manager.stopForAuthorizationLoss();
});
