import {DISPATCH_POOL_INSTALL_SCHEMA,DISPATCH_STORE_POLICY_SCHEMA_V2} from '../services/db/CompanyDispatchPool';
import {COMPANY_DISPATCH_ESCROW_SCHEMA} from '../services/db/CompanyDispatchEscrowStore';
import {LARGE_MASTER_SYNC_V3_SCHEMA_SQL} from '../services/db/LargeMasterSyncV3Schema';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {NativeFiscalWorkflowV2Store,FISCAL_WORKFLOW_V2_SCHEMA} from '../services/db/FiscalWorkflowV2Store';
import {OFFLINE_FISCAL_ALLOCATION_WRITER_SCHEMA} from '../services/db/OfflineFiscalAllocationStore';
import {CapacitorSQLiteAdapter} from '../services/db/adapters/CapacitorSQLiteAdapter';
import {DURABLE_OUTBOX_SCHEMA_SQL} from '../services/sync/DurableOutboxSchema';
import {NATIVE_FISCAL_RECEIPTS_SCHEMA} from '../services/db/NativeFiscalReservation';
import {offlineFiscalAuthorityFromConfig,offlineFiscalSessionState,OFFLINE_FISCAL_SESSION_UNAVAILABLE} from '../services/fiscal/OfflineFiscalLeaseContext';
import {createFiscalWorkflowV2Client} from '../services/fiscal/FiscalWorkflowV2Client';
import type {OfflineFiscalLease} from '../services/fiscal/OfflineFiscalLease';
import {allocationHash,type OfflineFiscalAllocation} from '../services/fiscal/OfflineFiscalAllocation';
import {isDegradableOfflineFiscalFailure,offlineFiscalFailureDecision,offlineFiscalFailureReason} from '../services/fiscal/OfflineFiscalFailurePolicy';

