import assert from 'node:assert/strict';
import test from 'node:test';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeFixture,nativeSale,nativeACK,options,context,id} from './articleFormatsNativeFixture';
import {ArticleFormatPosting,returnWireLine,wireTotals,drainFormatWireEvents} from '../services/articleFormats/posting';
import {FormatHTTPError,type WireEvent} from '../services/articleFormats/wire';
import {recoveryDatabase} from '../services/recovery/RecoveryDatabase';

// Browser storage dependency for the real service's asynchronous post-commit broadcaster in this Node process.
if(typeof globalThis.localStorage==='undefined') {
 const values=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k),clear:()=>values.clear(),key:(i:number)=>[...values.keys()][i]??null,get length(){return values.size;}},configurable:true});
}
const barrier=()=>{let release!:()=>void;return {promise:new Promise<void>(resolve=>{release=resolve;}),release:()=>release()};};
function returned(source:WireEvent,n=30,q='0.5'):WireEvent {
 const l=returnWireLine(source.lines[0],[],q,id(n+2));const e:WireEvent={...source,event_id:id(n),transaction_id:id(n+1),event_type:'ARTICLE_FORMAT_RETURN_V1',return_context:structuredClone(context.return_context!),source_event_id:source.event_id,lines:[l],payments:[{payment_id:id(n+3),method:'cash',amount:wireTotals([l]).total_amount}],totals:wireTotals([l])};delete e.master;return e;
}
test('production native class normalized V3 one commit reconciles base stock and frozen returns without document shadows',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());const e=nativeSale();
 const result=await f.posting.post(e,options);assert.equal(result.seriesNumber,1);assert.equal(await f.balance(),89);
 assert.equal(f.documents('products').length,0);assert.equal(f.documents('productStocks').length,0);
 assert.equal(f.documents('transactions').length,1);assert.equal(f.documents('payments').length,1);
 assert.equal(f.documents('globalSequenceCounter')[0].count,1);assert.equal(f.documents('internalSequences').find(s=>s.id===id(9)).nextNumber,2);
 assert.equal((f.db.prepare('SELECT COUNT(*) n FROM sync_outbox_v2').get() as {n:number}).n,0,'dedicated format event never enters legacy sale sender');
 await f.posting.acknowledge(e,await nativeACK(e));
 const r=returned(e);await f.posting.post(r,{...options,seriesId:id(10)});
 assert.equal(await f.balance(),101);assert.equal(f.documents('transactions').find(d=>d.id===r.transaction_id).items[0].articleFormat.factor,24);
 assert.equal(f.documents('transactions').find(d=>d.id===e.transaction_id).status,'PARTIAL_REFUND');
});
test('failure before each production native statement, reads, BEGIN and precommit rolls every domain back',async t=>{
 const ref=await nativeFixture();await ref.posting.post(nativeSale(),options);const writes=ref.fault.writes,queries=ref.fault.queries;ref.db.close();
 for(let i=0;i<writes;i++) {const f=await nativeFixture();const before=f.state();f.fault.failWrite=i;await assert.rejects(f.posting.post(nativeSale(),options),/injected-write/);assert.deepEqual(f.state(),before,`write${i}`);f.db.close();}
 for(let i=0;i<queries;i++) {const f=await nativeFixture();const before=f.state();f.fault.failQuery=i;await assert.rejects(f.posting.post(nativeSale(),options),/injected-query/);assert.deepEqual(f.state(),before,`read${i}`);f.db.close();}
 for(const point of ['failBegin','failBeforeCommit'] as const){const f=await nativeFixture();const before=f.state();f.fault[point]=true;await assert.rejects(f.posting.post(nativeSale(),options),/injected/);assert.deepEqual(f.state(),before);f.db.close();}
});
test('uncertain commit resolves exact original event after file reopen without duplicate inventory or sequence',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-native-format-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'financial.sqlite');
 let f=await nativeFixture(new SQLite(file));f.fault.loseCommitResponse=true;await assert.rejects(f.posting.post(nativeSale(),options),/NATIVE_FINANCIAL_COMMIT_UNCERTAIN/);const committed=f.state();f.db.close();
 f=await nativeFixture(new SQLite(file),false);t.after(()=>f.db.close());await f.posting.post(nativeSale(),options);assert.deepEqual(f.state(),committed);assert.equal(await f.balance(),89);
});
test('public shared adapter and normalized stock readers cannot observe halfway committed projection',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());const entered=barrier(),release=barrier();let paused=false;
 f.fault.beforeRun=async(sql)=>{if(!paused&&sql.includes('INSERT INTO article_format_wire_events')){paused=true;entered.release();await release.promise;}};
 const posting=f.posting.post(nativeSale(),options);await entered.promise;
 let completed=0;
 const observers=[f.adapter.getCollection('transactions'),f.adapter.getDocument('transactions',nativeSale().transaction_id),f.adapter.executeSQL('SELECT COUNT(*) n FROM documents'),f.adapter.masterSyncV3Store.getLocalInventoryDelta(f.documents('inventoryLedger')[0].v3InventoryBaseline,id(7),id(5))].map(p=>p.then(v=>{completed++;return v;}));
 await Promise.resolve();assert.equal(completed,0);release.release();await posting;const result=await Promise.all(observers);assert.equal((result[0] as any[]).length,1);assert.equal(result[3],-48);
});
test('shared atomic reservations interleave format issuance uniquely and stale configuration preserves new counter plus current metadata',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());const stale=f.documents('internalSequences');
 const results=await Promise.all([f.adapter.reserveFinancialNumbers({seriesId:id(9),global:true}),f.posting.post(nativeSale(),options),f.adapter.reserveFinancialNumbers({seriesId:id(9),global:true})]);
 assert.deepEqual(results.map(r=>r.seriesNumber).sort(),[1,2,3]);assert.equal(f.documents('globalSequenceCounter')[0].count,3);
 stale.find(s=>s.id===id(9)).prefix='NEW-';stale.find(s=>s.id===id(9)).padding=8;
 await f.adapter.saveCollection('internalSequences',stale);
 const current=f.documents('internalSequences').find(s=>s.id===id(9));assert.equal(current.nextNumber,4);assert.equal(current.prefix,'NEW-');assert.equal(current.padding,8);
 const reserved=await f.adapter.reserveFinancialNumbers({seriesId:id(9),global:true});assert.equal(reserved.displayId,'NEW-00000004');
});
test('concurrent aggregate demand and overreturn are serialized before authoritative reads',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());
 const settled=await Promise.allSettled([f.posting.post(nativeSale(12,'4'),options),f.posting.post(nativeSale(40,'4'),options)]);
 assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);assert.equal(await f.balance(),41);
 const sale=settled[0].status==='fulfilled'?nativeSale(12,'4'):nativeSale(40,'4');await f.posting.acknowledge(sale,await nativeACK(sale));
 const returns=await Promise.allSettled([f.posting.post(returned(sale,70,'3'),{...options,seriesId:id(10)}),f.posting.post(returned(sale,80,'3'),{...options,seriesId:id(10)})]);
 assert.equal(returns.filter(r=>r.status==='fulfilled').length,1);assert.equal(await f.balance(),113);
});
test('original return context and payload survive conflict, reopen-ready hold and all readiness stays closed',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());const e=nativeSale();await f.posting.post(e,options);await f.posting.acknowledge(e,await nativeACK(e));const r=returned(e);await f.posting.post(r,{...options,seriesId:id(10)});
 const original=f.db.prepare('SELECT content FROM article_format_outbox WHERE event_id=?').get(r.event_id);
 await drainFormatWireEvents(f.posting,{request:async()=>{throw new FormatHTTPError(409,'POS_FORMAT_RETURN_CONTEXT_CONFLICT',true);}});
 assert.deepEqual(f.db.prepare('SELECT content FROM article_format_outbox WHERE event_id=?').get(r.event_id),original);
 assert.equal((await f.posting.pending()).length,1);assert.equal((await f.posting.pending(Date.now())).length,0);
 const guarded=new ArticleFormatPosting(f.adapter.articleFormatSQL(),context,f.masters);await assert.rejects(guarded.post(nativeSale(60),options),/NATIVE_POSTING_NOT_READY/);
 const recovery=recoveryDatabase(f.adapter,()=>true) as any;assert.throws(()=>recovery.articleFormatFinancialSQL(),/RECOVERY_FORMAT_FINANCIAL_CAPTURE_NOT_READY/);
});
test('actual shared utility and transactionService numbering callers use the native atomic reservation',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());const {dbAdapter}=await import('../services/db');const original=dbAdapter.reserveFinancialNumbers;
 dbAdapter.reserveFinancialNumbers=f.adapter.reserveFinancialNumbers.bind(f.adapter);
 t.after(()=>{if(original)dbAdapter.reserveFinancialNumbers=original;else delete dbAdapter.reserveFinancialNumbers;});
 const {db}=await import('../utils/db');const {transactionService}=await import('../services/transactionService');
 const results=await Promise.all([transactionService.generateTransactionId('TICKET',id(9)),f.posting.post(nativeSale(),options),db.getNextSeriesNumber(id(9)),db.getNextGlobalSequence(),db.getNextSequenceNumber(id(9))]);
 assert.equal(new Set([results[0].seriesNumber,results[1].seriesNumber,results[2]]).size,3);
 assert.equal(f.documents('internalSequences').find(s=>s.id===id(9)).nextNumber,5);
 assert.equal(f.documents('globalSequenceCounter')[0].count,3);
});
test('ordinary legacy V3 sale competes with format aggregate demand on one baseline',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());const entered=barrier(),release=barrier();let paused=false;
 f.fault.beforeRun=async(sql)=>{if(!paused&&sql.includes('INSERT INTO article_format_wire_events')){paused=true;entered.release();await release.promise;}};
 const sale=f.posting.post(nativeSale(),options);await entered.promise;
 const baseline=f.documents('inventoryLedger')[0].v3InventoryBaseline;
 const ledger={id:id(90),productId:id(7),warehouseId:id(5),qtyIn:0,qtyOut:100,v3InventoryBaseline:baseline,v3Binding:JSON.parse(baseline)[0],v3WarehouseId:id(5)};
 const document={id:id(91),items:[],v3InventoryBaseline:baseline,v3Binding:ledger.v3Binding,v3WarehouseId:id(5)};
 const legacy=f.adapter.commitFinancialTransaction({documents:[{collectionName:'transactions',document,requireAbsent:true,v3StockRequirements:[{baseline,productId:id(7),warehouseId:id(5),quantity:100}]},{collectionName:'inventoryLedger',document:ledger,requireAbsent:true}],outboxEvent:{eventId:id(92),eventType:'SALE_POSTED',aggregateType:'SALE',aggregateId:id(91),schemaVersion:1,payload:{},createdAt:'2026-10-14T12:00:00Z'}});
 release.release();await sale;await assert.rejects(legacy,/STOCK_INSUFFICIENT/);assert.equal(await f.balance(),89);
});
test('generic refresh preserves format ledger/history/payment source while allowing ACK metadata and ordinary legacy rows',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());const e=nativeSale();await f.posting.post(e,options);const immutable=f.documents('transactions')[0];const movement=f.documents('inventoryLedger')[0];
 await f.adapter.saveCollection('inventoryLedger',[]);assert.equal(await f.balance(),89);
 await f.adapter.saveDocument('inventoryLedger',{...movement,qtyOut:1,balanceQty:136,syncStatus:'SYNCED'});
 assert.equal(f.documents('inventoryLedger')[0].qtyOut,48);assert.equal(await f.balance(),89);
 await f.adapter.saveCollection('transactionHistory',[{id:'legacy',total:2}]);assert.equal(f.documents('transactionHistory').length,2);
 await f.adapter.saveDocument('transactions',{...immutable,total:999,items:[],cloudSyncStatus:'SYNCED'});
 assert.equal(f.documents('transactions')[0].total,2160);assert.equal(f.documents('transactions')[0].items.length,1);assert.equal(f.documents('transactions')[0].cloudSyncStatus,'SYNCED');
 const payment=f.documents('payments')[0];await f.adapter.saveDocument('payments',{...payment,amount:1,syncStatus:'SYNCED'});assert.equal(f.documents('payments')[0].amount,2160);
});
test('ACK does not certify inventory coverage; normalized baseline refresh rejects before pointer mutation',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());const e=nativeSale();await f.posting.post(e,options);await f.posting.acknowledge(e,await nativeACK(e));
 const before=f.db.prepare('SELECT * FROM master_v3_inventory_state').all();
 await assert.rejects(f.adapter.masterSyncV3Store.replaceInventorySnapshot({syncId:id(60),syncVersion:32,contractVersion:2},{version:5,cursor:'new',balances:[{item_id:id(7),warehouse_id:id(5),qty_on_hand:89,qty_reserved:0,qty_committed:0,updated_at:'2026-10-14T12:00:00Z'}]}),/INVENTORY_COVERAGE_REQUIRED/);
 assert.deepEqual(f.db.prepare('SELECT * FROM master_v3_inventory_state').all(),before);assert.equal(await f.balance(),89);
});
test('format revision24 to12 does not reinterpret pending sale or historical return',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());const e=nativeSale();await f.posting.post(e,options);
 const pending=(await f.posting.pending())[0];const previous=f.db.prepare('SELECT * FROM article_format_network_sessions').get() as any;
 const policyRow=f.db.prepare('SELECT * FROM article_format_network_policies').get() as any;
 const fresh=JSON.parse(policyRow.dto);fresh.formats.find((x:any)=>x.id==='case').factor=12;fresh.formats.find((x:any)=>x.id==='case').name='Caja12';fresh.formats.find((x:any)=>x.id==='case').prices[0].price=540;
 f.db.prepare(`INSERT INTO article_format_network_sessions VALUES(?,?,?,?,?,?,?,?,?,?)`).run(previous.tenant_id,previous.company_id,previous.terminal_id,id(71),2,previous.context,previous.manifest,'b'.repeat(64),'COMPLETE','{}');
 f.db.prepare('INSERT INTO article_format_network_policies VALUES(?,?,?,?,?,?,?)').run(id(1),id(2),id(4),id(71),id(7),JSON.stringify(fresh),policyRow.policy);
 f.db.prepare('UPDATE article_format_network_active SET sync_id=?,revision=2').run(id(71));
 assert.deepEqual((await f.posting.pending())[0],pending);
 await f.posting.acknowledge(e,await nativeACK(e));await f.posting.post(returned(e),{...options,seriesId:id(10)});
 assert.equal(await f.balance(),101);assert.equal(f.documents('transactions').find(r=>r.id===id(31)).items[0].articleFormat.factor,24);
});
test('ERP_ID variant mapping, exact zero price, specific and fallback prices use normalized base bucket',async t=>{
 const {dto,policy}=await import('./articleFormatsNativeFixture');const {saleWireLine}=await import('../services/articleFormats/posting');
 for(const pricing of ['specific','fallback','zero'] as const){
  const f=await nativeFixture();const d=structuredClone(dto) as any,p=structuredClone(policy) as any;
  d.formats.forEach((x:any)=>{x.variantId=id(55);x.barcode=x.id==='case'?'7501234567890':'';});
  if(pricing==='fallback')d.formats.find((x:any)=>x.id==='case').prices=[];
  if(pricing==='zero')d.formats.find((x:any)=>x.id==='case').prices[0].price=0;
  p.variant_ids=[id(55)];p.variant_skus={[id(55)]:'VAR-A'};p.base_prices[0].variant_id=id(55);
  f.db.prepare('UPDATE article_format_network_policies SET dto=?,policy=?').run(JSON.stringify(d),JSON.stringify(p));
  f.db.prepare('INSERT INTO master_v3_variants(sync_version,article_id,variant_id,active,record_json) VALUES(?,?,?,?,?)').run(32,id(7),id(55),1,JSON.stringify({id:id(55),articleId:id(7),sku:'VAR-A',active:true}));
  const e=nativeSale();e.lines=[saleWireLine(d,p,{lineId:id(14),formatId:'case',variantId:id(55),tariffId:id(6),quantity:'2',occurredAt:e.occurred_at,terminalId:id(4)})];e.totals=wireTotals(e.lines);e.payments=pricing==='zero'?[]:[{payment_id:id(15),method:'cash',amount:e.totals.total_amount}];
  await f.posting.post(e,options);assert.equal(await f.balance(),89);const item=f.documents('transactions')[0].items[0];
  assert.equal(item.variantSku,'VAR-A');assert.equal(item.formatWireLine.variant_id,id(55));assert.equal(item.articleFormat.barcode,'7501234567890');assert.equal(item.price,pricing==='zero'?0:1080);
  f.db.close();
 }
});
test('authorized physical return policy determines exact local stock effect and VOID returns whole source once',async t=>{
 const {contextForPolicy}=await import('./articleFormatsNetworkFixture');
 for(const physical of ['RESTOCK','DAMAGED','NO_RETURN'] as const){
  const f=await nativeFixture();const ctx=contextForPolicy(physical);
  f.db.prepare('UPDATE article_format_network_sessions SET context=?').run((await import('../services/articleFormats/store')).canonicalContent(ctx));
  const {ArticleFormatNetworkMaster}=await import('../services/articleFormats/networkMaster');const master=new ArticleFormatNetworkMaster(f.sql,ctx,{request:async()=>{throw Error('offline');}});
  const posting=new ArticleFormatPosting(f.sql,ctx,master);const sale=nativeSale();await posting.post(sale,options);await posting.acknowledge(sale,await nativeACK(sale));
  const r=returned(sale);r.return_context=structuredClone(ctx.return_context!);await posting.post(r,{...options,seriesId:id(10)});assert.equal(await f.balance(),physical==='RESTOCK'?101:89);f.db.close();
 }
 const f=await nativeFixture();t.after(()=>f.db.close());const e=nativeSale();await f.posting.post(e,options);await f.posting.acknowledge(e,await nativeACK(e));
 const v=returned(e,30,'2');v.event_type='ARTICLE_FORMAT_VOID_V1';await f.posting.post(v,{...options,seriesId:id(10)});assert.equal(await f.balance(),137);
 await assert.rejects(f.posting.post(returned(e,40,'0.5'),{...options,seriesId:id(10)}),/RETURN_EXCEEDS_SOURCE/);
});
test('public operational guarded port ACK is transactional, rollback-safe and recoverable after commit response loss',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());const e=nativeSale();await f.posting.post(e,options);
 const operational=new ArticleFormatPosting(f.adapter.articleFormatSQL(),context,f.masters);const before=f.state();f.fault.writes=0;f.fault.failWrite=2;
 await assert.rejects(operational.acknowledge(e,await nativeACK(e)),/injected-write/);assert.deepEqual(f.state(),before);
 f.fault.failWrite=undefined;f.fault.loseCommitResponse=true;await assert.rejects(operational.acknowledge(e,await nativeACK(e)),/COMMIT_UNCERTAIN/);f.fault.loseCommitResponse=false;
 const committed=f.state();await operational.acknowledge(e,await nativeACK(e));assert.deepEqual(f.state(),committed);assert.equal((await operational.pending()).length,0);
});
test('lost BEGIN response is cleaned; failed rollback poisons shared connection until explicit reopen',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());const bridge=(f.adapter as any).db;
 const begin=bridge.beginTransaction;bridge.beginTransaction=async()=>{await begin();throw Error('lost-BEGIN-response');};const before=f.state();
 await assert.rejects(f.posting.post(nativeSale(),options),/lost-BEGIN-response/);assert.equal(f.db.inTransaction,false);assert.deepEqual(f.state(),before);
 bridge.beginTransaction=begin;bridge.rollbackTransaction=async()=>{throw Error('rollback-disconnected');};f.fault.failWrite=0;
 await assert.rejects(f.posting.post(nativeSale(),options),/NATIVE_FINANCIAL_CONNECTION_UNCERTAIN/);
 await assert.rejects(f.adapter.getCollection('transactions'),/NATIVE_FINANCIAL_CONNECTION_UNCERTAIN/);
 f.db.exec('ROLLBACK');
});
test('native master public writer classification is exhaustive and every writer releases its queue on validation failure', {timeout:5000}, async t=>{
 const {NATIVE_V3_METHOD_CONCURRENCY}=await import('../services/db/adapters/CapacitorSQLiteAdapter');
 const {readFileSync}=await import('node:fs');const ts=(await import('typescript')).default;
 const source=ts.createSourceFile('store.ts',readFileSync('services/db/LargeMasterSyncV3SqliteStore.ts','utf8'),ts.ScriptTarget.Latest,true);
 const declaration=source.statements.find(ts.isClassDeclaration)!;
 const publicMethods=declaration.members.filter(m=>ts.isMethodDeclaration(m)&&!m.modifiers?.some(x=>x.kind===ts.SyntaxKind.PrivateKeyword)).map(m=>(m.name as import('typescript').Identifier).text);
 assert.deepEqual(Object.keys(NATIVE_V3_METHOD_CONCURRENCY).sort(),publicMethods.sort());
 const calls:Record<string,any[]>={setOperationalOwner:[{syncId:id(60),syncVersion:32,contractVersion:2},'wrong'],
  prepare:[{syncId:id(80),syncVersion:33,datasets:{}}],prepareCatalogOnly:[{syncId:id(80),syncVersion:33,datasets:{}},{}],
  applyChunk:[{envelope:{syncId:id(80)}}],markDatasetValidated:[id(80),'articles'],validateStaging:[id(80)],
  activate:[id(80)],activateCatalogOnly:[id(80),{}],activateUnusedBaseline:[id(80),{},{}],rollback:[],
  replaceInventorySnapshot:[{syncId:id(60),syncVersion:32,contractVersion:2},{version:5,cursor:'new',balances:[]}],cleanupExpiredVersions:['2000-01-01',1]};
 for(const [name,mode] of Object.entries(NATIVE_V3_METHOD_CONCURRENCY))if(mode==='write'){
  const f=await nativeFixture();try {await (f.adapter.masterSyncV3Store as any)[name](...calls[name]);}catch {/* Invalid input is deliberate; queue must still release. */}
  assert.ok(await f.adapter.getDocument('config','current'),name+' released');assert.equal(f.db.inTransaction,false,name+' transaction ended');f.db.close();
 }
 const f=await nativeFixture();t.after(()=>f.db.close());(f.adapter.masterSyncV3Store as any).futureWrite=async()=>1;
 assert.throws(()=>(f.adapter.masterSyncV3Store as any).futureWrite(),/METHOD_UNCLASSIFIED/);
 await f.adapter.saveDocument('customers',{id:'existing',external_code:'C-1'});
 const master=await f.adapter.commitNumberedMasterCreation({entityType:'CUSTOMER',collectionName:'customers',document:{id:'existing'},sourceTerminalId:id(4)});
 assert.equal(master.code,'C-1','nested public reader must not deadlock existing master creation');
});
test('native LEGACY_B fiscal buffer rolls back with every financial statement and stable IDs survive uncertain commit',async t=>{
 const {seedNativeFiscal}=await import('./articleFormatsNativeFixture');const reference=await nativeFixture();const {event}=seedNativeFiscal(reference);
 await reference.posting.post(event,options);const count=reference.fault.writes;assert.equal(reference.documents('localFiscalBuffer')[0].currentNumber,2);reference.db.close();
 for(let i=0;i<count;i++) {const f=await nativeFixture();const {event}=seedNativeFiscal(f);const before=f.state();f.fault.failWrite=i;
  await assert.rejects(f.posting.post(event,options),/injected-write/);assert.deepEqual(f.state(),before,'fiscalwrite'+i);f.db.close();}
 const f=await nativeFixture();t.after(()=>f.db.close());const seeded=seedNativeFiscal(f);f.fault.loseCommitResponse=true;
 await assert.rejects(f.posting.post(seeded.event,options),/COMMIT_UNCERTAIN/);f.fault.loseCommitResponse=false;await f.posting.post(seeded.event,options);
 assert.equal(f.documents('localFiscalBuffer')[0].currentNumber,2);assert.equal(f.documents('globalSequenceCounter')[0].count,1);assert.equal(await f.balance(),89);
});
test('actual legacy getNextNCF and format fiscal commit reserve distinct numbers through shared native queue',async t=>{
 const {seedNativeFiscal}=await import('./articleFormatsNativeFixture');const f=await nativeFixture();t.after(()=>f.db.close());const {event}=seedNativeFiscal(f);
 const {dbAdapter}=await import('../services/db');const {db}=await import('../utils/db');
 const names=['getCollection','saveCollection','getDocument','executeSQL','reserveFinancialNumbers'] as const;const originals=new Map(names.map(n=>[n,(dbAdapter as any)[n]]));
 for(const n of names)(dbAdapter as any)[n]=(f.adapter as any)[n].bind(f.adapter);
 t.after(()=>{for(const n of names){if(originals.get(n))(dbAdapter as any)[n]=originals.get(n);else delete (dbAdapter as any)[n];}});
 const entered=barrier(),release=barrier();let paused=false;f.fault.beforeRun=async(sql)=>{if(!paused&&sql.includes('INSERT INTO article_format_wire_events')){paused=true;entered.release();await release.promise;}};
 const posting=f.posting.post(event,options);await entered.promise;const legacy=db.getNextNCF('B02',id(4));release.release();await posting;
 assert.equal(await legacy,'B0200000002');assert.equal(f.documents('localFiscalBuffer')[0].currentNumber,3);
});
test('fiscal immutable issuer receipt rejects rotated allocation/terminal replay and generic import/delete/update',async t=>{
 const {seedNativeFiscal}=await import('./articleFormatsNativeFixture');const f=await nativeFixture();t.after(()=>f.db.close());const seeded=seedNativeFiscal(f);await f.posting.post(seeded.event,options);
 const receipt=f.documents('nativeFiscalReservations')[0];assert.equal(receipt.issuerRnc,'101010101');
 await assert.rejects(f.adapter.saveDocument('nativeFiscalReservations',{...receipt,ncf:'B0200000009'}),/RECEIPT/);
 await assert.rejects(f.adapter.saveCollection('nativeFiscalReservations',[]),/RECEIPT/);
 await assert.rejects(f.adapter.saveDocument('nativeFiscalReservations',{...receipt,id:'forged'}),/TYPED_ONLY/);
 const current=f.documents('config')[0],newRange={...seeded.range,id:id(103)},newAllocation={...seeded.allocation,id:id(102),fiscalRangeId:id(103)};
 current.terminals[0].config.fiscal={mode:'LEGACY_B',enabled:true,fiscalRanges:[newRange],fiscalAllocations:[newAllocation]};
 await f.adapter.saveDocument('config',current);await f.adapter.saveDocument('fiscalRanges',newRange);await f.adapter.saveDocument('fiscalAllocations',newAllocation);
 await f.adapter.saveDocument('localFiscalBuffer',{...seeded.buffer,fiscalRangeId:id(103),allocationId:id(102)});
 const next=nativeSale(40);next.fiscal=seeded.event.fiscal;const before=f.state();await assert.rejects(f.posting.post(next,options),/NUMBER_ALREADY_ISSUED/);assert.deepEqual(f.state(),before);
 // Changing the real fiscal issuer creates a distinct namespace; rotating allocation or terminal alone did not.
 current.companyInfo.rnc='202020202';await f.adapter.saveDocument('config',current);await f.posting.post(next,options);
 assert.equal(f.documents('nativeFiscalReservations').length,2);assert.equal(f.documents('transactions').find(t=>t.id===next.transaction_id).fiscalIssuerRnc,'202020202');
});
test('pre-receipt historical NCF and unknown fiscal issuer fail closed for a new format event',async t=>{
 const {seedNativeFiscal}=await import('./articleFormatsNativeFixture');
 for(const mode of ['history','missing-issuer'] as const){
  const f=await nativeFixture();const {event}=seedNativeFiscal(f);
  if(mode==='history')await f.adapter.saveDocument('transactionHistory',{id:'before-receipts',ncf:'B0200000001'});
  else {const cfg=f.documents('config')[0];delete cfg.companyInfo.rnc;await f.adapter.saveDocument('config',cfg);}
  const before=f.state();await assert.rejects(f.posting.post(event,options),mode==='history'?/HISTORICAL_COLLISION/:/ISSUER_UNPROVEN/);assert.deepEqual(f.state(),before);f.db.close();
 }
});
test('legacy fiscal native CAS denies config/terminal/allocation/range revocation between validation and transaction',async t=>{
 const {seedNativeFiscal}=await import('./articleFormatsNativeFixture');const {dbAdapter}=await import('../services/db');const {db}=await import('../utils/db');
 const names=['getCollection','saveCollection','getDocument','executeSQL','reserveFinancialNumbers'] as const;const originals=new Map(names.map(n=>[n,(dbAdapter as any)[n]]));
 t.after(()=>{for(const n of names){if(originals.get(n))(dbAdapter as any)[n]=originals.get(n);else delete (dbAdapter as any)[n];}});
 for(const mutation of ['config','terminal','allocation','range','prefix','expiry','bounds'] as const){
  const f=await nativeFixture();seedNativeFiscal(f);for(const n of names)(dbAdapter as any)[n]=(f.adapter as any)[n].bind(f.adapter);
  (dbAdapter as any).reserveFinancialNumbers=async(input:any)=>{
   const collection=['config','terminal'].includes(mutation)?'config':['range','prefix','expiry','bounds'].includes(mutation)?'fiscalRanges':'fiscalAllocations';
   const row=f.documents(collection)[0];
   if(mutation==='config')row.terminals[0].config.fiscal.mode='NONE';
   if(mutation==='terminal')row.terminals[0].config.erpTerminalId=id(99);
   if(mutation==='allocation')row.status='RELEASED';
   if(mutation==='range')row.isActive=false;if(mutation==='prefix')row.prefix='B01';if(mutation==='expiry')row.expiryDate='2000-01-01';if(mutation==='bounds')row.endNumber=1;
   f.db.prepare('UPDATE documents SET data=? WHERE collection_name=? AND doc_id=?').run(JSON.stringify(row),collection,row.id);
   return f.adapter.reserveFinancialNumbers(input);
  };
  await assert.rejects(db.getNextNCF('B02',id(4)),/NATIVE_FISCAL_AUTHORITY_CONFLICT/);assert.equal(f.documents('nativeFiscalReservations').length,0);f.db.close();
 }
});
function fiscalInput(f:Awaited<ReturnType<typeof nativeFixture>>,ncf:string) {
 const buffer=f.documents('localFiscalBuffer')[0];const raw=(name:string,id:string)=>(f.db.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(name,id) as {data:string}).data;
 return {global:false,fiscal:{terminalId:id(4),type:'B02' as const,ncf,expectedConfig:raw('config','current'),expectedBuffer:raw('localFiscalBuffer',buffer.id),expectedAllocation:raw('fiscalAllocations',buffer.allocationId),expectedRange:raw('fiscalRanges',buffer.fiscalRangeId)}};
}
test('legacy without RNC/tenant/company retains fresh issuance with an unattributed exclusion claim',async t=>{
 const {seedNativeFiscal}=await import('./articleFormatsNativeFixture');const f=await nativeFixture();t.after(()=>f.db.close());seedNativeFiscal(f);
 const cfg=f.documents('config')[0];delete cfg.companyInfo.rnc;delete cfg.terminals[0].config.erpBinding;
 delete cfg.terminals[0].config.fiscal.fiscalAllocations[0].metadata;
 const allocation=f.documents('fiscalAllocations')[0];delete allocation.metadata;
 await f.adapter.saveDocument('config',cfg);await f.adapter.saveDocument('fiscalAllocations',allocation);
 const {dbAdapter}=await import('../services/db');const {db}=await import('../utils/db');const names=['getCollection','saveCollection','getDocument','executeSQL','reserveFinancialNumbers'] as const;const original=new Map(names.map(n=>[n,(dbAdapter as any)[n]]));
 for(const n of names)(dbAdapter as any)[n]=(f.adapter as any)[n].bind(f.adapter);
 t.after(()=>{for(const n of names){if(original.get(n))(dbAdapter as any)[n]=original.get(n);else delete (dbAdapter as any)[n];}});
 assert.equal(await db.getNextNCF('B02',id(4)),'B0200000002');const receipt=f.documents('nativeFiscalReservations')[0];
 assert.equal(receipt.issuerRnc,null);assert.equal(receipt.identityStatus,'UNATTRIBUTED_LEGACY');assert.equal(receipt.tenantId,null);
 // A later real issuer binding does not retroactively attribute the consumed number.
 cfg.companyInfo.rnc='101010101';cfg.terminals[0].config.erpBinding={tenantId:id(1),companyId:id(2),storeId:id(3)};
 const range={...f.documents('fiscalRanges')[0],id:id(103)},nextAllocation={...f.documents('fiscalAllocations')[0],id:id(102),fiscalRangeId:range.id,nextNumber:3};
 cfg.terminals[0].config.fiscal.fiscalRanges=[range];cfg.terminals[0].config.fiscal.fiscalAllocations=[nextAllocation];
 await f.adapter.saveDocument('config',cfg);await f.adapter.saveDocument('fiscalRanges',range);await f.adapter.saveDocument('fiscalAllocations',nextAllocation);
 await f.adapter.saveDocument('localFiscalBuffer',{...f.documents('localFiscalBuffer')[0],currentNumber:2,startNumber:2,endNumber:2,allocationId:nextAllocation.id,fiscalRangeId:range.id});
 const e=nativeSale();e.fiscal={mode:'LEGACY_B',ncf_type:'B02',ncf:'B0200000002'};const before=f.state();await assert.rejects(f.posting.post(e,options),/NUMBER_ALREADY_ISSUED/);assert.deepEqual(f.state(),before);
 assert.equal(f.documents('nativeFiscalReservations')[0].issuerRnc,null);
});
test('known issuer receipt blocks unknown reuse and same-number native legacy/format race commits once',async t=>{
 const {seedNativeFiscal}=await import('./articleFormatsNativeFixture');const f=await nativeFixture();t.after(()=>f.db.close());const {event}=seedNativeFiscal(f);
 const input=fiscalInput(f,'B0200000001');const results=await Promise.allSettled([f.adapter.reserveFinancialNumbers(input),f.posting.post(event,options)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.documents('nativeFiscalReservations').length,1);
 const cfg=f.documents('config')[0];delete cfg.companyInfo.rnc;const range={...f.documents('fiscalRanges')[0],id:id(103)},allocation={...f.documents('fiscalAllocations')[0],id:id(102),fiscalRangeId:range.id};cfg.terminals[0].config.fiscal.fiscalRanges=[range];cfg.terminals[0].config.fiscal.fiscalAllocations=[allocation];
 await f.adapter.saveDocument('config',cfg);await f.adapter.saveDocument('fiscalRanges',range);await f.adapter.saveDocument('fiscalAllocations',allocation);
 await f.adapter.saveDocument('localFiscalBuffer',{...f.documents('localFiscalBuffer')[0],currentNumber:1,startNumber:1,endNumber:1,allocationId:allocation.id,fiscalRangeId:range.id});
 await assert.rejects(f.adapter.reserveFinancialNumbers(fiscalInput(f,'B0200000001')),/NUMBER_ALREADY_ISSUED/);
});
test('every historical B-format field is separately indexed and unknown retained history cannot hide behind electronic NCF',async t=>{
 const {seedNativeFiscal}=await import('./articleFormatsNativeFixture');const {NATIVE_FISCAL_HISTORY_FIELDS,fiscalHistoricalCollisionQuery}=await import('../services/db/NativeFiscalReservation');
 for(const field of NATIVE_FISCAL_HISTORY_FIELDS){
  const f=await nativeFixture();const {event}=seedNativeFiscal(f);
  const row:any={id:'historical',status:'REFUNDED',electronicNcf:'E310000000001'};
  if(field==='articleFormatWire.fiscal.ncf')row.articleFormatWire={fiscal:{ncf:' b0200000001 '}};else row[field]=' b0200000001 ';
  await f.adapter.saveDocument('transactionHistory',row);
  const explain=f.db.prepare('EXPLAIN QUERY PLAN '+fiscalHistoricalCollisionQuery(field,true)).all('B0200000001','101010101','B0200000001') as {detail:string}[];
  assert.ok(explain.some(p=>p.detail.includes('SEARCH d USING INDEX idx_documents_fiscal_history_')),field+' point index');
  assert.ok(!explain.some(p=>p.detail.includes('SCAN d')),field+' no historical scan');
  const before=f.state();await assert.rejects(f.posting.post(event,options),/HISTORICAL_COLLISION/);assert.deepEqual(f.state(),before);f.db.close();
 }
});
test('authoritative series removal revokes eligibility but retains issued counter; buffer cache deletion preserves immutable receipts',async t=>{
 const {seedNativeFiscal}=await import('./articleFormatsNativeFixture');const f=await nativeFixture();t.after(()=>f.db.close());const {event,buffer}=seedNativeFiscal(f);await f.posting.post(event,options);
 await f.adapter.saveCollection('internalSequences',[]);await assert.rejects(f.adapter.reserveFinancialNumbers({seriesId:id(9),global:false}),/SERIES_FORBIDDEN/);
 assert.equal(f.documents('internalSequences').find(s=>s.id===id(9)).nextNumber,2);
 await f.adapter.saveDocument('internalSequences',{id:id(9),documentType:'TICKET',prefix:'TCK-',nextNumber:1,active:true});assert.equal((await f.adapter.reserveFinancialNumbers({seriesId:id(9),global:false})).seriesNumber,2);
 await f.adapter.saveCollection('localFiscalBuffer',[buffer]);assert.equal(f.documents('localFiscalBuffer')[0].currentNumber,2,'same epoch retained');
 await f.adapter.saveCollection('localFiscalBuffer',[]);assert.equal(f.documents('localFiscalBuffer').length,0);
 await f.adapter.saveCollection('localFiscalBuffer',[buffer]);const next=nativeSale(40);next.fiscal=event.fiscal;
 await assert.rejects(f.posting.post(next,options),/NUMBER_ALREADY_ISSUED/);assert.equal(f.documents('nativeFiscalReservations').length,1);
});

test('actual generic delete cannot erase issued series or global counter before re-add',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());await f.adapter.reserveFinancialNumbers({seriesId:id(9),global:true});
 await f.adapter.deleteDocument('internalSequences',id(9));await assert.rejects(f.adapter.reserveFinancialNumbers({seriesId:id(9),global:false}),/SERIES_FORBIDDEN/);
 await assert.rejects(f.adapter.deleteDocument('globalSequenceCounter','value'),/COUNTER_DELETE_FORBIDDEN/);
 await f.adapter.saveDocument('internalSequences',{id:id(9),documentType:'TICKET',prefix:'TCK-',nextNumber:1,active:true});
 await f.adapter.saveCollection('globalSequenceCounter',0 as any);
 const reserved=await f.adapter.reserveFinancialNumbers({seriesId:id(9),global:true});assert.equal(reserved.seriesNumber,2);assert.equal(reserved.globalSequence,2);
});
async function unitSale(n:number,quantity:string):Promise<WireEvent>{
 const {dto,policy}=await import('./articleFormatsNativeFixture');const {saleWireLine}=await import('../services/articleFormats/posting');const e=nativeSale(n,quantity);
 e.lines=[saleWireLine(dto,policy,{lineId:id(n+2),formatId:'unit',variantId:null,tariffId:id(6),quantity,occurredAt:e.occurred_at,terminalId:id(4)})];e.totals=wireTotals(e.lines);
 e.payments=Number(e.totals.total_amount)>0?[{payment_id:id(n+3),method:'cash',amount:e.totals.total_amount}]:[];return e;
}
test('BASE4 native availability and returned projections preserve exact tenths without aggregate rounding',async t=>{
 const {readV3Base4Stock}=await import('../services/db/V3Base4Stock');
 for(const baseline of [0.3,0.6]){
  const f=await nativeFixture();f.db.prepare('UPDATE master_v3_inventory_balances SET qty_on_hand=?').run(baseline);
  const first=await unitSale(12,'0.1'),second=await unitSale(30,'0.2');await f.posting.post(first,options);await f.posting.post(second,options);await f.posting.acknowledge(first,await nativeACK(first));
  const returnedLine=returnWireLine(first.lines[0],[],'0.1',id(42));const r:WireEvent={...first,event_id:id(40),transaction_id:id(41),event_type:'ARTICLE_FORMAT_RETURN_V1',return_context:structuredClone(context.return_context!),source_event_id:first.event_id,lines:[returnedLine],payments:[{payment_id:id(43),method:'cash',amount:wireTotals([returnedLine]).total_amount}],totals:wireTotals([returnedLine])};delete r.master;
  await f.posting.post(r,{...options,seriesId:id(10)});
  const key=f.documents('inventoryLedger')[0].v3InventoryBaseline;const stock=await readV3Base4Stock(f.sql.query,key,id(7),id(5));assert.equal(stock.available.toFixed(),baseline===0.3?'0.1':'0.4');
  assert.equal(f.documents('transactions').length,3);f.db.close();
 }
});
test('BASE4 aggregate demands and near-zero quantities never admit one ten-thousandth excess or round old precision',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());f.db.prepare('UPDATE master_v3_inventory_balances SET qty_on_hand=0.3').run();const a=await unitSale(12,'0.1'),b=await unitSale(30,'0.2');
 const merged={...a,lines:[...a.lines,...b.lines],totals:wireTotals([...a.lines,...b.lines]),payments:[{payment_id:id(15),method:'cash' as const,amount:'13.50'}]};await f.posting.post(merged,options);
 const before=f.state();await assert.rejects(f.posting.post(await unitSale(50,'0.0001'),options),/INSUFFICIENT_STOCK/);assert.deepEqual(f.state(),before);
 const tiny=await nativeFixture();try {tiny.db.prepare('UPDATE master_v3_inventory_balances SET qty_on_hand=0.0003').run();await tiny.posting.post(await unitSale(12,'0.0001'),options);await tiny.posting.post(await unitSale(30,'0.0002'),options);await assert.rejects(tiny.posting.post(await unitSale(50,'0.0001'),options),/INSUFFICIENT_STOCK/);}finally{tiny.db.close();}
 const precise=await nativeFixture();try{precise.db.prepare('UPDATE master_v3_inventory_balances SET qty_on_hand=0.30001').run();await assert.rejects(precise.posting.post(await unitSale(12,'0.1'),options),/PRECISION_INVALID/);}finally{precise.db.close();}
 const old=await nativeFixture();try{const owner=old.db.prepare('SELECT binding FROM master_v3_operational_owner').get() as any;const key=JSON.stringify([owner.binding,id(60),32,4,'inventory-cursor']);await old.adapter.saveDocument('inventoryLedger',{id:'old-six-decimal',productId:id(7),warehouseId:id(5),qtyIn:0,qtyOut:0.00001,v3InventoryBaseline:key});const state=old.state();await assert.rejects(old.posting.post(await unitSale(12,'0.1'),options),/PRECISION_INVALID/);assert.deepEqual(old.state(),state);}finally{old.db.close();}
});
test('queued captured native handles cannot read or write an uncertain transaction after rollback fails',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());await f.adapter.saveDocument('customers',{id:'untouched'});const entered=barrier(),release=barrier();let paused=false;
 f.fault.beforeRun=async(sql)=>{if(!paused&&sql.includes('INSERT INTO article_format_outbox')){paused=true;entered.release();await release.promise;}};
 const bridge=(f.adapter as any).db;bridge.rollbackTransaction=async()=>{throw Error('disconnected-rollback');};const post=f.posting.post(nativeSale(),options);await entered.promise;
 const read=f.adapter.executeSQL('SELECT COUNT(*) n FROM article_format_wire_write_scope');const remove=f.adapter.deleteDocument('customers','untouched');const outcomes=Promise.allSettled([read,remove]);f.fault.failWrite=f.fault.writes;release.release();
 await assert.rejects(post,/CONNECTION_UNCERTAIN/);for(const result of await outcomes){assert.equal(result.status,'rejected');if(result.status==='rejected')assert.match(String(result.reason),/CONNECTION_UNCERTAIN/);}
 await assert.rejects(f.adapter.getDocument('customers','untouched'),/CONNECTION_UNCERTAIN/);assert.equal((f.db.prepare("SELECT COUNT(*) n FROM documents WHERE collection_name='customers' AND doc_id='untouched'").get() as {n:number}).n,1);f.db.exec('ROLLBACK');
});
test('all previously permitted B modes use native receipts; NONE/disabled policy and existing E path stay unchanged',async t=>{
 const {seedNativeFiscal}=await import('./articleFormatsNativeFixture');const {dbAdapter}=await import('../services/db');const {db}=await import('../utils/db');
 const names=['getCollection','saveCollection','getDocument','executeSQL','reserveFinancialNumbers'] as const;const originals=new Map(names.map(n=>[n,(dbAdapter as any)[n]]));t.after(()=>{for(const n of names){if(originals.get(n))(dbAdapter as any)[n]=originals.get(n);else delete (dbAdapter as any)[n];}});
 for(const [mode,enabled,permitted] of [[undefined,true,true],[undefined,false,false],['LEGACY_B',true,true],['LEGACY_B',false,true],['ECF',true,true],['ECF',false,false],['NONE',true,false]] as const){
  const f=await nativeFixture();seedNativeFiscal(f);const cfg=f.documents('config')[0];cfg.terminals[0].config.fiscal.mode=mode;cfg.terminals[0].config.fiscal.enabled=enabled;await f.adapter.saveDocument('config',cfg);
  for(const n of names)(dbAdapter as any)[n]=(f.adapter as any)[n].bind(f.adapter);
  assert.equal(await db.getNextNCF('B02',id(4)),permitted?'B0200000002':null,String(mode)+' enabled='+enabled);assert.equal(f.documents('nativeFiscalReservations').length,permitted?1:0);
  f.db.close();
 }
 const e=await nativeFixture();try{const seeded=seedNativeFiscal(e);const cfg=e.documents('config')[0];cfg.terminals[0].config.fiscal.mode='ECF';const range={...seeded.range,type:'E31',prefix:'E31'},allocation={...seeded.allocation,ncfType:'E31',prefix:'E31'};cfg.terminals[0].config.fiscal.fiscalRanges=[range];cfg.terminals[0].config.fiscal.fiscalAllocations=[allocation];await e.adapter.saveDocument('config',cfg);await e.adapter.saveDocument('fiscalRanges',range);await e.adapter.saveDocument('fiscalAllocations',allocation);await e.adapter.saveCollection('localFiscalBuffer',[]);await e.adapter.saveDocument('localFiscalBuffer',{...seeded.buffer,id:'E31',type:'E31',prefix:'E31'});
  for(const n of names)(dbAdapter as any)[n]=(e.adapter as any)[n].bind(e.adapter);
  assert.equal(await db.getNextNCF('E31',id(4)),'E3100000002');assert.equal(e.documents('nativeFiscalReservations').length,0,'existing E path is unchanged');
 }finally{e.db.close();}
});
