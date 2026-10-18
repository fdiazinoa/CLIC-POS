import {requireFiscalErpAppliedReceipt,FISCAL_DISPATCH_CLAIMS} from '../services/fiscal/FiscalMSellerDispatch';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {FiscalStatusReconciler,type FiscalStatusDependencies} from '../services/fiscal/FiscalStatusReconciler';
import {fiscalStatusSourceChecksum,verifyFiscalStatusProof,type FiscalStatusScope,type FiscalStatusProof} from '../services/fiscal/FiscalStatusProof';
import {attachFiscalStatusLifecycle} from '../services/fiscal/FiscalStatusLifecycle';
import {captureFiscalStatusBoundContext,captureFiscalBoundContext} from '../services/fiscal/FiscalBoundContext';
import {v3BindingKey} from '../services/sync/LargeMasterSyncV3OperationalSession';
import {getEffectiveFiscalComplianceConfig,getProviderEnvironment} from '../utils/fiscal/fiscalHelpers';
import {getScopedFiscalDocumentStatus} from '../services/fiscal/FiscalScopedStatusTransport';
import {LARGE_MASTER_SYNC_V3_SCHEMA_SQL} from '../services/db/LargeMasterSyncV3Schema';
import {CapacitorSQLiteAdapter} from '../services/db/adapters/CapacitorSQLiteAdapter';

const caja6Identity={tenantId:'tenant-six',companyId:'company-six',storeId:'store-six',terminalId:'terminal-six'};
async function fixture(caja6=false){
 const binding=JSON.stringify(['tenant','terminal','device','https://erp.test/api/sync','https://erp.test']);
 const line={id:'P',cartId:'P',quantity:1,price:85,netAmount:85,taxAmount:23.8,totalAmount:108.8,
  v3SaleAuthority:{binding,syncId:'S1',syncVersion:1,inventoryVersion:1,inventoryCursor:'C',warehouseId:'W',tariffId:'T',taxIncluded:false}};
 const tx:any={id:'27',displayId:'T27',terminalId:'terminal',date:'2026-10-13',ncf:'E3200000506',electronicNcf:'E3200000506',ncfType:'E32',
  fiscalProvider:'MSELLER',fiscalSyncStatus:'PENDING',fiscalProviderStatus:'V3_ISSUE_REQUESTED',items:[line],payments:[{amount:108.8}],netAmount:85,taxAmount:23.8,total:108.8,
  taxBreakdown:[],v3Binding:binding,v3WarehouseId:'W',v3InventoryBaseline:JSON.stringify([binding,'S1',1,1,'C']),v3CommitFingerprint:'immutable',
  fiscalClassificationAttemptedAt:'2026-10-13T21:00:00Z',fiscalClassificationProjection:{protected:'canonical'},fiscalPreSubmitRecoveryAudit:[{protected:'canonical'}]};
 const history={...tx,fiscalClassificationProjection:undefined,fiscalClassificationAttemptedAt:undefined,fiscalPreSubmitRecoveryAudit:[{protected:'history'}]};
 const scope:FiscalStatusScope={basis:'PERSISTED_SUBMISSION_INTENT',providerId:'MSELLER',environment:0,issuerRnc:'130090752',tenantId:'tenant',companyId:'company',
  terminalId:'terminal',deviceId:'device',storeId:'store',binding,sourceChecksum:await fiscalStatusSourceChecksum(tx),capturedAt:'2026-10-13T21:00:00Z'};
 tx.fiscalSubmissionScope=scope;
 const proof:FiscalStatusProof={schemaVersion:1,source:'ERP_SCOPED_PROVIDER_GET',scope:{tenantId:'tenant',companyId:'company',terminalId:'terminal',deviceId:'device',storeId:'store'},
  document:{erpDocumentId:'erp27',sourceTransactionId:'27',ncf:'E320000000506',ncfType:'E32',sourceChecksum:scope.sourceChecksum,total:108.8},
  issuer:{rnc:'130090752',providerId:'MSELLER',environment:0,credentialCompanyId:'company',credentialAccountRnc:'130090752'},environmentBasis:'PERSISTED_SUBMISSION_INTENT',
  historicalEnvironment:null,lookup:{requestedNcf:'E3200000506'},providerReceipt:{returnedNcf:'E320000000506',internalTrackId:'actual-track27',status:'DGIIAceptado',success:true,pending:false,invoiceTotal:108.8},
  decision:'ACCEPTED',observedAt:'2026-10-13T22:00:00Z'};
 if(caja6){
  const next=JSON.stringify([caja6Identity.tenantId,caja6Identity.terminalId,'device','https://erp.test/api/sync','https://erp.test']);
  for(const row of [tx,history]){row.terminalId=caja6Identity.terminalId;row.v3Binding=next;row.v3InventoryBaseline=JSON.stringify([next,'S1',1,1,'C']);row.items=[{...line,v3SaleAuthority:{...line.v3SaleAuthority,binding:next}}];}
  Object.assign(scope,caja6Identity,{binding:next});scope.sourceChecksum=await fiscalStatusSourceChecksum(tx);
  Object.assign(proof.scope,caja6Identity);proof.issuer.credentialCompanyId=scope.companyId;proof.document.sourceChecksum=scope.sourceChecksum;
 }
 return{tx,history,scope,proof};
}
async function native(caja6=false){
 const f=await fixture(caja6),sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));');sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
 sql.prepare("INSERT INTO master_v3_operational_owner VALUES(1,'S2',2,?)").run(f.scope.binding);
 sql.exec("UPDATE master_v3_state SET active_sync_id='S2',active_version=2;INSERT INTO master_v3_inventory_state VALUES(1,'S1',1,1,'C','now');");
 for(const [sync,version] of [['S1',1],['S2',2]])sql.prepare('INSERT INTO master_v3_catalog_owners VALUES(?,?,?,?,?,?,?)').run(sync,version,f.scope.binding,'S1',1,1,'C');
 const config={id:'current',companyInfo:{rnc:'130090752'},terminals:[{id:f.scope.terminalId,config:{currentDeviceId:'device',erpBinding:{tenantId:f.scope.tenantId,companyId:f.scope.companyId,storeId:f.scope.storeId}}}],fiscalCompliance:{providers:[{id:'MSELLER',environment:0}]}};
 for(const [collection,row] of [['transactions',f.tx],['transactionHistory',f.history],['config',config],['outbox',{id:'event',status:'PENDING'}]])sql.prepare('INSERT INTO documents(collection_name,doc_id,data) VALUES(?,?,?)').run(collection,row.id,JSON.stringify(row));
 const bridge={query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>sql.prepare(q).run(...v),execute:async(q:string)=>{sql.exec(q);}};
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});
 const read=(collection:string)=>JSON.parse(String(sql.prepare('SELECT data FROM documents WHERE collection_name=?').get(collection)?.data));
 let gets=0,publishes=0,now=100000,valid=true;
 const context={scope:{providerId:'MSELLER' as const,environment:0,issuerRnc:'130090752',tenantId:f.scope.tenantId,companyId:f.scope.companyId,terminalId:f.scope.terminalId,deviceId:'device',storeId:f.scope.storeId,binding:f.scope.binding},
  catalog:{syncId:'S2',syncVersion:2,binding:f.scope.binding},assertCurrent:async()=>{if(!valid)throw Error('changed scope');}};
 const deps:FiscalStatusDependencies={context:async()=>context,pair:async()=>({transaction:read('transactions'),history:read('transactionHistory')}),candidates:async()=>['27'],
  commit:async(mutations:any)=>adapter.saveDocumentsAtomically(mutations),get:async()=>{gets++;return f.proof;},publish:()=>{publishes++;assert.equal(read('transactions').fiscalSyncStatus,'SYNCED');assert.equal(read('transactionHistory').fiscalSyncStatus,'SYNCED');},now:()=>now};
 return{...f,sql,adapter,read,deps,worker:new FiscalStatusReconciler(deps),counts:()=>({gets,publishes}),setNow:(value:number)=>now=value,setValid:(value:boolean)=>valid=value};
}

