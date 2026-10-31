import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {NativeFiscalWorkflowV2Store,FISCAL_WORKFLOW_V2_SCHEMA} from '../services/db/FiscalWorkflowV2Store';
import {CapacitorSQLiteAdapter} from '../services/db/adapters/CapacitorSQLiteAdapter';
import {DURABLE_OUTBOX_SCHEMA_SQL} from '../services/sync/DurableOutboxSchema';
import {fiscalWorkflowScopeKey} from '../services/fiscal/FiscalWorkflowV2Types';
import type {FiscalWorkflowPermitV2,FiscalWorkflowStateV2} from '../services/fiscal/FiscalWorkflowV2Types';
const scope={tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device'},key=fiscalWorkflowScopeKey(scope);
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec(FISCAL_WORKFLOW_V2_SCHEMA+DURABLE_OUTBOX_SCHEMA_SQL+`CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));`);let fault=false;
 const bridge={query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>{if(fault&&q.includes('INSERT INTO documents'))throw Error('SYNTHETIC_DOCUMENT_WRITE');return {changes:sql.prepare(q).run(...v)};},execute:async(q:string)=>{sql.exec(q);}};
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});
 const store=adapter.fiscalWorkflowStore;const permit=(index:number):FiscalWorkflowPermitV2=>({schemaVersion:2,permitId:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,transactionId:`10000000-0000-4000-8000-${String(index).padStart(12,'0')}`,nonce:`nonce-${index}`,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),scope,issuerRnc:'101010101',environment:0,authorityHash:'a'.repeat(64),operationKind:'SALE',state:'PERMIT'});
 return {sql,bridge,adapter,store,permit,setFault:(value:boolean)=>{fault=value;}};}
