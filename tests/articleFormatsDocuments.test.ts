import assert from 'node:assert/strict';
import test from 'node:test';
import SQLite from 'better-sqlite3';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { articleFormatWireSchema } from '../services/articleFormats/schema';
import { androidSQLiteStatements } from './nativeSQLiteParser';
import { context, id, seedCollections } from './articleFormatsNetworkFixture';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import { ArticleFormatPosting, saleWireLine, returnWireLine, wireTotals, drainFormatWireEvents } from '../services/articleFormats/posting';
import { wireHash, FormatHTTPError, type WireEvent, type FormatACK } from '../services/articleFormats/wire';
const base={schemaVersion:1 as const,id:'unit',variantId:null,name:'Unidad',abbreviation:'UN',factor:1,barcode:'',active:true,is_base:true,default_purchase:false,default_sale:false,allow_purchase:true,allow_sale:true,allow_transfer:true,sort_order:0,prices:[]};
const dto={schema_version:1 as const,inventory_quantity_unit:'BASE' as const,item_id:id(7),formats:[base,{...base,id:'pack',name:'Pack6',factor:6,is_base:false,sort_order:1},{...base,id:'case',name:'Caja24',factor:24,is_base:false,sort_order:2,prices:[{tariffId:id(6),price:1080}]}]};
const policy={item_id:id(7),base_unit_cost:'35',variant_ids:[],variant_skus:{},base_prices:[{variant_id:null,tariff_id:id(6),price:'45',tax_included:false}],taxes:[],tax_rate:'0',max_discount_rate:'10',promotions:[],warehouse_id:id(5)};
const revision={syncId:id(11),revision:1,context,revisionChecksum:'a'.repeat(64)};
const masters={getActiveRevision:async()=>revision,getPolicy:async()=>({dto,policy})};
function sale():WireEvent{
 const l=saleWireLine(dto,policy,{lineId:id(14),formatId:'case',variantId:null,tariffId:id(6),quantity:'2',occurredAt:'2026-10-14T12:00:00-04:00',terminalId:id(4)});
 return {schema_version:1,event_id:id(12),transaction_id:id(13),event_type:'ARTICLE_FORMAT_SALE_V1',occurred_at:'2026-10-14T12:00:00-04:00',master:{sync_id:id(11),revision:1},fiscal:{mode:'NONE'},lines:[l],payments:[{payment_id:id(15),method:'cash',amount:'2160.00'}],totals:wireTotals([l])};
}
async function ack(e:WireEvent):Promise<FormatACK>{return {schema_version:1,eventId:e.event_id,applied:true,disposition:'APPLIED',inbox_id:id(20),document_id:id(21),document_code:'F-1',inventory_movement_ids:[id(22)],accounting_entry_ids:[id(23)],payment_entry_id:id(24),inventory_quantity_unit:'BASE',content_hash:await wireHash(e),committed_at:'2026-10-14T17:00:00Z',...(e.return_context?{return_authorization:{...e.return_context,admission_grant_revision:e.return_context.grant_revision,admission_fingerprint:e.return_context.fingerprint,recovery_id:null}}:{})};}
const opts={seriesId:id(9),userId:id(25),userName:'Synthetic'};

