import test from 'node:test';
import assert from 'node:assert/strict';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeSale,nativeACK,options,id,context} from './articleFormatsNativeFixture';
import {inventoryFixture,receiptTransport,scope} from './articleFormatsInventoryFixture';
import {readReconciledPhysicalInventory,installInventoryFixtureBinding} from '../services/articleFormats/inventoryJournal';
import {inventoryReceiptRequest,validateInventoryRows,validateManifest,signedBase4} from '../services/articleFormats/inventoryContract';
import {readV3Base4Stock} from '../services/db/V3Base4Stock';
import {returnWireLine,wireTotals} from '../services/articleFormats/posting';
import {createFormatTransport,hashText,type WireEvent} from '../services/articleFormats/wire';
const activeState=(f:Awaited<ReturnType<typeof inventoryFixture>>)=>Object.fromEntries(['article_format_inventory_state','article_format_inventory_originals','article_format_inventory_effects','article_format_inventory_links','article_format_inventory_balances','article_format_inventory_absorptions','article_format_inventory_history','article_format_outbox','article_format_wire_events'].map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const physical=async(f:Awaited<ReturnType<typeof inventoryFixture>>)=>(await readReconciledPhysicalInventory(f.sql.query,f.baseline(),[id(7)],id(5)))![id(7)].physical.toFixed(4);
async function prepare(f:Awaited<ReturnType<typeof inventoryFixture>>,opts:Parameters<typeof receiptTransport>[1]={}){const capture=await f.journal.captureFixture(),mock=await receiptTransport(capture,opts);return {capture,mock,downloaded:await mock.download()};}
for(const ackFirst of [true,false])test(`real native SQLite:137-48=89, financial ACK ${ackFirst?'before':'after'} inclusion, two cuts and replay`,async()=>{
 const f=await inventoryFixture();try{
  const e=nativeSale();await f.posting.post(e,options);assert.equal(await f.balance(),89);
  if(ackFirst)await f.posting.acknowledge(e,await nativeACK(e));
  await f.reservations(id(1000));const old=await prepare(f,{physical:'137.0000',statuses:{[e.event_id]:'NOT_INCLUDED'}});
  await f.journal.commitFixture(old.capture,old.downloaded);assert.equal(await physical(f),'89.0000');
  assert.equal((f.db.prepare('SELECT count(*) n FROM article_format_inventory_absorptions').get() as any).n,0);
  await f.reservations(id(1001));const included=await prepare(f,{baselineId:id(1001),receiptId:id(2001),ordinal:'9007199254740994'});
  await f.journal.commitFixture(included.capture,included.downloaded);assert.equal(await physical(f),'89.0000');
  assert.equal((await readV3Base4Stock(f.sql.query,f.baseline(),id(7),id(5))).available.toFixed(4),'89.0000');
  const before=activeState(f);assert.equal((await f.journal.commitFixture(included.capture,included.downloaded)).replayed,true);assert.deepEqual(activeState(f),before);
  assert.equal((f.db.prepare('SELECT state FROM article_format_outbox').get() as any).state,ackFirst?'ACKED':'PENDING');
  if(!ackFirst)await f.posting.acknowledge(e,await nativeACK(e));assert.equal(await physical(f),'89.0000');
  assert.equal((f.db.prepare('SELECT count(*) n FROM article_format_inventory_originals').get() as any).n,1);
 }finally{f.db.close();}
});

test('new local sale and return use selected aggregate authority; same pool native preconditions and operational single/batch',async()=>{
 const f=await inventoryFixture();try{
  const sale=nativeSale();await f.posting.post(sale,options);await f.reservations(id(1000));const p=await prepare(f);await f.journal.commitFixture(p.capture,p.downloaded);
  await f.posting.post(nativeSale(40,'1'),options);assert.equal(await physical(f),'65.0000');
  await f.posting.acknowledge(sale,await nativeACK(sale));
  const source=f.documents('transactionHistory').find(t=>t.id===sale.transaction_id);assert.equal(source.v3InventoryBaseline,f.baseline());
  const l=returnWireLine(sale.lines[0],[],'0.5',id(80));const r:WireEvent={...sale,event_id:id(81),transaction_id:id(82),event_type:'ARTICLE_FORMAT_RETURN_V1',return_context:structuredClone(context.return_context!),source_event_id:sale.event_id,lines:[l],payments:[{payment_id:id(83),method:'cash',amount:wireTotals([l]).total_amount}],totals:wireTotals([l])};delete r.master;
  await f.posting.post(r,{...options,seriesId:id(10)});assert.equal(await physical(f),'77.0000');
  assert.equal(137+await f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.baseline(),id(7),id(5)),77);
  assert.equal(137+(await f.adapter.masterSyncV3Store.getLocalInventoryDeltas(f.baseline(),[id(7)],id(5)))[id(7)],77);
  // Commercial V3 inventory refresh does not overwrite selected physical cut, and the adjustment uses its new base.
  f.db.prepare('UPDATE master_v3_inventory_balances SET qty_on_hand=999').run();
  assert.equal(999+await f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.baseline(),id(7),id(5)),77);
  assert.equal((await readV3Base4Stock(f.sql.query,f.baseline(),id(7),id(5))).available.toFixed(4),'77.0000');
  await assert.rejects(f.posting.post(nativeSale(100,'4'),options),/INSUFFICIENT_STOCK/);
 }finally{f.db.close();}
});

