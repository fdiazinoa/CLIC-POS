import { buildPosCategoryIdentity, reconcileBoundV3PosCategories } from '../utils/posCategoryIdentity';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { resolveClassificationColor, resolveClassificationSortOrder, resolveClassificationActive } from '../utils/posCatalogPresentation';

/** Execute current POS memo consumers directly; only diagnostics/React scheduling are fixture dependencies. */
async function actualConsumers() {
  const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
  const between=(a:string,b:string)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
  const lookup=between('const normalizeScopeKey =','const warehouseAliasMap =');
  const scope=between('const effectiveAllowedCategorySet =','const isRetailMode =');
  const filter=between('const filteredProducts =','// Keep the complete result set searchable.');
  const options=between('const categoryOptions =','// --- PROMOTION ENGINE INTEGRATION ---');
  const body=`${lookup}\n${scope}\nconst salesCatalogProductEntries=products.map(product=>({product, normalizedCategory:categoryLookup.identity.productCategory(product), displayCategory:displayCategory(product.category), isSellable:product.is_sellable!==false,hasActiveTariff:product.hasActiveTariff!==false,searchText:String(product.name||'').trim().toLowerCase()}));const sortedSalesCatalogProductEntries=salesCatalogProductEntries;${filter}\n${options}\nreturn {allowed:[...effectiveAllowedCategorySet], products:filteredProducts, options:categoryOptions};`;
  const js=(await transform(`function renderConsumers(){${body}}`,{loader:'ts',target:'es2022'})).code;
  return (input:any)=>{
    let selected=input.categoryFilter||'ALL';
    const dependencies={ config:{families:[],posCategories:[],...input.config},activeTerminalConfig:{catalog:{allowedCategories:input.allowed}},catalogProducts:input.products,
      products:input.products,v3Operational:input.v3,categoryFilter:selected,catalogSearchQuery:input.search||'',isRetailMode:input.isRetailMode||false,
      useMemo:(fn:any)=>fn(),useCallback:(fn:any)=>fn,useEffect:(fn:any)=>fn(),setCategoryFilter:(next:string)=>{selected=next;},
      buildPosCategoryIdentity,reconcileBoundV3PosCategories,resolveClassificationColor,resolveClassificationSortOrder,resolveClassificationActive,normalizeSearchToken:(v:any)=>String(v||'').trim().toLowerCase(),
      freezeCount(){},tableLatencyQaMark(){},searchFilterTraceRef:{current:null},markInteractionStage(){},
    };
    const result=new Function(...Object.keys(dependencies),`${js};return renderConsumers();`)(...Object.values(dependencies));return {...result,selected};
  };
}
const drink={id:'drink',name:'Bebida',category:'Bebidas',price:10,taxIds:['T']};
const dessert={id:'dessert',name:'Postre',category:'Postres',price:20};
const food={id:'food',name:'Alimento',category:'Alimentos',price:30};

test('entering Ventas with partial/empty catalog never opens configured Alimentos across hydration and reconnect frames',async()=>{
  const render=await actualConsumers();
  const allowed=['Alimentos'];
  const frames=[[drink,dessert],[],[drink,food,dessert],[dessert],[food],[]];
  for(const products of frames){
    const before=JSON.stringify({allowed,products});const output=render({allowed,products});
    assert.deepEqual(output.allowed,['alimentos']);
    assert.deepEqual(output.options.map((c:any)=>c.id),['ALL','alimentos']);
    assert.deepEqual(output.products.map((p:any)=>p.id),products.some(p=>p.id==='food')?['food']:[]);
    assert.equal(JSON.stringify({allowed,products}),before);
  }
  const other=render({allowed:['Bebidas'],products:[drink,food]});assert.deepEqual(other.products.map((p:any)=>p.id),['drink']);
  assert.deepEqual(render({allowed,products:[drink,food]}).products.map((p:any)=>p.id),['food']);
});

