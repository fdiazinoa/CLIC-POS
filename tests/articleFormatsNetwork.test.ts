import assert from 'node:assert/strict';
import test from 'node:test';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { context, id, seedCollections, sqlitePort } from './articleFormatsNetworkFixture';
import { ArticleFormatPosting, saleWireLine, returnWireLine, wireTotals, ARTICLE_FORMAT_WIRE_SCHEMA, drainFormatWireEvents } from '../services/articleFormats/posting';
import { availability } from '../services/articleFormats/domain';
import { wireHash, validateWireEvent, postgresJSON, validateACK, type WireEvent, type FormatACK, FormatHTTPError } from '../services/articleFormats/wire';
import { ARTICLE_FORMAT_NETWORK_SCHEMA } from '../services/articleFormats/networkSchema';
import { androidSQLiteStatements } from './nativeSQLiteParser';
import { openArticleFormatsRuntime } from '../services/articleFormats/runtime';
const base={schemaVersion:1 as const,id:'unit',variantId:null,name:'Unidad',abbreviation:'UN',factor:1,barcode:'',active:true,is_base:true,default_purchase:false,default_sale:false,allow_purchase:true,allow_sale:true,allow_transfer:true,sort_order:0,prices:[]};
const dto={schema_version:1 as const,inventory_quantity_unit:'BASE' as const,item_id:id(7),formats:[base,{...base,id:'pack',name:'Pack6',factor:6,is_base:false,sort_order:1},{...base,id:'case',name:'Caja24',factor:24,is_base:false,sort_order:2,prices:[{tariffId:id(6),price:1080}]}]};
const policy={item_id:id(7),base_unit_cost:'35',variant_ids:[],variant_skus:{},base_prices:[{variant_id:null,tariff_id:id(6),price:'45',tax_included:false}],taxes:[],tax_rate:'0',max_discount_rate:'10',promotions:[],warehouse_id:id(5)};
const revision={syncId:id(11),revision:1,context,revisionChecksum:'a'.repeat(64)};
const masters={getActiveRevision:async()=>revision,getPolicy:async()=>({dto,policy})};
function sale():WireEvent{
 const l=saleWireLine(dto,policy,{lineId:id(14),formatId:'case',variantId:null,tariffId:id(6),quantity:'2',occurredAt:'2026-10-14T12:00:00-04:00',terminalId:id(4)});
 return {schema_version:1,event_id:id(12),transaction_id:id(13),event_type:'ARTICLE_FORMAT_SALE_V1',occurred_at:'2026-10-14T12:00:00-04:00',master:{sync_id:id(11),revision:1},fiscal:{mode:'NONE'},lines:[l],payments:[{payment_id:id(15),method:'cash',amount:'2160.00'}],totals:wireTotals([l])};
}
async function ack(e:WireEvent):Promise<FormatACK>{return {schema_version:1,eventId:e.event_id,applied:true,disposition:'APPLIED',inbox_id:id(20),document_id:id(21),document_code:'F-1',inventory_movement_ids:[id(22)],accounting_entry_ids:[id(23)],payment_entry_id:id(24),inventory_quantity_unit:'BASE',content_hash:await wireHash(e),committed_at:'2026-10-14T17:00:00Z'};}
const opts={seriesId:id(9),userId:id(25),userName:'Synthetic'};
const collection=(db:SQLite.Database,name:string)=>JSON.parse((db.prepare('SELECT value FROM collections WHERE key=?').get(name) as {value:string}).value);
test('real SQLite reconciles sale/payments/sequences/ledger/outbox once and snapshots survive 24→12',async t=>{
 const db=new SQLite(':memory:');t.after(()=>db.close());db.pragma('foreign_keys=ON');seedCollections(db);
 const store=new ArticleFormatPosting(sqlitePort(db),context,masters),e=sale();
 assert.deepEqual([availability(137,1),availability(137,6),availability(137,24)],[137,22,5]);
 await store.post(e,opts);await store.post(e,opts);
 assert.equal(collection(db,'productStocks')[0].quantity,89);assert.equal(collection(db,'inventoryLedger').length,2);
 assert.equal(collection(db,'transactions').length,1);assert.equal(collection(db,'payments').length,1);
 assert.equal(collection(db,'internalSequences')[0].nextNumber,2);assert.equal(collection(db,'globalSequenceCounter')[0].count,1);
 assert.equal((db.prepare('SELECT base_delta FROM article_format_base_movements').get() as {base_delta:number}).base_delta,-480000);
 await assert.rejects(store.post({...e,occurred_at:'2026-10-14T13:00:00-04:00'},opts),/IDENTITY_CONFLICT/);
 await store.acknowledge(e,await ack(e));
 const l=returnWireLine(e.lines[0],[],'0.5',id(30));
 const r:WireEvent={...e,event_id:id(31),transaction_id:id(32),event_type:'ARTICLE_FORMAT_RETURN_V1',source_event_id:e.event_id,lines:[l],payments:[{payment_id:id(33),method:'cash',amount:'540.00'}],totals:wireTotals([l])};delete r.master;
 // The new master changes to 12, but returns consult the original durable source.
 const changed={...masters,getPolicy:async()=>({dto:{...dto,formats:dto.formats.map(f=>f.id==='case'?{...f,factor:12}:f)},policy})};
 const returnStore=new ArticleFormatPosting(sqlitePort(db),context,changed);
 await returnStore.post(r,{...opts,seriesId:id(10)});await returnStore.post(r,{...opts,seriesId:id(10)});
 assert.equal(collection(db,'productStocks')[0].quantity,101);assert.equal(collection(db,'transactions').length,2);
 assert.equal(collection(db,'transactions')[1].items[0].articleFormat.factor,24);
 assert.equal(collection(db,'transactions')[1].items[0].baseQuantity,-12);
});
test('fault before EACH SQLite write and commit rolls back EVERY canonical collection and journal',async t=>{
 // 1 outbox + sale line + movement + 8 collections + wire event = 14 writes.
 for(let boundary=0;boundary<=14;boundary++){
  const db=new SQLite(':memory:');db.pragma('foreign_keys=ON');seedCollections(db);
  const before=JSON.stringify(db.prepare('SELECT * FROM collections ORDER BY key').all());
  const store=new ArticleFormatPosting(sqlitePort(db,{before:boundary}),context,masters);
  await assert.rejects(store.post(sale(),opts),/injected/);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM collections ORDER BY key').all()),before,`boundary ${boundary}`);
  for(const table of ['article_format_outbox','article_format_sale_lines','article_format_base_movements','article_format_wire_events'])assert.equal((db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n,0);
  db.close();
 }
});
test('crash AFTER commit, reopen offline, lost ACK, duplicates, reconnect preserve original IDs',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'clic-format-wire-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));const path=join(folder,'pos.sqlite');
 let db=new SQLite(path);db.pragma('foreign_keys=ON');seedCollections(db);const e=sale();
 await assert.rejects(new ArticleFormatPosting(sqlitePort(db,{afterCommit:true}),context,masters).post(e,opts),/afterCommit/);db.close();
 db=new SQLite(path);db.pragma('foreign_keys=ON');t.after(()=>db.close());const store=new ArticleFormatPosting(sqlitePort(db),context,masters);
 await store.post(e,opts);assert.equal(collection(db,'productStocks')[0].quantity,89);const original=JSON.stringify((await store.pending())[0].event);
 await drainFormatWireEvents(store,{request:async()=>{throw new Error('timeout after remote commit');}});
 assert.equal(JSON.stringify((await store.pending(Number.MAX_SAFE_INTEGER))[0].event),original);
 await store.retryHeld();await drainFormatWireEvents(store,{request:async()=>({applied:true,eventId:e.event_id})});
 assert.equal((db.prepare('SELECT state FROM article_format_outbox').get() as {state:string}).state,'PENDING');
 await store.retryHeld();await drainFormatWireEvents(store,{request:async()=>ack(e)});
 assert.equal((await store.pending()).length,0);assert.equal(collection(db,'productStocks')[0].quantity,89);
});
test('admission closed leaves pending without legacy downgrade or fake ACK; applied receipt can recover',async t=>{
 const db=new SQLite(':memory:');t.after(()=>db.close());seedCollections(db);const store=new ArticleFormatPosting(sqlitePort(db),context,masters),e=sale();await store.post(e,opts);
 await drainFormatWireEvents(store,{request:async()=>{throw new FormatHTTPError(403,'POS_FORMAT_FORBIDDEN',false);}});
 assert.equal((await store.pending(Number.MAX_SAFE_INTEGER)).length,1);await store.retryHeld();await drainFormatWireEvents(store,{request:async()=>ack(e)});assert.equal((await store.pending()).length,0);
});
test('strict decimals, zero tariff override, fallback and JSONB hash contract',async()=>{
 const zero={...dto,formats:dto.formats.map(f=>f.id==='case'?{...f,prices:[{tariffId:id(6),price:0}]}:f)};
 const input={lineId:id(14),formatId:'case',variantId:null,tariffId:id(6),quantity:'2',occurredAt:'2026-10-14T12:00:00Z',terminalId:id(4)};
 assert.equal(saleWireLine(zero,policy,input).commercial_unit_price,'0');
 assert.equal(saleWireLine({...dto,formats:dto.formats.map(f=>({...f,prices:[]}))},policy,input).commercial_unit_price,'1080');
 const e=sale();assert.throws(()=>validateWireEvent({...e,lines:[{...e.lines[0],base_unit_cost:35}]}),/DECIMAL/);
 assert.throws(()=>validateWireEvent({...e,lines:[{...e.lines[0],commercial_quantity:'0.00001'}]}),/PRECISION/);
 assert.equal(postgresJSON({bbb:1,a:2,aa:'x'}),'{"a": 2, "aa": "x", "bbb": 1}');
 const receipt=await ack(e);assert.throws(()=>validateACK({...receipt,content_hash:'wrong'},e,'expected'),/ACK_INVALID/);
});
test('operational runtime cannot negotiate with flag+capability alone',async()=>{
 let requests=0;
 await assert.rejects(openArticleFormatsRuntime({} as any,{request:async()=>{requests++;}},{featureFlags:{ARTICLE_FORMATS:true}},{id:id(4),capabilities:{article_formats:1}}),/NOT_NEGOTIATED/);
 assert.equal(requests,0);
});
test('native Java parser accepts additive network and wire schema on real SQLite',t=>{
 const db=new SQLite(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
 // Existing journal supplies wire FK parent; schema under test uses actual Android parser.
 seedCollections(db);for(const statement of androidSQLiteStatements(ARTICLE_FORMAT_NETWORK_SCHEMA+ARTICLE_FORMAT_WIRE_SCHEMA,t))db.exec(statement);
});

test('SQLite fence rejects stale legacy financial/stock writers after native format commit',async t=>{
 const db=new SQLite(':memory:');t.after(()=>db.close());seedCollections(db);
 const stale=collection(db,'globalSequenceCounter');stale[0].count++;
 const store=new ArticleFormatPosting(sqlitePort(db),context,masters);await store.post(sale(),opts);
 assert.throws(()=>db.prepare('UPDATE collections SET value=? WHERE key=?').run(JSON.stringify(stale),'globalSequenceCounter'),/LEGACY_WRITER_FORBIDDEN/);
 assert.equal(collection(db,'globalSequenceCounter')[0].count,1);
 assert.throws(()=>db.prepare('UPDATE collections SET value=? WHERE key=?').run('[]','inventoryLedger'),/LEGACY_WRITER_FORBIDDEN/);
 assert.equal((db.prepare('SELECT COUNT(*) n FROM article_format_wire_write_scope').get() as {n:number}).n,0);
 await store.acknowledge(sale(),await ack(sale()));
});
test('return faults between each write and commit roll back payments, source capacity, stock and outbox',async()=>{
 for(let boundary=0;boundary<=14;boundary++){
  const db=new SQLite(':memory:');db.pragma('foreign_keys=ON');seedCollections(db);const e=sale();
  const store=new ArticleFormatPosting(sqlitePort(db),context,masters);await store.post(e,opts);await store.acknowledge(e,await ack(e));
  const l=returnWireLine(e.lines[0],[],'0.5',id(40));const r:WireEvent={...e,event_id:id(41),transaction_id:id(42),event_type:'ARTICLE_FORMAT_RETURN_V1',source_event_id:e.event_id,
   lines:[l],payments:[{payment_id:id(43),method:'cash',amount:'540.00'}],totals:wireTotals([l])};delete r.master;
  const before=JSON.stringify(db.prepare('SELECT * FROM collections ORDER BY key').all());
  await assert.rejects(new ArticleFormatPosting(sqlitePort(db,{before:boundary}),context,masters).post(r,{...opts,seriesId:id(10)}),/injected/);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM collections ORDER BY key').all()),before);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM article_format_returns').get() as {n:number}).n,0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM article_format_wire_events').get() as {n:number}).n,1);db.close();
 }
});
test('partial return final line receives exact historical cent remainder',()=>{
 const old={...sale().lines[0],commercial_quantity:'1',base_quantity:'24',net_amount:'0.01',tax_amount:'0.00',discount_amount:'0.00',total_amount:'0.01'};
 const a=returnWireLine(old,[],'0.3333',id(40)),b=returnWireLine(old,[a],'0.3333',id(41)),c=returnWireLine(old,[a,b],'0.3334',id(42));
 assert.equal(a.net_amount,'0.00');assert.equal(b.net_amount,'0.00');assert.equal(c.net_amount,'0.01');
});
test('physical DAMAGED and NO_RETURN from negotiated ERP context do not return sellable stock',async()=>{
 for(const return_policy of ['DAMAGED','NO_RETURN'] as const){
  const db=new SQLite(':memory:');db.pragma('foreign_keys=ON');seedCollections(db);const e=sale();
  const store=new ArticleFormatPosting(sqlitePort(db),context,masters);await store.post(e,opts);await store.acknowledge(e,await ack(e));
  const l=returnWireLine(e.lines[0],[],'0.5',id(50)),r:WireEvent={...e,event_id:id(51),transaction_id:id(52),event_type:'ARTICLE_FORMAT_RETURN_V1',source_event_id:e.event_id,
   lines:[l],payments:[{payment_id:id(53),method:'cash',amount:'540.00'}],totals:wireTotals([l])};delete r.master;
  await new ArticleFormatPosting(sqlitePort(db),{...context,return_policy},masters).post(r,{...opts,seriesId:id(10)});
  assert.equal(collection(db,'productStocks')[0].quantity,89);assert.equal(collection(db,'inventoryLedger').at(-1).reversedCOGS,'0.00');db.close();
 }
});
test('LEGACY_B consumes assigned terminal fiscal buffer in same transaction and rolls back on failure',async()=>{
 const db=new SQLite(':memory:');db.pragma('foreign_keys=ON');seedCollections(db);const e=sale();e.fiscal={mode:'LEGACY_B',ncf_type:'B02',ncf:'B0200000001'};
 db.prepare('INSERT INTO collections VALUES(?,?,?)').run('localFiscalBuffer',JSON.stringify([{id:'B02',type:'B02',prefix:'B02',currentNumber:1,endNumber:10,expiryDate:'2027-01-01',terminalId:context.scope.terminalId}]),'fixture');
 await assert.rejects(new ArticleFormatPosting(sqlitePort(db,{before:13}),context,masters).post(e,opts),/injected/);
 assert.equal(collection(db,'localFiscalBuffer')[0].currentNumber,1);
 await new ArticleFormatPosting(sqlitePort(db),context,masters).post(e,opts);
 assert.equal(collection(db,'localFiscalBuffer')[0].currentNumber,2);db.close();
});
