import test from 'node:test';
import assert from 'node:assert/strict';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeFixture,seedNativeFiscal,id} from './articleFormatsNativeFixture';
import {refundRetryIdentity,withRefundProcessingLock} from '../services/fiscal/RefundRetryIdentity';
import {reserveRefundFiscalReservation} from '../services/fiscal/RefundFiscalReservation';
import type {CartItem,Transaction} from '../types';

const key='a'.repeat(64);
function input(f:Awaited<ReturnType<typeof nativeFixture>>) {
 const buffer=f.documents('localFiscalBuffer')[0];
 const raw=(name:string,docId:string)=>(f.db.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(name,docId) as {data:string}).data;
 return {global:false,retryKey:`${key}:fiscal`,fiscal:{terminalId:id(4),type:'B02' as const,ncf:'B0200000001',
 expectedConfig:raw('config','current'),expectedBuffer:raw('localFiscalBuffer',buffer.id),
 expectedAllocation:raw('fiscalAllocations',buffer.allocationId),expectedRange:raw('fiscalRanges',buffer.fiscalRangeId)}};
}

test('concurrent identical reservations advance each counter once; another refund gets the next number',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());seedNativeFiscal(f);
 const fiscal=input(f);const reservations=await Promise.all(Array.from({length:4},()=>f.adapter.reserveFinancialNumbers(fiscal)));
 assert.ok(reservations.every(r=>r.ncf==='B0200000001'));
 assert.equal(f.documents('localFiscalBuffer')[0].currentNumber,2);
 const series={seriesId:id(10),documentType:'REFUND',global:false,retryKey:`${key}:series`};
 const results=await Promise.all(Array.from({length:4},()=>f.adapter.reserveFinancialNumbers(series)));
 assert.ok(results.every(r=>r.seriesNumber===1));
 assert.equal(f.documents('internalSequences').find(s=>s.id===id(10)).nextNumber,2);
 assert.equal((await f.adapter.reserveFinancialNumbers({...series,retryKey:`${'b'.repeat(64)}:series`})).seriesNumber,2);
 await assert.rejects(f.adapter.reserveFinancialNumbers({...series,seriesId:id(9)}),/ID_MISMATCH/);
 const before=f.state();await assert.rejects(f.adapter.reserveFinancialNumbers({...series,retryFingerprint:'changed-return'}),/ID_MISMATCH/);assert.deepEqual(f.state(),before);
});

test('failure at every reservation write rolls back the counter and its retry receipt together',async()=>{
 const reference=await nativeFixture();seedNativeFiscal(reference);await reference.adapter.reserveFinancialNumbers(input(reference));
 const writes=reference.fault.writes;reference.db.close();
 for(let i=0;i<writes;i++){
  const f=await nativeFixture();seedNativeFiscal(f);const before=f.state();f.fault.failWrite=i;
  await assert.rejects(f.adapter.reserveFinancialNumbers(input(f)),/injected-write/);
  assert.deepEqual(f.state(),before,`write ${i}`);f.fault.failWrite=undefined;
  assert.equal((await f.adapter.reserveFinancialNumbers(input(f))).ncf,'B0200000001');f.db.close();
 }
});

test('lost commit response then process/database reopen recovers the original fiscal and internal reservations',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-refund-retry-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'pos.sqlite');
 let f=await nativeFixture(new SQLite(file));seedNativeFiscal(f);const request=input(f);
 f.fault.loseCommitResponse=true;await assert.rejects(f.adapter.reserveFinancialNumbers(request),/COMMIT_UNCERTAIN/);f.db.close();
 f=await nativeFixture(new SQLite(file),false);
 const fiscal=await f.adapter.reserveFinancialNumbers(request);assert.equal(fiscal.ncf,'B0200000001');assert.equal(f.documents('localFiscalBuffer')[0].currentNumber,2);
 const requestSeries={seriesId:id(10),documentType:'REFUND',global:false,retryKey:`${key}:series`};
 f.fault.loseCommitResponse=true;await assert.rejects(f.adapter.reserveFinancialNumbers(requestSeries),/COMMIT_UNCERTAIN/);f.db.close();
 f=await nativeFixture(new SQLite(file),false);t.after(()=>f.db.close());
 assert.equal((await f.adapter.reserveFinancialNumbers(requestSeries)).displayId,'REF-000001');
 assert.equal(f.documents('internalSequences').find(s=>s.id===id(10)).nextNumber,2);
 assert.equal(f.documents('refundNumberReservations').length,2);
});