const scope={tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'00000000-0000-4000-8000-000000000001',deviceId:'device'};
const uuid=(prefix:number,index:number)=>`${String(prefix).padStart(8,'0')}-0000-4000-8000-${String(index).padStart(12,'0')}`;
const config:any={companyInfo:{rnc:'101010101'},terminals:[{id:scope.terminalId,config:{isPrimaryNode:true,governedByMaster:false,syncConfig:{mode:'MASTER'},erpTerminalId:scope.terminalId,currentDeviceId:'device',erpBinding:{tenantId:'tenant',companyId:'company',storeId:'store'},fiscal:{providerId:'MSELLER',mode:'ECF',enabled:true,environment:0,credentialKey:'101010101'}}}]};
const credentials={...scope,erpTenantId:'tenant',erpTerminalId:scope.terminalId,deviceToken:'synthetic-device',authStatus:'BOUND',lastAuthError:''};
const source=(relative:string)=>readFileSync(new URL(`../${relative}`,import.meta.url),'utf8');
const schema=()=>FISCAL_WORKFLOW_V2_SCHEMA+DURABLE_OUTBOX_SCHEMA_SQL+COMPANY_DISPATCH_ESCROW_SCHEMA+DISPATCH_POOL_INSTALL_SCHEMA+DISPATCH_STORE_POLICY_SCHEMA_V2+LARGE_MASTER_SYNC_V3_SCHEMA_SQL.match(/CREATE TABLE IF NOT EXISTS master_v3_operational_owner \([\s\S]*?\n\);/)![0]+`CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));CREATE TABLE sync_queue(id TEXT PRIMARY KEY,payload TEXT NOT NULL);`+NATIVE_FISCAL_RECEIPTS_SCHEMA+OFFLINE_FISCAL_ALLOCATION_WRITER_SCHEMA;
function storage(entries:Map<string,string>){
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:(k:string)=>entries.get(k)||null,setItem:(k:string,v:string)=>entries.set(k,v),removeItem:(k:string)=>entries.delete(k)},configurable:true});
}
async function leaseFixture(options:{download?:boolean;capacity?:number;legacyHash?:string}={}){
 const entries=new Map<string,string>([['clic_terminal_credentials_v1',JSON.stringify(credentials)],['CLIC_POS_DEVICE_ID','device']]);
 storage(entries);
 const sql=new DatabaseSync(':memory:');sql.exec(schema());
 let updates=0;const bridge={query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>{if(/^\s*UPDATE/i.test(q))updates++;return {changes:sql.prepare(q).run(...v)};},execute:async(q:string)=>sql.exec(q)};
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});const store=adapter.fiscalWorkflowStore;
 const authority=await offlineFiscalAuthorityFromConfig(config,credentials,'device'),now=Date.now();
 const lease:OfflineFiscalLease={contractVersion:1,authorizationKind:'OFFLINE_FISCAL_LEASE_V1',leaseId:uuid(9,1),scope,issuerRnc:'101010101',provider:'MSELLER',environment:0,issuedAt:new Date(now-1000).toISOString(),validUntil:new Date(now+7*86400000-1000).toISOString(),authorityHash:'a'.repeat(64),saleCapacity:options.capacity||4,bindingFingerprint:'b'.repeat(64)};
 const permits=Array.from({length:lease.saleCapacity},(_,i)=>({schemaVersion:2 as const,permitId:uuid(1,i+1),transactionId:uuid(2,i+1),nonce:'nonce-'+i,createdAt:new Date(now).toISOString(),expiresAt:lease.validUntil,scope,issuerRnc:lease.issuerRnc,environment:0 as const,authorityHash:lease.authorityHash,operationKind:'SALE' as const,state:'PERMIT',leaseId:lease.leaseId}));
 sql.prepare("INSERT INTO documents(collection_name,doc_id,data)VALUES('config','current',?)").run(JSON.stringify(config));
 if(options.download!==false)await store.saveOfflineLeasePage!(lease,permits,authority,new Date(now).toISOString());
 const client=(overrides:{credentials?:any;authority?:any;readAuth?:any;fetchImpl?:any}={})=>createFiscalWorkflowV2Client({store:()=>store,
  readOfflineAuthority:async()=>overrides.authority||offlineFiscalAuthorityFromConfig(config,overrides.credentials||credentials,'device'),
  readAuth:overrides.readAuth||(()=>{throw Error('EXPIRED_TRANSPORT_SESSION');}),
  fetchImpl:overrides.fetchImpl||(async()=>{throw Error('OFFLINE');})} as any);
 return {sql,bridge,store,authority,lease,permits,client,updates:()=>updates,
  insertLease:async(bindingHash:string,payload:any=lease)=>{
   const now=Date.now();
   sql.prepare('INSERT INTO pos_offline_fiscal_leases_v1(lease_id,scope_key,lease_json,binding_hash,server_offset_ms,max_local_ms)VALUES(?,?,?,?,?,?)')
    .run(payload.leaseId,JSON.stringify(Object.fromEntries(Object.keys(scope).sort().map(key=>[key,(scope as any)[key]]))),JSON.stringify(payload),bindingHash,0,now);
   for(const permit of permits)sql.prepare("INSERT OR IGNORE INTO pos_fiscal_permits_v2(permit_id,transaction_id,scope_key,permit_json,expires_at,state)VALUES(?,?,?,?,?,'AVAILABLE')").run(permit.permitId,permit.transactionId,fiscalScopeKey(),JSON.stringify(permit),permit.expiresAt);
  }};
}
const fiscalScopeKey=()=>JSON.stringify(Object.fromEntries(Object.keys(scope).sort().map(key=>[key,(scope as any)[key]])));
async function allocationFixture(options:{download?:boolean}={}){
 const entries=new Map<string,string>([['clic_terminal_credentials_v1',JSON.stringify(credentials)],['CLIC_POS_DEVICE_ID','device']]);
 storage(entries);
 const sql=new DatabaseSync(':memory:');sql.exec(schema());
 let updates=0;const bridge={query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>{if(/^\s*UPDATE/i.test(q))updates++;return {changes:sql.prepare(q).run(...v)};},execute:async(q:string)=>sql.exec(q)};
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});const store=adapter.fiscalWorkflowStore;
 const range={id:uuid(2,1),type:'E32',prefix:'E32',startNumber:1,endNumber:3,isActive:true,expiryDate:''};
 const allocation={id:uuid(3,1),terminalId:scope.terminalId,fiscalRangeId:range.id,ncfType:'E32',prefix:'E32',reservedStart:1,reservedEnd:3,nextNumber:4,status:'ACTIVE',releasedAt:null};
 const allocConfig:any={...config,id:'current',terminals:[{...config.terminals[0],config:{...config.terminals[0].config,fiscal:{...config.terminals[0].config.fiscal,fiscalRanges:[range],fiscalAllocations:[allocation]}}}]};
 const put=(collection:string,doc:any)=>sql.prepare('INSERT INTO documents(collection_name,doc_id,data)VALUES(?,?,?)').run(collection,doc.id,JSON.stringify(doc));
 put('config',allocConfig);put('fiscalRanges',range);put('fiscalAllocations',allocation);put('localFiscalBuffer',{id:uuid(4,1),type:'E32',prefix:'E32',currentNumber:1,startNumber:1,endNumber:3,expiryDate:'',terminalId:scope.terminalId,fiscalRangeId:range.id,allocationId:allocation.id});put('internalSequences',{id:'SERIES',documentType:'TICKET',prefix:'T-',padding:6,nextNumber:1,active:true});
 const local=await offlineFiscalAuthorityFromConfig(allocConfig,credentials,'device'),now=Date.now();
 const unsigned:any={contractVersion:2,authorizationKind:'OFFLINE_FISCAL_ALLOCATION_V2',authorizationId:uuid(5,1),scope,issuerRnc:'101010101',provider:'MSELLER',environment:0,issuedAt:new Date(now-1000).toISOString(),bindingFingerprint:'a'.repeat(64),allocations:[{allocationId:allocation.id,fiscalRangeId:range.id,ncfType:'E32',prefix:'E32',padding:10,start:1,end:3,rangeStart:1,rangeEnd:3,expiryDate:null}]};
 const grant:OfflineFiscalAllocation={...unsigned,authorityHash:await allocationHash(unsigned)};
 if(options.download!==false)await store.saveAllocation!(grant,local,new Date(now).toISOString());
 const client=()=>createFiscalWorkflowV2Client({store:()=>store,readOfflineAuthority:async()=>offlineFiscalAuthorityFromConfig(allocConfig,credentials,'device'),readAuth:()=>{throw Error('EXPIRED_TRANSPORT');},fetchImpl:async()=>{throw Error('OFFLINE');}} as any);
 return {sql,store,local,grant,client,updates:()=>updates,insertGrant:(payload:any,bindingHash:string)=>sql.prepare('INSERT INTO pos_offline_fiscal_allocations_v2(authorization_id,scope_key,authority_json,binding_hash,server_offset_ms,max_local_ms)VALUES(?,?,?,?,?,?)').run(payload.authorizationId,fiscalScopeKey(),JSON.stringify(payload),bindingHash,0,Date.now())};
}
const contractVersion=async(overrides:any={})=>(await offlineFiscalAuthorityFromConfig(config,{...credentials,...overrides.credentials},'device')).bindingHash;

