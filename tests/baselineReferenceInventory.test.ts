import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { collectBaselineReferenceInventory } from '../services/diagnostics/BaselineReferenceInventory';

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
  const statements: string[] = [];
  let fail = false;
  const connection = {
    query: async (sql: string, values: unknown[] = []) => {
      assert.match(sql,/^(SELECT|PRAGMA)\b/);statements.push(sql);
      if (fail && sql.includes('SELECT * FROM "master_v3_state"')) throw Error('read failed');
      return { values: db.prepare(sql).all(...values as any[]) as Record<string,unknown>[] };
    },
    execute: async (sql: string) => { assert.match(sql,/^(BEGIN DEFERRED TRANSACTION|COMMIT|ROLLBACK);$/);statements.push(sql);db.exec(sql); },
  };
  const insert = db.prepare('INSERT INTO documents VALUES(?,?,?)');
  const snapshot = () => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => [row.name,db.prepare(`SELECT * FROM "${row.name}"`).all()]));
  return { db, connection, insert, statements, snapshot, fail:()=>{fail=true;} };
}

test('full paged census captures references beyond first blocker and preserves all data',async()=>{
 const f=fixture();try{
  for(let i=0;i<601;i++)f.insert.run('transactions',`SALE-${String(i).padStart(4,'0')}`,JSON.stringify({customerName:'private-customer',syncToken:'private-token',items:[{v3SaleAuthority:{syncId:'old-sync',syncVersion:21419,inventoryVersion:2,binding:'private-binding',warehouseId:'W'}}]}));
  f.insert.run('inventoryLedger','MOVE',JSON.stringify({v3InventoryBaseline:'private-binding',qtyOut:1}));
  f.insert.run('reservations','RESERVATION',JSON.stringify({original:{v3Binding:'private-binding'}}));
  const before=f.snapshot(),report=await collectBaselineReferenceInventory(f.connection);
  assert.equal(report.scanComplete,true);assert.equal(report.referenceInventoryComplete,true);
  assert.equal(report.tables.find(table=>table.name==='documents')?.rows,603);
  assert.equal(report.tables.find(table=>table.name==='documents')?.pageHashes.length,13);
  assert.equal(report.references.filter(ref=>ref.collection==='transactions').length,601);
  assert.ok(report.references.some(ref=>ref.collection==='reservations'));
  assert.ok(report.references.some(ref=>ref.collection==='inventoryLedger'));
  assert.deepEqual(report.inventoryBalances,[{item_id:'MAK015',warehouse_id:'W',qty_on_hand:13,qty_reserved:2,qty_committed:1}]);
  assert.doesNotMatch(JSON.stringify(report),/private-customer|private-token|private-binding|customerName/);
  assert.equal(report.migrationAllowed,false);assert.equal(f.snapshot(),before);
 }finally{f.db.close();}
});

test('malformed and opaque data remain visible as incomplete coverage without raw contents',async()=>{
 const f=fixture();try{
  f.insert.run('transactions','BROKEN','{ private-token');
  f.insert.run('reservations','BAD-SHAPE','null');
  f.db.exec("CREATE TABLE opaque(id INTEGER PRIMARY KEY,body BLOB);INSERT INTO opaque VALUES(1,X'010203');");
  const before=f.snapshot(),report=await collectBaselineReferenceInventory(f.connection);
  assert.equal(report.scanComplete,true);assert.equal(report.referenceInventoryComplete,false);
  assert.deepEqual(new Set(report.issues.map(issue=>issue.kind)),new Set(['MALFORMED_JSON','MALFORMED_SOURCE','OPAQUE_BLOB_NOT_INSPECTED']));
  assert.doesNotMatch(JSON.stringify(report),/private-token/);assert.equal(f.snapshot(),before);
 }finally{f.db.close();}
});

test('read failure rolls back the snapshot and never returns a partial report',async()=>{
 const f=fixture();try{
  const before=f.snapshot();f.fail();
  await assert.rejects(collectBaselineReferenceInventory(f.connection),/read failed/);
  assert.equal(f.statements.at(-1),'ROLLBACK;');assert.equal(f.snapshot(),before);
  f.db.exec('BEGIN;ROLLBACK;');
 }finally{f.db.close();}
});

