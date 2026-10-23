import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CapacitorSQLiteAdapter} from '../services/db/adapters/CapacitorSQLiteAdapter';
import {FISCAL_WORKFLOW_V2_SCHEMA,NativeFiscalWorkflowV2Store} from '../services/db/FiscalWorkflowV2Store';
import {OFFLINE_FISCAL_ALLOCATION_WRITER_SCHEMA} from '../services/db/OfflineFiscalAllocationStore';
import {NATIVE_FISCAL_RECEIPTS_SCHEMA} from '../services/db/NativeFiscalReservation';
import {DURABLE_OUTBOX_SCHEMA_SQL} from '../services/sync/DurableOutboxSchema';
import {offlineFiscalAuthorityFromConfig} from '../services/fiscal/OfflineFiscalLeaseContext';
import {allocationHash,validateOfflineFiscalAllocation,type OfflineFiscalAllocation} from '../services/fiscal/OfflineFiscalAllocation';
import {planFinancialNumbers} from '../services/db/FinancialNumberReservation';
import {tableFiscalSourceDigest} from '../services/fiscal/OfflineFiscalLease';
import {createFiscalWorkflowV2Client} from '../services/fiscal/FiscalWorkflowV2Client';
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={tenantId:'tenant',companyId:'company',storeId:'store',terminalId:uuid(1),deviceId:'device'};
const credentials={...scope,erpTenantId:scope.tenantId,erpTerminalId:scope.terminalId,deviceToken:'synthetic-device',syncToken:'expired',syncTokenExpiresAt:'2020-01-01',authStatus:'BOUND'};
async function fixture({buffer=true,expiry=null as string|null,download=true}={}){
 const entries=new Map([['clic_terminal_credentials_v1',JSON.stringify(credentials)],['CLIC_POS_DEVICE_ID','device']]);
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:(k:string)=>entries.get(k)||null,setItem:(k:string,v:string)=>entries.set(k,v),removeItem:(k:string)=>entries.delete(k)},configurable:true});
 const sql=new DatabaseSync(':memory:');sql.exec(FISCAL_WORKFLOW_V2_SCHEMA+DURABLE_OUTBOX_SCHEMA_SQL+`CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));CREATE TABLE sync_queue(id TEXT PRIMARY KEY,payload TEXT);`+NATIVE_FISCAL_RECEIPTS_SCHEMA+OFFLINE_FISCAL_ALLOCATION_WRITER_SCHEMA);
 const range={id:uuid(2),type:'E32',prefix:'E32',startNumber:1,endNumber:3,isActive:true,expiryDate:expiry||''};
 const allocation={id:uuid(3),terminalId:scope.terminalId,fiscalRangeId:range.id,ncfType:'E32',prefix:'E32',reservedStart:1,reservedEnd:3,nextNumber:buffer?4:1,status:'ACTIVE',releasedAt:null};
 const config:any={id:'current',companyInfo:{rnc:'101010101'},terminals:[{id:scope.terminalId,config:{erpBinding:scope,erpTerminalId:scope.terminalId,currentDeviceId:'device',isPrimaryNode:true,governedByMaster:false,syncConfig:{mode:'MASTER'},fiscal:{providerId:'MSELLER',mode:'ECF',enabled:true,environment:0,credentialKey:'101010101',fiscalRanges:[range],fiscalAllocations:[allocation]}}}]};
 const put=(collection:string,doc:any)=>sql.prepare('INSERT INTO documents(collection_name,doc_id,data)VALUES(?,?,?)').run(collection,doc.id,JSON.stringify(doc));
 put('config',config);put('fiscalRanges',range);put('fiscalAllocations',allocation);put('internalSequences',{id:'SERIES',documentType:'TICKET',prefix:'T-',padding:6,nextNumber:1,active:true});
 if(buffer)put('localFiscalBuffer',{id:uuid(4),type:'E32',prefix:'E32',currentNumber:1,startNumber:1,endNumber:3,expiryDate:expiry||'',terminalId:scope.terminalId,fiscalRangeId:range.id,allocationId:allocation.id});
 let fault='';const bridge={query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>{if(fault&&(q.includes(fault)||v.includes(fault)))throw Error('SYNTHETIC_DISK_FAILURE');return {changes:sql.prepare(q).run(...v)};},execute:async(q:string)=>sql.exec(q),beginTransaction:async()=>sql.exec('BEGIN IMMEDIATE'),commitTransaction:async()=>{sql.exec('COMMIT');if(fault==='COMMIT_ACK_LOST')throw Error('LOST_COMMIT_ACK');},rollbackTransaction:async()=>sql.exec('ROLLBACK'),isTransactionActive:async()=>({result:sql.isTransaction})};
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});const store=adapter.fiscalWorkflowStore;
 const local=await offlineFiscalAuthorityFromConfig(config,credentials,'device'),now=Date.now();
 const unsigned:any={contractVersion:2,authorizationKind:'OFFLINE_FISCAL_ALLOCATION_V2',authorizationId:uuid(5),scope,issuerRnc:'101010101',provider:'MSELLER',environment:0,issuedAt:new Date(now-1000).toISOString(),bindingFingerprint:'a'.repeat(64),allocations:[{allocationId:allocation.id,fiscalRangeId:range.id,ncfType:'E32',prefix:'E32',padding:10,start:1,end:3,rangeStart:1,rangeEnd:3,expiryDate:expiry}]};
 const grant:OfflineFiscalAllocation={...unsigned,authorityHash:await allocationHash(unsigned)};if(download)await store.saveAllocation!(grant,local,new Date(now).toISOString());
 const client=()=>createFiscalWorkflowV2Client({store:()=>store,readOfflineAuthority:()=>offlineFiscalAuthorityFromConfig(config,credentials,'device'),readAuth:()=>{throw Error('EXPIRED_TRANSPORT');},fetchImpl:async()=>{throw Error('NO_NETWORK_ALLOWED');}} as any);
 const count=(table:string)=>Number(sql.prepare('SELECT count(*) n FROM '+table).get()!.n);
 return {sql,bridge,adapter,store,local,grant,client,count,setFault:(value:string)=>{fault=value;},put,range,allocation,config};
}
const identity=(account:string)=>JSON.stringify({items:[{id:'item',cartId:'line',quantity:1,price:555}],customerId:null,fiscalType:'E32',account});
async function input(f:Awaited<ReturnType<typeof fixture>>,c:any){
 const series=JSON.parse(String(f.sql.prepare("SELECT data FROM documents WHERE collection_name='internalSequences'").get()!.data)),counterRow=f.sql.prepare("SELECT data FROM documents WHERE collection_name='globalSequenceCounter'").get(),counter=counterRow?JSON.parse(String(counterRow.data)):undefined,numbers=planFinancialNumbers({seriesId:'SERIES',documentType:'TICKET',global:true},series,counter);
 const tx:any={seriesId:'SERIES',displayId:numbers.result.displayId,globalSequence:numbers.result.globalSequence,seriesNumber:numbers.result.seriesNumber,...(c.fiscalSaleContext?{serviceTaxPolicySnapshot:{serviceType:'DINE_IN',source:'TERMINAL',legalTip:{enabled:true,percentage:10}},fiscalSaleContext:c.fiscalSaleContext,restaurantOrderId:c.fiscalSaleContext.accountId,restaurantTableId:c.fiscalSaleContext.tableId}:{}),id:c.transactionId,fiscalWorkflowCheckoutId:c.checkoutId,fiscalAllocationAuthorizationId:c.allocation.authorizationId,date:c.offlineSaleDate,terminalId:scope.terminalId,ncf:c.allocation.ncf,ncfType:'E32',fiscalIssuance:c.allocationIssuance,fiscalEnvironment:0,fiscalProvider:'MSELLER',fiscalMode:'ECF',documentType:'TICKET',total:c.fiscalSaleContext?710.4:654.9,netAmount:555,taxAmount:99.9,serviceChargeAmount:c.fiscalSaleContext?55.5:0,items:[{id:'item',cartId:'line',quantity:1,price:555}],payments:[{id:'payment-'+c.checkoutId,method:'CASH',amount:c.fiscalSaleContext?710.4:654.9}]};
 const birth:any={schemaVersion:3,authorizationKind:'OFFLINE_FISCAL_ALLOCATION_V2',authorizationId:c.allocation.authorizationId,authorityHash:c.allocation.authorityHash,transactionId:c.transactionId,checkoutId:c.checkoutId};
 return {documents:[{collectionName:'internalSequences',document:numbers.series,expectedDocument:JSON.stringify(series)},{collectionName:'globalSequenceCounter',document:numbers.counter,...(counter?{expectedDocument:JSON.stringify(counter)}:{requireAbsent:true})},{collectionName:'transactions',document:tx,requireAbsent:true},{collectionName:'transactionHistory',document:tx,requireAbsent:true},...(c.fiscalSaleContext?[{collectionName:'v3TicketSettlements',document:{id:c.fiscalSaleContext.accountId,transactionId:tx.id},requireAbsent:true,v3ExpectedRetainedDocument:{collection:'parkedTickets',id:c.fiscalSaleContext.accountId,expected:String(f.sql.prepare("SELECT data FROM documents WHERE collection_name='parkedTickets' AND doc_id=?").get(c.fiscalSaleContext.accountId)!.data)}}]:[])],outboxEvent:{eventId:uuid(10+Number(c.allocation.sequence)),eventType:'SALE_POSTED',aggregateType:'TRANSACTION',aggregateId:tx.id,schemaVersion:1,createdAt:tx.date,payload:{transaction:tx,fiscalWorkflowBirth:birth}},fiscalWorkflowCommits:[{checkoutId:c.checkoutId,transactionId:tx.id,birth}],fiscalAllocationPreconditions:await f.store.allocationCommitPreconditions!(c)};
}
for(const buffer of [true,false])test(`day1/day8/day30 with expired bearer uses exactly3 assignedNCF, fourth stops before payment; initialbuffer=${buffer}`,async()=>{
 const f=await fixture({buffer}),realNow=Date.now,base=realNow();try{
  for(const [index,day] of [1,8,30].entries()){Date.now=()=>base+day*86400000;const c=await f.client().reserveOfflineCheckout(identity('a'+index),'operation-'+index);assert.equal(c.permit,null);assert.equal(c.allocation!.sequence,index+1);
   assert.equal(f.count('pos_fiscal_permits_v2'),0);assert.equal(f.sql.prepare("SELECT count(*) n FROM documents WHERE collection_name='nativeFiscalReservations'").get()!.n,index);
   await f.client().recordPayment(c,'payment-'+c.checkoutId);await f.adapter.commitFinancialTransaction(await input(f,c) as any);await f.store.acknowledgeCheckout(c.checkoutId);
  }
  await assert.rejects(f.client().reserveOfflineCheckout(identity('fourth'),'op-fourth'),/RANGE_EXHAUSTED/);assert.equal(f.count('sync_outbox_v2'),3);assert.equal(f.sql.prepare("SELECT count(*) n FROM documents WHERE collection_name='nativeFiscalReservations'").get()!.n,3);
 }finally{Date.now=realNow;f.sql.close();}
});
test('PREPARED is only a durable pendingclaim; every native receipt/buffer writer is fenced, restart retains owner',async()=>{const f=await fixture();try{
 const c=await f.client().reserveOfflineCheckout(identity('a'),'op');assert.equal(f.count('sync_outbox_v2'),0);assert.equal(f.sql.prepare("SELECT count(*) n FROM documents WHERE collection_name='nativeFiscalReservations'").get()!.n,0);
 assert.throws(()=>f.sql.prepare("UPDATE documents SET data=json_set(data,'$.currentNumber',2) WHERE collection_name='localFiscalBuffer'").run(),/NUMBER_RESERVED/);
 assert.throws(()=>f.sql.prepare("DELETE FROM documents WHERE collection_name='localFiscalBuffer'").run(),/NUMBER_RESERVED/);
 f.sql.prepare('INSERT INTO article_format_wire_write_scope VALUES(1)').run();assert.throws(()=>f.put('nativeFiscalReservations',{id:'competing',issuerRnc:'101010101',ncf:c.allocation!.ncf}),/NUMBER_RESERVED/);assert.throws(()=>f.put('nativeFiscalReservations',{id:'alias',issuerRnc:'101010101',ncf:' e321 '}),/NUMBER_RESERVED/);f.sql.prepare('DELETE FROM article_format_wire_write_scope').run();
 const reopened=new NativeFiscalWorkflowV2Store(()=>f.bridge,work=>work());assert.equal((await reopened.readCheckout(c.checkoutId))!.transactionId,c.transactionId);
 const next=await f.client().reserveOfflineCheckout(identity('edited'),'edit-operation');assert.equal(next.allocation!.ncf,c.allocation!.ncf);assert.notEqual(next.transactionId,c.transactionId);assert.equal(f.sql.prepare("SELECT state FROM pos_fiscal_pending_numbers_v2 WHERE checkout_id=?").get(c.checkoutId)!.state,'ABANDONED');
 }finally{f.sql.close();}});
