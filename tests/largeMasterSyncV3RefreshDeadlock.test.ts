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
 sessionBundle ||= build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3OperationalSession.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env':'{}'},plugins:[{name:'native-refresh-environment',setup(b){b.onResolve({filter:/^(\.\.\/db|\.\.\/\.\.\/utils\/db|\.\/LargeMasterSyncV3(?:Platform|Authority|Candidate|BoundTransport|DownloadOrigin)|\.\/OperationalTerminalConfig)$/},a=>({path:a.path,namespace:'refresh'}));b.onLoad({filter:/.*/,namespace:'refresh'},a=>({loader:'js',contents:a.path==='../db'?'export const dbAdapter=new Proxy({}, {get:(_t,k)=>{const a=globalThis.__refresh.adapter;return typeof a[k]==="function"?a[k].bind(a):a[k];}});':a.path==='../../utils/db'?'export const db={get:()=>globalThis.__refresh.adapter.getCollection("config")};':a.path.endsWith('Platform')?'export const assertLargeMasterSyncV3NativeAndroid=()=>{};':a.path.endsWith('Authority')?'export const LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED=true;':a.path.endsWith('Candidate')?'export const prepareLargeMasterSyncV3CatalogOnly=(...a)=>globalThis.__refresh.refresh(...a);export const prepareLargeMasterSyncV3Candidate=()=>{throw Error("unexpected fresh download")};export const prepareLargeMasterSyncV3UnusedBaseline=()=>{throw Error("unexpected baseline replacement")};':a.path.endsWith('BoundTransport')?'export const readLargeMasterSyncV3BoundIdentity=()=>globalThis.__refresh.identity;':a.path.endsWith('DownloadOrigin')?'export const largeMasterSyncV3DownloadOrigin=()=>globalThis.__refresh.origin;':'export const readOperationalTerminalBinding=()=>globalThis.__refresh.guard;'}));}}]}).then(r=>import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64')));
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

test('production financial builder with real Session invoices sparse-zero negative policy and replays one ledger/payment event',async()=>{
 const f=await fixture();const previousWindow=(globalThis as any).window;try{
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
  const invoice={id:id(900),documentType:'TICKET',displayId:'SYNTHETIC-900',date:'2026-10-15T00:00:00Z',terminalId:id(4),status:'COMPLETED',total:45,netAmount:45,taxAmount:0,userId:id(25),userName:'Synthetic',items:[{...item,cartId:'synthetic-full-invoice',quantity:1,netAmount:45,taxAmount:0,totalAmount:45}],payments:[{id:id(901),method:'CASH',amount:45,timestamp:'2026-10-15T00:00:00Z'}]};
  const result=await module.persistV3FinancialTransaction(invoice,f.config,warehouse);assert.equal(result.created,true);assert.equal((await module.persistV3FinancialTransaction(invoice,f.config,warehouse)).created,false);
  assert.equal(f.documents('inventoryLedger').length,1);assert.equal(f.documents('inventoryLedger')[0].qtyOut,1);assert.equal(f.documents('transactions')[0].payments.length,1);assert.equal(f.documents('transactionHistory').length,1);
  assert.deepEqual((f.db.prepare('SELECT event_type FROM sync_outbox_v2 ORDER BY local_sequence').all() as any[]).map(r=>r.event_type),['SALE_POSTED','PAYMENT_POSTED']);
 }finally{f.db.close();delete (globalThis as any).__refresh;delete (globalThis as any).__invoice;(globalThis as any).window=previousWindow;}
});
