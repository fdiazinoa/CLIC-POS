import test from 'node:test';
import assert from 'node:assert/strict';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeFixture,nativeSale,options,id} from './articleFormatsNativeFixture';
import {inventoryFixture,receiptTransport,scope} from './articleFormatsInventoryFixture';
import {installInventoryFixtureBinding} from '../services/articleFormats/inventoryJournal';
import {INVENTORY_POOL_INDEX_SQL,INVENTORY_POOL_USE_TABLES,reconcileInventoryPoolIndex} from '../services/articleFormats/inventoryPoolIndex';
import {readV3Base4Stock} from '../services/db/V3Base4Stock';
const name='article_format_inventory_document_pool';
const index=(db:SQLite.Database)=>db.prepare('SELECT name,sql FROM sqlite_master WHERE name=?').get(name);
const init=(f:Awaited<ReturnType<typeof nativeFixture>>)=>(f.adapter as any).initSchema();
function snapshot(db:SQLite.Database){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r:any)=>[r.name,db.prepare(`SELECT * FROM "${r.name}" ORDER BY rowid`).all()]);}
async function stable(f:Awaited<ReturnType<typeof nativeFixture>>){await init(f);return snapshot(f.db);}
const binding={scope,authorization:'synthetic-fixture-auth-v1'};

test('actual native pre-WIRE initialization and financial migration keep closed pool absent, retire inherited unused index and reopen',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-pool-')),file=join(dir,'pos.sqlite');let f:Awaited<ReturnType<typeof nativeFixture>>|undefined;
 try{
  f=await nativeFixture(new SQLite(file));assert.equal(index(f.db),undefined);const before=await stable(f);f.db.exec(INVENTORY_POOL_INDEX_SQL);
  await init(f);assert.equal(index(f.db),undefined);assert.deepEqual(snapshot(f.db),before);await f.posting.migrate();assert.equal(index(f.db),undefined);
  f.db.exec(INVENTORY_POOL_INDEX_SQL);await f.posting.migrate();assert.equal(index(f.db),undefined);assert.deepEqual(snapshot(f.db),before);
  // WIRE is legitimately absent at native init, before the first financial migration.
  f.db.exec('DROP TABLE article_format_wire_events');await init(f);assert.equal(index(f.db),undefined);await f.posting.migrate();assert.deepEqual(snapshot(f.db),before);
  f.db.close();f=await nativeFixture(new SQLite(file),false);await init(f);await f.posting.migrate();assert.equal(index(f.db),undefined);assert.deepEqual(snapshot(f.db),before);
  assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE name='idx_documents_v3_inventory_baseline'").get());assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='idx_documents_v3_inventory_delta_cover'").get(),undefined);
  t.diagnostic('Actual initSchema and posting.migrate; old V3 prefix retained, no pool/cover on closed channel.');
 }finally{if(f?.db.open)f.db.close();rmSync(dir,{recursive:true,force:true});}
});

for(const table of [...INVENTORY_POOL_USE_TABLES,'article_format_wire_events'])test(`any global durable row retains/ensures pool: ${table}`,async()=>{
 const f=await nativeFixture();try{
  await stable(f);const columns=f.db.prepare(`PRAGMA table_info('${table}')`).all() as any[];
  const fields=columns.filter(c=>c.notnull||c.pk),values=fields.map(c=>c.name==='content'?'{}':c.name==='kind'?'SALE':c.name==='state'?'ACKED':c.name==='singleton'?1:c.type==='INTEGER'?1:'synthetic-unselected-history');
  f.db.pragma('foreign_keys=OFF');f.db.prepare(`INSERT INTO ${table}(${fields.map(c=>c.name).join(',')}) VALUES(${fields.map(()=>'?').join(',')})`).run(...values);f.db.pragma('foreign_keys=ON');
  const before=snapshot(f.db);await init(f);assert.ok(index(f.db));assert.deepEqual(snapshot(f.db),before);await f.posting.migrate();assert.ok(index(f.db));assert.deepEqual(snapshot(f.db),before);
 }finally{f.db.close();}
});