for(const fault of ['nativeFiscalReservations',"UPDATE documents SET data=",'INSERT INTO sync_outbox_v2'])test(`atomic rollback after ${fault} preserves pendingidentity and all unissued numbers`,async()=>{const f=await fixture();try{
 const c=await f.client().reserveOfflineCheckout(identity('a'),'op');await f.client().recordPayment(c,'payment-'+c.checkoutId);const commit=await input(f,c);f.setFault(fault);await assert.rejects(f.adapter.commitFinancialTransaction(commit as any),/SYNTHETIC/);f.setFault('');
 assert.equal(f.count('sync_outbox_v2'),0);assert.equal(f.sql.prepare("SELECT count(*) n FROM documents WHERE collection_name='nativeFiscalReservations'").get()!.n,0);assert.equal(f.sql.prepare('SELECT state FROM pos_fiscal_pending_numbers_v2').get()!.state,'EFFECT_POSSIBLE');
 await f.adapter.commitFinancialTransaction(commit as any);assert.equal(f.count('sync_outbox_v2'),1);assert.equal((await f.store.readCheckout(c.checkoutId))!.phase,'COMMITTED');
 }finally{f.sql.close();}});
test('authority digest, identity, real expiry and clock rollback reject before any new payment',async()=>{const f=await fixture();try{
 await assert.rejects(validateOfflineFiscalAllocation({...f.grant,issuerRnc:'999999999'},f.local),/ALLOCATION_INVALID/);
 const realNow=Date.now;Date.now=()=>realNow()-10000;try{await assert.rejects(f.client().reserveOfflineCheckout(identity('a'),'op'),/CLOCK_ROLLBACK/);}finally{Date.now=realNow;}
 assert.equal(f.count('pos_fiscal_pending_numbers_v2'),0);
 }finally{f.sql.close();}});