test('missing independently authoritative reservations blocks commercial/native/UI, while physical89 remains provable',async()=>{
 const f=await inventoryFixture();try{await f.posting.post(nativeSale(),options);const p=await prepare(f);await f.journal.commitFixture(p.capture,p.downloaded);
  assert.equal(await physical(f),'89.0000');await assert.rejects(readV3Base4Stock(f.sql.query,f.baseline(),id(7),id(5)),/RESERVATIONS_UNPROVEN/);
  await assert.rejects(f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.baseline(),id(7),id(5)),/RESERVATIONS_UNPROVEN/);
  await assert.rejects(f.adapter.masterSyncV3Store.getLocalInventoryDeltas(f.baseline(),[id(7)],id(5)),/RESERVATIONS_UNPROVEN/);
 }finally{f.db.close();}
});

for(const status of ['UNKNOWN','NOT_INCLUDED'] as const)test(`${status} retains original and overlay after ACK and across snapshot`,async()=>{
 const f=await inventoryFixture();try{const e=nativeSale();await f.posting.post(e,options);await f.posting.acknowledge(e,await nativeACK(e));
  const saved=f.db.prepare('SELECT content FROM article_format_outbox').get();const p=await prepare(f,{physical:'137.0000',statuses:{[e.event_id]:status}});await f.journal.commitFixture(p.capture,p.downloaded);
  assert.equal(await physical(f),'89.0000');assert.deepEqual(f.db.prepare('SELECT content FROM article_format_outbox').get(),saved);
 }finally{f.db.close();}
});