test('retry identity ignores sync/catalog flags, timestamps and line ordering; committed partial returns separate the next operation',async()=>{
 const original={id:'sale',relatedTransactions:[],syncStatus:'PENDING'} as unknown as Transaction;
 const items=[{id:'p',cartId:'line',quantity:1,price:10},{id:'q',cartId:'line2',quantity:2,price:4}] as CartItem[];
 const conditions=new Map<string,'SELLABLE'|'DAMAGED'>([['line','SELLABLE']]);
 const first=await refundRetryIdentity({tenantId:'one'},original,items,conditions,'return',{});
 const retry=await refundRetryIdentity({tenantId:'one'},{...original,syncStatus:'COMPLETED'},[...items].reverse().map(i=>({...i,syncStatus:'COMPLETED'})),conditions,'return',{});
 assert.deepEqual(retry,first);
 assert.match(first.operationId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.equal(first.transactionId,`NC-${first.operationId}`);assert.ok(first.transactionId.length<=64);
 assert.notEqual((await refundRetryIdentity({tenantId:'two'},original,items,conditions,'return',{})).key,first.key);
 assert.notEqual((await refundRetryIdentity({tenantId:'one'},{...original,relatedTransactions:['previous']},items,conditions,'return',{})).key,first.key);
 const changed=await refundRetryIdentity({tenantId:'one'},original,[{...items[0],quantity:2}],conditions,'return',{});
 assert.equal(changed.key,first.key);assert.notEqual(changed.fingerprint,first.fingerprint);
 const payment={id:'pay',method:'CASH' as const,amount:18,timestamp:new Date()};
 assert.deepEqual(await refundRetryIdentity({},original,items,conditions,'return',{refundPayments:[payment]}),
 await refundRetryIdentity({},original,items,conditions,'return',{refundPayments:[{...payment,timestamp:new Date(0)}]}));
});

test('durable legacy fiscal retry never calls a new allocation checkout; uncertain allocation never falls back',async()=>{
 const saved={ncf:'E340000000007',fiscalIssuance:{ncf:'E340000000007'}};
 const base={retryKey:`${key}:fiscal`,operationId:'same-operation',refundFiscalType:'E34',originalTransactionId:'sale',
 items:[{id:'p',cartId:'p',quantity:1,price:10}],terminalId:'t',activeTerminalConfig:{},
 db:{getReservedRefundFiscalNumber:async()=>saved,reserveFiscalNumber:async()=>{throw Error('must not reserve again');}}};
 assert.equal(await reserveRefundFiscalReservation({...base,client:{reserveOfflineCheckout:async()=>{throw Error('must not switch routes');}}}),saved);
 let calls=0;
 await assert.rejects(reserveRefundFiscalReservation({...base,db:{...base.db,getReservedRefundFiscalNumber:async()=>null},
 client:{allocationReady:async()=>true,reserveOfflineCheckout:async(_cart,op)=>{calls++;assert.equal(op,'same-operation');throw Error('NATIVE_FINANCIAL_COMMIT_UNCERTAIN');}}}),/COMMIT_UNCERTAIN/);
 assert.equal(calls,1);
});

test('callbacks serialize through validation even after a failed attempt',async()=>{
 const events:string[]=[];
 const one=withRefundProcessingLock(async()=>{events.push('start');await Promise.resolve();events.push('fail');throw Error('disk');});
 const two=withRefundProcessingLock(async()=>{events.push('retry');return 1;});
 await assert.rejects(one,/disk/);assert.equal(await two,1);assert.deepEqual(events,['start','fail','retry']);
});

test('real db callers recover an exhausted local fiscal buffer and a reserved series without reissuing',async t=>{
 if(typeof globalThis.localStorage==='undefined') Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
 const f=await nativeFixture();t.after(()=>f.db.close());seedNativeFiscal(f);
 const {dbAdapter}=await import('../services/db');const {db}=await import('../utils/db');
 const names=['getCollection','saveCollection','getDocument','executeSQL','reserveFinancialNumbers'] as const;
 const original=new Map(names.map(n=>[n,(dbAdapter as any)[n]]));
 for(const n of names)(dbAdapter as any)[n]=(f.adapter as any)[n].bind(f.adapter);
 t.after(()=>{for(const n of names){if(original.get(n))(dbAdapter as any)[n]=original.get(n);else delete (dbAdapter as any)[n];}});
 const first=await db.reserveFiscalNumber('B02',id(4),1,undefined,`${key}:fiscal`);
 assert.equal(first?.ncf,'B0200000002');
 const buffer=f.documents('localFiscalBuffer')[0];buffer.endNumber=2;await f.adapter.saveDocument('localFiscalBuffer',buffer);
 // Exhaust the owned buffer: a retry must recover its receipt before any new-lot request.
 const before=f.state();
 assert.deepEqual(await db.reserveFiscalNumber('B02',id(4),1,undefined,`${key}:fiscal`),first);
 assert.deepEqual(f.state(),before);
 const series=await db.reserveSeriesNumbers(id(10),'REFUND',`${key}:series`);
 assert.deepEqual(await db.reserveSeriesNumbers(id(10),'REFUND',`${key}:series`),series);
 const fiscal=await reserveRefundFiscalReservation({retryKey:`${key}:fiscal`,refundFiscalType:'B02',
 items:[],terminalId:id(4),activeTerminalConfig:undefined,db:db as any});
 assert.deepEqual(fiscal,first);
 await assert.rejects(db.getReservedRefundFiscalNumber(`${key}:fiscal`,'E34'),/ID_MISMATCH/);
});

test('exact prepared financial document survives a failed commit/reopen and generic snapshots cannot erase retry evidence',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'clic-refund-draft-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'pos.sqlite');
 let f=await nativeFixture(new SQLite(file));
 const draft={id:key,transaction:{id:'refund',date:'2026-11-12T22:00:00Z',displayId:'NC-1',ncf:'E340000000007',
 payments:[{id:'refund-payment',method:'STORE_CREDIT',amount:10,timestamp:'2026-11-12T22:00:00Z'}],total:10}};
 await f.adapter.saveDocument('refundRetryDocuments',draft);
 await f.adapter.reserveFinancialNumbers({seriesId:id(10),documentType:'REFUND',global:false,retryKey:`${key}:series`});
 f.db.close();f=await nativeFixture(new SQLite(file),false);t.after(()=>f.db.close());
 assert.deepEqual(await f.adapter.getDocument('refundRetryDocuments',key),draft);
 await assert.rejects(f.adapter.saveDocument('refundRetryDocuments',{...draft,transaction:{...draft.transaction,total:20}}),/IMMUTABLE/);
 await assert.rejects(f.adapter.saveCollection('refundRetryDocuments',[]),/IMMUTABLE/);
 await assert.rejects(f.adapter.deleteDocument('refundNumberReservations',`${key}:series`),/IMMUTABLE/);
 assert.deepEqual(await f.adapter.getDocument('refundRetryDocuments',key),draft);
 assert.equal((await f.adapter.reserveFinancialNumbers({seriesId:id(10),documentType:'REFUND',global:false,retryKey:`${key}:series`})).seriesNumber,1);
});