test('COMMIT acknowledgement loss recovers original receipt and exact numbering after authority withdrawal without another cash effect',async()=>{const f=await fixture();try{
 const c=await f.client().reserveOfflineCheckout(identity('a'),'op');await f.client().recordPayment(c,'payment-'+c.checkoutId);const commit=await input(f,c);f.setFault('COMMIT_ACK_LOST');await assert.rejects(f.adapter.commitFinancialTransaction(commit as any),/NATIVE_FINANCIAL_COMMIT_UNCERTAIN/);f.setFault('');
 f.sql.prepare('UPDATE pos_offline_fiscal_allocations_v2 SET revoked=1').run();const reopened=new NativeFiscalWorkflowV2Store(()=>f.bridge,work=>work()),completed=await reopened.readCheckout(c.checkoutId);assert.equal(completed!.phase,'COMMITTED');assert.equal(completed!.allocation!.ncf,c.allocation!.ncf);assert.equal(f.count('sync_outbox_v2'),1);assert.equal(f.sql.prepare("SELECT count(*) n FROM documents WHERE collection_name='nativeFiscalReservations'").get()!.n,1);
 }finally{f.sql.close();}});
test('real fiscal expiry uses Dominican day; PREPARED cannot take first payment after expiry, prior paid intent can recover',async()=>{
 const day='2026-10-23',at=Date.parse('2026-10-24T03:59:00Z'),realNow=Date.now;Date.now=()=>at;const f=await fixture({expiry:day});try{
 const c=await f.client().reserveOfflineCheckout(identity('a'),'op');Date.now=()=>at+120000;await assert.rejects(f.client().recordPayment(c,'payment-'+c.checkoutId),/RANGE_EXPIRED/);
 Date.now=()=>at+1000;await f.client().recordPayment(c,'payment-'+c.checkoutId);Date.now=()=>at+120000;const resumed=await f.client().reserveOfflineCheckout(identity('a'),'op');assert.equal(resumed.transactionId,c.transactionId);await f.adapter.commitFinancialTransaction(await input(f,resumed) as any);assert.equal(f.count('sync_outbox_v2'),1);
 }finally{Date.now=realNow;f.sql.close();}
});

