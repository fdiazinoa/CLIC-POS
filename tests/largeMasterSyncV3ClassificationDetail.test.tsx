import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';

// Production component with only React's hook dispatcher supplied, using the existing no-browser renderer pattern.
async function component(){
 const state={selected:null as string|null};(globalThis as any).__classificationHooks={React,useState:()=>[state.selected,(value:string)=>{state.selected=value;}],useMemo:(fn:()=>unknown)=>fn()};
 const bundle=await build({entryPoints:[new URL('../components/LargeMasterSyncV3CatalogManager.tsx',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},define:{'import.meta.env':'{}'},plugins:[{name:'render-classification-hooks',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},()=>({loader:'js',contents:'const h=globalThis.__classificationHooks;export default h.React;export const useState=h.useState,useMemo=h.useMemo,useRef=()=>{},useEffect=()=>{},useSyncExternalStore=()=>{};'}));
 }}]});return {state,...await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))};
}
function nodes(node:any):any[]{if(!node||typeof node!=='object')return [];return [node,...React.Children.toArray(node.props?.children).flatMap(nodes)];}
const row={id:'ERP-ARTICLE',name:'Agua Dasani',sku:'SKU-123',barcode:'BAR-123',categoryId:'ERP-CAT',departmentId:'D',sectionId:'S',familyId:'F',brandId:'B',posCategoryId:'pos-c',active:true,sellable:true,type:'PRODUCT',price:20,stock:10,balance:8};
const config={departments:[{id:'D',name:'Bebidas',code:'DEP-CODE'}],sections:[{id:'S',name:'Aguas'}],families:[{id:'F',name:'Embotelladas'}],brands:[{id:'B',name:'Dasani'}],posCategories:[{id:' POS-C ',name:'Frías'}]};

test('selecting/focusing an actual search result shows five current master names without any selected filter',async()=>{
 try{const ui=await component(),state={status:'ready',page:{rows:[row,{...row,id:'SECOND-ID',sku:'SECOND-SKU',brandId:'unknown'}],total:2,filteredTotal:2,nextCursor:null}};
  const render=(cfg=config)=>ui.V3CatalogPageView({state,config:cfg});let tree=render();assert.match(renderToStaticMarkup(tree),/Selecciona un artículo/);assert.doesNotMatch(renderToStaticMarkup(tree),/Clasificación ·/);
  const select=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Agua Dasani');assert.equal(select.props['aria-expanded'],false);select.props.onClick();tree=render();let html=renderToStaticMarkup(tree);
  for(const label of ['Departamento','Sección','Familia','Marca','Categoría POS','Bebidas','Aguas','Embotelladas','Dasani','Frías'])assert.ok(html.includes(label),label);
  assert.match(html,/Referencia: SKU-123/);assert.doesNotMatch(html,/DEP-CODE/);assert.equal(row.brandId,'B');assert.equal(state.page.filteredTotal,2);
  nodes(tree).filter(n=>n.type==='button')[1].props.onFocus();html=renderToStaticMarkup(render());assert.match(html,/Nombre no disponible/);assert.match(html,/ID: unknown/);
  ui.state.selected='ERP-ARTICLE';html=renderToStaticMarkup(render({...config,brands:[{id:'B',name:'Marca actualizada'}]}));assert.match(html,/Marca actualizada/);assert.doesNotMatch(html,/>Dasani</);
  const next={status:'ready',page:{...state.page,rows:[]}};assert.doesNotMatch(renderToStaticMarkup(ui.V3CatalogPageView({state:next,config})),/Clasificación ·/);
  assert.match(renderToStaticMarkup(ui.V3CatalogPageView({state:{status:'loading'},config})),/role="status"/);assert.match(renderToStaticMarkup(ui.V3CatalogPageView({state:{status:'error',error:'changed'},config})),/role="alert"/);
  assert.doesNotMatch(renderToStaticMarkup(ui.V3CatalogPageView({state:{status:'error',error:'changed'},config})),/Frías/);
 }finally{delete (globalThis as any).__classificationHooks;}
});

test('missing assignments and unresolved master IDs are explicit and never inferred from SKU/name/filter',async()=>{
 try{const ui=await component();ui.state.selected=row.id;const state={status:'ready',page:{rows:[{...row,departmentId:null,sectionId:'',familyId:'missing',brandId:null,posCategoryId:'unknown'}],total:1,filteredTotal:1,nextCursor:null}};
  const html=renderToStaticMarkup(ui.V3CatalogPageView({state,config}));assert.equal((html.match(/Sin asignar/g)||[]).length,3);assert.equal((html.match(/Nombre no disponible/g)||[]).length,2);assert.match(html,/Categoría ERP: ERP-CAT/);assert.doesNotMatch(html,/Frías|Bebidas|Embotelladas/);
 }finally{delete (globalThis as any).__classificationHooks;}
});