const transaction=(checkout:any):any=>({id:checkout.transactionId,fiscalWorkflowCheckoutId:checkout.checkoutId,terminalId:'terminal',date:'2026-10-18',ncf:'E320000000001',ncfType:'E32',total:100,netAmount:100,taxAmount:0,items:[{id:'item',quantity:1,price:100}],payments:[{id:'payment',method:'CASH',amount:100}]});
const commit=(checkout:any,tx:any):any=>{const p=checkout.permit,birth=p?{schemaVersion:2,permitId:p.permitId,transactionId:checkout.transactionId,nonce:p.nonce,checkoutId:checkout.checkoutId}:null;return {documents:[{collectionName:'transactions',document:tx,requireAbsent:true},{collectionName:'transactionHistory',document:tx,requireAbsent:true}],outboxEvent:{eventId:'sale-'+tx.id,eventType:'SALE_POSTED',aggregateType:'TRANSACTION',aggregateId:tx.id,schemaVersion:1,createdAt:tx.date,payload:{transaction:tx,...(birth?{fiscalWorkflowBirth:birth}:{})}},fiscalWorkflowCommits:[{checkoutId:checkout.checkoutId,transactionId:tx.id,birth}]};};
test('durable checkout is recovered before effects, atomically consumed only with actual new financial birth, identical next sale gets another UUID',async()=>{const f=fixture();try{const op=await f.store.refillOperation(key);await f.store.savePermits(key,op,[f.permit(1),f.permit(2)]);const a=await f.store.reserveCheckout(key,'same-cart');await f.store.markPaymentPossible(a.checkoutId,'payment');const reopened=new NativeFiscalWorkflowV2Store(()=>f.bridge,work=>work());assert.equal((await reopened.reserveCheckout(key,'same-cart')).checkoutId,a.checkoutId);const tx=transaction(a);await f.adapter.commitFinancialTransaction(commit(a,tx));assert.equal((await f.store.readCheckout(a.checkoutId))?.phase,'COMMITTED');assert.equal((f.sql.prepare('SELECT state FROM pos_fiscal_permits_v2 WHERE permit_id=?').get(a.permit!.permitId) as any).state,'CONSUMED');assert.deepEqual(await f.store.candidates(key,'',10),[tx.id]);await assert.rejects(f.adapter.commitFinancialTransaction(commit(a,tx)),/DUPLICATE/);assert.equal((f.sql.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n,1);await f.store.acknowledgeCheckout(a.checkoutId);const b=await f.store.reserveCheckout(key,'same-cart',undefined,'second-operation');assert.notEqual(b.transactionId,a.transactionId);assert.notEqual(b.checkoutId,a.checkoutId);}finally{f.sql.close();}});
test('failure after permit consumption rolls back journal, source/history/outbox and watch together',async()=>{const f=fixture();try{const op=await f.store.refillOperation(key);await f.store.savePermits(key,op,[f.permit(1)]);const a=await f.store.reserveCheckout(key,'cart');f.setFault(true);await assert.rejects(f.adapter.commitFinancialTransaction(commit(a,transaction(a))),/SYNTHETIC/);assert.equal((await f.store.readCheckout(a.checkoutId))?.phase,'PREPARED');assert.equal((f.sql.prepare('SELECT state FROM pos_fiscal_permits_v2').get() as any).state,'RESERVED');for(const table of ['documents','sync_outbox_v2','pos_fiscal_watch_v2'])assert.equal((f.sql.prepare('SELECT count(*) n FROM '+table).get() as any).n,0);f.setFault(false);await f.adapter.commitFinancialTransaction(commit(a,transaction(a)));}finally{f.sql.close();}});
test('unpermitted sale retains commercial commit with no birth marker and never borrows a later permit',async()=>{const f=fixture();try{const a=await f.store.reserveCheckout(key,'cart');assert.equal(a.permit,null);const later=await f.store.refillOperation(key);await f.store.savePermits(key,later,[f.permit(1)]);assert.equal((await f.store.reserveCheckout(key,'cart')).permit,null);await f.adapter.commitFinancialTransaction(commit(a,transaction(a)));assert.equal(JSON.parse((f.sql.prepare('SELECT payload_json FROM sync_outbox_v2').get() as any).payload_json).fiscalWorkflowBirth,undefined);}finally{f.sql.close();}});
test('history-only sidecar CAS normalizes reordered scope, retains source and signature on rejection/error and never resurrects active document',async()=>{const f=fixture();try{const a=await f.store.reserveCheckout(key,'cart'),tx=transaction(a);await f.adapter.commitFinancialTransaction(commit(a,tx));f.sql.prepare("DELETE FROM documents WHERE collection_name='transactions'").run();const original=(f.sql.prepare("SELECT data FROM documents WHERE collection_name='transactionHistory'").get() as any).data;
 const state:any={schemaVersion:2,source:'ERP_POS_FISCAL_WORKFLOW_V2',transactionId:tx.id,scope:{deviceId:'device',storeId:'store',terminalId:'terminal',companyId:'company',tenantId:'tenant'},originalDigestV2:'a'.repeat(64),observationVersion:1,decision:'ACCEPTED_CONDITIONAL',signature:null};await f.store.saveState(tx,state,null);assert.deepEqual(await f.store.candidates(key,'',10),[tx.id]);await assert.rejects(f.store.saveState(tx,{...state,decision:'REJECTED',observationVersion:2},1),/CONFLICT/);assert.equal((await f.store.readState(tx.id))?.decision,'ACCEPTED_CONDITIONAL');assert.equal((f.sql.prepare("SELECT data FROM documents WHERE collection_name='transactionHistory'").get() as any).data,original);assert.equal((f.sql.prepare("SELECT count(*) n FROM documents WHERE collection_name='transactions'").get() as any).n,0);
 await f.store.saveState(tx,{...state,signature:{schemaVersion:1,qrUrl:'literal',securityCode:'abc123',signedAt:'literal'},observationVersion:2},1);assert.deepEqual(await f.store.candidates(key,'',10),[]);await assert.rejects(f.store.saveState(tx,{...state,observationVersion:3},2),/CONFLICT/);
 }finally{f.sql.close();}});

test('future gateway intent binds server transaction before authorization and CAS blocks second authorization after interruption',async()=>{const f=fixture();try{const {PaymentIntentService}=await import('../services/payments/PaymentIntentService');const a=await f.store.reserveCheckout(key,'card-cart'),service=new PaymentIntentService(f.adapter,()=>true),input={paymentId:'card-stable',provider:'AZUL',integrationId:'test',amount:100,currencyCode:'DOP',futureCheckout:{checkoutId:a.checkoutId,transactionId:a.transactionId}};await f.store.markPaymentPossible(a.checkoutId,input.paymentId);const intent=await service.create(input);assert.ok(intent);assert.equal((f.sql.prepare('SELECT transaction_id FROM payment_intents_v2').get() as any).transaction_id,a.transactionId);await service.markAuthorizing(intent.intentId,false,input.futureCheckout);await assert.rejects(service.markAuthorizing(intent.intentId,false,input.futureCheckout),/RECONCILIATION/);await assert.rejects(service.create(input),/RECONCILIATION/);assert.equal((f.sql.prepare('SELECT count(*) n FROM payment_intents_v2').get() as any).n,1);await assert.rejects(service.create({...input,futureCheckout:{...input.futureCheckout,transactionId:f.permit(99).transactionId}}),/RECONCILIATION/);}finally{f.sql.close();}});
test('table part fence authorizes only after the part proof is EFFECT_POSSIBLE and owns the payment',async()=>{const f=fixture();try{const {PaymentIntentService}=await import('../services/payments/PaymentIntentService');const ticketId='ticket-1',receiptId='receipt-1',operationId='op-1',fingerprint='deadbeef',paymentId='card-stable';
 const part=(effectPhase:string)=>JSON.stringify({id:ticketId,paymentFraction:{originalTotal:200,count:2,createdAt:'2026-10-25T00:00:00.000Z',parts:[{index:1,amount:100,status:'PENDING',receiptId,operationId,effectPhase,planFingerprint:fingerprint,paymentIDs:[paymentId]},{index:2,amount:100,status:'PENDING'}]}});
 f.sql.prepare("INSERT INTO documents(collection_name,doc_id,data)VALUES('parkedTickets',?,?)").run(ticketId,part('PREPARED'));
 const service=new PaymentIntentService(f.adapter,()=>true),tablePart={ticketId,receiptId,operationId,planFingerprint:fingerprint};
 const intent=await service.create({paymentId,provider:'AZUL',amount:100,currencyCode:'DOP',tablePart});assert.ok(intent);
 await assert.rejects(service.markAuthorizing(intent.intentId,false,undefined,tablePart),/RECONCILIATION/);
 f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='parkedTickets' AND doc_id=?").run(part('EFFECT_POSSIBLE'),ticketId);
 await service.markAuthorizing(intent.intentId,false,undefined,tablePart);
 await assert.rejects(service.markAuthorizing(intent.intentId,false,undefined,tablePart),/RECONCILIATION/);
 await assert.rejects(service.create({paymentId,provider:'AZUL',amount:100,currencyCode:'DOP',tablePart}),/RECONCILIATION/);
 await assert.rejects(service.create({paymentId:'other-payment',provider:'AZUL',amount:100,currencyCode:'DOP',tablePart:{...tablePart,planFingerprint:'ffffffff'}}),/TABLE_PART/);
}finally{f.sql.close();}});
test('ACK COMMIT response loss recovers same durable operation, idempotent ACK; explicit next identical sale alone gets another UUID',async()=>{const f=fixture();try{const a=await f.store.reserveCheckout(key,'same-cart',undefined,'operation-one');await f.adapter.commitFinancialTransaction(commit(a,transaction(a)));const execute=f.bridge.execute;let lost=false;f.bridge.execute=async(q:string)=>{await execute(q);if(q==='COMMIT;'&&!lost){lost=true;throw Error('SYNTHETIC_ACK_RESPONSE_LOST');}};await assert.rejects(f.store.acknowledgeCheckout(a.checkoutId),/ACK_RESPONSE_LOST/);assert.equal((await f.store.currentCheckout(key))?.phase,'ACKNOWLEDGED');const same=await f.store.reserveCheckout(key,'same-cart',undefined,'operation-one');assert.equal(same.transactionId,a.transactionId);await f.store.acknowledgeCheckout(a.checkoutId);const next=await f.store.reserveCheckout(key,'same-cart',undefined,'operation-two');assert.notEqual(next.transactionId,a.transactionId);assert.equal((f.sql.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n,1);}finally{f.sql.close();}});
test('required format permit is selected atomically before any checkout journal, intent, or payment; ordinary no-permit path remains commercial',async()=>{const f=fixture();try{await assert.rejects(f.store.reserveCheckout(key,'format-cart',undefined,'format-operation',{requirePermit:true,authorityHash:'a'.repeat(64)}),/PERMIT_REQUIRED/);for(const table of ['pos_fiscal_checkouts_v2','pos_fiscal_checkout_current_v2','payment_intents_v2','sync_outbox_v2','documents'])assert.equal((f.sql.prepare('SELECT count(*) n FROM '+table).get() as any).n,0);const op=await f.store.refillOperation(key);await f.store.savePermits(key,op,[f.permit(1)]);const a=await f.store.reserveCheckout(key,'format-cart',undefined,'format-operation',{requirePermit:true,authorityHash:'a'.repeat(64)});assert.equal(a.permit?.permitId,f.permit(1).permitId);assert.equal(a.paymentIds.length,0);assert.equal((await f.store.reserveCheckout(key,'format-cart',undefined,'format-operation',{requirePermit:true,authorityHash:'a'.repeat(64)})).checkoutId,a.checkoutId);await f.adapter.commitFinancialTransaction(commit(a,transaction(a)));await f.store.acknowledgeCheckout(a.checkoutId);await assert.rejects(f.store.reserveCheckout(key,'format-cart',undefined,'next-operation',{requirePermit:true,authorityHash:'a'.repeat(64)}),/PERMIT_REQUIRED/);assert.equal((await f.store.currentCheckout(key))?.checkoutId,a.checkoutId,'failed required reservation restores the acknowledged pointer');assert.equal((f.sql.prepare('SELECT count(*) n FROM pos_fiscal_checkouts_v2').get() as any).n,1);}finally{f.sql.close();}
 const legacy=fixture();try{const a=await legacy.store.reserveCheckout(key,'ordinary-cart',undefined,'ordinary-operation');assert.equal(a.permit,null);await assert.rejects(legacy.store.reserveCheckout(key,'ordinary-cart',undefined,'ordinary-operation',{requirePermit:true,authorityHash:'a'.repeat(64)}),/PERMIT_REQUIRED/);const refill=await legacy.store.refillOperation(key);await legacy.store.savePermits(key,refill,[legacy.permit(2)]);await assert.rejects(legacy.store.reserveCheckout(key,'ordinary-cart',undefined,'ordinary-operation',{requirePermit:true,authorityHash:'a'.repeat(64)}),/PERMIT_REQUIRED/);assert.equal((await legacy.store.readCheckout(a.checkoutId))?.permit,null,'never backfill an exposed ordinary identity');assert.equal((legacy.sql.prepare('SELECT state FROM pos_fiscal_permits_v2').get() as any).state,'AVAILABLE');}finally{legacy.sql.close();}});
test('background refill after ACK supports sixteen consecutive required-permit births with distinct durable identities',async()=>{const f=fixture();const {createFiscalWorkflowV2Client}=await import('../services/fiscal/FiscalWorkflowV2Client'),{observeFiscalWorkflowCapability,clearFiscalWorkflowCapability}=await import('../services/fiscal/FiscalWorkflowV2Capability');const base='https://erp.example.invalid/api/sync',headers={'X-Tenant-Id':'tenant','X-Terminal-Id':'terminal','X-Device-Id':'device','X-Sync-Token':'synthetic'};let next=15,requests=0;try{const op=await f.store.refillOperation(key);await f.store.savePermits(key,op,Array.from({length:14},(_,n)=>f.permit(n+1)));observeFiscalWorkflowCapability(base,headers,'2');const client=createFiscalWorkflowV2Client({store:()=>f.store,readAuth:()=>({base,headers,descriptor:scope,assertCurrent(){}}),fetchImpl:async(url)=>{assert.match(String(url),/\/permits$/);requests++;const available=(f.sql.prepare("SELECT permit_json FROM pos_fiscal_permits_v2 WHERE state='AVAILABLE'").all() as any[]).map(r=>JSON.parse(r.permit_json));return {ok:true,json:async()=>({schemaVersion:2,authorityHash:'a'.repeat(64),permits:[...available,f.permit(next++)]})} as Response;}} as any),ids=new Set<string>();await client.prefetch();for(let i=0;i<16;i++){const beforeRequests=requests,checkout=await client.reserveCheckout('same-content','operation-'+i,{requirePermit:true});assert.equal(requests,beforeRequests,'Cobrar reads local permit only');assert.ok(checkout.permit);ids.add(checkout.transactionId);const tx=transaction(checkout);tx.ncf='E32'+String(i+1).padStart(10,'0');await f.adapter.commitFinancialTransaction(commit(checkout,tx));await client.acknowledge(checkout);await client.prefetch();}assert.equal(ids.size,16);assert.equal(requests,17);assert.equal((f.sql.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n,16);assert.equal((f.sql.prepare("SELECT count(*) n FROM pos_fiscal_checkouts_v2 WHERE permit_id IS NULL").get() as any).n,0);assert.equal((f.sql.prepare("SELECT count(*) n FROM pos_fiscal_permits_v2 WHERE state='CONSUMED'").get() as any).n,16);}finally{clearFiscalWorkflowCapability();f.sql.close();}});

import {createFiscalWorkflowV2Client} from '../services/fiscal/FiscalWorkflowV2Client';
import {observeFiscalWorkflowCapability,clearFiscalWorkflowCapability} from '../services/fiscal/FiscalWorkflowV2Capability';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {assertFiscalWorkflowCheckoutReplay} from '../services/fiscal/FiscalWorkflowCheckoutReplay';
const recoveryBase='https://erp.example.invalid/api/sync';
async function recoveryClient(f:ReturnType<typeof fixture>){
 const headers={'X-Tenant-Id':'tenant','X-Terminal-Id':'terminal','X-Device-Id':'device','X-Sync-Token':'recovery-fixture'};
 observeFiscalWorkflowCapability(recoveryBase,headers,'2');let requests=0;
 const client=createFiscalWorkflowV2Client({store:()=>f.store,readAuth:()=>({base:recoveryBase,headers,descriptor:scope,assertCurrent(){}}),
  fetchImpl:async()=>{requests++;return {ok:true,json:async()=>({schemaVersion:2,authorityHash:'a'.repeat(64),permits:[f.permit(1),f.permit(2),f.permit(3)]})} as Response;}} as any);
 await client.prefetch();return {client,requests:()=>requests};
}
const recoverySnapshot=(f:ReturnType<typeof fixture>)=>JSON.stringify(['pos_fiscal_checkout_current_v2','pos_fiscal_checkouts_v2','pos_fiscal_permits_v2','documents','sync_outbox_v2'].map(table=>f.sql.prepare('SELECT * FROM '+table).all()));
const changes=(f:ReturnType<typeof fixture>)=>Number(f.sql.prepare('SELECT total_changes() n').get()?.n);

for(const race of ['missing','effect','committed','ack','replacement-prepared','replacement-ack','malformed-payments'])test(`recovery CAS rejects ${race} between read and reserve before any native mutation`,async()=>{
 const f=fixture();try{const c=await recoveryClient(f);await c.client.reserveCheckout('cart','original-operation',{requirePermit:true});
  const read=f.store.currentCheckout.bind(f.store);let raced=false,before='',writes=0;
  f.store.currentCheckout=async scopeKey=>{
   const original=await read(scopeKey);if(raced)return original;raced=true;
   if(race==='missing')f.sql.prepare('DELETE FROM pos_fiscal_checkout_current_v2 WHERE scope_key=?').run(key);
   else if(race==='effect')await f.store.markPaymentPossible(original!.checkoutId,'unknown-card');
   else if(race==='malformed-payments')f.sql.prepare("UPDATE pos_fiscal_checkouts_v2 SET checkout_json=json_set(checkout_json,'$.paymentIds',json('null')) WHERE checkout_id=?").run(original!.checkoutId);
   else{
    await f.adapter.commitFinancialTransaction(commit(original,transaction(original)));
    if(race!=='committed')await f.store.acknowledgeCheckout(original!.checkoutId);
    if(race.startsWith('replacement')){
     const replacement=await f.store.reserveCheckout(key,'cart',undefined,'replacement-operation',{requirePermit:true,authorityHash:'a'.repeat(64)});
     if(race==='replacement-ack'){const tx=transaction(replacement);tx.ncf='E320000000002';await f.adapter.commitFinancialTransaction(commit(replacement,tx));await f.store.acknowledgeCheckout(replacement.checkoutId);}
    }
   }
   before=recoverySnapshot(f);writes=changes(f);return original;
  };
  await assert.rejects(c.client.reserveCheckout('cart','remounted-ui-operation',{requirePermit:true}),/RECONCILIATION/);
  assert.equal(recoverySnapshot(f),before);assert.equal(changes(f),writes,'CAS must precede allocation/pointer/permit mutation, including rolled-back writes');
  assert.equal(c.requests(),1);
 }finally{clearFiscalWorkflowCapability();f.sql.close();}
});

test('native recovery rejects incomplete/forged expected tuples with zero attempted row writes',async()=>{
 const f=fixture();try{const c=await recoveryClient(f),checkout=await c.client.reserveCheckout('cart','original',{requirePermit:true});
  const proof={scopeKey:key,checkoutId:checkout.checkoutId,transactionId:checkout.transactionId,operationId:'original',cartIdentity:'cart',phase:'PREPARED',paymentIds:[]};
  for(const patch of [{scopeKey:'other'},{checkoutId:''},{transactionId:'other'},{operationId:null},{cartIdentity:'different'},{phase:'ACKNOWLEDGED'},{paymentIds:null},{paymentIds:['unknown']}]){
   const before=recoverySnapshot(f),writes=changes(f);
   await assert.rejects(f.store.reserveCheckout(key,'cart',undefined,'original',{requirePermit:true,authorityHash:'a'.repeat(64),expectedCurrent:{...proof,...patch} as any}),/RECONCILIATION/);
   assert.equal(recoverySnapshot(f),before);assert.equal(changes(f),writes);
  }
 }finally{clearFiscalWorkflowCapability();f.sql.close();}
});

test('actual remounted prepayment callback adopts returned durable op then one cash birth/ACK replays without another effect',async()=>{
 const f=fixture();try{const c=await recoveryClient(f),cart=[{id:'item',cartId:'line',quantity:1,price:748.8}],cartIdentity=JSON.stringify({items:cart,customerId:null,fiscalType:'E32'});
  const original=await c.client.reserveCheckout(cartIdentity,'interrupted-operation',{requirePermit:true});
  const text=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('POSInterface.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:any;
  function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='beforeV3PaymentEffects')arrow=n.initializer;ts.forEachChild(n,visit);}visit(ast);
  const updates:any[]=[],checkoutRef:any={current:null},operationRef:any={current:null};let validation=0;
  const context:any={completedReservationForReceipt:async()=>null,assertCheckoutFiscalAuthority:async()=>{},hasV3ReservationCart:false,activeV3Reservation:null,selectedCustomer:null,
   v3Operational:{validate:async()=>{validation++;}},fiscalCompliance:{mode:'ECF'},fiscalWorkflowV2Client:c.client,getDefaultFiscalProvider:()=> 'MSELLER',config:{},activeTerminalConfig:{},terminalId:'terminal',
   activeRecoveredReservation:null,activeDirectV3TicketId:null,activeTable:null,activePaymentFraction:null,isIntermediateFractionPayment:false,nextPaymentFractionPart:undefined,paymentFractionPartProofRef:{current:null},parkedTicketsRef:{current:[]},onUpdateParkedTicketsRef:{current:async()=>{}},createPaymentFractionPartProof:()=>({receiptId:'receipt',operationId:'operation'}),paymentFractionPlanFingerprint:()=> 'fingerprint',processedCart:cart,cart,fiscalCheckoutRef:checkoutRef,fiscalCheckoutOperationRef:operationRef,offlineTableFiscalContextRef:{current:undefined},offlineTablePaymentFenceRef:{current:false},
   currentFiscalCheckoutCartIdentity:()=>cartIdentity,onUpdateCart:(items:any[])=>updates.push(items),createUuid:()=> 'fresh-ui-operation',setLargeMasterSyncV3CriticalOperation:()=>{},
   assertFiscalWorkflowCheckoutReplay,readFiscalWorkflowLocalScope:()=>scope,db:{getDocument:async(collection:string,id:string)=>{const row=f.sql.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(collection,id);return row?JSON.parse(String(row.data)):null;}}};
  const js=ts.transpileModule(text.slice(text.indexOf('   const resolveCommittedFiscalReceipt ='),text.indexOf('   const beforeV3PaymentEffects ='))+'const invoke='+arrow.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,invoke=new Function(...Object.keys(context),js+';return invoke;')(...Object.values(context));
  const [first,repeat]=await Promise.all([invoke(),invoke()]);
  assert.deepEqual(first.futureCheckout,{checkoutId:original.checkoutId,transactionId:original.transactionId,operationId:original.operationId});assert.deepEqual(repeat.futureCheckout,first.futureCheckout);
  assert.equal(operationRef.current,'interrupted-operation');assert.ok(updates.every(rows=>rows.every((row:any)=>row.fiscalCheckoutOperationId==='interrupted-operation')));assert.equal(validation,2);
  assert.equal((f.sql.prepare('SELECT count(*) n FROM pos_fiscal_checkouts_v2').get() as any).n,1);assert.equal(c.requests(),1);
  const tx={...transaction(original),items:cart,total:748.8,netAmount:748.8};await f.adapter.commitFinancialTransaction(commit(original,tx));
  await assert.rejects(f.adapter.commitFinancialTransaction(commit(original,tx)),/DUPLICATE/);
  const receipt=(await invoke()).completedTransaction;assert.equal(receipt.id,original.transactionId);await c.client.acknowledge(await f.store.readCheckout(original.checkoutId) as any);
  checkoutRef.current=await f.store.readCheckout(original.checkoutId);c.client.invalidate();
  assert.equal((await invoke()).completedTransaction.id,original.transactionId);
  assert.equal((f.sql.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n,1);assert.equal((f.sql.prepare("SELECT count(*) n FROM documents WHERE collection_name='transactionHistory'").get() as any).n,1);
  assert.equal((f.sql.prepare("SELECT count(*) n FROM pos_fiscal_permits_v2 WHERE state='CONSUMED'").get() as any).n,1);
 }finally{clearFiscalWorkflowCapability();f.sql.close();}
});

for(const corruption of ['missing','malformed','transaction','scope','return','void','nonce','native-permit'])test(`remount never recovers a ${corruption} permit into SALE`,async()=>{
 const f=fixture();try{const c=await recoveryClient(f),checkout=await c.client.reserveCheckout('cart','original',{requirePermit:true});
  if(corruption==='native-permit')f.sql.prepare('UPDATE pos_fiscal_checkouts_v2 SET checkout_json=? WHERE checkout_id=?').run(JSON.stringify({...checkout,permit:{...checkout.permit,nonce:'different'}}),checkout.checkoutId);
  else{
   const permit:any=corruption==='missing'?null:corruption==='malformed'?{}:{...checkout.permit};
   if(corruption==='transaction')permit.transactionId='foreign-transaction';if(corruption==='scope')permit.scope={...scope,tenantId:'foreign'};
   if(corruption==='return')permit.operationKind='RETURN';if(corruption==='void')permit.operationKind='VOID';if(corruption==='nonce')permit.nonce='';
   f.sql.prepare('UPDATE pos_fiscal_checkouts_v2 SET checkout_json=? WHERE checkout_id=?').run(JSON.stringify({...checkout,permit}),checkout.checkoutId);
  }
  const before=recoverySnapshot(f),writes=changes(f);
  await assert.rejects(c.client.reserveCheckout('cart','remounted-ui',{requirePermit:true}),/RECONCILIATION/);
  assert.equal(recoverySnapshot(f),before);assert.equal(changes(f),writes);
 }finally{clearFiscalWorkflowCapability();f.sql.close();}
});
test('client context invalidation between current read and reservation cannot mutate a prepared operation',async()=>{
 const f=fixture();try{const c=await recoveryClient(f);await c.client.reserveCheckout('cart','original',{requirePermit:true});
  const read=f.store.currentCheckout.bind(f.store);f.store.currentCheckout=async key=>{const value=await read(key);c.client.invalidate();return value;};
  const before=recoverySnapshot(f),writes=changes(f);await assert.rejects(c.client.reserveCheckout('cart','remounted-ui',{requirePermit:true}),/DISABLED/);
  assert.equal(recoverySnapshot(f),before);assert.equal(changes(f),writes);
 }finally{clearFiscalWorkflowCapability();f.sql.close();}
});