function setup(db=new SQLite(':memory:'), seed=true) {
 db.pragma('foreign_keys=ON');
 if(seed){
  seedCollections(db);
  db.exec('CREATE TABLE documents(collection_name TEXT NOT NULL,doc_id TEXT NOT NULL,data TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,updatedAt TEXT NOT NULL,PRIMARY KEY(collection_name,doc_id))');
  for(const row of db.prepare('SELECT key,value FROM collections').all() as {key:string;value:string}[]) {
   JSON.parse(row.value).forEach((doc:any,i:number)=>db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(row.key,doc.id,JSON.stringify(doc),i,'fixture'));
  }
  db.exec('DROP TABLE collections');
 }
 const control:{before?:number;afterCommit?:boolean;count:number}={count:0};
 const bridge={execute:async(sql:string,transaction=true)=>{const run=()=>db.exec(sql);if(transaction)db.transaction(run)();else run();},
  query:async(sql:string,values:any[]=[])=>({values:db.prepare(sql).all(...values)}),
  executeSet:async(statements:{statement:string;values:any[]}[])=>{
   control.count=statements.length;
   db.transaction(()=>{statements.forEach((s,i)=>{if(control.before===i)throw Error('injected:'+i);db.prepare(s.statement).run(...(s.values||[]));});if(control.before===statements.length)throw Error('injected:beforeCommit');})();
   // Uncertain COMMIT is injected at the owning transaction, after it commits.
   if(control.afterCommit && !db.inTransaction)throw Error('injected:afterCommit');
  }};
 Object.assign(bridge,{run:async(sql:string,values:any[]=[])=>db.prepare(sql).run(...values),beginTransaction:async()=>{db.exec('BEGIN IMMEDIATE');},commitTransaction:async()=>{db.exec('COMMIT');},rollbackTransaction:async()=>{db.exec('ROLLBACK');},isTransactionActive:async()=>({result:db.inTransaction})});
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge});
 let queue=Promise.resolve();
 const direct={storageLayout:'DOCUMENTS' as const,financialPostingReadiness:'ISOLATED_SQLITE' as const,
  executeSchema:async(sql:string)=>bridge.execute(sql),query:async<T>(sql:string,values:any[])=> (await bridge.query(sql,values)).values as T[],
  executeAtomic:async(statements:any[])=>bridge.executeSet(statements)};
 const exclusive=<T>(work:(sql:typeof direct)=>Promise<T>):Promise<T>=>{const pending=queue.then(()=>work(direct));queue=pending.then(()=>undefined,()=>undefined);return pending;};
 const runFinancial=<T>(work:(sql:typeof direct)=>Promise<T>)=>exclusive(async port=>{
  db.exec('BEGIN IMMEDIATE');let result:T;
  try{result=await work(port);db.exec('COMMIT');}catch(error){if(db.inTransaction)db.exec('ROLLBACK');throw error;}
  if(control.afterCommit)throw Error('injected:afterCommit');return result;
 });
 const sql={...direct,executeAtomic:(statements:any[])=>exclusive(port=>port.executeAtomic(statements)),runExclusive:exclusive,runFinancial};
 return {db,adapter,bridge,control,sql,nativeSQL:adapter.articleFormatSQL()};
}
const read=(db:SQLite.Database,name:string)=> (db.prepare('SELECT data FROM documents WHERE collection_name=? ORDER BY sort_order,doc_id').all(name) as {data:string}[]).map(r=>JSON.parse(r.data));
const state=(db:SQLite.Database)=>({docs:db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),outbox:db.prepare('SELECT * FROM article_format_outbox').all(),wire:db.prepare('SELECT * FROM article_format_wire_events').all(),movements:db.prepare('SELECT * FROM article_format_base_movements').all(),scope:db.prepare('SELECT * FROM article_format_wire_write_scope').all()});
test('isolated exclusive SQLite document batch reconciles stock, finance, bound return and selective ACK',async t=>{
 const f=setup();t.after(()=>f.db.close());const posting=new ArticleFormatPosting(f.sql,context,masters);await posting.migrate();const e=sale();
 const untouched=read(f.db,'inventoryLedger')[0];
 await posting.post(e,opts);await posting.post(e,opts);
 assert.equal(read(f.db,'productStocks')[0].quantity,89);
 assert.equal(read(f.db,'transactions').length,1);assert.equal(read(f.db,'payments').length,1);
 assert.equal(read(f.db,'internalSequences')[0].nextNumber,2);assert.equal(read(f.db,'globalSequenceCounter')[0].count,1);
 assert.deepEqual(read(f.db,'inventoryLedger')[0],untouched);
 await posting.acknowledge(e,await ack(e));
 assert.equal(read(f.db,'transactions')[0].cloudSyncStatus,'SYNCED');
 const l=returnWireLine(e.lines[0],[],'0.5',id(30));
 const r:WireEvent={...e,event_id:id(31),transaction_id:id(32),event_type:'ARTICLE_FORMAT_RETURN_V1',return_context:structuredClone(context.return_context!),source_event_id:e.event_id,lines:[l],payments:[{payment_id:id(33),method:'cash',amount:'540.00'}],totals:wireTotals([l])};delete r.master;
 await posting.post(r,{...opts,seriesId:id(10)});
 assert.equal(read(f.db,'productStocks')[0].quantity,101);
 assert.equal(read(f.db,'transactions')[1].items[0].articleFormat.factor,24);
 const saved=f.db.prepare('SELECT content FROM article_format_outbox WHERE event_id=?').get(r.event_id);
 await drainFormatWireEvents(posting,{request:async()=>{throw new FormatHTTPError(409,'POS_FORMAT_RETURN_CONTEXT_CONFLICT',true);}});
 assert.deepEqual(f.db.prepare('SELECT content FROM article_format_outbox WHERE event_id=?').get(r.event_id),saved);
 assert.equal((await posting.pending()).length,1);
 assert.equal((await posting.pending(Date.now())).length,0);
 assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='collections'").get(),undefined);
 // A format event must not freeze non-format legacy/V3 records.
 f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('transactions','legacy','{"id":"legacy"}',99,'fixture');
 assert.throws(()=>f.db.prepare("DELETE FROM documents WHERE collection_name='transactions' AND doc_id=?").run(e.transaction_id),/LEGACY_WRITER_FORBIDDEN/);
});
test('isolated exclusive SQLite rollback at every document/journal write and uncertain commit preserves stable IDs',async t=>{
 const reference=setup();const refPosting=new ArticleFormatPosting(reference.sql,context,masters);await refPosting.migrate();await refPosting.post(sale(),opts);const count=reference.control.count;reference.db.close();
 for(let i=0;i<=count;i++){
  const f=setup();const posting=new ArticleFormatPosting(f.sql,context,masters);await posting.migrate();const before=state(f.db);f.control.before=i;
  await assert.rejects(posting.post(sale(),opts),/injected/);assert.deepEqual(state(f.db),before,`write${i} rolled back all domains`);f.db.close();
 }
 const f=setup();t.after(()=>f.db.close());const posting=new ArticleFormatPosting(f.sql,context,masters);await posting.migrate();f.control.afterCommit=true;
 await assert.rejects(posting.post(sale(),opts),/afterCommit/);f.control.afterCommit=false;
 const committed=state(f.db);await posting.post(sale(),opts);assert.deepEqual(state(f.db),committed);
});
test('isolated document fixture rejects normalized V3 ownership before any write',async t=>{
 const f=setup();t.after(()=>f.db.close());const posting=new ArticleFormatPosting(f.sql,context,masters);await posting.migrate();
 f.db.exec("CREATE TABLE master_v3_operational_owner(singleton INTEGER PRIMARY KEY,owner TEXT);INSERT INTO master_v3_operational_owner VALUES(1,'V3')");
 const before=state(f.db);await assert.rejects(posting.post(sale(),opts),/V3_POSTING_NOT_READY/);assert.deepEqual(state(f.db),before);
});