for(const point of ['create','during-create','after-create','binding-write','precommit','lost-commit'] as const)test(`first trusted binding atomicity ${point}`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-pool-bind-')),file=join(dir,'pos.sqlite');let f:Awaited<ReturnType<typeof nativeFixture>>|undefined;
 try{
  f=await nativeFixture(new SQLite(file));await stable(f);if(point==='during-create')f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('inventoryLedger','create-scan',JSON.stringify({warehouseId:id(5),productId:id(7),qtyIn:1}),0,'fixture');const before=snapshot(f.db),bridge=(f.adapter as any).db,execute=bridge.execute.bind(bridge),run=bridge.run.bind(bridge);
  bridge.execute=async(sql:string,transaction=true)=>{if(sql===INVENTORY_POOL_INDEX_SQL){assert.equal(transaction,false);assert.equal(f!.db.inTransaction,true);if(point==='create')throw Error('injected-create');await execute(sql,transaction);if(point==='after-create')throw Error('injected-after-create');return {changes:{changes:0}};}return execute(sql,transaction);};
  if(point==='during-create')f.db.function('json_extract',{deterministic:true},(text:unknown,path:unknown)=>{if(path==='$.warehouseId')throw Error('injected-index-expression');return JSON.parse(String(text))[String(path).slice(2)] ?? null;});
  if(point==='binding-write')bridge.run=async(sql:string,values:any[],transaction:boolean)=>{if(sql.startsWith('INSERT INTO article_format_inventory_binding'))throw Error('injected-binding');return run(sql,values,transaction);};
  if(point==='precommit')f.fault.failBeforeCommit=true;if(point==='lost-commit')f.fault.loseCommitResponse=true;
  await assert.rejects(installInventoryFixtureBinding(f.sql,binding),point==='lost-commit'?/COMMIT_UNCERTAIN/:/injected-/);
  assert.equal(f.db.inTransaction,false);
  if(point==='lost-commit'){assert.ok(index(f.db));assert.equal((f.db.prepare('SELECT count(*) n FROM article_format_inventory_binding').get() as any).n,1);}else{assert.equal(index(f.db),undefined);assert.deepEqual(snapshot(f.db),before);}
  f.db.close();f=await nativeFixture(new SQLite(file),false);await init(f);if(point==='lost-commit')assert.ok(index(f.db));else{assert.equal(index(f.db),undefined);assert.deepEqual(snapshot(f.db),before);}
 }finally{if(f?.db.open)f.db.close();rmSync(dir,{recursive:true,force:true});}
});

