import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
// Isolated matching React runtime, no application dependency or lockfile changes.
const runtime=process.env.CLIC_ROUTING_REACT_TEST_RUNTIME;
if(runtime && !runtime.startsWith('/tmp/'))throw Error('Isolated React test runtime required');
test('mounted React production panel applies exact visible IDs, clear only matching center, capability denial and stale response/unmount',async t=>{
 if(!runtime || !existsSync(runtime+'/node_modules/react-test-renderer')){t.skip('CLIC_ROUTING_REACT_TEST_RUNTIME with matching React/test-renderer required');return;}
 const require=createRequire(runtime+'/package.json');const React=require('react'),Renderer=require('react-test-renderer');
 const {act}=React;Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const target=new EventTarget();const previousWindow=(globalThis as any).window;(globalThis as any).window=target;
 let supported=true,hold=false,resolveLate:(page:any)=>void;let requested:any[]=[];const sent:any[]=[];
 const page={total:161,filteredTotal:161,nextCursor:'P2',categories:[{id:'C',label:'Bebidas',count:161}],assignedCounts:{A:1},
 rows:[{id:'P0',name:'Agua',sku:'BEB-005',categoryId:'C',productionAreaId:'A',productType:'SIMPLE',unsupported:false},
 {id:'P1',name:'Jugo',sku:'BEB-006',categoryId:'C',productionAreaId:'B',productType:'SIMPLE',unsupported:false}]};
 let listener:()=>void;
 const fixtures={React,read:{open:async()=>({assertCurrent:async()=>{},page:async(r:any)=>{requested.push(r);if(hold){hold=false;return new Promise(resolve=>{resolveLate=resolve;});}return structuredClone(page);}})},
 enqueue:async(_reader:any,rows:any[],after:any,actor:any)=>{sent.push({ids:rows.map(r=>r.id),after,actor});},states:async()=>({}),capability:async()=>supported,
 subscribe:(cb:()=>void)=>{listener=cb;return()=>{listener=undefined!;};}};
 Object.assign(globalThis,{__productionPanelFixture:fixtures});
 const built=await build({entryPoints:['components/ProductionCatalogV3Panel.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'mounted-fixture',setup(builder){
 builder.onResolve({filter:/^(react|.*ProductionCatalogV3|.*ApiSyncAdapter|.*LargeMasterSyncV3CatalogUpdates)$/},args=>({path:args.path,namespace:'fixture'}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='react'?'module.exports=globalThis.__productionPanelFixture.React;module.exports.default=module.exports;':path.endsWith('ProductionCatalogV3')?'exports.ProductionCatalogV3=globalThis.__productionPanelFixture.read;exports.enqueueProductionRouting=globalThis.__productionPanelFixture.enqueue;exports.productionRoutingStates=globalThis.__productionPanelFixture.states;':path.endsWith('ApiSyncAdapter')?'exports.apiSyncAdapter={productionRoutingCapability:globalThis.__productionPanelFixture.capability};':'exports.subscribeLargeMasterSyncV3CatalogUpdates=globalThis.__productionPanelFixture.subscribe;'}));
 }}]});
 const loaded={exports:{} as any};new Function('module','exports',built.outputFiles[0].text)(loaded,loaded.exports);const Panel=loaded.exports.default;
 let renderer:any;const settle=async()=>{await act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});};
 const button=(text:string)=>renderer.root.findAllByType('button').find((b:any)=>b.children.join('')===text);
 try{
 await act(async()=>{renderer=Renderer.create(React.createElement(Panel,{areas:[{id:'A',nombre:'Prueba'},{id:'B',nombre:'Otra'}],actorId:'operator'}));});await settle();
 assert.equal(button('Aplicar visibles').props.disabled,false);
 await act(async()=>{await button('Aplicar visibles').props.onClick();});await settle();assert.deepEqual(sent[0],{ids:['P0','P1'],after:'A',actor:'operator'});
 await act(async()=>{await button('Quitar visibles de este centro').props.onClick();});await settle();assert.deepEqual(sent[1],{ids:['P0'],after:null,actor:'operator'});
 await act(async()=>{button('Siguiente').props.onClick();});await settle();assert.equal(requested.at(-1).afterId,'P2');
 hold=true;await act(async()=>{renderer.root.findByProps({'aria-label':'Buscar artículos de producción'}).props.onChange({target:{value:'old'}});});await settle();
 await act(async()=>{renderer.root.findByProps({'aria-label':'Buscar artículos de producción'}).props.onChange({target:{value:'new'}});});await settle();assert.equal(requested.at(-1).afterId,null);
 await act(async()=>{resolveLate({...page,total:999});});await settle();assert.ok(!JSON.stringify(renderer.toJSON()).includes('999'));
 supported=false;await act(async()=>{button('Actualizar catálogo local').props.onClick();});await settle();assert.equal(button('Aplicar visibles').props.disabled,true);
 const before=sent.length;await act(async()=>{await button('Aplicar visibles').props.onClick();});await settle();assert.equal(sent.length,before);
 hold=true;await act(async()=>{listener();});await settle();await act(async()=>{renderer.unmount();resolveLate(page);});assert.equal(listener,undefined);
 }finally{if(renderer)await act(async()=>renderer.unmount());(globalThis as any).window=previousWindow;delete(globalThis as any).__productionPanelFixture;delete(globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
});

