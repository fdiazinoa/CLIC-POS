import test from 'node:test';
import assert from 'node:assert/strict';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeFixture,id} from './articleFormatsNativeFixture';
import {buildInventoryPresentationMaster,presentationRevision} from './fixtures/inventoryPresentations/erp/server/services/inventoryPresentations.js';
import {createInventoryPresentationClient,capturePresentationAuth,PRESENTATIONS_ROOT,type PresentationAuthority,type PresentationContext,type PresentationPage} from '../services/inventoryPresentations/client';
import {InventoryPresentationStore} from '../services/inventoryPresentations/store';
import {inventoryPresentationRevision} from '../services/inventoryPresentations/contract';
const scope={tenantId:id(1),companyId:id(2),storeId:id(3),terminalId:id(4),deviceId:id(50),warehouseId:id(5),localId:id(51)};
function fixtures(){
 const authority:PresentationAuthority={origin:'https://erp.invalid',scope:{...scope},tariffIds:[id(6)],categories:[]};
 const body={schemaVersion:1,contract:'INVENTORY_PRESENTATIONS_V1',scope:authority.scope,tariffIds:authority.tariffIds,categories:[],inventoryQuantityUnit:'BASE'};
 const context={...body,contextRevision:presentationRevision(body),returnPolicy:'SOURCE_REQUIRED_NOT_YET_SUPPORTED',mastersUrl:PRESENTATIONS_ROOT+'/masters'} as PresentationContext;
 const master=(itemId=id(7),price=250)=>buildInventoryPresentationMaster({id:itemId,sku:'BEB-003',nombre:'Agua',precio_venta:85,metadata:{articleFormats:[{id:'unit',variantId:null,name:'Unidad',abbreviation:'UN',factor:1,active:true,isBase:true,allowSale:true,allowPurchase:false,defaultSale:false,defaultPurchase:false,sortOrder:0,prices:[{tariffId:id(6),price:85}]},{id:'pack',variantId:null,name:'Pack',abbreviation:'PK',factor:12,active:true,isBase:false,allowSale:true,allowPurchase:true,defaultSale:true,defaultPurchase:true,sortOrder:1,prices:[{tariffId:id(6),price}]}]}},[{id:id(6),tax_included:false}],{contextRevision:context.contextRevision});
 const page=(items:any[],nextAfter:string|null=null):PresentationPage=>({schemaVersion:1,contract:'INVENTORY_PRESENTATIONS_V1',contextRevision:context.contextRevision,items,checksum:presentationRevision(items),nextAfter});
 return {authority,context,master,page};
}
async function fixture(db?:SQLite.Database){
 const f=await nativeFixture(db),store=new InventoryPresentationStore(f.adapter.inventoryPresentationsSQL()),data=fixtures(),requests:{url:string;init:RequestInit}[]=[];let session=0,revoked=false;
 let pages=[data.page([data.master()])];let response=(url:string)=>url.endsWith('/negotiate')?data.context:pages.shift();
 const options={store,authority:()=>data.authority,auth:()=>({origin:data.authority.origin,scope:{...scope},headers:{Authorization:'Bearer private-token','X-Sync-Token':'private-token','X-Device-Token':'private-device-token'},assertCurrent(){if(revoked)throw Error('AUTH_REVOKED');}}),sessionId:()=>id(200+session++),fetchImpl:async(url:any,init:any)=>{requests.push({url:String(url),init});return new Response(JSON.stringify(response(String(url))),{status:200,headers:{'X-Clic-Inventory-Presentations':'1'}});}};
 await store.migrate();const client=createInventoryPresentationClient(options);
 return {...f,store,data,client,options,requests,setPages:(value:any[])=>{pages=value;},respond:(fn:(url:string)=>any)=>{response=fn;},revoke:()=>{revoked=true;}};
}
test('exact producer pages publish once through native shared port; blank filtered pages continue until final null',async()=>{
 const f=await fixture();try{
  f.setPages([f.data.page([],id(6)),f.data.page([f.data.master()],id(7)),f.data.page([])]);
  const before=f.state(),first=f.client.prepare();assert.strictEqual(f.client.prepare(),first);await first;
  assert.equal(f.requests.length,4);assert.equal(f.requests[0].url,'https://erp.invalid'+PRESENTATIONS_ROOT+'/negotiate');
  for(const request of f.requests){assert.equal((request.init.headers as any)['X-Clic-Inventory-Presentations'],'1');assert.equal(request.init.redirect,'error');assert.equal(request.init.credentials,'omit');assert.ok(!request.url.includes('fiscal'));}
  const cached=await f.client.cached();assert.ok(cached);const master=await f.store.master(cached.bindingKey,id(7));assert.equal(master!.formats[1].prices[0].price,250);assert.equal(master!.formats[1].factor,12);
  assert.deepEqual(f.state(),before);assert.equal(f.documents('transactions').length,0);assert.equal(f.documents('nativeFiscalReservations').length,0);
  const cache=JSON.stringify(f.db.prepare('SELECT * FROM inventory_presentation_contexts').all());assert.ok(!cache.includes('private-token'));assert.ok(!cache.includes('private-device-token'));
 }finally{f.db.close();}
});
for(const mode of ['hash','context','cursor-loop','duplicate','foreign-tariff','master-revision','header','partial','redirect','401','403','404','500','network','timeout'])test(`download ${mode} keeps partial cache invisible and commercial data untouched`,async()=>{
 const f=await fixture();try{
  const before=f.state();let calls=0;
  f.options.fetchImpl=async(url:any,init:any)=>{
   calls++;const negotiate=String(url).endsWith('/negotiate');
   if(mode==='network')throw Error('network-offline');
   if(mode==='timeout')return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}));
   if(['401','403','404','500'].includes(mode))return new Response('{}',{status:Number(mode)});
   let value:any=negotiate?f.data.context:f.data.page([f.data.master()]);
   if(!negotiate){
    if(mode==='hash')value.checksum='b'.repeat(64);
    if(mode==='context')value.contextRevision='b'.repeat(64);
    if(mode==='cursor-loop')value=f.data.page([],id(6));
    if(mode==='duplicate')value=f.data.page([f.data.master(),f.data.master()]);
    if(mode==='foreign-tariff'){value.items[0].basePrices[0].tariffId=id(99);const {masterRevision:_,...body}=value.items[0];value.items[0].masterRevision=presentationRevision(body);value.checksum=presentationRevision(value.items);}
    if(mode==='master-revision'){value.items[0].formats[1].factor=2;value.checksum=presentationRevision(value.items);}
    if(mode==='partial')value={...value,unexpected:true};
   }
   const response=new Response(JSON.stringify(value),{headers:mode==='header'?{}:{'X-Clic-Inventory-Presentations':'1'}});
   if(mode==='redirect')Object.defineProperty(response,'redirected',{value:true});return response;
  };
  const client=createInventoryPresentationClient({...f.options,timeoutMs:5,maxPages:4});await assert.rejects(client.prepare());
  assert.equal(await f.store.active(await inventoryPresentationRevision({origin:f.data.authority.origin,scope})),null);
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='inventory_presentation_sessions'").get()&&Number((f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='inventory_presentation_sessions'").get() as any).n)>0?(f.db.prepare('SELECT count(*) n FROM inventory_presentation_sessions').get() as any).n:0,0);
  assert.deepEqual(f.state(),before);assert.ok(calls<=4);
 }finally{f.db.close();}
});
test('binding/auth change and cancellation prevent publishing old response, with no implicit retry',async()=>{
 for(const mode of ['binding','revoke','cancel']){const f=await fixture();try{
  let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});let started!:()=>void;const requestStarted=new Promise<void>(resolve=>{started=resolve;});
  f.options.fetchImpl=async()=>{started();await blocked;return new Response(JSON.stringify(f.data.context),{headers:{'X-Clic-Inventory-Presentations':'1'}});};
  const client=createInventoryPresentationClient(f.options),pending=client.prepare();await requestStarted;
  if(mode==='binding')f.data.authority.scope.deviceId='different-device';else if(mode==='revoke')f.revoke();else client.cancel();release();await assert.rejects(pending);
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='inventory_presentation_active'").get()&&Number((f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='inventory_presentation_active'").get() as any).n)>0?(f.db.prepare('SELECT count(*) n FROM inventory_presentation_active').get() as any).n:0,0);
 }finally{f.db.close();}}
});
test('retained old revision survives new master and failed later download; batch lookup is one bounded SQL query',async()=>{
 const f=await fixture();try{
  await f.client.prepare();const old=await f.client.cached();assert.ok(old);const original=f.data.master();
  f.setPages([f.data.page([f.data.master(id(7),275)])]);await f.client.prepare();const current=await f.client.cached();assert.equal((await f.store.master(current!.bindingKey,id(7)))!.formats[1].prices[0].price,275);assert.deepEqual(await f.store.retained(old.contextKey,original.masterRevision),original);
  f.respond(url=>url.endsWith('/negotiate')?f.data.context:{bad:true});await assert.rejects(f.client.prepare());assert.equal((await f.store.master(current!.bindingKey,id(7)))!.formats[1].prices[0].price,275);
  const before=f.fault.queries;assert.equal(Object.keys(await f.store.masters(current!.bindingKey,[id(7),id(8)])).length,1);assert.equal(f.fault.queries-before,1);await assert.rejects(f.store.masters(current!.bindingKey,Array.from({length:201},(_,n)=>id(n+7))),/QUERY_LIMIT/);
  for(const sql of ["DELETE FROM inventory_presentation_masters","UPDATE inventory_presentation_masters SET content='{}'","INSERT OR REPLACE INTO inventory_presentation_masters SELECT context_key,master_revision,item_id,'{}' FROM inventory_presentation_masters LIMIT 1","DELETE FROM inventory_presentation_pages","DELETE FROM inventory_presentation_sessions"]){assert.throws(()=>f.db.exec(sql),/IMMUTABLE/);}
 }finally{f.db.close();}
});
test('publication fault rolls back pointer and retained rows; cache reopens offline without requests',async()=>{
 const f=await fixture();try{
  const port=f.adapter.inventoryPresentationsSQL();let inject=true;
  const store=new InventoryPresentationStore({...port,runTransaction:work=>port.runTransaction(tx=>work({...tx,executeAtomic:async statements=>{if(inject&&statements.some(s=>s.statement.startsWith('INSERT INTO inventory_presentation_active'))){inject=false;return tx.executeAtomic([...statements,{statement:'INSERT INTO missing_table VALUES(1)'}]);}return tx.executeAtomic(statements);}}))});
  const client=createInventoryPresentationClient({...f.options,store});await assert.rejects(client.prepare(),/missing_table/);
  const bindingKey=await inventoryPresentationRevision({origin:f.data.authority.origin,scope});assert.equal(await store.active(bindingKey),null);assert.equal((f.db.prepare('SELECT count(*) n FROM inventory_presentation_masters').get() as any).n,0);
  f.setPages([f.data.page([f.data.master()])]);await client.prepare();
  const reopened=new InventoryPresentationStore(f.adapter.inventoryPresentationsSQL()),offline=createInventoryPresentationClient({...f.options,store:reopened,fetchImpl:async()=>{throw Error('must not fetch');}});
  const cached=await offline.cached();assert.ok(cached);assert.equal((await reopened.master(cached.bindingKey,id(7)))!.formats[1].factor,12);
 }finally{f.db.close();}
});
test('current session and exact device credentials guard commercial transport without rewriting historical pairing expiry',()=>{
 const identity={erpSyncBaseUrl:'https://erp.invalid/api/sync',tenantId:scope.tenantId,terminalId:scope.terminalId,deviceId:scope.deviceId,syncToken:'secret'};
 const credentials:any={...identity,companyId:scope.companyId,storeId:scope.storeId,deviceToken:'private-device',deviceTokenSource:'ERP_REGISTER',authStatus:'AUTHENTICATED',syncTokenExpiresAt:'2099-01-01',deviceTokenExpiresAt:'2020-01-01'};
 const before=JSON.stringify(credentials),auth=capturePresentationAuth(()=>identity,()=>credentials);auth.assertCurrent();assert.equal(JSON.stringify(credentials),before);
 credentials.syncToken='rotated';assert.throws(()=>auth.assertCurrent(),/AUTH_REQUIRED|AUTH_CHANGED/);credentials.syncToken='secret';credentials.syncTokenExpiresAt='2020-01-01';assert.throws(()=>capturePresentationAuth(()=>identity,()=>credentials),/AUTH_REQUIRED/);
});
test('complete retained cache survives actual SQLite close/reopen while offline and changed scope cannot read it',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'clic-presentation-cache-')),file=join(directory,'pos.sqlite');let current:SQLite.Database|undefined;
 try{
  const f=await fixture(new SQLite(file));current=f.db;await f.client.prepare();const old=await f.client.cached();assert.ok(old);f.db.close();
  const g=await nativeFixture(new SQLite(file),false);current=g.db;const store=new InventoryPresentationStore(g.adapter.inventoryPresentationsSQL()),client=createInventoryPresentationClient({...f.options,store,fetchImpl:async()=>{throw Error('network-offline');}});
  assert.equal((await client.cached())!.contextKey,old.contextKey);assert.equal((await store.master(old.bindingKey,id(7)))!.formats[1].prices[0].price,250);
  f.data.authority.scope.warehouseId=id(99);await assert.rejects(client.cached(),/SCOPE_CHANGED/);assert.ok(await store.retained(old.contextKey,f.data.master().masterRevision));
 }finally{if(current?.open)current.close();rmSync(directory,{recursive:true,force:true});}
});
for(const at of [0,1,2])test(`each publication write ${at} rolls back all retained/cache-pointer effects`,async()=>{
 const f=await fixture();try{
  const bindingKey=await inventoryPresentationRevision({origin:f.data.authority.origin,scope}),sessionId=id(900+at);await f.store.begin(sessionId,bindingKey,f.data.authority.origin,f.data.context);await f.store.stage(sessionId,0,f.data.page([f.data.master()]));
  f.fault.failWrite=f.fault.writes+at;await assert.rejects(f.store.publish(sessionId,()=>{}),/injected-write/);
  assert.equal(await f.store.active(bindingKey),null);assert.equal((f.db.prepare('SELECT count(*) n FROM inventory_presentation_masters').get() as any).n,0);assert.equal((f.db.prepare('SELECT state FROM inventory_presentation_sessions WHERE id=?').get(sessionId) as any).state,'STAGING');
  assert.equal(f.documents('transactions').length,0);assert.equal(f.documents('nativeFiscalReservations').length,0);
 }finally{f.db.close();}
});
test('staging selection tamper cannot publish a valid but undelivered revision',async()=>{
 const f=await fixture();try{
  const bindingKey=await inventoryPresentationRevision({origin:f.data.authority.origin,scope}),sessionId=id(950);await f.store.begin(sessionId,bindingKey,f.data.authority.origin,f.data.context);await f.store.stage(sessionId,0,f.data.page([f.data.master()]));
  const foreign=f.data.master(id(7),275);f.db.prepare('UPDATE inventory_presentation_selection SET master_revision=?,content=? WHERE session_id=?').run(foreign.masterRevision,JSON.stringify(Object.fromEntries(Object.entries(foreign).sort())),sessionId);
  await assert.rejects(f.store.publish(sessionId,()=>{}),/CACHE_INVALID/);assert.equal(await f.store.active(bindingKey),null);assert.equal((f.db.prepare('SELECT count(*) n FROM inventory_presentation_masters').get() as any).n,0);
 }finally{f.db.close();}
});
for(const kind of ['warehouse','tariff','cancel','null-warehouse','null-tariff','null-cancel'])test(`cached ${kind} race is denied after lookup even without auth-token change`,async()=>{
 const f=await fixture();try{
  await f.client.prepare();let release!:()=>void,entered!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const original=f.store.active.bind(f.store);f.store.active=async key=>{const result=await original(key);entered();await blocked;return kind.startsWith('null-')?null:result;};
  const pending=f.client.cached();await started;
  if(kind.endsWith('warehouse'))f.data.authority.scope.warehouseId=id(99);else if(kind.endsWith('tariff'))f.data.authority.tariffIds=[id(99)];else f.client.cancel();
  release();await assert.rejects(pending,/CONTEXT_CHANGED/);
  assert.equal(f.documents('transactions').length,0);assert.equal((f.db.prepare('SELECT count(*) n FROM inventory_presentation_masters').get() as any).n,1);
 }finally{f.db.close();}
});
