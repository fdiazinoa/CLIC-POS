import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import SQLite from 'better-sqlite3';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
import {V3OperationalUIQueue,V3OperationalUILifetime,assertV3UIContext} from '../components/v3OperationalUIQueue';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeFixture,id} from './articleFormatsNativeFixture';
import {LargeMasterSyncV3Runtime} from '../services/sync/LargeMasterSyncV3Runtime';
import {assertFormatsPostingClosed} from '../services/articleFormats/activation';
import {validateV3ReservationPricing} from '../services/sync/LargeMasterSyncV3ReservationAuthority';
import {freezeAuthoritativeLineFiscalAmounts,buildTransactionCustomerSnapshot} from '../utils/fiscalBreakdown';
import {reservationClaimId,reservationInvoiceId,reservationAdvancePayment,assertV3ReservationLines} from '../services/sync/LargeMasterSyncV3ReservationAuthority';
import {PaymentIntentService} from '../services/payments/PaymentIntentService';

const warehouse=id(5),tariff=id(6),product=id(7),reservationId='synthetic-reserve';
let bundle:Promise<any>;
async function modules(f:any,durable=true) {
 const globals=globalThis as any;
 globals.__reservation={adapter:f.adapter,identity:{tenantId:id(1),terminalId:id(4),deviceId:id(50),erpSyncBaseUrl:'https://erp.invalid',syncToken:'synthetic'},session:undefined,durable,db:{get:(n:string)=>f.adapter.getCollection(n),getDocument:(...a:any[])=>f.adapter.getDocument(...a),save:(...a:any[])=>f.adapter.saveCollection(...a),saveDocument:(...a:any[])=>f.adapter.saveDocument(...a),assertFiscalTransactionAuthority:async()=>{}}};
 globals.window={dispatchEvent:()=>{}};
 bundle ||= build({stdin:{contents:`export {LargeMasterSyncV3OperationalSession as Session} from './services/sync/LargeMasterSyncV3OperationalSession';export {claimV3Reservation,expireV3Reservation,restoreV3ReservationReference} from './services/sync/LargeMasterSyncV3ReservationRecovery';export {persistV3FinancialTransaction,readV3CompletedReservation} from './services/sync/LargeMasterSyncV3FinancialCommit';export {transactionService} from './services/transactionService';export {transferStockToCommitted} from './utils/inventoryEngine';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':'{}'},plugins:[{name:'native-reservation-environment',setup(b){
 const ports:Record<string,string>={
 './db':'export const db={adjustCommittedStock:(...a)=>globalThis.__reservation.adjustCommittedStock(...a)};',
 '../db':'export const dbAdapter=new Proxy({}, {get:(_t,k)=>{const a=globalThis.__reservation.adapter;return typeof a[k]==="function"?a[k].bind(a):a[k];}});',
 '../../utils/db':'export const db=new Proxy({}, {get:(_t,k)=>{const d=globalThis.__reservation.db;return typeof d[k]==="function"?d[k].bind(d):d[k];}});',
 '../utils/db':'export const db=new Proxy({}, {get:(_t,k)=>{const d=globalThis.__reservation.db;return typeof d[k]==="function"?d[k].bind(d):d[k];}});',
 './CheckoutDiagnostics':'export const recordCheckoutDiagnostic=()=>{};',
 './sync/SyncFeatureFlags':'export const isSyncFeatureEnabled=name=>name==="sqlite_outbox_v2"&&globalThis.__reservation.durable;',
 './sync/LargeMasterSyncV3OperationalSession':'export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__reservation.session;',
 './LargeMasterSyncV3BoundTransport':'export const readLargeMasterSyncV3BoundIdentity=()=>globalThis.__reservation.identity;export const validatedLargeMasterSyncV3ErpSyncBase=v=>v;export const createLargeMasterSyncV3BoundClient=()=>{throw Error("no network");};',
 './LargeMasterSyncV3Platform':'export const assertLargeMasterSyncV3NativeAndroid=()=>{};',
 './LargeMasterSyncV3OperationalSession':'export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__reservation.session;export const v3InventoryBaselineKey=(b,s)=>JSON.stringify([b,s.inventorySyncId||s.syncId,s.inventorySyncVersion??s.syncVersion,s.inventoryVersion,s.inventoryCursor]);',
 './SyncFeatureFlags':'export const isSyncFeatureEnabled=()=>globalThis.__reservation.durable;',
 './DurableOutboxRepository':'export const durableOutboxRepository={commitFinancialTransaction:i=>globalThis.__reservation.adapter.commitFinancialTransaction(i)};',
 '../CheckoutDiagnostics':'export const recordCheckoutDiagnostic=()=>{};',
 };
 b.onResolve({filter:/.*/},a=>ports[a.path]?{path:a.path,namespace:'reservation'}:undefined);
 b.onLoad({filter:/.*/,namespace:'reservation'},a=>({contents:ports[a.path],loader:'js'}));
 }}]}).then(r=>import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text+'\n//# sourceURL=reservation-native-test.mjs').toString('base64')));
 const m=await bundle,store=f.adapter.masterSyncV3Store,runtime=await LargeMasterSyncV3Runtime.open(store);
 globals.__reservation.session=new m.Session({runtime,inventoryVersion:4,inventoryCursor:'inventory-cursor'},(await store.getOperationalOwner())!.binding,store,'https://erp.invalid',globals.__reservation.identity);
 return {...m,session:globals.__reservation.session};
}
async function fixture(file?:string,seed=true,advance=300,durable=true){
 const f=await nativeFixture(file?new SQLite(file):undefined,seed);
 if(seed){
  f.db.prepare("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES(?,32,3,2,'ACTIVE','{}','fixture','fixture')").run(id(60));
  const article=JSON.parse((f.db.prepare('SELECT record_json FROM master_v3_articles').get() as any).record_json);article.activeWarehouseIds=[warehouse];
  f.db.prepare('UPDATE master_v3_articles SET record_json=?').run(JSON.stringify(article));
  f.db.prepare('INSERT INTO master_v3_tariffs(sync_version,tariff_id,active,record_json) VALUES(32,?,1,?)').run(tariff,JSON.stringify({id:tariff,name:'Synthetic',active:true,taxIncluded:false}));
  f.db.prepare('INSERT INTO master_v3_prices VALUES(32,?,?,100)').run(product,tariff);
 }
 const m=await modules(f,durable),config=await m.session.projectConfig(f.documents('config')[0]);
 const put=(name:string,doc:any)=>f.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)').run(name,doc.id,JSON.stringify(doc),0,'fixture');
 if(seed){
  const p=await m.session.withStock((await(await m.session.catalog(tariff,warehouse)).get(product)).product,warehouse);
  const source={id:reservationId,code:'RSV-SYNTHETIC',qrPayload:JSON.stringify({type:'RESERVATION_NOTE',id:reservationId}),customerId:id(100),customerName:'Synthetic customer',total:1000,balancePaid:advance,expiryDate:'2099-01-01T00:00:00Z',status:'ACTIVE',items:[{...p,quantity:10,cartId:'original-reservation-line',cost:35,originalPrice:p.price}],warehouseId:warehouse,terminalId:id(4),createdAt:'2026-10-15T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z'};
  put('reservations',source);put('customers',{id:id(100),name:'Synthetic customer',currentDebt:0});put('inventoryCommitments',{id:`${product}_${warehouse}`,productId:product,warehouseId:warehouse,qtyCommitted:14});put('productStocks',{id:`${product}_${warehouse}`,productId:product,warehouseId:warehouse,qtyPhysical:137,qtyCommitted:14,qtyAvailable:123});
 }
 const invoice=async(targetId=reservationId)=>{
  const recovery=await m.claimV3Reservation(targetId,warehouse),r=recovery.reservation,payment=reservationAdvancePayment(r);
  const items=freezeAuthoritativeLineFiscalAmounts(r.items,config,{discountAmount:0,isTaxIncluded:false,transactionNetAmount:r.total,transactionTaxAmount:0,transactionTotal:r.total});
  return {recovery,transaction:{id:reservationInvoiceId(r.id),v3ReservationClaimId:recovery.claimId,reservationId:r.id,reservationCode:r.code,priorAdvancePaid:r.balancePaid,balanceDueAtSale:r.total-r.balancePaid,seriesId:id(9),documentType:'TICKET',date:recovery.invoiceDate,terminalId:id(4),status:'COMPLETED',total:r.total,netAmount:r.total,taxAmount:0,userId:id(25),userName:'Synthetic',customerId:r.customerId,customerName:r.customerName,...(r.v3Snapshot?{discountAmount:r.v3Snapshot.discountAmount,discountType:r.v3Snapshot.discountType,discountValue:r.v3Snapshot.discountValue,isTaxIncluded:r.v3Snapshot.isTaxIncluded,serviceChargeAmount:r.v3Snapshot.serviceChargeAmount,serviceType:r.v3Snapshot.serviceType,customerSnapshot:r.v3Snapshot.customerSnapshot}:{}),items,payments:[...(r.total>r.balancePaid?[{id:recovery.claimId+':payment:0:cash',method:'CASH',amount:r.total-r.balancePaid,timestamp:recovery.invoiceDate}]:[]),...(payment?[payment]:[])]}};
 };
 return {...f,...m,config,put,invoice};
}
function snapshot(f:any){return {documents:f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),outbox:f.db.prepare('SELECT * FROM sync_outbox_v2 ORDER BY local_sequence').all()};}
function counts(f:any){return ['transactions','transactionHistory','inventoryLedger','v3TicketSettlements'].map(n=>f.documents(n).length);}

test('real native Session recovery preserves customer/line/prices/advance, same claim after restart and current price changes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pos-reservation-')),file=join(dir,'fixture.sqlite');let f=await fixture(file);
 try{
  const original=JSON.stringify(f.documents('reservations')[0]);const first=await f.claimV3Reservation(reservationId,warehouse),again=await f.claimV3Reservation(reservationId,warehouse);
  assert.equal(first.claimId,reservationClaimId(reservationId));assert.equal(first.invoiceDate,again.invoiceDate);assert.equal(first.customer.id,id(100));assert.equal(first.products.length,1);assert.equal(first.reservation.balancePaid,300);assert.equal(first.reservation.items[0].cartId,'original-reservation-line');
  assert.equal(JSON.stringify(f.documents('reservations')[0]),original);assert.deepEqual(counts(f),[0,0,0,0]);
  f.db.close();f=await fixture(file,false);const reopened=await f.claimV3Reservation(reservationId,warehouse);assert.equal(reopened.invoiceDate,first.invoiceDate);assert.equal(f.documents('v3RestoredTicketSources').length,1);
  // Current epoch mutation cannot rewrite a reserved commercial price either.
  f.db.prepare('UPDATE master_v3_prices SET price=120').run();const recovery=await f.claimV3Reservation(reservationId,warehouse);assert.equal(recovery.products[0].price,120);assert.equal(recovery.reservation.items[0].price,100);assert.equal(recovery.pricing.total,1000);
 }finally{f.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('1000−300=700 atomic native invoice, ADVANCE retained once and only new700 PAYMENT_POSTED; replay is read-only',async()=>{
 const f=await fixture();try{
  const {transaction}=await f.invoice();const result=await f.persistV3FinancialTransaction(transaction,f.config,warehouse);
  assert.equal(result.created,true);assert.equal(result.transaction.displayId,'TCK-000001');assert.equal(result.transaction.globalSequence,1);
  assert.deepEqual(counts(f),[1,1,1,1]);assert.equal(f.documents('inventoryLedger')[0].qtyOut,10);assert.equal(f.documents('reservations')[0].status,'INVOICED');assert.equal(f.documents('v3RestoredTicketSources')[0].state,'SETTLED');assert.equal(f.documents('inventoryCommitments')[0].qtyCommitted,4);assert.equal(f.documents('productStocks')[0].qtyCommitted,4);
  assert.equal(f.documents('internalSequences')[0].nextNumber,2);assert.equal(f.documents('globalSequenceCounter')[0].count,1);
  const events=f.db.prepare('SELECT event_type,payload_json FROM sync_outbox_v2 ORDER BY local_sequence').all() as any[];assert.equal(events.length,2);
  const sale=JSON.parse(events[0].payload_json),payment=JSON.parse(events[1].payload_json);assert.equal(sale.transaction.payments.length,2);assert.equal(payment.payments.length,1);assert.equal(payment.payments[0].amount,700);assert.equal(payment.payments[0].method,'CASH');
  const committed=snapshot(f);assert.equal((await f.persistV3FinancialTransaction(transaction,f.config,warehouse)).created,false);assert.deepEqual(snapshot(f),committed);
  await assert.rejects(f.claimV3Reservation(reservationId,warehouse),/RESERVATION_NOT_ACTIVE/);
 }finally{f.db.close();}
});

test('fully prepaid reservation requires no new payment and emits only SALE_POSTED with prior application',async()=>{
 const f=await fixture(undefined,true,1000);try{const {transaction}=await f.invoice();assert.equal(transaction.payments.length,1);assert.equal(transaction.payments[0].method,'ADVANCE');await f.persistV3FinancialTransaction(transaction,f.config,warehouse);assert.deepEqual((f.db.prepare('SELECT event_type FROM sync_outbox_v2').all() as any[]).map(r=>r.event_type),['SALE_POSTED']);}finally{f.db.close();}
});

for(const attack of ['expired','cancelled','invoiced','foreign','missing-stamp','advance-over-total','fiscal-total','quantity','cost','customer'] as const)test('reservation rejects '+attack+' without financial effects',async()=>{
 const f=await fixture();try{
  const original=f.documents('reservations')[0];
  if(['quantity','cost','customer'].includes(attack)){
   const {transaction}=await f.invoice();if(attack==='quantity')transaction.items[0].quantity=9;if(attack==='cost')transaction.items[0].cost=0;if(attack==='customer')transaction.customerId=id(101);
   const before=snapshot(f);await assert.rejects(f.persistV3FinancialTransaction(transaction,f.config,warehouse));assert.deepEqual(snapshot(f),before);
  }else{
   if(attack==='expired')original.expiryDate='2000-01-01';if(attack==='cancelled')original.status='CANCELLED';if(attack==='invoiced')original.invoicedTransactionId='existing';if(attack==='foreign')original.items[0].v3SaleAuthority.binding='foreign';if(attack==='missing-stamp')delete original.items[0].v3SaleAuthority;if(attack==='advance-over-total')original.balancePaid=1001;if(attack==='fiscal-total')original.total=1001;
   f.put('reservations',original);const before=snapshot(f);await assert.rejects(f.claimV3Reservation(reservationId,warehouse));assert.deepEqual(snapshot(f),before);
  }
  assert.deepEqual(counts(f),[0,0,0,0]);
 }finally{f.db.close();}
});

async function refresh(f:any){
 const store=f.adapter.masterSyncV3Store;
 f.db.prepare("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES(?,33,3,2,'VALIDATED','{}','fixture','fixture')").run(id(61));
 for(const table of ['articles','tariffs','taxes','variants','prices','barcodes']){
  const rows=f.db.prepare(`SELECT * FROM master_v3_${table} WHERE sync_version=32`).all() as any[];
  for(const row of rows){row.sync_version=33;if(table==='prices')row.price=120;const keys=Object.keys(row);f.db.prepare(`INSERT INTO master_v3_${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));}
 }
 f.db.prepare('UPDATE master_v3_state SET staging_sync_id=?,staging_version=33').run(id(61));
 await store.activateCatalogOnly(id(61),{binding:(await store.getOperationalOwner()).binding,expectedCatalog:await store.getActiveRuntimeVersion(),inventory:await store.getInventoryAuthority(),assertIdentity:()=>{}});
 Object.assign(f,await modules(f));
}