test('P0-1 fiscal identity hash ignores token, session health and erpSyncBase; identity changes do change it',async()=>{
 const base=await contractVersion();
 const rotated=await contractVersion({credentials:{deviceToken:'rotated-token',syncToken:'another',syncTokenExpiresAt:'2030-01-01T00:00:00Z',authStatus:'NEEDS_REAUTH',lastAuthError:'DEVICE_SUPERSEDED'}});
 assert.equal(rotated,base,'a rotated/expired credential must not change the fiscal identity');
 assert.equal(await contractVersion({credentials:{authStatus:'BOUND_AUTH_MISMATCH',lastAuthError:'DEVICE_TOKEN_INVALID'}}),base);
 // Session faults are reported with their own code and never as a binding change.
 const expired=offlineFiscalSessionState({...credentials,deviceToken:undefined});
 assert.deepEqual(expired.verified,false);assert.equal(expired.code,OFFLINE_FISCAL_SESSION_UNAVAILABLE);
 await assert.rejects(offlineFiscalAuthorityFromConfig(config,{...credentials,lastAuthError:'DEVICE_SUPERSEDED'},'device',{requireTransportVerified:true}),/OFFLINE_FISCAL_SESSION_UNAVAILABLE/);
 // A genuine fiscal identity change still changes the hash.
 const changed=structuredClone(config);changed.terminals[0].config.fiscal.environment=1;
 assert.notEqual((await offlineFiscalAuthorityFromConfig(changed,credentials,'device')).bindingHash,base);
 const otherIssuer=structuredClone(config);otherIssuer.companyInfo.rnc='202020202';otherIssuer.terminals[0].config.fiscal.credentialKey='202020202';
 assert.notEqual((await offlineFiscalAuthorityFromConfig(otherIssuer,credentials,'device')).bindingHash,base);
 // Source contract: transport/session fields are gone from the identity payload.
 const leaseContext=source('services/fiscal/OfflineFiscalLeaseContext.ts');
 const payload=leaseContext.slice(leaseContext.indexOf('const fiscalIdentityPayload'),leaseContext.indexOf('export async function offlineFiscalAuthorityFromConfig'));
 assert.doesNotMatch(payload,/deviceFingerprint/);
 assert.doesNotMatch(payload,/erpSyncBase/);
 assert.doesNotMatch(payload,/resolveSyncTarget/);
});

