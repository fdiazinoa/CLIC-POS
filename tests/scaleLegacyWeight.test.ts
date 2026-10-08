import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { displayWeightQuantity, displayWeightPrice, weightLineLabel, createWeightPresentation, resolveScaleWeightContract } from '../utils/scaleWeight';

test('actual modal keeps legacy unknown/missing source units in historical kg without unsafe metadata', async () => {
  let cursor = 0; let values: any[] = [];
  const react = { createElement: (type: unknown, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useEffect() {}, useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: any) => { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (next: any) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; } };
  (globalThis as any).__legacyScaleReact = react;
  try {
    const bundled = await build({ entryPoints: ['components/ScaleModal.tsx'], bundle: true, platform: 'node', format: 'cjs', write: false,
      plugins: [{ name: 'isolated-scale-ui', setup(build) {
        const mocks: Record<string, string> = {
          react: 'const r=globalThis.__legacyScaleReact;export default r;export const useState=r.useState,useRef=r.useRef,useEffect=r.useEffect;',
          'react/jsx-runtime': 'export const jsx=(type,props)=>globalThis.__legacyScaleReact.createElement(type,props,...[].concat(props.children||[]));export const jsxs=jsx;export const Fragment="fragment";',
          'lucide-react': 'export const Scale=()=>null,Check=Scale,X=Scale,RefreshCw=Scale,Calculator=Scale;',
          '../services/ZebraScanner': 'export const isZebraEnabled=()=>false,readZebraWeight=async()=>{throw Error("must not read USB")},listenZebraConnection=()=>{},zebraSettingEvent="zebra";',
          '../services/ScalePreferences': 'export const scaleChangeEvents=["scale","zebra"];',
        };
        build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'legacy-scale' } : undefined);
        build.onLoad({ filter: /.*/, namespace: 'legacy-scale' }, args => ({ contents: mocks[args.path], loader: 'ts' }));
      } }] });
    const module = { exports: {} as any }; new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
    const component = module.exports.default;
    const find = (node: any, predicate: (node: any) => boolean): any => {
      if (!node || typeof node !== 'object') return undefined;
      if (predicate(node)) return node;
      for (const child of Array.isArray(node) ? node : node.props?.children || []) { const match = find(child, predicate); if (match) return match; }
    };
    for (const product of [{ type: 'SERVICE', name: 'Servicio', measurementUnit: 'Unidad' },
      { type: 'PRODUCT', name: 'Fruta (peso)', measurementUnit: 'gr' }, { type: 'SERVICE', name: 'Servicio sin unidad' },
      { type: 'PRODUCT', name: 'BAL', measurementUnit: 'kg' }, { type: 'PRODUCT', name: 'BAL', measurementUnit: 'Libra' }]) {
      values = []; let confirmed: any[] | undefined;
      const source = { ...product, id: 'P', price: 1 };
      const props = { product: source, currencySymbol: '$', defaultScaleId: 'manual',
        scales: [{ id: 'manual', name: 'Manual', displayUnit: 'lb', driver: 'MANUAL' }], onClose() {},
        onConfirm: (...args: any[]) => { confirmed = args; } };
      const render = () => { cursor = 0; return component(props); };
      let tree = render();
      const text = (node: any): string => typeof node === 'string' || typeof node === 'number' ? String(node)
        : !node ? '' : (Array.isArray(node) ? node : node.props?.children || []).map(text).join('');
      find(tree, n => n.type === 'button' && text(n) === 'C').props.onClick();
      tree = render(); find(tree, n => n.type === 'button' && text(n) === '1').props.onClick();
      tree = render(); const confirm = find(tree, n => n.type === 'button' && text(n).includes('Confirmar'));
      assert.equal(confirm.props.disabled, false); confirm.props.onClick(); assert.ok(confirmed);
      const line = { ...source, quantity: confirmed[0], weightPresentation: confirmed[1] };
      if (product.measurementUnit === 'kg' || product.measurementUnit === 'Libra') assert.ok(line.weightPresentation);
      else { assert.equal(line.quantity, 1); assert.equal(line.weightPresentation, undefined); }
      assert.equal(line.measurementUnit, source.measurementUnit); assert.equal(line.price, source.price);
      assert.doesNotThrow(() => displayWeightPrice(line)); assert.doesNotThrow(() => displayWeightQuantity(line));
      assert.doesNotThrow(() => weightLineLabel(line, '$'));
    }
  } finally { delete (globalThis as any).__legacyScaleReact; }
});

test('unknown V3 units stay blocked and corrupted new metadata never gets legacy fallback', () => {
  assert.equal(resolveScaleWeightContract({ measurementUnit: 'gr', v3SaleAuthority: {} }, 'lb').allowed, false);
  assert.equal(resolveScaleWeightContract({ measurementUnit: undefined, v3SaleAuthority: {} }, 'lb').allowed, false);
  const malformed = { quantity: 1, price: 1, measurementUnit: 'Unidad', weightPresentation: createWeightPresentation('S', 'kg', 'kg') };
  assert.throws(() => displayWeightQuantity(malformed), /inválido/);
  assert.throws(() => displayWeightPrice(malformed), /inválido/);
});