test('an ambiguous BEGIN response closes the snapshot before allowing another write',async()=>{
 const f=fixture();try{
  const execute=f.connection.execute;
  f.connection.execute=async sql=>{await execute(sql);if(sql.startsWith('BEGIN'))throw Error('begin response lost');};
  const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:f.connection,isReady:true});
  await assert.rejects(adapter.masterSyncV3Store.readBaselineReferenceInventory!(),/begin response lost/);
  assert.equal(f.statements.at(-1),'ROLLBACK;');
  await (adapter as any).withWriteLock(async()=>{f.insert.run('transactions','AFTER-BEGIN-FAILURE','{}');});
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM documents').get()?.count,1);
 }finally{f.db.close();}
});

test('failed rollback quarantines the connection before any queued writer or reader can run',async()=>{
 const f=fixture();try{
  f.fail();
  const execute=f.connection.execute;
  f.connection.execute=async sql=>{if(sql==='ROLLBACK;')throw Error('rollback failed');await execute(sql);};
  const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:f.connection,isReady:true});
  const pending=adapter.masterSyncV3Store.readBaselineReferenceInventory!();
  let wrote=false;
  const write=(adapter as any).withWriteLock(async()=>{wrote=true;f.insert.run('transactions','UNSAFE','{}');});
  await assert.rejects(pending,/NATIVE_REFERENCE_AUDIT_CONNECTION_UNCERTAIN/);
  await assert.rejects(write,/NATIVE_REFERENCE_AUDIT_CONNECTION_UNCERTAIN/);
  assert.equal(wrote,false);
  await assert.rejects(adapter.masterSyncV3Store.readBaselineReferenceInventory!(),/NATIVE_REFERENCE_AUDIT_CONNECTION_UNCERTAIN/);
  assert.throws(()=>(adapter as any).ensureDb(),/NATIVE_REFERENCE_AUDIT_CONNECTION_UNCERTAIN/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM documents').get()?.count,0);
 }finally{f.db.close();}
});

test('missing native core tables cannot be reported as complete',async()=>{
 const f=fixture();try{
  f.db.exec('DROP TABLE master_v3_operational_owner;');
  const report=await collectBaselineReferenceInventory(f.connection);
  assert.equal(report.referenceInventoryComplete,false);
  assert.ok(report.issues.some(issue=>issue.kind==='MISSING_CORE_TABLE'));
 }finally{f.db.close();}
});


test('declared foreign keys are inventoried even without V3 names',async()=>{
 const f=fixture();try{
  f.db.exec("CREATE TABLE parent(id TEXT PRIMARY KEY);CREATE TABLE child(id TEXT PRIMARY KEY,parent_key TEXT REFERENCES parent(id));INSERT INTO parent VALUES('P');INSERT INTO child VALUES('C','P');");
  const report=await collectBaselineReferenceInventory(f.connection);
  assert.ok(report.references.some(ref=>ref.table==='child'&&ref.path==='parent_key'));
  assert.equal(report.tables.find(table=>table.name==='child')?.foreignKeys[0].table,'parent');
 }finally{f.db.close();}
});

test('native proxy holds the shared writer lane for the whole read snapshot',async()=>{
 const f=fixture();try{
  let reached!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>{reached=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const original=f.connection.query;
  f.connection.query=async(sql,values)=>{if(sql.includes('sqlite_master')){reached();await gate;}return original(sql,values);};
  const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:f.connection,isReady:true});
  const pending=adapter.masterSyncV3Store.readBaselineReferenceInventory!();await entered;
  let wrote=false;
  const write=(adapter as any).withWriteLock(async()=>{wrote=true;f.insert.run('transactions','LATER','{}');});
  await Promise.resolve();assert.equal(wrote,false);release();
  const report=await pending;await write;
  assert.equal(report.tables.find(table=>table.name==='documents')?.rows,0);assert.equal(wrote,true);
 }finally{f.db.close();}
});


test('personal or credential primary keys are hashed in reference locators',async()=>{
 const f=fixture();try{
  f.db.exec('CREATE TABLE private_locator(email TEXT PRIMARY KEY,data TEXT);');
  f.db.prepare('INSERT INTO private_locator VALUES(?,?)').run('private@example.invalid',JSON.stringify({v3Binding:'secret-binding'}));
  const report=await collectBaselineReferenceInventory(f.connection);
  assert.ok(report.references.some(ref=>ref.table==='private_locator'));
  assert.doesNotMatch(JSON.stringify(report),/private@example|secret-binding/);
 }finally{f.db.close();}
});
