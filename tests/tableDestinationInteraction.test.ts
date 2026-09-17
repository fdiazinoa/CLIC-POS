import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const sources = Object.fromEntries(['App', 'TableMap'].map(name => {
  const path = name === 'App' ? '../App.tsx' : '../components/TableMap.tsx';
  return [name, ts.createSourceFile(`${name}.tsx`, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)];
}));

function executeExpression(file: 'App' | 'TableMap', select: (node: ts.Node, source: ts.SourceFile) => ts.Expression | undefined, bindings: Record<string, unknown>) {
  const source = sources[file];
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node) => { const match = select(node, source); if (match) found.push(match); ts.forEachChild(node, visit); };
  visit(source);
  assert.equal(found.length, 1, 'select one actual caller expression');
  const compiled = ts.transpileModule(`const result = ${found[0].getText(source)};`, {
    fileName: 'caller.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return result;`)(...Object.values(bindings));
}
const declaration = (file: 'App' | 'TableMap', name: string, bindings: Record<string, unknown>) => executeExpression(file,
  (node, source) => ts.isVariableDeclaration(node) && node.name.getText(source) === name ? node.initializer : undefined, bindings);
const attribute = (file: 'App' | 'TableMap', name: string, containing: string, bindings: Record<string, unknown>) => executeExpression(file,
  (node, source) => ts.isJsxAttribute(node) && node.name.getText(source) === name && node.initializer && ts.isJsxExpression(node.initializer)
    && node.initializer.expression?.getText(source).includes(containing) ? node.initializer.expression : undefined, bindings);
const localCommitEffect = (bindings: Record<string, unknown>) => executeExpression('TableMap',
  (node, source) => ts.isCallExpression(node) && node.expression.getText(source) === 'useLayoutEffect'
    && node.arguments[0]?.getText(source).includes('committedLocalDestinationRef.current = ready') ? node.arguments[0] : undefined, bindings);

test('real table branches own selectors and hydrated POS destinations without borrowing old traces', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let clock = 100;
  const frames: Array<() => void> = []; const tasks: Array<() => void> = [];
  const browser = {
    localStorage: { getItem: () => null }, requestIdleCallback: () => 1,
    requestAnimationFrame: (fn: () => void) => { frames.push(fn); return frames.length; },
    setTimeout: (fn: () => void) => { tasks.push(fn); return tasks.length; },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
  try {
    const api = await import('../utils/interactionPerformance');
    const clear = () => { (browser as any).__CLIC_POS_PERFORMANCE__.clear(); frames.length = 0; tasks.length = 0; };
    const paint = () => { clock += 10; frames.splice(0).forEach(fn => fn()); clock += 10; tasks.splice(0).forEach(fn => fn()); };
    const baseTable = { id: 'table-a', name: 'Table A', status: 'FREE', shape: 'SQUARE' };
    const setup = (overrides: Record<string, unknown> = {}) => {
      const state: Record<string, any> = { selectedAccountTable: null, selectedBarTable: null, selectedTable: null, tableNotice: null };
      const refs = { openTraceRef: { current: null as any }, openingOriginVisibleRef: { current: true }, localDestinationRef: { current: null as any }, committedLocalDestinationRef: { current: null as any } };
      const opened: Array<{ table: any; trace: any }> = [];
      const cancelled: unknown[] = [];
      const bindings: Record<string, any> = {
        ...api, ...refs, useCallback: (fn: unknown) => fn, window: browser, console: { error() {}, log() {} },
        safeTables: [baseTable], getTableTickets: () => [], isRestaurantMode: true,
        onBeforeTableOpen: async () => true, onOpenTable: undefined, onRefreshTables() {},
        onUpdateParkedTickets: undefined, onUpdateTables: undefined,
        createTableAccount: async () => ({ id: 'created-account', timestamp: 'now' }), currentUser: { id: 'user', name: 'Operator' },
        onTableClick: (table: any, trace: any) => { opened.push({ table, trace }); },
        getTableLabel: (table: any) => table.name, alert() {},
        onTableOpenCancelled: async (table: unknown) => { cancelled.push(table); },
        setSelectedAccountTable: (value: unknown) => { state.selectedAccountTable = value; },
        setSelectedBarTable: (value: unknown) => { state.selectedBarTable = value; },
        setSelectedTable: (value: unknown) => { state.selectedTable = value; },
        setTableNotice: (value: unknown) => { state.tableNotice = value; },
        resolveValidatedOperationalApiUrl: async (path: string) => path,
        fetch: async () => ({ ok: true, json: async () => ({ status: 'success', orden_id: 'http-account' }) }),
        ...overrides,
      };
      for (const name of ['beginTableInteraction', 'expectLocalDestination', 'openPosTable']) bindings[name] = declaration('TableMap', name, bindings);
      const open = declaration('TableMap', 'handleTableAction', bindings);
      const commitLocal = (visible = true) => localCommitEffect({ ...bindings, ...state, visible })();
      return { state, refs, bindings, open, opened, cancelled, commitLocal };
    };

    for (const [target, table, overrides] of [
      ['TABLE_ACCOUNTS', baseTable, { getTableTickets: () => [{ id: 'existing' }] }],
      ['BAR_TABS', { ...baseTable, shape: 'BAR' }, {}],
      ['TABLE_NOTICE', { ...baseTable, joinedTableName: 'Joined' }, {}],
      ['TABLE_PREVIEW', baseTable, { isRestaurantMode: false }],
    ] as const) {
      clear(); const flow = setup(overrides);
      const trace = flow.bindings.beginTableInteraction('map-node', clock);
      await flow.open(table, trace);
      assert.equal(trace.renderTarget, target); assert.equal(flow.opened.length, 0);
      api.markRenderEnd('TABLE_MAP_VIEW'); api.markRenderEnd('APP_VIEW'); paint();
      assert.equal(trace.status, 'pending', 'spinner and parent cannot consume final destination');
      flow.commitLocal(); paint();
      assert.equal(trace.status, 'completed');
      assert.equal(trace.metadata.source, 'map-node');
      assert.equal(trace.metadata.tableId, undefined, 'business identity is not exported in trace metadata');
    }
    for (const [overrides, status] of [
      [{ onBeforeTableOpen: async () => false }, 'cancelled'],
      [{ onOpenTable: async () => null }, 'cancelled'],
      [{ onBeforeTableOpen: async () => { throw new Error('lock failed'); } }, 'failed'],
      [{ fetch: async () => ({ ok: false, json: async () => ({ status: 'error' }) }) }, 'failed'],
      [{ fetch: async () => { throw new Error('network'); } }, 'failed'],
    ] as const) {
      clear(); const flow = setup(overrides);
      const trace = flow.bindings.beginTableInteraction('map-node', clock);
      try { await flow.open(baseTable, trace); } catch (error) { assert.match(String(error), /lock failed/); }
      assert.equal(trace.status, status); assert.equal(flow.opened.length, 0);
      api.markRenderEnd('TABLE_MAP_VIEW'); paint(); assert.equal(trace.stages.FIRST_FRAME_INTERACTIVE, undefined);
    }
    clear();
    const locked = setup();
    const openingRef = { current: null as string | null };
    const selectNode = declaration('TableMap', 'handleNodeSelect', {
      ...locked.bindings, openingTableIdRef: openingRef, transferSelection: null,
      handleTableAction: () => assert.fail('locked node must not open'),
      handleTransferTableClick: () => false, setOpeningTableId() {},
    });
    selectNode({ table: baseTable, isLocked: true }, clock);
    assert.equal(locked.refs.openTraceRef.current.status, 'cancelled');
    const lockedTrace = locked.refs.openTraceRef.current;
    openingRef.current = baseTable.id;
    selectNode({ table: baseTable, isLocked: false }, clock);
    assert.equal(locked.refs.openTraceRef.current, lockedTrace, 'single-flight guard remains unchanged');
    for (const [table, overrides, order] of [
      [{ ...baseTable, status: 'OCCUPIED', currentOrderId: 'existing' }, {}, 'existing'],
      [baseTable, { onUpdateParkedTickets() {}, onUpdateTables() {} }, 'created-account'],
      [baseTable, { onOpenTable: async () => ({ ...baseTable, currentOrderId: 'opened-account' }) }, 'opened-account'],
      [baseTable, {}, 'http-account'],
    ] as const) {
      clear(); const flow = setup(overrides); const trace = flow.bindings.beginTableInteraction('map-node', clock);
      await flow.open(table, trace);
      assert.equal(flow.opened.length, 1); assert.equal(flow.opened[0].trace, trace);
      assert.equal(flow.opened[0].table.currentOrderId, order); assert.equal(trace.renderTarget, 'POS_TABLE');
      assert.equal(trace.status, 'pending');
    }

    clear(); const flow = setup({ getTableTickets: () => [{ id: 'existing' }] });
    const selectorTrace = flow.bindings.beginTableInteraction('map-node', clock);
    await flow.open(baseTable, selectorTrace); flow.commitLocal(); paint();
    const selection = attribute('TableMap', 'onOpenTab', "beginTableInteraction('account-selection'", { ...flow.bindings, ...flow.state });
    clock += 5000; // Operator decision time must not be charged to opening POS.
    const items = [{ id: 'item', quantity: 1, price: 100 }];
    selection({ id: 'account-selected', items, timestamp: 'now' }, clock);
    const selected = flow.opened[0];
    assert.notEqual(selected.trace, selectorTrace); assert.equal(selectorTrace.status, 'completed');
    assert.equal(selected.trace.startedAt, clock); assert.equal(selected.trace.metadata.source, 'account-selection');
    assert.equal(selected.trace.renderTarget, 'POS_TABLE');

    // Execute App's actual hydration callback and retained-host layout effects.
    const appState: Record<string, any> = { cart: [], activeTable: null, view: 'TABLE_MAP' };
    const ownerRef = { current: null as any };
    const onTableClick = attribute('App', 'onTableClick', 'tableOpenDestinationRef.current', {
      ...api, window: browser, console: { log() {} }, tableOpenDestinationRef: ownerRef,
      setSuppressProductInputUntilMs() {}, isClientTerminalMode: () => false, pendingClientTableSyncRef: { current: null },
      parkedTickets: [{ id: 'account-selected', tableId: baseTable.id, items }], transactions: [], customers: [],
      markRestaurantLinesCommitted: (value: unknown[]) => value,
      setCart: (value: unknown) => { appState.cart = value; }, setSelectedCustomer() {},
      setActiveTable: (value: unknown) => { appState.activeTable = value; }, setCurrentView: (value: unknown) => { appState.view = value; },
    });
    onTableClick(selected.table, selected.trace);
    assert.equal(appState.view, 'TABLE_MAP'); assert.equal(ownerRef.current.trace, selected.trace);
    assert.equal(ownerRef.current.orderId, 'account-selected'); assert.equal(ownerRef.current.cart, items);
    paint(); assert.equal(appState.view, 'POS');
    const effects: Array<() => void | (() => void)> = []; const refs: Array<{ current: any }> = [];
    let refIndex = 0; let cleanups: Array<void | (() => void)> = [];
    const host = declaration('App', 'PersistentPOSHost', {
      ...api, React: { createElement: () => null }, MemoizedPOSInterface: () => null,
      useRef: (value: unknown) => refs[refIndex++] ||= { current: value },
      useLayoutEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
    });
    const renderHost = (props: Record<string, unknown>) => {
      cleanups.forEach(cleanup => { if (typeof cleanup === 'function') cleanup(); });
      refIndex = 0; host(props); cleanups = effects.splice(0).map(effect => effect());
    };
    renderHost({ visible: true, tableDestination: ownerRef.current, activeTable: { id: 'wrong-table', currentOrderId: 'account-selected' }, cart: items });
    paint(); assert.equal(selected.trace.status, 'pending');
    renderHost({ visible: true, tableDestination: ownerRef.current, activeTable: { ...appState.activeTable, currentOrderId: 'wrong-account' }, cart: items });
    paint(); assert.equal(selected.trace.status, 'pending');
    renderHost({ visible: true, tableDestination: ownerRef.current, activeTable: appState.activeTable, cart: [...items] });
    paint(); assert.equal(selected.trace.status, 'pending');
    renderHost({ visible: false, tableDestination: ownerRef.current, activeTable: appState.activeTable, cart: items });
    paint(); assert.equal(selected.trace.status, 'pending');
    renderHost({ visible: true, tableDestination: ownerRef.current, activeTable: appState.activeTable, cart: items });
    paint(); assert.equal(selected.trace.status, 'completed');
    const report = api.getPosInteractionReport().OPEN_TABLE;
    assert.equal(report.mixedDestinations, true); assert.equal(report.inputLatencyP95Ms, null);
    assert.equal(report.destinations.TABLE_ACCOUNTS.completed, 1); assert.equal(report.destinations.POS_TABLE.completed, 1);
    assert.ok(report.destinations.POS_TABLE.inputToDestinationP95Ms! < 5000);

    clear(); const abandoned = setup({ getTableTickets: () => [{}] });
    const abandonedTrace = abandoned.bindings.beginTableInteraction('map-node', clock);
    await abandoned.open(baseTable, abandonedTrace); abandoned.commitLocal();
    const closePreview = declaration('TableMap', 'closeTablePreview', abandoned.bindings);
    let closeCount = 0; closePreview(baseTable, () => closeCount++); paint();
    assert.equal(abandonedTrace.status, 'cancelled'); assert.equal(closeCount, 1);
    assert.deepEqual(abandoned.cancelled, [baseTable], 'business lock release is preserved');
    const old = abandoned.bindings.beginTableInteraction('map-node', clock);
    await abandoned.open(baseTable, old); abandoned.commitLocal();
    abandoned.bindings.beginTableInteraction('map-node', clock); paint();
    assert.equal(old.status, 'cancelled'); assert.equal(old.stages.FIRST_FRAME_INTERACTIVE, undefined);

    // Opening a new destination cannot acknowledge a stale mounted owner.
    const stale = api.beginDestinationInteraction('OPEN_TABLE', clock); api.expectInteractionDestination(stale, 'POS_TABLE');
    const staleOwner = { trace: stale, tableId: baseTable.id, orderId: 'account-selected', cart: items };
    renderHost({ visible: true, tableDestination: staleOwner, activeTable: appState.activeTable, cart: items });
    renderHost({ visible: true, tableDestination: null, activeTable: appState.activeTable, cart: items });
    paint(); assert.equal(stale.status, 'cancelled'); assert.equal(stale.stages.FIRST_FRAME_VISIBLE, undefined);

    for (const lifecycle of ['hide-pending', 'unmount-pending', 'hide-show-pending', 'strict-mode-replay', 'normal-handoff'] as const) {
      clear(); ownerRef.current = null; appState.view = 'TABLE_MAP';
      let resolveLock!: (allowed: boolean) => void;
      const lock = new Promise<boolean>(resolve => { resolveLock = resolve; });
      let businessCalls = 0;
      const pendingFlow = setup({
        onBeforeTableOpen: () => lock,
        onTableClick: (table: unknown, trace: unknown) => { businessCalls++; onTableClick(table, trace); },
      });
      const originCleanup = pendingFlow.commitLocal(true);
      const pendingTrace = pendingFlow.bindings.beginTableInteraction('map-node', clock);
      const pendingOpen = pendingFlow.open({ ...baseTable, status: 'OCCUPIED', currentOrderId: 'account-selected' }, pendingTrace);
      assert.equal(ownerRef.current, null, 'App does not own the trace while its pre-open lock awaits');
      if (lifecycle.startsWith('hide')) {
        const closeMap = declaration('App', 'handleCloseTableMap', {
          ...api, tableOpenDestinationRef: ownerRef, tableMapExitPending: false,
          tableMapCloseTraceRef: { current: null }, tableMapExitTransitionRef: { current: null },
          beginOperatorUiTransition: () => null, setTableMapExitPending() {}, setViewData() {},
          setCurrentView: (view: string) => { appState.view = view; },
        });
        closeMap({ timeStamp: clock }); originCleanup(); pendingFlow.commitLocal(false);
        assert.equal(pendingTrace.status, 'cancelled');
        if (lifecycle === 'hide-show-pending') pendingFlow.commitLocal(true);
      } else if (lifecycle !== 'normal-handoff') {
        originCleanup();
        if (lifecycle === 'strict-mode-replay') pendingFlow.commitLocal(true);
      }
      resolveLock(true); await pendingOpen;
      assert.equal(businessCalls, 1, `${lifecycle}: preserve the existing async opening callback`);
      if (lifecycle === 'normal-handoff') {
        assert.equal(pendingTrace.renderTarget, 'POS_TABLE');
        originCleanup(); pendingFlow.commitLocal(false);
        assert.equal(pendingTrace.status, 'pending', 'normal ownership transfer must survive hiding Mesas');
      }
      paint();
      renderHost({ visible: true, tableDestination: ownerRef.current, activeTable: appState.activeTable, cart: appState.cart });
      paint();
      const expected = lifecycle === 'strict-mode-replay' || lifecycle === 'normal-handoff' ? 'completed' : 'cancelled';
      assert.equal(pendingTrace.status, expected, lifecycle);
      if (expected === 'cancelled') {
        assert.equal(pendingTrace.stages.FIRST_FRAME_VISIBLE, undefined);
        assert.equal(pendingTrace.stages.FIRST_FRAME_INTERACTIVE, undefined);
        assert.equal(ownerRef.current, null, 'abandoned trace must not be transferred back into App');
      }
    }
    assert.doesNotMatch(sources.TableMap.text, /getLatestPosInteraction/);
    assert.doesNotMatch(sources.App.text, /getLatestPosInteraction\('OPEN_TABLE'\)/);
  } finally {
    for (const [name, descriptor] of [['window', priorWindow], ['performance', priorPerformance]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name];
    }
  }
});
