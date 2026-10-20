import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { resolveRestaurantProductConfig } from '../utils/restaurantProductConfig';
import { prepareKioskProduction } from '../services/restaurant/KioskProductionPreflight';
import { buildProductionDispatchItems, createProductionDispatchIntent, createProductionPrintIntent } from '../services/restaurant/ProductionOrderDispatcher';
import { V3KioskPaymentAttempt } from '../services/sync/LargeMasterSyncV3KioskCatalog';
import type { Transaction } from '../types';

const source=ts.createSourceFile('App.tsx',readFileSync(new URL('../App.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let callback: ts.Expression;
function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='completeKioskPayment')callback=node.initializer!;ts.forEachChild(node,visit);}visit(source);
assert.ok(callback!);
function fixture(overrides:Record<string,unknown>={}){
  const production: any[] = [];
  const effects={create:0,commit:0,provider:0,wallet:0,save:0,validate:0};
  const attempt=new V3KioskPaymentAttempt();
  const config={currencies:[],currencySymbol:'$',paymentMethods:[{id:'cash',type:'CASH'}],integrations:[]};
  const cart=[{id:'A',cartId:'line',quantity:1,price:118,v3SaleAuthority:{tariffId:'T'}}];
  const terminal={id:'local',config:{documentAssignments:{TICKET:'SERIES'}}};
  const bindings={resolveRestaurantProductConfig,prepareKioskProduction,buildProductionDispatchItems,createProductionDispatchIntent,createProductionPrintIntent,
    dispatchProductionOrder:async(intent:unknown)=>{production.push(intent);},
    dispatchProductionPrint:async(intent:unknown)=>{production.push(intent);},refreshAmbiguousProductionPrints:()=>{},
    kioskV3Enabled:true,kioskRedeemedCoupon:null,kioskCouponDiscountAmount:0,cart,
    kioskV3:{payment:attempt,catalog:{async assertCurrent(){},async validate(){effects.validate++;}}},
    console:{log(){},error(){}},kioskTerminal:terminal,getCurrentTerminal:()=>terminal,currentUser:{id:'fixture',name:'Synthetic'},users:[],kioskPaymentRestaurantMode:false,kioskServiceType:null,
    db:{async assertFiscalTransactionAuthority(){},async save(){effects.save++;},async saveDocument(){effects.save++;},async get(){return overrides.productionAreas || [];}},
    kioskTotals:{subtotal:100,tax:18,total:118,taxIncluded:true,taxBreakdown:[],discountAmount:0},selectedCustomer:null,kioskPaymentConfig:config,internalSequences:[],mergeDocumentSeriesCollection:()=>[],resolveDocumentAssignmentId:()=> 'SERIES',
    transactionService:{async createTransaction(data:Partial<Transaction>, options:unknown){effects.create++;assert.deepEqual(options,overrides.kioskV3Enabled===false?undefined:{deferDurablePersistence:true});return {...data,id:'stable-draft'} as Transaction;},async updateWalletBalance(){effects.wallet++;}},
    freezeAuthoritativeLineFiscalAmounts:(lines:unknown)=>lines,
    handleTransactionComplete:async(tx:Transaction,onCommitted?:(value:Transaction)=>void)=>{effects.commit++;onCommitted?.({...tx,displayId:'COMMITTED-001'});},roundMoney:(value:number)=>value,kioskOrderNumber:null,
    azulMcmService:{async sale(){effects.provider++;throw Error('forbidden provider');}},ingenicoAzulWebApiService:{async sale(){effects.provider++;throw Error('forbidden provider');}},
    ...overrides};
  const js=ts.transpileModule(`const callback = ${callback!.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const fn=new Function(...Object.keys(bindings),js+';return callback;')(...Object.values(bindings)) as (method:{id:string;type:string;label:string})=>Promise<Transaction>;
  return {effects,attempt,fn,bindings,production};
}

test('actual App callback denies card/wallet/coupon before any provider, number reservation or write',async()=>{
  for(const mode of ['CARD','WALLET','coupon']){
    const f=fixture(mode==='coupon'?{kioskRedeemedCoupon:{id:'C',code:'X'}}:{});
    await assert.rejects(f.fn({id:'cash',type:mode==='coupon'?'CASH':mode,label:mode}),/detenidos antes del cobro/);
    assert.deepEqual(f.effects,{create:0,commit:0,provider:0,wallet:0,save:0,validate:0});
  }
});

test('actual App cash callback validates current cart, defers persistence, returns committed identity and shares repeat presses',async()=>{
  const f=fixture();const method={id:'cash',type:'CASH',label:'Cash'};
  const run=()=>f.attempt.run('order',()=>f.fn(method));
  const [a,b]=await Promise.all([run(),run()]);assert.equal(a,b);assert.equal(a.displayId,'COMMITTED-001');assert.equal(f.effects.create,1);assert.equal(f.effects.commit,1);assert.ok(f.effects.validate>=2);assert.equal(f.effects.provider,0);assert.equal(f.effects.save,0);
});

test('actual App callback expired authority and missing production route stop before effects; original cart remains intact',async()=>{
  const f=fixture({kioskV3:{payment:new V3KioskPaymentAttempt(),catalog:{async assertCurrent(){throw Error('expired session');}}}});
  const original=JSON.stringify(f.bindings.cart);await assert.rejects(f.fn({id:'cash',type:'CASH',label:'Cash'}),/expired session/);assert.equal(f.effects.create,0);assert.equal(JSON.stringify(f.bindings.cart),original);
  const route=fixture({kioskPaymentRestaurantMode:true,kioskServiceType:'DINE_IN'});await assert.rejects(route.fn({id:'cash',type:'CASH',label:'Cash'}),/centro de producción/);assert.equal(route.effects.create,0);assert.equal(route.effects.provider,0);
});


test('actual App callback rejects a forged/stale cash method ID before integrated provider effects',async()=>{
 const f=fixture({kioskPaymentConfig:{currencies:[],paymentMethods:[{id:'card',type:'CARD',integrationMode:'INTEGRATED'}],integrations:[]}});
 await assert.rejects(f.fn({id:'card',type:'CASH',label:'Cash'}),/no coincide/);
 assert.equal(f.effects.provider,0);assert.equal(f.effects.create,0);assert.equal(f.effects.save,0);
});

test('actual App V3 restaurant callback rejects unknown area, missing mode/printer/KDS before transaction/provider effects',async()=>{
 for(const area of [{id:'OTHER',modo_salida:'KDS',kds_host:'10.0.0.2'},
  {id:'COCINA',kds_host:'10.0.0.2'}, {id:'COCINA',modo_salida:'PRINTER',printer_id:'missing'},
  {id:'COCINA',modo_salida:'AMBOS',printer_id:'missing',kds_host:'10.0.0.2'},
  {id:'COCINA',modo_salida:'KDS'}]){
  const f=fixture({kioskPaymentRestaurantMode:true,kioskServiceType:'DINE_IN',productionAreas:[area],
    cart:[{id:'A',cartId:'line',name:'Plato',quantity:1,price:118,production_area_id:'COCINA'}]});
  const before=JSON.stringify(f.bindings.cart);
  await assert.rejects(f.fn({id:'cash',type:'CASH',label:'Cash'}),/producción|impresora|KDS/);
  assert.deepEqual({...f.effects,validate:0},{create:0,commit:0,provider:0,wallet:0,save:0,validate:0});
  assert.deepEqual(f.production,[]);assert.equal(JSON.stringify(f.bindings.cart),before);
 }
});

test('actual App legacy restaurant callback preserves omitted-mode KDS dispatch with its configured host',async()=>{
 const f=fixture({kioskV3Enabled:false,kioskPaymentRestaurantMode:true,kioskServiceType:'TAKEOUT',
   productionAreas:[{id:'COCINA',name:'Cocina',kds_host:'10.0.0.2'}],
   cart:[{id:'A',cartId:'line',name:'Plato',quantity:1,price:118,production_area_id:'COCINA'}]});
 await f.fn({id:'cash',type:'CASH',label:'Cash'});
 assert.equal(f.effects.create,1);assert.equal(f.effects.commit,1);assert.equal(f.effects.provider,0);
 assert.equal(f.production.length,1);assert.equal(f.production[0].kdsBaseUrl,'http://10.0.0.2:8001');
 assert.equal(f.production[0].payload.area.id,'COCINA');assert.equal(f.production[0].payload.items[0].id,'line');
});