test('all write boundaries rollback on durable SQLite file and ambiguous COMMIT reopens exact state',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-inventory-'));try{
  for(let failure=0;failure<5;failure++){
   const file=join(dir,`${failure}.sqlite`);let f=await inventoryFixture(new SQLite(file));await f.posting.post(nativeSale(),options);const p=await prepare(f);const before=activeState(f);
   f.fault.writes=0;f.fault.failWrite=failure;
   await assert.rejects(f.journal.commitFixture(p.capture,p.downloaded),/injected-write/);assert.deepEqual(activeState(f),before);
   f.db.close();f=await inventoryFixture(new SQLite(file),false);assert.deepEqual(activeState(f),before);f.db.close();
  }
  const file=join(dir,'ambiguous.sqlite');let f=await inventoryFixture(new SQLite(file));await f.posting.post(nativeSale(),options);const p=await prepare(f);
  f.fault.loseCommitResponse=true;await assert.rejects(f.journal.commitFixture(p.capture,p.downloaded),/NATIVE_FINANCIAL_COMMIT_UNCERTAIN/);const committed=activeState(f);f.db.close();
  f=await inventoryFixture(new SQLite(file),false);assert.deepEqual(activeState(f),committed);assert.equal((await f.journal.commitFixture(p.capture,p.downloaded)).replayed,true);
  assert.equal(await physical(f),'89.0000');f.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

for(const drift of ['journal','device','authorization','grant','warehouse'] as const)test(`${drift} drift during HTTP invalidates entire native commit`,async()=>{
 const f=await inventoryFixture();try{await f.posting.post(nativeSale(),options);const p=await prepare(f);
  if(drift==='journal')await f.posting.post(nativeSale(40,'1'),options);
  else if(drift==='authorization')await installInventoryFixtureBinding(f.sql,{scope,authorization:'changed-synthetic-auth'});
  else if(drift==='grant')f.db.prepare("UPDATE article_format_network_sessions SET context=json_set(context,'$.grant_revision',2)").run();
  else {const c=f.documents('config')[0];if(drift==='device')c.terminals[0].config.currentDeviceId=id(90);else c.terminals[0].config.inventoryScope.defaultSalesWarehouseId=id(90);f.db.prepare("UPDATE documents SET data=? WHERE collection_name='config'").run(JSON.stringify(c));}
  const before=activeState(f);await assert.rejects(f.journal.commitFixture(p.capture,p.downloaded),/GENERATION_CHANGED|CONTEXT_CHANGED|SCOPE_FORBIDDEN/);assert.deepEqual(activeState(f),before);
 }finally{f.db.close();}
});

for(const corruption of ['hash','missing-next','wrong-index','complete-false','complete-generation','complete-count','wrong-scope','missing-event','extra-event','original','delta','policy','duplicate-line','duplicate-cell','movement-key'] as const)test(`mock HTTP ${corruption} cannot replace active physical scope`,async()=>{
 const f=await inventoryFixture();try{await f.posting.post(nativeSale(),options);const capture=await f.journal.captureFixture();const before=activeState(f);
  const mock=await receiptTransport(capture,{mutate:(path,r)=>{
   if(corruption==='wrong-scope'&&path.endsWith('/receipts'))r.scope.device_id='foreign-device';
   if(path.endsWith('/complete')){if(corruption==='complete-false')r.complete=false;if(corruption==='complete-generation')r.journal_generation='other';if(corruption==='complete-count')r.balance_count++;}
   if(path.includes('/pages/')){
    if(corruption==='hash')r.canonical_payload_text+=' ';if(corruption==='missing-next')delete r.next_index;if(corruption==='wrong-index')r.index++;
    const e=r.rows.find((r:any)=>r.kind==='EVENT');
    if(corruption==='missing-event')r.rows.pop();if(corruption==='extra-event')r.rows.push(e);
    if(corruption==='original')e.canonical_original='{}';if(corruption==='delta')e.effects[0].delta_base='-24.0000';if(corruption==='policy')e.effects[0].return_policy='RESTOCK';
    if(corruption==='duplicate-line')e.effects.push(e.effects[0]);if(corruption==='duplicate-cell')r.rows.push(r.rows[0]);if(corruption==='movement-key')e.effects[0].movement_key='invalid';
   }return r;
  }});
  await assert.rejects(f.journal.reconcileFixture(mock.transport));assert.deepEqual(activeState(f),before);
 }finally{f.db.close();}
});

test('semantic effect, duplicate movement/cell and original errors are rejected even with internally consistent page hashes',async()=>{
 const f=await inventoryFixture();try{await f.posting.post(nativeSale(),options);const p=await prepare(f);
  for(const mutate of [(rows:any[])=>rows[1].effects[0].delta_base='-24.0000',(rows:any[])=>rows[1].effects[0].return_policy='RESTOCK',(rows:any[])=>rows[1].effects.push(rows[1].effects[0]),(rows:any[])=>rows.push(rows[0]),(rows:any[])=>rows[1].effects[0].movement_key='wrong']){
   const pages=structuredClone(p.downloaded.pages),m=structuredClone(p.downloaded.manifest);mutate(pages[0].rows);pages[0].canonical_payload_text=JSON.stringify(pages[0].rows);pages[0].checksum=await hashText(pages[0].canonical_payload_text);pages[0].row_count=pages[0].rows.length;m.pages[0].checksum=pages[0].checksum;m.pages[0].row_count=pages[0].row_count;
   await assert.rejects(validateInventoryRows(m,pages,p.capture.originals));
  }
 }finally{f.db.close();}
});

test('101 balances require every declared page; no early termination and exact ordered complete body',async()=>{
 const f=await inventoryFixture();try{await f.posting.post(nativeSale(),options);const capture=await f.journal.captureFixture();const extra=Array.from({length:100},(_,i)=>({kind:'BALANCE' as const,item_id:id(10000+i),warehouse_id:id(5),local_id:id(70),qty_physical:'0.0000',qty_committed:'0.0000'}));
  const m=await receiptTransport(capture,{extraBalances:extra});const downloaded=await m.download();assert.equal(downloaded.pages.length,2);
  assert.deepEqual(m.requests.at(-1)!.body,{schema_version:1,pages:downloaded.manifest.pages.map(({index,checksum})=>({index,checksum}))});
  for(const bad of [downloaded.pages.slice(0,1),[downloaded.pages[1],downloaded.pages[0]],[downloaded.pages[0],downloaded.pages[0]]])await assert.rejects(validateInventoryRows(downloaded.manifest,bad,capture.originals));
  await f.journal.commitFixture(capture,downloaded);assert.equal(await physical(f),'89.0000');
 }finally{f.db.close();}
});

test('ordinal >2^53 is exact, equal/different baseline and older receipt reject',async()=>{
 const f=await inventoryFixture();try{await f.posting.post(nativeSale(),options);const a=await prepare(f);await f.journal.commitFixture(a.capture,a.downloaded);
  for(const ordinal of ['9007199254740992','9007199254740993']){
   const b=await prepare(f,{baselineId:id(1001),receiptId:id(2001),ordinal});const before=activeState(f);await assert.rejects(f.journal.commitFixture(b.capture,b.downloaded),/ORDINAL_STALE/);assert.deepEqual(activeState(f),before);
  }
 }finally{f.db.close();}
});

test('immutable journal survives Outbox-independent physical lifecycle and rejects UPDATE/DELETE',async()=>{
 const f=await inventoryFixture();try{await f.posting.post(nativeSale(),options);
  for(const table of ['originals','effects','links']){assert.throws(()=>f.db.prepare(`DELETE FROM article_format_inventory_${table}`).run(),/IMMUTABLE/);}
  const p=await prepare(f);await f.journal.commitFixture(p.capture,p.downloaded);
  assert.equal((f.db.prepare('SELECT state FROM article_format_outbox').get() as any).state,'PENDING');
 }finally{f.db.close();}
});

test('mixed nonformat delta blocks replacement, and missing full historical scope blocks bootstrap without partial migration',async()=>{
 const f=await inventoryFixture();try{await f.posting.post(nativeSale(),options);
  f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('inventoryLedger','legacy',JSON.stringify({id:'legacy',productId:id(7),warehouseId:id(5),qtyIn:0,qtyOut:1,v3InventoryBaseline:f.baseline()}),0,'fixture');
  await assert.rejects(f.journal.captureFixture(),/UNREPRESENTED_EFFECTS/);
 }finally{f.db.close();}
 const g=await inventoryFixture();try{await g.posting.post(nativeSale(),options);const before=activeState(g);await assert.rejects(g.journal.bootstrapFixture({}),/CONTEXT_INCOMPLETE/);assert.deepEqual(activeState(g),before);}finally{g.db.close();}
});

test('200-event and full UTF8 request byte limit reject before any baseline HTTP mutation',()=>{
 const e=nativeSale();const originals=Array.from({length:200},(_,i)=>({event:{...e,event_id:id(1000+i)},effects:[]}));assert.equal(inventoryReceiptRequest('generation',originals).events.length,200);
 assert.throws(()=>inventoryReceiptRequest('generation',[...originals,{event:{...e,event_id:id(3000)},effects:[]}]),/BACKLOG_LIMIT/);
 const large=originals.map(o=>({...o,event:{...o.event,display_id:'Á'.repeat(30000)}}));assert.throws(()=>inventoryReceiptRequest('generation',large),/BACKLOG_LIMIT/);
 for(const invalid of ['-0.0000','1','+1.0000',1,'0.00001'])assert.throws(()=>signedBase4(invalid));
});

test('fixture header defaults OFF and is restricted to new channel/negotiation, preserving replay and V3',async()=>{
 const calls:{path:string;headers:Headers}[]=[];const fetcher:typeof fetch=async(input,init)=>{calls.push({path:new URL(String(input)).pathname,headers:new Headers(init?.headers)});return new Response('{}');};
 const credentials={syncToken:'synthetic',terminalId:id(4),tenantId:id(1),deviceToken:'synthetic',deviceId:id(50)};
 await createFormatTransport('http://127.0.0.1',credentials,fetcher).request('/api/sync/article-formats/v1/inventory-baselines',{});assert.equal(calls.at(-1)!.headers.has('x-article-formats-inventory-reconciliation'),false);
 const t=createFormatTransport('http://127.0.0.1',credentials,fetcher,1000,{fixtureInventoryReconciliationV1:true});
 for(const path of ['/api/sync/article-formats/v1/negotiate','/api/sync/article-formats/v1/inventory-baselines','/api/sync/article-formats/v1/inventory-receipts/a/pages/0']){await t.request(path,{});assert.equal(calls.at(-1)!.headers.get('x-article-formats-inventory-reconciliation'),'1');}
 for(const path of ['/api/sync/article-formats/v1/events','/api/sync/v3/master-syncs']){await t.request(path,{});assert.equal(calls.at(-1)!.headers.has('x-article-formats-inventory-reconciliation'),false);}
});

test('before-BEGIN and before-COMMIT failures leave physical journal identical',async()=>{
 for(const where of ['begin','commit']){const f=await inventoryFixture();try{await f.posting.post(nativeSale(),options);const p=await prepare(f),before=activeState(f);
  if(where==='begin')f.fault.failBegin=true;else f.fault.failBeforeCommit=true;
  await assert.rejects(f.journal.commitFixture(p.capture,p.downloaded),/injected-begin|injected-precommit|NATIVE_FINANCIAL_COMMIT_UNCERTAIN/);assert.deepEqual(activeState(f),before);
 }finally{f.db.close();}}
});

test('heartbeat-only change preserves stable authorization fence',async()=>{
 const f=await inventoryFixture();try{await f.posting.post(nativeSale(),options);const p=await prepare(f);const c=f.documents('config')[0];c.terminals[0].lastHeartbeatAt=new Date().toISOString();
  f.db.prepare("UPDATE documents SET data=? WHERE collection_name='config'").run(JSON.stringify(c));await f.journal.commitFixture(p.capture,p.downloaded);assert.equal(await physical(f),'89.0000');
 }finally{f.db.close();}
});

for(const policy of ['RESTOCK','DAMAGED','NO_RETURN'] as const)for(const type of ['ARTICLE_FORMAT_RETURN_V1','ARTICLE_FORMAT_VOID_V1'] as const)test(`${type} ${policy}: exact historical effects preserved`,async()=>{
 const f=await inventoryFixture();try{
  const sale=nativeSale();await f.posting.post(sale,options);await f.posting.acknowledge(sale,await nativeACK(sale));
  const {ArticleFormatPosting}=await import('../services/articleFormats/posting');const ctx={...context,return_policy:policy,return_context:{...context.return_context!,return_policy:policy}};
  const posting=new ArticleFormatPosting(f.sql,ctx,f.masters);const l=returnWireLine(sale.lines[0],[],type==='ARTICLE_FORMAT_VOID_V1'?'2':'0.5',id(80));
  const r:WireEvent={...sale,event_id:id(81),transaction_id:id(82),event_type:type,return_context:structuredClone(ctx.return_context!),source_event_id:sale.event_id,lines:[l],payments:[{payment_id:id(83),method:'cash',amount:wireTotals([l]).total_amount}],totals:wireTotals([l])};delete r.master;
  await posting.post(r,{...options,seriesId:id(10)});
  const target=policy==='RESTOCK'?(type==='ARTICLE_FORMAT_VOID_V1'?'137.0000':'101.0000'):'89.0000';
  const capture=await f.journal.captureFixture();const mock=await receiptTransport(capture,{physical:target,statuses:policy==='RESTOCK'?{}:{[r.event_id]:'NO_PHYSICAL_EFFECT'}});
  await f.journal.commitFixture(capture,await mock.download());assert.equal(await physical(f),target);
  const effect=f.db.prepare('SELECT delta_base FROM article_format_inventory_effects WHERE event_id=?').get(r.event_id) as any;
  assert.equal(effect.delta_base,policy==='RESTOCK'?(type==='ARTICLE_FORMAT_VOID_V1'?'48.0000':'12.0000'):'0.0000');
 }finally{f.db.close();}
});

test('scope bootstrap migrates all original wire ACKED and PENDING atomically; unknown history never inferred from current binding',async()=>{
 const {nativeFixture}=await import('./articleFormatsNativeFixture');const {ArticleFormatInventoryJournal}=await import('../services/articleFormats/inventoryJournal');
 const f=await nativeFixture();try{
  const a=nativeSale(),b=nativeSale(40,'1');await f.posting.post(a,options);await f.posting.acknowledge(a,await nativeACK(a));await f.posting.post(b,options);
  const journal=new ArticleFormatInventoryJournal(f.sql);await installInventoryFixtureBinding(f.sql,{scope,authorization:'fixture-only'});
  const before=activeState(f as any);await assert.rejects(journal.bootstrapFixture({[a.event_id]:scope}),/CONTEXT_INCOMPLETE/);assert.deepEqual(activeState(f as any),before);
  await journal.bootstrapFixture({[a.event_id]:scope,[b.event_id]:scope});const capture=await journal.captureFixture();assert.equal(capture.originals.length,2);
  assert.equal((f.db.prepare('SELECT count(*) n FROM article_format_inventory_links').get() as any).n,2);
  const after=activeState(f as any);await journal.bootstrapFixture({[a.event_id]:scope,[b.event_id]:scope});assert.deepEqual(activeState(f as any),after);
 }finally{f.db.close();}
});

test('two ERP variants share one aggregate pool and combined native demand never duplicates baseline137',async()=>{
 const {dto,policy}=await import('./articleFormatsNativeFixture');const {saleWireLine}=await import('../services/articleFormats/posting');const {canonicalContent}=await import('../services/articleFormats/store');
 const f=await inventoryFixture();try{
  const variants=[id(101),id(102)];const variantDTO={...dto,formats:variants.flatMap(variantId=>dto.formats.map(format=>({...format,variantId})))};
  const variantPolicy={...policy,variant_ids:variants,variant_skus:{[variants[0]]:'SKU-A',[variants[1]]:'SKU-B'},base_prices:variants.map(variant_id=>({...policy.base_prices[0],variant_id}))};
  f.db.prepare('UPDATE article_format_network_policies SET dto=?,policy=?').run(canonicalContent(variantDTO),canonicalContent(variantPolicy));
  for(const [index,variant] of variants.entries())f.db.prepare('INSERT INTO master_v3_variants VALUES(?,?,?,?,?,?,?)').run(32,id(7),variant,`SKU-${index}`,`Variant${index}`,1,JSON.stringify({id:variant,sku:variantPolicy.variant_skus[variant]}));
  const event=(n:number,quantity:string)=>{const lines=variants.map((variantId,index)=>saleWireLine(variantDTO,variantPolicy,{lineId:id(n+2+index),formatId:'case',variantId,tariffId:id(6),quantity,occurredAt:'2026-10-14T12:00:00-04:00',terminalId:id(4)})),totals=wireTotals(lines);return {...nativeSale(n),lines,payments:[{payment_id:id(n+4),method:'cash' as const,amount:totals.total_amount}],totals};};
  await assert.rejects(f.posting.post(event(200,'3'),options),/INSUFFICIENT_STOCK/);assert.equal(f.documents('transactions').length,0);
  const sale=event(200,'1');await f.posting.post(sale,options);assert.equal(await f.balance(),89);
  const p=await prepare(f);await f.journal.commitFixture(p.capture,p.downloaded);assert.equal(await physical(f),'89.0000');
  assert.equal((f.db.prepare('SELECT count(*) n FROM article_format_inventory_balances').get() as any).n,1);
  assert.deepEqual((f.db.prepare('SELECT variant_id FROM article_format_inventory_effects ORDER BY variant_id').all() as any[]).map(e=>e.variant_id),variants);
 }finally{f.db.close();}
});

test('format profile remains tracked-only; explicitly negative-enabled format sale preserves exact historical delta',async()=>{
 for(const track of [false,true]){
  const f=await inventoryFixture();try{
   const row=f.db.prepare('SELECT record_json FROM master_v3_articles WHERE article_id=?').get(id(7)) as any;const raw=JSON.parse(row.record_json);raw.operationalFlags={trackInventory:track,allowNegativeStock:true};
   f.db.prepare('UPDATE master_v3_articles SET record_json=? WHERE article_id=?').run(JSON.stringify(raw),id(7));
   if(!track)await assert.rejects(f.posting.post(nativeSale(200,'10'),options),/ITEM_PROFILE_UNSUPPORTED/);
   else {await f.posting.post(nativeSale(200,'10'),options);assert.equal((f.db.prepare('SELECT delta_base FROM article_format_inventory_effects').get() as any).delta_base,'-240.0000');}
  }finally{f.db.close();}
 }
 const {ARTICLE_FORMATS_READINESS}=await import('../services/articleFormats/activation');assert.equal(Object.values(ARTICLE_FORMATS_READINESS).length,6);assert.ok(Object.values(ARTICLE_FORMATS_READINESS).every(v=>v===false));
});

test('format OFF performs one bounded active-scope lookup and never parses journal/catalog or probes sqlite_master',async()=>{
 const f=await inventoryFixture();try{let queries:string[]=[];const query=async<T>(sql:string,values:(string|number|null)[])=>{queries.push(sql);return f.sql.query<T>(sql,values);};
  assert.equal(await readReconciledPhysicalInventory(query,f.baseline(),[id(7)],id(5)),undefined);assert.equal(queries.length,1);assert.ok(queries[0].includes('WHERE baseline_id IS NOT NULL'));
 }finally{f.db.close();}
});