test('full retained mesa CASH+10% native transaction settles once, counters and birth remain together',async()=>{const f=await fixture();try{
 const account={id:'account',tableId:'mesa-6',items:[{id:'item',cartId:'line',quantity:1,price:555}],total:710.4};f.put('parkedTickets',account);
 const context={schemaVersion:1 as const,kind:'TABLE_ACCOUNT' as const,accountId:account.id,tableId:account.tableId,sourceSha256:await tableFiscalSourceDigest(JSON.stringify(account))};
 const c=await f.client().reserveOfflineCheckout(JSON.stringify({...JSON.parse(identity('account')),fiscalSaleContext:context}),'op',context);await f.client().recordPayment(c,'payment-'+c.checkoutId);const commit=await input(f,c);await f.adapter.commitFinancialTransaction(commit as any);
 const source=JSON.parse(String(f.sql.prepare("SELECT data FROM documents WHERE collection_name='transactionHistory'").get()!.data));assert.deepEqual([source.netAmount,source.taxAmount,source.serviceChargeAmount,source.total],[555,99.9,55.5,710.4]);assert.equal(f.sql.prepare("SELECT count(*) n FROM documents WHERE collection_name='v3TicketSettlements'").get()!.n,1);await assert.rejects(f.adapter.commitFinancialTransaction(commit as any),/DUPLICATE|CONCURRENT_FINANCIAL_UPDATE/);assert.equal(f.count('sync_outbox_v2'),1);
 }finally{f.sql.close();}});
