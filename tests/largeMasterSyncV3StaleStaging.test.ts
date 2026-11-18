import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LargeMasterSyncV3Client } from '../services/sync/LargeMasterSyncV3Client';
import { prepareLargeMasterSyncV3CatalogOnly } from '../services/sync/LargeMasterSyncV3Candidate';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import { LargeMasterSyncV3SqliteStore } from '../services/db/LargeMasterSyncV3SqliteStore';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL } from '../services/db/LargeMasterSyncV3Schema';
import type { LargeMasterSyncV3Manifest, LargeMasterSyncV3RuntimeVersion, LargeMasterSyncV3Store, LargeMasterSyncV3StagingReplacement } from '../services/sync/LargeMasterSyncV3Types';
import type { LargeMasterSyncV3Runtime } from '../services/sync/LargeMasterSyncV3Runtime';

const active={syncId:'ACTIVE',syncVersion:21419,contractVersion:2};
const pending={syncId:'PENDING',syncVersion:23135,status:'VALIDATED'};
const target={syncId:'CORRECTED',syncVersion:23956,contractVersion:2};
function manifest(version:LargeMasterSyncV3RuntimeVersion=target):LargeMasterSyncV3Manifest {
 return {syncId:version.syncId,syncVersion:version.syncVersion,schemaVersion:3,contractVersion:2,createdAt:'2026',datasets:Object.fromEntries(['articles','taxes','tariffs','variants','barcodes','prices'].map(key=>[key,key==='articles'&&version.syncId===pending.syncId?{count:1,chunks:1,bytes:10,gzipBytes:10,checksum:'old-hash'}:{count:0,chunks:0,bytes:0,gzipBytes:0,checksum:null}]))} as LargeMasterSyncV3Manifest;
}
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);sql.exec('CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,PRIMARY KEY(collection_name,doc_id));');
 let fault='';
 const bridge={query:async(q:string,p:any[]=[])=>({values:sql.prepare(q).all(...p)}),run:async(q:string,p:any[]=[])=>{const value=sql.prepare(q).run(...p);if(fault==='mutate-staging-version'&&q.includes('UPDATE master_v3_state SET staging_version'))sql.exec('UPDATE master_v3_state SET staging_version=999');if(fault&&q.includes(fault))throw Error('disk fault');return value;},execute:async(q:string)=>{sql.exec(q);}};
 let tail:Promise<unknown>=Promise.resolve();const lock=<T>(work:()=>Promise<T>)=>{const value=tail.then(work);tail=value.catch(()=>{});return value;};
 const store=new LargeMasterSyncV3SqliteStore(()=>bridge,lock);
 const article={id:'MEBL02',name:'Eyeliner',type:'PRODUCT',inventoriable:true,uom:'UN',taxable:false,taxIds:[],active:true,sellable:true,activeWarehouseIds:['W'],operationalFlags:{trackInventory:true}};
 const stageData=(v:LargeMasterSyncV3RuntimeVersion,inventoriable=true)=>{
  const a={...article,inventoriable};sql.prepare('INSERT INTO master_v3_articles(sync_version,article_id,sku,description,article_type,uom,taxable,tax_ids_json,active,sellable,record_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(v.syncVersion,'MEBL02','MEBL02','Eyeliner','PRODUCT','UN',0,'[]',1,1,JSON.stringify(a));
  sql.prepare('INSERT INTO master_v3_tariffs(sync_version,tariff_id,active,record_json) VALUES(?,?,1,?)').run(v.syncVersion,'T',JSON.stringify({id:'T',taxIncluded:false,active:true}));
  sql.prepare('INSERT INTO master_v3_prices VALUES(?,?,?,?)').run(v.syncVersion,'MEBL02','T',v.syncVersion===21419?250:300);
  if(v.syncVersion===target.syncVersion)sql.prepare("INSERT INTO master_v3_articles(sync_version,article_id,sku,description,article_type,uom,taxable,tax_ids_json,active,sellable,record_json) VALUES(?,'LGFR04','LGFR04','Nuevo','PRODUCT','UN',0,'[]',1,1,?)").run(v.syncVersion,JSON.stringify({...article,id:'LGFR04'}));
 };
 sql.prepare("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES(?,?,3,2,'ACTIVE',?,'2020','2020')").run(active.syncId,active.syncVersion,JSON.stringify(manifest(active)));
 stageData(active);sql.prepare('UPDATE master_v3_state SET active_sync_id=?,active_version=? WHERE singleton=1').run(active.syncId,active.syncVersion);
 sql.prepare('INSERT INTO master_v3_operational_owner VALUES(1,?,?,?)').run(active.syncId,active.syncVersion,'binding');sql.prepare("INSERT INTO master_v3_inventory_state VALUES(1,?,?,4,'CURSOR','now')").run(active.syncId,active.syncVersion);
 sql.exec("INSERT INTO master_v3_inventory_balances VALUES('MEBL02','W',100,2,1,'now');INSERT INTO documents VALUES('transactions','SALE','{\"id\":\"SALE\",\"total\":250}');INSERT INTO documents VALUES('inventoryLedger','MOVE','{\"id\":\"MOVE\",\"qtyOut\":1}');");
 sql.prepare("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES(?,?,3,2,'VALIDATED',?,'2021','2021')").run(pending.syncId,pending.syncVersion,JSON.stringify(manifest(pending)));
 stageData(pending,false);sql.prepare('UPDATE master_v3_state SET staging_sync_id=?,staging_version=? WHERE singleton=1').run(pending.syncId,pending.syncVersion);
 sql.prepare("INSERT INTO sync_v3_dataset_progress VALUES(?,'articles',1,1,'old-hash',1,1,'VALIDATED','old')").run(pending.syncId);
 sql.prepare("INSERT INTO sync_v3_chunks(sync_id,dataset,chunk_index,checksum,record_count,raw_bytes,status,applied_at) VALUES(?,'articles',0,'old-hash',1,10,'APPLIED','old')").run(pending.syncId);
 const transition=async()=>({binding:'binding',expectedCatalog:active,inventory:(await store.getInventoryAuthority())!,assertIdentity:()=>{}});
 const snapshot=()=>JSON.stringify(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>[row.name,sql.prepare(`SELECT * FROM "${row.name}"`).all()]));
 return {sql,bridge,store,stageData,transition,snapshot,fault:(value:string)=>{fault=value;}};
}
const rows=(f:ReturnType<typeof fixture>,table:string)=>JSON.stringify(f.sql.prepare(`SELECT * FROM ${table}`).all());
function dependencies(f:ReturnType<typeof fixture>,requested:LargeMasterSyncV3RuntimeVersion=target,downloaded=requested){
 const calls:string[]=[];
 return {calls,options:{enabled:true,assertPlatform:()=>{},waitForOperationalWindow:async()=>0,fetchInventory:async()=>{throw Error('inventory must never be requested');},openRuntime:async()=>({version:await f.store.getActiveRuntimeVersion()}) as LargeMasterSyncV3Runtime,
 createClient:(scoped:LargeMasterSyncV3Store)=>({requestSync:async()=>{calls.push('request');return {...requested,schemaVersion:3,status:'READY',manifestUrl:'manifest'};},resumeSync:async(id:string)=>{calls.push('resume:'+id);await scoped.prepare(manifest(downloaded));if(!(await scoped.readProgress(id))||id===active.syncId)throw Error('unexpected');if(!f.sql.prepare('SELECT article_id FROM master_v3_articles WHERE sync_version=?').get(downloaded.syncVersion))f.stageData(downloaded);f.sql.prepare("UPDATE sync_v3_sessions SET status='VALIDATED' WHERE sync_id=?").run(id);await scoped.activate(id);return downloaded;}})}};
}

