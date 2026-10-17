import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {transform} from 'esbuild';
import {CapacitorSQLiteAdapter} from '../services/db/adapters/CapacitorSQLiteAdapter';
import {FiscalStatusReconciler} from '../services/fiscal/FiscalStatusReconciler';
import {fiscalStatusSourceChecksum} from '../services/fiscal/FiscalStatusProof';
import {captureFiscalBoundContext} from '../services/fiscal/FiscalBoundContext';
import {createMSellerDispatcher,FISCAL_DISPATCH_CLAIMS,requireFiscalErpAppliedReceipt} from '../services/fiscal/FiscalMSellerDispatch';

// Explicit synthetic readiness: ERP2259 supplies no corresponding production receipt/endpoint.
async function fixture(code='E32'){
 const directory=mkdtempSync(join(tmpdir(),'pos-fiscal-dispatch-')),file=join(directory,'fixture.sqlite');let sql=new DatabaseSync(file);
 let failWrite=0,writes=0,failAfterCommit=false;
 const adapter=new CapacitorSQLiteAdapter();
 const bridge={beginTransaction:async()=>{sql.exec('BEGIN IMMEDIATE');},commitTransaction:async()=>{sql.exec('COMMIT');},rollbackTransaction:async()=>{sql.exec('ROLLBACK');},isTransactionActive:async()=>({result:sql.isTransaction}),query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>{
  if(failWrite&&++writes===failWrite)throw Error('injected write');return sql.prepare(q).run(...v);},execute:async(q:string)=>{
   sql.exec(q);if(failAfterCommit&&q==='COMMIT;'){failAfterCommit=false;throw Error('injected lost commit ACK');}}};
 Object.assign(adapter,{db:bridge,isReady:true});await (adapter as any).initSchema();
 const identity={erpSyncBaseUrl:'http://localhost:1/api/sync',tenantId:'tenant',terminalId:'terminal',deviceId:'device',syncToken:'sync-fixture-only'};
 const credentials:any={...identity,erpTenantId:'tenant',erpTerminalId:'terminal',companyId:'company',storeId:'store',deviceToken:'device-fixture-only',deviceTokenSource:'ERP_REGISTER',authStatus:'ERP_ACTIVE'};
 const binding=JSON.stringify(['tenant','terminal','device','http://localhost:1/api/sync','http://localhost:1']);
 sql.prepare("INSERT INTO master_v3_operational_owner VALUES(1,'S',1,?)").run(binding);
 sql.exec("UPDATE master_v3_state SET active_sync_id='S',active_version=1;INSERT INTO master_v3_inventory_state VALUES(1,'S',1,1,'C','now');");
 const ncf=code+'0000000001',snapshot={schemaVersion:1,source:'POS_FISCAL_RESERVATION_V1',ncf,ncfType:code,sequence:1,prefix:code,
  fiscalRangeId:'ORIGINAL-RANGE',fiscalAllocationId:'ORIGINAL-ALLOC',rangeStart:1,rangeEnd:100,allocationStart:1,allocationEnd:10,
  expiryDate:null,issuerRnc:'130090752',tenantId:'tenant',companyId:'company',terminalId:'terminal',capturedAt:'2026-10-16T00:00:00Z'};
 const tx:any={id:'sale',terminalId:'terminal',date:'2026-10-16T00:00:00Z',ncfType:code,ncf,electronicNcf:ncf,fiscalIssuance:snapshot,
  v3Binding:binding,v3WarehouseId:'W',v3InventoryBaseline:JSON.stringify([binding,'S',1,1,'C']),v3CommitFingerprint:'frozen',fiscalProvider:'MSELLER',fiscalSyncStatus:'PENDING',customerSnapshot:{taxId:'101010101'},items:[{id:'water',quantity:1,price:118,v3SaleAuthority:{binding,syncId:'S',syncVersion:1,inventoryVersion:1,inventoryCursor:'C',warehouseId:'W',tariffId:'T'}}],payments:[{method:'CASH',amount:118}],netAmount:100,taxAmount:18,total:118};
 const config:any={id:'current',companyInfo:{rnc:'130090752'},terminals:[{id:'terminal',config:{currentDeviceId:'device',erpBinding:{tenantId:'tenant',companyId:'company',storeId:'store'}}}]};
 for(const [name,doc] of [['transactions',tx],['transactionHistory',tx],['config',config],['outbox',{id:'stable-event',status:'PENDING'}]])sql.prepare('INSERT INTO documents(collection_name,doc_id,data,updatedAt) VALUES(?,?,?,?)').run(name,(doc as any).id,JSON.stringify(doc),'now');
 const get=async(name:string,id:string)=>{const row=sql.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(name,id);return row?JSON.parse(String(row.data)):null;};
 const deps:any={catalog:async()=>({syncId:'S',syncVersion:1,binding}),assertReady:async()=>{},context:()=>captureFiscalBoundContext(()=>identity,()=>credentials),get,commit:async(rows:any[])=>adapter.saveDocumentsAtomically(rows),fetchImpl:fetch,timeoutMs:80};
 const input:any={providerId:'MSELLER',environment:0,transaction:tx,credentialKey:snapshot.issuerRnc,companyInfo:{name:'Synthetic',rnc:snapshot.issuerRnc},apiBaseUrl:'https://forbidden-provider.invalid',issueUrl:'https://forbidden.invalid'};
 return {input,deps,adapter,get,credentials,identity,sql:()=>sql,fail:(at:number)=>{failWrite=at;writes=0;},loseCommitAck:()=>{failAfterCommit=true;},
  restart:()=>{sql.close();sql=new DatabaseSync(file);},close:()=>{sql.close();rmSync(directory,{recursive:true,force:true});}};
}
async function http(f:any,handler:(req:any,res:any,body:string)=>void){
 const server=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>handler(req,res,body));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as any;
 f.identity.erpSyncBaseUrl=`http://localhost:${address.port}/api/sync`;
 return async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));};
}
for(const code of ['E31','E32','E34','E44','E45'])test(`${code} synthetic readiness: real SQLite claim precedes one bound HTTP POST, original body and null remain exact; success never accepts`,async()=>{
 const f=await fixture(code);let posts=0;const before=JSON.stringify(f.input.transaction);
 const stop=await http(f,(req,res,body)=>{posts++;assert.equal(req.url,'/api/fiscal/documents/issue');assert.equal(req.method,'POST');
  assert.equal(req.headers.authorization,'Bearer sync-fixture-only');assert.equal(req.headers['x-sync-token'],'sync-fixture-only');assert.equal(req.headers['x-device-token'],'device-fixture-only');
  assert.equal(req.headers['x-terminal-id'],'terminal');assert.equal(req.headers['x-device-id'],'device');assert.equal(req.headers['x-tenant-id'],'tenant');
  const claim=f.sql().prepare("SELECT data FROM documents WHERE collection_name='fiscalDispatchClaims'").get();assert.ok(claim);
  assert.doesNotMatch(String(claim.data),/sync-fixture-only|device-fixture-only/);
  const payload=JSON.parse(body);assert.deepEqual(payload.transaction,f.input.transaction);assert.deepEqual(payload.options.fiscalIssuance,f.input.transaction.fiscalIssuance);
  assert.equal(payload.options.sequenceExpiryDate,null);assert.equal(payload.options.fiscalRangeId,'ORIGINAL-RANGE');assert.equal(payload.options.fiscalAllocationId,'ORIGINAL-ALLOC');
  assert.equal(payload.options.deliveryMode,'DELEGATED_ERP');assert.equal(payload.options.credentialKey,'130090752');assert.doesNotMatch(body,/forbidden|authToken|apiKey/);
  res.setHeader('content-type','application/json');res.end(JSON.stringify({success:true,pending:false,status:'ACCEPTED',providerId:'MSELLER',environment:0,documentCode:code,eNCF:'FOREIGN'}));});
 try{const dispatch=createMSellerDispatcher(f.deps),result=await dispatch(f.input);assert.equal(result.pending,true);assert.equal(result.status,'PENDING');assert.equal(result.eNCF,undefined);
  for(const collection of ['transactions','transactionHistory']){const stored=await f.get(collection,'sale');assert.equal(stored.fiscalProviderStatus,'V3_ISSUE_REQUESTED');assert.equal(stored.fiscalSubmissionScope.sourceChecksum,await fiscalStatusSourceChecksum(f.input.transaction));delete stored.fiscalProviderStatus;delete stored.fiscalSubmissionScope;assert.equal(JSON.stringify(stored),before);}
  assert.deepEqual(await f.get('outbox','stable-event'),{id:'stable-event',status:'PENDING'});f.restart();
  await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);assert.equal(posts,1);
  for(const sql of ["DELETE FROM documents WHERE collection_name='fiscalDispatchClaims'","UPDATE documents SET data='{}' WHERE collection_name='fiscalDispatchClaims'","INSERT OR REPLACE INTO documents(collection_name,doc_id,data,updatedAt) VALUES('fiscalDispatchClaims','sale','{}','now')"])assert.throws(()=>f.sql().exec(sql),/UNKNOWN_GET_ONLY/);
 }finally{await stop();f.close();}
});
for(const at of [1,2,3,4])test(`native failure writing ${at} rolls back claim and source, zero POST`,async()=>{
 const f=await fixture();let posts=0;f.deps.fetchImpl=async()=>{posts++;throw Error('unexpected');};f.fail(at);const before=await f.get('transactions','sale');
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/injected write/);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,'sale'),null);assert.deepEqual(await f.get('transactions','sale'),before);assert.equal(posts,0);}finally{f.close();}
});
test('lost local COMMIT ACK retains claim before fetch, restart cannot POST',async()=>{
 const f=await fixture();let posts=0;f.deps.fetchImpl=async()=>{posts++;throw Error('unexpected');};f.loseCommitAck();
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/lost commit ACK/);f.restart();await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);assert.equal(posts,0);}finally{f.close();}
});
for(const mode of ['timeout','invalid','redirect','http-error','lost-ack'])test(`${mode}: one real HTTP attempt remains unknown across restart/retry, no fallback`,async()=>{
 const f=await fixture();let posts=0;const stop=await http(f,(_req,res)=>{posts++;if(mode==='timeout')return;if(mode==='lost-ack'){res.destroy();return;}
  if(mode==='redirect'){res.statusCode=307;res.setHeader('location','/fallback');res.end();return;}
  if(mode==='http-error')res.statusCode=503;res.end(mode==='invalid'?'not JSON':JSON.stringify({success:false,providerId:'MSELLER',environment:0,documentCode:'E32'}));});
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);f.restart();f.credentials.deviceToken='different';
  await assert.rejects(()=>createMSellerDispatcher(f.deps)({...f.input,environment:2}),/UNKNOWN_GET_ONLY/);assert.equal(posts,1);}finally{await stop();f.close();}
});
test('two concurrent native claimants produce at most one POST; independently created dispatcher cannot reclaim',async()=>{
 const f=await fixture();let posts=0;f.deps.fetchImpl=async()=>{posts++;return Response.json({success:true,providerId:'MSELLER',environment:0,documentCode:'E32'});};
 try{const results=await Promise.allSettled([createMSellerDispatcher(f.deps)(f.input),createMSellerDispatcher(f.deps)(f.input)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(posts,1);}finally{f.close();}
});
for(const evidence of ['APPLIED','APPLIED_ERP',{status:'APPLIED',count:1},{success:true,status:200}])test(`production insufficient receipt ${JSON.stringify(evidence)}: zero claim/POST`,async()=>{
 const f=await fixture();let posts=0;f.input.transaction.syncStatus=evidence;f.deps.assertReady=requireFiscalErpAppliedReceipt;f.deps.fetchImpl=async()=>{posts++;throw Error('unexpected');};
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/APPLIED_RECEIPT_REQUIRED/);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,'sale'),null);assert.equal(posts,0);}finally{f.close();}
});
for(const mutation of ['source','history','config','auth','negative-e34','null-authority','archive'])test(`${mutation} change fails before HTTP and preserves original authority`,async()=>{
 const f=await fixture();let posts=0;f.deps.fetchImpl=async()=>{posts++;throw Error('unexpected');};
 if(mutation==='source')f.sql().prepare('UPDATE documents SET data=? WHERE collection_name=? AND doc_id=?').run(JSON.stringify({...f.input.transaction,fiscalResponseMessage:'concurrent metadata'}),mutation==='source'?'transactions':'transactionHistory','sale');
 if(mutation==='history'){const commit=f.deps.commit;f.deps.commit=async(rows:any[])=>{f.sql().exec("UPDATE documents SET data=json_set(data,'$.fiscalResponseMessage','concurrent') WHERE collection_name='transactionHistory'");await commit(rows);};}
 if(mutation==='auth')f.credentials.deviceTokenSource='activationToken';
 if(mutation==='negative-e34'){f.input.transaction.ncfType='E34';f.input.transaction.total=-118;}
 if(mutation==='null-authority')f.input.transaction.fiscalIssuance.tenantId=null;
 if(mutation==='archive')f.sql().exec("UPDATE documents SET data=json_set(data,'$.zReportId','Z') WHERE collection_name='transactionHistory'");
 if(mutation==='config'){const commit=f.deps.commit;f.deps.commit=async(rows:any[])=>{f.sql().exec("UPDATE documents SET data='{}' WHERE collection_name='config'");await commit(rows);};}
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input));assert.equal(posts,0);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,'sale'),null);}finally{f.close();}
});
test('auth changes after durable claim prevent POST and retain unknown claim permanently',async()=>{
 const f=await fixture();let posts=0;const commit=f.deps.commit;f.deps.commit=async(rows:any[])=>{await commit(rows);f.credentials.deviceToken='rotated';};f.deps.fetchImpl=async()=>{posts++;throw Error('unexpected');};
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/SCOPE_CHANGED/);assert.ok(await f.get(FISCAL_DISPATCH_CLAIMS,'sale'));await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);assert.equal(posts,0);}finally{f.close();}
});
test('App MSeller entrypoints with candidate flag false hold before writes and route attempted documents to scoped GET only',async()=>{
 const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8'),start=source.indexOf('async (transaction: Transaction,',source.indexOf('const syncFiscalDocument ='));
 const end=source.indexOf('}, [config, pollFiscalDocumentStatus, upsertFiscalTransaction, loadFiscalStatusContext, fiscalStatusWorker]);',start);assert.ok(end>start);
 const compiled=(await transform(`const run=${source.slice(start,end+1)};`,{loader:'ts'})).code;
 const make=new Function('f',`const {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,v3FiscalInFlightRef,db,getExistingFiscalProviderReference,fiscalStatusWorker,requireFiscalErpAppliedReceipt,FISCAL_DISPATCH_CLAIMS}=f;${compiled}return run;`);
 const f=await fixture();let gets=0;const run=make({LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:false,v3FiscalInFlightRef:{current:new Map()},db:{getDocument:f.get},
  getExistingFiscalProviderReference:(tx:any)=>tx.fiscalReferenceId,fiscalStatusWorker:{consult:async()=>{gets++;return 'scoped';}},requireFiscalErpAppliedReceipt,FISCAL_DISPATCH_CLAIMS});
 try{const before=await f.get('transactions','sale');await assert.rejects(()=>run(f.input.transaction),/APPLIED_RECEIPT_REQUIRED/);assert.deepEqual(await f.get('transactions','sale'),before);
  await f.adapter.saveDocument('transactions',{...before,fiscalProviderStatus:'V3_ISSUE_REQUESTED'});await run(f.input.transaction);assert.equal(gets,1);assert.equal((await f.get('transactions','sale')).fiscalSyncStatus,'PENDING');
 }finally{f.close();}
});

test('unknown dispatch restarts into existing worker with frozen scope, authenticated real GET acceptance without QR; never a second POST',async()=>{
 const {getScopedFiscalDocumentStatus}=await import('../services/fiscal/FiscalScopedStatusTransport');
 const f=await fixture();let posts=0,gets=0,published=0;
 const stop=await http(f,async(req,res)=>{
  if(req.method==='POST'){posts++;res.destroy();return;}
  gets++;assert.match(req.url,/^\/api\/sync\/v3\/fiscal\/documents\/status\?/);assert.equal(req.headers['x-device-token'],'device-fixture-only');
  const tx=await f.get('transactions','sale'),scope=tx.fiscalSubmissionScope;
  const proof={schemaVersion:1,source:'ERP_SCOPED_PROVIDER_GET',scope:{tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device'},
   document:{erpDocumentId:'erp-sale',sourceTransactionId:'sale',ncf:tx.ncf,ncfType:'E32',sourceChecksum:scope.sourceChecksum,total:118},
   issuer:{rnc:'130090752',providerId:'MSELLER',environment:0,credentialCompanyId:'company',credentialAccountRnc:'130090752'},environmentBasis:'PERSISTED_SUBMISSION_INTENT',historicalEnvironment:null,
   lookup:{requestedNcf:tx.ncf},providerReceipt:{returnedNcf:tx.ncf,internalTrackId:'real-fixture-track',status:'DGIIAceptado',success:true,pending:false,invoiceTotal:118},decision:'ACCEPTED',observedAt:'2026-10-16T00:01:00Z'};
  res.setHeader('content-type','application/json');res.end(JSON.stringify(proof));
 });
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);f.restart();
  const frozen=(await f.get('transactions','sale')).fiscalSubmissionScope;
  const worker=new FiscalStatusReconciler({context:async()=>{const {basis:_basis,sourceChecksum:_checksum,capturedAt:_at,...scope}=frozen;return{scope,catalog:await f.deps.catalog(),assertCurrent:async()=>{}};},
   pair:async()=>({transaction:await f.get('transactions','sale'),history:await f.get('transactionHistory','sale')}),candidates:(binding,after,limit)=>f.adapter.getFiscalStatusCandidates(binding,after,limit),
   commit:rows=>f.adapter.saveDocumentsAtomically(rows),get:(tx,scope)=>getScopedFiscalDocumentStatus(tx,scope,()=>f.identity,fetch,()=>f.credentials),publish:()=>{published++;}});
  f.credentials.companyId='foreign';await assert.rejects(()=>worker.consult('sale',true),/SCOPE_CHANGED/);assert.equal(gets,0);f.credentials.companyId='company';
  assert.match(await worker.consult('sale',true),/aceptado/);assert.equal(gets,1);assert.equal(published,1);
  for(const name of ['transactions','transactionHistory']){const tx=await f.get(name,'sale');assert.equal(tx.fiscalSyncStatus,'SYNCED');assert.deepEqual(tx.fiscalSubmissionScope,frozen);assert.equal(tx.ncf,f.input.transaction.ncf);assert.equal(tx.fiscalPrintProof,undefined);}
  const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8'),a=app.indexOf('async (transaction: Transaction,',app.indexOf('const syncFiscalDocument =')),b=app.indexOf('}, [config, pollFiscalDocumentStatus, upsertFiscalTransaction, loadFiscalStatusContext, fiscalStatusWorker]);',a);
  const code=(await transform('const callback='+app.slice(a,b+1)+';',{loader:'ts'})).code;
  const run=new Function('f',`const {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,v3FiscalInFlightRef,db,getExistingFiscalProviderReference,fiscalStatusWorker,FISCAL_DISPATCH_CLAIMS,requireFiscalErpAppliedReceipt}=f;${code}return callback;`)({LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:false,v3FiscalInFlightRef:{current:new Map()},db:{getDocument:f.get},getExistingFiscalProviderReference:(tx:any)=>tx.fiscalReferenceId,fiscalStatusWorker:worker,FISCAL_DISPATCH_CLAIMS,requireFiscalErpAppliedReceipt});
  await run(await f.get('transactions','sale'));assert.equal((await f.get('transactions','sale')).fiscalSyncStatus,'SYNCED');
  await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);assert.equal(posts,1);
 }finally{await stop();f.close();}
});
for(const defect of ['missing-history','missing-config','missing-claim','duplicate-source','extra-write','claim-secret','claim-scope','wrong-marker','history-z'])test(`typed native claim rejects ${defect} complete batch atomically`,async()=>{
 const f=await fixture();let rows:any[]=[];f.deps.commit=async(input:any[])=>{rows=input;throw Error('capture');};
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/capture/);
  if(defect.startsWith('missing-'))rows=rows.filter(row=>row.collectionName!==({'missing-history':'transactionHistory','missing-config':'config','missing-claim':FISCAL_DISPATCH_CLAIMS} as any)[defect]);
  if(defect==='duplicate-source')rows.push(structuredClone(rows.find(row=>row.collectionName==='transactions')));
  if(defect==='extra-write')rows.push({collectionName:'outbox',document:{id:'foreign'}});
  if(defect==='claim-secret')rows[0].document.authToken='forbidden';
  if(defect==='claim-scope')rows[0].document.scope.companyId='foreign';
  if(defect==='wrong-marker')rows.find(row=>row.collectionName==='transactions').document.fiscalProviderStatus='SYNCED';
  if(defect==='history-z')rows.find(row=>row.collectionName==='transactionHistory').document.zReportId='Z';
  await assert.rejects(()=>f.adapter.saveDocumentsAtomically(rows),/MUTATION_DENIED/);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,'sale'),null);
  assert.equal((await f.get('transactions','sale')).fiscalSubmissionScope,undefined);
 }finally{f.close();}
});
test('App polling flag false cannot consume bare accepted legacy GET or rewrite NCF',async()=>{
 const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8'),a=source.indexOf('async (',source.indexOf('const pollFiscalDocumentStatus =')),b=source.indexOf('}, [config.companyInfo, upsertFiscalTransaction, fiscalStatusWorker]);',a);
 assert.ok(a>0&&b>a);const code=(await transform('const callback='+source.slice(a,b+1)+';',{loader:'ts'})).code;let scoped=0,legacy=0,writes=0;
 const run=new Function('f',`const {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,fiscalStatusWorker,getFiscalDocumentStatus,upsertFiscalTransaction}=f;${code}return callback;`)({LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:false,
  fiscalStatusWorker:{consult:async()=>{scoped++;}},getFiscalDocumentStatus:async()=>{legacy++;return{success:true,pending:false,eNCF:'FOREIGN'};},upsertFiscalTransaction:async()=>{writes++;}});
 await run({id:'sale',ncf:'E3200000001'},'MSELLER',0,'track');assert.equal(scoped,1);assert.equal(legacy,0);assert.equal(writes,0);
});
test('ISSUE signed pending proof is sanitized, cannot grant acceptance or echo secret messages',async()=>{
 const f=await fixture();const stop=await http(f,async(_req,res)=>{
  const tx=await f.get('transactions','sale'),scope=tx.fiscalSubmissionScope;
  const proof={schemaVersion:1,source:'ERP_SCOPED_PROVIDER_ISSUE',scope:{tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device',authToken:'forbidden-echo'},
   document:{erpDocumentId:'erp-sale',sourceTransactionId:'sale',ncf:tx.ncf,ncfType:'E32',sourceChecksum:scope.sourceChecksum,total:118},
   issuer:{rnc:'130090752',providerId:'MSELLER',environment:0,credentialCompanyId:'company',credentialAccountRnc:'130090752'},environmentBasis:'PERSISTED_SUBMISSION_INTENT',historicalEnvironment:null,
   lookup:{requestedNcf:tx.ncf},providerReceipt:{returnedNcf:tx.ncf,internalTrackId:'fixture-track',status:'PENDING',success:true,pending:true,invoiceTotal:118,authToken:'forbidden-echo',
    printEvidence:{schemaVersion:1,qrUrl:'https://fc.dgii.gov.do/testecf/consultatimbrefc?RNCEmisor=130090752&ENCF=E320000000001&MontoTotal=118.00&CodigoSeguridad=ABC123',securityCode:'ABC123',signedAt:'15-10-2026 20:00:00',secret:'forbidden-echo'}},decision:'PENDING',observedAt:'2026-10-16T00:01:00Z',raw:'forbidden-echo'};
  res.end(JSON.stringify({success:true,providerId:'MSELLER',environment:0,documentCode:'E32',message:'Bearer forbidden-echo',printEvidenceProof:proof}));
 });
 try{const result=await createMSellerDispatcher(f.deps)(f.input);assert.ok(result.printEvidenceProof);assert.equal(result.pending,true);assert.equal(result.message,'FISCAL_GET_CONFIRMATION_REQUIRED');assert.doesNotMatch(JSON.stringify(result),/forbidden-echo|authToken|secret|Bearer/);
  assert.equal((await f.get('transactions','sale')).fiscalSyncStatus,'PENDING');
 }finally{await stop();f.close();}
});
for(const code of ['E31','E44','E45'])test(`${code} validates formatted buyer copy while transmitting unchanged original`,async()=>{
 const f=await fixture(code);f.input.transaction.customerSnapshot.taxId='101-01010-1';
 for(const name of ['transactions','transactionHistory'])f.sql().prepare('UPDATE documents SET data=? WHERE collection_name=?').run(JSON.stringify(f.input.transaction),name);
 f.deps.fetchImpl=async(_url:any,init:any)=>{assert.equal(JSON.parse(init.body).transaction.customerSnapshot.taxId,'101-01010-1');return Response.json({success:true,providerId:'MSELLER',environment:0,documentCode:code});};
 try{assert.equal((await createMSellerDispatcher(f.deps)(f.input)).pending,true);}finally{f.close();}
});
test('E32 high amount requires identified buyer; snapshot nullable authorities remain null and held',async()=>{
 for(const field of ['issuerRnc','tenantId','companyId']){
  const f=await fixture();f.input.transaction.fiscalIssuance[field]=null;
  try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/ORIGINAL_AUTHORITY_REQUIRED/);assert.equal(f.input.transaction.fiscalIssuance[field],null);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,'sale'),null);}finally{f.close();}
 }
 const f=await fixture();f.input.transaction.total=250000;f.input.transaction.customerSnapshot.taxId='';
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/BUYER_REQUIRED/);}finally{f.close();}
});
test('config change after durable claim prevents network while retaining GET-only intent',async()=>{
 const f=await fixture();let posts=0;const commit=f.deps.commit;
 f.deps.commit=async(rows:any[])=>{await commit(rows);f.sql().exec("UPDATE documents SET data=json_set(data,'$.changed',1) WHERE collection_name='config'");};
 f.deps.fetchImpl=async()=>{posts++;throw Error('unexpected');};
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);assert.ok(await f.get(FISCAL_DISPATCH_CLAIMS,'sale'));assert.equal(posts,0);await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);}finally{f.close();}
});
