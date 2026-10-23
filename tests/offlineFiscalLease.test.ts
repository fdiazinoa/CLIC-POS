import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {NativeFiscalWorkflowV2Store,FISCAL_WORKFLOW_V2_SCHEMA} from '../services/db/FiscalWorkflowV2Store';
import {OFFLINE_FISCAL_ABANDON_WRITER_SCHEMA} from '../services/db/FiscalWorkflowRetirementStore';
import {CapacitorSQLiteAdapter} from '../services/db/adapters/CapacitorSQLiteAdapter';
import {DURABLE_OUTBOX_SCHEMA_SQL} from '../services/sync/DurableOutboxSchema';
import {offlineFiscalAuthorityFromConfig} from '../services/fiscal/OfflineFiscalLeaseContext';
import {createFiscalWorkflowV2Client} from '../services/fiscal/FiscalWorkflowV2Client';
import {tableFiscalSourceDigest,validateOfflineFiscalPermit,type OfflineFiscalLease} from '../services/fiscal/OfflineFiscalLease';
import {fiscalWorkflowScopeKey} from '../services/fiscal/FiscalWorkflowV2Types';
import {validateV3FrozenFiscalAmounts} from '../services/sync/LargeMasterSyncV3FinancialCommit';
import {validateV3FrozenLineFiscalAmounts} from '../services/sync/LargeMasterSyncV3LineSource';
import {resolveAppliedServiceTaxPolicy} from '../utils/serviceTaxPolicy';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {assertFiscalWorkflowCheckoutReplay,readFiscalWorkflowLocalScope} from '../services/fiscal/FiscalWorkflowCheckoutReplay';
import {encodeOriginal} from '../services/recovery/OriginalCodec';
const scope={tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'00000000-0000-4000-8000-000000000001',deviceId:'device'};
const uuid=(prefix:number,index:number)=>`${String(prefix).padStart(8,'0')}-0000-4000-8000-${String(index).padStart(12,'0')}`;
const config:any={companyInfo:{rnc:'101010101'},terminals:[{id:'00000000-0000-4000-8000-000000000001',config:{isPrimaryNode:true,governedByMaster:false,syncConfig:{mode:'MASTER'},erpTerminalId:'00000000-0000-4000-8000-000000000001',currentDeviceId:'device',erpBinding:{tenantId:'tenant',companyId:'company',storeId:'store'},fiscal:{providerId:'MSELLER',mode:'ECF',enabled:true,environment:0,credentialKey:'101010101'}}}]};
const credentials={...scope,erpTenantId:'tenant',erpTerminalId:'00000000-0000-4000-8000-000000000001',syncToken:'synthetic-expired-session',syncTokenExpiresAt:'2020-01-01T00:00:00Z',deviceToken:'synthetic-device',authStatus:'BOUND'};
async function fixture(capacity=16,download=true){
 const entries=new Map<string,string>([['clic_terminal_credentials_v1',JSON.stringify(credentials)],['CLIC_POS_DEVICE_ID','device']]);
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:(k:string)=>entries.get(k)||null,setItem:(k:string,v:string)=>entries.set(k,v),removeItem:(k:string)=>entries.delete(k)},configurable:true});
 const sql=new DatabaseSync(':memory:');sql.exec(FISCAL_WORKFLOW_V2_SCHEMA+DURABLE_OUTBOX_SCHEMA_SQL+`CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));CREATE TABLE sync_queue(id TEXT PRIMARY KEY,payload TEXT NOT NULL);`+OFFLINE_FISCAL_ABANDON_WRITER_SCHEMA);
 let fault=false;const bridge={query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>({changes:sql.prepare(q).run(...v)}),execute:async(q:string)=>{if(fault&&q.includes('INSERT INTO documents'))throw Error('SYNTHETIC_DISK_FAILURE');sql.exec(q);}};
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});const store=adapter.fiscalWorkflowStore;
 const authority=await offlineFiscalAuthorityFromConfig(config,credentials,'device'),now=Date.now();
 const lease:OfflineFiscalLease={contractVersion:1,authorizationKind:'OFFLINE_FISCAL_LEASE_V1',leaseId:uuid(9,1),scope,issuerRnc:'101010101',provider:'MSELLER',environment:0,issuedAt:new Date(now-1000).toISOString(),validUntil:new Date(now+7*86400000-1000).toISOString(),authorityHash:'a'.repeat(64),saleCapacity:capacity,bindingFingerprint:'b'.repeat(64)};
 const permits=Array.from({length:capacity},(_,i)=>({schemaVersion:2 as const,permitId:uuid(1,i+1),transactionId:uuid(2,i+1),nonce:'nonce-'+i,createdAt:new Date(now).toISOString(),expiresAt:lease.validUntil,scope,issuerRnc:lease.issuerRnc,environment:0 as const,authorityHash:lease.authorityHash,operationKind:'SALE' as const,state:'PERMIT',leaseId:lease.leaseId}));
 sql.prepare("INSERT INTO documents(collection_name,doc_id,data)VALUES('config','current',?)").run(JSON.stringify(config));
 for(let page=0;download&&page<permits.length;page+=16)await store.saveOfflineLeasePage!(lease,permits.slice(page,page+16),authority,new Date(now).toISOString());
 let requests=0;const client=()=>createFiscalWorkflowV2Client({store:()=>store,readOfflineAuthority:()=>offlineFiscalAuthorityFromConfig(config,credentials,'device'),readAuth:()=>{throw Error('EXPIRED_TRANSPORT_SESSION');},fetchImpl:async()=>{requests++;throw Error('OFFLINE');}} as any);
 return {sql,bridge,adapter,store,authority,lease,permits,entries,client,requests:()=>requests,setFault:(v:boolean)=>{fault=v;}};
}
const count=(f:any,table:string)=>Number(f.sql.prepare('SELECT count(*) n FROM '+table).get().n);
async function tableSource(f:Awaited<ReturnType<typeof fixture>>,id='account'){
 const account={id,tableId:'mesa-6',items:[{id:'item',cartId:'line',quantity:1,price:555}],total:710.4};const literal=JSON.stringify(account);
 f.sql.prepare("INSERT INTO documents(collection_name,doc_id,data)VALUES('parkedTickets',?,?)").run(id,literal);
 return {account,literal,context:{schemaVersion:1 as const,kind:'TABLE_ACCOUNT' as const,accountId:id,tableId:'mesa-6',sourceSha256:await tableFiscalSourceDigest(literal)}};
}
function commit(f:any,c:any,table?:Awaited<ReturnType<typeof tableSource>>){
 const tx:any={id:c.transactionId,fiscalWorkflowCheckoutId:c.checkoutId,fiscalOfflineLeaseId:f.lease.leaseId,date:c.offlineSaleDate,terminalId:'00000000-0000-4000-8000-000000000001',ncf:'E32'+c.transactionId.slice(-10),ncfType:'E32',total:710.4,netAmount:555,taxAmount:99.9,serviceChargeAmount:55.5,items:[{id:'item',cartId:'line',quantity:1,price:555}],payments:[{id:'payment',method:'CASH',amount:710.4}],fiscalEnvironment:f.lease.environment,fiscalProvider:'MSELLER',fiscalMode:'ECF',fiscalIssuance:{schemaVersion:1,source:'POS_FISCAL_RESERVATION_V1',ncf:'E32'+c.transactionId.slice(-10),ncfType:'E32',sequence:1,fiscalRangeId:'synthetic-range',fiscalAllocationId:'synthetic-allocation',prefix:'E32',rangeStart:1,rangeEnd:1024,allocationStart:1,allocationEnd:1024,expiryDate:null,issuerRnc:f.lease.issuerRnc,tenantId:scope.tenantId,companyId:scope.companyId,terminalId:scope.terminalId,capturedAt:c.offlineSaleDate},...(table?{fiscalSaleContext:table.context,restaurantOrderId:table.context.accountId,restaurantTableId:table.context.tableId}:{})};
 const birth={schemaVersion:2,permitId:c.permit.permitId,transactionId:c.transactionId,nonce:c.permit.nonce,checkoutId:c.checkoutId};
 return {documents:[{collectionName:'transactions',document:tx,requireAbsent:true},{collectionName:'transactionHistory',document:tx,requireAbsent:true},...(table?[{collectionName:'v3TicketSettlements',document:{id:table.context.accountId,transactionId:tx.id},requireAbsent:true,v3ExpectedRetainedDocument:{collection:'parkedTickets',id:table.context.accountId,expected:table.literal}}]:[])],outboxEvent:{eventId:'sale-'+tx.id,eventType:'SALE_POSTED',aggregateType:'TRANSACTION',aggregateId:tx.id,schemaVersion:1,createdAt:tx.date,payload:{transaction:tx,fiscalWorkflowBirth:birth}},fiscalWorkflowCommits:[{checkoutId:c.checkoutId,transactionId:tx.id,birth}]};
}
test('expired transport, >5min and client restart: local table cash birth retains 710.40 and consumes one permit/settlement/outbox with zero HTTP',async()=>{
 const f=await fixture(),realNow=Date.now,later=Date.now()+301000;Date.now=()=>later;try{const table=await tableSource(f),identity=JSON.stringify({items:table.account.items,customerId:null,fiscalType:'E32',fiscalSaleContext:table.context});
  const checkout=await f.client().reserveOfflineCheckout(identity,'operation',table.context);
  const reopened=new NativeFiscalWorkflowV2Store(()=>f.bridge,work=>work());assert.equal((await reopened.readCheckout(checkout.checkoutId))?.checkoutId,checkout.checkoutId);
  const input=commit(f,checkout,table);await f.adapter.commitFinancialTransaction(input as any);
  await assert.rejects(f.adapter.commitFinancialTransaction(input as any),/DUPLICATE|RETAINED/);
  assert.equal(count(f,'sync_outbox_v2'),1);assert.equal(f.sql.prepare("SELECT count(*) n FROM documents WHERE collection_name='v3TicketSettlements'").get()!.n,1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM pos_fiscal_permits_v2 WHERE state='CONSUMED'").get()!.n,1);
  const source=JSON.parse(String(f.sql.prepare("SELECT data FROM documents WHERE collection_name='transactions'").get()!.data));assert.deepEqual([source.netAmount,source.taxAmount,source.serviceChargeAmount,source.total],[555,99.9,55.5,710.4]);assert.equal(f.requests(),0);
 }finally{Date.now=realNow;f.sql.close();}
});
test('15th offline sale succeeds; configured quota+1 cannot allocate; 1024-permit storage stays bounded and survives reopening',async()=>{
 const f=await fixture(16);try{const client=f.client();for(let i=0;i<16;i++){const c=await client.reserveOfflineCheckout('cart','op-'+i);await f.adapter.commitFinancialTransaction(commit(f,c) as any);await f.store.acknowledgeCheckout(c.checkoutId);}
  await assert.rejects(client.reserveOfflineCheckout('cart','op-17'),/PERMIT_REQUIRED/);assert.equal(count(f,'pos_fiscal_checkouts_v2'),16);assert.equal(f.requests(),0);
 }finally{f.sql.close();}
 const large=await fixture(1024);try{assert.equal(await large.store.offlineLeasePermitCount!(large.lease.leaseId,true),1024);const reopened=new NativeFiscalWorkflowV2Store(()=>large.bridge,work=>work());assert.equal((await reopened.offlineLease(large.authority))?.saleCapacity,1024);}finally{large.sql.close();}
});
test('changed table source, absent atomic settlement and competing checkout cannot consume fiscal identity',async()=>{
 const f=await fixture();try{const table=await tableSource(f),c=await f.client().reserveOfflineCheckout('cart','operation',table.context),input=commit(f,c,table);
  const absent={...input,documents:input.documents.filter(d=>d.collectionName!=='v3TicketSettlements')};await assert.rejects(f.adapter.commitFinancialTransaction(absent as any),/ATOMIC_SETTLEMENT/);
  f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='parkedTickets'").run(JSON.stringify({...table.account,joinedTableIds:['different']}));
  await assert.rejects(f.adapter.commitFinancialTransaction(input as any),/RETAINED_TICKET_CHANGED/);
  assert.equal(count(f,'sync_outbox_v2'),0);assert.equal(f.sql.prepare("SELECT count(*) n FROM pos_fiscal_permits_v2 WHERE state='CONSUMED'").get()!.n,0);
 }finally{f.sql.close();}
});
test('clock rollback and observed binding change do not regain authority after restart or A→B→A',async()=>{
 const f=await fixture();try{const now=Date.now;const observed=now();Date.now=()=>observed-60000;try{await assert.rejects(f.store.offlineLease(f.authority),/CLOCK_ROLLBACK/);}finally{Date.now=now;}
  assert.equal(await f.store.offlineLease({...f.authority,bindingHash:'c'.repeat(64)}),null);
  const reopened=new NativeFiscalWorkflowV2Store(()=>f.bridge,work=>work());assert.equal(await reopened.offlineLease(f.authority),null);
 }finally{f.sql.close();}
});
test('PREPARED expires before effects; a previously recorded same payment can reconcile after expiry without a new permit',async()=>{
 const f=await fixture();try{const c=await f.client().reserveOfflineCheckout('cart','operation'),now=Date.now;Date.now=()=>Date.parse(f.lease.validUntil)+1;
  try{await assert.rejects(f.store.markPaymentPossible(c.checkoutId,'payment'),/LEASE_REQUIRED/);await assert.rejects(f.adapter.commitFinancialTransaction(commit(f,c) as any),/LEASE_REQUIRED/);}finally{Date.now=now;}
  await f.store.markPaymentPossible(c.checkoutId,'payment');Date.now=()=>Date.parse(f.lease.validUntil)+1;
  try{await f.store.markPaymentPossible(c.checkoutId,'payment');await f.adapter.commitFinancialTransaction(commit(f,c) as any);}finally{Date.now=now;}
  assert.equal(count(f,'sync_outbox_v2'),1);
 }finally{f.sql.close();}
});
test('lease permit dates must be finite, never inferred from malformed server data',async()=>{const f=await fixture();try{assert.throws(()=>validateOfflineFiscalPermit({...f.permits[0],createdAt:'invalid'},f.lease),/INVALID/);}finally{f.sql.close();}});
test('new table totals keep separate legal tip outside VAT/line totals; legacy line algebra remains unchanged',()=>{
 const stamp={binding:'B',warehouseId:'W',tariffId:'T',syncId:'S',syncVersion:2,inventoryVersion:3,inventoryCursor:'C',taxIncluded:false};
 const projected:any={...config,taxes:[{id:'VAT',name:'ITBIS',type:'VAT',rate:.18}],serviceTaxPolicies:{DINE_IN:{taxIds:['VAT'],legalTip:{enabled:true,percentage:10}}}};
 const transaction:any={fiscalWorkflowCheckoutId:uuid(5,1),fiscalOfflineLeaseId:uuid(9,1),fiscalSaleContext:{schemaVersion:1,kind:'TABLE_ACCOUNT',accountId:'account',tableId:'mesa-6',sourceSha256:'d'.repeat(64)},documentType:'TICKET',terminalId:'00000000-0000-4000-8000-000000000001',restaurantOrderId:'account',restaurantTableId:'mesa-6',serviceType:'DINE_IN',serviceChargeAmount:55.5,total:710.4,netAmount:555,taxAmount:99.9,items:[{id:'item',cartId:'line',quantity:1,price:555,taxIds:['VAT'],appliedTaxIds:['VAT'],netAmount:555,taxAmount:99.9,totalAmount:654.9,v3SaleAuthority:stamp}],serviceTaxPolicySnapshot:resolveAppliedServiceTaxPolicy(projected,projected.terminals[0].config,'DINE_IN')};
 validateV3FrozenFiscalAmounts(transaction);validateV3FrozenLineFiscalAmounts(transaction,projected);
 assert.throws(()=>validateV3FrozenLineFiscalAmounts({...transaction,serviceChargeAmount:111},projected),/SOURCE_CHANGED/);
 const inlineConfig={...projected,taxes:[...projected.taxes,{id:'SERVICE',name:'Servicio',type:'SERVICE_CHARGE',rate:.1}],serviceTaxPolicies:{DINE_IN:{taxIds:['VAT','SERVICE'],legalTip:{enabled:false,percentage:0}}}};
 const inline={...transaction,serviceChargeAmount:0,taxAmount:155.4,items:[{...transaction.items[0],taxIds:['VAT','SERVICE'],appliedTaxIds:['VAT','SERVICE'],taxAmount:155.4,totalAmount:710.4}],serviceTaxPolicySnapshot:resolveAppliedServiceTaxPolicy(inlineConfig as any,inlineConfig.terminals[0].config,'DINE_IN')};
 validateV3FrozenFiscalAmounts(inline);validateV3FrozenLineFiscalAmounts(inline,inlineConfig as any);
});
test('actual table prepayment callback reserves locally, pins retained account, avoids autosave operation tags and rejects a source race before effects',async()=>{
 const f=await fixture();try{
  let table=await tableSource(f);const text=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('POSInterface.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:ts.Node|undefined;
  const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='beforeV3PaymentEffects')arrow=node.initializer;ts.forEachChild(node,visit);};visit(ast);assert.ok(arrow);
  const checkoutRef:any={current:null},contextRef:any={current:undefined},fenceRef={current:false};let updates=0,race=false,operation=0;
  const currentContext=async()=>({...table.context,sourceSha256:await tableFiscalSourceDigest(String(f.sql.prepare("SELECT data FROM documents WHERE collection_name='parkedTickets' AND doc_id=?").get(table.account.id)!.data))});
  const ctx:any={completedReservationForReceipt:async()=>null,assertCheckoutFiscalAuthority:async()=>{},hasV3ReservationCart:false,activeV3Reservation:null,selectedCustomer:null,
   db:{getDocument:async(collection:string,id:string)=>{const row=f.sql.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(collection,id);return row?JSON.parse(String(row.data)):null;}},assertFiscalWorkflowCheckoutReplay,readFiscalWorkflowLocalScope,
   v3Operational:{validate:async()=>{if(race)f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='parkedTickets'").run(JSON.stringify({...table.account,guests:9}));}},
   fiscalCompliance:{mode:'ECF'},fiscalWorkflowV2Client:f.client(),getDefaultFiscalProvider:()=> 'MSELLER',config,activeTerminalConfig:config.terminals[0].config,terminalId:scope.terminalId,
   activeRecoveredReservation:null,activeDirectV3TicketId:null,activeTable:{id:'mesa-6',currentOrderId:table.account.id},isMaster:true,activePaymentFraction:null,cartTip:55.5,appliedServiceTaxPolicy:{legalTip:{enabled:true,percentage:10}},
   processedCart:table.account.items,cart:table.account.items,fiscalCheckoutRef:checkoutRef,fiscalCheckoutOperationRef:{current:null},offlineTableFiscalContextRef:contextRef,
   offlineTablePaymentFenceRef:fenceRef,ticketAutoSyncFlushRef:{current:null},ticketAutoSyncTimeoutRef:{current:null},readTableFiscalSaleContext:currentContext,
   currentFiscalCheckoutCartIdentity:()=>JSON.stringify({fiscalSaleContext:contextRef.current,items:table.account.items,customerId:null,fiscalType:'E32'}),
   onUpdateCart:()=>{updates++;},createUuid:()=>uuid(7,++operation),setLargeMasterSyncV3CriticalOperation:()=>{}};
  const js=ts.transpileModule('const invoke='+arrow.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const invoke=new Function(...Object.keys(ctx),js+';return invoke;')(...Object.values(ctx));
  f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='parkedTickets' AND doc_id=?").run(JSON.stringify({...table.account,items:[],total:0}),table.account.id);
  let flushes=0;ctx.ticketAutoSyncFlushRef.current=async()=>{flushes++;f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='parkedTickets' AND doc_id=?").run(table.literal,table.account.id);};
  const fence=await invoke([],['CASH']);assert.equal(flushes,1,'first-item immediate checkout flushes same account before source pin');assert.ok(fence.futureCheckout);assert.equal(fenceRef.current,true);assert.equal(updates,0);assert.equal(f.requests(),0);fence();assert.equal(fenceRef.current,false);
  race=true;await assert.rejects(invoke([],['CASH']),/SOURCE_CHANGED/);assert.equal(fenceRef.current,false);assert.equal(count(f,'sync_outbox_v2'),0);
  race=false;f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='parkedTickets' AND doc_id=?").run(table.literal,table.account.id);
  const cleanup=text.match(/await fiscalWorkflowV2Client\.acknowledge\(fiscalCheckoutRef\.current\);fiscalCheckoutRef\.current=null;fiscalCheckoutOperationRef\.current=null;offlineTableFiscalContextRef\.current=undefined;offlineTablePaymentFenceRef\.current=false;/)?.[0];assert.ok(cleanup);
  const reset=new Function(...Object.keys(ctx),'return (async()=>{'+cleanup+'})()');
  const tableA=table;const payA=await invoke([],['CASH']);await payA.recordPaymentEffect('payment');payA();assert.equal(fenceRef.current,true,'possible cash effect keeps retained source fenced');
  const checkoutA=checkoutRef.current;assert.equal(checkoutA.phase,'EFFECT_POSSIBLE');
  table.account.items[0].quantity=2;await assert.rejects(invoke(['payment'],['CASH']),/RECONCILIATION/);assert.equal(fenceRef.current,true);assert.equal(f.sql.prepare("SELECT data FROM documents WHERE collection_name='parkedTickets' AND doc_id=?").get(table.account.id)!.data,table.literal);table.account.items[0].quantity=1;
  const retry=await invoke(['payment'],['CASH']);assert.equal(retry.futureCheckout.checkoutId,checkoutA.checkoutId);retry();assert.equal(fenceRef.current,true);
  await f.adapter.commitFinancialTransaction(commit(f,checkoutA,table) as any);await reset(...Object.values(ctx));assert.equal(checkoutRef.current,null);assert.equal(contextRef.current,undefined);assert.equal(fenceRef.current,false);
  table=await tableSource(f,'second-account');ctx.activeTable.currentOrderId=table.account.id;
  const payB=await invoke([],['CASH']);assert.notEqual(checkoutRef.current.checkoutId,checkoutA.checkoutId);await f.adapter.commitFinancialTransaction(commit(f,checkoutRef.current,table) as any);await reset(...Object.values(ctx));payB();
  table=tableA;ctx.activeTable.currentOrderId=table.account.id;
  const replay=await invoke([],['CASH']);assert.equal(replay.completedTransaction.id,checkoutA.transactionId);assert.equal(count(f,'sync_outbox_v2'),2);assert.equal(count(f,'pos_fiscal_checkouts_v2'),2);

 }finally{f.sql.close();}
});
test('authenticated lease page rejects malformed scope, dates or over-quota data atomically',async()=>{
 const f=await fixture(1);try{const before=count(f,'pos_fiscal_permits_v2');
  await assert.rejects(f.store.saveOfflineLeasePage!({...f.lease,scope:{...scope,companyId:'foreign'}},[],f.authority,new Date().toISOString()),/INVALID/);
  await assert.rejects(f.store.saveOfflineLeasePage!(f.lease,[{...f.permits[0],permitId:uuid(1,3),transactionId:uuid(2,3)}],f.authority,new Date().toISOString()),/CAPACITY/);
  assert.equal(count(f,'pos_fiscal_permits_v2'),before);assert.equal(count(f,'pos_offline_fiscal_leases_v1'),1);
 }finally{f.sql.close();}
});
test('real client paginates a 1024 reserve in bounded pages once, then checkout uses the native reserve without transport auth',async()=>{
 const f=await fixture(1024,false);try{let calls=0,commandId='',blocked=false;
  const client=createFiscalWorkflowV2Client({store:()=>f.store,readOfflineAuthority:async()=>f.authority,
   readAuth:()=>{if(blocked)throw Error('EXPIRED_SESSION');return {base:'https://erp.example.invalid/api/sync',headers:{},descriptor:scope,assertCurrent(){if(blocked)throw Error('EXPIRED_SESSION');}};},
   fetchImpl:async(url:any,options:any)=>{calls++;let data:any;if(String(url).endsWith('/capability'))data={schemaVersion:1,capability:'OFFLINE_FISCAL_LEASE_V1',version:1,scope,serverTime:new Date().toISOString(),policy:{validitySeconds:604800,saleCapacity:1024,pageSize:16}};
    else{const command=JSON.parse(options.body);assert.equal(command.schemaVersion,1);if(commandId)assert.equal(command.operationId,commandId);else commandId=command.operationId;
     assert.equal(command.leaseId,command.page===0?null:f.lease.leaseId);data={schemaVersion:1,serverTime:new Date().toISOString(),lease:f.lease,page:command.page,nextPage:command.page===63?null:command.page+1,permits:f.permits.slice(command.page*16,(command.page+1)*16)};assert.ok(JSON.stringify(data).length<600000);}
    return {ok:true,json:async()=>data} as Response;
   }} as any);
  await Promise.all([client.prefetchOfflineLease(),client.prefetchOfflineLease()]);assert.equal(calls,65);assert.equal(await f.store.offlineLeasePermitCount!(f.lease.leaseId),1024);
  blocked=true;const before=calls;await client.reserveOfflineCheckout('cart','offline');assert.equal(calls,before);
 }finally{f.sql.close();}
});
test('explicit server revocation is durable while a network failure preserves downloaded authority',async()=>{
 for(const code of ['FISCAL_OFFLINE_LEASE_REVOKED','FISCAL_OFFLINE_BINDING_CHANGED','FISCAL_OFFLINE_AUTHORITY_CHANGED','FISCAL_OFFLINE_MASTER_REQUIRED','NETWORK']){
  const f=await fixture(16);try{
   f.sql.prepare("UPDATE pos_fiscal_permits_v2 SET state='RESERVED' WHERE permit_id IN (SELECT permit_id FROM pos_fiscal_permits_v2 LIMIT 15)").run();
   const client=createFiscalWorkflowV2Client({store:()=>f.store,readOfflineAuthority:async()=>f.authority,readAuth:()=>({base:'https://erp.example.invalid/api/sync',headers:{},descriptor:scope,assertCurrent(){}}),fetchImpl:async()=>{if(code==='NETWORK')throw Error('OFFLINE');return {ok:false,json:async()=>({code})} as Response;}} as any);
   await assert.rejects(client.prefetchOfflineLease());
   const reopened=new NativeFiscalWorkflowV2Store(()=>f.bridge,work=>work());assert.equal(Boolean(await reopened.offlineLease(f.authority)),code==='NETWORK');
  }finally{f.sql.close();}
 }
});
test('positive device-clock skew uses authenticated server offset for SQL permit selection, not local wall-clock expiry',async()=>{
 const f=await fixture(1,false),realNow=Date.now;try{
  const local=realNow();Date.now=()=>local+8*86400000;
  await f.store.saveOfflineLeasePage!(f.lease,f.permits,f.authority,new Date(local).toISOString());
  const checkout=await f.client().reserveOfflineCheckout('cart','skewed');assert.equal(checkout.permit?.permitId,f.permits[0].permitId);
  assert.ok(Date.parse(checkout.offlineSaleDate!)<Date.parse(f.lease.validUntil));
 }finally{Date.now=realNow;f.sql.close();}
});
test('a replacement lease never redirects an already paid checkout to a new permit after expiry',async()=>{
 const f=await fixture(1),realNow=Date.now;try{
  const c=await f.client().reserveOfflineCheckout('cart','operation');await f.store.markPaymentPossible(c.checkoutId,'payment');
  Date.now=()=>Date.parse(f.lease.validUntil)+1000;
  const next={...f.lease,leaseId:uuid(9,2),issuedAt:new Date(Date.now()).toISOString(),validUntil:new Date(Date.now()+604800000).toISOString()};
  const permit={...f.permits[0],leaseId:next.leaseId,permitId:uuid(1,2),transactionId:uuid(2,2),createdAt:next.issuedAt,expiresAt:next.validUntil};
  await f.store.saveOfflineLeasePage!(next,[permit],f.authority,next.issuedAt);
  const recovered=await f.client().reserveOfflineCheckout('cart','operation');assert.equal(recovered.checkoutId,c.checkoutId);assert.equal(recovered.permit?.leaseId,f.lease.leaseId);
 }finally{Date.now=realNow;f.sql.close();}
});
test('cancelled PREPARED without effects can change cart/mesa offline; old permit is burnt and every late writer is fenced',async()=>{
 const f=await fixture(2);try{
  const first=await f.client().reserveOfflineCheckout('cancelled-cart','operation');
  const next=await f.client().reserveOfflineCheckout('other-mesa','operation');assert.notEqual(next.transactionId,first.transactionId);
  assert.equal(count(f,'pos_offline_fiscal_abandoned_v1'),1);assert.equal(f.sql.prepare('SELECT state FROM pos_fiscal_permits_v2 WHERE permit_id=?').get(first.permit!.permitId)!.state,'RESERVED');
  await assert.rejects(f.store.markPaymentPossible(first.checkoutId,'late-payment'),/ABANDONED/);
  await assert.rejects(f.adapter.commitFinancialTransaction(commit(f,first) as any),/ABANDONED/);
  assert.throws(()=>f.sql.prepare("INSERT INTO documents(collection_name,doc_id,data)VALUES('transactions',?,?)").run(first.transactionId,JSON.stringify({id:first.transactionId})),/ABANDONED/);
  const reopened=new NativeFiscalWorkflowV2Store(()=>f.bridge,work=>work());assert.equal((await reopened.currentCheckout(fiscalWorkflowScopeKey(scope)))?.checkoutId,next.checkoutId);
  await f.adapter.commitFinancialTransaction(commit(f,next) as any);assert.equal(count(f,'sync_outbox_v2'),1);
 }finally{f.sql.close();}
});
test('abandon scans skip 1024 unrelated ordinary queue envelopes but retain nested/escaped original decoder candidates',async()=>{
 for(const hidden of [false,true]){const f=await fixture(2);try{
  const c=await f.client().reserveOfflineCheckout('cart','operation');
  const insert=f.sql.prepare("INSERT INTO sync_outbox_v2(event_id,event_type,aggregate_type,aggregate_id,schema_version,payload_json,created_at,updated_at)VALUES(?,'SALE_POSTED','TRANSACTION',?,1,?,?,?)");
  for(let i=0;i<1024;i++)insert.run('unrelated-'+i,'unrelated-'+i,JSON.stringify({transaction:{id:'unrelated-'+i,total:1}}),'now','now');
  if(hidden){const encoded=encodeOriginal({transactionId:c.transactionId}).replace(/0/g,'\\u0030');insert.run('hidden','foreign',JSON.stringify({body:encoded}),'now','now');await assert.rejects(f.store.abandonOfflinePrepared!(c));assert.equal(count(f,'pos_offline_fiscal_abandoned_v1'),0);}
  else{await f.store.abandonOfflinePrepared!(c);assert.equal(count(f,'pos_offline_fiscal_abandoned_v1'),1);}
 }finally{f.sql.close();}}
});
test('abandon refuses a prepared checkout with durable intent, recovery evidence, changed CAS or recorded effect',async()=>{
 for(const kind of ['intent','recovery','cas','effect']){const f=await fixture(2);try{
  const c=await f.client().reserveOfflineCheckout('cart','operation');
  if(kind==='effect')await f.store.markPaymentPossible(c.checkoutId,'payment');
  if(kind==='recovery')f.sql.prepare("INSERT INTO documents(collection_name,doc_id,data)VALUES('recoveryState','unknown',?)").run(JSON.stringify({body:encodeOriginal({transactionId:c.transactionId})}));
  if(kind==='intent')f.sql.prepare("INSERT INTO pos_fiscal_watch_v2(transaction_id,scope_key)VALUES(?,?)").run(c.transactionId,c.scopeKey);
  const expected=kind==='cas'?{...c,operationId:'forged'}:c;
  await assert.rejects(f.store.abandonOfflinePrepared!(expected));assert.equal(count(f,'pos_offline_fiscal_abandoned_v1'),0);assert.ok(await f.store.currentCheckout(c.scopeKey));
 }finally{f.sql.close();}}
});
test('owned lease consumption rejects missing or foreign fiscal source fields without losing durable cash effect',async()=>{
 for(const field of ['fiscalEnvironment','wrongEnvironment','fiscalProvider','missingProvider','fiscalMode','missingMode','fiscalIssuance','issuerRnc','tenantId','companyId','terminalId','sourceTerminal']){
  const f=await fixture(1);try{const table=await tableSource(f),c=await f.client().reserveOfflineCheckout('cart','operation',table.context);await f.client().recordPayment(c,'payment');const input=commit(f,c,table),tx=input.documents[0].document as any;
   f.sql.prepare("INSERT INTO payment_intents_v2(intent_id,idempotency_key,payment_id,provider,transaction_id,amount,currency_code,status,created_at,updated_at)VALUES('intent','intent','payment','CASH',?,710.4,'DOP','AUTHORIZED','now','now')").run(c.transactionId);(input as any).paymentIntentIds=['intent'];
   if(field==='fiscalEnvironment')delete tx.fiscalEnvironment;else if(field==='wrongEnvironment')tx.fiscalEnvironment=1;else if(field==='missingProvider')delete tx.fiscalProvider;else if(field==='missingMode')delete tx.fiscalMode;
   else if(field==='fiscalProvider')tx.fiscalProvider='FOREIGN';else if(field==='fiscalMode')tx.fiscalMode='LEGACY';else if(field==='fiscalIssuance')delete tx.fiscalIssuance;
   else if(field==='sourceTerminal')tx.terminalId='foreign';else tx.fiscalIssuance[field]='foreign';
   await assert.rejects(f.adapter.commitFinancialTransaction(input as any),/SOURCE_AUTHORITY_CHANGED/);
   assert.equal(count(f,'sync_outbox_v2'),0);assert.equal(f.sql.prepare("SELECT count(*) n FROM documents WHERE collection_name IN ('transactions','transactionHistory','v3TicketSettlements')").get()!.n,0);
   const retained=await f.store.readCheckout(c.checkoutId);assert.equal(retained?.phase,'EFFECT_POSSIBLE');assert.deepEqual(retained?.paymentIds,['payment']);assert.equal(f.sql.prepare("SELECT status FROM payment_intents_v2 WHERE intent_id='intent'").get()!.status,'AUTHORIZED');assert.equal(f.sql.prepare("SELECT state FROM pos_fiscal_permits_v2").get()!.state,'RESERVED');assert.equal(f.requests(),0);
  }finally{f.sql.close();}
 }
});
test('durable abandonment is exact idempotent proof; lost commit acknowledgement and restart recover a fresh operation offline',async()=>{
 const f=await fixture(3);try{
  const first=await f.client().reserveOfflineCheckout('original','old-operation');
  await f.store.abandonOfflinePrepared!(first);await f.store.abandonOfflinePrepared!(first);
  await assert.rejects(f.store.abandonOfflinePrepared!({...first,cartIdentity:'conflicting'}),/NOT_SAFE/);
  const second=await f.client().reserveOfflineCheckout('changed','old-operation');assert.notEqual(second.operationId,first.operationId);assert.notEqual(second.checkoutId,first.checkoutId);
  const native=f.store.abandonOfflinePrepared!.bind(f.store);f.store.abandonOfflinePrepared=async expected=>{await native(expected);throw Error('SYNTHETIC_COMMIT_ACK_LOST');};
  const third=await f.client().reserveOfflineCheckout('third','old-operation');assert.notEqual(third.operationId,second.operationId);assert.equal(count(f,'pos_offline_fiscal_abandoned_v1'),2);assert.equal(f.requests(),0);
  await f.adapter.commitFinancialTransaction(commit(f,third) as any);assert.equal(count(f,'sync_outbox_v2'),1);
 }finally{f.sql.close();}
});