test('latest corrected catalog supersedes incompatible pending atomically and preserves all operational data',async()=>{
 const f=fixture();try{
  const preserved=['documents','master_v3_inventory_state','master_v3_inventory_balances'].map(table=>rows(f,table));
  const oldRows=f.sql.prepare('SELECT * FROM master_v3_articles WHERE sync_version=?').all(pending.syncVersion);const chunks=rows(f,'sync_v3_chunks');
  await assert.rejects(f.store.activateCatalogOnly(pending.syncId,await f.transition()),/SEMANTICS_CHANGED/);
  const dep=dependencies(f);const result=await prepareLargeMasterSyncV3CatalogOnly(f.store,'https://test','binding',undefined,dep.options,()=>{});
  assert.deepEqual(dep.calls,['request','resume:CORRECTED']);assert.equal(result.runtime.version.syncVersion,target.syncVersion);
  assert.deepEqual(['documents','master_v3_inventory_state','master_v3_inventory_balances'].map(table=>rows(f,table)),preserved);
  assert.deepEqual(f.sql.prepare('SELECT * FROM master_v3_articles WHERE sync_version=?').all(pending.syncVersion),oldRows);assert.equal(rows(f,'sync_v3_chunks'),chunks);
  assert.deepEqual({...f.sql.prepare('SELECT status,error_code FROM sync_v3_sessions WHERE sync_id=?').get(pending.syncId)},{status:'FAILED',error_code:'SUPERSEDED'});
  assert.equal((await f.store.getOperationalOwner())?.binding,'binding');assert.equal((await f.store.getInventoryAuthority())?.syncId,active.syncId);
  assert.equal(f.sql.prepare('SELECT price FROM master_v3_prices WHERE sync_version=?').get(target.syncVersion)?.price,300);
  assert.ok(f.sql.prepare("SELECT article_id FROM master_v3_articles WHERE sync_version=? AND article_id='LGFR04'").get(target.syncVersion));
 }finally{f.sql.close();}
});