test('real old-generation reserve keeps100 price/source receipt after current120 refresh; no receipt denies unchanged',async()=>{
 const f=await fixture();try{
  const before=f.documents('reservations')[0];await refresh(f);const recovery=await f.claimV3Reservation(reservationId,warehouse);
  assert.equal(recovery.products[0].price,120);assert.equal(recovery.reservation.items[0].price,100);assert.equal(recovery.reservation.items[0].v3SaleAuthority.syncVersion,32);
  assert.deepEqual(recovery.reservation,before);
  const {transaction}=await f.invoice();await f.persistV3FinancialTransaction(transaction,f.config,warehouse);assert.equal(f.documents('transactions')[0].items[0].price,100);assert.equal(f.documents('transactions')[0].total,1000);
 }finally{f.db.close();}
 const missing=await fixture();try{await refresh(missing);missing.db.prepare('DELETE FROM master_v3_catalog_owners WHERE sync_version=32').run();const before=snapshot(missing);await assert.rejects(missing.claimV3Reservation(reservationId,warehouse),/RETAINED_OWNER_REQUIRED/);assert.deepEqual(snapshot(missing),before);}finally{missing.db.close();}
});

test('two consumers converge on one invoice/ledger/sequence/advance/outbox and content conflicts never overwrite it',async()=>{
 const f=await fixture();try{
  const first=await f.invoice(),second=await f.invoice();assert.deepEqual(first.transaction,second.transaction);
  const settled=await Promise.all([f.persistV3FinancialTransaction(first.transaction,f.config,warehouse),f.persistV3FinancialTransaction(second.transaction,f.config,warehouse)]);
  assert.equal(settled[0].transaction.id,settled[1].transaction.id);assert.deepEqual(counts(f),[1,1,1,1]);assert.equal(f.documents('globalSequenceCounter')[0].count,1);assert.equal(f.documents('inventoryCommitments')[0].qtyCommitted,4);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sync_outbox_v2').get().n,2);
  const before=snapshot(f);const changed=structuredClone(first.transaction);changed.payments[0].amount=699;await assert.rejects(f.persistV3FinancialTransaction(changed,f.config,warehouse),/DUPLICATE_TRANSACTION_MISMATCH/);assert.deepEqual(snapshot(f),before);
 }finally{f.db.close();}
});