test('REPLACE/alias/buffer and authority deletion cannot erase pending owner; receipt lookup uses activeNCF index',async()=>{const f=await fixture();try{
 await f.client().reserveOfflineCheckout(identity('a'),'op');
 const replace=f.sql.prepare('INSERT OR REPLACE INTO documents(collection_name,doc_id,data)VALUES(?,?,?)');
 assert.throws(()=>replace.run('localFiscalBuffer',uuid(4),JSON.stringify({id:uuid(4),allocationId:'foreign',currentNumber:2})),/NUMBER_RESERVED/);
 assert.throws(()=>replace.run('fiscalAllocations',f.allocation.id,JSON.stringify({...f.allocation,nextNumber:999})),/NUMBER_RESERVED/);
 replace.run('config','current',JSON.stringify({...f.config,companyInfo:{rnc:'999999999'}}));assert.equal(f.sql.prepare('SELECT revoked FROM pos_offline_fiscal_allocations_v2').get()!.revoked,1);
 assert.throws(()=>f.sql.prepare("DELETE FROM documents WHERE collection_name='fiscalAllocations'").run(),/NUMBER_RESERVED/);
 assert.throws(()=>f.sql.prepare("DELETE FROM documents WHERE collection_name='fiscalRanges'").run(),/NUMBER_RESERVED/);
 assert.throws(()=>f.sql.prepare("DELETE FROM documents WHERE collection_name='config'").run(),/NUMBER_RESERVED/);
 const plan=f.sql.prepare("EXPLAIN QUERY PLAN SELECT 1 FROM pos_fiscal_pending_numbers_v2 p JOIN pos_offline_fiscal_allocations_v2 a ON a.authorization_id=p.authorization_id WHERE p.state IN('PREPARED','EFFECT_POSSIBLE') AND p.ncf=? AND json_extract(a.authority_json,'$.issuerRnc')=?").all('E320000000001','101010101');assert.match(JSON.stringify(plan),/pos_fiscal_pending_active_ncf_v2/);
 }finally{f.sql.close();}});

