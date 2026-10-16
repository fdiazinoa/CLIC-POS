import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {FiscalStatusReconciler,type FiscalStatusDependencies} from '../services/fiscal/FiscalStatusReconciler';
import {fiscalStatusSourceChecksum,verifyFiscalStatusProof,type FiscalStatusScope,type FiscalStatusProof} from '../services/fiscal/FiscalStatusProof';
import {attachFiscalStatusLifecycle} from '../services/fiscal/FiscalStatusLifecycle';
import {getScopedFiscalDocumentStatus} from '../services/fiscal/FiscalScopedStatusTransport';
import {LARGE_MASTER_SYNC_V3_SCHEMA_SQL} from '../services/db/LargeMasterSyncV3Schema';
import {CapacitorSQLiteAdapter} from '../services/db/adapters/CapacitorSQLiteAdapter';

async function fixture(){
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
 return{tx,history,scope,proof};
}
async function native(){
 const f=await fixture(),sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));');sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
 sql.prepare("INSERT INTO master_v3_operational_owner VALUES(1,'S2',2,?)").run(f.scope.binding);
 sql.exec("UPDATE master_v3_state SET active_sync_id='S2',active_version=2;INSERT INTO master_v3_inventory_state VALUES(1,'S1',1,1,'C','now');");
 for(const [sync,version] of [['S1',1],['S2',2]])sql.prepare('INSERT INTO master_v3_catalog_owners VALUES(?,?,?,?,?,?,?)').run(sync,version,f.scope.binding,'S1',1,1,'C');
 const config={id:'current',companyInfo:{rnc:'130090752'},terminals:[{id:'terminal',config:{currentDeviceId:'device',erpBinding:{tenantId:'tenant',companyId:'company',storeId:'store'}}}],fiscalCompliance:{providers:[{id:'MSELLER',environment:0}]}};
 for(const [collection,row] of [['transactions',f.tx],['transactionHistory',f.history],['config',config],['outbox',{id:'event',status:'PENDING'}]])sql.prepare('INSERT INTO documents(collection_name,doc_id,data) VALUES(?,?,?)').run(collection,row.id,JSON.stringify(row));
 const bridge={query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>sql.prepare(q).run(...v),execute:async(q:string)=>{sql.exec(q);}};
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});
 const read=(collection:string)=>JSON.parse(String(sql.prepare('SELECT data FROM documents WHERE collection_name=?').get(collection)?.data));
 let gets=0,publishes=0,now=100000,valid=true;
 const context={scope:{providerId:'MSELLER' as const,environment:0,issuerRnc:'130090752',tenantId:'tenant',companyId:'company',terminalId:'terminal',deviceId:'device',storeId:'store',binding:f.scope.binding},
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
 const f=await fixture(),identity={erpSyncBaseUrl:'https://erp.test/api/sync',tenantId:'tenant',terminalId:'terminal',deviceId:'device',syncToken:'test-token'};let method='',calls=0;
 const response=await getScopedFiscalDocumentStatus(f.tx,f.scope,()=>identity,async(url:any,init:any)=>{
  calls++;method=init.method;assert.equal(init.headers['X-Sync-Token'],'test-token');const parsed=new URL(url);assert.equal(parsed.pathname,'/api/sync/v3/fiscal/documents/status');
  assert.equal(JSON.parse(parsed.searchParams.get('scopeAssertion')!).sourceChecksum,f.scope.sourceChecksum);
  return{ok:true,json:async()=>f.proof} as Response;
 });assert.strictEqual(response,f.proof);assert.equal(method,'GET');assert.equal(calls,1);
 let reads=0;await assert.rejects(()=>getScopedFiscalDocumentStatus(f.tx,f.scope,()=>++reads===1?identity:{...identity,deviceId:'changed'},async()=>({ok:true,json:async()=>f.proof}) as Response),/SCOPE_CHANGED/);
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
 const context={scope:{providerId:'MSELLER' as const,environment:0,issuerRnc:'130090752',tenantId:'tenant',companyId:'company',terminalId:'terminal',deviceId:'device',storeId:'store',binding:f.scope.binding},
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
test('actual App manual callback requires displayed environment confirmation before creating a lookup approval',async()=>{
 const {transform}=await import('esbuild');const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const start=source.indexOf('async(transaction:Transaction):Promise<string>=> {',source.indexOf('const consultFiscalStatus ='));
 const end=source.indexOf('},[fiscalStatusWorker,currentUser?.id,loadFiscalStatusContext]);',start);
 assert.ok(start>0&&end>start);const code=(await transform('const callback='+source.slice(start,end+1)+';',{loader:'ts'})).code;
 const create=new Function('db','fiscalStatusWorker','currentUser','loadFiscalStatusContext','window',code+'return callback;');
 const f=await fixture();delete f.tx.fiscalSubmissionScope;let calls=0,approval:any,message='';
 const worker={consult:async(...args:any[])=>{calls++;approval=args;return'GET-only';}};
 const run=(answer:boolean)=>create({getDocument:async()=>f.tx},worker,{id:'U'},async()=>({scope:{environment:0}}),{confirm:(text:string)=>{message=text;return answer;}})(f.tx);
 assert.match(await run(false),/cancelada/);assert.equal(calls,0);assert.match(message,/TesteCF \(0\)/);
 assert.equal(await run(true),'GET-only');assert.equal(calls,1);assert.deepEqual(approval,['27',true,'U',0]);
 f.tx.fiscalLookupApproval={protected:'already-approved'};await run(false);assert.equal(calls,2);assert.deepEqual(approval,['27',true,'U',undefined]);
});
test('actual existing authorized App issue captures intent through native CAS before exactly one mock issue, preserving source/outbox',async()=>{
 const {transform}=await import('esbuild');const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const start=source.indexOf('async (transaction: Transaction,',source.indexOf('const syncFiscalDocument ='));
 const end=source.indexOf('}, [config, pollFiscalDocumentStatus, upsertFiscalTransaction, loadFiscalStatusContext]);',start);assert.ok(start>0&&end>start);
 const code=(await transform('const callback='+source.slice(start,end+1)+';',{loader:'ts'})).code;
 const create=new Function('f',`const {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,v3FiscalInFlightRef,config,db,dbAdapter,getLargeMasterSyncV3OperationalSession,validateV3FrozenFiscalAmounts,validateV3FrozenLineFiscalAmounts,getEffectiveFiscalComplianceConfig,getProviderEnvironment,getFiscalProviderConfig,getExistingFiscalProviderReference,pollFiscalDocumentStatus,resolveFiscalProviderEstablishmentCode,resolveFiscalProviderCashierCode,calculateTransactionFiscalSummary,buildV3FrozenFiscalProviderTransaction,upsertFiscalTransaction,issueFiscalDocument,applyFiscalProviderResult,isDelegatedFiscalProvider,window,loadFiscalStatusContext,fiscalStatusSourceChecksum}=f;${code}return callback;`);
 const f=await native();try{
  const original=f.read('transactions');for(const key of ['fiscalSubmissionScope','fiscalProviderStatus','fiscalClassificationAttemptedAt','fiscalClassificationProjection','fiscalPreSubmitRecoveryAudit'])delete original[key];
  f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='transactions'").run(JSON.stringify(original));
  let issues=0;const context=await f.deps.context();
  const sync=create({LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:true,v3FiscalInFlightRef:{current:new Map()},config:{terminals:[],companyInfo:{rnc:'130090752'}},
   db:{getDocument:async()=>f.read('transactions')},dbAdapter:f.adapter,getLargeMasterSyncV3OperationalSession:async()=>({assertCurrent:async()=>{},projectConfig:async()=>({terminals:[]}),validate:async()=>undefined}),
   validateV3FrozenFiscalAmounts:()=>{},validateV3FrozenLineFiscalAmounts:()=>{},getEffectiveFiscalComplianceConfig:()=>({}),getProviderEnvironment:()=>0,getFiscalProviderConfig:()=>({}),getExistingFiscalProviderReference:(row:any)=>row.fiscalReferenceId,
   pollFiscalDocumentStatus:async()=>{},resolveFiscalProviderEstablishmentCode:()=>undefined,resolveFiscalProviderCashierCode:()=>undefined,calculateTransactionFiscalSummary:()=>{throw Error('legacy forbidden');},
   buildV3FrozenFiscalProviderTransaction:(row:any)=>row,upsertFiscalTransaction:async(row:any)=>f.adapter.saveDocument('transactions',row),
   issueFiscalDocument:async(input:any)=>{issues++;const stored=f.read('transactions');assert.equal(stored.fiscalSubmissionScope.environment,0);assert.equal(stored.fiscalSubmissionScope.basis,'PERSISTED_SUBMISSION_INTENT');assert.deepEqual(stored.fiscalSubmissionScope,input.transaction.fiscalSubmissionScope);return{success:false,pending:true};},
   applyFiscalProviderResult:(row:any)=>row,isDelegatedFiscalProvider:()=>true,window:{setTimeout:()=>{}},loadFiscalStatusContext:async()=>context,fiscalStatusSourceChecksum});
  await sync(original);assert.equal(issues,1);const final=f.read('transactions');for(const key of ['items','payments','ncf','electronicNcf','total','v3CommitFingerprint'])assert.deepEqual(final[key],original[key]);
  assert.deepEqual(f.read('outbox'),{id:'event',status:'PENDING'});await sync(original);assert.equal(issues,1);
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
 const create=new Function('f',`const {setTransactions,window,db,dbAdapter,LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,getLargeMasterSyncV3OperationalSession,console}=f;const useCallback=(fn)=>fn;${code}return upsertFiscalTransaction;`);
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
