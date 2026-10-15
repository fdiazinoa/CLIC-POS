import test from 'node:test';
import assert from 'node:assert/strict';
import SQLite from 'better-sqlite3';
import {build} from 'esbuild';
import {nativeFixture,nativeSale,options,id} from './articleFormatsNativeFixture';
import {inventoryFixture,receiptTransport} from './articleFormatsInventoryFixture';
import {readV3Base4Stock} from '../services/db/V3Base4Stock';
const cover='idx_documents_v3_inventory_delta_cover';
const originalSum=`SELECT COALESCE(SUM(COALESCE(json_extract(data,'$.qtyIn'),0)-COALESCE(json_extract(data,'$.qtyOut'),0)),0) delta FROM documents
 WHERE collection_name='inventoryLedger' AND json_extract(data,'$.v3InventoryBaseline')=? AND json_extract(data,'$.productId')=? AND json_extract(data,'$.warehouseId')=?`;
function baseline(f:Awaited<ReturnType<typeof nativeFixture>>){const owner=f.db.prepare('SELECT binding FROM master_v3_operational_owner').get() as any,inv=f.db.prepare('SELECT * FROM master_v3_inventory_state').get() as any;return JSON.stringify([owner.binding,inv.sync_id,inv.sync_version,inv.inventory_version,inv.cursor]);}
function add(f:Awaited<ReturnType<typeof nativeFixture>>,numbers:number[],name:string,key=baseline(f),item=id(7),warehouse=id(5)){
 const insert=f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)');f.db.transaction(()=>numbers.forEach((n,i)=>insert.run('inventoryLedger',`${name}-${i}`,JSON.stringify({productId:item,warehouseId:warehouse,v3InventoryBaseline:key,qtyIn:Math.max(n,0),qtyOut:Math.max(-n,0)}),0,'fixture')))();
}
function demand(f:Awaited<ReturnType<typeof nativeFixture>>,quantity:number,item=id(7),warehouse=id(5)){
 const key=baseline(f);return [{collectionName:'transactions',document:{id:id(200),v3InventoryBaseline:key,v3Binding:JSON.parse(key)[0],v3WarehouseId:warehouse,items:[]},v3StockRequirements:[{baseline:key,productId:item,warehouseId:warehouse,quantity}]}];
}
async function outcome(f:Awaited<ReturnType<typeof nativeFixture>>,quantity:number,item=id(7),warehouse=id(5)){
 try{await f.sql.runFinancial!(tx=>tx.assertFinancialDocuments!(demand(f,quantity,item,warehouse)));return 'ACCEPTED';}
 catch(error){assert.equal((error as Error).message,'SYNC_V3_STOCK_INSUFFICIENT');return 'SYNC_V3_STOCK_INSUFFICIENT';}
}
let sessionModule:Promise<any>|undefined;
async function session(f:Awaited<ReturnType<typeof nativeFixture>>){
 sessionModule ||= build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3OperationalSession.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':'{}'},plugins:[{name:'ordered-io',setup(b){b.onResolve({filter:/^(\.\.\/db|\.\.\/\.\.\/utils\/db)$/},a=>({path:a.path,namespace:'ordered-fixture'}));b.onLoad({filter:/.*/,namespace:'ordered-fixture'},a=>({contents:a.path==='../db'?'export const dbAdapter={};':'export const db={};',loader:'js'}));}}]}).then(bundle=>import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`));
 const {LargeMasterSyncV3OperationalSession:Session}=await sessionModule;return new Session({},JSON.parse(baseline(f))[0],f.adapter.masterSyncV3Store,'https://erp.invalid',{});
}
function product(f:Awaited<ReturnType<typeof nativeFixture>>,item=id(7),warehouse=id(5)){
 const [,syncId,syncVersion,inventoryVersion,inventoryCursor]=JSON.parse(baseline(f));return {id:item,type:'PRODUCT',isInventoriable:true,stock:0,stockBalances:{[warehouse]:0},operationalFlags:{trackInventory:true,allowNegativeStock:false},v3SaleAuthority:{syncId,syncVersion,inventoryVersion,inventoryCursor}};
}
const examples=[
 {input:[0.000001,-0.000003,0.000016,-99999999999,99999999999],quantity:0.000014,raw:0.000014,result:'ACCEPTED'},
 {input:[0.000007,-0.000012,99999999999,0.000010,-99999999999],quantity:0.000005,raw:0.0000049999999999999996,result:'SYNC_V3_STOCK_INSUFFICIENT'},
];
for(const [i,e] of examples.entries())test(`review counterexample${i+1}: raw single/batch/Session and actual native transaction match original71e decision`,async t=>{
 const old=await nativeFixture(),f=await nativeFixture();try{
  old.db.exec(`DROP INDEX ${cover}`);for(const x of [old,f]){x.db.prepare('UPDATE master_v3_inventory_balances SET qty_on_hand=0,qty_reserved=0,qty_committed=0').run();add(x,e.input,'review');}
  const key=baseline(f),expected=(old.db.prepare(originalSum).get(key,id(7),id(5)) as any).delta;assert.equal(expected,e.raw);
  assert.equal(await f.adapter.masterSyncV3Store.getLocalInventoryDelta(key,id(7),id(5)),expected);
  assert.deepEqual(await f.adapter.masterSyncV3Store.getLocalInventoryDeltas(key,[id(7),id(8),id(7)],id(5)),{[id(7)]:expected});
  const s=await session(f),p=product(f);assert.equal((await s.withStock(p,id(5))).stock,expected);assert.equal((await s.withStocks([p],id(5)))[0].stock,expected);
  for(const quantity of [e.quantity-0.000001,e.quantity,e.quantity+0.000001]){
   const original=await outcome(old,quantity),actual=await outcome(f,quantity);assert.equal(actual,original);
   if(quantity===e.quantity){assert.equal(actual,e.result);t.diagnostic(JSON.stringify({inputs:e.input,raw:expected,quantity,native:actual}));}
  }
 }finally{old.db.close();f.db.close();}
});

