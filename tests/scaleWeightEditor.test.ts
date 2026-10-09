import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createWeightPresentation, displayWeightPrice, canonicalWeightPrice } from '../utils/scaleWeight';

test('real editor no-op preserves canonical price/quantity and permitted display price edits convert once', async () => {
  let cursor = 0;
  let values: any[] = [];
  const react = {
    createElement: (type: unknown, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useMemo: (fn: () => any) => fn(),
    useState: (initial: any) => { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (next: any) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; },
  };
  (globalThis as any).__scaleReact = react;
  const result = await build({ entryPoints: ['components/CartItemOptionsModal.tsx'], bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'transform', jsxFactory: 'React.createElement',
    plugins: [{ name: 'editor-isolated-ui', setup(build) {
      build.onResolve({ filter: /^(react(?:\/jsx-runtime)?|lucide-react|@capacitor\/core|\.\/NumericKeypad)$/ }, args => ({ path: args.path, namespace: 'editor' }));
      build.onLoad({ filter: /.*/, namespace: 'editor' }, args => ({ loader: 'js', contents: args.path === 'react/jsx-runtime' ? 'export const jsx=(type,props)=>globalThis.__scaleReact.createElement(type,props,...[].concat(props.children||[]));export const jsxs=jsx;export const Fragment="fragment";' : args.path === 'react'
        ? 'const r=globalThis.__scaleReact; export default r; export const useState=r.useState,useMemo=r.useMemo;'
        : args.path === '@capacitor/core' ? 'export const Capacitor={getPlatform:()=>"web"};'
        : args.path === './NumericKeypad' ? 'export default ()=>null;'
        : 'export const X=()=>null,Trash2=X,Save=X,Minus=X,Plus=X,MessageSquare=X,Percent=X,DollarSign=X,Tag=X,User=X,Package=X,ChevronRight=X;' }));
    } }] });
  const module = { exports: {} as any }; new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  const component = module.exports.default;
  const find = (node: any, predicate: (node: any) => boolean): any => {
    if (!node || typeof node !== 'object') return undefined;
    if (predicate(node)) return node;
    for (const child of Array.isArray(node) ? node : node.props?.children || []) { const match = find(child, predicate); if (match) return match; }
  };
  try {
    for (const canonicalUnit of ['kg', 'lb'] as const) for (const displayUnit of ['kg', 'lb'] as const) for (const quantityDecimals of [0, 3, 6]) {
      values = [];
      const item = { id: 'P', cartId: 'L', name: 'BAL', price: 1.23456789, originalPrice: 1.23456789, quantity: 0.125,
        weightPresentation: createWeightPresentation('scale', displayUnit, canonicalUnit) };
      let saved: any;
      const props = { item, quantityDecimals, config: { currencySymbol: '$' }, users: [], roles: [], onClose() {}, onUpdate(value: any) { saved = value; },
        canApplyDiscount: true, canOverridePrice: true, canEditQuantity: true, canVoidItem: true };
      const render = () => { cursor = 0; return component(props); };
      let tree = render();
      find(tree, n => n.props?.onClick?.name === 'handleSave').props.onClick();
      assert.equal(saved.price, item.price);
      assert.equal(saved.quantity, item.quantity);
      assert.deepEqual(saved.weightPresentation, item.weightPresentation);
      const input = find(tree, n => n.type === 'input' && n.props?.value === String(displayWeightPrice(item)));
      assert.ok(input);
      input.props.onChange({ target: { value: '0.5' } });
      tree = render();
      find(tree, n => n.props?.onClick?.name === 'handleSave').props.onClick();
      assert.equal(saved.price, canonicalWeightPrice(item, 0.5));
      assert.equal(saved.quantity, item.quantity);
    }
  } finally { delete (globalThis as any).__scaleReact; }
});