test('P0-1/P0-2 session health returns authority, revokes nothing and leaves the lease readable',async()=>{
 const f=await leaseFixture();try{
  const degraded=await offlineFiscalAuthorityFromConfig(config,{...credentials,authStatus:'NEEDS_REAUTH',lastAuthError:'DEVICE_SUPERSEDED'},'device');
  const lease=await f.store.offlineLease(degraded);assert.equal(lease?.leaseId,f.lease.leaseId);
  const client=f.client({credentials:{...credentials,authStatus:'NEEDS_REAUTH',lastAuthError:'DEVICE_SUPERSEDED'}});
  assert.equal(await client.offlineReady(),true);
  assert.equal(Number(f.sql.prepare('SELECT sum(revoked) n FROM pos_offline_fiscal_leases_v1').get()!.n||0),0);
  assert.equal(Number(f.sql.prepare('SELECT sum(revoked) n FROM pos_offline_fiscal_allocations_v2').get()!.n||0),0);
 }finally{f.sql.close();}
});

test('P0-2 diagnostics, offlineReady, offlineStatus and offlineLease are pure reads (0 UPDATE, max_local_ms intact)',async()=>{
 const f=await leaseFixture();try{
  const before=JSON.stringify(f.sql.prepare('SELECT lease_id,max_local_ms,revoked FROM pos_offline_fiscal_leases_v1').all()),updates=f.updates();
  const client=f.client();
  const first={ready:await client.offlineReady(),readiness:await client.offlineReadiness(),status:await client.offlineStatus(),diagnostics:await client.diagnostics()};
  const second={ready:await client.offlineReady(),readiness:await client.offlineReadiness(),status:await client.offlineStatus(),diagnostics:await client.diagnostics()};
  assert.deepEqual(first.readiness,second.readiness);assert.deepEqual(first.status,second.status);
  assert.equal(first.ready,true);assert.equal(first.diagnostics.reserveKind,'V1_LEASE');
  assert.equal(JSON.stringify(f.sql.prepare('SELECT lease_id,max_local_ms,revoked FROM pos_offline_fiscal_leases_v1').all()),before);
  assert.equal(f.updates(),updates,'read paths must not execute UPDATE');
 }finally{f.sql.close();}
});

test('P0-2 a foreign fiscal identity is quarantined, never revoked, and reported as AUTHORITY_CHANGED',async()=>{
 const f=await leaseFixture({download:false});try{
  const foreign=structuredClone(f.lease);foreign.leaseId=uuid(9,2);foreign.issuerRnc='999999999';
  await f.insertLease(f.authority.bindingHash,foreign);
  assert.equal(await f.store.offlineLease(f.authority),null);
  assert.equal(f.sql.prepare('SELECT revoked FROM pos_offline_fiscal_leases_v1').get()!.revoked,0);
  assert.equal(await f.store.offlineLeaseReason!(f.authority),'AUTHORITY_CHANGED');
  const readiness=await f.client().offlineReadiness();assert.notEqual(readiness.reason,'READY_V1');
 }finally{f.sql.close();}
});

test('P0-1 legacy binding hashes are accepted by fiscal identity and never rewritten',async()=>{
 const f=await leaseFixture({download:false});try{
  const legacyHash='f'.repeat(64);
  await f.insertLease(legacyHash);
  assert.notEqual(legacyHash,f.authority.bindingHash);
  const lease=await f.store.offlineLease(f.authority);assert.equal(lease?.leaseId,f.lease.leaseId);
  assert.equal(await f.client().offlineReady(),true);
  assert.equal(await f.store.offlineBindingCompatible!(legacyHash,f.authority),true);
  assert.deepEqual(await f.store.offlineReserveBindingHashes!(f.authority),{lease:legacyHash,allocation:null});
  assert.equal(f.sql.prepare('SELECT binding_hash FROM pos_offline_fiscal_leases_v1').get()!.binding_hash,legacyHash,'legacy rows must stay untouched');
  assert.equal(f.sql.prepare('SELECT revoked FROM pos_offline_fiscal_leases_v1').get()!.revoked,0);
 }finally{f.sql.close();}
});