for(const change of ['pointer','status','version','active','inventory','binding','same-version','downgrade','active-source','inventory-source']) test(`supersession rejects ${change} without changing native rows`,async()=>{
 const f=fixture();try{
  const transition=await f.transition();let expected:LargeMasterSyncV3StagingReplacement={...pending};let next=manifest();
  if(change==='pointer')f.sql.exec("UPDATE master_v3_state SET staging_sync_id='other'");
  if(change==='status')f.sql.exec("UPDATE sync_v3_sessions SET status='STAGING' WHERE sync_id='PENDING'");
  if(change==='version')expected={...pending,syncVersion:23134};
  if(change==='active')f.sql.exec('UPDATE master_v3_state SET active_version=21420');
  if(change==='inventory')f.sql.exec("UPDATE master_v3_inventory_state SET cursor='changed'");
  if(change==='binding')f.sql.exec("UPDATE master_v3_operational_owner SET binding='changed'");
  if(change==='same-version')next={...next,syncVersion:pending.syncVersion};
  if(change==='downgrade')next={...next,syncVersion:pending.syncVersion-1};
  if(change==='active-source')expected={...pending,syncId:active.syncId};
  if(change==='inventory-source')transition.inventory={...transition.inventory,syncId:pending.syncId,syncVersion:pending.syncVersion};
  const before=f.snapshot();await assert.rejects(f.store.prepareCatalogOnly(next,transition,expected),/CONFLICT|TRANSITION_CHANGED|AUTHORITY_INVALID/);assert.equal(f.snapshot(),before);
 }finally{f.sql.close();}
});

for(const point of ['UPDATE sync_v3_sessions SET status = \'FAILED\'','UPDATE master_v3_state SET staging_sync_id = NULL','INSERT OR IGNORE INTO sync_v3_sessions','UPDATE master_v3_state SET staging_version'])test(`disk fault at ${point} restores old staging completely`,async()=>{
 const f=fixture();try{const before=f.snapshot();f.fault(point);await assert.rejects(f.store.prepareCatalogOnly(manifest(),await f.transition(),pending),/disk fault/);assert.equal(f.snapshot(),before);}finally{f.sql.close();}
});

test('identity drift just before prepare commit rolls back lifecycle and both pointers',async()=>{
 const f=fixture();try{const transition=await f.transition();let count=0;transition.assertIdentity=()=>{if(++count>1)throw Error('SYNC_V3_BINDING_CHANGED');};const before=f.snapshot();await assert.rejects(f.store.prepareCatalogOnly(manifest(),transition,pending),/BINDING_CHANGED/);assert.equal(f.snapshot(),before);}finally{f.sql.close();}
});

test('negotiation/manifest mismatch fails before superseding or writing any session',async()=>{
 const f=fixture();try{const before=f.snapshot();const dep=dependencies(f,target,{...target,syncVersion:target.syncVersion-1});await assert.rejects(prepareLargeMasterSyncV3CatalogOnly(f.store,'https://test','binding',undefined,dep.options,()=>{}),/STAGING_CONFLICT/);assert.equal(f.snapshot(),before);}finally{f.sql.close();}
});