test('every financial write fault and precommit fault rolls back reserve/claim/sequences/stock/payments/outbox',async()=>{
 const measure=await fixture();let writes:number;
 try{const {transaction}=await measure.invoice();measure.fault.writes=0;await measure.persistV3FinancialTransaction(transaction,measure.config,warehouse);writes=measure.fault.writes;assert.ok(writes>=10);}finally{measure.db.close();}
 for(let failed=0;failed<writes!;failed++){
  const f=await fixture();try{const {transaction}=await f.invoice(),before=snapshot(f);f.fault.writes=0;f.fault.failWrite=failed;await assert.rejects(f.persistV3FinancialTransaction(transaction,f.config,warehouse),/injected-write/);assert.deepEqual(snapshot(f),before,`write ${failed}`);assert.equal(f.db.inTransaction,false);f.fault.failWrite=undefined;await f.persistV3FinancialTransaction(transaction,f.config,warehouse);assert.deepEqual(counts(f),[1,1,1,1]);assert.equal(f.documents('inventoryCommitments')[0].qtyCommitted,4);}finally{f.db.close();}
 }
 const f=await fixture();try{const {transaction}=await f.invoice(),before=snapshot(f),bridge=(f.adapter as any).db,execute=bridge.execute;bridge.execute=async(sql:string,...args:any[])=>{if(sql==='COMMIT;')throw Error('before-commit');return execute(sql,...args);};await assert.rejects(f.persistV3FinancialTransaction(transaction,f.config,warehouse),/before-commit/);assert.deepEqual(snapshot(f),before);assert.equal(f.db.inTransaction,false);}finally{f.db.close();}
});

for(const durable of [false,true])test(`lost commit response plus reopen/retry preserves original IDs/effects, Outbox=${durable}`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pos-reservation-commit-')),file=join(dir,'fixture.sqlite');let f=await fixture(file,true,300,durable);
 try{
  const {transaction}=await f.invoice(),claim=f.documents('v3RestoredTicketSources')[0],bridge=(f.adapter as any).db,execute=bridge.execute;let lost=false;
  bridge.execute=async(sql:string,...args:any[])=>{const r=await execute(sql,...args);if(sql==='COMMIT;'&&!lost){lost=true;throw Error('lost-commit-response');}return r;};
  await assert.rejects(f.persistV3FinancialTransaction(transaction,f.config,warehouse),/lost-commit-response/);assert.deepEqual(counts(f),[1,1,1,1]);const before=snapshot(f);
  f.db.close();f=await fixture(file,false,300,durable);const result=await f.persistV3FinancialTransaction(transaction,f.config,warehouse);assert.equal(result.created,false);assert.deepEqual(snapshot(f),before);
  assert.deepEqual((f.db.prepare('SELECT event_id FROM sync_outbox_v2 ORDER BY local_sequence').all() as any[]).map(r=>r.event_id),durable?[claim.saleEventId,claim.paymentEventId]:[]);assert.equal(f.documents('inventoryCommitments')[0].qtyCommitted,4);
 }finally{f.db.close();rmSync(dir,{recursive:true,force:true});}
});

for(const problem of ['reservation','commitment'] as const)test('native CAS rejects racing '+problem+' before any financial write',async()=>{
 const f=await fixture();try{const {transaction}=await f.invoice();const original=f.adapter.commitFinancialTransaction.bind(f.adapter);let external:any;
 f.adapter.commitFinancialTransaction=async(input:any)=>{if(problem==='reservation'){external={...f.documents('reservations')[0],balancePaid:200};f.put('reservations',external);}else{external={...f.documents('inventoryCommitments')[0],qtyCommitted:9};f.put('inventoryCommitments',external);}return original(input);};
 await assert.rejects(f.persistV3FinancialTransaction(transaction,f.config,warehouse),/RESERVATION_SOURCE_CHANGED|RETAINED_TICKET_CHANGED|CONCURRENT_FINANCIAL_UPDATE/);assert.deepEqual(counts(f),[0,0,0,0]);assert.equal(f.documents('globalSequenceCounter')[0].count,0);assert.deepEqual(f.documents(problem==='reservation'?'reservations':'inventoryCommitments'),[external]);assert.equal(f.documents('v3RestoredTicketSources')[0].state,'PENDING');
 }finally{f.db.close();}
});

