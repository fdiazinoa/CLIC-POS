import test from 'node:test';
import assert from 'node:assert/strict';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Capacitor} from '@capacitor/core';
import {nativeFixture,nativeSale,options,id} from './articleFormatsNativeFixture';
import {legacyInventoryIndexSQL,originalInventoryIndex} from './formatsInactiveStockIndexFixture';
const cover='idx_documents_v3_inventory_delta_cover',old='idx_documents_v3_inventory_baseline';
type Fixture=Awaited<ReturnType<typeof nativeFixture>>;
const migrate=(f:Fixture)=>(f.adapter as any).initSchema() as Promise<void>;
function indexes(db:SQLite.Database){return db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND name IN (?,?) ORDER BY name").all(old,cover);}
function rows(db:SQLite.Database){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r:any)=>[r.name,db.prepare(`SELECT * FROM "${r.name.replaceAll('"','""')}" ORDER BY rowid`).all()]);}
function state(f:Fixture,kind:string){if(kind==='old-only')originalInventoryIndex(f.db);if(kind==='both')f.db.exec(legacyInventoryIndexSQL);if(kind==='empty')f.db.exec(`DROP INDEX ${cover}`);}
function seed(f:Fixture){f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('inventoryLedger','replacement-retained',JSON.stringify({productId:id(7),warehouseId:id(5),v3InventoryBaseline:'synthetic',qtyIn:1.234567,qtyOut:0}),0,'fixture');}

for(const kind of ['old-only','both','cover-only','empty'])test(`tracked replacement from ${kind} preserves all tables and reopens idempotently`,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-replace-')),file=join(dir,'pos.sqlite');let f:Fixture|undefined;
 try{
  f=await nativeFixture(new SQLite(file));await migrate(f);await f.posting.post(nativeSale(),options);seed(f);state(f,kind);const before=rows(f.db),bridge=(f.adapter as any).db,events:string[]=[];
  const execute=bridge.execute.bind(bridge),begin=bridge.beginTransaction.bind(bridge),commit=bridge.commitTransaction.bind(bridge);
  bridge.beginTransaction=async()=>{events.push('BEGIN');return begin();};bridge.commitTransaction=async()=>{events.push('COMMIT');return commit();};
  bridge.execute=async(sql:string,transaction=true)=>{if(sql.includes(`CREATE INDEX IF NOT EXISTS ${cover}`)||sql.includes(`DROP INDEX IF EXISTS ${old}`)){assert.equal(transaction,false);assert.equal(f!.db.inTransaction,true);events.push(sql.includes('DROP INDEX')?'DROP':'CREATE');}return execute(sql,transaction);};
  await migrate(f);assert.deepEqual(events,['BEGIN','CREATE','DROP','COMMIT']);assert.deepEqual(rows(f.db),before);assert.deepEqual(indexes(f.db).map((r:any)=>r.name),[cover]);
  events.length=0;await migrate(f);assert.deepEqual(events,['BEGIN','CREATE','DROP','COMMIT']);assert.deepEqual(rows(f.db),before);
  t.diagnostic(JSON.stringify({kind,events,engine:f.db.prepare('SELECT sqlite_version() version').get()}));
  f.db.close();f=await nativeFixture(new SQLite(file),false);await migrate(f);assert.deepEqual(rows(f.db),before);assert.deepEqual(indexes(f.db).map((r:any)=>r.name),[cover]);
 }finally{if(f?.db.open)f.db.close();rmSync(dir,{recursive:true,force:true});}
});

for(const kind of ['old-only','both','cover-only'])for(const point of ['before-create','after-create','verify','before-drop','after-drop','before-commit','lost-commit'] as const)test(`replacement ${kind}/${point} rejects startup, retains transaction outcome and safely reopens`,async t=>{
 t.mock.method(Capacitor,'isNativePlatform',()=>true);t.mock.method(Capacitor,'getPlatform',()=> 'android');
 const dir=mkdtempSync(join(tmpdir(),'clic-replace-fault-')),file=join(dir,'pos.sqlite');let f:Fixture|undefined;
 try{
  f=await nativeFixture(new SQLite(file));await migrate(f);seed(f);state(f,kind);const before=rows(f.db),prior=indexes(f.db),bridge=(f.adapter as any).db,execute=bridge.execute.bind(bridge),query=bridge.query.bind(bridge);let dropped=false,closed=0;
  bridge.execute=async(sql:string,transaction=true)=>{
   const create=sql.includes(`CREATE INDEX IF NOT EXISTS ${cover}`),drop=sql.includes(`DROP INDEX IF EXISTS ${old}`);
   if((point==='before-create'&&create)||(point==='before-drop'&&drop))throw Error(`injected-${point}`);
   const result=await execute(sql,transaction);if(drop)dropped=true;
   if((point==='after-create'&&create)||(point==='after-drop'&&drop))throw Error(`injected-${point}`);return result;
  };
  bridge.query=async(sql:string,params:any[])=>{if(point==='verify'&&sql.startsWith('PRAGMA index_xinfo'))return {values:[]};return query(sql,params);};
  if(point==='before-commit')f.fault.failBeforeCommit=true;if(point==='lost-commit')f.fault.loseCommitResponse=true;
  bridge.isDBOpen=async()=>({result:true});
  class Manager{async checkConnectionsConsistency(){return {result:false};}async isConnection(){return {result:false};}async createConnection(){return bridge;}async closeConnection(){closed++;}}
  Object.assign(f.adapter,{loadSQLiteBridge:async()=>({CapacitorSQLite:{},SQLiteConnection:Manager})});
  await assert.rejects(f.adapter.connect(),point==='verify'?/COVER_INDEX_INVALID/:point==='lost-commit'?/COMMIT_UNCERTAIN/:/injected-/);
  assert.equal((f.adapter as any).isReady,false);assert.equal(closed,1);assert.equal(f.db.inTransaction,false);assert.deepEqual(rows(f.db),before);
  if(point!=='lost-commit')assert.deepEqual(indexes(f.db),prior);
  if(point==='lost-commit')assert.deepEqual(indexes(f.db).map((r:any)=>r.name),[cover]);
  if(point==='verify'||point==='before-create'||point==='after-create'||point==='before-drop')assert.equal(dropped,false);
  f.db.close();f=await nativeFixture(new SQLite(file),false);await migrate(f);assert.deepEqual(rows(f.db),before);assert.deepEqual(indexes(f.db).map((r:any)=>r.name),[cover]);
 }finally{if(f?.db.open)f.db.close();rmSync(dir,{recursive:true,force:true});}
});