test('actual App refund callback reuses both numbers and the exact document after draft-save or financial-commit failure',async()=>{
 const {readFileSync}=await import('node:fs');const {transform}=await import('esbuild');
 const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const callback=app.slice(app.indexOf('  const handleProcessRefund = async ('),app.indexOf('  const renderView =',app.indexOf('  const handleProcessRefund = async (')));
 const compiled=await transform(`${callback}\nmodule.exports=handleProcessRefund;`,{loader:'ts',format:'cjs',target:'es2022'});
 const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
 for(const failure of ['draft','commit']){
  const documents=new Map<string,any>();const receipts=new Map<string,any>();let fiscalCount=0,seriesCount=0,failed=false;
  const seen:Transaction[]=[];
  const original={id:'sale',date:'2026-11-12T20:00:00Z',displayId:'SALE-1',items:[{id:'p',cartId:'line',quantity:2,price:10}],total:20,relatedTransactions:[]} as unknown as Transaction;
  const terminal={id:'local',config:{erpTerminalId:'erp-terminal',currentDeviceId:'device',erpBinding:{tenantId:'tenant',companyId:'company',storeId:'store'},documentAssignments:{REFUND:'nc'},inventoryScope:{defaultSalesWarehouseId:'wh'}}};
  const sequences=[{id:'nc',documentType:'REFUND',prefix:'NC-',padding:6,nextNumber:1}];
  const database={
   get:async(name:string)=>name==='internalSequences'?clone(sequences):name==='transactions'?[clone(original)]:[],
   save:async()=>{},
   getReservedRefundFiscalNumber:async(key:string)=>clone(receipts.get(key)||null),
   reserveFiscalNumber:async(_type:string,_terminal:string,_count:number,_config:unknown,key:string)=>{
    if(!receipts.has(key)){fiscalCount++;receipts.set(key,{ncf:'E340000000007',fiscalIssuance:{ncf:'E340000000007'}});}
    return clone(receipts.get(key));
   },
   reserveSeriesNumbers:async(_id:string,_type:string,key:string)=>{
    if(!receipts.has(key)){seriesCount++;receipts.set(key,{seriesNumber:7,displayId:'NC-000007',series:{...sequences[0],nextNumber:8},reservedAt:'2026-11-12T22:00:00Z'});}
    return clone(receipts.get(key));
   },
  };
  const ports:any={
   withRefundProcessingLock,refundRetryIdentity,readRefundOriginal:async()=>clone(original),assertInventoryPresentationReturnAllowed:()=>{},assertFormatsPostingClosed:()=>{},
   LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:false,config:{terminals:[terminal],taxes:[],taxRate:0},getCurrentTerminal:()=>terminal,
   db:database,dbAdapter:{reserveFinancialNumbers:async()=>{},getDocument:async(collection:string,key:string)=>collection==='refundNumberReservations'?{result:receipts.get(key)}:clone(documents.get(key)||null),
    saveDocument:async(_collection:string,value:any)=>{if(failure==='draft'&&!failed){failed=true;throw Error('injected draft save');}documents.set(value.id,clone(value));}},
   transactions:[original],validateRefundItems:()=>({remaining:new Map([['line',2]])}),
   calculateTransactionTaxSummary:(items:CartItem[])=>({total:items.reduce((n,item)=>n+item.quantity*item.price,0),netAmount:10,taxAmount:0}),
   customers:[],resolveSyncTarget:()=>({kind:'ERP_ACTIVE',baseUrl:'https://erp.invalid/api/sync'}),
   getEffectiveFiscalComplianceConfig:()=>({mode:'ECF'}),resolveCreditNoteFiscalCode:()=> 'E34',
   fiscalWorkflowV2Client:{allocationReady:async()=>false,localCheckout:async()=>null},reserveRefundFiscalReservation,
   resolveDocumentAssignmentId:()=> 'nc',setInternalSequences:()=>{},currentUser:{id:'cashier',name:'Cashier'},getDefaultFiscalProvider:()=> 'MSELLER',
   persistStandaloneRefundTransaction:async(tx:Transaction)=>{seen.push(clone(tx));if(failure==='commit'&&!failed){failed=true;throw Error('injected financial commit');}return {refund:tx};},
   readAppProducts:async()=>[],setProducts:()=>{},setTransactions:()=>{},syncFiscalDocument:async()=>{},backgroundSyncManager:{triggerSync:async()=>{}},alert:()=>{},
  };
  const freshCallback=()=>{const module={exports:undefined};new Function(...Object.keys(ports),'module',compiled.code)(...Object.values(ports),module);return module.exports as (original:Transaction,items:CartItem[],conditions:Map<string,string>,reason:string)=>Promise<Transaction>;};
  const selected=[{...original.items[0],quantity:1}];const conditions=new Map([['line','SELLABLE']]);
  await assert.rejects(freshCallback()(original,selected,conditions,'Return'),/injected/);
  const before=[fiscalCount,seriesCount];
  if(failure==='commit'){
   await assert.rejects(freshCallback()(original,[{...selected[0],quantity:2}],conditions,'Return'),/devolución pendiente/);
   assert.deepEqual([fiscalCount,seriesCount],before);
  }
  const result=await freshCallback()(original,selected,conditions,'Return');
  assert.equal(result.displayId,'NC-000007');assert.equal(result.ncf,'E340000000007');
  assert.deepEqual([fiscalCount,seriesCount],[1,1]);
  if(failure==='commit')assert.deepEqual(seen[1],seen[0],'date, payment IDs and financial identity stay identical');
 }
});

