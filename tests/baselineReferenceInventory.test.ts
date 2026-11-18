import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { collectBaselineReferenceInventory, REFERENCE_AUDIT_PAGE_BYTES, REFERENCE_AUDIT_LINE_BYTES, type AuditRow, type BaselineReferenceInventoryOptions } from '../services/diagnostics/BaselineReferenceInventory';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,PRIMARY KEY(collection_name,doc_id));
  CREATE TABLE master_v3_state(singleton INTEGER PRIMARY KEY,active_version INTEGER,staging_version INTEGER);
  CREATE TABLE master_v3_inventory_state(singleton INTEGER PRIMARY KEY,sync_id TEXT,inventory_version INTEGER,cursor TEXT);
  CREATE TABLE master_v3_operational_owner(singleton INTEGER PRIMARY KEY,sync_id TEXT,binding TEXT);
  CREATE TABLE master_v3_inventory_balances(item_id TEXT,warehouse_id TEXT,qty_on_hand REAL,qty_reserved REAL,qty_committed REAL,PRIMARY KEY(item_id,warehouse_id));
  INSERT INTO master_v3_state VALUES(1,21419,23135);
  INSERT INTO master_v3_inventory_state VALUES(1,'old-sync',2,'cursor');
  INSERT INTO master_v3_operational_owner VALUES(1,'old-sync','private-binding');
  INSERT INTO master_v3_inventory_balances VALUES('MAK015','W',13,2,1);`);
  const statements: string[] = []; let fail = false, maxQueryBytes = 0;
  const connection = {
    query: async (sql: string, values: unknown[] = []) => {
      assert.match(sql,/^(SELECT|PRAGMA)\b/); statements.push(sql);
      if (fail && sql.includes('FROM "master_v3_state"')) throw Error('read failed');
      const rows = db.prepare(sql).all(...values as any[]) as AuditRow[];
      maxQueryBytes = Math.max(maxQueryBytes,new TextEncoder().encode(JSON.stringify(rows)).length);
      return {values:rows};
    },
    execute: async (sql: string) => {assert.match(sql,/^(BEGIN DEFERRED TRANSACTION|COMMIT|ROLLBACK);$/); statements.push(sql); db.exec(sql);},
  };
  const snapshot = () => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => [row.name,db.prepare(`SELECT * FROM "${row.name}"`).all()]));
  return {db,connection,statements,snapshot,insert:db.prepare('INSERT INTO documents VALUES(?,?,?)'),fail:()=>{fail=true;},maxQueryBytes:()=>maxQueryBytes};
}
const discard: BaselineReferenceInventoryOptions = {emitLine:async()=>{}};
async function capture(connection: ReturnType<typeof fixture>['connection']) {
  const events:AuditRow[]=[];
  const summary=await collectBaselineReferenceInventory(connection,{emitLine:async line=>{events.push(JSON.parse(line));}});
  return {summary,events};
}

test('streamed census captures every page and preserves rows, balances and private values',async()=>{
 const f=fixture();try{
  for(let i=0;i<601;i++) f.insert.run('transactions',`SALE-${String(i).padStart(4,'0')}`,JSON.stringify({customerName:'private-customer',syncToken:'private-token',items:[{v3SaleAuthority:{syncId:'old-sync',syncVersion:21419,inventoryVersion:2,binding:'private-binding',warehouseId:'W'}}]}));
  f.insert.run('inventoryLedger','MOVE',JSON.stringify({v3InventoryBaseline:'private-binding',qtyOut:1}));
  f.insert.run('reservations','RESERVATION',JSON.stringify({original:{v3Binding:'private-binding'}}));
  const before=f.snapshot(),{summary,events}=await capture(f.connection);
  assert.equal(summary.scanComplete,true);assert.equal(summary.referenceInventoryComplete,true);
  assert.equal(events.find(event=>event.type==='table_end'&&event.name==='documents')?.rows,603);
  assert.equal(events.filter(event=>event.type==='reference'&&event.collection==='transactions').length,601);
  assert.ok(events.some(event=>event.collection==='reservations'));assert.ok(events.some(event=>event.collection==='inventoryLedger'));
  assert.deepEqual(events.find(event=>event.type==='balance'),{type:'balance',item_id:'MAK015',warehouse_id:'W',qty_on_hand:13,qty_reserved:2,qty_committed:1});
  assert.doesNotMatch(JSON.stringify(events),/private-customer|private-token|private-binding|customerName/);
  assert.equal(summary.migrationAllowed,false);assert.equal(f.snapshot(),before);
  assert.equal('references' in summary,false);assert.equal('tables' in summary,false);
 }finally{f.db.close();}
});

test('malformed, missing and opaque sources explicitly report incomplete coverage',async()=>{
 const f=fixture();try{
  f.insert.run('transactions','BROKEN','{ private-token');f.insert.run('reservations','BAD','null');
  f.db.exec("CREATE TABLE opaque(id INTEGER PRIMARY KEY,body BLOB);INSERT INTO opaque VALUES(1,zeroblob(2000000));DROP TABLE master_v3_operational_owner;");
  const before=f.snapshot(),{summary,events}=await capture(f.connection);
  assert.equal(summary.referenceInventoryComplete,false);
  assert.deepEqual(new Set(events.filter(event=>event.type==='issue').map(event=>event.kind)),new Set(['MALFORMED_JSON','MALFORMED_SOURCE','OPAQUE_BLOB_NOT_INSPECTED','MISSING_CORE_TABLE']));
  assert.doesNotMatch(JSON.stringify(events),/private-token/);assert.equal(f.snapshot(),before);
  assert.ok(f.maxQueryBytes()<REFERENCE_AUDIT_PAGE_BYTES);
 }finally{f.db.close();}
});

test('oversized JSON is rejected by its SQL length before any payload crosses the bridge',async()=>{
 const f=fixture();try{
  f.insert.run('transactions','HUGE',JSON.stringify({private:'x'.repeat(2*1024*1024)}));
  let payloadRead=false;const query=f.connection.query;
  f.connection.query=async(sql,values)=>{if(sql.includes('FROM "documents"')&&!sql.includes('__audit_bytes__'))payloadRead=true;return query(sql,values);};
  await assert.rejects(collectBaselineReferenceInventory(f.connection,discard),/REFERENCE_AUDIT_ROW_TOO_LARGE/);
  assert.equal(payloadRead,false);assert.ok(f.maxQueryBytes()<10000);assert.equal(f.statements.at(-1),'ROLLBACK;');
 }finally{f.db.close();}
});

test('100000 references stream with bounded bridge pages and output, never growing the summary',async()=>{
 const f=fixture();try{
  const data=JSON.stringify({items:Array.from({length:10},()=>({v3SaleAuthority:{syncId:'old-sync',syncVersion:21419}}))});
  f.db.exec('BEGIN;');for(let i=0;i<10000;i++)f.insert.run('transactions',`S${i.toString().padStart(5,'0')}`,data);f.db.exec('COMMIT;');
  let references=0,bytes=0,maxLine=0,concurrent=0;
  const summary=await collectBaselineReferenceInventory(f.connection,{emitLine:async line=>{
    assert.equal(concurrent++,0);const length=new TextEncoder().encode(line).length;maxLine=Math.max(maxLine,length);bytes+=length;
    if(JSON.parse(line).type==='reference')references++;await Promise.resolve();concurrent--;
  }});
  assert.equal(summary.referenceCount,references);assert.ok(references>=100000);assert.ok(bytes>10*1024*1024);
  assert.ok(maxLine<=REFERENCE_AUDIT_LINE_BYTES);assert.ok(f.maxQueryBytes()<=REFERENCE_AUDIT_PAGE_BYTES*6+8192);
  assert.ok(JSON.stringify(summary).length<1000);assert.equal(summary.referenceInventoryComplete,true);
 }finally{f.db.close();}
});

test('control characters and Unicode remain within the documented escaped bridge bound',async()=>{
 const f=fixture();try{
  for(let i=0;i<40;i++)f.insert.run('misc',`U${i}`,JSON.stringify({text:'\u0000😀'.repeat(1000),v3Binding:'secret'}));
  await collectBaselineReferenceInventory(f.connection,discard);
  assert.ok(f.maxQueryBytes()<=REFERENCE_AUDIT_PAGE_BYTES*6+8192);
 }finally{f.db.close();}
});

test('deep JSON traverses without copying complete paths for all intermediate nodes',async()=>{
 const f=fixture();try{
  const depth=2500;
  f.insert.run('reservations','DEEP','{"a":'.repeat(depth)+'{"v3Binding":"secret"}'+'}'.repeat(depth));
  const {summary,events}=await capture(f.connection);
  assert.equal(summary.referenceInventoryComplete,true);
  const ref=events.find(event=>event.collection==='reservations');assert.ok(ref);assert.ok(String(ref.path).length>10000);
 }finally{f.db.close();}
});

test('declared FK columns and hashed personal primary keys are retained without leaking data',async()=>{
 const f=fixture();try{
  f.db.exec("CREATE TABLE parent(id TEXT PRIMARY KEY);CREATE TABLE child(email TEXT PRIMARY KEY,parent_key TEXT REFERENCES parent(id),data TEXT);INSERT INTO parent VALUES('P');");
  f.db.prepare('INSERT INTO child VALUES(?,?,?)').run('private@example.invalid','P',JSON.stringify({v3Binding:'secret-binding'}));
  const {events}=await capture(f.connection);
  assert.ok(events.some(event=>event.type==='reference'&&event.table==='child'&&event.path==='parent_key'));
  assert.doesNotMatch(JSON.stringify(events),/private@example|secret-binding/);
 }finally{f.db.close();}
});

test('read and sink failures roll back and never return a complete summary',async()=>{
 for(const sinkFailure of [false,true]){
  const f=fixture();try{
   const before=f.snapshot();if(!sinkFailure)f.fail();
   await assert.rejects(collectBaselineReferenceInventory(f.connection,{emitLine:async()=>{if(sinkFailure)throw Error('disk full');}}),/read failed|disk full/);
   assert.equal(f.statements.at(-1),'ROLLBACK;');assert.equal(f.snapshot(),before);f.db.exec('BEGIN;ROLLBACK;');
  }finally{f.db.close();}
 }
});

test('cancel before BEGIN performs no SQL and leaves the writer lane usable',async()=>{
 const f=fixture();try{
  const controller=new AbortController();controller.abort();
  const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:f.connection,isReady:true});
  await assert.rejects(adapter.masterSyncV3Store.readBaselineReferenceInventory!({...discard,signal:controller.signal}),/REFERENCE_AUDIT_CANCELLED/);
  assert.deepEqual(f.statements,[]);await (adapter as any).withWriteLock(async()=>{f.insert.run('transactions','SAFE','{}');});
 }finally{f.db.close();}
});

test('cancel during streaming and identity failure before COMMIT both roll back safely',async()=>{
 for(const identity of [false,true]){
  const f=fixture();try{
   const controller=new AbortController();let checks=0;
   await assert.rejects(collectBaselineReferenceInventory(f.connection,{emitLine:async()=>{if(!identity)controller.abort();},signal:controller.signal,assertContext:()=>{if(identity&&checks++>0)throw Error('SYNC_V3_BINDING_CHANGED');}}),/REFERENCE_AUDIT_CANCELLED|SYNC_V3_BINDING_CHANGED/);
   assert.equal(f.statements.at(-1),'ROLLBACK;');f.db.exec('BEGIN;ROLLBACK;');
  }finally{f.db.close();}
 }
});

test('ambiguous BEGIN closes snapshot; failed rollback quarantines queued writes and reads',async()=>{
 for(const rollbackFailure of [false,true]){
  const f=fixture();try{
   const execute=f.connection.execute;
   f.connection.execute=async sql=>{if(rollbackFailure&&sql==='ROLLBACK;')throw Error('rollback failed');await execute(sql);if(sql.startsWith('BEGIN'))throw Error('begin response lost');};
   const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:f.connection,isReady:true});
   const pending=adapter.masterSyncV3Store.readBaselineReferenceInventory!(discard);let wrote=false;
   const write=(adapter as any).withWriteLock(async()=>{wrote=true;f.insert.run('transactions','LATER','{}');});
   await assert.rejects(pending,rollbackFailure?/NATIVE_REFERENCE_AUDIT_CONNECTION_UNCERTAIN/:/begin response lost/);
   if(rollbackFailure){await assert.rejects(write,/NATIVE_REFERENCE_AUDIT_CONNECTION_UNCERTAIN/);assert.equal(wrote,false);assert.throws(()=>(adapter as any).ensureDb(),/UNCERTAIN/);}
   else{await write;assert.equal(wrote,true);}
  }finally{f.db.close();}
 }
});

test('awaited sink backpressure keeps concurrent writes outside the snapshot',async()=>{
 const f=fixture();try{
  let reached!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{reached=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:f.connection,isReady:true});
  let first=true;
  const pending=adapter.masterSyncV3Store.readBaselineReferenceInventory!({emitLine:async()=>{if(first){first=false;reached();await gate;}}});await entered;
  let wrote=false;const write=(adapter as any).withWriteLock(async()=>{wrote=true;f.insert.run('transactions','LATER','{}');});
  await Promise.resolve();assert.equal(wrote,false);release();const report=await pending;await write;
  assert.equal(report.rowCount,4);assert.equal(wrote,true);
 }finally{f.db.close();}
});
