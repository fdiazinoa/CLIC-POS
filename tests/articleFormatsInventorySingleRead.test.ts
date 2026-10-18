import test from 'node:test';
import assert from 'node:assert/strict';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {inventoryFixture,receiptTransport,scope} from './articleFormatsInventoryFixture';
import {nativeFixture,nativeSale,options,id} from './articleFormatsNativeFixture';
import {installInventoryFixtureBinding} from '../services/articleFormats/inventoryJournal';

// Actual Session method + protected native store, with only unrelated application singleton IO isolated.
let sessionModule:Promise<any>|undefined;
async function sessionFor(f:Awaited<ReturnType<typeof nativeFixture>>,baseline:string){
 sessionModule ||= build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3OperationalSession.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':'{}'},plugins:[{name:'single-read-isolated-io',setup(builder){builder.onResolve({filter:/^(\.\.\/db|\.\.\/\.\.\/utils\/db)$/},args=>({path:args.path,namespace:'single-read-fixture'}));builder.onLoad({filter:/.*/,namespace:'single-read-fixture'},args=>({contents:args.path==='../db'?'export const dbAdapter={};':'export const db={};',loader:'js'}));}}]}).then(bundle=>import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`));
 const {LargeMasterSyncV3OperationalSession:Session}=await sessionModule;
 return new Session({},JSON.parse(baseline)[0],f.adapter.masterSyncV3Store,'https://erp.invalid',{});
}
function product(stock=137){return {id:id(7),type:'PRODUCT',isInventoriable:true,stock,stockBalances:{[id(5)]:stock},operationalFlags:{trackInventory:true,allowNegativeStock:false},v3SaleAuthority:{syncId:id(60),syncVersion:32,inventoryVersion:4,inventoryCursor:'inventory-cursor'}};}
async function counted<T>(f:Awaited<ReturnType<typeof nativeFixture>>,work:()=>Promise<T>){const before=f.fault.queries,value=await work();return {value,queries:f.fault.queries-before};}

async function traced<T>(f:Awaited<ReturnType<typeof nativeFixture>>,work:()=>Promise<T>){
 const bridge=(f.adapter as any).db,query=bridge.query.bind(bridge),trace:{sql:string;values:any[]}[]=[];
 bridge.query=async(sql:string,values:any[])=>{trace.push({sql,values:[...values]});return query(sql,values);};
 try{return {...await counted(f,work),trace};}finally{bridge.query=query;}
}
function assertOffBatchTrace(trace:{sql:string;values:any[]}[],baseline:string,itemIds:string[],warehouseId:string){
 assert.equal(trace.length,3,'one V2 probe + one V1 probe + one aggregate SUM for the entire batch');
 assert.match(trace[0].sql,/^SELECT scope,authority_hash,native_baseline,expires_at FROM article_format_inventory_v2_authority WHERE singleton=1$/);
 assert.deepEqual(trace[0].values,[]);
 assert.match(trace[1].sql,/^SELECT \* FROM article_format_inventory_state WHERE baseline_id IS NOT NULL$/);assert.deepEqual(trace[1].values,[]);
 assert.match(trace[2].sql,/SUM\(COALESCE/);assert.match(trace[2].sql,/GROUP BY json_extract\(data, '\$\.productId'\)/);
 assert.ok(trace[2].sql.includes(`IN (${itemIds.map(()=>'?').join(',')})`));
 assert.deepEqual(trace[2].values,[baseline,warehouseId,...itemIds]);
 for(const value of [baseline,warehouseId,...itemIds])assert.ok(!trace[2].sql.includes(value),'scope/item values must remain bound parameters');
}

for(const delta of [0,1.234567,-1.234567])test(`OFF single store and actual Session retain six-decimal delta${delta} with exactly one query`,async()=>{
 const f=await inventoryFixture();try{
  if(delta)f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('inventoryLedger','six-decimal',JSON.stringify({productId:id(7),warehouseId:id(5),v3InventoryBaseline:f.baseline(),qtyIn:Math.max(0,delta),qtyOut:Math.max(0,-delta)}),0,'fixture');
  const s=await sessionFor(f,f.baseline());
  assert.deepEqual(await counted(f,()=>f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.baseline(),id(7),id(5))),{value:delta,queries:1});
  assert.deepEqual(await counted(f,()=>f.adapter.masterSyncV3Store.getOperationalStockProjection(f.baseline(),[id(7)],id(5))),{value:{mode:'LEGACY_DELTA',quantities:{[id(7)]:delta}},queries:1});
  const single=await counted<any>(f,()=>s.withStock(product(),id(5)));assert.equal(single.queries,1);assert.equal(single.value.stock,137+delta);
  // The single-item optimization does not change the batch path or its existing result semantics.
  const batch=await traced(f,()=>f.adapter.masterSyncV3Store.getOperationalStockProjection(f.baseline(),[id(7),id(8)],id(5)));assert.equal(batch.queries,3);assertOffBatchTrace(batch.trace,f.baseline(),[id(7),id(8)],id(5));assert.equal(batch.value.mode,'LEGACY_DELTA');assert.equal(batch.value.quantities[id(7)] || 0,delta);
 }finally{f.db.close();}
});

