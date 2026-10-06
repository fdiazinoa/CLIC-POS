import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { getInitialConfig } from '../constants';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';
import { reconcileV3TariffSelection, v3TariffContextKey, isV3TariffContextCurrent } from '../services/sync/LargeMasterSyncV3TariffSelection';

// Actual Duarte_01 terminal authority, captured read-only; these are IDs, not secrets.
const terminalId = '47f14fc0-e808-4d9a-a906-21df1d6c5294';
const duarte = '9bfbcfaf-1594-42d5-8c91-0b22c58dde6d';
const mayorista = '9a9716a4-805d-427a-a1bb-b371a7c25ec5';
const ids = [duarte, mayorista];
const base = () => {
  const config = getInitialConfig('Supermercado' as any);
  config.terminals = [{ id: terminalId, config: structuredClone(config.terminals[0].config) }];
  config.tariffs = ['VILLA', 'SANTIAGO', duarte, mayorista, 'EXTRA1', 'EXTRA2'].map(id => ({ id, name: id, taxIncluded: true })) as any;
  config.terminals[0].config.pricing = { defaultTariffId: 'VILLA', allowedTariffIds: config.tariffs.map(row => row.id), tariffs: config.tariffs };
  return config;
};
const apply = (snapshot: unknown, v3 = true) => applyTerminalConfigSnapshot(base(), { terminalId,
  preserveOmittedOperationalScopes: v3, incomingSnapshot: snapshot as any });

for (const pricing of [
  { defaultTariffId: duarte, allowedTariffIds: ids },
  { default_tariff_id: duarte, allowed_tariff_ids: ids },
]) test('fresh config.pricing selects exactly Duarte two tariffs without resolved.pricing', () => {
  const result = apply({ terminal_id: terminalId, resolved: { identity: { id: terminalId } }, config: { pricing } });
  assert.equal(result.config.terminals[0].config.pricing.defaultTariffId, duarte);
  assert.deepEqual(result.config.terminals[0].config.pricing.allowedTariffIds, ids);
  assert.equal(result.config.tariffs.length, 6, 'global catalog is not narrowed or invented');
});

test('explicit resolved authority wins over conflicting config.pricing', () => {
  const result = apply({ resolved: { pricing: { default_tariff_id: duarte, allowed_tariff_ids: ids } },
    config: { pricing: { defaultTariffId: 'VILLA', allowedTariffIds: ['VILLA'] } } });
  assert.equal(result.config.terminals[0].config.pricing.defaultTariffId, duarte);
  assert.deepEqual(result.config.terminals[0].config.pricing.allowedTariffIds, ids);
});
for (const malformed of [null, {}, [], { defaultTariffId: duarte, allowedTariffIds: [] },
  { defaultTariffId: 'VILLA', allowedTariffIds: ids }, { defaultTariffId: duarte, allowedTariffIds: [duarte, 1] },
  { defaultTariffId: ' ', allowedTariffIds: [' '] }]) {
  for (const scope of ['resolved', 'config']) test(`reject malformed explicit ${scope} pricing ${JSON.stringify(malformed)}`, () => {
    const config = base(); const before = structuredClone(config);
    assert.throws(() => applyTerminalConfigSnapshot(config, { terminalId, preserveOmittedOperationalScopes: true,
      incomingSnapshot: { [scope]: { pricing: malformed }, ...(scope === 'resolved' ? { config: { pricing: { defaultTariffId: duarte, allowedTariffIds: ids } } } : {}) } as any,
    }), /SYNC_V3_TERMINAL_PRICING_INVALID/);
    assert.deepEqual(config, before);
  });
}
test('omitted V3 pricing preserves existing terminal and global values, never cached authority', () => {
  const config = base(); const before = structuredClone(config);
  const result = applyTerminalConfigSnapshot(config, { terminalId, preserveOmittedOperationalScopes: true,
    incomingSnapshot: { resolved: { identity: { id: terminalId } } } as any,
    cachedSnapshot: { resolved: { pricing: { default_tariff_id: duarte, allowed_tariff_ids: ids } } } as any });
  assert.deepEqual(result.config.terminals[0].config.pricing, before.terminals[0].config.pricing);
  assert.deepEqual(result.config.tariffs, before.tariffs);
});
test('V3 omitted pricing on a new terminal does not borrow another terminal defaults', () => {
  const result = applyTerminalConfigSnapshot(base(), { terminalId: 'NEW', preserveOmittedOperationalScopes: true,
    incomingSnapshot: { resolved: { identity: { id: 'NEW' } } } as any });
  assert.equal(result.config.terminals.find(row => row.id === 'NEW')?.config.pricing, undefined);
});
test('V2 config.pricing inference remains unchanged', () => {
  assert.equal(apply({ config: { pricing: { defaultTariffId: duarte, allowedTariffIds: ids } } }, false)
    .config.terminals[0].config.pricing.defaultTariffId, 'VILLA');
});
test('both TerminalSelector bootstrap callers explicitly opt into V3 partial scope rules', () => {
  const source = readFileSync(new URL('../components/TerminalSelector.tsx', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/const applied = applyTerminalConfigSnapshot\([\s\S]*?\n          \);/g)];
  assert.equal(calls.length, 2);
  calls.forEach(call => assert.match(call[0], /preserveOmittedOperationalScopes: candidateV3/));
});

