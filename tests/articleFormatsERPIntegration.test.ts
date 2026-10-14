import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import SQLite from 'better-sqlite3';
import { sqlitePort, seedCollections, id } from './articleFormatsNetworkFixture';
import { prepareArticleFormatsAdapters } from '../services/articleFormats/runtime';
import { ArticleFormatPosting, saleWireLine, returnWireLine, wireTotals, drainFormatWireEvents } from '../services/articleFormats/posting';
import { createFormatTransport, wireHash, uuid, type WireEvent } from '../services/articleFormats/wire';
import { availability } from '../services/articleFormats/domain';

// Opt-in only. The fixture must point to a disposable original ERP HTTP server
// and PostgreSQL17 socket, never a Supabase DSN or a production tenant.
const fixturePath=process.env.CLIC_FORMATS_LOCAL_FIXTURE;
test('original ERP v1 HTTP/PostgreSQL17 + POS SQLite: masters, atomic posting and durable recovery',
 {skip:!fixturePath,timeout:120000},async t=>{
 const f=JSON.parse(readFileSync(fixturePath!,'utf8'));
 const url=new URL(f.baseUrl);
 assert.equal(url.protocol,'http:');assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 assert.ok(isAbsolute(f.postgresSocket)&&basename(f.postgresSocket).startsWith('clic-formats-pg.'));
 assert.match(f.database,/^clic_formats_contract_\d+$/);
 for(const k of ['tenantId','companyId','terminalId','itemId','tariffId'])uuid(f[k]);
 const pgBin=process.env.CLIC_FORMATS_PG_BINDIR||'/opt/homebrew/opt/postgresql@17/bin';
 const query=(text:string):any[]=>JSON.parse(execFileSync(join(pgBin,'psql'),['-X','-q','-A','-t','-h',f.postgresSocket,
  '-p','55437','-U','postgres','-d',f.database,'-v','ON_ERROR_STOP=1','-c',`select coalesce(json_agg(q),'[]'::json) from (${text}) q`],{encoding:'utf8'}).trim());
 const mutate=(text:string)=>execFileSync(join(pgBin,'psql'),['-X','-q','-h',f.postgresSocket,'-p','55437','-U','postgres',
  '-d',f.database,'-v','ON_ERROR_STOP=1','-c',text],{encoding:'utf8'});
 assert.match(query("select current_setting('server_version') server_version")[0]?.server_version||'',/^17\./);
 const erpStock=()=>query(`select qty_physical::text stock from erp_stock_balance where item_id='${f.itemId}'`)[0].stock;
 assert.equal(erpStock(),'137.0000','Use a new private fixture for each run');
 assert.equal(query(`select count(*)::int n from private.pos_format_events where terminal_id='${f.terminalId}'`)[0].n,0);
 const folder=mkdtempSync(join(tmpdir(),'clic-formats-pos-erp-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 let db=new SQLite(join(folder,'pos.sqlite'));t.after(()=>{if(db.open)db.close();});
 const transport=createFormatTransport(f.baseUrl,f);
 let runtime=await prepareArticleFormatsAdapters(sqlitePort(db),transport,f.terminalId);
 const ctx=runtime.context;seedCollections(db,ctx,f.itemId);
 const collection=(name:string)=>JSON.parse((db.prepare('SELECT value FROM collections WHERE key=?').get(name) as {value:string}).value);
 const localStock=()=>collection('productStocks')[0].quantity;
 const options={seriesId:id(9),userId:randomUUID(),userName:'Synthetic validator'};
 const returnOptions={...options,seriesId:id(10)};
 let revision:any, sale:WireEvent, packSale:WireEvent;
 const makeSale=async(formatId:string,quantity:string):Promise<WireEvent>=>{
  const master=await runtime.masters.getPolicy(f.itemId);assert.ok(master);
  const occurredAt=new Date().toISOString();
  const line=saleWireLine(master.dto,master.policy,{lineId:randomUUID(),formatId,variantId:null,tariffId:f.tariffId,quantity,occurredAt,terminalId:f.terminalId});
  const totals=wireTotals([line]);
  return {schema_version:1,event_id:randomUUID(),transaction_id:randomUUID(),event_type:'ARTICLE_FORMAT_SALE_V1',occurred_at:occurredAt,
   master:{sync_id:revision.syncId,revision:revision.revision},fiscal:{mode:'NONE'},lines:[line],
   payments:[{payment_id:randomUUID(),method:'cash',amount:totals.total_amount}],totals};
 };
 await t.test('downloads original six datasets, applies empties and persists revision/page receipts',async()=>{
  revision=await runtime.masters.download();
  assert.deepEqual(await runtime.masters.getActiveRevision(),revision);
  const datasets=db.prepare('SELECT dataset,verified FROM article_format_network_datasets ORDER BY dataset').all() as any[];
  assert.equal(datasets.length,6);assert.ok(datasets.every(d=>d.verified===1));
  for(const name of ['variants','barcodes','taxes'] as const)assert.deepEqual(await runtime.masters.getDataset(name),[]);
  assert.equal(query(`select count(*)::int n from private.pos_format_page_acks where session_id='${revision.syncId}'`)[0].n,3);
  const master=await runtime.masters.getPolicy(f.itemId);assert.ok(master);
  assert.deepEqual(master.dto.formats.map(format=>availability(137,format.factor)),[137,22,5]);
 });
 await t.test('commits sale once, survives process reopen and reconciles original pending IDs',async()=>{
  sale=await makeSale('case24','2');
  const crashing=new ArticleFormatPosting(sqlitePort(db,{afterCommit:true}),ctx,runtime.masters);
  await assert.rejects(crashing.post(sale,options),/afterCommit/);
  assert.equal(localStock(),89);assert.equal(collection('payments').length,1);assert.equal(collection('transactions').length,1);
  db.close();db=new SQLite(join(folder,'pos.sqlite'));
  runtime=await prepareArticleFormatsAdapters(sqlitePort(db),transport,f.terminalId);
  await runtime.posting.post(sale,options);
  assert.equal(localStock(),89);assert.equal(collection('inventoryLedger').length,2);
  assert.equal(collection('internalSequences')[0].nextNumber,2);
  assert.equal(collection('globalSequenceCounter')[0].count,1);
  assert.deepEqual((await runtime.posting.pending())[0].event,sale);
  // ERP current master changes while the original24 event is still offline.
  // Both sides must use the frozen, published revision instead of that master.
  mutate(`update items set metadata=jsonb_set(metadata,'{articleFormats,2,factor}','12'),precio_venta=99,costo_unitario=80 where id='${f.itemId}'`);
  assert.equal(query(`select (metadata#>>'{articleFormats,2,factor}')::int factor from items where id='${f.itemId}'`)[0].factor,12);
  assert.equal((await runtime.posting.pending())[0].event.lines[0].article_format.factor,24);
 });
 await t.test('offline timeout, lost real ACK and replay after flag-off preserve exact event/hash',async()=>{
  await drainFormatWireEvents(runtime.posting,{request:async()=>{throw Error('synthetic offline timeout');}});
  assert.deepEqual((await runtime.posting.pending(Number.MAX_SAFE_INTEGER))[0].event,sale);
  assert.equal(erpStock(),'137.0000');await runtime.posting.retryHeld();
  await drainFormatWireEvents(runtime.posting,{request:async(path,body)=>{await transport.request(path,body);throw Error('lost HTTP ACK after actual ERP commit');}});
  assert.equal(erpStock(),'89.0000');assert.deepEqual((await runtime.posting.pending(Number.MAX_SAFE_INTEGER))[0].event,sale);
  mutate(`update erp_companies set config=jsonb_set(config,'{featureFlags,ARTICLE_FORMATS}','false') where id='${f.companyId}'`);
  try{
   await runtime.posting.retryHeld();await runtime.drain();
   assert.equal((await runtime.posting.pending(Number.MAX_SAFE_INTEGER)).length,0);
   const row=query(`select content_hash,ack from private.pos_format_events where event_id='${sale.event_id}'`)[0];
   assert.equal(row.content_hash,await wireHash(sale));
   const local=JSON.parse((db.prepare('SELECT ack FROM article_format_wire_events WHERE event_id=?').get(sale.event_id) as {ack:string}).ack);
   assert.deepEqual(local,row.ack);assert.equal(localStock(),89);
   await assert.rejects(transport.request(ctx.events_url,{...sale,occurred_at:new Date(Date.parse(sale.occurred_at)+1).toISOString()}),/IDENTITY_CONFLICT/);
   packSale=await makeSale('pack6','1');await runtime.posting.post(packSale,options);await runtime.drain();
   const pending=await runtime.posting.pending(Number.MAX_SAFE_INTEGER);assert.equal(pending.length,1);assert.deepEqual(pending[0].event,packSale);
   assert.equal(localStock(),83);assert.equal(erpStock(),'89.0000');
   assert.equal(query(`select count(*)::int n from private.pos_format_events where event_id='${packSale.event_id}'`)[0].n,0);
  }finally{mutate(`update erp_companies set config=jsonb_set(config,'{featureFlags,ARTICLE_FORMATS}','true') where id='${f.companyId}'`);}
  await runtime.posting.retryHeld();await runtime.drain();assert.equal(erpStock(),'83.0000');
 });
 await t.test('VOID and partial RETURN use original immutable lines and reconcile stock/payments/outbox',async()=>{
  const reversal=(source:WireEvent,quantity:string,type:'ARTICLE_FORMAT_RETURN_V1'|'ARTICLE_FORMAT_VOID_V1'):WireEvent=>{
   const line=returnWireLine(source.lines[0],[],quantity,randomUUID()),totals=wireTotals([line]);
   return {schema_version:1,event_id:randomUUID(),transaction_id:randomUUID(),event_type:type,occurred_at:new Date().toISOString(),
    source_event_id:source.event_id,fiscal:{mode:'NONE'},lines:[line],payments:[{payment_id:randomUUID(),method:'cash',amount:totals.total_amount}],totals};
  };
  const voidEvent=reversal(packSale,'1','ARTICLE_FORMAT_VOID_V1');
  await runtime.posting.post(voidEvent,returnOptions);await runtime.posting.post(voidEvent,returnOptions);await runtime.drain();
  assert.equal(localStock(),89);assert.equal(erpStock(),'89.0000');
  const ret=reversal(sale,'0.5','ARTICLE_FORMAT_RETURN_V1');assert.equal(ret.lines[0].base_quantity,'12');
  await runtime.posting.post(ret,returnOptions);await runtime.drain();assert.equal(localStock(),101);assert.equal(erpStock(),'101.0000');
  assert.equal(collection('transactionHistory')[0].items[0].articleFormat.factor,24);
  assert.equal(collection('transactionHistory')[3].items[0].articleFormat.factor,24);
  assert.equal(query(`select (snapshot->>'factor')::int factor from private.pos_format_lines where event_id='${ret.event_id}'`)[0].factor,24);
  assert.equal(collection('transactions').length,4);assert.equal(collection('transactionHistory').length,4);assert.equal(collection('payments').length,4);
  assert.equal(collection('internalSequences')[0].nextNumber,3);assert.equal(collection('internalSequences')[1].nextNumber,3);
  assert.equal(collection('globalSequenceCounter')[0].count,4);assert.equal(collection('inventoryLedger').length,5);
  assert.equal(query(`select count(*)::int n from private.pos_format_events where terminal_id='${f.terminalId}' and state='APPLIED'`)[0].n,4);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM article_format_outbox WHERE state='ACKED'").get() as {n:number}).n,4);
  assert.equal((await runtime.posting.pending(Number.MAX_SAFE_INTEGER)).length,0);
  const totals=query(`select count(*)::int n from erp_sales_documents where tenant_id='${f.tenantId}'`);assert.equal(totals[0].n,4);
 });
});
