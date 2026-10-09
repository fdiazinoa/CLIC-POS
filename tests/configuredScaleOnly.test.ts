import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { displayWeightQuantity, displayWeightPrice, weightLineLabel, createWeightPresentation, resolveScaleWeightContract } from '../utils/scaleWeight';

test('actual sale modal uses configured default only, no selector, stale or ambiguous defaults cannot confirm', async () => {
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
    const text = (node: any): string => typeof node === 'string' || typeof node === 'number' ? String(node)
      : !node ? '' : (Array.isArray(node) ? node : node.props?.children || []).map(text).join('');
    for (const scenario of [
      { defaultScaleId: 'kg', scales: [{ id: 'kg', name: 'Configurada KG', displayUnit: 'kg', driver: 'MANUAL' }], allowed: true, unit: 'kg' },
      { defaultScaleId: 'lb', scales: [{ id: 'kg', name: 'Otra KG', displayUnit: 'kg', driver: 'MANUAL' }, { id: 'lb', name: 'Configurada LB', displayUnit: 'lb', driver: 'MANUAL' }], allowed: true, unit: 'lb' },
      { defaultScaleId: 'deleted', scales: [{ id: 'kg', name: 'KG', displayUnit: 'kg', driver: 'MANUAL' }], allowed: false },
      { defaultScaleId: undefined, scales: [{ id: 'kg', name: 'KG', displayUnit: 'kg', driver: 'MANUAL' }, { id: 'lb', name: 'LB', displayUnit: 'lb', driver: 'MANUAL' }], allowed: false },
    ]) {
      values = []; let confirmed: any[] | undefined;
      const props = { product: { id: 'P', name: 'BAL', measurementUnit: 'kg', price: 1 }, currencySymbol: '$',
        ...scenario, onClose() {}, onConfirm: (...args: any[]) => { confirmed = args; } };
      const render = () => { cursor = 0; return component(props); };
      let tree = render(); assert.equal(find(tree, n => n.type === 'select'), undefined);
      assert.equal(find(tree, n => n.type === 'input'), undefined);
      find(tree, n => n.type === 'button' && text(n) === 'C').props.onClick();
      tree = render(); find(tree, n => n.type === 'button' && text(n) === '1').props.onClick();
      tree = render(); const confirm = find(tree, n => n.type === 'button' && text(n).includes('Confirmar'));
      assert.equal(confirm.props.disabled, !scenario.allowed); confirm.props.onClick();
      assert.equal(Boolean(confirmed), scenario.allowed);
      if (scenario.allowed) {
        assert.equal(confirmed![1].scaleId, scenario.defaultScaleId); assert.equal(confirmed![1].displayUnit, scenario.unit);
        assert.equal(confirmed![0], scenario.unit === 'lb' ? .45359237 : 1);
      } else {
        assert.match(text(tree), /Configure la balanza predeterminada/);
        assert.equal(find(tree,n=>n.type==='button'&&text(n).includes('Re-Leer')).props.disabled,true);
      }
    }
  } finally { delete (globalThis as any).__legacyScaleReact; }
});