test('mounted legacy manager patches displayed rows only and preserves unrelated fresh products and center assignments',async t=>{
 if(!runtime){t.skip('isolated matching React renderer required');return;}
 const require=createRequire(runtime+'/package.json');const React=require('react'),Renderer=require('react-test-renderer'),{act}=React;
 let products:any[]=[{id:'one',name:'Visible agua',category:'Bebidas',production_area_id:'OTHER',restaurant:{production_area_id:'OTHER',keep:'keep'}},
  {id:'two',name:'Oculto jugo',category:'Bebidas',production_area_id:'OTHER',restaurant:{production_area_id:'OTHER'},unrelated:'preserve'}];
 const writes:any[]=[];const config={terminals:[],availablePrinters:[],operational:{usa_modulos_cocina:true}};
 const fixture={React,db:{get:async(name:string)=>name==='products'?structuredClone(products):name==='productionAreas'?[{id:'A',nombre:'Prueba',modo_salida:'PRINTER'}]:config,
 save:async()=>{throw Error('whole collection write forbidden');},saveDocuments:async(name:string,rows:any[])=>{assert.equal(name,'products');writes.push(structuredClone(rows));const patch=new Map(rows.map(row=>[row.id,row]));products=products.map(row=>patch.get(row.id)||row);}}};
 Object.assign(globalThis,{__legacyProductionFixture:fixture,IS_REACT_ACT_ENVIRONMENT:true});const old=(globalThis as any).window;(globalThis as any).window=new EventTarget();
 const built=await build({entryPoints:['components/ProductionAreaManager.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'legacy-mounted-fixture',setup(builder){
 builder.onResolve({filter:/^(react|lucide-react|.*ProductionCatalogV3Panel|.*LargeMasterSyncV3Authority|.*SyncProfile|.*utils\/db|.*kdsRouting)$/},args=>({path:args.path,namespace:'fixture'}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='react'?'module.exports=globalThis.__legacyProductionFixture.React;module.exports.default=module.exports;':path==='lucide-react'?'exports.Plus=exports.Trash2=exports.Save=exports.Printer=exports.Monitor=exports.Layers=exports.Server=exports.AlertCircle=exports.RefreshCw=exports.CheckCircle2=exports.XCircle=exports.Search=exports.PackageCheck=exports.PackageX=()=>null;':path.endsWith('utils/db')?'exports.db=globalThis.__legacyProductionFixture.db;':path.endsWith('LargeMasterSyncV3Authority')?'exports.usesLargeMasterSyncV3Authority=()=>false;':path.endsWith('SyncProfile')?'exports.loadSyncProfile=()=>({cloudChannel:"LOCAL"});':path.endsWith('kdsRouting')?'exports.getKdsTerminalTargets=()=>[];exports.resolveKdsBaseUrl=()=>"";':'exports.default=()=>null;'}));
 }}]});const loaded={exports:{} as any};new Function('module','exports',built.outputFiles[0].text)(loaded,loaded.exports);let renderer:any;
 const settle=async()=>{await act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});};
 try{
 await act(async()=>{renderer=Renderer.create(React.createElement(loaded.exports.default,{terminals:[],config,onUpdateConfig:()=>{throw Error('config write forbidden');}}));});await settle();
 await act(async()=>{renderer.root.findAllByType('input').find((row:any)=>row.props.placeholder==='Buscar artículo, categoría o código...').props.onChange({target:{value:'Visible'}});});await settle();
 products.push({id:'arrived-later',name:'Nueva',unrelated:'fresh'});
 await act(async()=>{await renderer.root.findAllByType('button').find((row:any)=>row.children.includes('Aplicar visibles')).props.onClick();});await settle();
 assert.equal(writes.length,1);assert.deepEqual(writes[0].map((row:any)=>row.id),['one']);assert.equal(products.find(row=>row.id==='one').production_area_id,'A');assert.equal(products.find(row=>row.id==='one').restaurant.keep,'keep');
 assert.equal(products.find(row=>row.id==='two').production_area_id,'OTHER');assert.equal(products.find(row=>row.id==='two').unrelated,'preserve');assert.equal(products.find(row=>row.id==='arrived-later').unrelated,'fresh');
 }finally{if(renderer)await act(async()=>renderer.unmount());(globalThis as any).window=old;delete(globalThis as any).__legacyProductionFixture;delete(globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
});