test('128 deterministic permutations across2items/2warehouses preserve raw arithmetic and exact native/Session decisions',async()=>{
 const old=await nativeFixture(),f=await nativeFixture();try{
  old.db.exec(`DROP INDEX ${cover}`);const s=await session(f);let random=0x12345678;
  const vectors=[[1,-3,16],[7,-12,10],[3,-4,2],[5,-2,3]];
  for(const x of [old,f])for(const item of [id(7),id(8)])for(const warehouse of [id(5),id(6)])x.db.prepare('INSERT OR REPLACE INTO master_v3_inventory_balances VALUES(?,?,?,?,?,?)').run(item,warehouse,0,0,0,'fixture');
  for(let n=0;n<128;n++){
   const micro=vectors[n%vectors.length],input=[...micro.map(v=>v/1000000),99999999999,-99999999999];
   for(let k=input.length-1;k>0;k--){random=(Math.imul(random,1664525)+1013904223)>>>0;const j=random%(k+1);[input[k],input[j]]=[input[j],input[k]];}
   const item=id(7+n%2),warehouse=id(5+Math.floor(n/2)%2),quantity=micro.reduce((a,b)=>a+b,0)/1000000;
   for(const x of [old,f]){x.db.prepare('UPDATE master_v3_inventory_state SET cursor=?').run(`permutation-${n}`);add(x,input,`perm-${n}`,baseline(x),item,warehouse);}
   const key=baseline(f),expected=(old.db.prepare(originalSum).get(key,item,warehouse) as any).delta;
   assert.equal(await f.adapter.masterSyncV3Store.getLocalInventoryDelta(key,item,warehouse),expected,`single${n}`);
   assert.deepEqual(await f.adapter.masterSyncV3Store.getLocalInventoryDeltas(key,[item,id(999),item],warehouse),{[item]:expected},`batch${n}`);
   const p=product(f,item,warehouse);assert.equal((await s.withStock(p,warehouse)).stock,expected);assert.equal((await s.withStocks([p],warehouse))[0].stock,expected);
   assert.equal(await outcome(f,quantity,item,warehouse),await outcome(old,quantity,item,warehouse),`native${n}`);
  }
 }finally{old.db.close();f.db.close();}
});

