import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import SQLite from 'better-sqlite3';
import {sqlitePort,seedCollections,id} from './articleFormatsNetworkFixture';
import {prepareArticleFormatsAdapters} from '../services/articleFormats/runtime';
import {saleWireLine,returnWireLine,wireTotals,drainFormatWireEvents} from '../services/articleFormats/posting';
import {createFormatTransport,uuid,type WireEvent,type NetworkContext,validateACK,wireHash} from '../services/articleFormats/wire';

const fixturePath=process.env.CLIC_FORMATS_LOCAL_FIXTURE;
// A separate fresh PostgreSQL fixture is required for this opt-in suite.
// Every policy mutation/recovery below is restricted to that synthetic fixture.
test('original ERP2251 + SQLite: immutable return authorization, conflict hold, explicit recovery and physical policies',
 {skip:!fixturePath,timeout:120000},async t=>{
 const f=JSON.parse(readFileSync(fixturePath!,'utf8')),origin=new URL(f.baseUrl);
 assert.equal(origin.protocol,'http:');assert.ok(['127.0.0.1','localhost','[::1]'].includes(origin.hostname));
 assert.ok(isAbsolute(f.postgresSocket)&&basename(f.postgresSocket).startsWith('clic-formats-pg.'));
 assert.match(f.database,/^clic_formats_contract_\d+$/);
 for(const key of ['tenantId','companyId','terminalId','itemId','tariffId'])uuid(f[key]);
 const bin=process.env.CLIC_FORMATS_PG_BINDIR||'/opt/homebrew/opt/postgresql@17/bin';
 const sql=(s:string)=>execFileSync(join(bin,'psql'),['-X','-q','-A','-t','-h',f.postgresSocket,'-p','55437','-U','postgres','-d',f.database,'-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8'}).trim();
 const query=(s:string):any[]=>JSON.parse(sql(`select coalesce(json_agg(q),'[]'::json) from (${s}) q`));
 assert.match(query("select current_setting('server_version') v")[0].v,/^17\./);
 const stock=()=>query(`select qty_physical::text stock_value from erp_stock_balance where item_id='${f.itemId}'`)[0].stock_value;
 assert.equal(stock(),'137.0000','Start a NEW disposable ERP fixture');
 assert.equal(query(`select count(*)::int n from private.pos_format_events where terminal_id='${f.terminalId}'`)[0].n,0);
 const transport=createFormatTransport(f.baseUrl,f,fetch,15000,{negotiateReturnContextV1:true});
 const legacyTransport=createFormatTransport(f.baseUrl,f);
 const folder=mkdtempSync(join(tmpdir(),'clic-formats-return-erp-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const opened:SQLite.Database[]=[];t.after(()=>opened.forEach(db=>{if(db.open)db.close();}));
 const open=async(name:string)=>{
  let db=new SQLite(join(folder,name+'.sqlite'));opened.push(db);
  const runtime=await prepareArticleFormatsAdapters(sqlitePort(db),transport,f.terminalId);
  const context=runtime.context;seedCollections(db,context,f.itemId,Number(stock()));await runtime.masters.download();
  const collection=(name:string)=>JSON.parse((db.prepare('SELECT value FROM collections WHERE key=?').get(name) as {value:string}).value);
  return {get db(){return db},runtime,context,collection,localStock:()=>collection('productStocks')[0].quantity,
   reopen:async()=>{db.close();db=new SQLite(join(folder,name+'.sqlite'));opened.push(db);return prepareArticleFormatsAdapters(sqlitePort(db),transport,f.terminalId);}};
 };
 const options={seriesId:id(9),userId:randomUUID(),userName:'Synthetic return validator'},returns={...options,seriesId:id(10)};
 const sale=async(session:Awaited<ReturnType<typeof open>>,formatId='case24',quantity='2'):Promise<WireEvent>=>{
  const master=await session.runtime.masters.getPolicy(f.itemId);assert.ok(master);const revision=await session.runtime.masters.getActiveRevision();assert.ok(revision);
  const now=new Date().toISOString(),line=saleWireLine(master.dto,master.policy,{lineId:randomUUID(),formatId,variantId:null,tariffId:f.tariffId,quantity,occurredAt:now,terminalId:f.terminalId});
  const totals=wireTotals([line]);return {schema_version:1,event_id:randomUUID(),transaction_id:randomUUID(),event_type:'ARTICLE_FORMAT_SALE_V1',occurred_at:now,
   master:{sync_id:revision.syncId,revision:revision.revision},fiscal:{mode:'NONE'},lines:[line],payments:[{payment_id:randomUUID(),method:'cash',amount:totals.total_amount}],totals};
 };
 const reversal=(source:WireEvent,ctx:NetworkContext,quantity:string,type:'ARTICLE_FORMAT_RETURN_V1'|'ARTICLE_FORMAT_VOID_V1'):WireEvent=>{
  assert.ok(ctx.return_context);const line=returnWireLine(source.lines[0],[],quantity,randomUUID()),totals=wireTotals([line]);
  return {schema_version:1,event_id:randomUUID(),transaction_id:randomUUID(),event_type:type,occurred_at:new Date().toISOString(),source_event_id:source.event_id,
   return_context:structuredClone(ctx.return_context),fiscal:{mode:'NONE'},lines:[line],payments:[{payment_id:randomUUID(),method:'cash',amount:totals.total_amount}],totals};
 };
 const effects=()=>Object.fromEntries(['erp_sales_documents','erp_sales_document_items','erp_inventory_movements','erp_accounting_journal_entries','erp_accounting_journal_lines','erp_journal_entries','erp_sync_inbox','private.pos_format_events','private.pos_format_payments'].map(table=>[table,query(`select count(*)::int n from ${table}`)[0].n]));
 const grant=(policy:string)=>sql(`update private.pos_format_grants set return_policy='${policy}' where terminal_id='${f.terminalId}'`);
 await t.test('old/headerless negotiation is SALE-only and does not fabricate a return descriptor',async()=>{
  const ctx=await legacyTransport.request('/api/sync/article-formats/v1/negotiate',{});
  assert.deepEqual(ctx.event_types,['ARTICLE_FORMAT_SALE_V1']);assert.equal(ctx.return_policy,null);assert.equal(ctx.return_context,null);assert.equal(ctx.return_context_supported,false);
 });
 await t.test('RESTOCK commit is retained through DAMAGED/NO_RETURN conflict and compatible DBA recovery',async()=>{
  const session=await open('restock'),e=await sale(session);await session.runtime.posting.post(e,options);await session.runtime.drain();
  assert.equal(stock(),'89.0000');const r=reversal(e,session.context,'0.5','ARTICLE_FORMAT_RETURN_V1');
  await session.runtime.posting.post(r,returns);const original=JSON.stringify((await session.runtime.posting.pending())[0].event);
  session.runtime=await session.reopen();
  assert.equal(JSON.stringify((await session.runtime.posting.pending())[0].event),original);
  await session.runtime.posting.post(r,returns); // Reopen/retry never repeats local restock or changes its descriptor.
  assert.equal(session.collection('transactions').length,2);
  assert.equal(session.localStock(),101);assert.equal(stock(),'89.0000');
  const before=effects(),series=query('select id,next_number from erp_document_series order by id');
  for(const policy of ['DAMAGED','NO_RETURN']){
   grant(policy);await session.runtime.posting.retryHeld();await session.runtime.drain();
   assert.deepEqual(effects(),before);assert.deepEqual(query('select id,next_number from erp_document_series order by id'),series);
   assert.equal(stock(),'89.0000');assert.equal(session.localStock(),101);
   assert.equal(JSON.stringify((await session.runtime.posting.pending(Number.MAX_SAFE_INTEGER))[0].event),original);
   const held=session.db.prepare('SELECT last_error,next_attempt,ack FROM article_format_wire_events WHERE event_id=?').get(r.event_id) as any;
   assert.equal(held.last_error,'POS_FORMAT_RETURN_CONTEXT_CONFLICT');assert.equal(held.next_attempt,Number.MAX_SAFE_INTEGER);assert.equal(held.ack,null);
  }
  grant('RESTOCK');await session.runtime.posting.retryHeld();await session.runtime.drain();assert.deepEqual(effects(),before);
  const eventJSON=JSON.stringify(r).replace(/'/g,"''"),actor=randomUUID();
  // Original ERP private helper, executed as owner ONLY inside synthetic socket DB.
  const approval=query(`select private.pos_format_approve_return_recovery('${f.terminalId}','synthetic-device','${eventJSON}'::jsonb,'${actor}','Synthetic authorized test recovery',clock_timestamp()+interval '1 hour')::text id`)[0].id;
  await session.runtime.posting.retryHeld();
  await drainFormatWireEvents(session.runtime.posting,{request:async(path,body)=>{await transport.request(path,body);throw Error('lost real return ACK after original ERP commit');}});
  assert.equal(stock(),'101.0000');assert.equal(session.localStock(),101);
  const historical=query(`select ack from private.pos_format_events where event_id='${r.event_id}'`)[0].ack;
  assert.equal(historical.return_authorization.recovery_id,approval);
  assert.deepEqual(Object.fromEntries(Object.keys(r.return_context!).map(key=>[key,historical.return_authorization[key]])),r.return_context);
  assert.notEqual(historical.return_authorization.admission_grant_revision,r.return_context!.grant_revision);
  sql(`update erp_companies set config=jsonb_set(config,'{featureFlags,ARTICLE_FORMATS}','false') where id='${f.companyId}'`);
  try{await session.runtime.posting.retryHeld();await session.runtime.drain();}
  finally{sql(`update erp_companies set config=jsonb_set(config,'{featureFlags,ARTICLE_FORMATS}','true') where id='${f.companyId}'`);}
  assert.equal((await session.runtime.posting.pending(Number.MAX_SAFE_INTEGER)).length,0);
  assert.deepEqual(JSON.parse((session.db.prepare('SELECT ack FROM article_format_wire_events WHERE event_id=?').get(r.event_id) as any).ack),historical);
  const audit=query(`select original,database_role from private.pos_format_return_recoveries where id='${approval}'`)[0];
  assert.deepEqual(audit.original,r);assert.equal(audit.database_role,'postgres');
  assert.equal(session.collection('transactionHistory')[1].items[0].articleFormat.factor,24);
 });
 for(const policy of ['RESTOCK','DAMAGED','NO_RETURN'] as const){
  await t.test(`${policy}: new authorized RETURN and VOID keep physical stock and COGS consistent`,async()=>{
   grant(policy);const session=await open('policy-'+policy.toLowerCase());assert.equal(session.context.return_context!.return_policy,policy);
   const initial=Number(stock()),e=await sale(session,'pack6','1');await session.runtime.posting.post(e,options);await session.runtime.drain();
   const r=reversal(e,session.context,'0.5','ARTICLE_FORMAT_RETURN_V1');await session.runtime.posting.post(r,returns);await session.runtime.drain();
   const afterReturn=initial-6+(policy==='RESTOCK'?3:0);assert.equal(Number(stock()),afterReturn);assert.equal(session.localStock(),afterReturn);
   const second=await sale(session,'pack6','1');await session.runtime.posting.post(second,options);await session.runtime.drain();
   const v=reversal(second,session.context,'1','ARTICLE_FORMAT_VOID_V1');await session.runtime.posting.post(v,returns);await session.runtime.drain();
   const expected=afterReturn-6+(policy==='RESTOCK'?6:0);assert.equal(Number(stock()),expected);assert.equal(session.localStock(),expected);
   for(const event of [r,v]){
    const ack=query(`select ack from private.pos_format_events where event_id='${event.event_id}'`)[0].ack;
    assert.equal(ack.return_authorization.return_policy,policy);assert.equal(ack.return_authorization.recovery_id,null);
    assert.equal(ack.return_authorization.admission_fingerprint,event.return_context!.fingerprint);
    assert.equal(ack.inventory_movement_ids.length,policy==='RESTOCK'?1:0);
    const cogs=query(`select count(*)::int n from erp_accounting_journal_entries where source_document_id=(select document_id from private.pos_format_events where event_id='${event.event_id}') and source_document_type='SALES_COGS'`);
    assert.equal(cogs[0].n,policy==='RESTOCK'?1:0);
   }
   assert.equal((await session.runtime.posting.pending(Number.MAX_SAFE_INTEGER)).length,0);
   assert.equal(session.collection('transactions').length,4);assert.equal(session.collection('payments').length,4);
   assert.equal(session.collection('globalSequenceCounter')[0].count,4);
  });
 }
 await t.test('pre-extension APPLIED return replays its original ACK after flag-off without authorization backfill',async()=>{
  grant('RESTOCK');const session=await open('historical'),source=await sale(session,'pack6','1');
  await session.runtime.posting.post(source,options);await session.runtime.drain();
  const old=reversal(source,session.context,'0.5','ARTICLE_FORMAT_RETURN_V1');delete old.return_context;
  const before=effects();await assert.rejects(legacyTransport.request(session.context.events_url,old),/RETURN_CONTEXT_REQUIRED/);
  assert.deepEqual(effects(),before);
  assert.ok(typeof f.erpSource==='string'&&isAbsolute(f.erpSource));
  // Use the original2250 function only in this private synthetic database to
  // create an actual pre-extension APPLIED record, then restore2251 immediately.
  const previous=query("select pg_get_functiondef('public.erp_pos_article_formats_apply(uuid,text,jsonb)'::regprocedure) definition")[0].definition;
  const migration=readFileSync(join(f.erpSource,'supabase/migrations/20261014213618_pos_article_formats_v1.sql'),'utf8');
  const start=migration.indexOf('create function public.erp_pos_article_formats_apply('),end=migration.indexOf('create table private.pos_format_effects',start);
  assert.ok(start>=0&&end>start);let historical:any;
  try{sql(migration.slice(start,end).replace('create function','create or replace function'));
   historical=await legacyTransport.request(session.context.events_url,old);
  }finally{sql(previous);}
  assert.equal(historical.return_authorization,undefined);validateACK(historical,old,await wireHash(old));
  const after=effects(),stockAfter=stock();
  sql(`update erp_companies set config=jsonb_set(config,'{featureFlags,ARTICLE_FORMATS}','false') where id='${f.companyId}'`);
  try{assert.deepEqual(await legacyTransport.request(session.context.events_url,old),historical);}
  finally{sql(`update erp_companies set config=jsonb_set(config,'{featureFlags,ARTICLE_FORMATS}','true') where id='${f.companyId}'`);}
  assert.deepEqual(effects(),after);assert.equal(stock(),stockAfter);
  assert.equal(query(`select return_authorization from private.pos_format_events where event_id='${old.event_id}'`)[0].return_authorization,null);
 });

});
