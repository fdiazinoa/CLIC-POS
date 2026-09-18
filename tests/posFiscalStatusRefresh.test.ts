import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';

// Execute the production effect unchanged. Model React dependency comparison;
// mock only collection reads and state setters, never fiscal allocation logic.
const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const checkIndex = source.indexOf('const checkFiscalStatus = async () => {');
assert.ok(checkIndex >= 0);
const start = source.lastIndexOf('   useEffect(() => {', checkIndex);
const end = source.indexOf('   const fiscalReserveAlert = useMemo(', checkIndex);
assert.ok(start >= 0 && end > checkIndex);
const effect = new Script(ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
const terminalId = 'qa-terminal';

const configuredState = (next = 3108, allocationStatus = 'ACTIVE') => ({
  fiscalAllocations: [{ id: 'qa-allocation', terminalId, fiscalRangeId: 'qa-range', ncfType: 'B02', reservedStart: 3001, reservedEnd: 5000, nextNumber: next, status: allocationStatus }],
  fiscalRanges: [{ id: 'qa-range', type: 'B02', prefix: 'B02', startNumber: 1, endNumber: 5000, currentGlobal: next - 1, expiryDate: '2026-12-31', isActive: allocationStatus === 'ACTIVE' }],
});

const harness = () => {
  let previous: unknown[] | undefined;
  let cleanup: (() => void) | undefined;
  let collections: Record<string, unknown[]> = { localFiscalBuffer: [], fiscalAllocations: [], fiscalRanges: [] };
  let fiscalStatus: any;
  let displayedStatus: any;
  let reads = 0;
  const context = createContext({
    requiredSaleFiscalType: 'B02', terminalId, isFiscalModeDisabled: false, isOrderTakerMode: false,
    activeTerminalConfig: { fiscal: { fiscalAllocations: [], fiscalRanges: [] } },
    db: { get: async (name: string) => { reads++; return structuredClone(collections[name]); } },
    setStatus: (status: unknown) => { displayedStatus = status; },
    setFiscalStatus: (status: unknown) => { fiscalStatus = status; },
    useEffect: (callback: () => (() => void), dependencies: unknown[]) => {
      if (previous && dependencies.length === previous.length && dependencies.every((value, index) => Object.is(value, previous![index]))) return;
      cleanup?.(); previous = [...dependencies]; cleanup = callback();
    },
  });
  return {
    async render() { effect.runInContext(context); await new Promise<void>(resolve => setImmediate(resolve)); },
    update(state: ReturnType<typeof configuredState>) {
      collections = { ...collections, ...state };
      context.activeTerminalConfig = { fiscal: state };
    },
    unrelatedUpdate() { context.activeTerminalConfig = { ...context.activeTerminalConfig }; },
    disable() { context.isFiscalModeDisabled = true; },
    orderTaker() { context.isOrderTakerMode = true; },
    get fiscal() { return fiscalStatus; }, get display() { return displayedStatus; }, get reads() { return reads; },
    get stored() { return structuredClone(collections); },
  };
};

test('assigned B02 arriving after mount removes stale exhausted status without changing terminal or fiscal mode', async () => {
  const h = harness(); await h.render(); assert.equal(h.fiscal.hasNCF, false);
  h.update(configuredState()); const before = h.stored; await h.render();
  assert.equal(h.fiscal.hasNCF, true); assert.equal(h.fiscal.isTerminalBlock, true);
  assert.equal(h.fiscal.remaining, 1893); assert.equal(h.display.currentNCF, 'B0200003108');
  assert.deepEqual(h.stored, before, 'status refresh must never reserve or consume a number');
});

test('authoritative exhaustion refreshes a previously available B02 status', async () => {
  const h = harness(); h.update(configuredState()); await h.render(); assert.equal(h.fiscal.hasNCF, true);
  h.update(configuredState(5001, 'EXHAUSTED')); const before = h.stored; await h.render();
  assert.equal(h.fiscal.hasNCF, false); assert.deepEqual(h.stored, before);
});

test('advancing an available assignment refreshes next number and remaining count', async () => {
  const h = harness(); h.update(configuredState()); await h.render();
  h.update(configuredState(3109)); await h.render();
  assert.equal(h.fiscal.hasNCF, true); assert.equal(h.display.currentNCF, 'B0200003109'); assert.equal(h.fiscal.remaining, 1892);
});

test('range availability arriving without a terminal allocation refreshes the pool status', async () => {
  const h = harness(); await h.render(); const state = configuredState(); state.fiscalAllocations = [];
  h.update(state); await h.render(); assert.equal(h.fiscal.hasNCF, true); assert.equal(h.fiscal.isUsingPool, true);
});

test('unrelated terminal configuration changes do not reread fiscal collections', async () => {
  const h = harness(); h.update(configuredState()); await h.render(); const reads = h.reads;
  h.unrelatedUpdate(); await h.render(); assert.equal(h.reads, reads); assert.equal(h.fiscal.hasNCF, true);
});

test('nonfiscal mode keeps checkout policy without reading or consuming fiscal data', async () => {
  const h = harness(); h.disable(); await h.render(); assert.equal(h.fiscal.hasNCF, true); assert.equal(h.reads, 0);
});

test('order taker keeps its nonissuing behavior without reading fiscal data', async () => {
  const h = harness(); h.orderTaker(); await h.render(); assert.equal(h.fiscal.hasNCF, true); assert.equal(h.reads, 0);
});