test('batch100x100 uses one correlated aggregate statement, per-item rowid order, sparse keys and genuine zero retention',async()=>{
 const old=await nativeFixture(),f=await nativeFixture();try{
  old.db.exec(`DROP INDEX ${cover}`);const key=baseline(f),items=Array.from({length:100},(_,i)=>id(1000+i));
  for(let i=0;i<100;i++)for(const x of [old,f])add(x,Array.from({length:20},()=>examples[i%2].input).flat(),`batch-${i}`,key,items[i]);
  const before=f.fault.queries,result=await f.adapter.masterSyncV3Store.getLocalInventoryDeltas(key,items,id(5));assert.equal(f.fault.queries-before,2);
  for(let i=0;i<100;i++)assert.equal(result[items[i]],(old.db.prepare(originalSum).get(key,items[i],id(5)) as any).delta);
  const zero=id(9000);for(const x of [old,f])add(x,[1,-1],'pure-zero',key,zero);
  assert.deepEqual(await f.adapter.masterSyncV3Store.getLocalInventoryDeltas(key,[zero,zero,id(9001)],id(5)),{[zero]:0});
  const q=f.fault.queries;assert.deepEqual(await f.adapter.masterSyncV3Store.getLocalInventoryDeltas(key,[],id(5)),{});assert.equal(f.fault.queries,q);
  await assert.rejects(f.adapter.masterSyncV3Store.getLocalInventoryDeltas(key,Array(101).fill(zero),id(5)),/QUERY_LIMIT/);
 }finally{old.db.close();f.db.close();}
});

for(const hasState of [true,false])for(const hasCover of [true,false])test(`historical state${hasState}/cover${hasCover} preserves ordered single/batch/native sums and durable schema recovery`,async()=>{
 const f=await nativeFixture();try{
  f.db.prepare('UPDATE master_v3_inventory_balances SET qty_on_hand=0,qty_reserved=0,qty_committed=0').run();add(f,examples[0].input,'combination');
  if(!hasState)f.db.exec('DROP TABLE article_format_inventory_state');if(!hasCover)f.db.exec(`DROP INDEX ${cover}`);
  const key=baseline(f);assert.equal(await f.adapter.masterSyncV3Store.getLocalInventoryDelta(key,id(7),id(5)),0.000014);
  assert.deepEqual(await f.adapter.masterSyncV3Store.getLocalInventoryDeltas(key,[id(7),id(7),id(8)],id(5)),{[id(7)]:0.000014});assert.equal(await outcome(f,0.000014),'ACCEPTED');
  await (f.adapter as any).initSchema();const before=f.fault.queries;assert.equal(await f.adapter.masterSyncV3Store.getLocalInventoryDelta(key,id(7),id(5)),0.000014);assert.equal(f.fault.queries-before,1);
 }finally{f.db.close();}
});

test('active selected state with missing cover still enforces global scope/cell/authorization and mixed-writer blockers',async()=>{
 const f=await inventoryFixture();try{
  await f.posting.post(nativeSale(),options);await f.reservations(id(1000));const captured=await f.journal.captureFixture(),mock=await receiptTransport(captured);await f.journal.commitFixture(captured,await mock.download());f.db.exec(`DROP INDEX ${cover}`);
  assert.equal((await f.adapter.masterSyncV3Store.getOperationalStockProjection(f.baseline(),[id(7)],id(5))).quantities[id(7)],89);
  const selected=await f.sql.runFinancial!(tx=>readV3Base4Stock(async(sql,values)=>{assert.equal(sql.includes('delta_scaled'),false,'selected authority must not evaluate legacy aggregate');return tx.query(sql,values);},f.baseline(),id(7),id(5)));assert.equal(selected.available.toFixed(4),'89.0000');
  await assert.rejects(f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.baseline(),id(999),id(5)),/STOCK_BASELINE_MISSING/);
  await assert.rejects(f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.baseline(),id(7),id(999)),/SCOPE_FORBIDDEN/);
  await assert.rejects(f.sql.runFinancial!(tx=>tx.assertFinancialDocuments!(demand(f,1))),/UNSUPPORTED_WRITER/);
  f.db.prepare("UPDATE article_format_network_sessions SET context=json_set(context,'$.grant_revision',2)").run();
  await assert.rejects(f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.baseline(),id(7),id(5)),/AUTHORITY_CHANGED/);
 }finally{f.db.close();}
});

