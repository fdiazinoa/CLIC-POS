import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { db } from '../utils/db';
import { completeLargeMasterSyncV3Setup } from '../services/sync/LargeMasterSyncV3SetupCompletion';
import { persistProductionAreaSnapshot } from '../services/restaurant/ProductionAreaSnapshot';
import { prepareKioskProduction } from '../services/restaurant/KioskProductionPreflight';
import { buildProductionDispatchItems, createProductionDispatchIntent, createProductionPrintIntent,
  dispatchProductionOrder, dispatchProductionPrint } from '../services/restaurant/ProductionOrderDispatcher';
import type { BusinessConfig, CartItem } from '../types';

const area = { id:'COCINA',name:'Cocina',modo_salida:'AMBOS',printer_id:'printer',kds_host:'10.0.0.2',kds_port:8001 };
const line = { id:'food',cartId:'exact-line',name:'Plato',price:100,quantity:1,production_area_id:'COCINA',product_type:'SIMPLE' } as CartItem;
const config = { terminals:[{id:'T',config:{hardware:{printerAssignments:{KITCHEN:'printer'}}}}],
  availablePrinters:[{id:'printer',type:'KITCHEN',connection:'NETWORK',address:'10.0.0.3',status:'DISCONNECTED'}] } as unknown as BusinessConfig;
const snapshot = (rows: unknown[]) => ({ resolved:{catalog:{production_areas:rows}} });

async function fixture(run: (state: { rows: Map<string,any>;events:string[];writes:string[];corrupt:()=>void }) => Promise<void>) {
  const original = { get:db.get,save:db.save,window:Object.getOwnPropertyDescriptor(globalThis,'window') };
  const rows = new Map<string,any>([['productionAreas',[]]]),events:string[]=[],writes:string[]=[];
  let corrupt=false;
  (db as any).get=async(collection:string)=>{
    assert.ok(['productionAreas','productionPrintQueue','kdsDispatchQueue'].includes(collection),'no legacy collection read');
    return corrupt&&collection==='productionAreas' ? [] : structuredClone(rows.get(collection)||[]);
  };
  (db as any).save=async(collection:string,value:unknown)=>{writes.push(collection);rows.set(collection,structuredClone(value));};
  Object.defineProperty(globalThis,'window',{configurable:true,value:{dispatchEvent:(event:Event)=>{events.push(event.type);}}});
  try { await run({rows,events,writes,corrupt:()=>{corrupt=true;}}); }
  finally { (db as any).get=original.get;(db as any).save=original.save;
    if(original.window)Object.defineProperty(globalThis,'window',original.window);else delete (globalThis as any).window; }
}

test('fresh V3 setup persists scoped production master before success; actual print/KDS intents retain route/cartId',async()=>{
 await fixture(async f=>{
  let current=true,configSaved=false;
  await completeLargeMasterSyncV3Setup(config,async()=>({assertCurrent:async()=>{assert.ok(current);},projectConfig:async c=>c}),
    async()=>{configSaved=true;},{productionAreas:[area]});
  assert.equal(configSaved,true);assert.deepEqual(f.events,['productionAreasUpdated']);
  const [target]=prepareKioskProduction([line],f.rows.get('productionAreas'),config,'T');
  assert.equal(target.printerId,'printer');assert.equal(target.kdsBaseUrl,'http://10.0.0.2:8001');
  const print = createProductionPrintIntent({orderId:'TX',areaId:target.areaId,areaName:target.area.name,cartIds:[line.cartId],items:[line],printerId:target.printerId});
  const printed=await dispatchProductionPrint(print,async intent=>{
    assert.equal((f.rows.get('productionPrintQueue')||[]).length,1,'durable before output');
    assert.equal(intent.printerId,'printer');assert.equal(intent.items[0].cartId,'exact-line');return true;
  });
  assert.equal(printed.status,'PRINTED');
  const payload={orderId:'TX',date:'2026-10-19',terminalId:'T',userName:'Kiosk',customerName:'Fixture',
    area:{id:target.areaId,name:target.area.name},items:buildProductionDispatchItems([line],target.areaId),total:100};
  const intent=createProductionDispatchIntent({kdsBaseUrl:target.kdsBaseUrl!,cartIds:[line.cartId],payload});
  const queue=new Map<string,any>();const requests:string[]=[];let offline=true;
  const dependencies={save:async(value:any)=>{queue.set(value.id,value);},remove:async(id:string)=>{queue.delete(id);},
    request:async(value:any,request:any)=>{assert.equal(queue.has(value.id),true);requests.push(request.method);
      if(offline)throw Error('OFFLINE');assert.equal(value.payload.items[0].id,'exact-line');assert.equal(value.payload.items[0].production_area_id,'COCINA');
      return {correlationId:'mock',response:new Response('{}',{status:200}),completeAfterDurableCommit:async()=>{}};}};
  const pending=await dispatchProductionOrder(intent,undefined,dependencies);assert.equal(pending.status,'PENDING');assert.equal(queue.size,1);
  offline=false;const sent=await dispatchProductionOrder(pending.intent,undefined,dependencies);
  assert.equal(sent.status,'SENT');assert.equal(queue.size,0);assert.deepEqual(requests,['POST','POST','PUT']);
  assert.equal(sent.intent.id,intent.id);current=false;
 });
});