test('P0-2 a foreign allocation is quarantined in memory without revoking it',async()=>{
 const f=await allocationFixture({download:false});try{const original=f.grant;
  f.insertGrant({...original,issuerRnc:'999999999'},'e'.repeat(64));
  const before=f.updates();
  await assert.rejects(f.store.allocationAvailability!(f.local),/AUTHORITY_CHANGED/);
  assert.equal(f.updates(),before,'quarantine must not execute UPDATE');
  assert.equal(f.sql.prepare('SELECT revoked FROM pos_offline_fiscal_allocations_v2').get()!.revoked,0);
  assert.equal((await f.client().offlineReadiness()).reason,'AUTHORITY_CHANGED');
 }finally{f.sql.close();}
});

test('P0-3 banner policy: degraded only with a usable reserve; identity changes and absent reserve stay blocking',()=>{
 assert.equal(isDegradableOfflineFiscalFailure('OFFLINE_FISCAL_SESSION_UNAVAILABLE'),true);
 assert.equal(isDegradableOfflineFiscalFailure('SYNC_V3_OFFLINE_AUTHORITY_REQUIRED'),true);
 assert.equal(isDegradableOfflineFiscalFailure('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED'),true);
 assert.equal(isDegradableOfflineFiscalFailure('OFFLINE_FISCAL_BINDING_CHANGED'),false);
 assert.equal(isDegradableOfflineFiscalFailure('SYNC_V3_BINDING_CHANGED'),false);
 const ready=offlineFiscalFailureDecision({failure:'OFFLINE_FISCAL_SESSION_UNAVAILABLE',offlineReady:true,readinessReason:'READY_V1'});
 assert.equal(ready.blocking,false);assert.equal(ready.severity,'DEGRADED');assert.equal(ready.retry,true);
 const absent=offlineFiscalFailureDecision({failure:'OFFLINE_FISCAL_SESSION_UNAVAILABLE',offlineReady:false,readinessReason:'AUTHORITY_REVOKED'});
 assert.equal(absent.blocking,true);assert.match(absent.detail,/revocada por el ERP/);
 const identity=offlineFiscalFailureDecision({failure:'OFFLINE_FISCAL_BINDING_CHANGED',offlineReady:true,readinessReason:'READY_V1'});
 assert.equal(identity.blocking,true,'a real fiscal identity change is never hidden');
 const configError=offlineFiscalFailureDecision({failure:'SYNC_V3_CONFIGURED_TARIFF_WAREHOUSE_REQUIRED',authorityFailure:true,offlineReady:true});
 assert.equal(configError.blocking,true);
 assert.match(offlineFiscalFailureReason('EXPIRED_V1'),/venció/);
 // Source contract: the component consumes the decision, offers retry and reacts to `online`.
 const component=source('components/LargeMasterSyncV3OperationalPOS.tsx');
 assert.match(component,/offlineFiscalFailureDecision\(/);
 assert.match(component,/Reintentar/);
 assert.match(component,/addEventListener\('online'/);
 assert.match(component,/v3Operational=\{blockingFailure \? blockedBoundary : boundary \|\| blockedBoundary\}/);
 assert.doesNotMatch(component,/v3Operational=\{failure \? blockedBoundary/);
});

test('P0-4 diagnostics reports the effective V1 reserve, its reason when absent and separates payments from intents',async()=>{
 const f=await leaseFixture();try{
  const client=f.client(),checkout=await client.reserveOfflineCheckout('cart','operation');
  await client.recordPayment(checkout,'payment-1');
  f.sql.prepare("INSERT INTO payment_intents_v2(intent_id,idempotency_key,payment_id,provider,transaction_id,amount,currency_code,status,created_at,updated_at)VALUES('intent','intent','payment-1','CASH',?,654.9,'DOP','AUTHORIZED','now','now')").run(checkout.transactionId);
  const snapshot=await client.diagnostics();
  assert.equal(snapshot.reserveKind,'V1_LEASE');assert.equal(snapshot.reserveAvailable,true);
  assert.match(snapshot.lease,/usables/);assert.match(snapshot.lease,/hasta /);assert.match(snapshot.lease,new RegExp(f.lease.validUntil));
  assert.match(snapshot.payments,/ment-1/);assert.match(snapshot.paymentIntents,/AUTHORIZED/);
  assert.equal(snapshot.offlineReady,true);assert.ok(snapshot.bindingHash.length>=8);assert.ok(snapshot.recordBindingHash.includes('V1'));
 }finally{f.sql.close();}
 const empty=await leaseFixture({download:false});try{
  const snapshot=await empty.client().diagnostics();
  assert.equal(snapshot.reserveKind,'NONE');assert.equal(snapshot.reserveAvailable,false);
  assert.match(snapshot.lease,/^SIN RESERVA/);assert.match(snapshot.lease,/MISSING_AUTHORIZATION/);
  assert.ok(snapshot.reserveReason.length>0);
 }finally{empty.sql.close();}
});

test('P0-4 diagnostics reports the effective V2 allocation with remaining per type',async()=>{
 const f=await allocationFixture();try{
  const snapshot=await f.client().diagnostics();
  assert.equal(snapshot.reserveKind,'V2_ALLOCATION');assert.equal(snapshot.reserveAvailable,true);
  assert.match(snapshot.lease,/Asignación /);assert.match(snapshot.lease,/E32: 3/);
  assert.equal(snapshot.offlineReady,true);
  const sourceFile=source('components/FiscalDiagnostics.tsx');
  assert.match(sourceFile,/reserveAvailable/);assert.match(sourceFile,/reserveReason/);assert.match(sourceFile,/paymentIntents/);
 }finally{f.sql.close();}
});

test('P0-2/B2 allocation EFFECT_POSSIBLE reads are pure: 0 UPDATE and max_local_ms intact',async()=>{
 const f=await allocationFixture();try{
  const identity=JSON.stringify({items:[{id:'item',cartId:'line',quantity:1,price:555}],customerId:null,fiscalType:'E32'});
  const client=f.client(),checkout=await client.reserveOfflineCheckout(identity,'op-purity');
  await client.recordPayment(checkout,'payment-1');
  assert.equal((await f.store.readCheckout(checkout.checkoutId))?.phase,'EFFECT_POSSIBLE');
  const row=()=>f.sql.prepare('SELECT authorization_id,max_local_ms,revoked FROM pos_offline_fiscal_allocations_v2').get()!;
  const before=JSON.stringify(row()),updates=f.updates();
  for(let read=0;read<2;read++){
   const snapshot=await client.diagnostics();
   assert.equal(snapshot.reserveKind,'V2_ALLOCATION');
   const readiness=await client.offlineReadiness();assert.equal(readiness.reason,'READY_ALLOCATION');
   assert.deepEqual(await client.checkoutFiscalStatus('E32'),{remaining:1,total:1,recovery:true});
   await client.offlineStatus();
   assert.equal(await client.offlineReady(),true);
  }
  assert.equal(JSON.stringify(row()),before,'reading must not advance max_local_ms nor revoke');
  assert.equal(f.updates(),updates,'allocation read paths must not execute UPDATE');
 }finally{f.sql.close();}
});
test('P0-3/B3 non-offline availability faults are never degraded to the offline warning',()=>{
 const nonOffline=['SYNC_V3_TARIFF_UNAVAILABLE','SYNC_V3_NATIVE_STORE_UNAVAILABLE','SYNC_V3_CATALOG_READ_UNAVAILABLE','SYNC_V3_ARTICLE_UNAVAILABLE','SYNC_V3_EXACT_CODE_UNAVAILABLE','SYNC_V3_CATEGORY_UNAVAILABLE','SYNC_V3_OFFLINE_FINANCIAL_AUTHORITY_REQUIRED'];
 for(const code of nonOffline){
  assert.equal(isDegradableOfflineFiscalFailure(code),false,code);
  const decision=offlineFiscalFailureDecision({failure:code,offlineReady:true,readinessReason:'READY_V1'});
  assert.equal(decision.blocking,true,code);
  assert.equal(decision.severity,'BLOCKING',code);
  assert.doesNotMatch(decision.detail,/puedes seguir cobrando/i,code);
  // The real cause is reported; it must not be disguised as "no local reserve".
  assert.match(decision.detail,new RegExp(code),code);
  assert.doesNotMatch(decision.detail,/No hay una reserva fiscal local válida/,code);
 }
 const degradable=['OFFLINE_FISCAL_SESSION_UNAVAILABLE','OFFLINE_FISCAL_PREPARATION_FAILED','OFFLINE_FISCAL_PREPARATION_DISABLED','OFFLINE_FISCAL_RESERVE_QUARANTINED','SYNC_V3_OFFLINE_AUTHORITY_REQUIRED','SYNC_V3_OFFLINE_CACHED_RUNTIME_REQUIRED','SYNC_V3_HTTP_TEMPORARY','SYNC_V3_TIMEOUT','FISCAL_WORKFLOW_DISABLED','FISCAL_WORKFLOW_UNAVAILABLE','FISCAL_WORKFLOW_CONTEXT_CHANGED','FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED'];
 for(const code of degradable)assert.equal(isDegradableOfflineFiscalFailure(code),true,code);
 // Identity changes remain blocking even while offline with a valid reserve.
 for(const code of ['OFFLINE_FISCAL_BINDING_CHANGED','SYNC_V3_BINDING_CHANGED'])assert.equal(isDegradableOfflineFiscalFailure(code),false,code);
});
const leaseScopeKey=()=>JSON.stringify(Object.fromEntries(Object.keys(scope).sort().map(key=>[key,(scope as any)[key]])));
const refillKey=()=>leaseScopeKey()+'|offline-lease-v1';
const boundReadAuth=()=>({base:'https://erp.example.invalid/api/sync',headers:{},descriptor:scope,assertCurrent(){},sessionExpiresAt:null});

test('C1 409 FISCAL_OFFLINE_LEASE_OPERATION_REUSED rotates operation_id and retries exactly once',async()=>{
 const f=await leaseFixture({download:false});try{
  const authority=await offlineFiscalAuthorityFromConfig(config,credentials,'device');
  const firstOperation=await f.store.refillOperation(refillKey());
  let permitCalls=0;const bodies:any[]=[];
  const fetchImpl=async(url:any,options:any)=>{
   const path=String(url);
   if(path.endsWith('/offline-lease/capability'))return {ok:true,json:async()=>({schemaVersion:1,capability:'OFFLINE_FISCAL_LEASE_V1',version:1,scope,serverTime:new Date().toISOString(),policy:{validitySeconds:604800,saleCapacity:f.lease.saleCapacity,pageSize:16}})};
   const body=JSON.parse(options.body);bodies.push(body);permitCalls+=1;
   if(permitCalls===1)return {ok:false,json:async()=>({code:'FISCAL_OFFLINE_LEASE_OPERATION_REUSED'})};
   return {ok:true,json:async()=>({schemaVersion:1,serverTime:new Date().toISOString(),lease:f.lease,page:0,nextPage:null,permits:f.permits})};
  };
  const client=f.client({authority,readAuth:boundReadAuth,fetchImpl});
  await client.prefetchOfflineLease();
  assert.equal(permitCalls,2,'exactly one retry after the 409');
  assert.equal(bodies.length,2);
  assert.equal(bodies[0].operationId,firstOperation,'the first attempt uses the persisted operation id');
  assert.notEqual(bodies[0].operationId,bodies[1].operationId,'the persisted operation id rotated before the retry');
  // The rotated attempt persisted the lease/permits and consumed the refill operation (no 409 state left).
  assert.equal(f.sql.prepare('SELECT count(*) n FROM pos_offline_fiscal_leases_v1').get()!.n,1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM pos_fiscal_permits_v2').get()!.n,f.permits.length);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM pos_fiscal_refill_v2').get()!.n,0);
  assert.equal((await client.offlineReadiness()).reason,'READY_V1');
 }finally{f.sql.close();}
});

test('C1 a revoked lease is not emitted locally and only one bounded retry is attempted',async()=>{
 const f=await leaseFixture({download:false});try{
  const authority=await offlineFiscalAuthorityFromConfig(config,credentials,'device');
  await f.store.refillOperation(refillKey());
  let permitCalls=0;
  const fetchImpl=async(url:any,options:any)=>{
   const path=String(url);
   if(path.endsWith('/offline-lease/capability'))return {ok:true,json:async()=>({schemaVersion:1,capability:'OFFLINE_FISCAL_LEASE_V1',version:1,scope,serverTime:new Date().toISOString(),policy:{validitySeconds:604800,saleCapacity:f.lease.saleCapacity,pageSize:16}})};
   permitCalls+=1;
   return {ok:false,json:async()=>({code:'FISCAL_OFFLINE_LEASE_REVOKED'})};
  };
  const client=f.client({authority,readAuth:boundReadAuth,fetchImpl});
  await assert.rejects(client.prefetchOfflineLease(),/FISCAL_OFFLINE_LEASE_REVOKED/);
  assert.equal(permitCalls,2,'rotation retries once, never loops');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM pos_offline_fiscal_leases_v1').get()!.n,0,'no lease emitted under a revoked authority');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM pos_fiscal_permits_v2').get()!.n,0,'no permits emitted under a revoked authority');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM pos_fiscal_refill_v2').get()!.n,1,'the rotated operation stays for a later bounded retry');
 }finally{f.sql.close();}
});

