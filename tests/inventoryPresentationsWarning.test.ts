import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {describePresentationError} from '../utils/presentationErrorMessages';

const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('POSInterface.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const warnings:ts.Expression[]=[],effects:ts.Expression[]=[];
function visit(node:ts.Node){
 if(ts.isJsxExpression(node)&&node.expression?.getText(ast).includes('Presentaciones no disponibles.'))warnings.push(node.expression);
 if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('runtime.client.prepare()'))effects.push(node.arguments[0]);
 ts.forEachChild(node,visit);
}
visit(ast);assert.equal(warnings.length,1);assert.equal(effects.length,1);
const warningJS=ts.transpileModule('const warning=()=> <>{'+warnings[0].getText(ast)+'}</>;',{fileName:'warning.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const effectJS=ts.transpileModule('const mount='+effects[0].getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const ordinary={id:'plain',name:'Artículo normal',quantity:1,price:10};
const formatted={id:'pack',name:'Agua',quantity:1,price:250,inventoryPresentation:{schemaVersion:1,itemId:'pack',variantId:null,format:{schemaVersion:1,id:'pack12',name:'Paquete',abbreviation:'PK',factor:12,barcode:''},commercialQuantity:1,baseQuantity:12,tariffId:'tariff',masterRevision:'a'.repeat(64)}};
const selector={id:'pack',name:'Agua',inventoryPresentationMaster:{itemId:'pack',formats:[formatted.inventoryPresentation.format]}};
function markup(cart:unknown[],presentationError:string|null,presentationSelection:unknown=null,retry:()=>void=()=>{}){
 const Warning=new Function('React','cart','presentationError','presentationSelection','setPresentationRetry','describePresentationError',warningJS+';return warning;')(React,cart,presentationError,presentationSelection,retry,describePresentationError);
 return renderToStaticMarkup(React.createElement(Warning));
}
for(const error of ['INVENTORY_PRESENTATION_AUTH_REQUIRED','network offline','INVENTORY_PRESENTATION_HTTP_403','INVENTORY_PRESENTATIONS_DISABLED']){
 test(`ordinary and empty tickets stay transparent after background ${error}`,()=>{assert.equal(markup([ordinary],error),'');assert.equal(markup([],error),'');});
 test(`selected presentation retains actionable ${error} warning`,()=>{const html=markup([ordinary,formatted],error);assert.match(html,/role="status"/);assert.match(html,/Presentaciones no disponibles/);assert.match(html,/Reintentar/);assert.match(html,new RegExp(error));});
}
test('a malformed retained descriptor still exposes the failure instead of masquerading as an ordinary item',()=>{assert.match(markup([{...ordinary,inventoryPresentation:null}],'INVENTORY_PRESENTATION_AUTH_REQUIRED'),/Presentaciones no disponibles/);});
test('an active presentation selector exposes failure even before adding a formatted line',()=>{assert.match(markup([ordinary],'INVENTORY_PRESENTATION_AUTH_REQUIRED',selector),/Reintentar/);});
test('closing selector and removing last formatted line remove warning while diagnostics remain',()=>{
 const error='network offline';assert.match(markup([formatted],error),/Presentaciones/);assert.equal(markup([ordinary],error),'');assert.equal(markup([],error),'');
 assert.match(markup([],error,selector),/Presentaciones/);assert.equal(markup([],error,null),'');
});
test('no preparation error leaves both ordinary and presentation contexts free of warnings',()=>{for(const cart of [[],[ordinary],[formatted]])assert.equal(markup(cart,null,selector),'');});
test('actual terminal-reset effect clears stale selector and warning, preserves the ordinary ticket and cancels old runtime',()=>{
 const cart=[ordinary],before=JSON.stringify(cart);let selection:any=selector,error:string|null='INVENTORY_PRESENTATION_AUTH_REQUIRED',masters:any={old:{}},cancelled=0;
 const runtimeRef:{current:unknown}={current:{old:true}};
 const oldRuntime={client:{cancel(){cancelled++;},prepare:()=>new Promise(()=>{})}};
 const bindings={v3Operational:{},activeTerminalId:'NEW-TERMINAL',presentationConfigRef:{current:{terminals:[{id:'NEW-TERMINAL'}]}},presentationAuthority:()=>({}),presentationRuntimeRef:runtimeRef,setPresentationMasters:(value:unknown)=>{masters=value;},setPresentationSelection:(value:unknown)=>{selection=value;},setPresentationError:(value:string|null)=>{error=value;},setPresentationReadyGeneration:()=>{},createPresentationRuntime:()=>oldRuntime};
 assert.match(markup(cart,error,selection),/Presentaciones/);
 const cleanup=new Function(...Object.keys(bindings),effectJS+';return mount();')(...Object.values(bindings));
 assert.equal(selection,null);assert.equal(error,null);assert.equal(runtimeRef.current,null);assert.deepEqual(masters,{});assert.equal(markup(cart,error,selection),'');assert.equal(JSON.stringify(cart),before);cleanup();assert.equal(cancelled,1);
});

test('catalog master alone never turns an ordinary cart line into presentation activity',()=>{assert.equal(markup([{...ordinary,inventoryPresentationMaster:selector.inventoryPresentationMaster}],'network offline'),'');});
test('base-unit presentations and restored formatted tickets retain their warning and frozen descriptor',()=>{
 const unit=JSON.parse(JSON.stringify(formatted));unit.inventoryPresentation.format.factor=1;unit.inventoryPresentation.baseQuantity=1;
 const restored=JSON.parse(JSON.stringify(formatted));for(const line of [unit,restored]){const before=JSON.stringify(line);assert.match(markup([line],'INVENTORY_PRESENTATION_AUTH_REQUIRED'),/Presentaciones no disponibles/);assert.equal(JSON.stringify(line),before);}
});
test('retry button executes its original functional state updater in presentation context',()=>{
 let retries=3;
 const tree=new Function('React','cart','presentationError','presentationSelection','setPresentationRetry','describePresentationError',warningJS+';return warning();')(React,[formatted],'network offline',null,(update:(value:number)=>number)=>{retries=update(retries);},describePresentationError);
 const banner=tree.props.children,button=banner.props.children.find((node:any)=>React.isValidElement(node)&&node.type==='button');assert.ok(button);button.props.onClick();assert.equal(retries,4);
});