for(const point of ['usage','before-drop','after-drop','precommit','lost-commit'] as const)test(`unused inherited cleanup atomicity ${point}`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-pool-drop-')),file=join(dir,'pos.sqlite');let f:Awaited<ReturnType<typeof nativeFixture>>|undefined;
 try{
  f=await nativeFixture(new SQLite(file));const before=await stable(f);f.db.exec(INVENTORY_POOL_INDEX_SQL);const bridge=(f.adapter as any).db,execute=bridge.execute.bind(bridge),query=bridge.query.bind(bridge);
  if(point==='usage')bridge.query=async(sql:string,values:any[])=>{if(sql.includes(' AS used'))throw Error('injected-usage');return query(sql,values);};
  bridge.execute=async(sql:string,transaction=true)=>{if(sql.startsWith('DROP INDEX article_format_inventory_document_pool')){assert.equal(transaction,false);assert.equal(f!.db.inTransaction,true);if(point==='before-drop')throw Error('injected-drop');await execute(sql,transaction);if(point==='after-drop')throw Error('injected-after-drop');return {changes:{changes:0}};}return execute(sql,transaction);};
  if(point==='precommit')f.fault.failBeforeCommit=true;if(point==='lost-commit')f.fault.loseCommitResponse=true;
  await assert.rejects(init(f),point==='lost-commit'?/COMMIT_UNCERTAIN/:/injected-/);assert.equal((f.adapter as any).isReady,false);assert.equal(f.db.inTransaction,false);assert.deepEqual(snapshot(f.db),before);assert.equal(Boolean(index(f.db)),point!=='lost-commit');
  f.db.close();f=await nativeFixture(new SQLite(file),false);await init(f);assert.equal(index(f.db),undefined);assert.deepEqual(snapshot(f.db),before);
 }finally{if(f?.db.open)f.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('wrong literal identity, missing mandatory table and missing post-WIRE table fail closed; legacy port stays untouched',async()=>{
 const f=await nativeFixture();try{
  await stable(f);f.db.exec(INVENTORY_POOL_INDEX_SQL.replace("'inventoryLedger'","'inventory Ledger'"));const before=snapshot(f.db),prior=index(f.db);await assert.rejects(init(f),/POOL_INDEX_INVALID/);assert.deepEqual(index(f.db),prior);assert.deepEqual(snapshot(f.db),before);
  f.db.exec(`DROP INDEX ${name};DROP TABLE article_format_inventory_staging`);await assert.rejects(f.sql.runFinancial!(tx=>reconcileInventoryPoolIndex(tx,true)),/SCHEMA_INCOMPLETE/);
  await init(f);f.db.exec('DROP TABLE article_format_wire_events');await assert.rejects(f.sql.runFinancial!(tx=>reconcileInventoryPoolIndex(tx,true)),/SCHEMA_INCOMPLETE/);
  await reconcileInventoryPoolIndex({executeAtomic:async()=>{throw Error('unexpected');},executeSchema:async()=>{throw Error('unexpected');},query:async()=>{throw Error('unexpected');}},true);
 }finally{f.db.close();}
});

test('cleanup versus first binding shares one owner and excludes second file writer; durable binding keeps index',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-pool-race-')),file=join(dir,'pos.sqlite');let f:Awaited<ReturnType<typeof nativeFixture>>|undefined;
 try{
  f=await nativeFixture(new SQLite(file));await stable(f);f.db.exec(INVENTORY_POOL_INDEX_SQL);const bridge=(f.adapter as any).db,query=bridge.query.bind(bridge);let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),start=new Promise<void>(r=>entered=r);
  bridge.query=async(sql:string,values:any[])=>{if(sql.includes(' AS used')){entered();await held;}return query(sql,values);};
  const cleanup=f.sql.runFinancial!(tx=>reconcileInventoryPoolIndex(tx,true));await start;const other=new SQLite(file,{timeout:0});try{assert.throws(()=>other.exec('BEGIN IMMEDIATE'),/locked/);}finally{other.close();}
  const bind=installInventoryFixtureBinding(f.sql,binding);release();await Promise.all([cleanup,bind]);assert.ok(index(f.db));await init(f);await f.posting.migrate();assert.ok(index(f.db));
 }finally{if(f?.db.open)f.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('selected receipt remains89 after file reopen, actual guard uses pool and native writer remains blocked',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-pool-active-')),file=join(dir,'pos.sqlite');let opened:SQLite.Database|undefined;
 try{
  const f=await inventoryFixture(new SQLite(file));opened=f.db;
  await f.posting.post(nativeSale(),options);await f.reservations(id(1000));const captured=await f.journal.captureFixture(),mock=await receiptTransport(captured);await f.journal.commitFixture(captured,await mock.download());
  await init(f);const key=f.baseline(),before=snapshot(f.db);f.db.close();
  const restored=await nativeFixture(new SQLite(file),false);opened=restored.db;await init(restored);await restored.posting.migrate();assert.ok(index(restored.db));assert.deepEqual(snapshot(restored.db),before);
  const bridge=(restored.adapter as any).db,query=bridge.query.bind(bridge);let guard:{sql:string;values:any[]}|undefined;
  bridge.query=async(sql:string,values:any[])=>{if(sql.startsWith('SELECT doc_id FROM documents d WHERE'))guard={sql,values};return query(sql,values);};
  assert.equal((await restored.adapter.masterSyncV3Store.getOperationalStockProjection(key,[id(7)],id(5))).quantities[id(7)],89);assert.ok(guard);
  const plan=restored.db.prepare('EXPLAIN QUERY PLAN '+guard.sql).all(...guard.values) as any[];assert.ok(plan.some(p=>p.detail.includes(name)));
  await assert.rejects(restored.sql.runFinancial!(tx=>tx.assertFinancialDocuments!([{collectionName:'transactions',document:{id:id(800),v3InventoryBaseline:key,v3Binding:JSON.parse(key)[0],v3WarehouseId:id(5)},v3StockRequirements:[{baseline:key,productId:id(7),warehouseId:id(5),quantity:1}]}])),/UNSUPPORTED_WRITER/);
 }finally{if(opened?.open)opened.close();rmSync(dir,{recursive:true,force:true});}
});

test('closed channel retains exact historical floating boundaries and BASE4 20000 cancellation without cover/sort',async()=>{
 for(const e of [{v:[.000001,-.000003,.000016,-99999999999,99999999999],q:.000014,raw:.000014,accept:true},{v:[.000007,-.000012,99999999999,.000010,-99999999999],q:.000005,raw:.0000049999999999999996,accept:false}]){
  const f=await nativeFixture();try{
   f.db.prepare('UPDATE master_v3_inventory_balances SET qty_on_hand=0').run();const inv=f.db.prepare('SELECT * FROM master_v3_inventory_state').get() as any,owner=f.db.prepare('SELECT binding FROM master_v3_operational_owner').get() as any,key=JSON.stringify([owner.binding,inv.sync_id,inv.sync_version,inv.inventory_version,inv.cursor]);
   const insert=f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)');e.v.forEach((v,i)=>insert.run('inventoryLedger',`raw-${i}`,JSON.stringify({productId:id(7),warehouseId:id(5),v3InventoryBaseline:key,qtyIn:Math.max(0,v),qtyOut:Math.max(0,-v)}),0,'fixture'));
   assert.equal(await f.adapter.masterSyncV3Store.getLocalInventoryDelta(key,id(7),id(5)),e.raw);const run=()=>f.sql.runFinancial!(tx=>tx.assertFinancialDocuments!([{collectionName:'transactions',document:{id:id(800),v3InventoryBaseline:key,v3Binding:owner.binding,v3WarehouseId:id(5)},v3StockRequirements:[{baseline:key,productId:id(7),warehouseId:id(5),quantity:e.q}]}]));if(e.accept)await run();else await assert.rejects(run(),/INSUFFICIENT/);
  }finally{f.db.close();}
 }
 const f=await nativeFixture();try{
  const inv=f.db.prepare('SELECT * FROM master_v3_inventory_state').get() as any,owner=f.db.prepare('SELECT binding FROM master_v3_operational_owner').get() as any,key=JSON.stringify([owner.binding,inv.sync_id,inv.sync_version,inv.inventory_version,inv.cursor]),insert=f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)');
  f.db.transaction(()=>{for(let i=0;i<20000;i++)insert.run('inventoryLedger',`base4-${i}`,JSON.stringify({productId:id(7),warehouseId:id(5),v3InventoryBaseline:key,qtyIn:i%2===0?99999999999.9999:0,qtyOut:i%2===1?99999999999.9999:0}),0,'fixture');})();
  assert.equal((await f.sql.runFinancial!(tx=>readV3Base4Stock(tx.query,key,id(7),id(5)))).available.toFixed(4),'137.0000');assert.equal(index(f.db),undefined);
 }finally{f.db.close();}
});
