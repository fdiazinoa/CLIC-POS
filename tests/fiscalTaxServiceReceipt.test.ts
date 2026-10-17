import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {taxServiceFixture,taxServiceLab} from './helpers/fiscalTaxServiceFixture';
import {validateAppliedReceiptV2,validateFiscalOriginal,validatePreparedAppliedReceipt,TAX_SERVICE_APPLIED_PROFILE,APPLIED_PROFILE} from '../services/fiscal/FiscalAppliedReceiptV2';
import {createMSellerDispatcher,FISCAL_DISPATCH_CLAIMS} from '../services/fiscal/FiscalMSellerDispatch';
import {financialOperationIdentity} from '../services/db/LargeMasterSyncV3FinancialRetention';
const snapshot=(f:any)=>JSON.stringify({documents:f.sql().prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),outbox:f.sql().prepare('SELECT * FROM sync_outbox_v2 ORDER BY local_sequence').all()});
test('exact ERP c348 fixture bytes retain their synthetic provenance',()=>{
 const manifest=taxServiceFixture('pos-copy-provenance');assert.equal(manifest.erpRevision,'c348bdc87224a57ecd67bb6af7e86acd9cc814c1');assert.equal(manifest.realCaja6Operation,false);
 for(const file of manifest.files){const bytes=readFileSync(new URL('./fixtures/fiscal-tax-service-v1/'+file.path,import.meta.url));assert.equal(bytes.length,file.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
});
test('exact tax/service GET over real loopback HTTP and host SQLite is read-only; opaque financial/materialization pin and originals survive restart unchanged',async()=>{
 const f=await taxServiceLab();try{const before=snapshot(f),raw=JSON.stringify(f.anchors),p=await f.readiness(f.original),expected=taxServiceFixture('applied-receipt-e32-352-local');
  assert.equal(p.receipt.profile,TAX_SERVICE_APPLIED_PROFILE);assert.deepEqual(p.receipt,expected.response.body);assert.deepEqual(p.expectation,expected.expectation);assert.deepEqual(p.originalTransaction,f.original);assert.equal(JSON.stringify(p.anchors),raw);assert.equal(snapshot(f),before);
  assert.equal(f.requests.length,1);const request=f.requests[0];assert.equal(request.init?.method,'GET');assert.equal(request.init?.redirect,'error');assert.equal(new URL(request.url).origin,'https://erp.fixture.invalid');const h=request.init?.headers as Record<string,string>;for(const key of ['Authorization','x-sync-token','x-tenant-id','x-terminal-id','x-device-id','x-device-token'])assert.ok(Object.keys(h).some(k=>k.toLowerCase()===key.toLowerCase()));
  f.credentials.deviceToken='fresh-synthetic-device-token';await f.readiness(f.original);assert.equal(new Headers(f.requests[1].init?.headers).get('x-device-token'),'fresh-synthetic-device-token');f.restart();assert.equal(snapshot(f),before);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);assert.equal(f.requests.filter(r=>r.init?.method==='POST').length,0);
 }finally{await f.close();}
});
const mutations:Record<string,(r:any)=>void>={missing:r=>{delete r.financial;},extra:r=>{r.financial.extra=1;},net:r=>{r.financial.netAmount=550;},tax:r=>{r.financial.taxAmount=49.5;},vat:r=>{r.financial.vatAmount=77;},service:r=>{r.financial.serviceChargeAmount=0;},classification:r=>{r.financial.taxBreakdown[1].type='TIP';},dgiiCode:r=>{r.financial.taxBreakdown[1].fiscalAdditionalTaxCode='002';},policy:r=>{r.financial.serviceTaxPolicySnapshot.legalTip.enabled=true;},profile:r=>{r.profile=APPLIED_PROFILE;},unknown:r=>{r.profile='UNKNOWN';},materialization:r=>{r.materialization.profile=APPLIED_PROFILE;},scope:r=>{r.scope.companyId=r.scope.tenantId;},environment:r=>{r.historicalEnvironment=2;},stamp:r=>{r.posAuthority.lines[0].v3SaleAuthority.inventoryCursor='drift';},payment:r=>{r.settlement.sourcePayment=null;},pending:r=>{r.decision='PENDING';}};
for(const [name,mutate]of Object.entries(mutations))test(`tax/service receipt ${name} conflict is HOLD, not a partial/normalized receipt`,async()=>{
 const f=await taxServiceLab();try{const r=structuredClone(f.wire.expectedResponse),before=snapshot(f);mutate(r);await assert.rejects(()=>validateAppliedReceiptV2(r,f.anchors,f.scope,f.original));assert.equal(snapshot(f),before);}finally{await f.close();}
});
for(const name of ['conflict-binding','conflict-service-type','conflict-tax-classification','conflict-tip-reclassification','conflict-total'])test(`ERP ${name}: compare observedTransaction without editing original fixture`,async()=>{
 const f=await taxServiceLab();try{const fixture=taxServiceFixture(name),before=JSON.stringify(fixture),observed=fixture.comparison.observedTransaction;assert.ok(observed);const anchors=structuredClone(f.anchors),sale=JSON.parse(anchors.sale.payload_json);sale.transaction=observed;anchors.sale.payload_json=JSON.stringify(sale);await assert.rejects(()=>validateFiscalOriginal(anchors,f.scope));assert.equal(JSON.stringify(fixture),before);}finally{await f.close();}
});
const sourceMutations:Record<string,(t:any)=>void>={header:t=>{t.serviceChargeAmount=27.5;},voluntary:t=>{t.voluntaryTipAmount=27.5;},aliasNet:t=>{t.net_amount=352;},aliasService:t=>{t.service_type='TAKEOUT';},lineAlias:t=>{t.items[0].tax_rate=0.18;},unitAlias:t=>{t.items[0].unit_price=352;},qtyAlias:t=>{t.items[0].qty=2;},code:t=>{t.taxBreakdown[1].fiscalAdditionalTaxCode='002';},base:t=>{t.taxBreakdown[1].taxableBase=550;},taxId:t=>{t.items[0].appliedTaxIds.reverse();},missingEnvironment:t=>{delete t.fiscalEnvironment;},snapshot:t=>{t.fiscalIssuance.fiscalAllocationId=null;},fingerprint:t=>{t.v3CommitFingerprint='changed';}};
for(const [name,mutate]of Object.entries(sourceMutations))test(`full original tax/service ${name} cannot be repaired into eligibility`,async()=>{
 const f=await taxServiceLab();try{const anchors=structuredClone(f.anchors),sale=JSON.parse(anchors.sale.payload_json);mutate(sale.transaction);anchors.sale.payload_json=JSON.stringify(sale);await assert.rejects(()=>validateFiscalOriginal(anchors,f.scope));}finally{await f.close();}
});
test('generic ERP profile is not coupled to fixture SKU or POS policy source',async()=>{
 const f=await taxServiceLab();try{const a=structuredClone(f.anchors),sale=JSON.parse(a.sale.payload_json),payment=JSON.parse(a.payment!.payload_json),tx=sale.transaction;tx.items[0].sku='OTHER';tx.serviceTaxPolicySnapshot.source='TERMINAL';sale.summary.service_tax_policy_snapshot=tx.serviceTaxPolicySnapshot;payment.summary.service_tax_policy_snapshot=tx.serviceTaxPolicySnapshot;tx.v3CommitFingerprint=financialOperationIdentity(tx,tx.v3WarehouseId,{});a.sale.payload_json=JSON.stringify(sale);a.payment!.payload_json=JSON.stringify(payment);assert.equal((await validateFiscalOriginal(a,f.scope)).profile,TAX_SERVICE_APPLIED_PROFILE);}finally{await f.close();}
});
for(const mode of ['redirect','timeout','scope-drift','invalid'])test(`GET ${mode} leaves SQLite and claim absent, never falls back or POSTs`,async()=>{
 const f=await taxServiceLab();try{const before=snapshot(f);f.handle((req,res)=>{if(mode==='timeout')return;if(mode==='redirect'){res.statusCode=307;res.setHeader('location','/fallback');res.end();return;}if(mode==='scope-drift')f.credentials.deviceToken='drift';if(mode==='invalid'){res.setHeader('content-type','application/json');res.end('{}');return;}f.standard(req,res);});await assert.rejects(()=>f.readiness(f.original));assert.equal(f.requests.length,1);assert.equal(snapshot(f),before);assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);}finally{await f.close();}
});
test('expanded receipt cannot open dispatcher: zero commit/markers/POST even with injected valid readiness',async()=>{
 const f=await taxServiceLab();try{const before=snapshot(f),p=await f.readiness(f.original);let commits=0;f.deps.assertReady=async()=>p;f.deps.commit=async()=>{commits++;throw Error('must not commit');};await assert.rejects(()=>createMSellerDispatcher(f.deps)(f.input),/FISCAL_ERP_APPLIED_RECEIPT_REQUIRED/);assert.equal(commits,0);assert.equal(snapshot(f),before);assert.equal(f.requests.filter(r=>r.init?.method==='POST').length,0);}finally{await f.close();}
});
test('native SQLite claim batch separately rejects valid tax/service receipt before any write',async()=>{
 const f=await taxServiceLab();try{const before=snapshot(f),p=await f.readiness(f.original),scope={basis:'PERSISTED_SUBMISSION_INTENT',providerId:'MSELLER',environment:0,issuerRnc:p.receipt.issuer.rnc,...f.scope,binding:f.original.v3Binding,sourceChecksum:p.receipt.sourceDocument.checksum,capturedAt:'2026-10-17T16:00:00.000Z'},catalog=await f.deps.catalog(),config=await f.get('config','current');
 const claim={id:f.id,schemaVersion:2,state:'DISPATCH_INTENT',sourceTransactionId:f.id,providerId:'MSELLER',scope:f.context().descriptor,submissionScope:scope,sourceChecksum:scope.sourceChecksum,requestSha256:'a'.repeat(64),claimedAt:scope.capturedAt,appliedReceipt:p.receipt,appliedReceiptExpectation:p.expectation,outboxAnchors:p.anchors};
 const rows:any[]=[{collectionName:FISCAL_DISPATCH_CLAIMS,document:claim,requireAbsent:true,v3FiscalMetadataOperation:'FISCAL_DISPATCH_CLAIM'},...['transactions','transactionHistory'].map(collectionName=>({collectionName,document:{...f.original,fiscalSubmissionScope:scope,fiscalProviderStatus:'V3_ISSUE_REQUESTED'},expectedDocument:JSON.stringify(f.original),v3CurrentCatalog:catalog,v3FiscalMetadataOperation:'FISCAL_DISPATCH_CLAIM'})),{collectionName:'config',document:config,expectedDocument:JSON.stringify(config),v3FiscalMetadataOperation:'FISCAL_DISPATCH_CLAIM'}];
 await assert.rejects(()=>f.adapter.saveDocumentsAtomically(rows),/SYNC_V3_FISCAL_METADATA_MUTATION_DENIED/);assert.equal(snapshot(f),before);f.restart();assert.equal(await f.get(FISCAL_DISPATCH_CLAIMS,f.id),null);
 }finally{await f.close();}
});
test('opaque pin retained literally; expectation digest/profile drift cannot replace prepared original',async()=>{
 const f=await taxServiceLab();try{const p=await f.readiness(f.original);for(const field of ['digest','profile']){const changed=structuredClone(p);if(field==='digest')changed.expectation.observation.digest='a'.repeat(64);else changed.expectation.profile=APPLIED_PROFILE;await assert.rejects(()=>validatePreparedAppliedReceipt(changed,f.scope,f.original),/EXPECTATION_MISMATCH/);}assert.equal(p.receipt.observation.digest,taxServiceFixture('applied-receipt-e32-352-local').response.body.observation.digest);}finally{await f.close();}
});