test('same negotiated pending session resumes without superseding; network failure retains every chunk',async()=>{
 const f=fixture();try{
  const calls:string[]=[];let received:unknown='not called';const original=f.store.prepareCatalogOnly.bind(f.store);f.store.prepareCatalogOnly=async(m,t,replacement)=>{received=replacement;return original(m,t,replacement);};
  const dep=dependencies(f,pending,pending);await assert.rejects(prepareLargeMasterSyncV3CatalogOnly(f.store,'https://test','binding',undefined,dep.options,()=>{}),/SEMANTICS_CHANGED/);assert.equal(received,undefined);assert.equal((await f.store.readProgress(pending.syncId))?.status,'VALIDATED');
  const before=f.snapshot();dep.options.createClient=()=>({requestSync:async()=>{calls.push('request');throw Error('offline');},resumeSync:async()=>{throw Error('must not resume');}});
  await assert.rejects(prepareLargeMasterSyncV3CatalogOnly(f.store,'https://test','binding',undefined,dep.options,()=>{}),/offline/);assert.deepEqual(calls,['request']);assert.equal(f.snapshot(),before);
 }finally{f.sql.close();}
});

test('newer catalog with incompatible semantics remains blocked by unchanged activation protection',async()=>{
 const f=fixture();try{await f.store.prepareCatalogOnly(manifest(),await f.transition(),pending);f.stageData(target,false);f.sql.prepare("UPDATE sync_v3_sessions SET status='VALIDATED' WHERE sync_id=?").run(target.syncId);await assert.rejects(f.store.activateCatalogOnly(target.syncId,await f.transition()),/SEMANTICS_CHANGED/);assert.equal((await f.store.getActiveRuntimeVersion())?.syncId,active.syncId);}finally{f.sql.close();}
});


test('target sync_version collision and corrupted final staging version fail atomically',async()=>{
 for(const mode of ['collision','version-readback']){
  const f=fixture();try{
   if(mode==='collision')f.sql.prepare("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES('OTHER',?,3,2,'FAILED','{}','old','old')").run(target.syncVersion);
   else f.fault('mutate-staging-version');
   const before=f.snapshot();await assert.rejects(f.store.prepareCatalogOnly(manifest(),await f.transition(),pending),/STAGING_CONFLICT/);assert.equal(f.snapshot(),before);
  }finally{f.sql.close();}
 }
});

test('older or equal-version different-id negotiation never prepares even without pending staging',async()=>{
 for(const next of [{syncId:'OLDER',syncVersion:active.syncVersion-1},{syncId:'OTHER',syncVersion:active.syncVersion}]){
  const f=fixture();try{
   f.sql.exec("UPDATE sync_v3_sessions SET status='FAILED' WHERE sync_id='PENDING';UPDATE master_v3_state SET staging_sync_id=NULL,staging_version=NULL;");
   const before=f.snapshot(),dep=dependencies(f,next);
   await assert.rejects(prepareLargeMasterSyncV3CatalogOnly(f.store,'https://test','binding',undefined,dep.options,()=>{}),/STAGING_CONFLICT/);assert.equal(f.snapshot(),before);assert.deepEqual(dep.calls,['request']);
   await assert.rejects(f.store.prepareCatalogOnly(manifest(next),await f.transition()),/STAGING_CONFLICT/);assert.equal(f.snapshot(),before);
  }finally{f.sql.close();}
 }
});

test('actual client rejects invalid or failed manifests before superseding the old session',async()=>{
 for(const status of [200,409]){
  const f=fixture();try{
   const before=f.snapshot(),dep=dependencies(f);
   dep.options.createClient=scoped=>{
    const client=new LargeMasterSyncV3Client({store:scoped,requireOperationalContract:true,maxRetries:0,transport:{request:async()=>({status,headers:{},text:JSON.stringify({syncId:target.syncId,syncVersion:target.syncVersion,schemaVersion:999})})}});
    return {requestSync:async()=>({...target,schemaVersion:3,status:'READY',manifestUrl:'manifest'}),resumeSync:(id:string)=>client.resumeSync(id)};
   };
   await assert.rejects(prepareLargeMasterSyncV3CatalogOnly(f.store,'https://test','binding',undefined,dep.options,()=>{}),/MANIFEST|FAILED|INVALID/);assert.equal(f.snapshot(),before);
  }finally{f.sql.close();}
 }
});

