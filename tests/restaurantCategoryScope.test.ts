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
  const body=`${lookup}\n${scope}\nconst salesCatalogProductEntries=products.map(product=>({product, normalizedCategory:canonicalizeCategory(product.category), displayCategory:displayCategory(product.category), isSellable:product.is_sellable!==false,hasActiveTariff:product.hasActiveTariff!==false,searchText:String(product.name||'').trim().toLowerCase()}));const sortedSalesCatalogProductEntries=salesCatalogProductEntries;${filter}\n${options}\nreturn {allowed:[...effectiveAllowedCategorySet], products:filteredProducts, options:categoryOptions};`;
  const js=(await transform(`function renderConsumers(){${body}}`,{loader:'ts',target:'es2022'})).code;
  return (input:any)=>{
    let selected=input.categoryFilter||'ALL';
    const dependencies={ config:{families:[],posCategories:[],...input.config},activeTerminalConfig:{catalog:{allowedCategories:input.allowed}},catalogProducts:input.products,
      products:input.products,v3Operational:input.v3,categoryFilter:selected,catalogSearchQuery:input.search||'',isRetailMode:false,
      useMemo:(fn:any)=>fn(),useCallback:(fn:any)=>fn,useEffect:(fn:any)=>fn(),setCategoryFilter:(next:string)=>{selected=next;},
      resolveClassificationColor,resolveClassificationSortOrder,resolveClassificationActive,normalizeSearchToken:(v:any)=>String(v||'').trim().toLowerCase(),
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
