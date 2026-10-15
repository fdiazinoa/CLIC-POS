import test from 'node:test';
import assert from 'node:assert/strict';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeFixture,id} from './articleFormatsNativeFixture';
const indexName='idx_documents_v3_inventory_delta_cover';
// Exact aggregate/operands of original71e. A preindex DB uses its original prefix index and rowid traversal.
const originalSQL=`SELECT COALESCE(SUM(COALESCE(json_extract(data,'$.qtyIn'),0)-COALESCE(json_extract(data,'$.qtyOut'),0)),0) delta
 FROM documents WHERE collection_name='inventoryLedger' AND json_extract(data,'$.v3InventoryBaseline')=? AND json_extract(data,'$.productId')=? AND json_extract(data,'$.warehouseId')=?`;
const baseline='synthetic-original-six-decimal-baseline';
const values=[baseline,id(7),id(5)];
function seed(db:SQLite.Database,rows:Record<string,any>[]){const insert=db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)');db.transaction(()=>rows.forEach((r,i)=>insert.run('inventoryLedger',`case-${i}`,JSON.stringify({productId:id(7),warehouseId:id(5),v3InventoryBaseline:baseline,...r}),0,'fixture')))();}
const deltaRow=(n:number)=>n>=0?{qtyIn:n,qtyOut:0}:{qtyIn:0,qtyOut:-n};
const arithmeticCases=[
 {name:'six-decimal fractions',rows:[0.000001,1.234567,-0.234566,-0.000001].map(deltaRow)},
 {name:'mixed zero/null/missing',rows:[{}, {qtyIn:null,qtyOut:null},{qtyIn:0},{qtyOut:0},{qtyIn:1.000001},{qtyOut:0.000001}]},
 {name:'large cancellation with micro-unit tail',rows:[10000000000,-10000000000,0.000001].map(deltaRow)},
 {name:'large cancellation with intervening micro-units',rows:[10000000000,0.000001,-10000000000,0.000001].map(deltaRow)},
 {name:'large opposite cancellation and negative tail',rows:[-99999999999,0.123456,99999999999,-0.000001].map(deltaRow)},
 {name:'many small repeated entries',rows:Array.from({length:1000},(_,i)=>deltaRow(i%2===0?0.123457:-0.123456))},
 // Model JSON/network decoding explicitly for large fractional values; keep the original IEEE-double operands.
 {name:'mixed magnitudes and repeated signs',rows:[Number('99999999999.12345'),-Number('99999999998.12345'),0.000001,-0.999999,0.123456,-0.000001].map(deltaRow)},
];
for(const c of arithmeticCases)test(`index preserves original quantity and exact availability decisions: ${c.name}`,async()=>{
 const old=await nativeFixture(),candidate=await nativeFixture();try{
  old.db.exec(`DROP INDEX ${indexName}`);seed(old.db,c.rows);seed(candidate.db,c.rows);
  const expected=(old.db.prepare(originalSQL).get(...values) as any).delta;
  const actual=await candidate.adapter.masterSyncV3Store.getLocalInventoryDelta(...values as [string,string,string]);
  assert.equal(actual,expected,'changed raw SQLite SUM result');
  assert.equal(actual.toFixed(6),expected.toFixed(6),'changed six-decimal legacy balance');
  for(const demand of [0.000001,0.123456,1,Math.max(0,expected),Math.max(0,expected)+0.000001])assert.equal(demand<=actual,demand<=expected,`changed exact sale availability decision at${demand}`);
 }finally{old.db.close();candidate.db.close();}
});

