import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFixture,id} from './articleFormatsNativeFixture';
const document={id:id(90),inventoryEffectsContract:'WAREHOUSE_RESERVATION_V1',v3Binding:'',companyDispatchSource:{schemaVersion:1,source:'COMPANY_DISPATCH_ESCROW_V1',checkoutId:'checkout',bindingId:'binding',generation:'generation',policyRevision:1,lines:[{cartId:'cart',quotaAllocations:[{quotaId:'quota',quantityMinor:1000000,dimensions:{},authorityHash:'hash',deliveryWitnessHash:'witness'}]}]},items:[{id:id(7),cartId:'cart',quantity:1}],total:60,payments:[{id:id(91),amount:60}]};
const commit=()=>({documents:[{collectionName:'transactions',document,requireAbsent:true},{collectionName:'transactionHistory',document,requireAbsent:true}],outboxEvent:{eventId:id(92),eventType:'SALE_POSTED',aggregateType:'transaction',aggregateId:document.id,schemaVersion:2,payload:{transaction:document},createdAt:'2026-11-06T16:00:00Z'},dispatchCommit:{checkoutId:'checkout',transactionId:document.id}});
async function setup({withCursor=true}={}){const f=await nativeFixture();f.db.exec("INSERT INTO pos_dispatch_pool_v1 VALUES('pool','binding','generation',1,'WAREHOUSE_DISPATCH',NULL,NULL);");if(withCursor)f.db.exec("INSERT INTO pos_dispatch_capture_cursor_v1 VALUES('pool',0)");f.db.exec("INSERT INTO pos_dispatch_active_pool_v1 SELECT 1,'pool',binding FROM master_v3_operational_owner WHERE singleton=1");document.v3Binding=String((f.db.prepare('SELECT binding FROM master_v3_operational_owner WHERE singleton=1').get() as {binding:string}).binding);
const master={id:id(7),tenant_id:'tenant',company_id:'company',type:'PRODUCT',metadata:{}};
const authority={scope:{tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device',bindingId:'binding',generation:'generation'},policyRevision:1,itemId:id(7),dimensions:{},catalogSource:{commercialItem:master,rawGraph:[master],tariffs:[],taxes:[]}};
f.db.prepare("INSERT INTO pos_dispatch_quota_v1 VALUES('quota','pool',?,'hash',1000000,0,0,'ACTIVE')").run(JSON.stringify(authority));
f.db.prepare('INSERT INTO pos_dispatch_quota_delivery_v1 VALUES(?,?)').run('quota','witness');
const bridge=(f.adapter as unknown as {db:{run:(sql:string,p:unknown[],transaction?:boolean)=>Promise<unknown>}}).db;const original=bridge.run.bind(bridge);bridge.run=async(sql,p,transaction)=>{if(/(?:INSERT INTO|UPDATE) pos_dispatch_/.test(sql))assert.equal(transaction,false,'Capacitor run must not own nested transaction');return original(sql,p,transaction);};return f;}
test('production native adapter serializes precharge and commits quota+document+history+outbox in one writer transaction',async t=>{const f=await setup();t.after(()=>f.db.close());await f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:document,demands:[{quotaId:'quota',quantityMinor:1000000}]});await f.adapter.markDispatchEffectPossible('checkout','b'.repeat(64),document.payments);await f.adapter.commitFinancialTransaction(commit());assert.equal((f.db.prepare('SELECT consumed_minor n FROM pos_dispatch_quota_v1').get() as {n:number}).n,1000000);assert.equal(f.documents('transactions').length,1);assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as {n:number}).n,1);});
test('canonical durable pool denies a legacy caller that strips both dispatch markers',async t=>{const f=await setup();t.after(()=>f.db.close());const input=commit();delete (input as {dispatchCommit?:unknown}).dispatchCommit;const legacy={...document};delete (legacy as {inventoryEffectsContract?:unknown}).inventoryEffectsContract;input.documents=input.documents.map(x=>({...x,document:legacy}));input.outboxEvent.payload.transaction=legacy;await assert.rejects(f.adapter.commitFinancialTransaction(input),/CANONICAL_POOL_REQUIRES_ESCROW_COMMIT/);assert.equal(f.documents('transactions').length,0);assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as {n:number}).n,0);});
test('native prepare recomputes cart demand from installed source instead of trusting a copied demand digest',async t=>{
 const f=await setup();t.after(()=>f.db.close());const forged=structuredClone(document);forged.items[0].quantity=100;
 await assert.rejects(f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:forged,demands:[{quotaId:'quota',quantityMinor:1000000}]}),/PHYSICAL_DEMAND_NOT_FINANCED/);
 assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_precharge_v1').get() as {n:number}).n,0);
 assert.equal((f.db.prepare('SELECT consumed_minor n FROM pos_dispatch_quota_v1').get() as {n:number}).n,0);
});
test('native prepare rejects checkout owner or retained authority changes before any possible payment effect',async t=>{
 const f=await setup();t.after(()=>f.db.close());const foreign=structuredClone(document);foreign.v3Binding='foreign';
 await assert.rejects(f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:foreign,demands:[{quotaId:'quota',quantityMinor:1000000}]}),/NATIVE_OWNER_MISMATCH/);
 const tampered=structuredClone(document);tampered.companyDispatchSource.lines[0].quotaAllocations[0].authorityHash='foreign';
 await assert.rejects(f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:tampered,demands:[{quotaId:'quota',quantityMinor:1000000}]}),/ISSUED_LINE_SCOPE/);
 assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_precharge_v1').get() as {n:number}).n,0);
});
test('joint native preparation rolls fiscal permit back on unfunded quota then retains one shared identity on retry',async t=>{
 const f=await setup();t.after(()=>f.db.close());
 const scope={tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device'};
 const {fiscalWorkflowScopeKey}=await import('../services/fiscal/FiscalWorkflowV2Types');const scopeKey=fiscalWorkflowScopeKey(scope);
 const store=f.adapter.fiscalWorkflowStore;const op=await store.refillOperation(scopeKey);
 await store.savePermits(scopeKey,op,[{schemaVersion:2,permitId:id(180),transactionId:id(181),nonce:'nonce',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),scope,issuerRnc:'101010101',environment:0,authorityHash:'a'.repeat(64),operationKind:'SALE',state:'PERMIT'}]);
 const source=structuredClone(document);source.items[0].quantity=2;source.companyDispatchSource.lines[0].quotaAllocations[0].quantityMinor=2000000;
 const input={cartIdentity:'joint-cart',operationId:id(182),poolId:'pool',demandDigest:'a'.repeat(64),source,demands:[{quotaId:'quota',quantityMinor:2000000}],fiscal:{kind:'PERMIT' as const,scopeKey,options:{requirePermit:true,authorityHash:'a'.repeat(64)}}};
 await assert.rejects(f.adapter.prepareDispatchFiscalCheckout(input),/QUOTA_EXHAUSTED/);
 assert.equal((f.db.prepare('SELECT state FROM pos_fiscal_permits_v2').get() as {state:string}).state,'AVAILABLE');
 assert.equal((f.db.prepare('SELECT count(*) n FROM pos_fiscal_checkouts_v2').get() as {n:number}).n,0);
 source.items[0].quantity=1;source.companyDispatchSource.lines[0].quotaAllocations[0].quantityMinor=1000000;input.demands[0].quantityMinor=1000000;
 const checkout=await f.adapter.prepareDispatchFiscalCheckout(input);const replay=await f.adapter.prepareDispatchFiscalCheckout(input);
 assert.deepEqual(replay,checkout);assert.equal(checkout.transactionId,id(181));
 assert.equal((f.db.prepare('SELECT transaction_id FROM pos_dispatch_precharge_v1').get() as {transaction_id:string}).transaction_id,checkout.transactionId);
 assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_precharge_v1').get() as {n:number}).n,1);
});