test('compact preparation saves one immutable authority, completes issuance operation, and never requests V1 pages',async()=>{const f=await fixture({download:false});try{
 const paths:string[]=[],operations:string[]=[];const client=createFiscalWorkflowV2Client({store:()=>f.store,readOfflineAuthority:async()=>f.local,readAuth:()=>({base:'https://synthetic.invalid/api/sync',headers:{},descriptor:scope,assertCurrent:()=>{}}),fetchImpl:async(url:any,init:any)=>{paths.push(String(url));operations.push(JSON.parse(init.body).operationId);return {ok:true,json:async()=>({schemaVersion:2,capability:'OFFLINE_FISCAL_ALLOCATION_V2',authorization:f.grant,serverTime:new Date().toISOString()})};}} as any);
 await client.prepareOfflineAuthority();await client.prepareOfflineAuthority();assert.equal(paths.length,2);assert.ok(paths.every(path=>path.endsWith('/offline-allocation/authority')));assert.notEqual(operations[0],operations[1]);assert.equal(f.count('pos_fiscal_permits_v2'),0);assert.equal(f.count('pos_offline_fiscal_allocations_v2'),1);assert.equal((await client.offlineReadiness()).reason,'READY_ALLOCATION');
 }finally{f.sql.close();}});
test('old ERP or V2 OFF keeps the real V1 fallback and reports disabled preparation instead of inventing an expiry',async()=>{const f=await fixture({download:false});try{
 const paths:string[]=[];const client=createFiscalWorkflowV2Client({store:()=>f.store,readOfflineAuthority:async()=>f.local,readAuth:()=>({base:'https://synthetic.invalid/api/sync',headers:{},descriptor:scope,assertCurrent:()=>{}}),fetchImpl:async(url:any)=>{paths.push(String(url));return {ok:false,json:async()=>({code:String(url).includes('offline-allocation')?'FISCAL_ALLOCATION_DISABLED':'FISCAL_OFFLINE_DISABLED'})};}} as any);
 await assert.rejects(client.prepareOfflineAuthority(),/FISCAL_OFFLINE_DISABLED/);assert.equal(paths.length,2);assert.equal((await client.offlineReadiness()).reason,'PREPARATION_DISABLED');assert.equal((await client.offlineReadiness()).code,'FISCAL_OFFLINE_DISABLED');assert.equal(f.count('pos_fiscal_permits_v2'),0);assert.equal(f.count('pos_offline_fiscal_allocations_v2'),0);
 }finally{f.sql.close();}});