test('STAGING replacement preserves interrupted rows and never discards a changed CAS snapshot',async()=>{
 const f=fixture();try{
  f.sql.exec("UPDATE sync_v3_sessions SET status='STAGING' WHERE sync_id='PENDING'");
  const expected={...pending,status:'STAGING'},beforeChunks=rows(f,'sync_v3_chunks');
  await f.store.prepareCatalogOnly(manifest(),await f.transition(),expected);
  assert.equal(rows(f,'sync_v3_chunks'),beforeChunks);assert.equal((await f.store.readProgress(pending.syncId))?.status,'FAILED');
  assert.equal((await f.store.findIncomplete())?.syncId,target.syncId);
 }finally{f.sql.close();}
});

test('owner or inventory changes during the final identity callback roll back supersession metadata',async()=>{
 for(const table of ['master_v3_operational_owner','master_v3_inventory_state']){
  const f=fixture();try{
   const transition=await f.transition();let reads=0;
   transition.assertIdentity=()=>{if(++reads===2)f.sql.exec(table==='master_v3_operational_owner'?"UPDATE master_v3_operational_owner SET binding='other'":"UPDATE master_v3_inventory_state SET cursor='other'");};
   const before=f.snapshot();await assert.rejects(f.store.prepareCatalogOnly(manifest(),transition,pending),/TRANSITION_CHANGED/);assert.equal(f.snapshot(),before);
  }finally{f.sql.close();}
 }
});


test('failed supersession rollback quarantines the actual adapter before its queued writer can execute',async()=>{
 const f=fixture();try{
  const execute=f.bridge.execute;f.bridge.execute=async q=>{if(q==='ROLLBACK;')throw Error('rollback response lost');return execute(q);};
  f.fault("UPDATE sync_v3_sessions SET status = 'FAILED'");
  const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:f.bridge,isReady:true});
  const operation=adapter.masterSyncV3Store.prepareCatalogOnly!(manifest(),await f.transition(),pending);
  let wrote=false;const queued=(adapter as any).withWriteLock(async()=>{wrote=true;f.sql.exec("INSERT INTO documents VALUES('transactions','unsafe','{}')");});
  await assert.rejects(operation,/SYNC_V3_CONNECTION_UNCERTAIN/);await assert.rejects(queued,/SYNC_V3_CONNECTION_UNCERTAIN/);assert.equal(wrote,false);
  await assert.rejects(adapter.masterSyncV3Store.getActiveRuntimeVersion(),/SYNC_V3_CONNECTION_UNCERTAIN/);assert.throws(()=>(adapter as any).ensureDb(),/SYNC_V3_CONNECTION_UNCERTAIN/);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS count FROM documents WHERE doc_id='unsafe'").get()?.count,0);
 }finally{f.sql.close();}
});

test('applied BEGIN with lost response rolls back or quarantines before another adapter write',async()=>{
 for(const rollbackFailure of [false,true]){
  const f=fixture();try{
   const before=f.snapshot(),execute=f.bridge.execute;
   f.bridge.execute=async q=>{if(rollbackFailure&&q==='ROLLBACK;')throw Error('rollback failed');await execute(q);if(q.startsWith('BEGIN'))throw Error('begin response lost');};
   const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:f.bridge,isReady:true});
   const operation=adapter.masterSyncV3Store.prepareCatalogOnly!(manifest(),await f.transition(),pending);let wrote=false;
   const queued=(adapter as any).withWriteLock(async()=>{wrote=true;});
   await assert.rejects(operation,rollbackFailure?/SYNC_V3_CONNECTION_UNCERTAIN/:/begin response lost/);
   if(rollbackFailure){await assert.rejects(queued,/SYNC_V3_CONNECTION_UNCERTAIN/);assert.equal(wrote,false);}
   else{await queued;assert.equal(wrote,true);assert.equal(f.snapshot(),before);f.sql.exec('BEGIN;ROLLBACK;');}
  }finally{f.sql.close();}
 }
});