test('native capture sequence, source and outbox roll back together; retry seals exactly one matching version',async t=>{
 const f=await setup();t.after(()=>f.db.close());
 await f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:document,demands:[{quotaId:'quota',quantityMinor:1000000}]});await f.adapter.markDispatchEffectPossible('checkout','b'.repeat(64),document.payments);
 f.db.exec("CREATE TRIGGER fail_dispatch_outbox BEFORE INSERT ON sync_outbox_v2 BEGIN SELECT RAISE(ABORT,'SYNTHETIC_OUTBOX_WRITE');END");
 await assert.rejects(f.adapter.commitFinancialTransaction(commit()),/SYNTHETIC_OUTBOX_WRITE/);
 assert.equal((f.db.prepare('SELECT last_sequence n FROM pos_dispatch_capture_cursor_v1').get() as {n:number}).n,0);
 assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_native_capture_v1').get() as {n:number}).n,0);
 assert.equal((f.db.prepare('SELECT phase FROM pos_dispatch_precharge_v1').get() as {phase:string}).phase,'EFFECT_POSSIBLE');
 assert.equal((f.db.prepare('SELECT consumed_minor n FROM pos_dispatch_quota_v1').get() as {n:number}).n,0);assert.equal(f.documents('transactions').length,0);
 f.db.exec('DROP TRIGGER fail_dispatch_outbox');const input=commit(),before=structuredClone(input);await f.adapter.commitFinancialTransaction(input);assert.deepEqual(input,before,'the native sequence must not mutate a caller draft after payment');
 const stored=f.documents('transactionHistory')[0],published=JSON.parse((f.db.prepare('SELECT payload_json FROM sync_outbox_v2').get() as {payload_json:string}).payload_json).transaction;
 assert.equal(stored.companyDispatchSource.sequence,1);assert.deepEqual(published,stored);assert.equal((f.db.prepare('SELECT last_sequence n FROM pos_dispatch_capture_cursor_v1').get() as {n:number}).n,1);
 assert.deepEqual(JSON.parse((f.db.prepare('SELECT source_snapshot_json FROM pos_dispatch_native_capture_v1').get() as {source_snapshot_json:string}).source_snapshot_json),stored);
 assert.throws(()=>f.db.prepare("UPDATE documents SET data=json_set(data,'$.companyDispatchSource.sequence',999) WHERE collection_name='transactionHistory'").run(),/DISPATCH_FINANCIAL_SOURCE_IMMUTABLE/);
 assert.throws(()=>f.db.prepare("UPDATE documents SET data=json_remove(data,'$.inventoryEffectsContract') WHERE collection_name='transactionHistory'").run(),/DISPATCH_FINANCIAL_SOURCE_IMMUTABLE/);
 assert.throws(()=>f.db.prepare("DELETE FROM documents WHERE collection_name='transactionHistory'").run(),/DISPATCH_RETAINED_SOURCE_REQUIRED/);
 await f.adapter.saveDocument('transactionHistory',{id:document.id,status:'SYNCED',total:1,companyDispatchSource:{sequence:999}});
 const retained=f.documents('transactionHistory')[0];assert.equal(retained.total,60);assert.equal(retained.companyDispatchSource.sequence,1);assert.equal(retained.status,'SYNCED');
});
test('a missing native capture cursor blocks preparation before a new payment can become possible',async t=>{
 const f=await setup({withCursor:false});t.after(()=>f.db.close());
 await assert.rejects(f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:document,demands:[{quotaId:'quota',quantityMinor:1000000}]}),/NATIVE_CURSOR_REQUIRED/);
 assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_precharge_v1').get() as {n:number}).n,0);
});

test('a stripped inventory contract fails native preparation before a possible payment, not merely at financial commit',async t=>{
 const f=await setup();t.after(()=>f.db.close());const source=structuredClone(document);delete (source as {inventoryEffectsContract?:string}).inventoryEffectsContract;
 await assert.rejects(f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source,demands:[{quotaId:'quota',quantityMinor:1000000}]}),/CANONICAL_CHECKOUT_SOURCE_REQUIRED/);
 assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_precharge_v1').get() as {n:number}).n,0);
});
