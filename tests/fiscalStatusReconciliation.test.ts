import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {FiscalStatusReconciler,type FiscalStatusDependencies} from '../services/fiscal/FiscalStatusReconciler';
import {fiscalStatusSourceChecksum,verifyFiscalStatusProof,type FiscalStatusScope,type FiscalStatusProof} from '../services/fiscal/FiscalStatusProof';
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

test('actual hydration/online/successful-sync lifecycle registers only ready state, coalesces timestamp events and disposes',async()=>{
 const {attachFiscalStatusLifecycle}=await import('../services/fiscal/FiscalStatusLifecycle');let runs=0,disposes=0,online=true;
 let onOnline:(()=>void)|undefined,onSync:((state:any)=>void)|undefined;
 const worker={runAutomatic:async()=>{runs++;},dispose:()=>{disposes++;}};
 const options={hydrated:false,online:()=>online,addOnline:(listener:()=>void)=>{onOnline=listener;},removeOnline:()=>{onOnline=undefined;},syncTime:null,
  subscribe:(listener:(state:any)=>void)=>{onSync=listener;return()=>{onSync=undefined;};}};
 attachFiscalStatusLifecycle(worker,options)();assert.equal(runs,0);assert.equal(onOnline,undefined);
 const cleanup=attachFiscalStatusLifecycle(worker,{...options,hydrated:true});assert.equal(runs,1);
 onSync!({lastSyncTime:'successful',isSyncing:false,hasError:false});assert.equal(runs,2);
 onSync!({lastSyncTime:'successful',isSyncing:false,hasError:false});onSync!({lastSyncTime:'failed',isSyncing:false,hasError:true});assert.equal(runs,2);
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