test('actual native migration installs one durable planner-selected covering expression index on existing file, idempotently',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-stock-index-migrate-'));const file=join(dir,'pos.sqlite');let opened:SQLite.Database|undefined;
 try{
  let f=await nativeFixture(new SQLite(file));opened=f.db;f.db.exec(`DROP INDEX ${indexName}`);seed(f.db,Array.from({length:100},()=>({qtyIn:1,qtyOut:0})));
  const before=f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all();
  await (f.adapter as any).initSchema();
  assert.deepEqual(f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),before);
  const index=f.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(indexName) as {sql:string};assert.ok(index);
  assert.match(index.sql,/COALESCE\(json_extract\(data, '\$\.qtyIn'\), 0\) - COALESCE\(json_extract\(data, '\$\.qtyOut'\), 0\)/);
  assert.match(index.sql,/WHERE collection_name = 'inventoryLedger' AND json_extract\(data, '\$\.v3InventoryBaseline'\) IS NOT NULL/);
  const bridge=(f.adapter as any).db,query=bridge.query.bind(bridge);let recorded:{sql:string;values:any[]}|undefined;
  bridge.query=async(sql:string,params:any[])=>{if(sql.includes('SELECT CASE WHEN EXISTS('))recorded={sql,values:params};return query(sql,params);};
  assert.equal(await f.adapter.masterSyncV3Store.getLocalInventoryDelta(...values as [string,string,string]),100);assert.ok(recorded);
  const plan=f.db.prepare('EXPLAIN QUERY PLAN '+recorded.sql).all(...recorded.values) as {detail:string}[];
  assert.ok(plan.some(p=>p.detail.includes(indexName)),'planner did not choose the proposed index');
  t.diagnostic(JSON.stringify({engine:f.db.prepare('SELECT sqlite_version() version').get(),indexSQL:index.sql,plan}));
  const vm=f.db.prepare('EXPLAIN '+recorded.sql).all(...recorded.values) as {opcode:string;p4:string}[];
  assert.equal(vm.some(op=>op.opcode==='Function'&&String(op.p4).includes('json_extract')),false,'aggregate still decodes JSON operands rather than stored expression');
  await (f.adapter as any).initSchema();assert.deepEqual(f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),before);
  assert.equal((f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='index' AND name=?").get(indexName) as any).n,1);
  f.db.close();f=await nativeFixture(new SQLite(file),false);opened=f.db;await (f.adapter as any).initSchema();assert.equal(await f.adapter.masterSyncV3Store.getLocalInventoryDelta(...values as [string,string,string]),100);
  assert.deepEqual(f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),before);
 }finally{if(opened?.open)opened.close();rmSync(dir,{recursive:true,force:true});}
});

test('indexed deltas follow permitted writes, metadata updates and rollback while existing physical protection remains intact',async()=>{
 const f=await nativeFixture();try{
  const insert=f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)');
  const check=async(expected:number)=>{
   assert.equal(await f.adapter.masterSyncV3Store.getLocalInventoryDelta(...values as [string,string,string]),expected);
   assert.equal((f.db.prepare(originalSQL).get(...values) as any).delta,expected);
   const documents=(f.db.prepare("SELECT data FROM documents WHERE collection_name='inventoryLedger'").all() as {data:string}[]).map(r=>JSON.parse(r.data));
   const tableQuantity=documents.filter(d=>d.v3InventoryBaseline===baseline&&d.productId===id(7)&&d.warehouseId===id(5)).reduce((n,d)=>n+(d.qtyIn ?? 0)-(d.qtyOut ?? 0),0);
   assert.equal(tableQuantity,expected,'durable expression differs from authoritative document operands');
  };
  const data={id:'ordinary',productId:id(7),warehouseId:id(5),qtyIn:1.234567,qtyOut:0};insert.run('inventoryLedger',data.id,JSON.stringify(data),0,'fixture');await check(0);
  f.db.prepare('UPDATE documents SET data=? WHERE doc_id=?').run(JSON.stringify({...data,qtyIn:2.345678}),data.id);await check(0);
  f.db.prepare('UPDATE documents SET data=? WHERE doc_id=?').run(JSON.stringify({...data,qtyIn:2.345678,v3InventoryBaseline:baseline}),data.id);await check(2.345678);
  f.db.prepare("UPDATE documents SET data=json_set(data,'$.syncStatus','SYNCED') WHERE doc_id=?").run(data.id);await check(2.345678);
  assert.throws(()=>f.db.prepare("UPDATE documents SET data=json_set(data,'$.qtyIn',3) WHERE doc_id=?").run(data.id),/SYNC_V3_INVENTORY_COVERAGE_REQUIRED/);await check(2.345678);
  f.db.prepare('DELETE FROM documents WHERE doc_id=?').run(data.id);await check(2.345678);assert.equal((f.db.prepare('SELECT count(*) n FROM documents WHERE doc_id=?').get(data.id) as any).n,1);
  insert.run('inventoryLedger','mutable',JSON.stringify({...data,id:'mutable'}),0,'fixture');f.db.prepare('DELETE FROM documents WHERE doc_id=?').run('mutable');await check(2.345678);
  insert.run('products','excluded',JSON.stringify({...data,v3InventoryBaseline:baseline,qtyIn:999}),0,'fixture');await check(2.345678);
  const before=f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all();
  await assert.rejects(f.sql.runFinancial!(async tx=>{await tx.executeAtomic([{statement:'INSERT INTO documents VALUES(?,?,?,?,?)',values:['inventoryLedger','rollback',JSON.stringify({...data,v3InventoryBaseline:baseline,qtyIn:1.000001}),0,'fixture']},{statement:'INSERT INTO definitely_missing_table VALUES(1)'}]);}),/no such table/);
  assert.deepEqual(f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),before);await check(2.345678);
 }finally{f.db.close();}
});

