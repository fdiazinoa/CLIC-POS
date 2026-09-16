import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveTerminalLoginLabel } from '../utils/terminalLoginLabel';

test('login muestra identidad activa en ambos layouts, nunca un POS-001 fijo', () => {
  assert.equal(resolveTerminalLoginLabel({ terminalCode: 'POS-002', name: 'CAJA-2' }), 'POS-002');
  assert.equal(resolveTerminalLoginLabel({ config: { erpBinding: { terminalName: 'Caja 01' } } }), 'Caja 01');
  assert.equal(resolveTerminalLoginLabel({ id: 'UUID-ACTIVO' }), 'UUID-ACTIVO');
  assert.equal(resolveTerminalLoginLabel({ label: 'CAJA-2' }), 'CAJA-2');
  assert.equal(resolveTerminalLoginLabel(null), 'Sin identificar');
  for (const file of ['LoginScreen', 'ModernLoginScreen']) {
    const source = readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Terminal ID: POS-001/);
    assert.match(source, /Terminal ID: \{terminalLabel/);
    assert.match(source, /onLogin\(user, \{ startedAt: lastAuthorizedInputAtRef\.current/);
  }
});

test('input válido mide targetcommit→rAF→task; delivery tardío conserva long tasks y excluye referencia inválida', async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  const oldObserver = Object.getOwnPropertyDescriptor(globalThis, 'PerformanceObserver');
  let timestamp = 100;
  const frames: Array<() => void> = []; const tasks: Array<() => void> = [];
  let observerCallback!: (list: { getEntries: () => Array<{ startTime: number; duration: number }> }) => void;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => timestamp } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => null },
    requestIdleCallback: () => 1,
    requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
    setTimeout: (callback: () => void) => { tasks.push(callback); return tasks.length; },
  } });
  Object.defineProperty(globalThis, 'PerformanceObserver', { configurable: true, value: class {
    static supportedEntryTypes = ['longtask']; constructor(callback: typeof observerCallback) { observerCallback = callback; } observe() {}
  } });
  try {
    const api = await import('../utils/interactionPerformance');
    (globalThis as any).window.__CLIC_POS_PERFORMANCE__.clear();
    const trace = api.beginPosInteraction('OPEN_SALE_SCREEN', { measurementBoundary: 'authorized-input-to-destination' }, 90);
    api.expectInteractionRender(trace, 'POS_INTERACTION_VIEW');
    api.markRenderEnd('APP_VIEW'); assert.equal(frames.length, 0);
    timestamp = 120; api.markRenderEnd('POS_INTERACTION_VIEW');
    assert.equal(trace.stages.RENDER_END, 120); assert.equal(frames.length, 1);
    assert.equal(api.getPosInteractionReport().OPEN_SALE_SCREEN.visibleSamples, 0);
    timestamp = 130; frames.shift()!();
    assert.equal(tasks.length, 1); assert.equal(trace.durations.inputToVisible, 40);
    // Delivered after commit but before task ack: a task in that gap must count.
    observerCallback({ getEntries: () => [{ startTime: 121, duration: 51 }] });
    timestamp = 175; tasks.shift()!();
    assert.equal(trace.durations.inputToInteractive, 85);
    timestamp = 190;
    observerCallback({ getEntries: () => [{ startTime: 100, duration: 60 }, { startTime: 180, duration: 60 }] });
    assert.equal(trace.longTasks.length, 2);
    api.beginPosInteraction('OPEN_SALE_SCREEN', { measurementBoundary: 'authorized-input-to-destination' }, Number.NaN);
    const report = api.getPosInteractionReport().OPEN_SALE_SCREEN;
    assert.equal(report.visibleSamples, 1); assert.equal(report.interactiveSamples, 1);
    assert.equal(report.inputToInteractiveP95Ms, 85); assert.equal(report.invalidInputBoundarySamples, 1);
    assert.equal(frames.length, 0); assert.equal(tasks.length, 0);
    for (let index = 0; index < 350; index++) api.beginPosInteraction('OPEN_SALE_SCREEN');
    assert.equal((globalThis as any).window.__CLIC_POS_PERFORMANCE__.getTraces().length, 300);
  } finally {
    for (const [key, descriptor] of [['window', oldWindow], ['performance', oldPerformance], ['PerformanceObserver', oldObserver]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key];
    }
  }
});