test('planner/index corruption and nonexact missing-index errors propagate through all3 readers, without broad fallback',async()=>{
 const f=await nativeFixture();try{
  add(f,examples[0].input,'errors');const key=baseline(f),bridge=(f.adapter as any).db,query=bridge.query.bind(bridge);
  for(const message of ['no query solution','SQLITE_CORRUPT','bridge-failed','no such table: documents',`no such index: ${cover} invalid-suffix`]){
   let calls=0;bridge.query=async(sql:string,values:any[])=>{if(sql.includes('SUM(delta)')){calls++;throw Error(message);}return query(sql,values);};
   for(const run of [()=>f.adapter.masterSyncV3Store.getLocalInventoryDelta(key,id(7),id(5)),()=>f.adapter.masterSyncV3Store.getLocalInventoryDeltas(key,[id(7),id(8)],id(5)),()=>f.sql.runFinancial!(tx=>tx.assertFinancialDocuments!(demand(f,0.000014)))]){
    const before=calls;await assert.rejects(run(),error=>error instanceof Error&&error.message===message);assert.equal(calls-before,1);
   }
  }
  bridge.query=query;f.db.exec(`DROP INDEX ${cover};CREATE INDEX ${cover} ON documents(doc_id) WHERE collection_name='never_inventory';`);
  await assert.rejects(f.adapter.masterSyncV3Store.getLocalInventoryDelta(key,id(7),id(5)),/no query solution/);
  await assert.rejects(f.adapter.masterSyncV3Store.getLocalInventoryDeltas(key,[id(7),id(8)],id(5)),/no query solution/);
  await assert.rejects(f.sql.runFinancial!(tx=>tx.assertFinancialDocuments!(demand(f,0.000014))),/no query solution/);
 }finally{f.db.close();}
});

test('correlated batch rejects truncated/duplicate/missing-field transport rows rather than returning a silent empty map',async()=>{
 const f=await nativeFixture();try{
  const key=baseline(f),bridge=(f.adapter as any).db,query=bridge.query.bind(bridge);
  for(const invalid of [[],[{item_id:id(7)}],[{item_id:id(7),delta:0},{item_id:id(7),delta:null}]]){
   bridge.query=async(sql:string,values:any[])=>sql.startsWith('WITH requested')?{values:invalid}:query(sql,values);
   await assert.rejects(f.adapter.masterSyncV3Store.getLocalInventoryDeltas(key,[id(7),id(8)],id(5)),/INVENTORY_NOT_READY/);
  }
 }finally{f.db.close();}
});

test('BASE4 exact-integer operand contract is unchanged with cover present or historically absent',async()=>{
 for(const hasCover of [true,false]){
  const f=await nativeFixture();try{
   if(!hasCover)f.db.exec(`DROP INDEX ${cover}`);const key=baseline(f);add(f,[0.1,-0.2,0.3],'base4');
   assert.equal((await f.sql.runFinancial!(tx=>readV3Base4Stock(tx.query,key,id(7),id(5)))).available.toFixed(4),'137.2000');
   add(f,[0.000001],'base4-invalid');await assert.rejects(f.sql.runFinancial!(tx=>readV3Base4Stock(tx.query,key,id(7),id(5))),/PRECISION_INVALID/);
  }finally{f.db.close();}
 }
});

test('BASE4 integer overflow acceptance remains unchanged with20000 alternating large valid operands',async()=>{
 for(const hasCover of [true,false])for(const sign of [1,-1]){
  const f=await nativeFixture();try{
   if(!hasCover)f.db.exec(`DROP INDEX ${cover}`);const key=baseline(f);
   add(f,Array.from({length:20000},(_,i)=>sign*(i%2===0?1:-1)*99999999999.9999),'base4-cancellation');
   add(f,[0,-0],'base4-zero');
   assert.equal((await f.sql.runFinancial!(tx=>readV3Base4Stock(tx.query,key,id(7),id(5)))).available.toFixed(4),'137.0000');
   for(const quantity of [137,137.0001]){
    const documents=demand(f,quantity);Object.assign(documents[0].v3StockRequirements[0],{quantityScale:4});
    const run=()=>f.sql.runFinancial!(tx=>tx.assertFinancialDocuments!(documents));
    if(quantity===137)await run();else await assert.rejects(run(),/STOCK_INSUFFICIENT/);
   }
   assert.equal((f.db.prepare("SELECT count(*) n FROM documents WHERE collection_name='inventoryLedger'").get() as {n:number}).n,20002);
  }finally{f.db.close();}
 }
});


test('BASE4 preserves actual original-order overflow and invalid operand type rejection',async()=>{
 for(const hasCover of [true,false])for(const invalidType of [false,true]){
  const f=await nativeFixture();try{
   if(!hasCover)f.db.exec(`DROP INDEX ${cover}`);const key=baseline(f);
   if(invalidType)f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('inventoryLedger','invalid-type',JSON.stringify({productId:id(7),warehouseId:id(5),v3InventoryBaseline:key,qtyIn:'0.1',qtyOut:0}),0,'fixture');
   else add(f,Array(10000).fill(99999999999.9999),'genuine-overflow');
   await assert.rejects(f.sql.runFinancial!(tx=>readV3Base4Stock(tx.query,key,id(7),id(5))),invalidType?/PRECISION_INVALID/:/integer overflow/);
  }finally{f.db.close();}
 }
});