test('late family UUID/code/name hydration resolves aliases without temporarily granting other families',async()=>{
  const render=await actualConsumers();
  const allowed=['erp-food-id'];const products=[drink,food,dessert];
  const early=render({allowed,products});assert.deepEqual(early.allowed,['erp-food-id']);assert.deepEqual(early.products,[]);
  assert.deepEqual(early.options.map((c:any)=>c.id),['ALL','erp-food-id']);
  const config={families:[{id:'erp-food-id',code:'FOOD',name:'Alimentos'}]};
  const hydrated=render({allowed,products,config});assert.deepEqual(hydrated.allowed,['alimentos']);assert.deepEqual(hydrated.products.map((p:any)=>p.id),['food']);
  const codeProduct={...food,category:'FOOD'};assert.deepEqual(render({allowed,products:[drink,codeProduct],config}).products.map((p:any)=>p.id),['food']);
  const lost=render({allowed,products,config:{families:[]}});assert.deepEqual(lost.products,[]);assert.deepEqual(lost.allowed,['erp-food-id']);
});

test('ALL, stale selected category and text search remain scoped while V3 categories obey identical configuration',async()=>{
  const render=await actualConsumers();const products=[drink,food,dessert];
  for(const v3 of [undefined,{categories:[{key:'bebidas',label:'Bebidas'},{key:'alimentos',label:'Alimentos'},{key:'postres',label:'Postres'}]}]){
    const output=render({allowed:['Alimentos'],products,v3,categoryFilter:'ALL'});
    assert.deepEqual(output.products.map((p:any)=>p.id),['food']);assert.deepEqual(output.options.map((c:any)=>c.id),['ALL','alimentos']);
    assert.deepEqual(render({allowed:['Alimentos'],products,v3,search:'Bebida'}).products,[]);
    const stale=render({allowed:['Alimentos'],products,v3,categoryFilter:'Bebidas'});assert.deepEqual(stale.products,[]);assert.equal(stale.selected,'ALL');
    assert.deepEqual(render({allowed:['Alimentos'],products:[],v3:{categories:[]}}).allowed,['alimentos']);
  }
});

test('explicit unrestricted configuration preserves compatibility and inactive presentation stays excluded',async()=>{
  const render=await actualConsumers();const products=[drink,food,dessert];
  const unrestricted=render({allowed:[],products});assert.deepEqual(unrestricted.allowed,[]);assert.deepEqual(unrestricted.products,products);
  const unknown=render({allowed:['unknown-category'],products});assert.deepEqual(unknown.products,[]);assert.deepEqual(unknown.options.map((c:any)=>c.id),['ALL','unknown-category']);
  const inactive=render({allowed:['Alimentos'],products,config:{posCategories:[{id:'food-category',name:'Alimentos',isActive:false}]}});
  assert.deepEqual(inactive.products,[]);assert.deepEqual(inactive.options.map((c:any)=>c.id),['ALL']);
});

test('actual V3 snapshot refresh projection feeds restricted consumers across omitted/full/unrestricted frames', async () => {
  const { getInitialConfig } = await import('../constants');
  const { applyTerminalConfigSnapshot } = await import('../utils/terminalConfigSnapshot');
  const render = await actualConsumers();
  let config = getInitialConfig('Restaurante' as any);
  config.terminals = [{ id: 'local', config: structuredClone(config.terminals[0].config) }];
  const proof = { terminalId: 'terminal', tenantId: 'tenant', companyId: 'company', deviceId: 'device' };
  config.terminals[0].config.erpBinding = proof as any;
  config.terminals[0].config.catalog.allowedCategories = ['Alimentos'];
  const v3 = { categories: [{ key: 'bebidas', label: 'Bebidas' }, { key: 'alimentos', label: 'Alimentos' }] };
  for (const incoming of [{ resolved: {} }, { resolved: { catalog: { allowed_categories: ['Alimentos'] } } }, { resolved: {} }]) {
    config = applyTerminalConfigSnapshot(config, { terminalId: 'local', incomingSnapshot: { ...incoming, terminal_id: proof.terminalId, tenant_id: proof.tenantId, device_id: proof.deviceId } as any,
      preserveOmittedOperationalScopes: true, catalogBindingProof: proof }).config;
    const output = render({ allowed: config.terminals[0].config.catalog.allowedCategories, products: [drink, food], v3 });
    assert.deepEqual(output.products.map((product: any) => product.id), ['food']);
    assert.deepEqual(output.options.map((category: any) => category.id), ['ALL', 'alimentos']);
  }
  config = applyTerminalConfigSnapshot(config, { terminalId: 'local', incomingSnapshot: { resolved: { catalog: { allowed_categories: [] } } } as any,
    preserveOmittedOperationalScopes: true, catalogBindingProof: proof }).config;
  assert.deepEqual(render({ allowed: config.terminals[0].config.catalog.allowedCategories, products: [drink, food], v3 }).products.map((product: any) => product.id), ['drink', 'food']);
});

