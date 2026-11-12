import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import {buildEscPosTicketPayload} from '../services/printer/EscPosFormatter';
import {resolveLineDiscountPresentation} from '../utils/lineDiscountPresentation';
import {resolveHistoryDiscountTotal} from '../utils/transactionHistoryPresentation';
import {normalizeTransactionForSync} from '../services/sync/sourceIdentity';

test('real editor distinguishes authorized lower/higher prices from explicit discounts through sync and history', async () => {
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
    for (const [mode, input, expectedPrice, expectedSource, expectedDiscount] of [
      ['PRICE','10',10,'MANUAL_PRICE_OVERRIDE',0],
      ['PRICE','400',400,'MANUAL_PRICE_OVERRIDE',0],
      ['DISCOUNT','10',315,'MANUAL_DISCOUNT',35],
    ] as const) {
      values=[];
      const item={id:'P',cartId:'L',name:'EYE LINER',price:350,originalPrice:350,quantity:1};
      let saved:any;
      const props={item,config:{currencySymbol:'RD$'},users:[],roles:[],onClose(){},onUpdate(value:any){saved=value;},canApplyDiscount:true,canOverridePrice:true,canEditQuantity:true,canVoidItem:true};
      const render=()=>{cursor=0;return component(props);};
      let tree=render();
      const field=find(tree,n=>n.type==='input'&&n.props?.value===(mode==='PRICE'?'350':''));
      assert.ok(field);field.props.onChange({target:{value:input}});
      tree=render();find(tree,n=>n.props?.onClick?.name==='handleSave').props.onClick();
      assert.equal(saved.price,expectedPrice);assert.equal(saved.originalPrice,350);
      assert.equal(saved.adjustmentSource,expectedSource);
      assert.equal(saved.discountAmount||0,expectedDiscount);
      assert.equal(resolveLineDiscountPresentation(saved).discountAmount,expectedDiscount);
      assert.equal(resolveHistoryDiscountTotal({items:[saved],discountAmount:0}),expectedDiscount);
      const tx:any={id:'T',date:'2026-11-12T21:01:34Z',terminalId:'terminal',items:[saved],total:expectedPrice,payments:[]};
      const printConfig:any={companyInfo:{name:'Absolute'},currencySymbol:'RD$',taxes:[],currencies:[],receiptConfig:{showQr:false,showSavings:true}};
      const payload=Buffer.from(buildEscPosTicketPayload(tx,printConfig,[])!,'base64').toString('latin1');
      if(mode==='PRICE')assert.doesNotMatch(payload,/DESCUENTO TOTAL|USTED AHORRO/);
      const normalized=normalizeTransactionForSync(tx);
      assert.equal(normalized.items[0].discountAmount||0,expectedDiscount);
      assert.equal(normalized.items[0].originalPrice,350);
      // Reopening and saving an annotation must preserve the distinction.
      values=[];props.item=saved;tree=render();
      find(tree,n=>n.props?.onClick?.name==='handleSave').props.onClick();
      assert.equal(saved.adjustmentSource,expectedSource);
      assert.equal(saved.discountAmount||0,expectedDiscount);
    }
  } finally { delete (globalThis as any).__scaleReact; }
});