test('metadata snapshot preserves omitted device targets, honors explicit clears/deletions, and reads back before event',async()=>{
 await fixture(async f=>{
  await persistProductionAreaSnapshot(snapshot([area]));const count=f.writes.length;
  await persistProductionAreaSnapshot({resolved:{catalog:{}}});assert.equal(f.writes.length,count);
  await persistProductionAreaSnapshot(snapshot([{id:'COCINA',name:'Renamed'}]));
  assert.equal(f.rows.get('productionAreas')[0].modo_salida,'AMBOS');assert.equal(f.rows.get('productionAreas')[0].printer_id,'printer');
  await persistProductionAreaSnapshot(snapshot([{id:'COCINA',name:'Renamed',printer_id:null}]));
  assert.equal(f.rows.get('productionAreas')[0].printer_id,null);
  assert.throws(()=>prepareKioskProduction([line],f.rows.get('productionAreas'),config,'T'),/impresora/);
  await persistProductionAreaSnapshot(snapshot([]));assert.deepEqual(f.rows.get('productionAreas'),[]);
  const before=f.events.length;
  f.corrupt();await assert.rejects(persistProductionAreaSnapshot(snapshot([area])),/READBACK_FAILED/);
  assert.equal(f.events.length,before);
 });
});

test('identity drift and malformed snapshots reject before persistence',async()=>{
 await fixture(async f=>{
  await assert.rejects(persistProductionAreaSnapshot(snapshot([area]),async()=>{throw Error('BINDING_CHANGED');}),/BINDING_CHANGED/);
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.events,[]);
  await assert.rejects(persistProductionAreaSnapshot({resolved:{catalog:{production_areas:null}}}),/SNAPSHOT_INVALID/);
  await assert.rejects(persistProductionAreaSnapshot(snapshot([{id:'',name:'Invalid'}])),/SNAPSHOT_INVALID/);
  assert.deepEqual(f.writes,[]);
 });
});

test('unavailable routes/modes/targets fail before payment, including PRINTER and AMBOS without a configured device',()=>{
 for(const rows of [[],[{...area,is_active:false}],[{...area,id:'OTHER'}],[{...area,modo_salida:undefined}],
   [{...area,modo_salida:'PRINTER',printer_id:'missing'}],[{...area,modo_salida:'AMBOS',printer_id:'missing'}],
   [{...area,kds_host:null}]] ) assert.throws(()=>prepareKioskProduction([line],rows,config,'T'));
 assert.throws(()=>prepareKioskProduction([{...line,production_area_id:undefined}], [area],config,'T'),/centro de producción/);
 const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const payment=app.slice(app.indexOf('const kioskProductionPlan ='));
 assert.ok(payment.indexOf('prepareKioskProduction(cart,')<payment.indexOf('const subtotal ='));
 assert.ok(payment.indexOf('prepareKioskProduction(cart,')<payment.indexOf('await handleTransactionComplete(txn,'));
 assert.match(payment,/printerId: target.printerId/);assert.match(payment,/kdsBaseUrl: target.kdsBaseUrl/);
});