test('E34 allocation retry preserves its operation ID and never switches to legacy numbering',async()=>{
 let chosen:string|undefined;let issued=0;
 const checkout={checkoutId:'checkout',transactionId:'refund',allocation:{ncf:'E340000000008'},allocationIssuance:{ncf:'E340000000008'}};
 const options={retryKey:`${key}:fiscal`,retryFingerprint:'b'.repeat(64),operationId:'stable-operation',refundFiscalType:'E34',originalTransactionId:'sale',
 items:[{id:'p',cartId:'line',quantity:1,price:10}],terminalId:'terminal',activeTerminalConfig:{},
 client:{allocationReady:async()=>true,localCheckout:async()=>chosen?checkout:null,reserveOfflineCheckout:async(_cart:string,operation:string)=>{
   if(chosen){assert.equal(operation,chosen);}else{chosen=operation;issued++;}return checkout;
 }},db:{getReservedRefundFiscalNumber:async()=>null,reserveFiscalNumber:async()=>{throw Error('must never switch route');}}};
 assert.deepEqual(await reserveRefundFiscalReservation(options),await reserveRefundFiscalReservation(options));assert.equal(issued,1);
});

test('committed partial NC with lost response is recovered before a fresh refund frontier can issue another number',async t=>{
 const {recoverCommittedRefundRetry}=await import('../services/fiscal/RefundRetryRecovery');
 const f=await nativeFixture();t.after(()=>f.db.close());
 const tx={id:'refund',documentType:'REFUND',originalTransactionId:'sale',date:'2026-11-12T22:00:00Z',items:[],total:10,payments:[],displayId:'NC-7',ncf:'E340000000007'} as unknown as Transaction;
 await f.adapter.saveDocument('refundRetryDocuments',{id:key,scopeKey:'scope',transaction:tx});
 assert.equal(await recoverCommittedRefundRetry(f.adapter,'other-scope','sale'),null);
 assert.equal(await recoverCommittedRefundRetry(f.adapter,'scope','other-sale'),null);
 assert.equal(await recoverCommittedRefundRetry(f.adapter,'scope','sale'),null,'uncommitted draft follows normal retry');
 const committed={...tx,v3CommitFingerprint:'exact-native-commit',v3Binding:'binding',v3InventoryBaseline:'baseline',syncStatus:'COMPLETED' as const};
 await f.adapter.saveDocument('transactions',committed);await f.adapter.saveDocument('transactionHistory',committed);
 const before=f.documents('internalSequences');
 assert.deepEqual(await recoverCommittedRefundRetry(f.adapter,'scope','sale'),committed);
 assert.deepEqual(f.documents('internalSequences'),before);
 assert.equal(f.documents('refundRetryAcknowledgements')[0].transactionId,'refund');
 assert.equal(await recoverCommittedRefundRetry(f.adapter,'scope','sale'),null,'an acknowledged prior NC no longer intercepts a legitimate next partial return');
});