test('OFF batch API is bounded at1/2/100 items;101 rejects before SQL while dedicated single-item remains one query',async t=>{
 const f=await inventoryFixture();try{
  for(const size of [1,2,100]){
   const itemIds=Array.from({length:size},(_,i)=>id(7+i));
   const result=await traced(f,()=>f.adapter.masterSyncV3Store.getLocalInventoryDeltas(f.baseline(),itemIds,id(5)));
   assert.equal(result.queries,3);assertOffBatchTrace(result.trace,f.baseline(),itemIds,id(5));assert.deepEqual(result.value,{});
   if(size===2)t.diagnostic('OFF_BATCH_SQL_TRACE '+JSON.stringify(result.trace));
  }
  const itemIds=Array.from({length:101},(_,i)=>id(7+i)),before=f.fault.queries;
  await assert.rejects(f.adapter.masterSyncV3Store.getLocalInventoryDeltas(f.baseline(),itemIds,id(5)),/SYNC_V3_QUERY_LIMIT/);
  await assert.rejects(f.adapter.masterSyncV3Store.getOperationalStockProjection(f.baseline(),itemIds,id(5)),/SYNC_V3_QUERY_LIMIT/);assert.equal(f.fault.queries,before);
  assert.deepEqual(await counted(f,()=>f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.baseline(),id(7),id(5))),{value:0,queries:1});
 }finally{f.db.close();}
});

test('combined query is lazy under any selected baseline, without item/scope/warehouse filtering',async()=>{
 const f=await inventoryFixture();try{
  const bridge=(f.adapter as any).db,query=bridge.query.bind(bridge);let recorded:{sql:string;values:any[]}|undefined;
  bridge.query=async(sql:string,values:any[])=>{recorded={sql,values};return query(sql,values);};
  await f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.baseline(),id(7),id(5));assert.ok(recorded);
  const db=new SQLite(':memory:');try{
   db.exec('CREATE TABLE documents(collection_name TEXT,data TEXT);CREATE TABLE article_format_inventory_state(scope_key TEXT,baseline_id TEXT);');
   // The item/warehouse/binding below are unrelated. ANY selected baseline must suppress the legacy scalar SUM.
   db.prepare('INSERT INTO article_format_inventory_state VALUES(?,?)').run(JSON.stringify({warehouse_id:id(999)}),id(1000));
   db.prepare('INSERT INTO documents VALUES(?,?)').run('inventoryLedger','malformed JSON would throw if scanned');
   assert.equal((db.prepare(recorded.sql).get(...recorded.values) as any).delta,null);
   db.exec('DELETE FROM article_format_inventory_state');assert.throws(()=>db.prepare(recorded.sql).get(...recorded.values),/malformed JSON/);
  }finally{db.close();}
 }finally{f.db.close();}
});

