import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeFixture,id} from './articleFormatsNativeFixture';
import type {LargeMasterSyncV3IdentityReadContext,LargeMasterSyncV3CatalogTransition,LargeMasterSyncV3Manifest} from '../services/sync/LargeMasterSyncV3Types';
import {LargeMasterSyncV3Runtime} from '../services/sync/LargeMasterSyncV3Runtime';
import {readOperationalTerminalBinding} from '../services/sync/OperationalTerminalConfig';
const oldId=id(60),newId=id(61),warehouse=id(5),tariff=id(6),product=id(7);
const manifest:LargeMasterSyncV3Manifest={syncId:newId,syncVersion:33,schemaVersion:3,contractVersion:2,type:'FULL',status:'READY',createdAt:'2026-10-15',datasets:{}};
async function fixture(file?:string,track=true,negative=false){
 const f=await nativeFixture(file?new SQLite(file):undefined),store=f.adapter.masterSyncV3Store,bridge=(f.adapter as any).db,commands:string[]=[];
 f.db.prepare("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES(?,32,3,2,'ACTIVE','{}','fixture','fixture')").run(oldId);
 const article=JSON.parse((f.db.prepare('SELECT record_json FROM master_v3_articles WHERE sync_version=32').get() as any).record_json);article.activeWarehouseIds=[warehouse];article.operationalFlags={trackInventory:track,allowNegativeStock:negative};
 f.db.prepare('UPDATE master_v3_articles SET record_json=?').run(JSON.stringify(article));
 f.db.prepare('INSERT INTO master_v3_tariffs(sync_version,tariff_id,active,record_json) VALUES(32,?,1,?)').run(tariff,JSON.stringify({id:tariff,name:'Synthetic',active:true,taxIncluded:false}));
 f.db.prepare('INSERT INTO master_v3_prices VALUES(32,?,?,45)').run(product,tariff);
 const query=bridge.query.bind(bridge),execute=bridge.execute.bind(bridge);
 bridge.query=async(sql:string,values:any[])=>{commands.push('query:'+sql);return query(sql,values);};bridge.execute=async(sql:string,transaction?:boolean)=>{commands.push(sql);return execute(sql,transaction);};
 const config=await f.adapter.getCollection<any>('config'),expected=JSON.stringify(config);let callbackCount=0;const retained:LargeMasterSyncV3IdentityReadContext[]=[];
 const assertIdentity=async(owned?:LargeMasterSyncV3IdentityReadContext)=>{callbackCount++;if(owned)retained.push(owned);const current=owned?await owned.readConfig():await f.adapter.getCollection<any>('config');assert.equal(JSON.stringify(current),expected,'SYNC_V3_BINDING_CHANGED');};
 const transition=async():Promise<LargeMasterSyncV3CatalogTransition>=>({binding:(await store.getOperationalOwner())!.binding,expectedCatalog:(await store.getActiveRuntimeVersion())!,inventory:(await store.getInventoryAuthority())!,assertIdentity});
 const stage=(version=33,patch:Record<string,any>={})=>{
  f.db.prepare("UPDATE sync_v3_sessions SET status='VALIDATED' WHERE sync_id=?").run(newId);
  for(const table of ['articles','tariffs','taxes','variants','prices','barcodes']){
   const records=f.db.prepare(`SELECT * FROM master_v3_${table} WHERE sync_version=32`).all() as any[];
   for(const record of records){record.sync_version=version;if(table==='articles')record.record_json=JSON.stringify({...JSON.parse(record.record_json),...patch});const keys=Object.keys(record);f.db.prepare(`INSERT INTO master_v3_${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>record[k]));}
  }
 };
 return {...f,store,bridge,commands,transition,stage,config,retained,calls:()=>callbackCount};
}
function state(f:Awaited<ReturnType<typeof fixture>>){return f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r:any)=>[r.name,f.db.prepare(`SELECT * FROM "${r.name}" ORDER BY rowid`).all()]);}
const bounded=async<T>(work:Promise<T>):Promise<T>=>{let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('native owner did not settle')),2000);})]);}finally{clearTimeout(timer!);}};

 test('actual shared native queue prepares/activates/replays and unused-baseline checks with owned config; contexts expire',async()=>{
 const f=await fixture();try{
  const tr=await f.transition();await bounded(f.store.assertCanReplaceUnusedBaseline(tr));await bounded(f.store.activateCatalogOnly(oldId,tr));
  await bounded(f.store.prepareCatalogOnly(manifest,await f.transition()));f.stage();await bounded(f.store.activateCatalogOnly(newId,await f.transition()));
  await bounded(f.store.activateCatalogOnly(newId,await f.transition()));
  const replayManifest={...manifest};await bounded(f.store.prepareCatalogOnly(replayManifest,await f.transition()));
  assert.ok(f.calls()>=10);assert.ok(f.commands.some(c=>c.includes('length(data)')&&c.includes('collection_name')));
  for(const context of f.retained)await assert.rejects(context.readConfig(),/CONTEXT_EXPIRED/);assert.equal(f.db.inTransaction,false);
  assert.equal((await f.store.getOperationalOwner())!.syncVersion,33);assert.equal((await f.store.getInventoryAuthority())!.syncVersion,32);
 }finally{f.db.close();}
});

test('queued config change/read wait for owner; next transition rejects changed persisted scope without replacing authority',async()=>{
 const f=await fixture();try{
  let enter!:()=>void,release!:()=>void;const started=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);const tr=await f.transition(),original=tr.assertIdentity!;let first=true;
  tr.assertIdentity=async context=>{await original(context);if(first){first=false;enter();await held;}};
  const preparation=f.store.prepareCatalogOnly(manifest,tr);await started;
  let readDone=false,writeDone=false;const config=structuredClone(f.config);config.terminals[0].config.inventoryScope.defaultSalesWarehouseId=id(999);
  const write=f.adapter.saveCollection('config',config).then(()=>{writeDone=true;});const read=f.adapter.getCollection('config').then(()=>{readDone=true;});await Promise.resolve();assert.equal(readDone,false);assert.equal(writeDone,false);
  release();await bounded(Promise.all([preparation,write,read]));f.stage();const before=state(f);
  await assert.rejects(bounded(f.store.activateCatalogOnly(newId,{...await f.transition(),assertIdentity:original})),/BINDING_CHANGED/);assert.deepEqual(state(f),before);
 }finally{f.db.close();}
});

for(const problem of ['missing','corrupt','decode','bridge','final-scope','before-commit'] as const)test(`owned config ${problem} rejects and rolls back all retained tables`,async()=>{
 const f=await fixture();try{
  const tr=await f.transition();await f.store.prepareCatalogOnly(manifest,tr);f.stage();
  if(problem==='missing')f.db.prepare("DELETE FROM documents WHERE collection_name='config'").run();
  if(problem==='corrupt')f.db.prepare("UPDATE documents SET data='null' WHERE collection_name='config'").run();
  const before=state(f),query=f.bridge.query.bind(f.bridge),execute=f.bridge.execute.bind(f.bridge),run=f.bridge.run.bind(f.bridge);
  if(problem==='decode')f.bridge.query=async(sql:string,values:any[])=>{const result=await query(sql,values);if(sql.includes('length(data)'))result.values[0].data='bad-json';return result;};
  if(problem==='bridge')f.bridge.query=async(sql:string,values:any[])=>{if(sql.includes('length(data)'))throw Error('config-bridge-fault');return query(sql,values);};
  if(problem==='final-scope')f.bridge.run=async(sql:string,values:any[],transaction:boolean)=>{const result=await run(sql,values,transaction);if(sql.includes('UPDATE master_v3_operational_owner SET sync_id'))f.db.prepare("UPDATE documents SET data=json_set(data,'$.terminals[0].config.fiscal.mode','CHANGED') WHERE collection_name='config'").run();return result;};
  if(problem==='before-commit')f.bridge.execute=async(sql:string,transaction?:boolean)=>{if(sql==='COMMIT;')throw Error('precommit-fault');return execute(sql,transaction);};
  await assert.rejects(bounded(f.store.activateCatalogOnly(newId,tr)));assert.equal(f.db.inTransaction,false);assert.deepEqual(state(f),before);
  for(const context of f.retained)await assert.rejects(context.readConfig(),/CONTEXT_EXPIRED/);
 }finally{f.db.close();}
});

test('actual unused-baseline activation invokes owned config hooks and preserves financial documents',async()=>{
 const f=await fixture();try{
  await f.store.prepareCatalogOnly(manifest,await f.transition());f.stage(33,{uom:'CHANGED'});const tr=await f.transition();
  await bounded(f.store.activateUnusedBaseline(newId,{version:5,cursor:'new-cursor',balances:[{item_id:product,warehouse_id:warehouse,qty_on_hand:20,qty_reserved:0,qty_committed:0,updated_at:'fixture'}]},tr));
  assert.equal((await f.store.getInventoryAuthority())!.syncVersion,33);assert.equal((await f.store.getInventoryAuthority())!.cursor,'new-cursor');
 }finally{f.db.close();}
});

test('committed response lost retains complete catalog receipt/owner on reopen and revoked callbacks',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-v3-refresh-')),file=join(dir,'pos.sqlite');const f=await fixture(file);
 try{
  await f.store.prepareCatalogOnly(manifest,await f.transition());f.stage();const tr=await f.transition(),execute=f.bridge.execute.bind(f.bridge);f.bridge.execute=async(sql:string,transaction?:boolean)=>{const result=await execute(sql,transaction);if(sql==='COMMIT;')throw Error('lost-response');return result;};
  await assert.rejects(bounded(f.store.activateCatalogOnly(newId,tr)),/lost-response/);assert.equal(f.db.inTransaction,false);const durable=state(f);f.db.close();
  const reopened=await nativeFixture(new SQLite(file),false);try{assert.equal((await reopened.adapter.masterSyncV3Store.getOperationalOwner())!.syncVersion,33);assert.ok(await reopened.adapter.masterSyncV3Store.getCatalogReceipt({syncId:newId,syncVersion:33},tr.binding));assert.deepEqual(state({...f,db:reopened.db}),durable);}finally{reopened.db.close();}
 }finally{if(f.db.open)f.db.close();rmSync(dir,{recursive:true,force:true});}
});

let sessionBundle:Promise<any>|undefined;
async function sessionModule(f:Awaited<ReturnType<typeof fixture>>){
 const g=globalThis as any;g.__refresh={adapter:f.adapter,identity:{tenantId:id(1),terminalId:id(4),deviceId:id(50),erpSyncBaseUrl:'https://erp.invalid',syncToken:'synthetic'},origin:'https://erp.invalid',guard:'synthetic-guard'};Object.assign(f.adapter,{connect:async()=>{}});
 g.__refresh.refresh=async(store:any,_url:any,binding:any,_observe:any,_deps:any,assertIdentity:any)=>{
  await assertIdentity();const transition={...await f.transition(),binding,assertIdentity};await store.prepareCatalogOnly(manifest,transition);f.stage(33,g.__refresh.patch || {});await store.activateCatalogOnly(newId,transition);
  return {runtime:await LargeMasterSyncV3Runtime.open(store),inventoryVersion:4,inventoryCursor:'inventory-cursor',inventorySyncId:oldId,inventorySyncVersion:32};
 };
 sessionBundle ||= build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3OperationalSession.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env':'{}'},plugins:[{name:'native-refresh-environment',setup(b){b.onResolve({filter:/^(\.\.\/db|\.\.\/\.\.\/utils\/db|\.\/LargeMasterSyncV3(?:Platform|Authority|Candidate|BoundTransport|DownloadOrigin)|\.\/OperationalTerminalConfig)$/},a=>({path:a.path,namespace:'refresh'}));b.onLoad({filter:/.*/,namespace:'refresh'},a=>({loader:'js',contents:a.path==='../db'?'export const dbAdapter=new Proxy({}, {get:(_t,k)=>{const a=globalThis.__refresh.adapter;return typeof a[k]==="function"?a[k].bind(a):a[k];}});':a.path==='../../utils/db'?'export const db={get:()=>globalThis.__refresh.adapter.getCollection("config"),getDocument:(...a)=>globalThis.__refresh.adapter.getDocument(...a)};':a.path.endsWith('Platform')?'export const assertLargeMasterSyncV3NativeAndroid=()=>{};':a.path.endsWith('Authority')?'export const LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED=true;':a.path.endsWith('Candidate')?'export const prepareLargeMasterSyncV3CatalogOnly=(...a)=>globalThis.__refresh.refresh(...a);export const prepareLargeMasterSyncV3Candidate=()=>{throw Error("unexpected fresh download")};export const prepareLargeMasterSyncV3UnusedBaseline=()=>{throw Error("unexpected baseline replacement")};':a.path.endsWith('BoundTransport')?'export const readLargeMasterSyncV3BoundIdentity=()=>globalThis.__refresh.identity;export const validatedLargeMasterSyncV3ErpSyncBase=value=>value;':a.path.endsWith('DownloadOrigin')?'export const largeMasterSyncV3DownloadOrigin=()=>globalThis.__refresh.origin;':'export const readOperationalTerminalBinding=()=>globalThis.__refresh.readGuard?.()??globalThis.__refresh.guard;export const readOperationalCatalogBindingProof=()=>undefined;'}));}}]}).then(r=>import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64')));
 return sessionBundle;
}

test('actual Session callback plus singleflight coordinator refresh/ordinary consumer settle and project committed catalog',async()=>{
 const f=await fixture();try{
  const {getLargeMasterSyncV3OperationalSession:get}=await sessionModule(f);const refreshing=get(true),ordinary=get(false);const [session,consumer]=await bounded(Promise.all([refreshing,ordinary]));assert.equal(session,consumer);
  await session.assertCurrent();const config=await session.projectConfig(f.config),catalog=await session.catalog(tariff,warehouse);assert.equal(config.tariffs[0].id,tariff);assert.equal((await catalog.get(product)).product.id,product);
 }finally{f.db.close();delete (globalThis as any).__refresh;}
});


for(const track of [false,true])for(const negative of [false,true])for(const opening of [0,-1])test(`full synthetic invoice committed catalog policy track${track}/negative${negative}, opening${opening}`,async()=>{
 await invoiceCase(track,negative,opening,false);
});
for(const track of [false,true])test(`full synthetic invoice with missing stock cell and committed negative=true/track${track}`,async()=>{
 await invoiceCase(track,true,0,true);
});
for(const attack of ['unknown-anchor','canonical-false','retained-source','warehouse','semantics','cursor','binding','receipt','write-fault','precommit-fault'])test(`sparse invoice denies ${attack} with whole financial rollback`,async()=>{await invoiceCase(true,true,0,true,attack);});
async function invoiceCase(track:boolean,negative:boolean,opening:number,missing:boolean,attack?:string){
 const f=await fixture(undefined,track,false);try{
  f.db.prepare('UPDATE master_v3_inventory_balances SET qty_on_hand=?').run(opening);if(missing)f.db.prepare('DELETE FROM master_v3_inventory_balances').run();
  f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('transactionHistory','retained-before-refresh',JSON.stringify({id:'retained-before-refresh',items:[],status:'COMPLETED'}),0,'fixture');
  const retained=f.documents('transactionHistory'),anchor=JSON.stringify(await f.store.getInventoryAuthority()),oldRecord=(f.db.prepare('SELECT record_json FROM master_v3_articles WHERE sync_version=32').get() as any).record_json;
  const {LargeMasterSyncV3OperationalSession:Session}=await sessionModule(f);const previous=await Session.open(false),oldProduct=await previous.withStock((await (await previous.catalog(tariff,warehouse)).get(product)).product,warehouse);
  const oldLine={...oldProduct,cartId:'old-line',quantity:1,operationalFlags:{...oldProduct.operationalFlags,allowNegativeStock:true}};
  if(track)await assert.rejects(previous.validate(f.config,[oldLine],tariff,warehouse),/STOCK_INSUFFICIENT/);
  (globalThis as any).__refresh.patch={operationalFlags:{trackInventory:track,allowNegativeStock:negative}};
  const session=await Session.open(true),config=await session.projectConfig(f.config),source=await session.withStock((await (await session.catalog(tariff,warehouse)).get(product)).product,warehouse);
  const line={...source,cartId:'invoice-line',quantity:1,operationalFlags:{...source.operationalFlags,allowNegativeStock:!negative}};
  const required=track&&!negative;if(required)await assert.rejects(session.validate(config,[line],tariff,warehouse),/STOCK_INSUFFICIENT/);else await session.validate(config,[line],tariff,warehouse);
  const demands=await session.stockRequirements(config,[line],warehouse,'SALE');assert.equal(demands.length,required?1:0);
  const bind=(await f.store.getOperationalOwner())!.binding,key=JSON.stringify([bind,oldId,32,4,'inventory-cursor']),scope={v3Binding:bind,v3WarehouseId:warehouse,v3InventoryBaseline:key},catalog={syncId:newId,syncVersion:33,binding:bind};
  const invoice={id:id(800),...scope,status:'COMPLETED',type:'SALE',items:[line],total:45,netAmount:45,taxAmount:0,payments:[{id:id(801),method:'CASH',amount:45}]};
  const seq=f.documents('internalSequences')[0],documents:any[]=[
   {collectionName:'transactions',document:invoice,requireAbsent:true,v3CurrentCatalog:catalog,v3StockRequirements:demands},
   {collectionName:'transactionHistory',document:invoice,requireAbsent:true,v3CurrentCatalog:catalog},
   {collectionName:'payments',document:{id:id(801),transactionId:invoice.id,amount:45,method:'CASH'},requireAbsent:true},
   {collectionName:'internalSequences',document:{...seq,nextNumber:seq.nextNumber+1},expectedDocument:JSON.stringify(seq)},
   {collectionName:'inventoryLedger',document:{id:id(802),...scope,productId:product,warehouseId:warehouse,qtyOut:1,qtyIn:0},requireAbsent:true,v3CurrentCatalog:catalog},
  ];
  const input={documents,outboxEvent:{eventId:id(803),eventType:'SALE_POSTED',aggregateType:'TRANSACTION',aggregateId:invoice.id,schemaVersion:1,payload:{transactionId:invoice.id},createdAt:'fixture'}};
  if(attack){
   if(attack==='unknown-anchor'){f.db.prepare('DELETE FROM master_v3_prices WHERE sync_version=32').run();f.db.prepare('DELETE FROM master_v3_articles WHERE sync_version=32').run();}
   if(attack==='canonical-false')f.db.prepare("UPDATE master_v3_articles SET record_json=json_set(record_json,'$.operationalFlags.allowNegativeStock',json('false')) WHERE sync_version=33").run();
   if(attack==='retained-source')invoice.items[0].v3SaleAuthority={...invoice.items[0].v3SaleAuthority,syncId:oldId,syncVersion:32};
   if(attack==='warehouse')f.db.prepare("UPDATE master_v3_articles SET record_json=json_set(record_json,'$.activeWarehouseIds',json('[]')) WHERE sync_version=33").run();
   if(attack==='semantics')f.db.prepare("UPDATE master_v3_articles SET record_json=json_set(record_json,'$.uom','CHANGED') WHERE sync_version=33").run();
   if(attack==='cursor')invoice.items[0].v3SaleAuthority={...invoice.items[0].v3SaleAuthority,inventoryCursor:'foreign'};
   if(attack==='binding')invoice.items[0].v3SaleAuthority={...invoice.items[0].v3SaleAuthority,binding:'foreign'};
   if(attack==='receipt')f.db.prepare('DELETE FROM master_v3_catalog_owners WHERE sync_version=33').run();
   const run=f.bridge.run.bind(f.bridge),execute=f.bridge.execute.bind(f.bridge);
   if(attack==='write-fault')f.bridge.run=async(sql:string,values:any[],transaction:boolean)=>{if(values[0]==='payments')throw Error('injected-payment-write');return run(sql,values,transaction);};
   if(attack==='precommit-fault')f.bridge.execute=async(sql:string,transaction?:boolean)=>{if(sql==='COMMIT;')throw Error('injected-precommit');return execute(sql,transaction);};
   const untouched=state(f);await assert.rejects(f.adapter.commitFinancialTransaction(input));assert.deepEqual(state(f),untouched);return;
  }
  const before=state(f);if(required){await assert.rejects(f.adapter.commitFinancialTransaction(input),/STOCK_INSUFFICIENT/);assert.deepEqual(state(f),before);}
  else{
   await f.adapter.commitFinancialTransaction(input);assert.equal(f.documents('transactions').length,1);assert.equal(f.documents('payments').length,1);assert.equal(f.documents('inventoryLedger').length,1);assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n,1);assert.equal(f.documents('internalSequences')[0].nextNumber,seq.nextNumber+1);
   await assert.rejects(f.adapter.commitFinancialTransaction(input),/DUPLICATE_COMMIT/);assert.equal(await f.store.getLocalInventoryDelta(key,product,warehouse),-1);assert.equal(opening+await f.store.getLocalInventoryDelta(key,product,warehouse),opening-1);
  }
  assert.deepEqual(f.documents('transactionHistory').filter(r=>r.id==='retained-before-refresh'),retained);assert.equal(JSON.stringify(await f.store.getInventoryAuthority()),anchor);assert.equal((f.db.prepare('SELECT record_json FROM master_v3_articles WHERE sync_version=32').get() as any).record_json,oldRecord);
 }finally{f.db.close();delete (globalThis as any).__refresh;}
}

test('production financial builder with real Session reserves and invoices without structuredClone, replaying one ledger/payment event',async()=>{
 const f=await fixture();const previousWindow=(globalThis as any).window,cloneDescriptor=Object.getOwnPropertyDescriptor(globalThis,'structuredClone');try{
  f.db.prepare('DELETE FROM master_v3_inventory_balances').run();const {LargeMasterSyncV3OperationalSession:Session}=await sessionModule(f);
  (globalThis as any).__refresh.patch={operationalFlags:{trackInventory:true,allowNegativeStock:true}};const session=await Session.open(true),item=await session.withStock((await (await session.catalog(tariff,warehouse)).get(product)).product,warehouse);
  (globalThis as any).__invoice={adapter:f.adapter,session};(globalThis as any).window={dispatchEvent:()=>{}};
  const modules:Record<string,string>={
   '../CheckoutDiagnostics':'export const recordCheckoutDiagnostic=()=>{};',
   '../db':'export const dbAdapter=globalThis.__invoice.adapter;',
   '../../utils/db':'export const db={getDocument:(...a)=>globalThis.__invoice.adapter.getDocument(...a),get:n=>globalThis.__invoice.adapter.getCollection(n),assertFiscalTransactionAuthority:async()=>{}};',
   './SyncFeatureFlags':'export const isSyncFeatureEnabled=()=>true;',
   './DurableOutboxRepository':'export const durableOutboxRepository={commitFinancialTransaction:i=>globalThis.__invoice.adapter.commitFinancialTransaction(i)};',
   './LargeMasterSyncV3OperationalSession':'export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__invoice.session;export const v3InventoryBaselineKey=(b,s)=>JSON.stringify([b,s.inventorySyncId||s.syncId,s.inventorySyncVersion??s.syncVersion,s.inventoryVersion,s.inventoryCursor]);',
  };
  const compiled=await build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3FinancialCommit.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'synthetic-invoice-ports',setup(b){b.onResolve({filter:/.*/},a=>modules[a.path]?{path:a.path,namespace:'invoice'}:undefined);b.onLoad({filter:/.*/,namespace:'invoice'},a=>({contents:modules[a.path],loader:'js'}));}}]});
  const module=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  Object.defineProperty(globalThis,'structuredClone',{value:undefined,configurable:true,writable:true});
  const numbering=await f.adapter.reserveFinancialNumbers({seriesId:id(9),documentType:'TICKET',global:true});assert.equal(numbering.seriesNumber,1);assert.equal(numbering.globalSequence,1);
  const invoice={id:id(900),documentType:'TICKET',displayId:numbering.displayId,date:'2026-10-15T00:00:00Z',terminalId:id(4),status:'COMPLETED',total:45,netAmount:45,taxAmount:0,userId:id(25),userName:'Synthetic',items:[{...item,cartId:'synthetic-full-invoice',quantity:1,netAmount:45,taxAmount:0,totalAmount:45}],payments:[{id:id(901),method:'CASH',amount:45,timestamp:'2026-10-15T00:00:00Z'}]};
  const result=await module.persistV3FinancialTransaction(invoice,f.config,warehouse);assert.equal(result.created,true);assert.equal((await module.persistV3FinancialTransaction(invoice,f.config,warehouse)).created,false);
  assert.equal(f.documents('inventoryLedger').length,1);assert.equal(f.documents('inventoryLedger')[0].qtyOut,1);assert.equal(f.documents('transactions')[0].payments.length,1);assert.equal(f.documents('transactionHistory').length,1);
  assert.deepEqual((f.db.prepare('SELECT event_type FROM sync_outbox_v2 ORDER BY local_sequence').all() as any[]).map(r=>r.event_type),['SALE_POSTED','PAYMENT_POSTED']);
  assert.equal(f.documents('transactions')[0].displayId,'TCK-000001');assert.equal(f.documents('internalSequences')[0].nextNumber,2);
 }finally{if(cloneDescriptor)Object.defineProperty(globalThis,'structuredClone',cloneDescriptor);else delete (globalThis as any).structuredClone;f.db.close();delete (globalThis as any).__refresh;delete (globalThis as any).__invoice;(globalThis as any).window=previousWindow;}
});

// Same native/Session fixture as the invoice guards: count bridge work, never timing or UI latency.
for(const negative of [true,false])test(`current-generation validation reuses only each line's source (negative=${negative})`,async()=>{
 for(const duplicate of [true,false])for(const prior of [0,10,50,100]){
  const f=await fixture(undefined,true,negative);try{
   await f.store.prepareCatalogOnly(manifest,await f.transition());f.stage();await f.store.activateCatalogOnly(newId,await f.transition());
   if(!duplicate)for(let n=1;n<=prior;n++){
    const next=id(1000+n),row=f.db.prepare('SELECT * FROM master_v3_articles WHERE sync_version=33 AND article_id=?').get(product) as any;row.article_id=next;row.record_json=JSON.stringify({...JSON.parse(row.record_json),id:next});const keys=Object.keys(row);f.db.prepare(`INSERT INTO master_v3_articles(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));f.db.prepare('INSERT INTO master_v3_prices VALUES(33,?,?,45)').run(next,tariff);f.db.prepare('INSERT INTO master_v3_inventory_balances VALUES(?,?,137,0,0,?)').run(next,warehouse,'fixture');
   }
   const {LargeMasterSyncV3OperationalSession:Session}=await sessionModule(f),session=await Session.open(false),config=await session.projectConfig(f.config),catalog=await session.catalog(tariff,warehouse),lines:any[]=[];
   for(let n=0;n<=prior;n++)lines.push({...await session.withStock((await catalog.get(duplicate||n===0?product:id(1000+n))).product,warehouse),quantity:1,cartId:'count-'+n});
   const commands:{method:string;sql:string;values:any[]}[]=[];
   for(const method of ['query','run','execute']){const original=f.bridge[method].bind(f.bridge);f.bridge[method]=async(...args:any[])=>{commands.push({method,sql:args[0],values:args[1] || []});return original(...args);};}
   const sources:any[]=[];await session.validate(config,lines,tariff,warehouse,'SALE',(_line:any,source:any)=>{sources.push(source);source.name='callback-local';});
   // Scope validation added one canonical config read at each of the three session fences.
   // Budget those exact security reads separately; preserve the original catalog work budget.
   const configGuardSql = 'SELECT doc_id, length(data) AS data_length, CASE WHEN length(data) <= ? THEN data ELSE NULL END AS data FROM documents WHERE collection_name = ? ORDER BY sort_order ASC, updatedAt ASC LIMIT ? OFFSET ?';
   const configGuards = commands.filter(c => c.method === 'query' && c.sql === configGuardSql
     && JSON.stringify(c.values) === JSON.stringify([4 * 1024 * 1024, 'config', 15, 0]));
   assert.equal(configGuards.length,3,'exactly three canonical config scope guards');
   assert.equal(commands.length-configGuards.length,13+(negative?6:7)*lines.length,`prior=${prior}, duplicate=${duplicate}`);assert.equal(commands.filter(c=>c.method!=='query').length,0);assert.equal(commands.filter(c=>c.sql.includes('master_v3_taxes')).length,1);
   assert.equal(sources.length,lines.length);assert.equal(new Set(sources).size,lines.length,'callback mutation cannot leak into the next line');assert.equal((await catalog.get(product)).product.name,'Synthetic');assert.equal(f.db.inTransaction,false);
  }finally{f.db.close();delete (globalThis as any).__refresh;}
 }
});

for(const problem of ['missing-stamp','stale-stamp','owner-drift','cursor-drift','token-drift','canonical-false'] as const)test(`per-line reuse keeps ${problem} rejection and final authority fence`,async()=>{
 const f=await fixture(undefined,true,false);try{
  const {LargeMasterSyncV3OperationalSession:Session}=await sessionModule(f),session=await Session.open(false),config=await session.projectConfig(f.config),line={...await session.withStock((await(await session.catalog(tariff,warehouse)).get(product)).product,warehouse),quantity:1,cartId:'guard',operationalFlags:{trackInventory:true,allowNegativeStock:true}};
  if(problem==='missing-stamp')delete line.v3SaleAuthority;
  if(problem==='stale-stamp')line.v3SaleAuthority={...line.v3SaleAuthority,syncId:newId,syncVersion:33};
  if(problem==='canonical-false')line.quantity=138;
  let callbacks=0;await assert.rejects(session.validate(config,[line],tariff,warehouse,'SALE',()=>{callbacks++;if(problem==='owner-drift')f.db.prepare("UPDATE master_v3_operational_owner SET binding='foreign'").run();if(problem==='cursor-drift')f.db.prepare("UPDATE master_v3_inventory_state SET cursor='foreign'").run();if(problem==='token-drift')(globalThis as any).__refresh.identity={...(globalThis as any).__refresh.identity,syncToken:'changed'};}));
  if(problem.endsWith('drift'))assert.equal(callbacks,1,'drift injected after source validation must reach and fail the final fence');
  assert.equal(f.documents('transactions').length,0);assert.equal(f.documents('inventoryLedger').length,0);
 }finally{f.db.close();delete (globalThis as any).__refresh;}
});

for(const scenario of ['retained','tax-changed','receipt-missing','current-missing','delivery'] as const)test(`retained generation keeps independent current/source reads and lazy taxes: ${scenario}`,async()=>{
 const f=await fixture();try{
  const tax=id(77);f.db.prepare('INSERT INTO master_v3_taxes(sync_version,tax_id,active,rate,record_json) VALUES(32,?,1,.18,?)').run(tax,JSON.stringify({id:tax,name:'ITBIS',type:'VAT',rate:.18,active:true}));
  const article=JSON.parse((f.db.prepare('SELECT record_json FROM master_v3_articles WHERE sync_version=32').get() as any).record_json);article.taxable=true;article.taxIds=[tax];f.db.prepare('UPDATE master_v3_articles SET taxable=1,tax_ids_json=?,record_json=? WHERE sync_version=32').run(JSON.stringify([tax]),JSON.stringify(article));
  await f.store.activateCatalogOnly(oldId,await f.transition());
  const {LargeMasterSyncV3OperationalSession:Session}=await sessionModule(f),previous=await Session.open(false),old=await previous.withStock((await(await previous.catalog(tariff,warehouse)).get(product)).product,warehouse),lines=[{...old,quantity:1,cartId:'retained-a'},{...old,quantity:1,cartId:'retained-b'}];
  await f.adapter.saveCollection('parkedTickets',[{id:'retained-cart',items:lines}]);const retainedBefore=f.documents('parkedTickets');
  await f.store.prepareCatalogOnly(manifest,await f.transition());f.stage();f.db.prepare('UPDATE master_v3_prices SET price=85 WHERE sync_version=33').run();await f.store.activateCatalogOnly(newId,await f.transition());
  const session=await Session.open(false),config=await session.projectConfig(f.config);
  if(scenario==='tax-changed'||scenario==='delivery')f.db.prepare("UPDATE master_v3_taxes SET record_json=json_set(record_json,'$.type','SERVICE_CHARGE') WHERE sync_version=33").run();
  if(scenario==='receipt-missing')f.db.prepare('DELETE FROM master_v3_catalog_owners WHERE sync_version=32').run();
  if(scenario==='current-missing')f.db.prepare('UPDATE master_v3_articles SET active=0 WHERE sync_version=33').run();
  const reads:{sql:string;values:any[]}[]=[],query=f.bridge.query.bind(f.bridge);f.bridge.query=async(sql:string,values:any[])=>{reads.push({sql,values});return query(sql,values);};
  const seen:number[]=[],run=()=>session.validate(config,lines,tariff,warehouse,'SALE',(_line:any,source:any)=>seen.push(source.price),{ticketId:'retained-cart'},scenario==='delivery');
  if(scenario==='tax-changed')await assert.rejects(run(),/RETAINED_TAX_CLASSIFICATION_CHANGED/);
  else if(scenario==='receipt-missing')await assert.rejects(run(),/RETAINED_OWNER_REQUIRED/);
  else if(scenario==='current-missing')await assert.rejects(run(),/ARTICLE_UNAVAILABLE/);
  else{
   await run();assert.deepEqual(seen,[45,45]);const taxReads=reads.filter(r=>r.sql.includes('master_v3_taxes'));assert.equal(taxReads.length,scenario==='delivery'?2:4,'current comparison promise is lazy and reused across retained lines only');
   const articles=reads.filter(r=>r.sql.includes('FROM master_v3_articles')&&r.sql.includes('article_id'));assert.equal(articles.filter(r=>r.values.includes(32)).length,2);assert.equal(articles.filter(r=>r.values.includes(33)).length,2);
  }
  assert.deepEqual(f.documents('parkedTickets'),retainedBefore);assert.equal(f.documents('transactions').length,0);
 }finally{f.db.close();delete (globalThis as any).__refresh;}
});


for (const changedKey of ['clic_erp_sync_company_id', 'clic_erp_sync_terminal_id', 'clic_erp_sync_tenant_id',
  'CLIC_POS_DEVICE_ID', 'clic_sync_profile', 'clic_terminal_credentials_v1', 'clic_erp_sync_token', 'download-origin']) {
  test(`real setup session rejects ${changedKey} drift inside native CAS before any write`, async () => {
    const f = await fixture();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null } });
    try {
      const { LargeMasterSyncV3OperationalSession: Session } = await sessionModule(f);
      const environment = (globalThis as any).__refresh;
      environment.readGuard = readOperationalTerminalBinding;
      const session = await Session.open(false);
      session.assertSetupIdentity();
      const current = await f.adapter.getCollection<any>('config');
      const projected = await session.projectConfig(current);
      const before = state(f);
      if (changedKey === 'download-origin') environment.origin = 'https://other.invalid';
      else values.set(changedKey, 'changed');
      await assert.rejects(bounded(f.adapter.compareAndSwapV3SetupConfig(current, projected,
        () => session.assertSetupIdentity())), /SYNC_V3_BINDING_CHANGED/);
      assert.deepEqual(state(f), before);
      assert.equal(f.db.inTransaction, false);
    } finally {
      f.db.close(); delete (globalThis as any).__refresh;
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete (globalThis as any).localStorage;
    }
  });
}