test('actual POS predicates deny ambiguous grants and foreign matching labels while unrestricted remains visible',async()=>{
 const render=await actualConsumers();
 const config={posCategories:[{id:'a',name:'Same',code:'X'},{id:'b',name:'Same',code:'X'}]};
 const foreign={id:'foreign',name:'Foreign',posCategoryId:'foreign-category',category:'Same'};
 const legacy={id:'legacy',name:'Legacy',category:'Same'};
 const spoof={id:'spoof',name:'Spoof',category:'ambiguous:same'};
 for(const categoryFilter of ['ALL','Same']){
  const denied=render({allowed:['Same'],products:[foreign,legacy,spoof],config,categoryFilter});
  assert.deepEqual(denied.products,[]);
  assert.equal(denied.allowed.length,1);
 }
 assert.deepEqual(render({allowed:['a'],products:[foreign],config,search:'Foreign'}).products,[]);
 assert.deepEqual(render({allowed:[],products:[foreign],config:{posCategories:[]}}).products.map((p:any)=>p.id),['foreign']);
 const renamed={id:'2135',name:'Palette',posCategoryId:'a',category:'Old'};
 assert.deepEqual(render({allowed:['a'],products:[renamed],config,categoryFilter:'a'}).products.map((p:any)=>p.id),['2135']);
});

test('unrestricted V3 category buttons with missing configured metadata select stable-ID products',async()=>{
 const render=await actualConsumers();
 const product={id:'2135',name:'Palette',category:'Todos',posCategoryId:'bound-erp-category'};
 const output=render({allowed:[],products:[product],config:{posCategories:[]},
  v3:{categories:[{key:'bound-erp-category',label:'Todos1'}]},categoryFilter:'bound-erp-category'});
 assert.deepEqual(output.products.map((p:any)=>p.id),['2135']);
 assert.deepEqual(output.options.map((c:any)=>[c.id,c.label]),[['ALL','Todas'],['bound-erp-category','Todos1']]);
 assert.equal(output.selected,'bound-erp-category');
});

test('actual Sales consumers reconcile bound Bebidas UUID in Restaurante and Supermercado after hydration/reopen', async () => {
 const render=await actualConsumers();
 const id='58b57216-a283-42d0-8da7-de60560a5d0b';
 const config={posCategories:[{id:'Bebidas',name:'Bebidas',color:'#123456',isActive:true}]};
 const prices:Record<string,number>={'182':275,'183':150,'184':140,'395':260,'396':210,'397':110,'BEB-003':85};
 const products=Object.entries(prices).map(([sku,price])=>({id:sku,sku,name:'Agua',category:'Bebidas',posCategoryId:id,price,taxIds:['ITBIS18','SERVICE10'],stock:-3}));
 const before=JSON.stringify({config,products});
 for(const isRetailMode of [false,true]) {
  const input={allowed:['Bebidas'],products,config,isRetailMode,search:'Agua'};
  assert.deepEqual(render({...input,v3:{categories:[]}}).products,[]);
  for(const categoryFilter of ['ALL',id,'Bebidas']) {
   for(const v3 of [{categories:[{key:id,label:'Bebidas'}]},JSON.parse(JSON.stringify({categories:[{key:id,label:'Bebidas'}]}))]) {
    const output=render({...input,v3,categoryFilter});
    assert.deepEqual(output.allowed,[id]);
    assert.deepEqual(output.products,products);
    assert.deepEqual(output.options.map((c:any)=>[c.id,c.label,c.color]),[['ALL','Todas',undefined],[id,'Bebidas','#123456']]);
   }
  }
  const foreign=render({...input,v3:{categories:[{key:'other-company',label:'Bebidas'}]}});
  assert.deepEqual(foreign.products,[]);
  assert.deepEqual(render({...input,v3:{categories:[{key:id,label:'Bebidas'},{key:'ambiguous',label:'Bebidas'}]}}).products,[]);
 }
 assert.equal(JSON.stringify({config,products}),before);
});