test('C1 a non-rotation refill failure keeps the operation id (old ERP compatibility)',async()=>{
 const f=await leaseFixture({download:false});try{
  const authority=await offlineFiscalAuthorityFromConfig(config,credentials,'device');
  const originalOperation=await f.store.refillOperation(refillKey());
  let permitCalls=0;
  const fetchImpl=async(url:any,options:any)=>{
   const path=String(url);
   if(path.endsWith('/offline-lease/capability'))return {ok:true,json:async()=>({schemaVersion:1,capability:'OFFLINE_FISCAL_LEASE_V1',version:1,scope,serverTime:new Date().toISOString(),policy:{validitySeconds:604800,saleCapacity:f.lease.saleCapacity,pageSize:16}})};
   permitCalls+=1;
   return {ok:false,json:async()=>({code:'FISCAL_OFFLINE_LEASE_INVALID'})};
  };
  const client=f.client({authority,readAuth:boundReadAuth,fetchImpl});
  await assert.rejects(client.prefetchOfflineLease(),/FISCAL_OFFLINE_LEASE_INVALID/);
  assert.equal(permitCalls,1,'only explicit rotation signals retry');
  assert.equal((await f.store.refillOperation(refillKey())),originalOperation,'operation id untouched for old-ERP/other failures');
 }finally{f.sql.close();}
});