test('Caja6 policy restricts tax candidate to agreed SKU182 x1/352; other scopes and environment remain held (synthetic source only)',async()=>{
 const {selectionNativeFixture}=await import('./helpers/fiscalSelectionNative');const {buildSalePostedSummary}=await import('../services/sync/SalePostedContract');const f=await selectionNativeFixture();
 try{
  // Deliberate synthetic derivative for policy tests, never a repaired operational source or NCF reservation.
  const reference=taxServiceFixture('e32-352-original'),tx=structuredClone(reference.transaction),binding=(await f.deps.catalog()).binding;
  tx.terminalId=f.scope.terminalId;tx.v3Binding=binding;tx.items[0].v3SaleAuthority.binding=binding;
  const stamp=tx.items[0].v3SaleAuthority;tx.v3InventoryBaseline=JSON.stringify([binding,stamp.inventorySyncId,stamp.inventorySyncVersion,stamp.inventoryVersion,stamp.inventoryCursor]);
  tx.ncf=tx.electronicNcf='E320000000500';tx.fiscalIssuance={...f.input.fiscalMaster,ncf:tx.ncf,sequence:500,capturedAt:reference.transaction.fiscalIssuance.capturedAt};
  const derive=(change?:(t:any)=>void)=>{const value=structuredClone(tx);change?.(value);value.v3CommitFingerprint=financialOperationIdentity(value,value.v3WarehouseId,{});const summary=buildSalePostedSummary(value),scope=Object.fromEntries(Object.entries(f.scope).map(([k,v])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),v]));const sale={...reference.salePayload,...scope,transaction:value,summary},payment={...reference.paymentPayload,...scope,summary,payments:value.payments};const rows=[{event_id:reference.sourceSaleEventId,event_type:'SALE_POSTED',aggregate_type:'TRANSACTION',aggregate_id:value.id,schema_version:1,payload_json:JSON.stringify(sale)},{event_id:reference.sourcePaymentEventId,event_type:'PAYMENT_POSTED',aggregate_type:'TRANSACTION',aggregate_id:value.id,schema_version:1,payload_json:JSON.stringify(payment)}];return {value,rows};};
  const source=derive();await f.policy.source(f.context(),f.config(),binding,source.value,source.value,source.rows);
  for(const change of [(t:any)=>{t.items[0].sku='183';},(t:any)=>{t.fiscalEnvironment=2;},(t:any)=>{t.pendingBalance=1;},(t:any)=>{t.serviceType='TAKEOUT';},(t:any)=>{t.items[0].quantity=2;},(t:any)=>{t.taxBreakdown[1].fiscalAdditionalTaxCode='002';}]){const altered=derive(change);await assert.rejects(()=>f.policy.source(f.context(),f.config(),binding,altered.value,altered.value,altered.rows));}
  for(const key of ['tenantId','companyId','storeId','terminalId','deviceId'])await assert.rejects(()=>f.policy.live({...f.context(),descriptor:{...f.context().descriptor,[key]:'foreign'}},f.config(),binding));
  assert.equal(f.metrics().commits,0);assert.equal(f.metrics().gets,0);assert.equal(f.metrics().posts,0);
 }finally{await f.close();}
});
