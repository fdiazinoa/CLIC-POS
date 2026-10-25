import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createContext,Script} from 'node:vm';
import ts from 'typescript';
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
import {assertFiscalWorkflowCheckoutReplay,readFiscalWorkflowLocalScope} from '../services/fiscal/FiscalWorkflowCheckoutReplay';
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
test('REPLACE/alias/buffer and authority withdrawal retain immutable pending owner; receipt lookup uses activeNCF index',async()=>{const f=await fixture();try{
 await f.client().reserveOfflineCheckout(identity('a'),'op');
 const replace=f.sql.prepare('INSERT OR REPLACE INTO documents(collection_name,doc_id,data)VALUES(?,?,?)');
 assert.throws(()=>replace.run('localFiscalBuffer',uuid(4),JSON.stringify({id:uuid(4),allocationId:'foreign',currentNumber:2})),/NUMBER_RESERVED/);
 assert.throws(()=>replace.run('fiscalAllocations',f.allocation.id,JSON.stringify({...f.allocation,nextNumber:999})),/NUMBER_RESERVED/);
 replace.run('config','current',JSON.stringify({...f.config,companyInfo:{rnc:'999999999'}}));assert.equal(f.sql.prepare('SELECT revoked FROM pos_offline_fiscal_allocations_v2').get()!.revoked,1);
 f.sql.prepare("DELETE FROM documents WHERE collection_name='fiscalAllocations'").run();
 f.sql.prepare("DELETE FROM documents WHERE collection_name='fiscalRanges'").run();
 f.sql.prepare("DELETE FROM documents WHERE collection_name='config'").run();assert.equal(f.count('pos_fiscal_authority_withdrawals_v2'),3);assert.equal(f.count('pos_fiscal_pending_numbers_v2'),1);
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

test('additive authority expansion preserves original PREPARED and possible-payment identities after restart',async()=>{
 for(const effects of [false,true]){const f=await fixture();try{
 const c=await f.client().reserveOfflineCheckout(identity('expansion'),'op');if(effects)await f.client().recordPayment(c,'payment-'+c.checkoutId);
 const original=JSON.stringify(c),member={...f.grant.allocations[0],allocationId:uuid(30),fiscalRangeId:uuid(31),start:10,end:20,rangeStart:10,rangeEnd:20};
 const {authorityHash:_oldHash,...originalGrant}=f.grant;const unsigned={...originalGrant,authorizationId:uuid(32),allocations:[...f.grant.allocations,member]};const expanded={...unsigned,authorityHash:await allocationHash(unsigned)};
 await f.store.saveAllocation!(expanded,f.local,new Date().toISOString());assert.equal(f.sql.prepare('SELECT revoked FROM pos_offline_fiscal_allocations_v2 WHERE authorization_id=?').get(f.grant.authorizationId)!.revoked,0);
 const restarted=new NativeFiscalWorkflowV2Store(()=>f.bridge,work=>work());assert.equal(JSON.stringify(await restarted.readCheckout(c.checkoutId)),original);
 await restarted.markPaymentPossible(c.checkoutId,'payment-'+c.checkoutId);Object.assign(c,await restarted.readCheckout(c.checkoutId));await f.adapter.commitFinancialTransaction(await input(f,c) as any);assert.equal(f.count('sync_outbox_v2'),1);
 }finally{f.sql.close();}}
});

test('real adapter config replacement, setup CAS and multi-collection refresh preserve fiscal owners',async()=>{
 for(const effects of [false,true]){const f=await fixture();try{
 const c=await f.client().reserveOfflineCheckout(identity('refresh'),'op');if(effects)await f.client().recordPayment(c,'payment-'+c.checkoutId);
 await f.adapter.saveCollection('config',{...f.config,themeColor:'blue'} as any);
 const current:any=await f.adapter.getCollection('config');let casChecks=0;await f.adapter.compareAndSwapV3SetupConfig(current,{...current,taxRate:0,taxes:[],tariffs:[]},()=>{casChecks++;});assert.equal(casChecks,1);
 const projected:any=await f.adapter.getCollection('config');await f.adapter.saveDocumentsAtomically([{collectionName:'config',document:{...projected,themeColor:'green'}},{collectionName:'fiscalAllocations',document:f.allocation},{collectionName:'fiscalRanges',document:f.range},{collectionName:'products',document:{id:'catalog-refresh',name:'updated'}}],false,['config','fiscalAllocations','fiscalRanges','products']);
 assert.equal(f.sql.prepare('SELECT revoked FROM pos_offline_fiscal_allocations_v2').get()!.revoked,0);assert.equal(f.count('pos_fiscal_authority_withdrawals_v2'),0);
 await f.store.markPaymentPossible(c.checkoutId,'payment-'+c.checkoutId);Object.assign(c,await f.store.readCheckout(c.checkoutId));await f.adapter.commitFinancialTransaction(await input(f,c) as any);assert.equal(f.count('sync_outbox_v2'),1);
 }finally{f.sql.close();}}
});

test('authoritative omission and ownership replacement fence new effects and retain possible-payment proof',async()=>{
 for(const collection of ['config','fiscalAllocations','fiscalRanges'])for(const effects of [false,true])for(const snapshot of [false,true]){const f=await fixture();try{
 const c=await f.client().reserveOfflineCheckout(identity('withdrawal'),'op');if(effects)await f.client().recordPayment(c,'original-payment');
 if(snapshot)await f.adapter.saveDocumentsAtomically([{collectionName:'products',document:{id:'refresh'}}],false,[collection,'products']);else await f.adapter.saveCollection(collection,[]);
 assert.equal(f.sql.prepare('SELECT revoked FROM pos_offline_fiscal_allocations_v2').get()!.revoked,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM documents WHERE collection_name=?').get(collection)!.n,0);assert.equal(f.count('pos_fiscal_authority_withdrawals_v2'),1);
 const restarted=new NativeFiscalWorkflowV2Store(()=>f.bridge,work=>work());const original=await restarted.readCheckout(c.checkoutId);assert.equal(original!.phase,effects?'EFFECT_POSSIBLE':'PREPARED');assert.deepEqual(original!.paymentIds,effects?['original-payment']:[]);await assert.rejects(restarted.markPaymentPossible(c.checkoutId,'new-effect'));
 assert.equal(f.count('pos_fiscal_pending_numbers_v2'),1);assert.equal(f.count('sync_outbox_v2'),0);assert.throws(()=>f.sql.prepare('DELETE FROM pos_fiscal_authority_withdrawals_v2').run(),/IMMUTABLE/);
 // A later projection cannot resurrect the retired authority or move its claimed number.
 const doc=collection==='config'?f.config:collection==='fiscalAllocations'?f.allocation:f.range;await f.adapter.saveCollection(collection,collection==='config'?doc as any:[doc]);await assert.rejects(restarted.markPaymentPossible(c.checkoutId,'new-effect'),/REVOKED/);
 if(collection==='fiscalAllocations')await assert.rejects(f.adapter.saveCollection(collection,[{...f.allocation,nextNumber:999}]),/NUMBER_RESERVED/);
 }finally{f.sql.close();}}
 for(const collection of ['config','fiscalAllocations','fiscalRanges']){const f=await fixture();try{
 const c=await f.client().reserveOfflineCheckout(identity('ownership'),'op');const doc=collection==='config'?{...f.config,companyInfo:{rnc:'999999999'}}:collection==='fiscalAllocations'?{...f.allocation,terminalId:'other-terminal',nextNumber:999}:{...f.range,isActive:false};
 await f.adapter.saveDocumentsAtomically([{collectionName:collection,document:doc}],false,[collection]);assert.equal(f.sql.prepare('SELECT revoked FROM pos_offline_fiscal_allocations_v2').get()!.revoked,1);await assert.rejects(f.store.markPaymentPossible(c.checkoutId,'new-effect'));assert.equal(f.count('pos_fiscal_pending_numbers_v2'),1);
 }finally{f.sql.close();}}
});

test('A to A+B expansion then actual A withdrawal and return never revives original grant or reassigns number',async()=>{const f=await fixture();try{
 const c=await f.client().reserveOfflineCheckout(identity('irreversible'),'op');await f.client().recordPayment(c,'original-payment');
 const {authorityHash:_hash,...original}=f.grant;const memberB={...f.grant.allocations[0],allocationId:uuid(60),fiscalRangeId:uuid(61),start:10,end:20,rangeStart:10,rangeEnd:20};
 const expanded={...original,authorizationId:uuid(62),allocations:[...original.allocations,memberB]};await f.store.saveAllocation!({...expanded,authorityHash:await allocationHash(expanded)},f.local,new Date().toISOString());
 const seriesBefore=String(f.sql.prepare("SELECT data FROM documents WHERE collection_name='internalSequences'").get()!.data),bufferBefore=String(f.sql.prepare("SELECT data FROM documents WHERE collection_name='localFiscalBuffer'").get()!.data);
 await f.adapter.saveDocumentsAtomically([],false,['fiscalAllocations']);assert.equal(f.sql.prepare('SELECT count(*) n FROM pos_offline_fiscal_allocations_v2 WHERE revoked=1').get()!.n,2);
 assert.equal(String(f.sql.prepare("SELECT data FROM pos_fiscal_authority_withdrawals_v2 WHERE collection_name='fiscalAllocations'").get()!.data),JSON.stringify(f.allocation));
 await assert.rejects(f.adapter.saveCollection('fiscalAllocations',[{...f.allocation,nextNumber:5}]),/NUMBER_RESERVED/);
 await f.adapter.saveCollection('fiscalAllocations',[f.allocation]);const restored={...expanded,authorizationId:uuid(63)};await f.store.saveAllocation!({...restored,authorityHash:await allocationHash(restored)},f.local,new Date().toISOString());
 await assert.rejects(f.store.saveAllocation!(f.grant,f.local,new Date().toISOString()),/AUTHORITY_CHANGED/);await assert.rejects(f.store.markPaymentPossible(c.checkoutId,'second-payment'),/REVOKED/);await assert.rejects(f.store.allocationCommitPreconditions!(c),/REVOKED/);
 const saved=await f.store.readCheckout(c.checkoutId);assert.deepEqual(saved!.paymentIds,['original-payment']);assert.equal(saved!.transactionId,c.transactionId);assert.equal(saved!.allocation!.ncf,c.allocation!.ncf);
 assert.equal(String(f.sql.prepare("SELECT data FROM documents WHERE collection_name='internalSequences'").get()!.data),seriesBefore);assert.equal(String(f.sql.prepare("SELECT data FROM documents WHERE collection_name='localFiscalBuffer'").get()!.data),bufferBefore);assert.equal(f.count('sync_outbox_v2'),0);assert.equal(f.count('pos_fiscal_pending_numbers_v2'),1);
 }finally{f.sql.close();}});

test('actual COBRAR status caller admits real fully reserved buffer then disables fourth exhausted sale',async()=>{const f=await fixture();try{
 const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8'),start=source.indexOf('      const checkFiscalStatus = async () => {'),end=source.indexOf('      const refresh=',start);assert.ok(start>0&&end>start);
 let state:any,legacyCalls=0;const context=createContext({resolveCommittedFiscalReceipt:async()=>null,setFiscalReceiptRecoveryAvailable:()=>{},cancelled:false,requiredSaleFiscalType:'E32',isOrderTakerMode:false,isFiscalModeDisabled:false,v3Operational:{},fiscalCompliance:{mode:'ECF'},fiscalWorkflowV2Client:f.client(),terminalId:scope.terminalId,activeTerminalConfig:f.config.terminals[0].config,setStatus:()=>{},setFiscalStatus:(next:any)=>{state=next;},console:{error:()=>{}},db:{canRequestMoreNCF:async()=>{legacyCalls++;return false;},get:async()=>[]}});
 new Script(ts.transpileModule(source.slice(start,end)+'\nglobalThis.check=checkFiscalStatus;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText).runInContext(context);
 // This is the real assigned-buffer invariant: allocation pointer past end while owned buffer remains.
 assert.equal(f.allocation.nextNumber,4);assert.equal(f.allocation.reservedEnd,3);
 for(let number=1;number<=3;number++){
  await (context.check as ()=>Promise<void>)();assert.equal(state.hasNCF,true);assert.equal(state.remaining,4-number);assert.equal(state.total,3);
  const c=await f.client().reserveOfflineCheckout(identity('ui-'+number),'operation-'+number);await f.client().recordPayment(c,'payment-'+c.checkoutId);await f.adapter.commitFinancialTransaction(await input(f,c) as any);await f.store.acknowledgeCheckout(c.checkoutId);
 }
 await (context.check as ()=>Promise<void>)();assert.equal(state.hasNCF,false);assert.equal(state.remaining,0);assert.equal(legacyCalls,0);assert.equal(f.count('sync_outbox_v2'),3);await assert.rejects(f.client().reserveOfflineCheckout(identity('fourth'),'operation-fourth'),/EXHAUSTED/);
 }finally{f.sql.close();}});

test('checkout status respects native withdrawal/expiry and paid original kind before new authority',async()=>{
 for(const withdrawal of ['fiscalAllocations','fiscalRanges','config']){const f=await fixture();try{await f.adapter.saveCollection(withdrawal,[]);await assert.rejects(f.client().checkoutFiscalStatus('E32'));}finally{f.sql.close();}}
 const expired=await fixture({expiry:'2020-01-01'});try{await assert.rejects(expired.client().checkoutFiscalStatus('E32'),/EXPIRED/);}finally{expired.sql.close();}
 const f=await fixture();try{const c=await f.client().reserveOfflineCheckout(identity('original'),'op');await f.client().recordPayment(c,'original-payment');assert.deepEqual(await f.client().checkoutFiscalStatus('E32'),{remaining:1,total:1,recovery:true});await assert.rejects(f.client().checkoutFiscalStatus('E31'),/RECONCILIATION/);await f.adapter.saveCollection('fiscalAllocations',[]);await assert.rejects(f.client().checkoutFiscalStatus('E32'),/REVOKED/);assert.deepEqual((await f.store.readCheckout(c.checkoutId))!.paymentIds,['original-payment']);}finally{f.sql.close();}
});

test('UI status paid V1 recovery ignores newer V2 states and rejects invalid original proof',async()=>{const f=await fixture();try{
 for(const mode of ['NONE','REVOKED','EXPIRED','EXPANDED']){
  let probed=false;const current:any={checkoutId:'original',transactionId:'original-tx',phase:'EFFECT_POSSIBLE',paymentIds:['original-payment'],permit:{leaseId:'original-lease'},offlineBindingHash:f.local.bindingHash,offlineEffectAt:'2026-10-21T12:00:00Z',cartIdentity:identity('original')};
  const client=createFiscalWorkflowV2Client({store:()=>({currentCheckout:async()=>current,offlineLease:async()=>({leaseId:'original-lease',issuedAt:'2026-10-20T00:00:00Z',validUntil:'2026-10-22T00:00:00Z'}),allocationAvailability:async()=>{probed=true;if(mode==='REVOKED'||mode==='EXPIRED')throw Error(mode);return mode==='EXPANDED'?{remaining:{E32:10}}:null;}}),readOfflineAuthority:async()=>f.local,readAuth:()=>{throw Error('NO_NETWORK');}} as any);
  assert.deepEqual(await client.checkoutFiscalStatus('E32'),{remaining:1,total:1,recovery:true});assert.equal(probed,false);current.offlineEffectAt='2026-10-23T00:00:00Z';await assert.rejects(client.checkoutFiscalStatus('E32'),/RECONCILIATION/);assert.equal(probed,false);
 }
 }finally{f.sql.close();}});

test('actual prepayment and fresh COBRAR pipeline recover native committed table before new authority/closed guards',async()=>{const f=await fixture();try{
 const account={id:'ack-account',tableId:'mesa-6',items:[{id:'item',cartId:'line',quantity:1,price:555}],total:710.4},other={id:'unrelated',tableId:'mesa-7'};f.put('parkedTickets',account);
 const saleContext={schemaVersion:1 as const,kind:'TABLE_ACCOUNT' as const,accountId:account.id,tableId:account.tableId,sourceSha256:await tableFiscalSourceDigest(JSON.stringify(account))};
 const c=await f.client().reserveOfflineCheckout(JSON.stringify({...JSON.parse(identity('ack')),fiscalSaleContext:saleContext}),'original-operation',saleContext);await f.client().recordPayment(c,'original-cash');const nativeInput=await input(f,c);nativeInput.documents.find(row=>row.collectionName==='transactions')!.document.payments[0].id='original-cash';nativeInput.documents.find(row=>row.collectionName==='transactionHistory')!.document.payments[0].id='original-cash';nativeInput.outboxEvent.payload.transaction.payments[0].id='original-cash';
 f.setFault('COMMIT_ACK_LOST');await assert.rejects(f.adapter.commitFinancialTransaction(nativeInput as any),/COMMIT_UNCERTAIN/);f.setFault('');assert.equal(c.phase,'EFFECT_POSSIBLE');assert.equal((await f.store.readCheckout(c.checkoutId))!.phase,'COMMITTED');f.sql.prepare('UPDATE pos_offline_fiscal_allocations_v2 SET revoked=1').run();
 const literals=()=>JSON.stringify({documents:f.sql.prepare("SELECT collection_name,doc_id,data FROM documents WHERE collection_name IN('transactions','transactionHistory','nativeFiscalReservations','globalSequenceCounter','internalSequences','localFiscalBuffer','v3TicketSettlements') ORDER BY collection_name,doc_id").all(),outbox:f.sql.prepare('SELECT * FROM sync_outbox_v2').all()}),before=literals();let authority=0,closed=0,markers=0;
 const client=createFiscalWorkflowV2Client({store:()=>f.store,readOfflineAuthority:async()=>{authority++;throw Error('NO_NEW_AUTHORITY');},readAuth:()=>{throw Error('NO_TRANSPORT');}} as any);
 const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('POSInterface.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:any;const visit=(node:any)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='beforeV3PaymentEffects')arrow=node.initializer;ts.forEachChild(node,visit);};visit(ast);assert.ok(arrow);
 const invokeFor=(fault:string,empty=false)=>{const ref:any={current:empty?null:structuredClone(c)},contextRef:any={current:empty?undefined:saleContext};const activeTable={id:account.tableId,currentOrderId:account.id};let inputIds=['original-cash'];let cartIdentity=c.cartIdentity;let localScope:any=scope;
 if(fault==='scope')localScope={...scope,deviceId:'other'};if(fault==='cart')cartIdentity=JSON.stringify({...JSON.parse(c.cartIdentity),customerId:'other'});if(fault==='account')activeTable.currentOrderId='other-account';if(fault==='table')activeTable.id='other-table';if(fault==='checkout')ref.current.checkoutId='other-checkout';if(fault==='transaction')ref.current.transactionId='other-tx';if(fault==='operation')ref.current.operationId='other-operation';if(fault==='payment')inputIds=['other-cash'];if(fault==='cachedPayment')ref.current.paymentIds=['other-cash'];if(fault==='authorization')ref.current.allocation.authorizationId='other-authority';if(fault==='context')ref.current.fiscalSaleContext={...saleContext,sourceSha256:'other-digest'};
 const fns:any={completedReservationForReceipt:async()=>null,fiscalCheckoutRef:ref,offlineTableFiscalContextRef:contextRef,activeTable,v3Operational:{},fiscalCompliance:{mode:'ECF'},fiscalWorkflowV2Client:client,readFiscalWorkflowLocalScope:()=>localScope,activeTerminalConfig:f.config.terminals[0].config,terminalId:scope.terminalId,currentFiscalCheckoutCartIdentity:(context:any)=>{assert.deepEqual(context,saleContext);return cartIdentity;},assertFiscalWorkflowCheckoutReplay,tableFiscalSourceDigest,db:{getDocument:async(name:string,id:string)=>fault==='missingReceipt'?null:fault==='retainedSource'&&name==='parkedTickets'?{...account,guests:99}:f.adapter.getDocument(name,id)},assertCheckoutFiscalAuthority:async()=>{authority++;throw Error('NO_NEW_AUTHORITY');},readTableFiscalSaleContext:async()=>{closed++;throw Error('SYNC_V3_RETAINED_TICKET_CHANGED');},setLargeMasterSyncV3CriticalOperation:()=>{markers++;}};
 const helperStart=source.indexOf('   const resolveCommittedFiscalReceipt ='),helperEnd=source.indexOf('   const beforeV3PaymentEffects =',helperStart);const js=ts.transpileModule(source.slice(helperStart,helperEnd)+'const invoke='+arrow.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,invoke=new Function(...Object.keys(fns),js+';return invoke;')(...Object.values(fns));return {invoke:()=>invoke(inputIds,['CASH']),ref,contextRef,fns};};
 for(const fault of ['scope','cart','account','table','checkout','transaction','operation','payment','cachedPayment','missingReceipt','retainedSource','authorization','context']){const state=invokeFor(fault),old=JSON.stringify(state.ref.current);await assert.rejects(state.invoke(),/RECONCILIATION|RECEIPT_REQUIRED/);assert.equal(JSON.stringify(state.ref.current),old);assert.equal(literals(),before);}
 const state=invokeFor('valid');const recovered=await state.invoke();assert.equal(recovered.completedTransaction.id,c.transactionId);assert.equal(state.ref.current.phase,'COMMITTED');assert.equal(state.ref.current.checkoutId,c.checkoutId);assert.equal(literals(),before);
 const cold=invokeFor('valid',true);assert.equal((await cold.invoke()).completedTransaction.id,c.transactionId);assert.equal(cold.ref.current.phase,'COMMITTED');assert.equal(authority,0);assert.equal(closed,0);assert.equal(markers,0);assert.equal(literals(),before);
 // Existing actual completion branch ACKs and performs UI/table projection cleanup, without financial publication.
 let cleaned=0,tableClosed=0;const parkedRef={current:[account,other]};
 const bindings:any={trackingCheckoutRef:{current:null},authorizeFiscalReceiptRecovery:async()=>{},fiscalCheckoutRef:state.ref,fiscalCheckoutOperationRef:{current:c.operationId},offlineTableFiscalContextRef:state.contextRef,offlineTablePaymentFenceRef:{current:true},payments:[{id:'original-cash'}],db:{getDocument:(name:string,id:string)=>f.adapter.getDocument(name,id)},assertFiscalWorkflowCheckoutReplay,currentFiscalCheckoutCartIdentity:()=>c.cartIdentity,readFiscalWorkflowLocalScope:()=>scope,activeTerminalConfig:f.config.terminals[0].config,activeTerminal:f.config.terminals[0],terminalId:scope.terminalId,activeTable:{id:account.tableId,currentOrderId:account.id},parkedTicketsRef:parkedRef,onUpdateParkedTicketsRef:{current:async(rows:any[])=>{assert.deepEqual(rows,[other]);}},onTableOrderClosedRef:{current:async()=>{tableClosed++;}},onClearActiveTable:()=>{cleaned++;},fiscalWorkflowV2Client:client,onUpdateCart:()=>{cleaned++;},onSelectCustomer:()=>{cleaned++;}};
 // Actual fresh COBRAR request -> proceed -> full completion uses the original native receipt.
 const names=['resolveCommittedFiscalReceipt','bindCommittedFiscalReceipt','authorizeFiscalReceiptRecovery','completeCommittedFiscalReceipt','handlePaymentConfirm','assertCheckoutFiscalAuthority','assertNewCheckoutFiscalAuthority','readCheckoutAdmissionIdentity','proceedToCheckout','startCheckoutInteraction','requestCheckout'];const declarations:string[]=[];const collect=(node:any)=>{if(ts.isVariableDeclaration(node)&&names.includes(node.name.getText(ast)))declarations.push('const '+node.getText(ast)+';');ts.forEachChild(node,collect);};collect(ast);
 state.ref.current=null;state.contextRef.current=undefined;let receipt:any=null,modal=false;const errors:string[]=[];
 const entry:any={...state.fns,...bindings,checkoutAdmissionRef:{current:null},checkoutProgressRef:{current:{show:()=>{},lock:()=>{},hide:()=>{}}},yieldInteractionPaint:async()=>{},checkoutAdmissionContextRef:{current:{terminalId:scope.terminalId,mode:'ECF',v3:true,terminal:f.config.terminals[0].config}},cart:JSON.parse(c.cartIdentity).items,processedCart:JSON.parse(c.cartIdentity).items,cartTotal:710.4,activeTerminalId:scope.terminalId,
 recordCheckoutDiagnostic:()=>{},paymentFinalizationInFlightRef:{current:false},getLatestPosInteraction:()=>null,window:{setTimeout,clearTimeout},console:{warn:()=>{},error:()=>{}},alert:(message:string)=>errors.push(message),
 isValidCartQuantity:()=>true,refundAuthorizedBy:null,activePaymentFraction:null,isCurrentPaymentFraction:true,ensureSalesWithOpenZPermission:()=>true,canCheckout:true,amountDueNow:710.4,
 observeDestinationAttempt:(_trace:any,fn:any)=>fn(),setReturnToTableMapAfterPayment:()=>{},expectInteractionDestination:()=>{},paymentModalTraceRef:{current:null},setShowPaymentModal:(value:boolean)=>{modal=value;},markInteractionStateUpdate:()=>{},markInteractionStage:()=>{},setReceiptOnlyInitialTransaction:(value:any)=>{receipt=value;},setErrorToast:(message:string)=>errors.push(message),beginDestinationInteraction:()=>({stages:{}}),checkoutTraceRef:{current:null},canProceedWithOperationalSession:async()=>true,validateTerminalDocument:()=>assert.fail('paid receipt must not seek new authority'),isOrderTakerMode:false,config:f.config};
 delete entry.assertCheckoutFiscalAuthority;delete entry.authorizeFiscalReceiptRecovery;
 const body=ts.transpileModule(declarations.join('\n')+'\nreturn requestCheckout;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,request=new Function(...Object.keys(entry),body)(...Object.values(entry));await request(1,true);
 assert.deepEqual(errors,[]);assert.equal(modal,true);assert.equal(receipt.id,c.transactionId);assert.equal(markers,0);assert.equal(authority,0);assert.equal(closed,0);assert.equal(tableClosed,1);assert.equal(cleaned,3);assert.equal(state.ref.current,null);assert.equal((await f.store.readCheckout(c.checkoutId))!.phase,'ACKNOWLEDGED');assert.equal(literals(),before);
 }finally{f.sql.close();}});

for (const methods of [['CARD'],['CASH','CARD'],['CREDIT'],['QR'],['WALLET'],['ADVANCE'],['OTHER'],['STORE_CREDIT'],['UBER_EATS']]) test(`fiscal native allocation is tender independent: ${methods.join('+')}`,async()=>{
 const f=await fixture();try{
  const c=await f.client().reserveOfflineCheckout(identity('method-test'),'method-operation');
  const ids=methods.map((_method,index)=>`payment-${c.checkoutId}-${index}`);
  for(const id of ids)await f.client().recordPayment(c,id);
  const commit=await input(f,c),source=commit.documents.find((d:any)=>d.collectionName==='transactions')!.document;
  const cents=Math.round(source.total*100),part=Math.floor(cents/methods.length);
  source.payments=methods.map((method,index)=>({id:ids[index],method,methodId:method==='CARD'?'002':method==='CREDIT'?'003':'001',amount:(index===methods.length-1?cents-part*index:part)/100}));
  source.pendingBalance=source.payments.filter((p:any)=>p.method==='CREDIT').reduce((sum:number,p:any)=>sum+p.amount,0)||undefined;
  await f.adapter.commitFinancialTransaction(commit as any);
  const saved=JSON.parse(String(f.sql.prepare("SELECT data FROM documents WHERE collection_name='transactions' AND doc_id=?").get(c.transactionId)!.data));
  assert.deepEqual(saved.payments,source.payments);assert.equal(f.count('sync_outbox_v2'),1);
  assert.equal((await f.store.readCheckout(c.checkoutId))!.phase,'COMMITTED');
 }finally{f.sql.close();}
});
test('fiscal allocation never converts an unapproved integrated card into a manual tender',async()=>{
 const f=await fixture();try{
  const c=await f.client().reserveOfflineCheckout(identity('gateway-test'),'gateway-operation');await f.client().recordPayment(c,'payment-'+c.checkoutId);
  const commit=await input(f,c),source=commit.documents.find((d:any)=>d.collectionName==='transactions')!.document;
  source.payments[0]={...source.payments[0],method:'CARD',gatewayProvider:'AZUL',gatewayStatus:'PENDING'};
  await assert.rejects(f.adapter.commitFinancialTransaction(commit as any),/PAYMENT_INTENT_RECONCILIATION_REQUIRED/);
  assert.equal(f.count('sync_outbox_v2'),0);assert.equal(f.sql.prepare("SELECT count(*) n FROM documents WHERE collection_name='nativeFiscalReservations'").get()!.n,0);
 }finally{f.sql.close();}
});

for(const methods of [['CASH'],['CARD'],['CASH','CARD']])test(`direct legal charge ${methods.join('+')} is bound before effects and commits once without table context`,async()=>{
 const f=await fixture();try{
  let policy:any;
  f.config.terminals[0].config.financial={serviceTaxPolicies:{DINE_IN:{legalTip:{enabled:true,percentage:10}}}};
  policy=(await import('../utils/serviceTaxPolicy')).resolveAppliedServiceTaxPolicy(f.config,f.config.terminals[0].config,'DINE_IN');
  f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='config' AND doc_id='current'").run(JSON.stringify(f.config));
  f.sql.exec('CREATE TABLE master_v3_taxes(sync_version INTEGER,tax_id TEXT,active INTEGER,record_json TEXT)');
  f.sql.prepare('INSERT INTO master_v3_taxes VALUES(1,?,1,?)').run('VAT',JSON.stringify({id:'VAT',name:'VAT',type:'SALES',rate:.18}));
  const items=[{id:'item',cartId:'line',quantity:1,price:555,taxable:true,appliedTaxIds:['VAT'],v3SaleAuthority:{syncVersion:1,taxIncluded:false}}];
  const cart={items,customerId:null,fiscalType:'E32',serviceChargeAmount:55.5,serviceType:'DINE_IN',serviceTaxPolicySnapshot:policy,discountAmount:0,taxExempt:false};
  for(const patch of [{serviceChargeAmount:1},{serviceTaxPolicySnapshot:{...policy,legalTip:{enabled:true,percentage:20}}}])await assert.rejects(f.client().reserveOfflineCheckout(JSON.stringify({...cart,...patch}),'forged'),/DIRECT_TIP_INVALID/);
  assert.equal(f.count('pos_fiscal_pending_numbers_v2'),0);
  const c=await f.client().reserveOfflineCheckout(JSON.stringify(cart),'direct-tip');
  const payments=methods.map((method,index)=>({id:'payment-'+c.checkoutId+'-'+index,method,amount:710.4/methods.length}));
  for(const payment of payments)await f.client().recordPayment(c,payment.id);
  const commit=await input(f,c),source=commit.outboxEvent.payload.transaction;
  Object.assign(source,{items,total:710.4,serviceChargeAmount:55.5,serviceType:'DINE_IN',serviceTaxPolicySnapshot:policy,discountAmount:0,customerSnapshot:{isTaxExempt:false},payments});
  f.setFault('transactionHistory');await assert.rejects(f.adapter.commitFinancialTransaction(commit as any),/SYNTHETIC_DISK_FAILURE/);
  assert.equal(f.count('sync_outbox_v2'),0);assert.equal(f.sql.prepare("SELECT state FROM pos_fiscal_pending_numbers_v2").get()!.state,'EFFECT_POSSIBLE');
  f.setFault('');await f.adapter.commitFinancialTransaction(commit as any);
  assert.equal(f.count('sync_outbox_v2'),1);assert.equal(f.sql.prepare("SELECT state FROM pos_fiscal_pending_numbers_v2").get()!.state,'CONSUMED');
  await assert.rejects(f.adapter.commitFinancialTransaction(commit as any),/DUPLICATE|CONCURRENT_FINANCIAL_UPDATE/);assert.equal(f.count('sync_outbox_v2'),1);
 }finally{f.sql.close();}
});

for(const tender of ['USD_OVER','EUR_MIX','CARD_USD','CREDIT'])test(`native allocation preserves normalized ${tender} settlement without another conversion`,async()=>{
 const f=await fixture();try{
  f.config.currencies=[{code:'DOP',isBase:true}];
  f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='config' AND doc_id='current'").run(JSON.stringify(f.config));
  const payments:any[]=tender==='USD_OVER'?[{id:'usd',method:'CASH',amount:120,currencyCode:'USD',exchangeRate:60,amountOriginal:2}]:tender==='EUR_MIX'?[{id:'eur',method:'CASH',amount:65,currencyCode:'EUR',exchangeRate:65,amountOriginal:1},{id:'dop',method:'CASH',amount:35,currencyCode:'DOP',exchangeRate:1,amountOriginal:35}]:tender==='CARD_USD'?[{id:'card',method:'CARD',amount:100,currencyCode:'USD',exchangeRate:50,amountOriginal:2}]:[{id:'cash',method:'CASH',amount:70},{id:'credit',method:'CREDIT',amount:30}];
  const settlement=(await import('../utils/paymentSettlement')).buildTransactionSettlementFields(payments,100,'DOP');
  const items=[{id:'item',cartId:'line',quantity:1,price:100}];
  const c=await f.client().reserveOfflineCheckout(JSON.stringify({items,customerId:null,fiscalType:'E32'}),'normalized-'+tender);
  for(const payment of settlement.payments)await f.client().recordPayment(c,payment.id);
  const commit=await input(f,c),source=commit.outboxEvent.payload.transaction;
  Object.assign(source,{items,currency:'DOP',netAmount:100,taxAmount:0,total:100,pendingBalance:tender==='CREDIT'?30:0,...settlement});
  const original=JSON.stringify(source);
  await f.adapter.commitFinancialTransaction(commit as any);
  const receipt=JSON.parse(String(f.sql.prepare("SELECT data FROM documents WHERE collection_name='transactions'").get()!.data));
  assert.equal(JSON.stringify(receipt),original);assert.equal(f.count('sync_outbox_v2'),1);
  await assert.rejects(f.adapter.commitFinancialTransaction(commit as any),/DUPLICATE|CONCURRENT_FINANCIAL_UPDATE/);
  assert.equal(f.count('sync_outbox_v2'),1);assert.equal(f.sql.prepare("SELECT state FROM pos_fiscal_pending_numbers_v2").get()!.state,'CONSUMED');
 }finally{f.sql.close();}
});
test('E34 REFUND consumes assigned allocation with original reference and positive refund CAS',async()=>{
 const f=await fixture();try{
  const range={id:uuid(70),type:'E34',prefix:'E34',startNumber:1,endNumber:3,isActive:true,expiryDate:''};
  const allocation={id:uuid(71),terminalId:scope.terminalId,fiscalRangeId:range.id,ncfType:'E34',prefix:'E34',reservedStart:1,reservedEnd:3,nextNumber:1,status:'ACTIVE',releasedAt:null};
  f.put('fiscalRanges',range);f.put('fiscalAllocations',allocation);
  const e34Config={...f.config,terminals:[{...f.config.terminals[0],config:{...f.config.terminals[0].config,fiscal:{...f.config.terminals[0].config.fiscal,fiscalRanges:[range],fiscalAllocations:[allocation]}}}]};
  f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='config' AND doc_id='current'").run(JSON.stringify(e34Config));
  const e34Local=await offlineFiscalAuthorityFromConfig(e34Config,credentials,'device');
  const unsigned:any={contractVersion:2,authorizationKind:'OFFLINE_FISCAL_ALLOCATION_V2',authorizationId:uuid(72),scope,issuerRnc:'101010101',provider:'MSELLER',environment:0,issuedAt:new Date(Date.now()-1000).toISOString(),bindingFingerprint:'c'.repeat(64),allocations:[{allocationId:allocation.id,fiscalRangeId:range.id,ncfType:'E34',prefix:'E34',padding:10,start:1,end:3,rangeStart:1,rangeEnd:3,expiryDate:null}]};
  await f.store.saveAllocation!({...unsigned,authorityHash:await allocationHash(unsigned)},e34Local,new Date().toISOString());
  const items=[{id:'item',cartId:'line',quantity:1,price:555}];
  const c=await f.client().reserveOfflineCheckout(JSON.stringify({items,customerId:null,fiscalType:'E34',originalTransactionId:'orig-tx'}),'refund-op');
  assert.equal(c.allocation!.ncfType,'E34');
  await f.client().recordPayment(c,'payment-'+c.checkoutId);
  const series=JSON.parse(String(f.sql.prepare("SELECT data FROM documents WHERE collection_name='internalSequences'").get()!.data)),counterRow=f.sql.prepare("SELECT data FROM documents WHERE collection_name='globalSequenceCounter'").get(),counter=counterRow?JSON.parse(String(counterRow.data)):undefined,numbers=planFinancialNumbers({seriesId:'SERIES',documentType:'TICKET',global:true},series,counter);
  const tx:any={seriesId:'SERIES',displayId:numbers.result.displayId,globalSequence:numbers.result.globalSequence,seriesNumber:numbers.result.seriesNumber,id:c.transactionId,fiscalWorkflowCheckoutId:c.checkoutId,fiscalAllocationAuthorizationId:c.allocation!.authorizationId,date:c.offlineSaleDate,terminalId:scope.terminalId,ncf:c.allocation!.ncf,ncfType:'E34',fiscalIssuance:c.allocationIssuance,fiscalEnvironment:0,fiscalProvider:'MSELLER',fiscalMode:'ECF',documentType:'REFUND',originalTransactionId:'orig-tx',total:654.9,netAmount:555,taxAmount:99.9,serviceChargeAmount:0,items,payments:[{id:'payment-'+c.checkoutId,method:'CASH',amount:654.9}]};
  const birth:any={schemaVersion:3,authorizationKind:'OFFLINE_FISCAL_ALLOCATION_V2',authorizationId:c.allocation!.authorizationId,authorityHash:c.allocation!.authorityHash,transactionId:c.transactionId,checkoutId:c.checkoutId};
  const commit={documents:[{collectionName:'internalSequences',document:numbers.series,expectedDocument:JSON.stringify(series)},{collectionName:'globalSequenceCounter',document:numbers.counter,...(counter?{expectedDocument:JSON.stringify(counter)}:{requireAbsent:true})},{collectionName:'transactions',document:tx,requireAbsent:true},{collectionName:'transactionHistory',document:tx,requireAbsent:true}],outboxEvent:{eventId:uuid(73),eventType:'SALES_CREDIT_NOTE_POSTED',aggregateType:'TRANSACTION',aggregateId:tx.id,schemaVersion:1,createdAt:tx.date,payload:{transaction:tx,fiscalWorkflowBirth:birth}},fiscalWorkflowCommits:[{checkoutId:c.checkoutId,transactionId:tx.id,birth}],fiscalAllocationPreconditions:await f.store.allocationCommitPreconditions!(c)};
  await f.adapter.commitFinancialTransaction(commit as any);
  assert.equal(f.sql.prepare('SELECT state FROM pos_fiscal_pending_numbers_v2').get()!.state,'CONSUMED');
  assert.equal(f.count('sync_outbox_v2'),1);
  const pending=f.sql.prepare("SELECT data FROM documents WHERE collection_name='transactions'").get()!.data;
  assert.equal(JSON.parse(String(pending)).documentType,'REFUND');
 }finally{f.sql.close();}
});