test('actual native S2/S1 status CAS accepts only proof, preserves independent protected copies/source/NCF/payments/outbox, publishes after both commit, late ACK cannot regress',async()=>{
 const f=await native();try{
  const beforeTx=f.read('transactions'),beforeHistory=f.read('transactionHistory');
  await f.worker.consult('27');assert.deepEqual(f.counts(),{gets:1,publishes:1});
  for(const collection of ['transactions','transactionHistory']){
   const row=f.read(collection),before=collection==='transactions'?beforeTx:beforeHistory;
   assert.equal(row.fiscalSyncStatus,'SYNCED');assert.equal(row.fiscalReferenceId,'actual-track27');assert.equal(row.fiscalCertifiedNcf,'E320000000506');
   for(const key of ['ncf','electronicNcf','items','payments','total','taxAmount','netAmount','v3CommitFingerprint','v3InventoryBaseline','fiscalSubmissionScope','fiscalClassificationProjection','fiscalClassificationAttemptedAt','fiscalPreSubmitRecoveryAudit'])assert.deepEqual(row[key],before[key]);
   await f.adapter.saveDocument(collection,{...row,fiscalSyncStatus:'ERROR',fiscalReferenceId:null,fiscalCertifiedNcf:null,fiscalStatusProof:null,fiscalSyncedAt:null,syncStatus:'APPLIED_ERP',zReportId:'Z'});
   const final=f.read(collection);assert.equal(final.fiscalSyncStatus,'SYNCED');assert.equal(final.fiscalReferenceId,'actual-track27');assert.equal(final.syncStatus,'APPLIED_ERP');assert.equal(final.zReportId,'Z');assert.deepEqual(final.fiscalStatusProof,row.fiscalStatusProof);
  }
  assert.deepEqual(f.read('outbox'),{id:'event',status:'PENDING'});await f.worker.consult('27');assert.equal(f.counts().gets,1);
 }finally{f.sql.close();}
});
for(const mutation of ['history','config','scope'])test(`status GET delayed ${mutation} race denies all writes/UI publication`,async()=>{
 const f=await native();try{
  const before=f.read('transactions');f.deps.get=async()=>{
   if(mutation==='history')f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='transactionHistory'").run(JSON.stringify({...f.read('transactionHistory'),fiscalResponseMessage:'concurrent'}));
   if(mutation==='config')f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='config'").run(JSON.stringify({terminals:[],companyInfo:{rnc:'other'}}));
   if(mutation==='scope')f.setValid(false);return f.proof;
  };
  await assert.rejects(()=>f.worker.consult('27'));assert.deepEqual(f.read('transactions'),before);assert.equal(f.counts().publishes,0);
 }finally{f.sql.close();}
});
for(const field of ['issuer','environment','company','ncf','total','track','pending','generic','wrongSource'])test(`strict scoped acceptance denies ${field}`,async()=>{
 const f=await fixture(),p=JSON.parse(JSON.stringify(f.proof));
 if(field==='issuer')p.issuer.rnc='other';if(field==='environment')p.issuer.environment=1;if(field==='company')p.scope.companyId='other';if(field==='ncf')p.providerReceipt.returnedNcf='E3200000507';
 if(field==='total')p.providerReceipt.invoiceTotal=100;if(field==='track')p.providerReceipt.internalTrackId='';if(field==='pending')p.providerReceipt.pending=true;
 if(field==='generic')p.providerReceipt.status='Validado';if(field==='wrongSource')p.document.sourceTransactionId='other';
 assert.equal(await verifyFiscalStatusProof(p,f.scope,f.tx),false);
});
test('actual bound transport emits one GET with authenticated scope assertion, never normalizes echoed receipt; stale binding refuses',async()=>{
 const f=await fixture(),identity={erpSyncBaseUrl:'https://erp.test/api/sync',tenantId:'tenant',terminalId:'terminal',deviceId:'device',syncToken:'test-token'};let method='',calls=0;const credentials=()=>({...identity,companyId:'company',storeId:'store',deviceToken:'device-token',deviceTokenSource:'ERP_REGISTER'});
 const response=await getScopedFiscalDocumentStatus(f.tx,f.scope,()=>identity,async(url:any,init:any)=>{
  calls++;method=init.method;assert.equal(init.headers['X-Sync-Token'],'test-token');const parsed=new URL(url);assert.equal(parsed.pathname,'/api/sync/v3/fiscal/documents/status');
  assert.equal(JSON.parse(parsed.searchParams.get('scopeAssertion')!).sourceChecksum,f.scope.sourceChecksum);
  return{ok:true,json:async()=>f.proof} as Response;
 },credentials);assert.strictEqual(response,f.proof);assert.equal(method,'GET');assert.equal(calls,1);
 let reads=0;await assert.rejects(()=>getScopedFiscalDocumentStatus(f.tx,f.scope,()=>++reads===1?identity:{...identity,deviceId:'changed'},async()=>({ok:true,json:async()=>f.proof}) as Response,credentials),/SCOPE_CHANGED|AUTH_REQUIRED/);
});
test('shared checksum fixture agrees with independently written ERP canonical tuple',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/fiscal-status-checksum-v1.json',import.meta.url),'utf8'));
 const tx=fixture.transaction||fixture.source||fixture;
 assert.equal(await fiscalStatusSourceChecksum(tx),fixture.expectedChecksum||fixture.expectedSha256||fixture.sha256);
});

test('manual unscoped document requires explicit selected-environment approval; automatic cannot infer old environment',async()=>{
 const f=await native();try{
  const original=f.read('transactions');delete original.fiscalSubmissionScope;
  f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='transactions'").run(JSON.stringify(original));
  await assert.rejects(()=>f.worker.consult('27'),/LOOKUP_APPROVAL_REQUIRED/);
  await assert.rejects(()=>f.worker.consult('27',true,'U'),/LOOKUP_APPROVAL_REQUIRED/);
  await assert.rejects(()=>f.worker.consult('27',true,'U',1),/LOOKUP_APPROVAL_REQUIRED/);
  assert.deepEqual(f.read('transactions'),original);assert.equal(f.counts().gets,0);
  f.deps.get=async(_tx:any,scope:any)=>({...f.proof,environmentBasis:'EXPLICIT_AUTHORIZED_LOOKUP',document:{...f.proof.document,sourceChecksum:scope.sourceChecksum}});
  await f.worker.consult('27',true,'U',0);const final=f.read('transactions');
  assert.equal(final.fiscalLookupApproval.environment,0);assert.equal(final.fiscalLookupApproval.basis,'EXPLICIT_AUTHORIZED_LOOKUP');
  assert.equal(final.fiscalLookupApproval.approvedById,'U');assert.equal(final.fiscalSubmissionScope,undefined);assert.equal(final.fiscalSyncStatus,'SYNCED');
  assert.equal(f.read('transactionHistory').fiscalLookupApproval,undefined);
 }finally{f.sql.close();}
});
test('bounded automatic jobs coalesce, max10 serial GET, 60s cooldown; concurrent manual shares inflight and dispose holds delayed response',async()=>{
 const f=await fixture();let active=0,maxActive=0,gets=0,now=100000,commit=0;
 const rows=new Map<string,any>();for(let i=0;i<12;i++){
  const row={...f.tx,id:String(i)};row.fiscalSubmissionScope={...f.scope,sourceChecksum:await fiscalStatusSourceChecksum(row)};rows.set(row.id,row);
 }
 const context={scope:{providerId:'MSELLER' as const,environment:0,issuerRnc:'130090752',tenantId:f.scope.tenantId,companyId:f.scope.companyId,terminalId:f.scope.terminalId,deviceId:'device',storeId:f.scope.storeId,binding:f.scope.binding},
  catalog:{syncId:'S2',syncVersion:2,binding:f.scope.binding},assertCurrent:async()=>{}};
 const worker=new FiscalStatusReconciler({context:async()=>context,pair:async(id)=>({transaction:rows.get(id),history:rows.get(id)}),
  candidates:async()=>[...rows.keys()],get:async()=>{gets++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return{...f.proof,decision:'PENDING'};},
  commit:async()=>{commit++;},publish:()=>{throw Error('unconfirmed must not publish');},now:()=>now});
 await Promise.all([worker.runAutomatic(),worker.runAutomatic(),worker.runAutomatic()]);assert.equal(gets,10);assert.equal(maxActive,1);assert.equal(commit,0);
 await worker.runAutomatic();assert.equal(gets,10);now+=60001;await worker.runAutomatic();assert.equal(gets,20);
 await Promise.all([worker.consult('0',true,'U'),worker.consult('0',true,'U')]);assert.equal(gets,21);
 const pending=worker.consult('1',true,'U');await new Promise(resolve=>setTimeout(resolve,0));worker.dispose();await assert.rejects(()=>pending,/SCOPE_CHANGED/);assert.equal(commit,0);
});
test('native candidate query is scoped and max10, excludes never attempted, unscoped and accepted rows',async()=>{
 const f=await native();try{
  for(let i=0;i<15;i++){const row={...f.tx,id:'extra'+String(i).padStart(2,'0')};f.sql.prepare("INSERT INTO documents(collection_name,doc_id,data) VALUES('transactions',?,?)").run(row.id,JSON.stringify(row));}
  for(const [id,patch] of [['no-attempt',{fiscalProviderStatus:undefined,fiscalClassificationAttemptedAt:undefined}],['no-scope',{fiscalSubmissionScope:undefined}],['accepted',{fiscalSyncStatus:'SYNCED'}]] as const){
   const row={...f.tx,id,...patch};f.sql.prepare("INSERT INTO documents(collection_name,doc_id,data) VALUES('transactions',?,?)").run(id,JSON.stringify(row));
  }
  const ids=await f.adapter.getFiscalStatusCandidates(f.scope.binding,'',1000);assert.equal(ids.length,10);assert.equal(ids.some(id=>['no-attempt','no-scope','accepted'].includes(id)),false);
  assert.deepEqual(await f.adapter.getFiscalStatusCandidates('foreign','',10),[]);
 }finally{f.sql.close();}
});

