import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {transform} from 'esbuild';
import {appliedFixture,wireFixture} from './helpers/fiscalAppliedReceiptFixture';
import {createMSellerDispatcher,FISCAL_DISPATCH_CLAIMS,requireFiscalErpAppliedReceipt} from '../services/fiscal/FiscalMSellerDispatch';
import {validateAppliedReceiptV2,validateFiscalOriginal,captureFiscalOutboxAnchors,paymentSourceChecksum,canonicalFiscalJson} from '../services/fiscal/FiscalAppliedReceiptV2';
import {financialIdentity,financialOperationIdentity} from '../services/db/LargeMasterSyncV3FinancialRetention';
import {FiscalStatusReconciler} from '../services/fiscal/FiscalStatusReconciler';
import {getScopedFiscalDocumentStatus} from '../services/fiscal/FiscalScopedStatusTransport';
const names=['E31-none','E32-none','E32-cash1','E32-null-expiry','E44-none','E45-none'];
const canonical=(v:any)=>JSON.stringify(canonicalFiscalJson(v));
for(const name of names)test(`${name}: exact ERP bytes, one bound GET then atomic native claim before one POST, original pin and full source preserved`,async()=>{
 const manifest=JSON.parse(readFileSync(new URL('./fixtures/fiscal-applied-receipt-v2/provenance.json',import.meta.url),'utf8'));
 const expected=manifest.fixtures.find((entry:any)=>entry.path.endsWith('/'+name+'.json'));
 const bytes=readFileSync(new URL('./fixtures/fiscal-applied-receipt-v2/'+name+'.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256);assert.equal(bytes.length,expected.size);
 const f=await appliedFixture(name);let posts=0,gets=0;const originalBinding=f.original.v3Binding;
 // Independent mutable ACK metadata can diverge; wire must remain the literal Outbox original.
 await f.adapter.saveDocument('transactions',{...f.input.transaction,syncStatus:'APPLIED_ERP'});f.input.transaction=await f.get('transactions',f.id);
 await f.adapter.saveDocument('transactionHistory',{...f.input.transaction,fiscalResponseMessage:'independent history'});
 f.handle(async(req,res,body)=>{
  for(const [key,value]of Object.entries(f.wire.headers))assert.equal(req.headers[key],value);
  assert.equal(req.headers.cookie,undefined);res.setHeader('content-type','application/json');
  if(req.method==='GET'){gets++;assert.equal(req.url,f.wire.url);assert.equal(body,'');res.end(JSON.stringify(f.wire.expectedResponse));return;}
  posts++;assert.equal(req.url,'/api/fiscal/documents/issue');
  const claim=await f.get(FISCAL_DISPATCH_CLAIMS,f.id);assert.ok(claim);assert.equal(claim.schemaVersion,2);assert.deepEqual(claim.appliedReceipt,f.wire.expectedResponse);assert.deepEqual(claim.outboxAnchors,f.anchors);
  const payload=JSON.parse(body);assert.deepEqual(payload.transaction,f.original);assert.equal(payload.transaction.items[0].name,f.original.items[0].name);assert.deepEqual(payload.transaction.items[0].v3SaleAuthority,f.stamp);
  assert.equal(payload.transaction.v3Binding,originalBinding);assert.equal(payload.transaction.items[0].v3SaleAuthority.inventorySyncVersion,6);assert.equal(payload.transaction.items[0].v3SaleAuthority.syncVersion,7);
  assert.deepEqual(payload.options.appliedReceiptExpectation,claim.appliedReceiptExpectation);assert.equal(payload.options.appliedReceiptExpectation.sourceEventId,f.anchors.sale.event_id);assert.equal(payload.options.appliedReceiptExpectation.sourcePaymentEventId,f.anchors.payment?.event_id||null);
  assert.deepEqual(payload.options.fiscalIssuance,f.original.fiscalIssuance);assert.equal(payload.options.sequenceExpiryDate,f.original.fiscalIssuance.expiryDate);assert.equal(payload.transaction.appliedReceiptExpectation,undefined);
  assert.equal(claim.requestSha256,createHash('sha256').update(body).digest('hex'));assert.doesNotMatch(JSON.stringify(claim),/synthetic-sync-token|synthetic-device-token/);
  f.standard(req,res);
 });
 try{assert.equal(financialOperationIdentity(f.original,f.original.v3WarehouseId,{}),f.original.v3CommitFingerprint);
  const result=await createMSellerDispatcher(f.deps)(f.input);assert.equal(result.pending,true);assert.equal(result.status,'PENDING');assert.equal(result.eNCF,undefined);assert.doesNotMatch(JSON.stringify(result),/secret-token-echo/);
  assert.equal(gets,1);assert.equal(posts,1);assert.deepEqual(await f.adapter.getFiscalAppliedSourceRows(f.id),[f.anchors.sale,...(f.anchors.payment?[f.anchors.payment]:[])]);
  for(const name of ['transactions','transactionHistory']){const tx=await f.get(name,f.id);assert.equal(tx.fiscalProviderStatus,'V3_ISSUE_REQUESTED');assert.notEqual(tx.fiscalSyncStatus,'SYNCED');assert.equal(financialIdentity(tx),financialIdentity(f.original));assert.deepEqual(tx.fiscalIssuance,f.original.fiscalIssuance);}
  f.restart();await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);assert.equal(posts,1);
  for(const sql of ["DELETE FROM documents WHERE collection_name='fiscalDispatchClaims'","UPDATE documents SET data='{}' WHERE collection_name='fiscalDispatchClaims'",`INSERT OR REPLACE INTO documents(collection_name,doc_id,data,updatedAt) VALUES('fiscalDispatchClaims','${f.id}','{}','now')`])assert.throws(()=>f.sql().exec(sql),/UNKNOWN_GET_ONLY/);
 }finally{await f.close();}
});
for(const name of ['E32-none','E32-cash1'])for(const at of [1,2,3,4])test(`${name} failure at write ${at}: rollback receipt/pin/claim/both mirrors; zero POST and unchanged original Outbox`,async()=>{
 const f=await appliedFixture(name);f.fail(at);try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/injected write/);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);assert.equal((await f.get('transactions',f.id)).fiscalSubmissionScope,undefined);assert.equal((await f.get('transactionHistory',f.id)).fiscalSubmissionScope,undefined);assert.equal(f.requests.filter(r=>r.init?.method==='POST').length,0);assert.deepEqual(await f.adapter.getFiscalAppliedSourceRows(f.id),[f.anchors.sale,...(f.anchors.payment?[f.anchors.payment]:[])]);}finally{await f.close();}
});
test('lost local COMMIT ACK retains receipt, pin, original event IDs and GET-only claim through restart before fetch',async()=>{
 const f=await appliedFixture('E32-cash1');f.loseCommit();try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/lost commit ACK/);f.restart();const claim=await f.get(FISCAL_DISPATCH_CLAIMS,f.id);assert.deepEqual(claim.appliedReceipt,f.wire.expectedResponse);assert.deepEqual(claim.outboxAnchors,f.anchors);await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);assert.equal(f.requests.filter(r=>r.init?.method==='POST').length,0);}finally{await f.close();}
});
for(const mode of ['timeout','invalid','redirect','http-error','lost-ack','materialization-drift'])test(`POST ${mode}: unknown permanently retained, no fallback/retry after restart/config/provider/NCF change`,async()=>{
 const f=await appliedFixture();if(mode==='timeout')f.deps.timeoutMs=40;let posts=0;f.handle((req,res)=>{if(req.method==='GET')return f.standard(req,res);posts++;if(mode==='timeout')return;if(mode==='lost-ack'){res.destroy();return;}if(mode==='redirect'){res.statusCode=307;res.setHeader('location','/fallback');res.end();return;}if(mode==='http-error'||mode==='materialization-drift')res.statusCode=409;res.end(mode==='invalid'?'not-json':JSON.stringify({schemaVersion:2,decision:'HOLD',code:'FISCAL_V3_APPLIED_EXPECTATION_MISMATCH'}));});
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);f.restart();f.credentials.deviceToken='rotated';await assert.rejects(()=>createMSellerDispatcher(f.deps)({...f.input,providerId:'DIGIFACT',environment:2,transaction:{...f.input.transaction,ncf:'E320000000002'}}),/UNKNOWN_GET_ONLY/);assert.equal(posts,1);}finally{await f.close();}
});
test('concurrent independent dispatchers with real SQLite claim issue at most once',async()=>{
 const f=await appliedFixture();try{const results=await Promise.allSettled([createMSellerDispatcher(f.deps)(f.input),createMSellerDispatcher(f.deps)(f.input)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.requests.filter(r=>r.init?.method==='POST').length,1);}finally{await f.close();}
});
for(const mode of ['void','null','old-v1','production'])test(`readiness ${mode} is never an optional authority: zero network/claim`,async()=>{
 const f=await appliedFixture();f.deps.assertReady=mode==='production'?requireFiscalErpAppliedReceipt:async()=>mode==='null'?null:mode==='old-v1'?{schemaVersion:1}:undefined;
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input));assert.equal(f.requests.length,0);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);}finally{await f.close();}
});
for(const mode of [400,401,403,409,503,304,'html','redirect','unknown','partial'])test(`GET ${mode} strictly held with one request/no claim or POST`,async()=>{
 const f=await appliedFixture();f.handle((_req,res)=>{if(mode==='redirect'){res.statusCode=307;res.setHeader('location','/fallback');res.end();return;}res.statusCode=typeof mode==='number'?mode:200;res.setHeader('content-type',mode==='html'?'text/html':'application/json');res.end(mode==='html'?'<html>error</html>':JSON.stringify(mode==='unknown'?{...f.wire.expectedResponse,schemaVersion:3}:mode==='partial'?{decision:'READY'}:{schemaVersion:2,source:'ERP_POS_APPLIED_RECEIPT_V2',decision:'HOLD',code:'UNKNOWN_CODE'}));});
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input));assert.equal(f.requests.length,1);assert.equal(f.requests[0].init?.method,'GET');assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);}finally{await f.close();}
});
for(const target of ['source','history','config','sale-payload','payment-payload','event-association','duplicate-sale','duplicate-rejected-payment','deleted-event'])test(`native BEGIN guard catches ${target} race after GET/before writes`,async()=>{
 const f=await appliedFixture('E32-cash1'),commit=f.deps.commit;
 f.deps.commit=async(rows:any[])=>{
  if(target==='source'||target==='history')f.sql().prepare("UPDATE documents SET data=json_set(data,'$.fiscalResponseMessage','concurrent') WHERE collection_name=?").run(target==='source'?'transactions':'transactionHistory');
  if(target==='config')f.sql().exec("UPDATE documents SET data=json_set(data,'$.changed',1) WHERE collection_name='config'");
  if(target==='sale-payload'||target==='payment-payload')f.sql().prepare("UPDATE sync_outbox_v2 SET payload_json=payload_json||' ' WHERE event_id=?").run(target==='sale-payload'?f.anchors.sale.event_id:f.anchors.payment!.event_id);
  if(target==='event-association')f.sql().prepare('UPDATE sync_outbox_v2 SET aggregate_id=? WHERE event_id=?').run('foreign',f.anchors.sale.event_id);
  if(target==='deleted-event')f.sql().prepare('DELETE FROM sync_outbox_v2 WHERE event_id=?').run(f.anchors.sale.event_id);
  if(target==='duplicate-sale'||target==='duplicate-rejected-payment'){const original=target==='duplicate-sale'?f.anchors.sale:f.anchors.payment!;f.sql().prepare("INSERT INTO sync_outbox_v2(event_id,event_type,aggregate_type,aggregate_id,schema_version,payload_json,status,created_at,updated_at) VALUES('77777777-0000-4000-8000-000000000099',?,?,?,?,?,'REJECTED','now','now')").run(original.event_type,original.aggregate_type,original.aggregate_id,1,original.payload_json);}
  await commit(rows);
 };
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input));assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);assert.equal(f.requests.filter(r=>r.init?.method==='POST').length,0);}finally{await f.close();}
});
for(const defect of ['missing-history','missing-config','missing-claim','duplicate-source','extra-write','claim-secret','claim-scope','wrong-marker','history-z','receipt-extra','receipt-pin','anchors-raw','anchors-event','expectation','original-financial','downgrade-v1'])test(`direct forged native ${defect} cannot bypass receipt-aware batch validation`,async()=>{
 const f=await appliedFixture();let rows:any[]=[];f.deps.commit=async(input:any[])=>{rows=input;throw Error('capture');};
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/capture/);
  if(defect.startsWith('missing-'))rows=rows.filter(r=>r.collectionName!==({'missing-history':'transactionHistory','missing-config':'config','missing-claim':FISCAL_DISPATCH_CLAIMS} as any)[defect]);
  const claim=rows.find(r=>r.collectionName===FISCAL_DISPATCH_CLAIMS)?.document;
  if(defect==='duplicate-source')rows.push(structuredClone(rows.find(r=>r.collectionName==='transactions')));if(defect==='extra-write')rows.push({collectionName:'outbox',document:{id:'foreign'}});
  if(defect==='claim-secret')claim.authToken='echo';if(defect==='claim-scope')claim.scope.companyId='foreign';if(defect==='wrong-marker')rows.find(r=>r.collectionName==='transactions').document.fiscalProviderStatus='SYNCED';if(defect==='history-z')rows.find(r=>r.collectionName==='transactionHistory').document.zReportId='Z';
  if(defect==='receipt-extra')claim.appliedReceipt.raw='arbitrary';if(defect==='receipt-pin')claim.appliedReceipt.observation.digest='INVALID';if(defect==='expectation')claim.appliedReceiptExpectation.sourcePaymentEventId=claim.outboxAnchors.sale.event_id;
  if(defect==='anchors-raw')claim.outboxAnchors.sale.payload_json+=' ';if(defect==='anchors-event')claim.outboxAnchors.sale.event_id='aaaaaaaa-0000-4000-8000-000000000099';
  if(defect==='downgrade-v1'){claim.schemaVersion=1;delete claim.appliedReceipt;delete claim.appliedReceiptExpectation;delete claim.outboxAnchors;}
  if(defect==='original-financial'){const original=JSON.parse(claim.outboxAnchors.sale.payload_json);original.transaction.items[0].sku='forged';claim.outboxAnchors.sale.payload_json=JSON.stringify(original);}
  await assert.rejects(()=>f.adapter.saveDocumentsAtomically(rows));assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);assert.equal((await f.get('transactions',f.id)).fiscalSubmissionScope,undefined);
 }finally{await f.close();}
});
const receiptMutations:Record<string,(r:any)=>void>={version:r=>{r.schemaVersion=1;},source:r=>{r.source='ERP_POS_APPLIED_RECEIPT_V1';},profile:r=>{r.profile='other';},decision:r=>{r.decision='APPLIED';},code:r=>{r.code='UNKNOWN';},scope:r=>{r.scope.companyId=r.scope.tenantId;},env:r=>{r.issuer.environment=2;},environmentBasis:r=>{r.environmentBasis='PERSISTED_SUBMISSION_INTENT';},issuer:r=>{r.issuer.credentialAccountRnc='000000000';},event:r=>{r.sourceDocument.eventId=r.sourceDocument.inboxId;},ncf:r=>{r.document.ncf='E320000000001';},total:r=>{r.document.sourceSignedTotal=-100;},currency:r=>{r.document.currency='USD';},snapshot:r=>{r.fiscalIssuance.expiryDate=null;},stamp:r=>{r.posAuthority.lines[0].v3SaleAuthority.inventoryCursor='new';},warehouse:r=>{r.materialization.warehouseId=r.materialization.inventoryLocalId;},emptyIds:r=>{r.materialization.movementIds=[];},duplicateIds:r=>{r.materialization.journalLineIds.push(r.materialization.journalLineIds[0]);},missingPlan:r=>{delete r.erpApplicationPlan;},payment:r=>{r.settlement.mode='CASH';},paymentChecksum:r=>{r.settlement.sourcePayment.checksum=r.sourceDocument.checksum;},observation:r=>{r.observation.algorithm='SHA256_OLD';},nullDigest:r=>{r.observation.digest=null;}};
for(const [name,change]of Object.entries(receiptMutations))test(`strict public DTO rejects ${name}, no claim or POST`,async()=>{
 const f=await appliedFixture(name==='paymentChecksum'?'E32-cash1':'E32-none'),r=structuredClone(f.wire.expectedResponse);change(r);f.handle((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(r));});
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input));assert.equal(f.requests.length,1);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);}finally{await f.close();}
});
for(const key of ['scope','sourceDocument','document','fiscalIssuance','issuer','posAuthority','erpApplicationPlan','materialization','settlement','observation'])test(`nested unknown field ${key} is rejected rather than stripped`,async()=>{
 const f=await appliedFixture(),r=structuredClone(f.wire.expectedResponse);r[key].unknown=true;
 try{await assert.rejects(()=>validateAppliedReceiptV2(r,f.anchors,f.scope,f.original));}finally{await f.close();}
});
for(const field of ['fiscalEnvironment','v3Binding','v3WarehouseId','v3InventoryBaseline','v3CommitFingerprint','line-tariff','line-tax','line-cursor','line-inventory-pair','source-event-id','missing-source','companion-aggregate','payment-summary','payment-date','payment-intents','archived','missing-active','missing-history','snapshot-null','E34-negative','E34-positive'])test(`invalid local original ${field} remains HOLD before GET`,async()=>{
 const f=await appliedFixture(field.startsWith('payment')||field==='companion-aggregate'?'E32-cash1':'E32-none');
 const sale=JSON.parse(f.anchors.sale.payload_json),payment=f.anchors.payment?JSON.parse(f.anchors.payment.payload_json):null;
 if(field==='fiscalEnvironment')delete sale.transaction.fiscalEnvironment;
 if(['v3Binding','v3WarehouseId','v3InventoryBaseline','v3CommitFingerprint'].includes(field))sale.transaction[field]='foreign';
 if(field==='line-tariff')sale.transaction.items[0].v3SaleAuthority.tariffId='other';if(field==='line-tax')sale.transaction.items[0].v3SaleAuthority.taxIncluded=true;if(field==='line-cursor')sale.transaction.items[0].v3SaleAuthority.inventoryCursor='other';if(field==='line-inventory-pair')delete sale.transaction.items[0].v3SaleAuthority.inventorySyncVersion;
 if(field==='snapshot-null')sale.transaction.fiscalIssuance.tenantId=null;
 if(field.startsWith('E34')){sale.transaction.ncfType='E34';sale.transaction.total=field==='E34-negative'?-100:100;}
 if(payment){if(field==='payment-summary')payment.summary.display_id='wrong';if(field==='payment-date')payment.occurred_at='2026-10-17T00:00:00Z';if(field==='payment-intents')payment.paymentIntentIds=[];f.sql().prepare('UPDATE sync_outbox_v2 SET payload_json=? WHERE event_id=?').run(JSON.stringify(payment),f.anchors.payment!.event_id);}
 f.sql().prepare('UPDATE sync_outbox_v2 SET payload_json=? WHERE event_id=?').run(JSON.stringify(sale),f.anchors.sale.event_id);
 if(field==='source-event-id')f.sql().prepare('UPDATE sync_outbox_v2 SET event_id=? WHERE event_id=?').run(f.id,f.anchors.sale.event_id);
 if(field==='companion-aggregate')f.sql().prepare('UPDATE sync_outbox_v2 SET aggregate_id=? WHERE event_id=?').run('foreign',f.anchors.payment!.event_id);
 if(field==='missing-source')f.sql().prepare('DELETE FROM sync_outbox_v2 WHERE event_id=?').run(f.anchors.sale.event_id);
 if(field==='archived')await f.adapter.saveDocument('transactions',{...f.input.transaction,zReportId:'Z'});
 if(field==='missing-active'||field==='missing-history'){// Simulate the genuine post-Z physical lifecycle in an isolated fixture, not an operational cleanup.
  f.sql().exec('DROP TRIGGER preserve_v3_inventory_delete');f.sql().prepare('DELETE FROM documents WHERE collection_name=?').run(field==='missing-active'?'transactions':'transactionHistory');
 }
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input));assert.equal(f.requests.length,0);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);}finally{await f.close();}
});
test('PAYMENT canonical checksum binds complete summary, literal occurred_at, array order and absence/null vs empty intents',async()=>{
 const f=await appliedFixture('E32-cash1');try{const original=JSON.parse(f.anchors.payment!.payload_json),expected=f.wire.expectedResponse.settlement.sourcePayment.checksum;assert.equal(await paymentSourceChecksum(original),expected);
  assert.equal(await paymentSourceChecksum({...original,paymentIntentIds:null}),expected);assert.notEqual(await paymentSourceChecksum({...original,paymentIntentIds:[]}),expected);
  assert.notEqual(await paymentSourceChecksum({...original,paymentIntentIds:['a','b']}),await paymentSourceChecksum({...original,paymentIntentIds:['b','a']}));
  assert.notEqual(await paymentSourceChecksum({...original,summary:{...original.summary,display_id:'changed'}}),expected);assert.notEqual(await paymentSourceChecksum({...original,occurred_at:original.occurred_at.replace('.000Z','Z')}),expected);
 }finally{await f.close();}
});
test('opaque server observation/IDs are preserved, UUIDv7 and variable zero-cost accounting cardinality are accepted',async()=>{
 const f=await appliedFixture(),r=structuredClone(f.wire.expectedResponse);r.observation.digest='a'.repeat(64);r.erpApplicationPlan.id='12345678-1234-7123-8123-123456789abc';r.materialization.journalEntryIds=['12345678-1234-7123-8123-123456789abc'];r.materialization.journalLineIds=['12345678-1234-7123-8123-123456789abd','12345678-1234-7123-8123-123456789abe'];
 try{const p=await validateAppliedReceiptV2(r,f.anchors,f.scope,f.original);assert.equal(p.expectation.observation.digest,'a'.repeat(64));assert.deepEqual(p.receipt.materialization,r.materialization);}finally{await f.close();}
});
for(const phase of ['during-GET','after-claim-auth','after-claim-config'])test(`${phase} identity/config drift retains zero POST; an actual claim is never reclaimed`,async()=>{
 const f=await appliedFixture();
 if(phase==='during-GET')f.handle((req,res)=>{f.credentials.deviceToken='rotated';f.standard(req,res);});else{const commit=f.deps.commit;f.deps.commit=async(rows:any[])=>{await commit(rows);if(phase==='after-claim-auth')f.credentials.deviceToken='rotated';else f.sql().exec("UPDATE documents SET data=json_set(data,'$.changed',1) WHERE collection_name='config'");};}
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input));assert.equal(f.requests.filter(r=>r.init?.method==='POST').length,0);if(phase!=='during-GET'){assert.ok(await f.get(FISCAL_DISPATCH_CLAIMS,f.id));f.restart();await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);}else assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);}finally{await f.close();}
});
for(const prefix of ['', 'types/E31/','types/E44/','types/E45/'])for(const baseName of ['full-none-habitual-missing-env','full-cash1-habitual-missing-env','full-none-lab-explicit-env','full-cash1-lab-explicit-env']){const name=prefix+baseName;test(`original adapter/serializer vector ${name} is preserved and not repaired`,async()=>{
 const v=JSON.parse(readFileSync(new URL('./fixtures/fiscal-applied-vectors/'+name+'.json',import.meta.url),'utf8'));
 const anchor=(event_id:string,event_type:string,payload:any)=>({event_id,event_type,aggregate_type:'TRANSACTION',aggregate_id:v.transaction.id,schema_version:1,payload_json:JSON.stringify(payload)});
 const a={sale:anchor(v.sourceSaleEventId,'SALE_POSTED',v.salePayload),payment:v.paymentPayload?anchor(v.sourcePaymentEventId,'PAYMENT_POSTED',v.paymentPayload):null},before=canonical(v);
 if(name.includes('missing-env'))await assert.rejects(()=>validateFiscalOriginal(a,v.scope),/HISTORICAL_ENVIRONMENT_REQUIRED/);else{const result=await validateFiscalOriginal(a,v.scope);assert.equal(result.environment,0);assert.equal(financialOperationIdentity(v.transaction,v.warehouseId,{}),v.transaction.v3CommitFingerprint);}
 assert.equal(canonical(v),before);
});}
test('claim leaves entire Outbox rows including status, attempt, lease and ACK metadata byte-identical',async()=>{
 const f=await appliedFixture('E32-cash1');f.sql().exec("UPDATE sync_outbox_v2 SET status='SENDING',attempt_count=3,lease_owner='fixture-owner',lease_expires_at='2099-01-01',last_error='prior',master_synced_at='prior',erp_applied_at='prior'");
 const before=JSON.stringify(f.sql().prepare('SELECT * FROM sync_outbox_v2 ORDER BY local_sequence').all());
 try{await createMSellerDispatcher(f.deps)(f.input);assert.equal(JSON.stringify(f.sql().prepare('SELECT * FROM sync_outbox_v2 ORDER BY local_sequence').all()),before);}finally{await f.close();}
});
async function appCallback(name:string,begin:string,end:string,bindings:string,fixture:any){
 const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8'),a=source.indexOf(begin,source.indexOf('const '+name+' =')),b=source.indexOf(end,a);assert.ok(a>0&&b>a);
 const code=(await transform('const callback='+source.slice(a,b+1)+';',{loader:'ts'})).code;
 return new Function('f',`const {${bindings}}=f;${code}return callback;`)(fixture);
}
test('actual App MSELLER consultation uses scoped GET with candidate OFF, preserves originals and propagates failure without ISSUE fallback',async()=>{
 const f=await appliedFixture();let scoped=0,legacy=0,writes=0,failed=false;
 Object.assign(f.credentials,{authStatus:'AUTHENTICATED',syncTokenExpiresAt:'2099-01-01T00:00:00Z',deviceTokenExpiresAt:'2020-01-01T00:00:00Z'});
 const snapshot=()=>JSON.stringify({documents:f.sql().prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),outbox:f.sql().prepare('SELECT * FROM sync_outbox_v2 ORDER BY local_sequence').all()});
 f.handle((req,res)=>{assert.equal(req.method,'GET');assert.match(req.url,/^\/api\/sync\/v3\/fiscal\/documents\/status\?/);const params=new URL(req.url,'http://fixture').searchParams;assert.equal(params.get('sourceTransactionId'),f.id);assert.equal(params.get('electronicNcf'),f.original.ncf);const scope=JSON.parse(params.get('scopeAssertion')!);for(const key of ['tenantId','companyId','storeId','terminalId','deviceId'])assert.equal(scope[key],f.scope[key]);res.statusCode=failed?429:200;res.setHeader('content-type','application/json');res.end(JSON.stringify(failed?{error:'rate-limited'}:{schemaVersion:1,source:'ERP_SCOPED_PROVIDER_GET',decision:'PENDING'}));});
 const worker={consult:async(transactionId:string,...options:any[])=>{scoped++;assert.equal(transactionId,f.id);assert.deepEqual(options,[true,undefined,undefined,true]);return getScopedFiscalDocumentStatus(f.original,f.scope,()=>f.identity,f.deps.fetchImpl,()=>f.credentials,true);}};
 try{const before=snapshot();const sync=await appCallback('syncFiscalDocument','async (transaction: Transaction,','}, [config, pollFiscalDocumentStatus, upsertFiscalTransaction, loadFiscalStatusContext, fiscalStatusWorker]);',
 'LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,v3FiscalInFlightRef,db,getExistingFiscalProviderReference,fiscalStatusWorker,requireFiscalErpAppliedReceipt,FISCAL_DISPATCH_CLAIMS',
 {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:false,v3FiscalInFlightRef:{current:new Map()},db:{getDocument:f.get},getExistingFiscalProviderReference:(tx:any)=>tx.fiscalReferenceId,fiscalStatusWorker:worker,requireFiscalErpAppliedReceipt,FISCAL_DISPATCH_CLAIMS});
 await Promise.all([sync(f.input.transaction),sync(f.input.transaction)]);assert.equal(scoped,1);assert.equal(f.requests.length,1);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);assert.equal(snapshot(),before);
 failed=true;await assert.rejects(()=>sync(f.input.transaction),/FISCAL_STATUS_PROOF_UNAVAILABLE/);assert.equal(scoped,2);assert.equal(f.requests.length,2);assert.equal(snapshot(),before);
 const poll=await appCallback('pollFiscalDocumentStatus','async (','}, [config.companyInfo, upsertFiscalTransaction, fiscalStatusWorker]);','LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,fiscalStatusWorker,getFiscalDocumentStatus,upsertFiscalTransaction',
 {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:false,fiscalStatusWorker:{consult:async(id:string)=>{scoped++;assert.equal(id,f.id);}},getFiscalDocumentStatus:async()=>{legacy++;return{success:true,eNCF:'FOREIGN'};},upsertFiscalTransaction:async()=>{writes++;}});
 await poll(f.original,'MSELLER',0,'track');assert.equal(scoped,3);assert.equal(legacy,0);assert.equal(writes,0);assert.equal(f.requests.filter(r=>r.init?.method==='POST').length,0);assert.equal(snapshot(),before);
 }finally{await f.close();}
});
test('unknown ready dispatch restarts into existing scoped GET worker, accepted without QR stays accepted during App retry/claim',async()=>{
 const f=await appliedFixture();let posts=0,gets=0,published=0;
 f.handle(async(req,res)=>{
  if(req.method==='POST'){posts++;res.destroy();return;}
  if(req.url.startsWith('/api/fiscal/v2/'))return f.standard(req,res);
  gets++;const tx=await f.get('transactions',f.id),scope=tx.fiscalSubmissionScope;
  assert.match(req.url,/^\/api\/sync\/v3\/fiscal\/documents\/status\?/);
  res.setHeader('content-type','application/json');res.end(JSON.stringify({schemaVersion:1,source:'ERP_SCOPED_PROVIDER_GET',scope:f.scope,
   document:{erpDocumentId:f.wire.expectedResponse.document.erpDocumentId,sourceTransactionId:f.id,ncf:tx.ncf,ncfType:tx.ncfType,sourceChecksum:scope.sourceChecksum,total:tx.total},
   issuer:f.wire.expectedResponse.issuer,environmentBasis:'HISTORICAL_SOURCE',historicalEnvironment:0,lookup:{requestedNcf:tx.ncf},providerReceipt:{returnedNcf:tx.ncf,internalTrackId:'fixture-track',status:'DGIIAceptado',success:true,pending:false,invoiceTotal:tx.total},decision:'ACCEPTED',observedAt:'2026-10-17T00:00:00Z'}));
 });
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);f.restart();const tx=await f.get('transactions',f.id),frozen=tx.fiscalSubmissionScope;
  const {basis:_basis,sourceChecksum:_checksum,capturedAt:_at,...scope}=frozen;
  const worker=new FiscalStatusReconciler({context:async()=>({scope,catalog:await f.deps.catalog(),assertCurrent:async()=>{}}),pair:f.pair,candidates:(binding,after,limit)=>f.adapter.getFiscalStatusCandidates(binding,after,limit),
   commit:rows=>f.adapter.saveDocumentsAtomically(rows),get:(tx,s)=>getScopedFiscalDocumentStatus(tx,s,()=>f.identity,f.deps.fetchImpl,()=>f.credentials),publish:()=>{published++;}});
  assert.equal(tx.fiscalSyncStatus,undefined);assert.deepEqual(await f.adapter.getFiscalStatusCandidates(f.original.v3Binding,'',10),[f.id]);
  await worker.runAutomatic();assert.equal(gets,1);assert.equal(published,1);assert.deepEqual(await f.adapter.getFiscalStatusCandidates(f.original.v3Binding,'',10),[]);
  for(const name of ['transactions','transactionHistory']){const stored=await f.get(name,f.id);assert.equal(stored.fiscalSyncStatus,'SYNCED');assert.deepEqual(stored.fiscalSubmissionScope,frozen);assert.equal(stored.ncf,f.original.ncf);assert.equal(stored.fiscalPrintProof,undefined);}
  const sync=await appCallback('syncFiscalDocument','async (transaction: Transaction,','}, [config, pollFiscalDocumentStatus, upsertFiscalTransaction, loadFiscalStatusContext, fiscalStatusWorker]);',
  'LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,v3FiscalInFlightRef,db,getExistingFiscalProviderReference,fiscalStatusWorker,requireFiscalErpAppliedReceipt,FISCAL_DISPATCH_CLAIMS',
  {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:false,v3FiscalInFlightRef:{current:new Map()},db:{getDocument:f.get},getExistingFiscalProviderReference:(row:any)=>row.fiscalReferenceId,fiscalStatusWorker:worker,requireFiscalErpAppliedReceipt,FISCAL_DISPATCH_CLAIMS});
  await sync(await f.get('transactions',f.id));assert.equal((await f.get('transactions',f.id)).fiscalSyncStatus,'SYNCED');await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);assert.equal(posts,1);
 }finally{await f.close();}
});
test('signed pending ISSUE proof is separately sanitized, never acceptance or a secret echo',async()=>{
 const f=await appliedFixture();f.handle(async(req,res)=>{
  if(req.method==='GET')return f.standard(req,res);const tx=await f.get('transactions',f.id),scope=tx.fiscalSubmissionScope;
  const proof={schemaVersion:1,source:'ERP_SCOPED_PROVIDER_ISSUE',scope:{...f.scope,raw:'secret-echo'},document:{erpDocumentId:f.wire.expectedResponse.document.erpDocumentId,sourceTransactionId:f.id,ncf:tx.ncf,ncfType:tx.ncfType,sourceChecksum:scope.sourceChecksum,total:tx.total},
   issuer:f.wire.expectedResponse.issuer,environmentBasis:'HISTORICAL_SOURCE',historicalEnvironment:0,lookup:{requestedNcf:tx.ncf},providerReceipt:{returnedNcf:tx.ncf,internalTrackId:'fixture-track',status:'PENDING',success:true,pending:true,invoiceTotal:tx.total,raw:'secret-echo',
    printEvidence:{schemaVersion:1,qrUrl:`https://fc.dgii.gov.do/testecf/consultatimbrefc?RNCEmisor=130090752&ENCF=${tx.ncf}&MontoTotal=100.00&CodigoSeguridad=ABC123`,securityCode:'ABC123',signedAt:'15-10-2026 23:30:00',secret:'secret-echo'}},decision:'PENDING',observedAt:'2026-10-17T00:00:00Z',raw:'secret-echo'};
  res.setHeader('content-type','application/json');res.end(JSON.stringify({success:true,providerId:'MSELLER',environment:0,documentCode:'E32',message:'secret-echo',printEvidenceProof:proof}));
 });
 try{const result=await createMSellerDispatcher(f.deps)(f.input);assert.ok(result.printEvidenceProof);assert.equal(result.pending,true);assert.equal(result.status,'PENDING');assert.doesNotMatch(JSON.stringify(result),/secret-echo|"raw"|"secret"/);assert.notEqual((await f.get('transactions',f.id)).fiscalSyncStatus,'SYNCED');}finally{await f.close();}
});
for(const drift of ['payload','event','companion'])test(`after-commit Outbox ${drift} drift holds before POST with immutable receipt+claim`,async()=>{
 const f=await appliedFixture(),commit=f.deps.commit;f.deps.commit=async(rows:any[])=>{await commit(rows);
  if(drift==='payload')f.sql().prepare("UPDATE sync_outbox_v2 SET payload_json=payload_json||' ' WHERE event_id=?").run(f.anchors.sale.event_id);
  if(drift==='event')f.sql().prepare('UPDATE sync_outbox_v2 SET aggregate_id=? WHERE event_id=?').run('foreign',f.anchors.sale.event_id);
  if(drift==='companion')f.sql().prepare("INSERT INTO sync_outbox_v2(event_id,event_type,aggregate_type,aggregate_id,schema_version,payload_json,status,created_at,updated_at) VALUES('77777777-0000-4000-8000-000000000098','PAYMENT_POSTED','TRANSACTION',?,1,?,'REJECTED','now','now')").run(f.id,JSON.stringify({summary:{transaction_id:f.id}}));
 };
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input));assert.ok(await f.get(FISCAL_DISPATCH_CLAIMS,f.id));assert.equal(f.requests.filter(r=>r.init?.method==='POST').length,0);f.restart();await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/UNKNOWN_GET_ONLY/);}finally{await f.close();}
});
test('existing selector includes missing status attempted+scoped only, excludes unscoped/unattempted/SYNCED/foreign binding',async()=>{
 const f=await appliedFixture();try{await createMSellerDispatcher(f.deps)(f.input);const original=await f.get('transactions',f.id);
  for(const [key,patch]of Object.entries({unscoped:{fiscalSubmissionScope:null},unattempted:{fiscalProviderStatus:null},synced:{fiscalSyncStatus:'SYNCED'},foreign:{v3Binding:'foreign'}})){
   const doc={...original,...patch,id:'ZZ-'+key};f.sql().prepare("INSERT INTO documents(collection_name,doc_id,data,updatedAt) VALUES('transactions',?,?,'now')").run(doc.id,JSON.stringify(doc));
  }
  assert.deepEqual(await f.adapter.getFiscalStatusCandidates(f.original.v3Binding,'',10),[f.id]);
 }finally{await f.close();}
});
test('readonly source loader uses all three partial indexes without full scan or sort; malformed foreign association remains visible',async()=>{
 const {FISCAL_OUTBOX_SOURCE_SQL,fiscalOutboxSourceParams}=await import('../services/fiscal/FiscalAppliedReceiptV2');
 const f=await appliedFixture();try{const plan=f.sql().prepare('EXPLAIN QUERY PLAN '+FISCAL_OUTBOX_SOURCE_SQL).all(...fiscalOutboxSourceParams(f.id)).map(row=>row.detail).join('\n');
  assert.match(plan,/MULTI-INDEX OR/);for(const name of ['idx_outbox_fiscal_aggregate','idx_outbox_fiscal_transaction_alias','idx_outbox_fiscal_summary_alias'])assert.match(plan,new RegExp(name));assert.doesNotMatch(plan,/SCAN sync_outbox_v2|TEMP B-TREE/);
  f.sql().prepare("INSERT INTO sync_outbox_v2(event_id,event_type,aggregate_type,aggregate_id,schema_version,payload_json,status,created_at,updated_at) VALUES('77777777-0000-4000-8000-000000000097','SALE_POSTED','OTHER','foreign',1,?,'REJECTED','now','now')").run(JSON.stringify({transaction:{id:f.id},summary:{transaction_id:f.id}}));
  const rows=await f.adapter.getFiscalAppliedSourceRows(f.id);assert.equal(rows.length,2);assert.throws(()=>captureFiscalOutboxAnchors(rows,f.id));
 }finally{await f.close();}
});
test('absent optional stock pair uses original catalog baseline; explicit half/null pair stays invalid',async()=>{
 const f=await appliedFixture();try{const payload=JSON.parse(f.anchors.sale.payload_json),tx=payload.transaction,stamp=tx.items[0].v3SaleAuthority;delete stamp.inventorySyncId;delete stamp.inventorySyncVersion;
  tx.v3InventoryBaseline=JSON.stringify([tx.v3Binding,stamp.syncId,stamp.syncVersion,stamp.inventoryVersion,stamp.inventoryCursor]);tx.v3CommitFingerprint=financialOperationIdentity(tx,tx.v3WarehouseId,{});
  const a={sale:{...f.anchors.sale,payload_json:JSON.stringify(payload)},payment:null};await validateFiscalOriginal(a,f.scope);
  stamp.inventorySyncId=null;a.sale.payload_json=JSON.stringify(payload);await assert.rejects(()=>validateFiscalOriginal(a,f.scope),/STOCK_ANCHOR_INVALID/);
 }finally{await f.close();}
});
for(const type of ['sale','payment'])test(`original ${type} credential metadata is held rather than copied/pruned into durable claim`,async()=>{
 const f=await appliedFixture('E32-cash1'),anchor=type==='sale'?f.anchors.sale:f.anchors.payment!,payload=JSON.parse(anchor.payload_json);payload.deviceToken='synthetic-forbidden-secret';f.sql().prepare('UPDATE sync_outbox_v2 SET payload_json=? WHERE event_id=?').run(JSON.stringify(payload),anchor.event_id);
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/SECRET_IN_SOURCE_HELD/);assert.equal(f.requests.length,0);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);}finally{await f.close();}
});
test('derived laboratory binding allows distinct download origin as data; transport remains authorized ERP origin',async()=>{
 const f=await appliedFixture('E32-none',async wire=>{
  // Derived in-memory laboratory case; the six provenance-hashed ERP fixture files stay byte-exact.
  const tx=wire.originalSource.transaction,binding=JSON.parse(tx.v3Binding);binding[4]='https://downloads.fixture.invalid';tx.v3Binding=JSON.stringify(binding);
  for(const line of tx.items)line.v3SaleAuthority.binding=tx.v3Binding;
  const baseline=JSON.parse(tx.v3InventoryBaseline);baseline[0]=tx.v3Binding;tx.v3InventoryBaseline=JSON.stringify(baseline);
  tx.v3CommitFingerprint=financialOperationIdentity(tx,tx.v3WarehouseId,{});
  const payload=wire.materializedSnapshot.sources[0].payload;payload.transaction=structuredClone(tx);payload.erp_fiscal_v3_application_plan_v1.originalPayload=structuredClone(wire.originalSource);
  const a={sale:{event_id:wire.materializedSnapshot.sources[0].event_id,event_type:'SALE_POSTED',aggregate_type:'TRANSACTION',aggregate_id:tx.id,schema_version:1,payload_json:JSON.stringify(wire.originalSource)},payment:null};
  const source=await validateFiscalOriginal(a,wire.expectedResponse.scope);wire.expectedResponse.sourceDocument.checksum=source.checksum;wire.expectedResponse.posAuthority=source.authority;
 });
 try{await createMSellerDispatcher(f.deps)(f.input);assert.equal(f.requests.length,2);assert.ok(f.requests.every(r=>new URL(r.url).origin==='https://erp.fixture.invalid'));assert.equal(JSON.parse(f.original.v3Binding)[4],'https://downloads.fixture.invalid');assert.equal(JSON.parse(String(f.requests[1].init!.body)).transaction.v3Binding,f.original.v3Binding);}finally{await f.close();}
});
for(const stage of ['before-get','during-get','after-claim'])test(`current full operational binding drift ${stage} holds without POST`,async()=>{
 const f=await appliedFixture(),catalog=f.deps.catalog;let drift=stage==='before-get';f.deps.catalog=async()=>({...await catalog(),...(drift?{binding:'different-current-operational-binding'}:{})});
 if(stage==='during-get')f.handle((req,res)=>{drift=true;f.standard(req,res);});
 if(stage==='after-claim'){const commit=f.deps.commit;f.deps.commit=async(rows:any[])=>{await commit(rows);drift=true;};}
 try{await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input));assert.equal(f.requests.filter(r=>r.init?.method==='POST').length,0);assert.equal(f.requests.filter(r=>r.init?.method==='GET').length,stage==='before-get'?0:1);assert.equal(Boolean(await f.get(FISCAL_DISPATCH_CLAIMS,f.id)),stage==='after-claim');}finally{await f.close();}
});