const context = { terminalId, warehouseId: 'W', defaultTariffId: duarte, allowedTariffIds: ids };
test('same-terminal corrected default reconciles an empty cart, never a live cart', () => {
  const previous = { ...context, defaultTariffId: 'VILLA', allowedTariffIds: ['VILLA', ...ids], tariffId: 'VILLA' };
  assert.equal(reconcileV3TariffSelection(previous, context, false).tariffId, duarte);
  assert.throws(() => reconcileV3TariffSelection(previous, context, true), /SYNC_V3_CART_CONTEXT_CHANGED/);
  assert.equal(previous.tariffId, 'VILLA');
});
test('manual permitted selection survives an unchanged default and unrelated config updates', () => {
  const previous = { ...context, tariffId: mayorista };
  assert.equal(reconcileV3TariffSelection(previous, { ...context }, false).tariffId, mayorista);
  assert.equal(reconcileV3TariffSelection(previous, { ...context, allowedTariffIds: [...ids].reverse() }, true).tariffId, mayorista);
});
test('revoked selected tariff resets only an empty cart; terminal/warehouse changes block live cart', () => {
  const previous = { ...context, tariffId: mayorista };
  assert.equal(reconcileV3TariffSelection(previous, { ...context, allowedTariffIds: [duarte] }, false).tariffId, duarte);
  for (const change of [{ ...context, allowedTariffIds: [duarte] }, { ...context, terminalId: 'OTHER' }, { ...context, warehouseId: 'W2' }]) {
    assert.throws(() => reconcileV3TariffSelection(previous, change, true), /SYNC_V3_CART_CONTEXT_CHANGED/);
  }
});
test('stale asynchronous catalog completions cannot activate a new pricing context', async () => {
  const old = v3TariffContextKey({ ...context, defaultTariffId: 'VILLA' });
  let latest = old; let sequence = 1; let activated = false;
  const completion = Promise.resolve().then(() => { if (isV3TariffContextCurrent(old, latest, 1, sequence)) activated = true; });
  latest = v3TariffContextKey(context); sequence++;
  await completion;
  assert.equal(activated, false);
  assert.equal(isV3TariffContextCurrent(latest, latest, 2, sequence), true);
});
test('error recovery uses existing settings callback and authority guards remain wired', () => {
  const source = readFileSync(new URL('../components/LargeMasterSyncV3OperationalPOS.tsx', import.meta.url), 'utf8');
  assert.match(source, /props\.onOpenSettings\(\)/);
  assert.doesNotMatch(source, /props\.onOpenSettings\(['"]/);
  assert.match(source, /reconcileV3TariffSelection\(selection, authority, props\.cart\.length > 0\)/);
  assert.match(source, /isV3TariffContextCurrent\(wantedContextKey, latestContextKey\.current/);
  assert.match(source, /latestContextKey\.current !== wantedContextKey/);
  assert.doesNotMatch(source, /props\.onUpdateCart|localStorage\.setItem/);
});

test('actual component reconciles corrected pricing, retains manual tariff and fences a live cart', async () => {
  // Deterministic host hook harness. This executes the real component, not a
  // WebView or native smoke test; only React scheduling and session I/O are mocked.
  const slots: any[] = []; let cursor = 0; let dirty = false; let effects: Array<() => void> = [];
  const same = (a: unknown[], b: unknown[]) => a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value: any) => {
        const next = typeof value === 'function' ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef: (initial: any) => { const index = cursor++; return slots[index] ||= { current: initial }; },
    useMemo: (fn: () => any, deps: any[]) => {
      const index = cursor++;
      if (!slots[index] || !same(deps, slots[index].deps)) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useCallback: (fn: any, deps: any[]) => react.useMemo(() => fn, deps),
    useEffect: (fn: () => any, deps: any[]) => {
      const index = cursor++; const old = slots[index];
      if (!old || !same(deps, old.deps)) {
        slots[index] = { deps };
        effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  };
  const requests: string[] = [];
  const fixture = { react, ready: {
    projectConfig: async (config: any) => ({ ...config, tariffs: ids.map(id => ({ id, taxIncluded: true })), taxes: [] }),
    catalog: async (id: string) => {
      requests.push(id);
      if (!ids.includes(id)) throw new Error('SYNC_V3_TARIFF_UNAVAILABLE');
      return { search: async () => [], get: async () => null };
    },
    assertCurrent: async () => {}, withStocks: async (rows: any) => rows,
  } };
  const globals = globalThis as any;
  globals.__v3TariffHarness = fixture;
  const originalWindow = globals.window;
  globals.window = { addEventListener: () => {}, removeEventListener: () => {} };
  try {
    const mocks: Record<string, string> = {
      react: `const R=globalThis.__v3TariffHarness.react;export default R;export const {useState,useRef,useMemo,useEffect,useCallback}=R;`,
      'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
      './POSInterface': 'export default function MockPOS(){}',
      '../services/sync/LargeMasterSyncV3OperationalSession': 'export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__v3TariffHarness.ready;',
    };
    const bundled = await build({ entryPoints: [new URL('../components/LargeMasterSyncV3OperationalPOS.tsx', import.meta.url).pathname],
      bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'transform',
      plugins: [{ name: 'tariff-hook-unit-fixture', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
      } }] });
    const component = (await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)).default;
    const settingsCalls: unknown[][] = [];
    let props: any = { activeTerminalId: terminalId, config: base(), cart: [],
      onOpenSettings: (...args: unknown[]) => settingsCalls.push(args) };
    props.config.terminals[0].config.inventoryScope = { defaultSalesWarehouseId: 'W' };
    let node: any;
    const render = () => { cursor = 0; dirty = false; effects = []; node = component(props); effects.forEach(fn => fn()); };
    const settle = async () => { for (let n = 0; n < 12; n++) { await Promise.resolve(); if (dirty) render(); } };
    render(); await settle();
    assert.equal(node.props.role, 'alert');
    const recoveryButton = node.props.children.find((child: any) => child.type === 'button');
    recoveryButton.props.onClick();
    assert.deepEqual(settingsCalls, [[]], 'recovery opens HOME without deep-linking past permission-locked cards');
    assert.ok(requests.includes('VILLA'));
    props = { ...props, config: structuredClone(props.config) };
    props.config.terminals[0].config.pricing = { defaultTariffId: duarte, allowedTariffIds: ids };
    render(); await settle();
    assert.equal(node.props.v3Operational.tariffId, duarte);
    node.props.v3Operational.changeTariff(mayorista);
    render(); await settle();
    assert.equal(node.props.v3Operational.tariffId, mayorista);
    props = { ...props, config: { ...props.config, name: 'Unrelated update' } };
    render(); await settle();
    assert.equal(node.props.v3Operational.tariffId, mayorista);
    const pinned = node.props.v3Operational;
    const cart = [{ id: 'P', price: 10, quantity: 1 }];
    props = { ...props, cart, config: structuredClone(props.config) };
    props.config.terminals[0].config.pricing.allowedTariffIds = [duarte];
    render();
    assert.equal(node.props.role, 'alert', 'new authority blocks synchronously, before effects settle');
    assert.strictEqual(props.cart, cart);
    assert.equal(cart[0].price, 10);
    await assert.rejects(pinned.search('P', null), /SYNC_V3_UI_CONTEXT_CHANGED/);
    const pending = new Map<string, (value: any) => void>();
    fixture.ready.catalog = (id: string) => new Promise(resolve => pending.set(id, resolve));
    props = { ...props, cart: [] };
    render(); await settle();
    assert.ok(pending.has(duarte));
    props = { ...props, config: structuredClone(props.config) };
    props.config.terminals[0].config.pricing = { defaultTariffId: mayorista, allowedTariffIds: ids };
    render(); await settle();
    assert.ok(pending.has(mayorista));
    pending.get(duarte)!({ search: async () => [], get: async () => null });
    await settle();
    assert.equal(node.props.role, 'status', 'old catalog completion cannot activate or repaint');
    pending.get(mayorista)!({ search: async () => [], get: async () => null });
    await settle();
    assert.equal(node.props.v3Operational.tariffId, mayorista);
  } finally { globals.window = originalWindow; delete globals.__v3TariffHarness; }
});