test('native device drift at commit refuses both status copies even when outside context remains stale',async()=>{
 const f=await native();try{
  const before=f.read('transactions'),history=f.read('transactionHistory');
  f.deps.get=async()=>{const config=f.read('config');config.terminals[0].config.currentDeviceId='foreign';f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='config'").run(JSON.stringify(config));return f.proof;};
  await assert.rejects(()=>f.worker.consult('27'),/METADATA_MUTATION_DENIED/);
  assert.deepEqual(f.read('transactions'),before);assert.deepEqual(f.read('transactionHistory'),history);assert.equal(f.counts().publishes,0);
 }finally{f.sql.close();}
});

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function lifecycleClock() {
 let now=100000,serial=0;
 const timers=new Map<number,{at:number;listener:()=>void}>();
 return {
  now:()=>now, count:()=>timers.size,
  setTimer:(listener:()=>void,delay:number)=>{const id=++serial;timers.set(id,{at:now+delay,listener});return id as any;},
  clearTimer:(id:any)=>{timers.delete(id);},
  async advance(ms:number){now+=ms;for(const[id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.listener();}await settle();},
 };
}
function lifecycleHarness(worker:Pick<FiscalStatusReconciler,'runAutomatic'|'dispose'>,clock=lifecycleClock()) {
 let online=true;
 const onlineListeners=new Set<()=>void>(),transactionListeners=new Set<()=>void>();
 let sync:((state:any)=>void)|undefined;
 const options={hydrated:true,online:()=>online,addOnline:(listener:()=>void)=>{onlineListeners.add(listener);},removeOnline:(listener:()=>void)=>{onlineListeners.delete(listener);},
  addTransactionsUpdated:(listener:()=>void)=>{transactionListeners.add(listener);},removeTransactionsUpdated:(listener:()=>void)=>{transactionListeners.delete(listener);},
  syncTime:null,subscribe:(listener:(state:any)=>void)=>{sync=listener;return()=>{sync=undefined;};},setTimer:clock.setTimer,clearTimer:clock.clearTimer};
 return{clock,options,attach:()=>attachFiscalStatusLifecycle(worker,options),transaction:()=>{for(const listener of transactionListeners)listener();},
  connection:(value:boolean)=>{online=value;for(const listener of onlineListeners)listener();},
  synced:(timestamp:string)=>sync?.({lastSyncTime:timestamp,isSyncing:false,hasError:false}),
  listeners:()=>onlineListeners.size+transactionListeners.size+(sync?1:0)};
}
test('actual hydration/online/successful-sync lifecycle registers only ready state, coalesces timestamp events and disposes',async()=>{
 const {attachFiscalStatusLifecycle}=await import('../services/fiscal/FiscalStatusLifecycle');let runs=0,disposes=0,online=true;
 let onOnline:(()=>void)|undefined,onSync:((state:any)=>void)|undefined;
 const worker={runAutomatic:async()=>{runs++;},dispose:()=>{disposes++;}};
 const clock=lifecycleClock();
 const options={setTimer:clock.setTimer,clearTimer:clock.clearTimer,hydrated:false,online:()=>online,addOnline:(listener:()=>void)=>{onOnline=listener;},removeOnline:()=>{onOnline=undefined;},syncTime:null,
  subscribe:(listener:(state:any)=>void)=>{onSync=listener;return()=>{onSync=undefined;};}};
 attachFiscalStatusLifecycle(worker,options)();assert.equal(runs,0);assert.equal(onOnline,undefined);
 const cleanup=attachFiscalStatusLifecycle(worker,{...options,hydrated:true});assert.equal(runs,1);await settle();
 onSync!({lastSyncTime:'successful',isSyncing:false,hasError:false});assert.equal(runs,2);
 onSync!({lastSyncTime:'successful',isSyncing:false,hasError:false});onSync!({lastSyncTime:'failed',isSyncing:false,hasError:true});assert.equal(runs,2);await settle();
 online=false;onOnline!();assert.equal(runs,2);online=true;onOnline!();assert.equal(runs,3);
 cleanup();assert.equal(disposes,1);assert.equal(onSync,undefined);assert.equal(onOnline,undefined);
});
test('actual App historical MSeller manual callback consults the original only, without environment approval or source mutation',async()=>{
 const {transform}=await import('esbuild');const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const start=source.indexOf('async(transaction:Transaction):Promise<string>=> {',source.indexOf('const consultFiscalStatus ='));
 const end=source.indexOf('},[fiscalStatusWorker,currentUser?.id,loadFiscalStatusContext]);',start);
 assert.ok(start>0&&end>start);const code=(await transform('const callback='+source.slice(start,end+1)+';',{loader:'ts'})).code;
 const create=new Function('db','fiscalStatusWorker','currentUser','loadFiscalStatusContext','window',code+'return callback;');
 const f=await fixture();delete f.tx.fiscalSubmissionScope;let calls=0,approval:any,message='';
 const worker={consult:async(...args:any[])=>{calls++;approval=args;return'GET-only';}};
 const run=(answer:boolean)=>create({getDocument:async()=>f.tx},worker,{id:'U'},async()=>({scope:{environment:0}}),{confirm:(text:string)=>{message=text;return answer;}})(f.tx);
 const before=JSON.stringify(f.tx);assert.equal(await run(false),'GET-only');assert.equal(calls,1);assert.equal(message,'');assert.deepEqual(approval,['27',true,undefined,undefined,true]);
 assert.equal(await run(true),'GET-only');assert.equal(calls,2);assert.equal(JSON.stringify(f.tx),before);
});
test('actual App historical sync only consults: missing original attempt stays held with zero issuance and unchanged source/outbox',async()=>{
 const {transform}=await import('esbuild');const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const start=source.indexOf('async (transaction: Transaction,',source.indexOf('const syncFiscalDocument ='));
 const end=source.indexOf('}, [config, pollFiscalDocumentStatus, upsertFiscalTransaction, loadFiscalStatusContext, fiscalStatusWorker]);',start);assert.ok(start>0&&end>start);
 const code=(await transform('const callback='+source.slice(start,end+1)+';',{loader:'ts'})).code;
 const create=new Function('f',`const {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,v3FiscalInFlightRef,config,db,dbAdapter,getLargeMasterSyncV3OperationalSession,validateV3FrozenFiscalAmounts,validateV3FrozenLineFiscalAmounts,getEffectiveFiscalComplianceConfig,getProviderEnvironment,getFiscalProviderConfig,getExistingFiscalProviderReference,pollFiscalDocumentStatus,resolveFiscalProviderEstablishmentCode,resolveFiscalProviderCashierCode,calculateTransactionFiscalSummary,buildV3FrozenFiscalProviderTransaction,upsertFiscalTransaction,issueFiscalDocument,applyFiscalProviderResult,isDelegatedFiscalProvider,window,loadFiscalStatusContext,fiscalStatusSourceChecksum,requireFiscalErpAppliedReceipt,FISCAL_DISPATCH_CLAIMS,fiscalStatusWorker}=f;${code}return callback;`);
 const f=await native();try{
  const original=f.read('transactions');for(const key of ['fiscalSubmissionScope','fiscalProviderStatus','fiscalClassificationAttemptedAt','fiscalClassificationProjection','fiscalPreSubmitRecoveryAudit'])delete original[key];
  f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='transactions'").run(JSON.stringify(original));
  let issues=0;const context=await f.deps.context();
  const sync=create({LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:true,v3FiscalInFlightRef:{current:new Map()},config:{terminals:[],companyInfo:{rnc:'130090752'}},
   db:{getDocument:async(name:string)=>name==='transactions'?f.read('transactions'):null},dbAdapter:f.adapter,getLargeMasterSyncV3OperationalSession:async()=>({assertCurrent:async()=>{},projectConfig:async()=>({terminals:[]}),validate:async()=>undefined}),
   validateV3FrozenFiscalAmounts:()=>{},validateV3FrozenLineFiscalAmounts:()=>{},getEffectiveFiscalComplianceConfig:()=>({}),getProviderEnvironment:()=>0,getFiscalProviderConfig:()=>({}),getExistingFiscalProviderReference:(row:any)=>row.fiscalReferenceId,
   pollFiscalDocumentStatus:async()=>{},resolveFiscalProviderEstablishmentCode:()=>undefined,resolveFiscalProviderCashierCode:()=>undefined,calculateTransactionFiscalSummary:()=>{throw Error('legacy forbidden');},
   buildV3FrozenFiscalProviderTransaction:(row:any)=>row,upsertFiscalTransaction:async(row:any)=>f.adapter.saveDocument('transactions',row),
   issueFiscalDocument:async(input:any)=>{issues++;const stored=f.read('transactions');assert.equal(stored.fiscalSubmissionScope.environment,0);assert.equal(stored.fiscalSubmissionScope.basis,'PERSISTED_SUBMISSION_INTENT');assert.deepEqual(stored.fiscalSubmissionScope,input.transaction.fiscalSubmissionScope);return{success:false,pending:true};},
   applyFiscalProviderResult:(row:any)=>row,isDelegatedFiscalProvider:()=>true,window:{setTimeout:()=>{}},loadFiscalStatusContext:async()=>context,fiscalStatusSourceChecksum,requireFiscalErpAppliedReceipt,FISCAL_DISPATCH_CLAIMS,fiscalStatusWorker:f.worker});
  await assert.rejects(()=>sync(original),/FISCAL_STATUS_ATTEMPT_REQUIRED/);assert.equal(issues,0);const final=f.read('transactions');for(const key of ['items','payments','ncf','electronicNcf','total','v3CommitFingerprint'])assert.deepEqual(final[key],original[key]);
  assert.deepEqual(f.read('outbox'),{id:'event',status:'PENDING'});await assert.rejects(()=>sync(original),/FISCAL_STATUS_ATTEMPT_REQUIRED/);assert.equal(issues,0);assert.equal(final.fiscalSubmissionScope,undefined);assert.equal(final.fiscalProviderStatus,undefined);
 }finally{f.sql.close();}
});

for(const store of [undefined,'foreign'])test(`native store drift/missing ${String(store)} at commit holds both copies`,async()=>{
 const f=await native();try{
  const before=f.read('transactions'),history=f.read('transactionHistory');
  f.deps.get=async()=>{const config=f.read('config');config.terminals[0].config.erpBinding.storeId=store;f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='config'").run(JSON.stringify(config));return f.proof;};
  await assert.rejects(()=>f.worker.consult('27'),/METADATA_MUTATION_DENIED/);assert.deepEqual(f.read('transactions'),before);assert.deepEqual(f.read('transactionHistory'),history);assert.equal(f.counts().publishes,0);
 }finally{f.sql.close();}
});
test('missing recorded store or wrong returned store cannot establish acceptance',async()=>{
 const f=await fixture();assert.equal(await verifyFiscalStatusProof(f.proof,{...f.scope,storeId:undefined} as any,f.tx),false);
 assert.equal(await verifyFiscalStatusProof({...f.proof,scope:{...f.proof.scope,storeId:'foreign'}},f.scope,f.tx),false);
});

test('actual App durable callback prepends missing React rows, updates existing rows, and legacy history failure warns without dropping publication',async()=>{
 const {transform}=await import('esbuild');const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const publish=source.slice(source.indexOf('const publishFiscalTransaction ='),source.indexOf('const loadFiscalStatusContext ='));
 const upsert=source.slice(source.indexOf('const upsertFiscalTransaction ='),source.indexOf('const correctFiscalDocument ='));
 const code=(await transform(publish+upsert,{loader:'ts'})).code;
 const create=new Function('f',`const {setTransactions,window,db,dbAdapter,LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,getLargeMasterSyncV3OperationalSession,console,closedFiscalPublicationIds={current:new Set()},isTransactionReservedForClose=()=>false}=f;const useCallback=(fn)=>fn;${code}return upsertFiscalTransaction;`);
 let rows:any[]=[{id:'existing',total:1}],stored:any=null,warnings=0,events=0,saves:string[]=[];
 const db={getDocument:async()=>stored,saveDocument:async(collection:string,row:any)=>{
  saves.push(collection);if(collection==='transactionHistory')throw Error('legacy mirror unavailable');stored=row;
 }};
 const callback=create({setTransactions:(update:any)=>{rows=update(rows);},window:{dispatchEvent:()=>{events++;}},db,dbAdapter:{},
  LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:false,getLargeMasterSyncV3OperationalSession:()=>{throw Error('legacy must not open V3');},console:{warn:()=>{warnings++;}}});
 const next={id:'missing',fiscalSyncStatus:'ERROR',total:108.8};await callback(next);
 assert.deepEqual(saves,['transactions','transactionHistory']);assert.equal(warnings,1);assert.equal(events,1);assert.deepEqual(rows,[next,{id:'existing',total:1}]);
 await callback({...next,fiscalResponseMessage:'updated'});assert.equal(rows.length,2);assert.equal((rows[0] as any).fiscalResponseMessage,'updated');
 const before=rows;db.saveDocument=async()=>{throw Error('primary write failed');};await assert.rejects(()=>callback({...next,fiscalResponseMessage:'must not publish'}));assert.strictEqual(rows,before);assert.equal(events,2);
});

test('actual App component consultation props are absent for legacy and retain GET callback for V3',async()=>{
 const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const expressions=[...source.matchAll(/onConsultFiscalStatus=\{([^}]+)\}/g)].map(match=>match[1]);assert.equal(expressions.length,2);
 const callback=()=>{};for(const expression of expressions){
  const evaluate=new Function('LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED','consultFiscalStatus',`return (${expression});`);
  assert.equal(evaluate(false,callback),undefined);assert.strictEqual(evaluate(true,callback),callback);
 }
});

for(const shape of ['single','mixedId','mixedOperation','differentProof','missingRetained','wrongRetained'] as const)test(`native status reconciliation rejects ${shape} batch before either write`,async()=>{
 const f=await native();try{
  let mutations:any[]=[];f.deps.commit=async(value:any)=>{mutations=value;};f.deps.publish=()=>{};await f.worker.consult('27');
  assert.equal(mutations.length,2);const beforeTx=f.read('transactions'),beforeHistory=f.read('transactionHistory');
  if(shape==='single')mutations=mutations.slice(0,1);
  if(shape==='mixedId')mutations[1].document={...mutations[1].document,id:'other'};
  if(shape==='mixedOperation')mutations[1].v3FiscalMetadataOperation='FISCAL_LOOKUP_APPROVAL_APPEND';
  if(shape==='differentProof')mutations[1].document={...mutations[1].document,fiscalStatusProof:{...mutations[1].document.fiscalStatusProof,observedAt:'different'}};
  if(shape==='missingRetained')delete mutations[1].v3ExpectedRetainedDocument;
  if(shape==='wrongRetained')mutations[1].v3ExpectedRetainedDocument={...mutations[1].v3ExpectedRetainedDocument,expected:'{}'};
  await assert.rejects(()=>f.adapter.saveDocumentsAtomically(mutations),/FISCAL_METADATA_MUTATION_DENIED/);
  assert.deepEqual(f.read('transactions'),beforeTx);assert.deepEqual(f.read('transactionHistory'),beforeHistory);
 }finally{f.sql.close();}
});


test('persisted no-reference pending reaches strict acceptance in both real SQLite copies automatically at 60s',async()=>{
 const f=await native(),h=lifecycleHarness(f.worker);f.deps.now=h.clock.now;
 let gets=0;
 f.deps.get=async()=>++gets===1?{...f.proof,decision:'PENDING',providerReceipt:{...f.proof.providerReceipt,status:'Pendiente',pending:true,success:false}} as any:f.proof;
 const original=f.read('transactions'),outbox=f.read('outbox');assert.equal(original.fiscalReferenceId,undefined);
 const cleanup=h.attach();try{
  await f.worker.runAutomatic();await settle();assert.equal(gets,1);assert.equal(f.read('transactions').fiscalSyncStatus,'PENDING');assert.equal(h.clock.count(),1);
  await h.clock.advance(59999);assert.equal(gets,1);
  await h.clock.advance(1);await f.worker.runAutomatic();await settle();assert.equal(gets,2);
  for(const collection of ['transactions','transactionHistory']){
   const row=f.read(collection);assert.equal(row.fiscalSyncStatus,'SYNCED');assert.equal(row.fiscalReferenceId,'actual-track27');
   for(const key of ['ncf','items','payments','total','v3CommitFingerprint'])assert.deepEqual(row[key],original[key]);
  }
  assert.deepEqual(f.read('outbox'),outbox);assert.equal(f.counts().publishes,1);
 }finally{cleanup();assert.equal(h.clock.count(),0);f.sql.close();}
});

test('persisted transaction notification wakes without ERP ACK; bursts coalesce, max one timer, offline resumes',async()=>{
 let runs=0,release:(()=>void)|undefined;
 const h=lifecycleHarness({runAutomatic:async()=>{runs++;await new Promise<void>(resolve=>{release=resolve;});},dispose:()=>{}});
 const cleanup=h.attach();try{
  assert.equal(runs,1);for(let i=0;i<100;i++){h.transaction();h.synced(String(i));h.connection(true);}assert.equal(runs,1);assert.equal(h.clock.count(),0);
  release!();await settle();assert.equal(h.clock.count(),1);
  h.transaction();assert.equal(runs,2);assert.equal(h.clock.count(),0);release!();await settle();
  h.connection(false);await h.clock.advance(60000);assert.equal(runs,2);assert.equal(h.clock.count(),1);
  h.connection(true);assert.equal(runs,3);release!();await settle();assert.equal(h.clock.count(),1);
 }finally{cleanup();assert.equal(h.listeners(),0);assert.equal(h.clock.count(),0);}
 await h.clock.advance(60000);h.transaction();h.connection(true);assert.equal(runs,3);
});

test('restart while offline retains SQLite pending and reopens automatic GET-only reconciliation',async()=>{
 const f=await native(),h=lifecycleHarness(f.worker);f.deps.now=h.clock.now;
 h.connection(false);const before=f.read('transactions');let cleanup=h.attach();await settle();assert.equal(f.counts().gets,0);
 await h.clock.advance(60000);assert.deepEqual(f.read('transactions'),before);cleanup();
 const reopened=new FiscalStatusReconciler(f.deps),second=lifecycleHarness(reopened,h.clock);second.connection(false);cleanup=second.attach();
 try{await settle();assert.equal(f.counts().gets,0);second.connection(true);await reopened.runAutomatic();await settle();assert.equal(f.read('transactions').fiscalSyncStatus,'SYNCED');assert.equal(f.counts().gets,1);}
 finally{cleanup();f.sql.close();}
});

test('scope cleanup during GET prevents stale writes, reattached worker retains next bounded wake',async()=>{
 const f=await native(),h=lifecycleHarness(f.worker);f.deps.now=h.clock.now;
 let release:(()=>void)|undefined,gets=0,started:(()=>void)|undefined;
 const enteringGet=new Promise<void>(resolve=>{started=resolve;});
 f.deps.get=async()=>{gets++;if(gets===1){started!();await new Promise<void>(resolve=>{release=resolve;});}return f.proof;};
 let cleanup=h.attach();await enteringGet;assert.equal(gets,1);cleanup();assert.equal(h.clock.count(),0);
 cleanup=h.attach();release!();await f.worker.runAutomatic();await settle();
 try{
  assert.equal(f.counts().publishes,0);assert.equal(f.read('transactions').fiscalSyncStatus,'PENDING');assert.equal(h.clock.count(),1);
  await h.clock.advance(60000);await f.worker.runAutomatic();await settle();assert.equal(gets,2);assert.equal(f.read('transactions').fiscalSyncStatus,'SYNCED');
 }finally{cleanup();f.sql.close();}
});

test('automatic continuation never authorizes lookup for unknown attempts lacking persisted scope',async()=>{
 const f=await native();const tx=f.read('transactions');delete tx.fiscalSubmissionScope;
 f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='transactions'").run(JSON.stringify(tx));
 const h=lifecycleHarness(f.worker);f.deps.now=h.clock.now;const cleanup=h.attach();
 try{await f.worker.runAutomatic();await settle();await h.clock.advance(60000);await f.worker.runAutomatic();h.transaction();await f.worker.runAutomatic();await settle();assert.equal(f.counts().gets,0);assert.deepEqual(f.read('transactions'),tx);assert.equal(f.counts().publishes,0);}
 finally{cleanup();f.sql.close();}
});


test('real SQLite candidate cursor gives 26 pending documents fair 10/10/6 bounded passes',async()=>{
 const f=await native();
 for(let i=0;i<25;i++){
  const row={...f.tx,id:'row'+String(i).padStart(2,'0')};row.fiscalSubmissionScope={...f.scope,sourceChecksum:await fiscalStatusSourceChecksum(row)};
  for(const collection of ['transactions','transactionHistory'])f.sql.prepare('INSERT INTO documents(collection_name,doc_id,data) VALUES(?,?,?)').run(collection,row.id,JSON.stringify(row));
 }
 f.deps.candidates=(binding,after,limit)=>f.adapter.getFiscalStatusCandidates(binding,after,limit);
 f.deps.pair=async id=>{
  const read=(collection:string)=>JSON.parse(String(f.sql.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(collection,id)?.data));
  return{transaction:read('transactions'),history:read('transactionHistory')};
 };
 const visited:string[]=[];f.deps.get=async tx=>{visited.push(tx.id);return{...f.proof,decision:'PENDING'} as any;};
 const h=lifecycleHarness(f.worker);f.deps.now=h.clock.now;const cleanup=h.attach();
 try{
  await f.worker.runAutomatic();await settle();assert.equal(visited.length,10);
  await h.clock.advance(60000);await f.worker.runAutomatic();await settle();assert.equal(visited.length,20);
  await h.clock.advance(60000);await f.worker.runAutomatic();await settle();assert.equal(visited.length,26);assert.equal(new Set(visited).size,26);
  assert.equal(f.counts().publishes,0);assert.equal(h.clock.count(),1);
 }finally{cleanup();f.sql.close();}
});

test('timed-out status read retains all SQLite evidence and next scheduled pass accepts',async()=>{
 const f=await native(),h=lifecycleHarness(f.worker);f.deps.now=h.clock.now;let gets=0;
 const tx=f.read('transactions'),history=f.read('transactionHistory'),outbox=f.read('outbox');
 f.deps.get=async()=>{if(++gets===1)throw Error('status timeout');return f.proof;};const cleanup=h.attach();
 try{
  await f.worker.runAutomatic();await settle();assert.deepEqual(f.read('transactions'),tx);assert.deepEqual(f.read('transactionHistory'),history);assert.deepEqual(f.read('outbox'),outbox);
  await h.clock.advance(60000);await f.worker.runAutomatic();await settle();assert.equal(gets,2);assert.equal(f.read('transactions').fiscalSyncStatus,'SYNCED');
 }finally{cleanup();f.sql.close();}
});

test('native signed pending proof atomically enriches both mirrors without acceptance; scope is retained for history-only reprint',async()=>{
 const f=await native();try{
  f.proof.source='ERP_SCOPED_PROVIDER_ISSUE';f.proof.decision='PENDING';f.proof.providerReceipt.pending=true;f.proof.providerReceipt.status='Validado';
  f.proof.providerReceipt.printEvidence={schemaVersion:1,qrUrl:'https://fc.dgii.gov.do/testecf/consultatimbrefc?RNCEmisor=130090752&ENCF=E320000000506&MontoTotal=108.80&CodigoSeguridad=NVrTbH',securityCode:'NVrTbH',signedAt:'13-10-2026 18:00:00'};
  const before=f.read('transactions'),historyBefore=f.read('transactionHistory'),outbox=f.read('outbox');f.deps.publish=()=>{};
  await f.worker.appendPrintEvidence('27',f.proof);
  const tx=f.read('transactions'),history=f.read('transactionHistory');
  assert.equal(tx.fiscalSyncStatus,'PENDING');assert.equal(history.fiscalSyncStatus,'PENDING');
  assert.equal(history.fiscalSubmissionScope,undefined);assert.deepEqual(history.fiscalPrintScope,f.scope);
  const {resolveFiscalPrintDisplay}=await import('../services/fiscal/FiscalPrintEvidence');
  assert.ok(await resolveFiscalPrintDisplay({...history,zReportId:'Z'}));
  for(const key of ['items','payments','ncf','electronicNcf','total','v3CommitFingerprint']){assert.deepEqual(tx[key],before[key]);assert.deepEqual(history[key],historyBefore[key]);}
  assert.deepEqual(f.read('outbox'),outbox);
  await f.adapter.saveDocument('transactions',{...tx,fiscalPrintProof:null,fiscalPrintScope:null,fiscalSignedAt:null,syncStatus:'APPLIED_ERP'});
  assert.deepEqual(f.read('transactions').fiscalPrintProof,f.proof);assert.equal(f.read('transactions').fiscalSignedAt,'13-10-2026 18:00:00');
 }finally{f.sql.close();}
});

test('print enrichment native failure on second mirror rolls back both and preserves Outbox',async()=>{
 const f=await native();try{
  f.proof.providerReceipt.printEvidence={schemaVersion:1,qrUrl:'https://fc.dgii.gov.do/testecf/consultatimbrefc?RNCEmisor=130090752&ENCF=E320000000506&MontoTotal=108.80&CodigoSeguridad=NVrTbH',securityCode:'NVrTbH',signedAt:'13-10-2026 18:00:00'};
  const before=[f.read('transactions'),f.read('transactionHistory'),f.read('outbox')];
  f.sql.exec(`CREATE TRIGGER fail_print_history BEFORE UPDATE ON documents WHEN NEW.collection_name='transactionHistory' BEGIN SELECT RAISE(ABORT,'injected-print-write'); END;`);
  await assert.rejects(()=>f.worker.appendPrintEvidence('27',f.proof),/injected-print-write/);
  assert.deepEqual([f.read('transactions'),f.read('transactionHistory'),f.read('outbox')],before);
 }finally{f.sql.close();}
});

test('actual late fiscal callback never writes or republishes durable closed sale into active storage',async()=>{
 const {transform}=await import('esbuild'),source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const publish=source.slice(source.indexOf('const publishFiscalTransaction ='),source.indexOf('const loadFiscalStatusContext ='));
 const upsert=source.slice(source.indexOf('const upsertFiscalTransaction ='),source.indexOf('const correctFiscalDocument ='));
 const code=(await transform(publish+upsert,{loader:'ts'})).code;
 const create=new Function('f',`const {setTransactions,window,db,dbAdapter,LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,getLargeMasterSyncV3OperationalSession,console,closedFiscalPublicationIds,isTransactionReservedForClose}=f;const useCallback=(fn)=>fn;${code}return upsertFiscalTransaction;`);
 let rows:any[]=[{id:'closed'}],writes=0;
 const callback=create({setTransactions:(update:any)=>{rows=update(rows);},window:{dispatchEvent:()=>{}},db:{getDocument:async()=>null,saveDocument:async()=>{writes++;}},dbAdapter:{},
  LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:true,getLargeMasterSyncV3OperationalSession:()=>{throw Error('must not issue');},console,
  closedFiscalPublicationIds:{current:new Set(['closed'])},isTransactionReservedForClose:()=>false});
 await callback({id:'closed',v3InventoryBaseline:'source',fiscalSyncStatus:'SYNCED'});assert.deepEqual(rows,[]);assert.equal(writes,0);
 await assert.rejects(()=>callback({id:'unknown-missing',v3InventoryBaseline:'source'}),/ARCHIVED_RECONCILIATION_REQUIRED/);assert.equal(writes,0);
});

// Reproduction before the Caja 6 fix: a live session is blocked by historical binding expiry.
test('Caja 6 status GET accepts live session with historical device binding expiry without changing expiry',async()=>{
 const f=await fixture(true),identity={...caja6Identity,erpSyncBaseUrl:'https://erp.test/api/sync',deviceId:'device',syncToken:'live-session'};
 const credentials={...identity,deviceToken:'authorized-device',deviceTokenSource:'ERP_REGISTER',authStatus:'AUTHENTICATED',syncTokenExpiresAt:'2099-01-01T00:00:00Z',deviceTokenExpiresAt:'2020-01-01T00:00:00Z'};
 const before=structuredClone(credentials);let calls=0;
 await getScopedFiscalDocumentStatus(f.tx,f.scope,()=>identity,async(_url,init)=>{calls++;assert.equal(init?.method,'GET');return{ok:true,json:async()=>f.proof} as Response;},()=>credentials, true);
 assert.equal(calls,1);assert.deepEqual(credentials,before);
});
test('Caja 6 rejected original updates both native copies using status metadata CAS',async()=>{
 const f=await native(true);try{
  f.proof.decision='REJECTED';f.proof.providerReceipt.status='Rechazado';f.proof.providerReceipt.success=false;
  f.deps.publish=()=>{};
  await f.worker.consult('27',true,undefined,undefined,true);
  assert.equal(f.read('transactions').fiscalSyncStatus,'ERROR');assert.equal(f.read('transactionHistory').fiscalSyncStatus,'ERROR');
 }finally{f.sql.close();}
});

async function manualButton(worker:FiscalStatusReconciler){
 const {transform}=await import('esbuild');const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const start=source.indexOf('async (transaction: Transaction): Promise<string> => {',source.indexOf('const retryFiscalDocument ='));
 const end=source.indexOf('}, [config, pollFiscalDocumentStatus, syncFiscalDocument, upsertFiscalTransaction, fiscalStatusWorker]);',start);
 assert.ok(start>0&&end>start);
 const code=(await transform('const callback='+source.slice(start,end+1)+';',{loader:'ts'})).code;
 return new Function('fiscalStatusWorker',`const forbidden=()=>{throw Error('EMISSION_FORBIDDEN');};const syncFiscalDocument=forbidden,issueFiscalDocument=forbidden,consumeFiscalClassificationAttempt=forbidden,upsertFiscalTransaction=forbidden;${code}return callback;`)(worker);
}
async function manualFixture(alternateScope=false){
 const f=await native(alternateScope),button=await manualButton(f.worker);
 const identity={erpSyncBaseUrl:'https://erp.test/api/sync',tenantId:f.scope.tenantId,terminalId:f.scope.terminalId,deviceId:f.scope.deviceId,syncToken:'live-session'};
 const credentials={...identity,companyId:f.scope.companyId,storeId:f.scope.storeId,deviceToken:'authorized-device',deviceTokenSource:'ERP_REGISTER',authStatus:'AUTHENTICATED',
  syncTokenExpiresAt:'2099-01-01T00:00:00Z',deviceTokenExpiresAt:'2020-01-01T00:00:00Z'};
 // A real active contract-2 catalog is required by the local read-only context.
 f.sql.exec("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES('S2',2,3,2,'ACTIVE','{}','now','now');");
 const state:any={opens:0,origin:'https://erp.test',native:true,forbidden:[],adapter:{supportsV3FiscalMetadataCAS:true,
  saveDocumentsAtomically:(mutations:any)=>f.adapter.saveDocumentsAtomically(mutations),
  connect:()=>{throw Error('FORBIDDEN_CONNECT');},
  masterSyncV3Store:new Proxy(f.adapter.masterSyncV3Store,{get:(store,key)=>{
   if(key==='getActiveRuntimeVersion'||key==='getOperationalOwner')return (store as any)[key].bind(store);
   state.forbidden.push(String(key));throw Error('FORBIDDEN_STORE_OPERATION:'+String(key));
  }})}};
 f.deps.context=await actualAppStatusContext({...f,identity,credentials},state);
 const beforeCredentials=structuredClone(credentials),requests:{url:string;method:string}[]=[];
 let respond=async()=>({ok:true,status:200,json:async()=>f.proof}) as Response;
 f.deps.get=(tx,scope,originalOnly)=>getScopedFiscalDocumentStatus(tx,scope,()=>identity,async(url,init)=>{
  const parsed=new URL(String(url));requests.push({url:parsed.pathname,method:init!.method!});
  assert.equal(init?.method,'GET');assert.equal(parsed.pathname,'/api/sync/v3/fiscal/documents/status');
  assert.equal(parsed.searchParams.get('sourceTransactionId'),tx.id);assert.equal(init.headers['X-Device-Token'],credentials.deviceToken);
  return respond();
 },()=>credentials,originalOnly);
 f.deps.publish=()=>{};
 const snapshot=()=>['transactions','transactionHistory','outbox'].map(name=>f.read(name));
 const before=snapshot(),count=Number(f.sql.prepare('SELECT COUNT(*) AS count FROM documents').get()!.count);
 return {...f,button,identity,credentials,state,requests,before,beforeCredentials,snapshot,
  respond:(callback:()=>Promise<Response>)=>{respond=callback;},
  unchanged:()=>{assert.deepEqual(snapshot(),before);assert.deepEqual(credentials,beforeCredentials);},
  noDuplicatesOrIssue:()=>{assert.equal(state.opens,0);assert.deepEqual(state.forbidden,[]);assert.equal(Number(f.sql.prepare('SELECT COUNT(*) AS count FROM documents').get()!.count),count);assert.ok(requests.every(req=>req.method==='GET'&&req.url.endsWith('/documents/status')));assert.deepEqual(f.read('outbox'),before[2]);},
 };
}
for(const alternate of [false,true])for(const decision of ['ACCEPTED','REJECTED','PENDING'] as const)test(`manual button ${decision}, alternate terminal/company=${alternate}: GET only, original/history and immutable financial data`,async()=>{
 const f=await manualFixture(alternate);try{
  f.proof.decision=decision;if(decision!=='ACCEPTED'){f.proof.providerReceipt.success=false;f.proof.providerReceipt.pending=decision==='PENDING';f.proof.providerReceipt.status=decision==='REJECTED'?'Rechazado':'Pendiente';}
  const message=await f.button({...f.tx,items:[],payments:[],total:999}); // stale UI must never be the persisted source
  assert.equal(f.requests.length,1);
  for(const [index,collection]of ['transactions','transactionHistory'].entries()){
   const row=f.read(collection),before=f.before[index];
   assert.equal(row.fiscalSyncStatus,decision==='ACCEPTED'?'SYNCED':decision==='REJECTED'?'ERROR':'PENDING');
   for(const key of ['id','displayId','ncf','electronicNcf','ncfType','date','terminalId','customerId','customerSnapshot','items','payments','total','netAmount','taxAmount','taxBreakdown','v3CommitFingerprint','v3InventoryBaseline','fiscalSubmissionScope','fiscalClassificationProjection','fiscalClassificationAttemptedAt','fiscalPreSubmitRecoveryAudit'])assert.deepEqual(row[key],before[key],key);
   if(decision!=='PENDING')assert.deepEqual(row.fiscalStatusProof,f.proof);
  }
  if(decision==='PENDING'){assert.match(message,/continúa pendiente/);f.unchanged();}
  if(decision==='REJECTED')assert.match(message,/rechazado/);
  if(decision==='ACCEPTED'){assert.match(message,/aceptado/);await f.button(f.tx);assert.equal(f.requests.length,1);}
  assert.deepEqual(f.credentials,f.beforeCredentials);f.noDuplicatesOrIssue();
 }finally{f.sql.close();}
});
for(const scenario of ['network','session-expired','session-missing','unauthorized-device','server-session-expired','server-device-revoked','scope-changed','response-scope','response-document','reference-mismatch','missing-scope','never-sent','invalid-json','write-error'] as const)test(`manual button ${scenario}: preserves original/history and reports reason, no ISSUE/duplicates`,async()=>{
 const f=await manualFixture();try{
  let expectedRequests=1;
  if(scenario==='network')f.respond(async()=>{throw new TypeError('Failed to fetch');});
  if(scenario==='session-expired'){f.credentials.syncTokenExpiresAt='2020-01-01T00:00:00Z';expectedRequests=0;}
  if(scenario==='session-missing'){f.credentials.syncTokenExpiresAt='';expectedRequests=0;}
  if(scenario==='unauthorized-device'){f.credentials.authStatus='DEVICE_NOT_AUTHORIZED';expectedRequests=0;}
  if(scenario==='server-session-expired'||scenario==='server-device-revoked')f.respond(async()=>({ok:false,status:scenario==='server-session-expired'?401:403,json:async()=>({code:'AUTH_REQUIRED'})}) as Response);
  if(scenario==='scope-changed'){f.credentials.storeId='foreign';expectedRequests=0;}
  if(scenario==='response-scope')f.proof.scope.tenantId='foreign';
  if(scenario==='response-document')f.proof.document.sourceTransactionId='another-document';
  if(['reference-mismatch','missing-scope','never-sent'].includes(scenario)){
   const row=f.read('transactions');
   if(scenario==='reference-mismatch')row.fiscalReferenceId='different-original';
   if(scenario==='missing-scope')delete row.fiscalSubmissionScope;
   if(scenario==='never-sent'){delete row.fiscalProviderStatus;delete row.fiscalClassificationAttemptedAt;}
   f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='transactions'").run(JSON.stringify(row));f.before[0]=row;
   if(scenario!=='reference-mismatch')expectedRequests=0;
  }
  if(scenario==='invalid-json')f.respond(async()=>new Response('invalid json',{status:200}));
  if(scenario==='write-error')f.sql.exec("CREATE TRIGGER fail_status_history BEFORE UPDATE ON documents WHEN NEW.collection_name='transactionHistory' BEGIN SELECT RAISE(ABORT,'injected-status-write'); END;");
  const beforeCredentials=structuredClone(f.credentials),message=await f.button(f.tx);
  assert.match(message,/conserva|conservó/i);assert.equal(f.requests.length,expectedRequests);assert.deepEqual(f.snapshot(),f.before);assert.deepEqual(f.credentials,beforeCredentials);f.noDuplicatesOrIssue();
 }finally{f.sql.close();}
});
test('manual button repeated presses share one status GET and one atomic metadata batch',async()=>{
 const f=await manualFixture();let release!:()=>void,started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
 const barrier=new Promise<void>(resolve=>{release=resolve;});
 f.respond(async()=>{started();await barrier;return{ok:true,status:200,json:async()=>f.proof} as Response;});
 let commits=0;const commit=f.deps.commit;f.deps.commit=async mutations=>{commits++;await commit(mutations);};
 try{
  const presses=Array.from({length:20},()=>f.button(f.tx));await entered;assert.equal(f.requests.length,1);release();
  const messages=await Promise.all(presses);assert.equal(new Set(messages).size,1);assert.equal(f.requests.length,1);assert.equal(commits,1);f.noDuplicatesOrIssue();
 }finally{f.sql.close();}
});
test('historical binding expiry still blocks the unchanged ISSUE context',async()=>{
 const {captureFiscalBoundContext}=await import('../services/fiscal/FiscalBoundContext');const f=await manualFixture();
 try{assert.throws(()=>captureFiscalBoundContext(()=>f.identity,()=>f.credentials),/AUTH_REQUIRED/);assert.deepEqual(f.credentials,f.beforeCredentials);f.noDuplicatesOrIssue();}finally{f.sql.close();}
});
for(const decision of ['ACCEPTED','REJECTED'] as const)test(`native ${decision} status metadata cannot change financial data or fiscal identity`,async()=>{
 const f=await manualFixture();try{
  f.proof.decision=decision;if(decision==='REJECTED')Object.assign(f.proof.providerReceipt,{status:'Rechazado',success:false,pending:false});
  let mutations:any[]=[];f.deps.commit=async rows=>{mutations=rows;};await f.button(f.tx);assert.equal(mutations.length,2);
  for(const patch of [{total:1},{ncf:'E3200009999'},{payments:[]},{fiscalClassificationAttemptedAt:'changed'}]){
   const invalid=mutations.map(row=>({...row,document:{...row.document,...patch}}));
   await assert.rejects(()=>f.adapter.saveDocumentsAtomically(invalid),/METADATA_MUTATION_DENIED/);f.unchanged();
  }
 }finally{f.sql.close();}
});

for(const change of ['session','device','scope','historical-expiry','history-reference'] as const)test(`manual GET delayed ${change} change holds both SQLite copies`,async()=>{
 const f=await manualFixture();try{
  f.respond(async()=>{
   if(change==='session')f.credentials.syncTokenExpiresAt='2020-01-01';
   if(change==='device')f.identity.deviceId='foreign-device';
   if(change==='scope')f.credentials.companyId='foreign-company';
   if(change==='historical-expiry')f.credentials.deviceTokenExpiresAt='2021-01-01';
   if(change==='history-reference'){
    const history={...f.read('transactionHistory'),fiscalReferenceId:'different-original'};
    f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='transactionHistory'").run(JSON.stringify(history));f.before[1]=history;
   }
   return{ok:true,status:200,json:async()=>f.proof} as Response;
  });
  assert.match(await f.button(f.tx),/conserva/i);assert.deepEqual(f.snapshot(),f.before);f.noDuplicatesOrIssue();
 }finally{f.sql.close();}
});

// Corrective iteration P1/P3: these regressions are run before implementation.
for(const source of ['ERP_REGISTER','ERP_REGISTER_REAUTH','ERP_REGISTER_REFRESH','ERP_AUTH_REAUTH','ERP_AUTH_REFRESH'])test(`manual status accepts exact legitimate ERP source ${source}`,()=>{
 const identity={erpSyncBaseUrl:'https://erp.test/api/sync',tenantId:'tenant',terminalId:'terminal',deviceId:'device',syncToken:'live-session'};
 const credentials={...identity,companyId:'company',storeId:'store',deviceToken:'authorized-device',deviceTokenSource:source,authStatus:'AUTHENTICATED',syncTokenExpiresAt:'2099-01-01T00:00:00Z',deviceTokenExpiresAt:'2020-01-01T00:00:00Z'};
 const before=structuredClone(credentials);
 assert.doesNotThrow(()=>captureFiscalStatusBoundContext(()=>identity,()=>credentials));
 assert.deepEqual(credentials,before);
 assert.throws(()=>captureFiscalBoundContext(()=>identity,()=>credentials),/AUTH_REQUIRED/);
 if(source!=='ERP_REGISTER')assert.throws(()=>captureFiscalBoundContext(()=>identity,()=>({...credentials,deviceTokenExpiresAt:'2099-01-01T00:00:00Z'})),/AUTH_REQUIRED/);
});
async function actualAppStatusContext(f:any,state:any){
 const {transform}=await import('esbuild'),source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const start=source.indexOf('const loadFiscalStatusContext ='),end=source.indexOf('const fiscalStatusWorker =',start);
 assert.ok(start>0&&end>start);
 const code=(await transform(source.slice(start,end),{loader:'ts'})).code;
 const configStart=source.indexOf('const resolvePersistedBusinessConfig ='),configEnd=source.indexOf('const normalizeTerminalDocumentAssignments =',configStart);
 const configCode=(await transform(source.slice(configStart,configEnd),{loader:'ts'})).code;
 const deps={db:{get:async()=>f.read('config')},dbAdapter:state.adapter,
  getLargeMasterSyncV3OperationalSession:async()=>{state.opens++;throw Error('FORBIDDEN_BOOTSTRAP_POST');},
  captureFiscalStatusBoundContext:()=>captureFiscalStatusBoundContext(()=>f.identity,()=>f.credentials),
  readLargeMasterSyncV3BoundIdentity:()=>f.identity,largeMasterSyncV3DownloadOrigin:()=>state.origin,
  assertLargeMasterSyncV3NativeAndroid:()=>{if(!state.native)throw Error('SYNC_V3_NATIVE_ANDROID_REQUIRED');},
  v3BindingKey,getEffectiveFiscalComplianceConfig,getProviderEnvironment};
 return new Function('f',`const {${Object.keys(deps).join(',')}}=f;const useCallback=(fn)=>fn;${configCode}${code}return loadFiscalStatusContext;`)(deps);
}
test('actual App manual cold context never opens operational session/bootstrap',async()=>{
 const f=await manualFixture();try{
  const state={opens:0,origin:'https://erp.test',native:true,adapter:{supportsV3FiscalMetadataCAS:true,saveDocumentsAtomically:async()=>{throw Error('FORBIDDEN_WRITE');}}};
  const load=await actualAppStatusContext(f,state);let error:unknown;
  try{await load(true);}catch(cause){error=cause;}
  assert.equal(state.opens,0,'manual status must not call operationalSession.open (cold path performs POST/bootstrap)');
  assert.match(String(error),/FISCAL_STATUS_(?:NATIVE_REQUIRED|LOCAL_CONTEXT_REQUIRED)/);f.unchanged();assert.equal(f.requests.length,0);
 }finally{f.sql.close();}
});

for(const source of ['LEGACY','LOCAL','ERP_REGISTER_FORGED','ERP_REGISTER_REAUTH_EXTRA','ERP_AUTH','UNKNOWN',''])test(`manual status rejects untrusted credential source ${source}`,()=>{
 const identity={erpSyncBaseUrl:'https://erp.test/api/sync',tenantId:'tenant',terminalId:'terminal',deviceId:'device',syncToken:'live-session'};
 const credentials={...identity,companyId:'company',storeId:'store',deviceToken:'authorized-device',deviceTokenSource:source,authStatus:'AUTHENTICATED',syncTokenExpiresAt:'2099-01-01T00:00:00Z',deviceTokenExpiresAt:'2020-01-01T00:00:00Z'};
 assert.throws(()=>captureFiscalStatusBoundContext(()=>identity,()=>credentials),/AUTH_REQUIRED/);
});
for(const missing of ['store','runtime','owner','owner-binding','owner-version','runtime-contract','cas','native'] as const)test(`actual App manual context ${missing} fails closed without requests/bootstrap/writes`,async()=>{
 const f=await manualFixture();try{
  if(missing==='store')f.state.adapter.masterSyncV3Store=undefined;
  if(missing==='runtime')f.sql.exec('UPDATE master_v3_state SET active_sync_id=NULL,active_version=NULL');
  if(missing==='owner')f.sql.exec('DELETE FROM master_v3_operational_owner');
  if(missing==='owner-binding')f.sql.exec("UPDATE master_v3_operational_owner SET binding='foreign'");
  if(missing==='owner-version')f.sql.exec('UPDATE master_v3_operational_owner SET sync_version=999');
  if(missing==='runtime-contract')f.sql.exec('UPDATE sync_v3_sessions SET contract_version=1');
  if(missing==='cas')f.state.adapter.supportsV3FiscalMetadataCAS=false;
  if(missing==='native')f.state.native=false;
  const before=JSON.stringify(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row:any)=>[row.name,f.sql.prepare('SELECT * FROM '+row.name).all()]));
  const message=await f.button(f.tx);assert.match(message,/contexto local autorizado|preparación/);assert.equal(f.requests.length,0);f.unchanged();f.noDuplicatesOrIssue();
  const after=JSON.stringify(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row:any)=>[row.name,f.sql.prepare('SELECT * FROM '+row.name).all()]));assert.equal(after,before);
 }finally{f.sql.close();}
});
for(const source of ['ERP_REGISTER_REAUTH','ERP_REGISTER_REFRESH','ERP_AUTH_REAUTH','ERP_AUTH_REFRESH'])test(`real App context recovered source ${source} completes original GET and native CAS`,async()=>{
 const f=await manualFixture();try{
  f.credentials.deviceTokenSource=source;const before=structuredClone(f.credentials);
  assert.match(await f.button(f.tx),/aceptado/);assert.equal(f.requests.length,1);assert.equal(f.read('transactions').fiscalSyncStatus,'SYNCED');
  assert.deepEqual(f.credentials,before);f.noDuplicatesOrIssue();
 }finally{f.sql.close();}
});
for(const change of ['auth-source','session-token','erp-base','download-origin','owner-binding','owner-version','runtime-version','runtime-contract',
 'config-tenant','config-company','config-store','config-terminal','config-device','config-rnc','config-environment'] as const)test(`real App context delayed ${change} blocks metadata commit`,async()=>{
 const f=await manualFixture();try{
  f.respond(async()=>{
   if(change==='auth-source')f.credentials.deviceTokenSource='ERP_REGISTER_REFRESH';
   if(change==='session-token'){f.identity.syncToken='new-token';f.credentials.syncToken='new-token';}
   if(change==='erp-base')f.identity.erpSyncBaseUrl='https://other.test/api/sync';
   if(change==='download-origin')f.state.origin='https://other.test';
   if(change==='owner-binding')f.sql.exec("UPDATE master_v3_operational_owner SET binding='foreign'");
   if(change==='owner-version')f.sql.exec('UPDATE master_v3_operational_owner SET sync_version=3');
   if(change==='runtime-version')f.sql.exec('UPDATE master_v3_state SET active_version=3');
   if(change==='runtime-contract')f.sql.exec('UPDATE sync_v3_sessions SET contract_version=3');
   if(change.startsWith('config-')){
    const config=f.read('config'),terminal=config.terminals[0];
    if(change==='config-tenant')terminal.config.erpBinding.tenantId='foreign';
    if(change==='config-company')terminal.config.erpBinding.companyId='foreign';
    if(change==='config-store')terminal.config.erpBinding.storeId='foreign';
    if(change==='config-terminal')terminal.id='foreign';
    if(change==='config-device')terminal.config.currentDeviceId='foreign';
    if(change==='config-rnc')config.companyInfo.rnc='999999999';
    if(change==='config-environment')config.fiscalCompliance.providers[0].environment=2;
    f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='config'").run(JSON.stringify(config));
   }
   return {ok:true,status:200,json:async()=>f.proof} as Response;
  });
  assert.match(await f.button(f.tx),/conserva/i);assert.deepEqual(f.snapshot(),f.before);assert.equal(f.requests.length,1);f.noDuplicatesOrIssue();
 }finally{f.sql.close();}
});
test('App context keeps the existing operational-session default for automatic/other callers',async()=>{
 const f=await manualFixture();try{
  await assert.rejects(()=>f.deps.context(),/FORBIDDEN_BOOTSTRAP_POST/);assert.equal(f.state.opens,1);
  await assert.rejects(()=>f.deps.context(false),/FORBIDDEN_BOOTSTRAP_POST/);assert.equal(f.state.opens,2);f.unchanged();
 }finally{f.sql.close();}
});

for(const change of ['config','owner','runtime'] as const)test(`real App context ${change} change after source read blocks the status request`,async()=>{
 const f=await manualFixture();try{
  const pair=f.deps.pair;
  f.deps.pair=async(id)=>{
   const result=await pair(id);
   if(change==='config'){const config=f.read('config');config.companyInfo.rnc='999999999';f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='config'").run(JSON.stringify(config));}
   if(change==='owner')f.sql.exec("UPDATE master_v3_operational_owner SET binding='foreign'");
   if(change==='runtime')f.sql.exec('UPDATE master_v3_state SET active_version=3');
   return result;
  };
  assert.match(await f.button(f.tx),/conserva/i);assert.equal(f.requests.length,0);assert.deepEqual(f.snapshot(),f.before);f.noDuplicatesOrIssue();
 }finally{f.sql.close();}
});