test('same native store and actual Session detect OFF→first selected commit, then cell/scope/auth drift cannot fall back',async()=>{
 const f=await inventoryFixture();try{
  const store=f.adapter.masterSyncV3Store,s=await sessionFor(f,f.baseline());
  assert.equal((await counted(f,()=>s.withStock(product(),id(5)))).queries,1);
  await f.posting.post(nativeSale(),options);await f.reservations(id(1000));
  const capture=await f.journal.captureFixture(),mock=await receiptTransport(capture);await f.journal.commitFixture(capture,await mock.download());
  const bridge=(f.adapter as any).db,query=bridge.query.bind(bridge),selectedQueries:string[]=[];bridge.query=async(sql:string,values:any[])=>{selectedQueries.push(sql);return query(sql,values);};
  assert.equal((await store.getOperationalStockProjection(f.baseline(),[id(7)],id(5))).quantities[id(7)],89);assert.equal((await s.withStock(product(),id(5))).stock,89);
  await assert.rejects(store.getOperationalStockProjection(f.baseline(),[id(999)],id(5)),/STOCK_BASELINE_MISSING/);
  await assert.rejects(store.getOperationalStockProjection(f.baseline(),[id(7),id(999)],id(5)),/STOCK_BASELINE_MISSING/);
  await assert.rejects(store.getLocalInventoryDelta(f.baseline(),id(999),id(5)),/STOCK_BASELINE_MISSING/);
  await assert.rejects(store.getOperationalStockProjection(f.baseline(),[id(7)],id(999)),/SCOPE_FORBIDDEN/);
  // A new unselected binding must not make the old selected scope invisible to the combined EXISTS.
  await installInventoryFixtureBinding(f.sql,{scope:{...scope,warehouse_id:id(999)},authorization:'synthetic-foreign'});
  await assert.rejects(store.getOperationalStockProjection(f.baseline(),[id(7)],id(999)),/SCOPE_FORBIDDEN/);
  await f.reservations(id(1000));
  f.db.prepare("UPDATE article_format_network_sessions SET context=json_set(context,'$.return_context.fingerprint',?)").run('b'.repeat(64));
  await assert.rejects(s.withStock(product(),id(5)),/AUTHORITY_CHANGED/);
  await assert.rejects(store.getLocalInventoryDelta(f.baseline(),id(7),id(5)),/AUTHORITY_CHANGED/);
  await assert.rejects(store.getOperationalStockProjection(f.baseline(),[id(7)],id(5)),/AUTHORITY_CHANGED/);
  await assert.rejects(store.getOperationalStockProjection(f.baseline(),[id(7),id(8)],id(5)),/AUTHORITY_CHANGED/);
  assert.ok(!selectedQueries.some(sql=>sql.includes("GROUP BY json_extract(data, '$.productId')")),'selected/drift never falls back to the legacy batch SUM');
 }finally{f.db.close();}
});

test('reopening a selected database detects durable authority immediately and missing proof cannot become legacy',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-single-read-'));const file=join(dir,'pos.sqlite');let open:SQLite.Database|undefined;
 try{
  const f=await inventoryFixture(new SQLite(file));open=f.db;await f.posting.post(nativeSale(),options);await f.reservations(id(1000));
  const capture=await f.journal.captureFixture(),mock=await receiptTransport(capture,{physical:'0.2000'});await f.journal.commitFixture(capture,await mock.download());
  const baseline=f.baseline();f.db.close();const g=await nativeFixture(new SQLite(file),false);open=g.db;
  assert.equal((await g.adapter.masterSyncV3Store.getOperationalStockProjection(baseline,[id(7)],id(5))).quantities[id(7)],0.2);
  const s=await sessionFor(g,baseline);assert.equal((await s.withStock(product(0.3),id(5))).stock,0.2);
  g.db.exec('DROP TABLE article_format_inventory_authorities');await g.sql.executeSchema((await import('../services/articleFormats/inventorySchema')).FORMAT_INVENTORY_SCHEMA);
  await assert.rejects(g.adapter.masterSyncV3Store.getOperationalStockProjection(baseline,[id(7)],id(5)),/AUTHORITY_UNPROVEN/);
 }finally{if(open?.open)open.close();rmSync(dir,{recursive:true,force:true});}
});

test('historical missing-state fallback is exact, never masks bridge/other-table errors, and is not cached after schema migration',async()=>{
 const f=await inventoryFixture();try{
  f.db.exec('DROP TABLE article_format_inventory_state');
  assert.deepEqual(await counted(f,()=>f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.baseline(),id(7),id(5))),{value:0,queries:2});
  await f.journal.migrate();assert.deepEqual(await counted(f,()=>f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.baseline(),id(7),id(5))),{value:0,queries:1});
  const bridge=(f.adapter as any).db,query=bridge.query.bind(bridge);
  for(const message of ['bridge-failed','no such table: documents','no such table: article_format_inventory_state invalid-suffix']){
   let calls=0;bridge.query=async()=>{calls++;throw Error(message);};await assert.rejects(f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.baseline(),id(7),id(5)),error=>error instanceof Error&&error.message===message);assert.equal(calls,1);
  }
  bridge.query=query;
 }finally{f.db.close();}
});