test('stable reservation payment intents reuse AUTHORIZED and CAS rejects concurrent/ambiguous authorization',async()=>{
 const f=await fixture();try{
  await f.claimV3Reservation(reservationId,warehouse);const service=new PaymentIntentService(f.adapter,()=>true),input={paymentId:reservationClaimId(reservationId)+':payment:0:card',provider:'AZUL',integrationId:'synthetic',amount:700,currencyCode:'DOP',retainedOperation:true};
  const first=await service.create(input),again=await service.create(input);assert.equal(first.intentId,again.intentId);
  const attempts=await Promise.allSettled([service.markAuthorizing(first.intentId,true),service.markAuthorizing(first.intentId,true)]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(service.create(input),/RECONCILIATION_REQUIRED/);await service.markAuthorized(first.intentId,{providerReference:'SYNTHETIC',authorizationCode:'SYNTHETIC',responseCode:'00'});
  const authorized=await service.create(input);assert.equal(authorized.status,'AUTHORIZED');assert.equal(authorized.intentId,first.intentId);assert.equal(authorized.providerReference,'SYNTHETIC');await assert.rejects(service.create({...input,amount:701}),/RECONCILIATION_REQUIRED/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM payment_intents_v2').get().n,1);assert.deepEqual(counts(f),[0,0,0,0]);
 }finally{f.db.close();}
});

test('fresh fiscal snapshot supports recovery unchanged and rejects a changed header before payment',async()=>{
 const f=await fixture();try{const source=f.documents('reservations')[0];source.v3Snapshot={binding:source.items[0].v3SaleAuthority.binding,total:1000,netAmount:1000,taxAmount:0,discountAmount:0,discountType:'FIXED',discountValue:0,isTaxIncluded:false,serviceChargeAmount:0,serviceType:'DINE_IN',customerSnapshot:{name:source.customerName}};f.put('reservations',source);
 const first=await f.claimV3Reservation(reservationId,warehouse);assert.deepEqual(first.pricing,source.v3Snapshot);assert.equal(first.customer.name,source.customerName);
 const {transaction}=await f.invoice();Object.assign(transaction,{discountAmount:0,discountType:'FIXED',discountValue:0,isTaxIncluded:false,serviceChargeAmount:0,serviceType:'DINE_IN'});
 const changed={...transaction,discountValue:1};const before=snapshot(f);await assert.rejects(f.persistV3FinancialTransaction(changed,f.config,warehouse),/FISCAL_SNAPSHOT_CHANGED/);assert.deepEqual(snapshot(f),before);await f.persistV3FinancialTransaction(transaction,f.config,warehouse);
 }finally{f.db.close();}
});

test('recovery selects five durable customers by reservation ID independently of visible list/cache or shared SKU',async()=>{
 const f=await fixture();try{const original=f.documents('reservations')[0];for(let n=0;n<5;n++){const source={...original,id:'reserve-'+n,code:'R-'+n,customerId:id(200+n),customerName:'Synthetic '+n,balancePaid:n*100};f.put('reservations',source);f.put('customers',{id:source.customerId,name:source.customerName,currentDebt:0});const actual=await f.claimV3Reservation(source.id,warehouse);assert.equal(actual.customer.id,source.customerId);assert.equal(actual.reservation.items[0].id,product);assert.equal(actual.reservation.code,source.code);assert.equal(actual.reservation.balancePaid,n*100);assert.equal(actual.claimId,reservationClaimId(source.id));}assert.equal(f.documents('v3RestoredTicketSources').length,5);assert.deepEqual(counts(f),[0,0,0,0]);}finally{f.db.close();}
});


for (const fail of [false,true]) test(`actual list/QR recovery callback publishes all UI after durable validation only (failure=${fail})`,async()=>{
 const f=await fixture();try{
  if(fail){const source=f.documents('reservations')[0];source.balancePaid=1001;f.put('reservations',source);}
  const effects:any[]=[],source=readFileSync('components/POSInterface.tsx','utf8'),ast=ts.createSourceFile('POSInterface.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:ts.Expression|undefined;
  function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handleRecoverReservation')arrow=(node.initializer as ts.CallExpression).arguments[0];ts.forEachChild(node,visit);}visit(ast);assert.ok(arrow);
  const lifetime=new V3OperationalUILifetime();lifetime.activate();
  const context={restoreReservation:(id:string)=>f.claimV3Reservation(id,warehouse)},bindings:Record<string,any>={
   v3Operational:context,uiLifetime:{current:lifetime},scanQueue:{current:new V3OperationalUIQueue()},addContext:{current:context},
   cart:[],activeTable:undefined,activeDirectV3TicketId:undefined,latestAddCart:{current:[]},assertV3UIContext,
   onUpdateCart:(value:any)=>effects.push(['cart',value]),onSelectCustomer:(value:any)=>effects.push(['customer',value]),
   setActiveRecoveredReservation:(value:any)=>effects.push(['reservation',value]),setActiveV3Reservation:(value:any)=>effects.push(['claim',value]),
   setGlobalDiscount:(value:any)=>effects.push(['discount',value]),setOrderServiceType:(value:any)=>effects.push(['service',value]),
   closeRecoverReservationModal:()=>effects.push(['close']),setSuccessToast:(value:any)=>effects.push(['success',value]),setErrorToast:(value:any)=>effects.push(['error',value]),
  };
  const js=ts.transpileModule('const handle='+arrow.getText(ast)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const callback=new Function(...Object.keys(bindings),js+'return handle;')(...Object.values(bindings));
  // A forged/stale list object must not supply the price, customer or advance.
  await callback({id:reservationId,total:1,customerId:'foreign',balancePaid:0});
  if(fail){assert.deepEqual(effects.map(row=>row[0]),['error']);assert.match(effects[0][1],/No se pudo recuperar/);assert.equal(f.documents('v3RestoredTicketSources').length,0);}
  else{assert.deepEqual(effects.map(row=>row[0]),['cart','customer','reservation','claim','discount','service','close','success']);assert.equal(effects[0][1][0].cartId,'original-reservation-line');assert.equal(effects[1][1].id,id(100));assert.equal(effects[2][1].balancePaid,300);assert.equal(effects[2][1].total,1000);}
  assert.deepEqual(counts(f),[0,0,0,0]);
 }finally{f.db.close();}
});


for (const advance of [300,1000]) test(`Outbox flag OFF preserves atomic native reserve settlement/replay without inventing events (advance=${advance})`,async()=>{
 const f=await fixture(undefined,true,advance,false);try{const {transaction}=await f.invoice(),before=snapshot(f);f.fault.writes=0;f.fault.failWrite=4;
 await assert.rejects(f.persistV3FinancialTransaction(transaction,f.config,warehouse),/injected-write/);assert.deepEqual(snapshot(f),before);f.fault.failWrite=undefined;
 const outcomes=await Promise.all([f.persistV3FinancialTransaction(transaction,f.config,warehouse),f.persistV3FinancialTransaction(transaction,f.config,warehouse)]);
 assert.equal(outcomes[0].transaction.id,outcomes[1].transaction.id);assert.deepEqual(counts(f),[1,1,1,1]);assert.equal(f.documents('transactions')[0].syncStatus,'PENDING');
 assert.equal(f.documents('reservations')[0].status,'INVOICED');assert.equal(f.documents('inventoryCommitments')[0].qtyCommitted,4);assert.equal(f.documents('globalSequenceCounter')[0].count,1);
 assert.equal(f.documents('transactions')[0].payments.filter((p:any)=>p.method==='ADVANCE')[0].amount,advance);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sync_outbox_v2').get().n,0);
 const committed=snapshot(f);assert.equal((await f.persistV3FinancialTransaction(transaction,f.config,warehouse)).created,false);assert.deepEqual(snapshot(f),committed);
 }finally{f.db.close();}
});


for(const claimPresent of [false,true]) test(`native expiry CAS releases once and leaves other reserve commitment; claim present=${claimPresent}`,async()=>{
 const f=await fixture(),now=Date.now;try{
  if(claimPresent)await f.claimV3Reservation(reservationId,warehouse);
  Date.now=()=>Date.parse('2100-01-01T00:00:00Z');
  assert.equal(await f.expireV3Reservation(reservationId),true);assert.equal(f.documents('reservations')[0].status,'EXPIRED');assert.equal(f.documents('v3RestoredTicketSources')[0].state,'CANCELLED');
  assert.equal(f.documents('inventoryCommitments')[0].qtyCommitted,4);assert.equal(f.documents('productStocks')[0].qtyCommitted,4);assert.deepEqual(counts(f),[0,0,0,0]);
  const after=snapshot(f);assert.equal(await f.expireV3Reservation(reservationId),false);await assert.rejects(f.claimV3Reservation(reservationId,warehouse),/RESERVATION_NOT_ACTIVE/);assert.deepEqual(snapshot(f),after);
 }finally{Date.now=now;f.db.close();}
});

test('invoice-vs-expiry both orders preserve one disposition and unresolved provider intent blocks expiry atomically',async()=>{
 const f=await fixture(),now=Date.now;try{const {transaction}=await f.invoice();await f.persistV3FinancialTransaction(transaction,f.config,warehouse);Date.now=()=>Date.parse('2100-01-01');const before=snapshot(f);assert.equal(await f.expireV3Reservation(reservationId),false);assert.deepEqual(snapshot(f),before);assert.equal(f.documents('inventoryCommitments')[0].qtyCommitted,4);}finally{Date.now=now;f.db.close();}
 const e=await fixture();try{const {transaction}=await e.invoice();Date.now=()=>Date.parse('2100-01-01');await e.expireV3Reservation(reservationId);const before=snapshot(e);await assert.rejects(e.persistV3FinancialTransaction(transaction,e.config,warehouse),/RESERVATION_NOT_ACTIVE/);assert.deepEqual(snapshot(e),before);}finally{Date.now=now;e.db.close();}
 const p=await fixture();try{await p.claimV3Reservation(reservationId,warehouse);const service=new PaymentIntentService(p.adapter,()=>true),input={paymentId:reservationClaimId(reservationId)+':payment:0',provider:'AZUL',amount:700,currencyCode:'DOP',retainedOperation:true};const intent=await service.create(input);await service.markAuthorizing(intent.intentId,true);Date.now=()=>Date.parse('2100-01-01');const before=snapshot(p);await assert.rejects(p.expireV3Reservation(reservationId),/PAYMENT_RECONCILIATION_REQUIRED/);assert.deepEqual(snapshot(p),before);assert.equal(p.documents('inventoryCommitments')[0].qtyCommitted,14);assert.equal(p.db.prepare('SELECT status FROM payment_intents_v2').get().status,'AUTHORIZING');}finally{Date.now=now;p.db.close();}
});

test('expiry fails in each write without leaking commitment release and stale recovery loses source CAS',async()=>{
 const now=Date.now;
 for(let write=0;write<4;write++){
  const f=await fixture();try{await f.claimV3Reservation(reservationId,warehouse);Date.now=()=>Date.parse('2100-01-01');const before=snapshot(f);f.fault.writes=0;f.fault.failWrite=write;await assert.rejects(f.expireV3Reservation(reservationId),/injected-write/);assert.deepEqual(snapshot(f),before);assert.equal(f.db.inTransaction,false);}finally{Date.now=now;f.db.close();}
 }
 const f=await fixture();try{const claim=f.claimV3Reservation(reservationId,warehouse);Date.now=()=>Date.parse('2100-01-01');await assert.rejects(claim,/RESERVATION_NOT_ACTIVE/);await f.expireV3Reservation(reservationId);assert.equal(f.documents('v3RestoredTicketSources').length,1);assert.equal(f.documents('v3RestoredTicketSources')[0].state,'CANCELLED');assert.equal(f.documents('inventoryCommitments')[0].qtyCommitted,4);}finally{Date.now=now;f.db.close();}
});


test('actual provider callback refuses to synthesize a partial approved receipt from an AUTHORIZED intent after reopen',async()=>{
 const f=await fixture();try{
  await f.claimV3Reservation(reservationId,warehouse);const payment={id:reservationClaimId(reservationId)+':payment:0',method:'CARD',amount:700,currencyCode:'DOP',exchangeRate:1};
  const service=new PaymentIntentService(f.adapter,()=>true),intent=await service.create({paymentId:payment.id,provider:'AZUL',integrationId:'synthetic',amount:700,currencyCode:'DOP',retainedOperation:true});
  await service.markAuthorizing(intent.intentId,true);await service.markAuthorized(intent.intentId,{providerReference:'SYNTHETIC',authorizationCode:'SYNTHETIC',responseCode:'00'});
  const source=readFileSync('components/PaymentModal.tsx','utf8'),ast=ts.createSourceFile('PaymentModal.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:ts.Expression|undefined;
  function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='authorizeIntegratedCardPayment')arrow=node.initializer;ts.forEachChild(node,visit);}visit(ast);assert.ok(arrow);
  const binding={workflowPaymentFenceRef:{current:null},resolvePaymentMethodForEntry:()=>({}),resolveGatewayIntegrationForPayment:()=>({provider:'AZUL',id:'synthetic'}),roundToTwo:(n:number)=>Math.round(n*100)/100,
    selectedCurrency:{rate:1},baseCurrency:{code:'DOP'},calculateGatewayTaxAmount:()=>0,validatePaymentAuthority:async()=>{},createAzulOrderNumber:()=> 'synthetic',paymentIntentService:service,paymentOperationId:reservationClaimId(reservationId)};
  const js=ts.transpileModule('const handle='+arrow.getText(ast)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const callback=new Function(...Object.keys(binding),js+'return handle;')(...Object.values(binding));
  await assert.rejects(callback(payment),/PAYMENT_INTENT_RECONCILIATION_REQUIRED/);assert.equal(f.db.prepare('SELECT status FROM payment_intents_v2').get().status,'AUTHORIZED');assert.deepEqual(counts(f),[0,0,0,0]);
 }finally{f.db.close();}
});


test('production create callback → exact durable fresh reservation JSON → recovery → atomic invoice requests only700',async()=>{
 const f=await fixture();try{
  const dbSource=readFileSync('utils/db.ts','utf8'),dbAst=ts.createSourceFile('db.ts',dbSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let adjust:ts.Expression|undefined;
  function visitDb(node:ts.Node){if(ts.isPropertyAssignment(node)&&node.name.getText(dbAst)==='adjustCommittedStock')adjust=node.initializer;ts.forEachChild(node,visitDb);}visitDb(dbAst);assert.ok(adjust);
  const adjustJs=ts.transpileModule('const handle='+adjust.getText(dbAst)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  (globalThis as any).__reservation.adjustCommittedStock=new Function('dbAdapter',adjustJs+'return handle;')(f.adapter);
  const original=f.documents('reservations')[0],customer=f.documents('customers')[0],effects:any[]=[],source=readFileSync('components/POSInterface.tsx','utf8'),ast=ts.createSourceFile('POSInterface.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:ts.Expression|undefined;
  function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handleCreateReservation')arrow=node.initializer;ts.forEachChild(node,visit);}visit(ast);assert.ok(arrow);
  const effect=(name:string)=>(value:any)=>effects.push([name,value]);
  const bindings={activeV3Reservation:null,cart:original.items,customers:[customer],selectedCustomer:customer,reservationCustomerId:customer.id,reservationDeliveryDate:'2098-01-01',reservationAdvanceInput:'300',reservationPolicy:{requireAdvance:false,validityDays:7},cartTotal:1000,cartTax:0,cartTip:0,discountAmount:0,globalDiscount:{type:'FIXED',value:0},isTaxIncluded:false,effectiveOrderServiceType:'DINE_IN',appliedServiceTaxPolicy:{taxIds:[]},taxBreakdown:[],baseCurrency:{symbol:'$',code:'DOP'},editableRecoveredReservation:null,defaultSalesWarehouseId:warehouse,processedCart:original.items,terminalId:id(4),currentUser:{id:id(25),name:'Synthetic'},isEditingRecoveredReservation:false,
    config:f.config,v3Operational:{validate:(lines:any[])=>f.session.validate(f.config,lines,tariff,warehouse)},assertFormatsPostingClosed,validateV3ReservationPricing,buildTransactionCustomerSnapshot,
    db:{saveDocument:(...args:any[])=>f.adapter.saveDocument(...args)},products:original.items,transferStockToCommitted:f.transferStockToCommitted,reloadReservations:async()=>{await f.adapter.getCollection('reservations');},
    setErrorToast:effect('error'),alert:effect('alert'),setShowReservationModal:effect('modal'),setShowReservationReceipt:effect('receipt'),setReservationAdvanceInput:effect('advanceInput'),setReservationDeliveryDate:effect('dateInput'),setReservationCustomerId:effect('customerInput'),recordCheckoutDiagnostic:()=>{},activeTable:undefined,onUpdateCart:effect('cart'),onSelectCustomer:effect('customer'),setActiveRecoveredReservation:effect('recovery'),setActiveV3Reservation:effect('claim'),setSuccessToast:effect('success')};
  const js=ts.transpileModule('const handle='+arrow.getText(ast)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const callback=new Function(...Object.keys(bindings),js+'return handle;')(...Object.values(bindings));await callback();
  assert.equal(effects.filter(row=>['error','alert'].includes(row[0])).length,0);
  const created=f.documents('reservations').find((row:any)=>row.id!==reservationId);assert.ok(created);assert.equal(created.balancePaid,300);assert.equal(created.total,1000);assert.equal(created.items[0].cartId,original.items[0].cartId);assert.equal(created.items[0].v3SaleAuthority.syncVersion,32);assert.equal(created.customerId,customer.id);assert.ok(created.v3Snapshot);assert.equal(f.documents('inventoryCommitments')[0].qtyCommitted,24);
  const raw=f.db.prepare("SELECT data FROM documents WHERE collection_name='reservations' AND doc_id=?").get(created.id).data as string;
  if(process.env.CLIC_RESERVATION_CREATE_EVIDENCE)writeFileSync(process.env.CLIC_RESERVATION_CREATE_EVIDENCE,raw+'\n',{mode:0o600});
  const {recovery,transaction}=await f.invoice(created.id);assert.equal(JSON.stringify(recovery.reservation),raw);assert.equal(transaction.payments.find((p:any)=>p.method==='CASH').amount,700);assert.equal(transaction.payments.find((p:any)=>p.method==='ADVANCE').amount,300);
  await f.persistV3FinancialTransaction(transaction,f.config,warehouse);assert.deepEqual(counts(f),[1,1,1,1]);assert.equal(f.documents('inventoryCommitments')[0].qtyCommitted,14);assert.equal(f.documents('reservations').find((r:any)=>r.id===reservationId).status,'ACTIVE');assert.equal(f.documents('reservations').find((r:any)=>r.id===created.id).status,'INVOICED');
 }finally{f.db.close();}
});

function actualCallback(file:string,name:string,bindings:Record<string,any>){
 const source=readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:ts.Expression|undefined;
 function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name&&node.initializer)arrow=ts.isCallExpression(node.initializer)?node.initializer.arguments[0]:node.initializer;ts.forEachChild(node,visit);}visit(ast);assert.ok(arrow,`${file}:${name}`);
 const js=ts.transpileModule('const handler='+arrow.getText(ast)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 return new Function(...Object.keys(bindings),js+'return handler;')(...Object.values(bindings));
}

for(const durable of [false,true])for(const ambiguity of ['none','commit-response','publication','close-reopen','settings-remount'] as const)test(`actual PaymentModal→POS→App→native commit→receipt/retry ${ambiguity}, Outbox=${durable}`,async()=>{
 const f=await fixture(undefined,true,300,durable);try{
  const prepared=await f.invoice(),recovery=prepared.recovery,source=recovery.reservation,customer=f.documents('customers')[0],messages:any[]=[],trace={stages:{} as Record<string,number>},ui:any={receipt:null,success:false,providerCalls:0};
  const no=()=>{},mark=(t:any,k:string)=>{if(t)t.stages[k]=1;};
  (globalThis as any).localStorage={getItem:(key:string)=>key==='pos_device_id'?id(50):null,setItem:no,removeItem:no};
  (globalThis as any).window={dispatchEvent:no,setTimeout:()=>1,clearTimeout:no,localStorage:(globalThis as any).localStorage};
  const db={get:(n:string)=>f.adapter.getCollection(n),getDocument:(...args:any[])=>f.adapter.getDocument(...args),assertFiscalTransactionAuthority:async()=>{}};
  const log={error:(...args:any[])=>messages.push(args.map(a=>a instanceof Error?a.message:a)),warn:no,log:no};
  const app=actualCallback('App.tsx','handleTransactionComplete',{assertFormatsPostingClosed,config:f.config,deviceId:id(50),db,LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:true,
   persistV3FinancialTransaction:f.persistV3FinancialTransaction,fiscalSinglePreparation:{commit:()=>{throw Error('PREPARATION_CONTROLLER_DISCONNECTED');}},readV3CompletedReservation:f.readV3CompletedReservation,
   setTransactions:()=>{if(['publication','close-reopen','settings-remount'].includes(ambiguity)&&!ui.publicationFailed){ui.publicationFailed=true;throw Error('injected-ui-publication');}},
   setCustomers:no,syncFiscalDocument:async()=>{},backgroundSyncManager:{triggerSync:async()=>{}},console:log});
  const context={restoreReservation:(id:string)=>f.restoreV3ReservationReference(id,warehouse),validate:(lines:any[],ref:any)=>f.session.validate(f.config,lines,tariff,warehouse,'SALE',undefined,ref),
   completedReservation:(r:any,lines:any[],customerId?:string)=>f.readV3CompletedReservation({reservationId:r.id,claimId:reservationClaimId(r.id),expectedSource:r,lines,customerId})};
  const shared:Record<string,any>={activeV3Reservation:recovery,v3Operational:context,fiscalCompliance:{mode:'NONE'},fiscalCheckoutRef:{current:null},activeRecoveredReservation:source,cart:source.items.map((line:any)=>({...line,v3ReservationId:source.id})),processedCart:source.items,cartTotal:1000,cartTax:0,cartTip:0,
   activeTerminalId:id(4),activeTerminalConfig:f.config.terminals[0].config,activeTable:undefined,activeDirectV3TicketId:undefined,activeTableContext:{},activeParkedTicket:undefined,
   selectedCustomer:customer,effectiveSelectedCustomer:customer,hasV3ReservationCart:true,config:f.config,products:recovery.products,currentUser:{id:id(25),name:'Synthetic'},baseCurrency:{code:'DOP',symbol:'$'},
   isOrderTakerMode:false,hasSubtotalizedCart:false,isSelectedCustomerTaxExempt:false,refundAuthorizedBy:null,redeemedCoupon:null,isTaxIncluded:false,discountAmount:0,
   globalDiscount:{type:'FIXED',value:0},effectiveOrderServiceType:'DINE_IN',appliedServiceTaxPolicy:{taxIds:[]},taxBreakdown:[],reservationBalanceDue:700,defaultSalesWarehouseId:warehouse,
   recordCheckoutDiagnostic:no,getLatestPosInteraction:()=>trace,paymentFinalizationInFlightRef:{current:false},assertFormatsPostingClosed,assertCheckoutFiscalAuthority:async()=>{},
   isValidCartQuantity:(q:number)=>q>0,parkedTicketsRef:{current:[]},isPaymentFractionPlanCurrent:()=>false,getEffectiveFiscalComplianceConfig:()=>({mode:'NONE'}),
   isUberRecoveredReservation:()=>false,buildTransactionCustomerSnapshot,ensureSalesWithOpenZPermission:()=>true,resolveTerminalDocumentSeriesId:()=>id(9),
   validateTerminalSeries:()=>({isValid:true}),canAddItemToCart:()=>true,reservationInvoiceId,reservationAdvancePayment,sumCreditPaymentsBase:(payments:any[])=>payments.filter(p=>p.method==='CREDIT').reduce((s,p)=>s+p.amount,0),
   paymentEntryIsCxCCredit:(p:any)=>p.method==='CREDIT',resolveCreditNoteFiscalCode:()=> 'B04',markInteractionStage:mark,isTerminalFiscalReceiptRequired:()=>false,
   readCartOrderNumber:()=>undefined,reserveNextOrderNumber:()=>1,applyOrderContextToItems:(items:any[])=>items,freezeAuthoritativeLineFiscalAmounts,
   getConsignmentTicketFields:()=>({}),buildTransactionSettlementFields:(payments:any[],total:number)=>({settlementAppliedBase:total}),calculateSalesCommission:()=>({}),
   transactionService:f.transactionService,isSyncFeatureEnabled:()=>durable,syncConsignmentSettlement:async(t:any)=>t,onTransactionComplete:app,commitAppliedCoupon:no,
   onUpdateCart:no,resetCompletedSaleDiscount:no,setGlobalDiscount:no,setRedeemedCoupon:no,setCouponCode:no,onSelectCustomer:no,setIsReturnMode:no,setRefundAuthorizedBy:no,
   setActiveRecoveredReservation:no,setActiveV3Reservation:no,setOrderServiceType:no,onClearActiveTable:undefined,onOpenTableMap:undefined,setReturnToTableMapAfterPayment:no,
   console:log,alert:(m:any)=>messages.push(m),setLargeMasterSyncV3CriticalOperation:no};
  shared.completedReservationForReceipt=actualCallback('components/POSInterface.tsx','completedReservationForReceipt',shared);
  shared.clearCompletedReservationCart=actualCallback('components/POSInterface.tsx','clearCompletedReservationCart',shared);
  const onConfirm=actualCallback('components/POSInterface.tsx','handlePaymentConfirm',shared),before=actualCallback('components/POSInterface.tsx','beforeV3PaymentEffects',shared);
  if(ambiguity==='commit-response'){
   const bridge=(f.adapter as any).db,execute=bridge.execute;let lost=false;
   bridge.execute=async(sql:string,...args:any[])=>{const result=await execute(sql,...args);if(sql==='COMMIT;'&&!lost){lost=true;throw Error('injected-commit-response');}return result;};
  }
  const modal:Record<string,any>={workflowPaymentFenceRef:{current:null},items:source.items,total:700,payments:prepared.transaction.payments.filter((p:any)=>p.method!=='ADVANCE'),voluntaryTip:0,
   isFinalizing:false,isProcessingGateway:false,canFinalize:true,isCreditActionBlocked:false,paymentOperationId:recovery.claimId,beforePaymentEffects:before,onConfirm,
   recordCheckoutDiagnostic:no,beginPosInteraction:()=>trace,expectInteractionRender:no,markInteractionStateUpdate:no,markInteractionStage:mark,
   setFinalizeError:(message:any)=>{if(message)messages.push(message);},setSuccessNotice:no,setIsFinalizing:no,setShowSupervisorModal:no,canFinalizeWithTypedAmount:false,
   sumCreditPaymentsBase:()=>0,hasPermission:()=>true,isOverrideActive:false,isOnline:true,isMaster:true,
   measureInteractionStage:async(_t:any,_a:any,_b:any,work:any)=>work(),authorizePendingGatewayPayments:async(payments:any[])=>{ui.providerCalls++;return payments;},
   setPayments:no,customer,config:f.config,isInstallmentPayment:false,setCompletedTransaction:(txn:any)=>{ui.receipt=txn;},setIsSuccessScreen:(v:boolean)=>{ui.success=v;},
   setGatewayProgress:no,console:log,alert:(message:any)=>messages.push(message)};
  const finalize=()=>actualCallback('components/PaymentModal.tsx','handleFinalize',modal)();
  if(ambiguity==='none'){
   const before=snapshot(f);modal.canFinalize=false;await finalize();assert.equal(ui.providerCalls,0);assert.equal(ui.receipt,null);assert.deepEqual(snapshot(f),before);
   modal.canFinalize=true;modal.isCreditActionBlocked=true;await finalize();assert.equal(ui.providerCalls,0);assert.deepEqual(snapshot(f),before);modal.isCreditActionBlocked=false;
  }
  await finalize();
  if(['publication','close-reopen','settings-remount'].includes(ambiguity)){
   assert.equal(ui.receipt,null,JSON.stringify(messages));assert.equal(f.documents('reservations')[0].status,'INVOICED');const committed=snapshot(f),firstProviders=ui.providerCalls;
   // Real final button remains reachable for a reservation completion check with no newly entered payment.
   modal.canFinalize=false;modal.payments=[];
   const text=readFileSync('components/PaymentModal.tsx','utf8'),ast=ts.createSourceFile('PaymentModal.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let disabled:ts.Expression|undefined;
   function visit(node:ts.Node){if(ts.isJsxOpeningElement(node)&&node.tagName.getText(ast)==='button'&&node.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='onClick'&&a.initializer?.getText(ast)==='{handleFinalize}')){const attr=node.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='disabled') as ts.JsxAttribute;disabled=(attr.initializer as ts.JsxExpression).expression;}ts.forEachChild(node,visit);}visit(ast);assert.ok(disabled);assert.equal(new Function('canFinalize','paymentOperationId','isFinalizing','isProcessingGateway','return '+disabled.getText(ast))(false,recovery.claimId,false,false),false);
   if(ambiguity!=='publication'){
    const text=readFileSync('components/POSInterface.tsx','utf8'),ast=ts.createSourceFile('POSInterface.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let close:ts.Expression|undefined,effect:ts.Expression|undefined;
    function find(node:ts.Node){
     if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='UnifiedPaymentModal'){
      const attr=node.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='onClose') as ts.JsxAttribute;
      close=(attr.initializer as ts.JsxExpression).expression;
     }
     if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('ids.size !== 1'))effect=node.arguments[0];
     ts.forEachChild(node,find);
    }find(ast);assert.ok(close);assert.ok(effect);
    const execute=(arrow:ts.Expression,bindings:Record<string,any>)=>new Function(...Object.keys(bindings),ts.transpileModule('const run='+arrow.getText(ast)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+'return run;')(...Object.values(bindings))();
    execute(close,{recordCheckoutDiagnostic:no,setShowPaymentModal:(v:boolean)=>ui.modalOpen=v,returnToTableMapAfterPayment:false,onOpenTableMap:undefined,setReturnToTableMapAfterPayment:no,finishInteraction:no,paymentModalTraceRef:{current:null}});
    assert.equal(ui.modalOpen,false);
    if(ambiguity==='settings-remount'){
     shared.activeV3Reservation=undefined;shared.activeRecoveredReservation=undefined;
     let invalidPublished=false;
     await assert.rejects(new Promise<void>((resolve,reject)=>execute(effect,{...shared,assertV3ReservationLines,
      cart:shared.cart.map((line:any)=>({...line,quantity:line.quantity+1})),
      setActiveV3Reservation:()=>{invalidPublished=true;resolve();},setActiveRecoveredReservation:()=>{invalidPublished=true;},
      onSelectCustomer:()=>{invalidPublished=true;},setErrorToast:(message:string)=>reject(Error(message))})),/RESERVATION_LINES_CHANGED/);
     assert.equal(invalidPublished,false);assert.deepEqual(snapshot(f),committed);
     await new Promise<void>((resolve,reject)=>execute(effect,{...shared,assertV3ReservationLines,
      setActiveV3Reservation:(value:any)=>{shared.activeV3Reservation=value;resolve();},
      setActiveRecoveredReservation:(value:any)=>shared.activeRecoveredReservation=value,
      onSelectCustomer:(value:any)=>shared.selectedCustomer=value,setErrorToast:(message:string)=>reject(Error(message))}));
     assert.equal(shared.activeV3Reservation.claimId,recovery.claimId);assert.equal(shared.activeV3Reservation.reservation.status,'ACTIVE');
     assert.equal(shared.activeV3Reservation.reservation.total,1000);assert.equal(shared.selectedCustomer.id,source.customerId);
    }
    Object.assign(shared,{observeDestinationAttempt:(_t:any,work:any)=>work(),setErrorToast:(message:string)=>messages.push(message),
     expectInteractionDestination:no,paymentModalTraceRef:{current:null},setShowPaymentModal:(v:boolean)=>ui.modalOpen=v,markInteractionStateUpdate:no,
     startCheckoutInteraction:()=>trace,validateTerminalDocument:()=>({isValid:true}),terminalId:id(4),canProceedWithOperationalSession:async()=>{await f.session.assertCurrent();return true;}});
    shared.completedReservationForReceipt=actualCallback('components/POSInterface.tsx','completedReservationForReceipt',shared);
    shared.proceedToCheckout=actualCallback('components/POSInterface.tsx','proceedToCheckout',shared);
    await actualCallback('components/POSInterface.tsx','requestCheckout',shared)(1,true);assert.equal(ui.modalOpen,true,JSON.stringify(messages));
    modal.beforePaymentEffects=actualCallback('components/POSInterface.tsx','beforeV3PaymentEffects',shared);
    modal.onConfirm=actualCallback('components/POSInterface.tsx','handlePaymentConfirm',shared);
   }
   await finalize();assert.deepEqual(snapshot(f),committed);assert.equal(ui.providerCalls,firstProviders);
  }
  assert.ok(ui.receipt,JSON.stringify(messages));assert.equal(ui.success,true);assert.equal(ui.receipt.displayId,'TCK-000001');assert.equal(ui.receipt.seriesNumber,1);assert.equal(ui.receipt.globalSequence,1);
  const stored=f.documents('transactions')[0];assert.deepEqual(JSON.parse(JSON.stringify(ui.receipt)),stored);assert.equal(stored.items[0].originalPrice,source.items[0].originalPrice);assert.equal(stored.total,1000);assert.equal(stored.customerId,source.customerId);assert.equal(stored.id,reservationInvoiceId(source.id));assert.equal(stored.v3ReservationClaimId,recovery.claimId);assert.equal(stored.payments.filter((p:any)=>p.method==='ADVANCE').length,1);assert.equal(stored.payments.find((p:any)=>p.method==='ADVANCE').amount,300);
  assert.deepEqual(counts(f),[1,1,1,1]);assert.equal(f.documents('inventoryCommitments')[0].qtyCommitted,4);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sync_outbox_v2').get().n,durable?2:0);
 }finally{f.db.close();}
});


test('reserved historical discount120→100 survives production normalization and any original-price rewrite is rejected',async()=>{
 const f=await fixture();try{
  const source=f.documents('reservations')[0];source.items[0].originalPrice=120;f.put('reservations',source);
  const {transaction}=await f.invoice();
  const normalized=await f.transactionService.createTransaction(transaction,{deferDurablePersistence:true});
  assert.equal(normalized.items[0].originalPrice,120);assert.equal(normalized.items[0].price,100);
  assertV3ReservationLines(source,normalized.items);
  const changed=structuredClone(normalized.items);changed[0].originalPrice=100;
  assert.throws(()=>assertV3ReservationLines(source,changed),/RESERVATION_LINES_CHANGED/);
  await f.persistV3FinancialTransaction(normalized,f.config,warehouse);
  assert.equal(f.documents('transactions')[0].items[0].originalPrice,120);
 }finally{f.db.close();}
});

for(const attack of ['claim','history','number','source','content'] as const)test('completed receipt recovery rejects altered '+attack+' evidence without effects',async()=>{
 const f=await fixture();try{
  const {transaction,recovery}=await f.invoice();await f.persistV3FinancialTransaction(transaction,f.config,warehouse);
  const request={reservationId,claimId:recovery.claimId,expectedSource:recovery.reservation,lines:recovery.reservation.items,customerId:recovery.reservation.customerId};
  assert.equal((await f.readV3CompletedReservation(request)).id,transaction.id);
  if(attack==='claim'){const d=f.documents('v3RestoredTicketSources')[0];d.v3Binding='foreign';f.put('v3RestoredTicketSources',d);}
  if(attack==='history'){const d=f.documents('transactionHistory')[0];d.payments[0].amount=699;f.put('transactionHistory',d);}
  if(attack==='number'){const d=f.documents('transactions')[0];d.globalSequence=2;f.put('transactions',d);}
  if(attack==='source'){const d=f.documents('reservations')[0];d.balancePaid=301;f.put('reservations',d);}
  if(attack==='content'){const d=f.documents('transactions')[0];d.payments[0].amount=699;f.put('transactions',d);}
  const before=snapshot(f);await assert.rejects(f.readV3CompletedReservation(request));await assert.rejects(f.restoreV3ReservationReference(reservationId,warehouse));assert.deepEqual(snapshot(f),before);
 }finally{f.db.close();}
});