test('actual native API rejects every NEW format financial event before master/stock/sequence effects',async t=>{
 const f=setup();t.after(()=>f.db.close());
 for(const statement of androidSQLiteStatements(articleFormatWireSchema('DOCUMENTS'),t))f.db.exec(statement);
 let reads=0;const posting=new ArticleFormatPosting(f.nativeSQL,context,{getActiveRevision:async()=>{reads++;return revision;},getPolicy:async()=>{reads++;return {dto,policy};}});
 await posting.migrate();const before=state(f.db),event=sale();
 const staleStock=read(f.db,'productStocks')[0],staleSequence=read(f.db,'internalSequences')[0];
 for(const eventType of ['ARTICLE_FORMAT_SALE_V1','ARTICLE_FORMAT_RETURN_V1','ARTICLE_FORMAT_VOID_V1'] as const){
  const next:WireEvent={...event,event_type:eventType};
  if(eventType!=='ARTICLE_FORMAT_SALE_V1'){
   delete next.master;Object.assign(next,{source_event_id:id(99),return_context:structuredClone(context.return_context!),lines:event.lines.map(l=>({...l,source_line_id:id(98)}))});
  }
  await assert.rejects(posting.post(next,opts),/NATIVE_POSTING_NOT_READY/);
 }
 assert.equal(reads,0);assert.deepEqual(state(f.db),before);
 await f.adapter.saveDocument('productStocks',staleStock);await f.adapter.saveDocument('internalSequences',staleSequence);
 assert.equal(read(f.db,'productStocks')[0].quantity,137);assert.equal(read(f.db,'internalSequences')[0].nextNumber,1);
 assert.equal(state(f.db).outbox.length,0);
 assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='collections'").get(),undefined);
});
test('native recovery retains existing document event across reopen and ACK replay while new posting stays blocked',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-formats-documents-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'native.sqlite');
 let f=setup(new SQLite(file));let posting=new ArticleFormatPosting(f.sql,context,masters);await posting.migrate();const event=sale();await posting.post(event,opts);
 const pending=await posting.pending();f.db.close();
 f=setup(new SQLite(file),false);t.after(()=>f.db.close());posting=new ArticleFormatPosting(f.nativeSQL,context,masters);await posting.migrate();
 assert.deepEqual(await posting.pending(),pending);await posting.post(event,opts);
 assert.equal(read(f.db,'productStocks')[0].quantity,89);assert.equal(read(f.db,'payments').length,1);
 const originalContent=f.db.prepare('SELECT content FROM article_format_outbox').get();
 const sent:unknown[]=[];
 await drainFormatWireEvents(posting,{request:async(_path,body)=>{sent.push(body);return ack(event);}});
 assert.deepEqual(sent,[event]);assert.equal((await posting.pending()).length,0);
 assert.deepEqual(f.db.prepare('SELECT content FROM article_format_outbox').get(),originalContent);
 assert.equal(read(f.db,'productStocks')[0].quantity,89);
});
