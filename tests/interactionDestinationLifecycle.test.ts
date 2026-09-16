import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the actual caller's function body, with its dependencies replaced at
// the boundary. This tests branches without mounting the full sales application.
function caller(name: string, bindings: Record<string, unknown>, path = '../components/POSInterface.tsx') {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
  const source = ts.createSourceFile('POSInterface.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(initializer, `actual caller ${name}`);
  const compiled = ts.transpileModule(`const result = ${initializer!.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
    fileName: 'caller.tsx',
  }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return result;`)(...Object.values(bindings));
}

test('destination ownership, lazy lifetime, callbacks and real checkout branches', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let clock = 100;
  const frames: Array<() => void> = [];
  const tasks: Array<() => void> = [];
  const idle: Array<() => void> = [];
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
  const browser = {
    localStorage: { getItem: () => null },
    requestAnimationFrame: (fn: () => void) => { frames.push(fn); return frames.length; },
    setTimeout: (fn: () => void) => { tasks.push(fn); return tasks.length; },
    requestIdleCallback: (fn: () => void) => { idle.push(fn); return idle.length; },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  try {
    const api = await import('../utils/interactionPerformance');
    const clear = () => { (browser as any).__CLIC_POS_PERFORMANCE__.clear(); frames.length = 0; tasks.length = 0; };
    const paint = () => { clock += 10; frames.splice(0).forEach(fn => fn()); clock += 10; tasks.splice(0).forEach(fn => fn()); };
    clear();
    const trace = api.beginDestinationInteraction('CHECKOUT_OPEN', 90);
    api.expectInteractionDestination(trace, 'PAYMENT_MODAL');
    api.markRenderEnd('POS_INTERACTION_VIEW');
    api.markRenderEnd('PAYMENT_MODAL');
    api.commitInteractionDestination(trace, 'APP_VIEW');
    assert.equal(frames.length, 0);
    const other = api.beginDestinationInteraction('CHECKOUT_OPEN', 95);
    api.expectInteractionDestination(other, 'PAYMENT_MODAL');
    api.commitInteractionDestination(other, 'PAYMENT_MODAL'); paint();
    assert.equal(other.status, 'completed'); assert.equal(trace.status, 'pending');
    api.commitInteractionDestination(trace, 'PAYMENT_MODAL'); paint();
    assert.equal(trace.status, 'completed');
    const visible = trace.durations.inputToVisible;
    clock += 20; api.markInteractionStage(trace, 'RENDER_END');
    assert.equal(trace.durations.inputToVisible, visible);
    const renderAfterVisible = api.beginDestinationInteraction('CHECKOUT_OPEN', clock);
    api.markInteractionStage(renderAfterVisible, 'FIRST_FRAME_VISIBLE');
    const firstVisibleDuration = renderAfterVisible.durations.inputToVisible;
    clock += 30; api.markInteractionStage(renderAfterVisible, 'RENDER_END');
    assert.equal(renderAfterVisible.durations.inputToVisible, firstVisibleDuration);

    for (const end of ['cancelled', 'failed', 'expired', 'clear', 'superseded'] as const) {
      const pending = api.beginDestinationInteraction('CLOSE_TABLE_MAP', clock);
      api.expectInteractionDestination(pending, 'POS_RETAINED');
      let functionalCompletions = 0;
      api.commitInteractionDestination(pending, 'POS_RETAINED', () => functionalCompletions++);
      if (end === 'clear') (browser as any).__CLIC_POS_PERFORMANCE__.clear();
      else if (end === 'superseded') api.beginDestinationInteraction('CLOSE_TABLE_MAP', clock, pending);
      else if (end === 'expired') { clock += 60_001; api.getPosInteractionReport(); }
      else api.finishInteraction(pending, end);
      paint();
      assert.notEqual(pending.status, 'completed', end);
      assert.equal(pending.stages.FIRST_FRAME_INTERACTIVE, undefined, end);
      assert.equal(functionalCompletions, 1, `${end} does not control transition callback`);
    }
    const closeTrace = api.beginDestinationInteraction('CLOSE_TABLE_MAP', clock);
    api.expectInteractionDestination(closeTrace, 'POS_RETAINED');
    api.finishInteraction(closeTrace, 'cancelled');
    let released = 0;
    const effects: Array<() => void> = [];
    const hooks = {
      ...api, React: { createElement: () => null }, MemoizedPOSInterface: () => null,
      useRef: (value: unknown) => ({ current: value }),
      useLayoutEffect: (effect: () => void) => { effects.push(effect); },
    };
    caller('PersistentPOSHost', hooks, '../App.tsx')({ visible: true, closeTrace, onInteractive: () => released++ });
    effects.splice(0).forEach(effect => effect()); paint();
    assert.equal(released, 1, 'real retained host releases functional transition even after cancellation');
    for (const lifecycle of ['unmount-before-frame', 'unmount-before-task', 'strict-mode-replay'] as const) {
      const mountedTrace = api.beginDestinationInteraction('CLOSE_TABLE_MAP', clock);
      api.expectInteractionDestination(mountedTrace, 'POS_RETAINED');
      let completions = 0;
      caller('PersistentPOSHost', hooks, '../App.tsx')({ visible: true, closeTrace: mountedTrace, onInteractive: () => completions++ });
      const setup = effects.splice(0) as Array<() => void | (() => void)>;
      const cleanups = setup.map(effect => effect());
      assert.ok(cleanups.some(cleanup => typeof cleanup === 'function'), 'host must expose an unmount cleanup');
      if (lifecycle === 'unmount-before-task') {
        clock += 10; frames.splice(0).forEach(frame => frame());
      }
      cleanups.forEach(cleanup => { if (typeof cleanup === 'function') cleanup(); });
      if (lifecycle === 'strict-mode-replay') setup.forEach(effect => effect());
      paint();
      assert.equal(completions, 1, `${lifecycle}: release the functional transition exactly once`);
      if (lifecycle === 'strict-mode-replay') {
        assert.equal(mountedTrace.status, 'completed');
        assert.notEqual(mountedTrace.stages.FIRST_FRAME_INTERACTIVE, undefined);
      } else {
        assert.equal(mountedTrace.status, 'cancelled');
        assert.equal(mountedTrace.stages.FIRST_FRAME_INTERACTIVE, undefined);
        if (lifecycle === 'unmount-before-frame') assert.equal(mountedTrace.stages.FIRST_FRAME_VISIBLE, undefined);
      }
    }
    const hidden = api.beginDestinationInteraction('CLOSE_TABLE_MAP', clock);
    caller('TableMapLifecycleBoundary', hooks, '../App.tsx')({ visible: false, closeTrace: hidden });
    effects.splice(0).forEach(effect => effect());
    assert.equal(hidden.metadata?.unmounted, false);
    assert.equal(hidden.stages.TABLE_MAP_HIDE, clock);
    assert.equal(hidden.stages.TABLE_MAP_UNMOUNT_START, undefined);
    assert.equal(hidden.durations.tableMapUnmount, undefined);
    const navigatedAway = api.beginDestinationInteraction('CHECKOUT_OPEN', clock);
    api.expectInteractionDestination(navigatedAway, 'PAYMENT_MODAL');
    let stillVisible = true;
    api.commitInteractionDestination(navigatedAway, 'PAYMENT_MODAL', undefined, () => stillVisible);
    stillVisible = false; paint();
    assert.equal(navigatedAway.status, 'cancelled');
    assert.equal(navigatedAway.stages.FIRST_FRAME_VISIBLE, undefined);
    clear();
    const fallback = api.beginDestinationInteraction('CHECKOUT_OPEN');
    api.expectInteractionDestination(fallback, 'PAYMENT_MODAL'); api.commitInteractionDestination(fallback, 'PAYMENT_MODAL'); paint();
    assert.equal(api.getPosInteractionReport().CHECKOUT_OPEN.interactiveSamples, 0);
    assert.ok(api.getPosInteractionReport().CHECKOUT_OPEN.destinations.PAYMENT_MODAL.handlerToDestinationP95Ms! >= 0);

    const makeCheckout = (overrides: Record<string, unknown> = {}) => {
      const opened: boolean[] = [];
      const modalTrace = { current: null };
      const bindings = {
        ...api, window: browser, console: { error() {} }, isOrderTakerMode: false,
        handleSendAndExit: async () => undefined, setErrorToast() {}, cart: [{ quantity: 1 }],
        isValidCartQuantity: (value: number) => value > 0, alert() {}, refundAuthorizedBy: null,
        ensureSalesWithOpenZPermission: () => true, activePaymentFraction: null, isCurrentPaymentFraction: true,
        canCheckout: true, requestApproval: async () => true, amountDueNow: 100,
        activeTerminalConfig: null, isFiscalModeDisabled: true, cartTotal: 100, selectedCustomer: null,
        onOpenCustomers() {}, activeRecoveredReservation: null, setReturnToTableMapAfterPayment() {},
        recordCheckoutDiagnostic() {}, processedCart: [], activeTable: null, activeTerminalId: 'test',
        paymentModalTraceRef: modalTrace, setShowPaymentModal: (value: boolean) => opened.push(value),
        ...overrides,
      };
      return { proceed: caller('proceedToCheckout', bindings), opened, modalTrace };
    };
    for (const overrides of [
      { isOrderTakerMode: true }, { cart: [{ quantity: 0 }] },
      { canCheckout: false, requestApproval: async () => false },
      { activePaymentFraction: {}, isCurrentPaymentFraction: false },
      { ensureSalesWithOpenZPermission: () => false },
      { activeTerminalConfig: { operational: { fiscalThreshold: 1 } }, isFiscalModeDisabled: false, baseCurrency: { symbol: '$' } },
      { activeRecoveredReservation: {}, amountDueNow: 0, isRecoveredUberOrder: false, handlePaymentConfirm: async () => undefined },
    ]) {
      const flow = makeCheckout(overrides);
      const attempt = api.beginDestinationInteraction('CHECKOUT_OPEN', clock);
      await flow.proceed(attempt);
      assert.equal(flow.opened.length, 0); assert.equal(attempt.status, 'cancelled');
      api.markRenderEnd('POS_INTERACTION_VIEW'); assert.equal(frames.length, 0);
    }
    const flow = makeCheckout();
    const attempt = api.beginDestinationInteraction('CHECKOUT_OPEN', clock);
    let resolveWarning!: (allowed: boolean) => void;
    const request = caller('requestCheckout', {
      ...api, startCheckoutInteraction: () => attempt, isOrderTakerMode: false,
      validateTerminalDocument: () => ({ isValid: true }), config: {}, terminalId: 'test', alert() {},
      canProceedWithOperationalSession: () => new Promise<boolean>(resolve => { resolveWarning = resolve; }),
      proceedToCheckout: flow.proceed,
    });
    const pending = request(clock, true);
    api.markRenderEnd('POS_INTERACTION_VIEW'); assert.equal(frames.length, 0);
    assert.equal(attempt.status, 'pending');
    resolveWarning(true); await pending;
    assert.deepEqual(flow.opened, [true]); assert.equal(flow.modalTrace.current, attempt);
    assert.equal(attempt.status, 'pending');
    api.commitInteractionDestination(flow.modalTrace.current, 'PAYMENT_MODAL'); paint();
    assert.equal(attempt.status, 'completed');
    for (const denial of ['session', 'fiscal'] as const) {
      const denied = api.beginDestinationInteraction('CHECKOUT_OPEN', clock);
      const denyRequest = caller('requestCheckout', {
        ...api, startCheckoutInteraction: () => denied, isOrderTakerMode: false,
        validateTerminalDocument: () => ({ isValid: denial !== 'fiscal' }), config: {}, terminalId: 'test', alert() {},
        canProceedWithOperationalSession: async () => denial !== 'session',
        proceedToCheckout: () => assert.fail('denied entry reached checkout'),
      });
      await denyRequest(clock, true);
      assert.equal(denied.status, 'cancelled');
    }

    const failed = api.beginDestinationInteraction('CHECKOUT_OPEN', clock);
    await assert.rejects(makeCheckout({ requestApproval: async () => { throw new Error('approval unavailable'); }, canCheckout: false }).proceed(failed));
    assert.equal(failed.status, 'failed');
    const first = api.beginDestinationInteraction('OPEN_TABLE', clock);
    api.expectInteractionDestination(first, 'POS_TABLE'); api.commitInteractionDestination(first, 'POS_TABLE');
    for (let i = 0; i < 350; i++) api.beginDestinationInteraction('OPEN_TABLE', clock);
    paint(); assert.equal(first.status, 'expired');
    assert.equal((browser as any).__CLIC_POS_PERFORMANCE__.getTraces().length, 300);
    assert.equal(frames.length, 0); assert.equal(tasks.length, 0);
  } finally {
    for (const [name, descriptor] of [['window', priorWindow], ['performance', priorPerformance]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name];
    }
  }
});
