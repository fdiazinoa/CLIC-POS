import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {build} from 'esbuild';
import {requiresProductStockAvailability} from '../utils/productStockPolicy';

/** Execute the actual POS callback body with isolated state dependencies; this is not a browser/device rendering test. */
const uiSource=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
const begin=uiSource.indexOf('const canAddItemToCart = useCallback(')+'const canAddItemToCart = useCallback('.length;
const end=uiSource.indexOf('}, [',begin)+1;
assert.ok(begin>40&&end>begin);
const compiled=ts.transpileModule(`const guard=(${uiSource.slice(begin,end)});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function uiGuard(overrides:Record<string,any>={}){
 let reads=0;const env={requiresProductStockAvailability,setErrorToast:()=>{},setTimeout:()=>{},productHasActiveTariff:()=>true,resolveProductActiveWarehouseIds:()=>['W'],warehouses:[{id:'W'}],productMatchesTerminalWarehouse:()=>true,getTerminalWarehouseName:()=> 'W',resolveInventoryConsumptionMode:()=> 'DIRECT',calculateInventoryDeductions:()=>[],productById:new Map(),products:[],committedByProduct:{},cartInventoryDemandByProduct:{},cartQuantityByProduct:{},getScopedProductStock:(p:any)=>{reads++;return p.stock;},config:{features:{stockTracking:true}},activeTerminalConfig:{workflow:{inventory:{allowNegativeStock:false}}},...overrides};
 return {run:new Function('env',`with(env){${compiled};return guard;}`)(env) as (p:any,q?:number)=>boolean,reads:()=>reads};
}
for(const track of [false,true])for(const negative of [false,true])for(const terminal of [false,true])for(const global of [false,true])test(`actual POS guard product track${track}/negative${negative}, terminal${terminal}, global${global}`,()=>{
 const product={id:'P',name:'Synthetic',stock:0,operationalFlags:{trackInventory:track,allowNegativeStock:negative}};
 const guard=uiGuard({config:{features:{stockTracking:global}},activeTerminalConfig:{workflow:{inventory:{allowNegativeStock:terminal}}}});
 assert.equal(guard.run(product,1),!track||negative);assert.equal(guard.reads(),track&&!negative?1:0);
});
test('actual POS guard negative/positive overage, missing flags and unavailable quantities',()=>{
 for(const stock of [-1,0,0.5,undefined])for(const track of [false,true,undefined,null])for(const negative of [false,true,undefined,null]){
  const product={id:'P',name:'Synthetic',stock,operationalFlags:{trackInventory:track,allowNegativeStock:negative}};
  assert.equal(uiGuard().run(product,1),track!==true||negative===true);assert.equal(requiresProductStockAvailability(product),track===true&&negative!==true);
 }
});
test('actual POS kit guard checks each component policy and preserves missing component structural rejection',()=>{
 for(const track of [false,true])for(const negative of [false,true]){
  const component={id:'C',name:'Component',stock:0,operationalFlags:{trackInventory:track,allowNegativeStock:negative}};
  const guard=uiGuard({resolveInventoryConsumptionMode:()=> 'COMPONENTS',calculateInventoryDeductions:()=>[{productId:'C',quantityToDeduct:1}],productById:new Map([['C',component]])});
  assert.equal(guard.run({id:'KIT',name:'Kit',operationalFlags:{trackInventory:false}},1),!track||negative);
 }
 const missing=uiGuard({resolveInventoryConsumptionMode:()=> 'COMPONENTS',calculateInventoryDeductions:()=>[{productId:'missing',quantityToDeduct:1}]});
 assert.equal(missing.run({id:'KIT',name:'Kit',operationalFlags:{trackInventory:false}},1),false);
});
test('V3 quantity projection and transaction demands use authoritative product flags and preserve admission',async()=>{
 const bundle=await build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3OperationalSession.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':'{}'},plugins:[{name:'stock-policy-isolated-io',setup(builder){builder.onResolve({filter:/^(\.\.\/db|\.\.\/\.\.\/utils\/db)$/},args=>({path:args.path,namespace:'stock-policy-fixture'}));builder.onLoad({filter:/.*/,namespace:'stock-policy-fixture'},args=>({contents:args.path==='../db'?'export const dbAdapter={};':'export const db={};',loader:'js'}));}}]});
 const {LargeMasterSyncV3OperationalSession:Session}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
 const stamp={binding:'B',syncId:'S',syncVersion:1,tariffId:'T',taxIncluded:false,inventoryVersion:1,inventoryCursor:'C',warehouseId:'W'};
 for(const track of [false,true])for(const negative of [false,true]){
  let calls=0;const session=Object.create(Session.prototype);session.binding='B';session.store={getLocalInventoryDelta:async()=>{calls++;throw Error('quantity-unavailable');},getLocalInventoryDeltas:async()=>{calls++;throw Error('quantity-unavailable');}};
  const source={id:'P',type:'PRODUCT',isInventoriable:true,stock:undefined,operationalFlags:{trackInventory:track,allowNegativeStock:negative},v3SaleAuthority:stamp};
  session.catalog=async()=>({get:async()=>({product:source})});
  const line={...source,quantity:2,operationalFlags:{trackInventory:false,allowNegativeStock:true}};
  const demands=await session.stockRequirements({terminals:[]},[line],'W','SALE');assert.equal(demands.length,track&&!negative?1:0);
  if(track&&!negative){await assert.rejects(session.withStock(source,'W'),/INVENTORY_NOT_READY/);await assert.rejects(session.withStocks([source],'W'),/INVENTORY_NOT_READY/);}
  else {assert.equal((await session.withStock(source,'W')).id,'P');assert.equal((await session.withStocks([source],'W'))[0].id,'P');}
  assert.equal(calls,0);
  await assert.rejects(session.withStock({...source,v3SaleAuthority:undefined},'W'),/CART_LEGACY_LINE/);
 }
});
