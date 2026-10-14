import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import ts from 'typescript';
import SalesOperatorIdentity from '../components/SalesOperatorIdentity';

const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
test('both Sales headings display photo/name/caja with bounded text and no generated placeholders', () => {
  for (const compact of [true, false]) {
    const html = renderToStaticMarkup(<SalesOperatorIdentity user={{id:'u',name:'Yuli Pérez',photo:'https://example.com/photo.jpg'}} terminalLabel="Caja 6" compact={compact} />);
    assert.match(html, /Foto de Yuli Pérez/); assert.match(html, /Yuli Pérez/); assert.match(html, /Caja 6/);
    assert.match(html, /truncate/); assert.match(html, /shrink-0/);
    for (const photo of ['', 'https://api.dicebear.com/a.svg']) {
      const fallback = renderToStaticMarkup(<SalesOperatorIdentity user={{id:'u',name:'Yuli Pérez',photo}} terminalLabel="Caja 6" compact={compact} />);
      assert.doesNotMatch(fallback, /<img/); assert.match(fallback, />YP</);
    }
  }
  assert.equal((source.match(/\{renderTicketBrand\(/g) || []).length, 2);
  assert.match(source, /<SalesOperatorIdentity user=\{currentUser\} terminalLabel=\{operatorTerminalLabel\}/);
});

test('actual heading terminal resolver never displays the first foreign caja and updates on terminal changes', () => {
  const actual = source.slice(source.indexOf('   const operatorTerminal ='), source.indexOf('   const renderTicketBrand ='));
  const config = { terminals: [{id:'foreign',config:{terminalName:'Other Company'}},{id:'current',config:{terminalName:'Caja 6'}}] };
  const resolve = (activeTerminalId:string) => runInNewContext(actual + '\noperatorTerminalLabel;', {config,activeTerminalId});
  assert.equal(resolve('current'),'Caja 6'); assert.equal(resolve('missing'),'Caja no disponible');
  config.terminals[1].config.terminalName='Caja 7'; assert.equal(resolve('current'),'Caja 7');
});

test('actual photo fallback is isolated by user/photo key, recovering after error and identity changes', async () => {
  const states = new Map<string, boolean>(); let activeKey = '';
  const react = { createElement(type:any, props:any, ...children:any[]) {return {type,key:props?.key,props:{...props,children}};},
    useState(initial:boolean) { const key=activeKey;return [states.get(key) ?? initial,(next:boolean)=>states.set(key,next)]; } };
  (globalThis as any).__operatorReact=react;
  try {
    const bundle = await build({entryPoints:['components/SalesOperatorIdentity.tsx'],bundle:true,platform:'node',format:'cjs',write:false,jsx:'transform',
      plugins:[{name:'operator-react',setup(b){
        b.onResolve({filter:/^react(?:\/jsx-runtime)?$/},()=>({path:'react',namespace:'mock'}));
        b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'const r=globalThis.__operatorReact; export default r; export const useState=r.useState; export const jsx=(t,p,k)=>r.createElement(t,{...p,key:k},...[].concat(p.children||[])); export const jsxs=jsx;',loader:'js'}));
      }}]});
    const mod={exports:{} as any}; new Function('module','exports',bundle.outputFiles[0].text)(mod,mod.exports);
    const render = (id:string,photo:string,name='Yuli Pérez') => {
      const tree=mod.exports.default({user:{id,photo,name},terminalLabel:'Caja 6'});
      const identityPhoto=tree.props.children[0].props.children[0];
      activeKey=identityPhoto.key; return {node:identityPhoto.type(identityPhoto.props),key:activeKey};
    };
    const first=render('u','photo-a'); assert.equal(first.node.type,'img'); first.node.props.onError();
    assert.equal(render('u','photo-a').node.type,'span');
    const other=render('v','photo-a'); assert.notEqual(other.key,first.key); assert.equal(other.node.type,'img');
    const updated=render('u','photo-b'); assert.notEqual(updated.key,first.key); assert.equal(updated.node.type,'img');
    first.node.props.onError(); assert.equal(render('u','photo-b').node.type,'img');
  } finally {delete (globalThis as any).__operatorReact;}
});


test('actual Sales heading removes only its logo and keeps enlarged operator identity in both sizes', () => {
  const heading = source.slice(source.indexOf('   const renderTicketBrand ='), source.indexOf('   const cartQuantity', source.indexOf('   const renderTicketBrand =')));
  const createHeading = ts.transpileModule(heading + '\nrenderTicketBrand;', {compilerOptions: {jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022}}).outputText;
  const user = {id:'u',name:'Yuli Pérez',photo:'https://example.com/photo.jpg'};
  const render = runInNewContext(createHeading, {React, SalesOperatorIdentity, currentUser:user, operatorTerminalLabel:'Caja 6'});
  for (const compact of [false,true]) {
    const html = renderToStaticMarkup(render(compact));
    assert.doesNotMatch(html, />CLIC<|>POS<|tracking-\[0\.22em\]/);
    assert.match(html, /Yuli Pérez/); assert.match(html, /Caja 6/); assert.match(html, /Foto de Yuli Pérez/);
    assert.match(html, compact ? /h-10 w-10/ : /h-12 w-12/);
    assert.match(html, compact ? /text-\[13px\]/ : /text-sm/);
    assert.match(html, /min-w-0/); assert.match(html, /flex-wrap/);
  }
});