test('pending recovery requires complete matching native financial history and never acknowledges ambiguous money',async t=>{
 const {recoverCommittedRefundRetry}=await import('../services/fiscal/RefundRetryRecovery');
 const f=await nativeFixture();t.after(()=>f.db.close());
 const tx={id:'refund',documentType:'REFUND',originalTransactionId:'sale',items:[],total:10,payments:[]} as unknown as Transaction;
 await f.adapter.saveDocument('refundRetryDocuments',{id:key,scopeKey:'scope',transaction:tx});
 await f.adapter.saveDocument('transactions',{...tx,v3CommitFingerprint:'commit'});
 await assert.rejects(recoverCommittedRefundRetry(f.adapter,'scope','sale'),/conciliación/);
 await f.adapter.saveDocument('transactionHistory',{...tx,total:11,v3CommitFingerprint:'commit'});
 await assert.rejects(recoverCommittedRefundRetry(f.adapter,'scope','sale'),/conciliación/);
 assert.equal(f.documents('refundRetryAcknowledgements').length,0);
});

test('actual App callback recovers a committed partial refund before stale-source validation or any new numbering',async t=>{
 const {readFileSync}=await import('node:fs');const {transform}=await import('esbuild');
 const {recoverCommittedRefundRetry}=await import('../services/fiscal/RefundRetryRecovery');
 const {refundRetryScopeKey}=await import('../services/fiscal/RefundRetryIdentity');
 const f=await nativeFixture();t.after(()=>f.db.close());
 const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');const start=app.indexOf('  const handleProcessRefund = async (');
 const code=await transform(app.slice(start,app.indexOf('  const renderView =',start))+'\nmodule.exports=handleProcessRefund;',{loader:'ts',format:'cjs',target:'es2022'});
 const terminal={id:'local',config:{erpTerminalId:'erp',currentDeviceId:'device',erpBinding:{tenantId:'tenant',companyId:'company',storeId:'store'}}};
 const scope={terminalId:'local',erpTerminalId:'erp',deviceId:'device',binding:terminal.config.erpBinding,erpBase:'https://erp.invalid/api/sync'};
 const tx={id:'refund',originalTransactionId:'sale',documentType:'REFUND',items:[],total:10,payments:[],displayId:'NC-7',ncf:'E340000000007'} as unknown as Transaction;
 await f.adapter.saveDocument('refundRetryDocuments',{id:key,scopeKey:await refundRetryScopeKey(scope),transaction:tx});
 const committed={...tx,v3CommitFingerprint:'committed-once'};
 await f.adapter.saveDocument('transactions',committed);await f.adapter.saveDocument('transactionHistory',committed);
 const notices:string[]=[];let syncs=0;
 const ports={withRefundProcessingLock,getCurrentTerminal:()=>terminal,resolveSyncTarget:()=>({kind:'ERP_ACTIVE',baseUrl:scope.erpBase}),
 LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:true,dbAdapter:f.adapter,refundRetryScopeKey,recoverCommittedRefundRetry,
 readRefundOriginal:async()=>{throw Error('must recover before stale source validation');},
 backgroundSyncManager:{triggerSync:async()=>{syncs++;}},alert:(message:string)=>notices.push(message)};
 const module={exports:undefined};new Function(...Object.keys(ports),'module',code.code)(...Object.values(ports),module);
 const callback=module.exports as unknown as (tx:Transaction,items:CartItem[],conditions:Map<string,string>,reason:string)=>Promise<Transaction>;
 const before=f.documents('internalSequences');
 assert.deepEqual(await callback({id:'sale',relatedTransactions:['refund']} as Transaction,[],new Map(),'Return'),committed);
 assert.deepEqual(f.documents('internalSequences'),before);assert.equal(syncs,1);assert.match(notices[0],/No se creó otra/);
});