test('index and rows survive committed-but-lost response followed by file reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-stock-index-restart-'));const file=join(dir,'pos.sqlite');let opened:SQLite.Database|undefined;
 try{
  let f=await nativeFixture(new SQLite(file));opened=f.db;f.fault.loseCommitResponse=true;
  await assert.rejects(f.sql.runFinancial!(tx=>tx.executeAtomic([{statement:'INSERT INTO documents VALUES(?,?,?,?,?)',values:['inventoryLedger','lost-response',JSON.stringify({productId:id(7),warehouseId:id(5),v3InventoryBaseline:baseline,qtyIn:1.234567,qtyOut:0}),0,'fixture']}])),/NATIVE_FINANCIAL_COMMIT_UNCERTAIN/);
  f.db.close();f=await nativeFixture(new SQLite(file),false);opened=f.db;assert.equal(await f.adapter.masterSyncV3Store.getLocalInventoryDelta(...values as [string,string,string]),1.234567);
  assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(indexName));
 }finally{if(opened?.open)opened.close();rmSync(dir,{recursive:true,force:true});}
});

for(const point of ['before','during-expression','after-commit-response'] as const)test(`real migration failure ${point} preserves old rows/index, rejects readiness and reopens safely`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-stock-index-failure-'));const file=join(dir,'pos.sqlite');let opened:SQLite.Database|undefined;
 try{
  let f=await nativeFixture(new SQLite(file));opened=f.db;f.db.exec(`DROP INDEX ${indexName}`);seed(f.db,[{qtyIn:1.234567,qtyOut:0}]);
  const before=f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),bridge=(f.adapter as any).db,execute=bridge.execute.bind(bridge);
  if(point==='during-expression')f.db.function('json_extract',{deterministic:true},(text:unknown,path:unknown)=>{if(path==='$.qtyIn'||path==='$.qtyOut')throw Error('injected-index-expression');const object=JSON.parse(String(text));return object[String(path).slice(2)] ?? null;});
  else bridge.execute=async(sql:string,transaction?:boolean)=>{if(!sql.includes(`CREATE INDEX IF NOT EXISTS ${indexName}`))return execute(sql,transaction);if(point==='before')throw Error('injected-before-index');await execute(sql,transaction);throw Error('injected-index-commit-response');};
  await assert.rejects((f.adapter as any).initSchema(),/injected-index-expression|injected-before-index|injected-index-commit-response/);
  assert.equal((f.adapter as any).isReady,false);assert.deepEqual(f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),before);
  assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_documents_v3_inventory_baseline'").get());
  if(point!=='after-commit-response')assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(indexName),undefined);
  f.db.close();f=await nativeFixture(new SQLite(file),false);opened=f.db;await (f.adapter as any).initSchema();assert.equal(await f.adapter.masterSyncV3Store.getLocalInventoryDelta(...values as [string,string,string]),1.234567);
  assert.deepEqual(f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),before);
 }finally{if(opened?.open)opened.close();rmSync(dir,{recursive:true,force:true});}
});

test('failed CREATE INDEX statement itself is atomic without relying on a surrounding schema transaction',async()=>{
 const f=await nativeFixture();try{
  const sql=(f.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(indexName) as {sql:string}).sql;
  f.db.exec(`DROP INDEX ${indexName}`);seed(f.db,[{qtyIn:1.234567,qtyOut:0},{qtyIn:2.345678,qtyOut:0}]);
  const before=f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all();
  let quantities=0;f.db.function('json_extract',{deterministic:true},(text:unknown,path:unknown)=>{
   if((path==='$.qtyIn'||path==='$.qtyOut')&&++quantities>=3)throw Error('injected-mid-index-statement');
   return JSON.parse(String(text))[String(path).slice(2)] ?? null;
  });
  assert.equal(f.db.inTransaction,false);assert.throws(()=>f.db.exec(sql),/injected-mid-index-statement/);assert.equal(f.db.inTransaction,false);
  assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(indexName),undefined);
  assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_documents_v3_inventory_baseline'").get());
  assert.deepEqual(f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),before);
 }finally{f.db.close();}
});