for(const definition of [
 `ON documents(doc_id)`,
 `ON storage_meta(key)`,
 `ON documents(json_extract(data,'$.v3InventoryBaseline'),json_extract(data,'$.warehouseId'),json_extract(data,'$.productId'),COALESCE(json_extract(data,'$.qtyIn'),0)-COALESCE(json_extract(data,'$.qtyOut'),0)) WHERE collection_name='inventoryLedger' AND json_extract(data,'$.v3InventoryBaseline') IS NOT NULL`,
 `ON documents(json_extract(data,'$.v3InventoryBaseline'),json_extract(data,'$.productId'),json_extract(data,'$.warehouseId'),COALESCE(json_extract(data,'$.qtyIn'),0)-COALESCE(json_extract(data,'$.qtyOut'),0)) WHERE collection_name='inventoryLedger'`,
])test(`wrong same-name cover rejects before old index removal: ${definition.slice(0,35)}`,async()=>{
 const f=await nativeFixture();try{seed(f);originalInventoryIndex(f.db);f.db.exec(`CREATE INDEX ${cover} ${definition}`);const prior=indexes(f.db),before=rows(f.db);await assert.rejects(migrate(f),/COVER_INDEX_INVALID/);assert.deepEqual(indexes(f.db),prior);assert.deepEqual(rows(f.db),before);assert.equal((f.adapter as any).isReady,false);}finally{f.db.close();}
});

test('clean native schema creates only cover, and validation transport failure cannot drop the prefix',async()=>{
 const f=await nativeFixture();try{
  assert.deepEqual(indexes(f.db).map((r:any)=>r.name),[cover]);f.db.exec(legacyInventoryIndexSQL);
  const bridge=(f.adapter as any).db,query=bridge.query.bind(bridge),prior=indexes(f.db);
  bridge.query=async(sql:string,values:any[])=>{if(sql.startsWith("PRAGMA index_list"))throw Error('validation-bridge-failed');return query(sql,values);};
  await assert.rejects(migrate(f),/validation-bridge-failed/);assert.deepEqual(indexes(f.db),prior);
 }finally{f.db.close();}
});


test('wrong same-name legacy index is retained and migration fails closed before DROP',async()=>{
 const f=await nativeFixture();try{
  f.db.exec(`CREATE INDEX ${old} ON storage_meta(key)`);const prior=indexes(f.db),before=rows(f.db);
  await assert.rejects(migrate(f),/LEGACY_INDEX_INVALID/);assert.deepEqual(indexes(f.db),prior);assert.deepEqual(rows(f.db),before);assert.equal((f.adapter as any).isReady,false);
 }finally{f.db.close();}
});


for(const [label,from,to] of [
 ['predicate whitespace',"'inventoryLedger'","'inventory Ledger'"],
 ['JSON path whitespace',"'$.v3InventoryBaseline'","'$.v3Inventory Baseline'"],
 ['literal case',"'inventoryLedger'","'InventoryLedger'"],
 ['escaped quote',"'inventoryLedger'","'inventory''Ledger'"],
])for(const target of [cover,old])test(`${target} exact literal identity rejects ${label} and preserves old schema/data`,async()=>{
 const f=await nativeFixture();try{
  await migrate(f);seed(f);const coverSQL=(f.db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(cover) as {sql:string}).sql;
  originalInventoryIndex(f.db);
  if(target===old)f.db.exec(`DROP INDEX ${old}`);
  f.db.exec((target===cover?coverSQL:legacyInventoryIndexSQL).replaceAll(from,to));
  const prior=indexes(f.db),before=rows(f.db);
  await assert.rejects(migrate(f),target===cover?/COVER_INDEX_INVALID/:/LEGACY_INDEX_INVALID/);
  assert.deepEqual(indexes(f.db),prior);assert.deepEqual(rows(f.db),before);assert.equal((f.adapter as any).isReady,false);
 }finally{f.db.close();}
});

test('known native DDL admits formatting outside literals without changing identity',async()=>{
 const f=await nativeFixture();try{
  await migrate(f);const coverSQL=(f.db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(cover) as {sql:string}).sql;
  originalInventoryIndex(f.db);f.db.exec(coverSQL.replace(/\n\s+/g,' ').replaceAll("json_extract(data, '","json_extract(data,'"));
  const before=rows(f.db);await migrate(f);assert.deepEqual(indexes(f.db).map((r:any)=>r.name),[cover]);assert.deepEqual(rows(f.db),before);
 }finally{f.db.close();}
});