test('C1 rotateRefillOperation is explicit: the old operation can no longer save permits',async()=>{
 const f=await leaseFixture({download:false});try{
  const current=await f.store.refillOperation(refillKey());
  const rotated=await f.store.rotateRefillOperation!(refillKey());
  assert.notEqual(rotated,current);
  assert.equal(await f.store.refillOperation(refillKey()),rotated);
  await assert.rejects(f.store.savePermits(refillKey(),current,[]),/CONFLICT/);
 }finally{f.sql.close();}
});

test('P0-1/P0-2 reopening the store keeps legacy reserve usable and never rewrites identity rows',async()=>{
 const f=await leaseFixture();try{
  const reopened=new NativeFiscalWorkflowV2Store(()=>f.bridge,work=>work());
  assert.equal((await reopened.offlineLease(f.authority))?.leaseId,f.lease.leaseId);
  assert.equal(JSON.stringify(await reopened.offlineReserveBindingHashes!(f.authority)),JSON.stringify({lease:f.authority.bindingHash,allocation:null}));
 }finally{f.sql.close();}
});

test('un timeout de preparación es transitorio con reserva usable y bloquea sin reserva',()=>{
 assert.equal(isDegradableOfflineFiscalFailure('OFFLINE_FISCAL_PREPARATION_TIMEOUT'),true);
 const ready=offlineFiscalFailureDecision({failure:'OFFLINE_FISCAL_PREPARATION_TIMEOUT',offlineReady:true,readinessReason:'READY_V1'});
 assert.equal(ready.blocking,false);
 assert.equal(ready.severity,'DEGRADED');
 assert.equal(ready.retry,true);
 const absent=offlineFiscalFailureDecision({failure:'OFFLINE_FISCAL_PREPARATION_TIMEOUT',offlineReady:false,readinessReason:'MISSING_AUTHORIZATION'});
 assert.equal(absent.blocking,true);
 assert.equal(absent.severity,'BLOCKING');
});
