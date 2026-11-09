import {DISPATCH_QUERY_INDEX_SCHEMA} from '../services/db/CompanyDispatchEscrowStore';
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFixture,id} from './articleFormatsNativeFixture';
const document={id:id(90),inventoryEffectsContract:'WAREHOUSE_RESERVATION_V1',v3Binding:'',companyDispatchSource:{schemaVersion:1,source:'COMPANY_DISPATCH_ESCROW_V1',checkoutId:'checkout',bindingId:'binding',generation:'generation',policyRevision:1,lines:[{cartId:'cart',quotaAllocations:[{quotaId:'quota',quantityMinor:1000000,dimensions:{},authorityHash:'hash',deliveryWitnessHash:'witness'}]}]},items:[{id:id(7),cartId:'cart',quantity:1}],total:60,payments:[{id:id(91),amount:60}]};
const commit=()=>({documents:[{collectionName:'transactions',document,requireAbsent:true},{collectionName:'transactionHistory',document,requireAbsent:true}],outboxEvent:{eventId:id(92),eventType:'SALE_POSTED',aggregateType:'transaction',aggregateId:document.id,schemaVersion:2,payload:{transaction:document},createdAt:'2026-11-06T16:00:00Z'},dispatchCommit:{checkoutId:'checkout',transactionId:document.id}});
async function setup({withCursor=true}={}){const f=await nativeFixture();f.db.exec("INSERT INTO pos_dispatch_pool_v1 VALUES('pool','binding','generation',1,'WAREHOUSE_DISPATCH',NULL,NULL);");if(withCursor)f.db.exec("INSERT INTO pos_dispatch_capture_cursor_v1 VALUES('pool',0)");f.db.exec("INSERT INTO pos_dispatch_active_pool_v1 SELECT 1,'pool',binding FROM master_v3_operational_owner WHERE singleton=1");document.v3Binding=String((f.db.prepare('SELECT binding FROM master_v3_operational_owner WHERE singleton=1').get() as {binding:string}).binding);
const master={id:id(7),tenant_id:id(1),company_id:id(2),type:'PRODUCT',metadata:{}};
const authority={scope:{tenantId:id(1),companyId:id(2),storeId:id(3),terminalId:id(4),deviceId:id(50),bindingId:'binding',generation:'generation'},policyRevision:1,itemId:id(7),dimensions:{},catalogSource:{commercialItem:master,rawGraph:[master],tariffs:[],taxes:[]}};
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
 const scope={tenantId:id(1),companyId:id(2),storeId:id(3),terminalId:id(4),deviceId:id(50)};
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
test('an existing foreign outbox event ID rejects the whole financial plan before quota or cursor consumption',async t=>{
 const f=await setup();t.after(()=>f.db.close());await f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:document,demands:[{quotaId:'quota',quantityMinor:1000000}]});await f.adapter.markDispatchEffectPossible('checkout','b'.repeat(64),document.payments);
 const foreign=JSON.stringify({transaction:{id:id(199),total:999}});f.db.prepare("INSERT INTO sync_outbox_v2(event_id,event_type,aggregate_type,aggregate_id,schema_version,payload_json,created_at,updated_at)VALUES(?,'SALE_POSTED','TRANSACTION',?,1,?,'old','old')").run(id(92),id(199),foreign);
 await assert.rejects(f.adapter.commitFinancialTransaction(commit()),/DISPATCH_OUTBOX_EVENT_CONFLICT/);
 assert.equal((f.db.prepare('SELECT consumed_minor n FROM pos_dispatch_quota_v1').get() as {n:number}).n,0);assert.equal((f.db.prepare('SELECT last_sequence n FROM pos_dispatch_capture_cursor_v1').get() as {n:number}).n,0);assert.equal(f.documents('transactions').length,0);
 assert.equal((f.db.prepare('SELECT payload_json FROM sync_outbox_v2').get() as {payload_json:string}).payload_json,foreign);
});
test('a silently ignored outbox INSERT is detected by a same-transaction postcondition and rolls all effects back',async t=>{
 const f=await setup();t.after(()=>f.db.close());await f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:document,demands:[{quotaId:'quota',quantityMinor:1000000}]});await f.adapter.markDispatchEffectPossible('checkout','b'.repeat(64),document.payments);
 f.db.exec('CREATE TRIGGER silently_ignore_outbox BEFORE INSERT ON sync_outbox_v2 BEGIN SELECT RAISE(IGNORE);END');
 await assert.rejects(f.adapter.commitFinancialTransaction(commit()),/DISPATCH_OUTBOX_EVENT_CONFLICT/);
 assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_native_capture_v1').get() as {n:number}).n,0);assert.equal((f.db.prepare('SELECT last_sequence n FROM pos_dispatch_capture_cursor_v1').get() as {n:number}).n,0);assert.equal((f.db.prepare('SELECT consumed_minor n FROM pos_dispatch_quota_v1').get() as {n:number}).n,0);assert.equal(f.documents('transactionHistory').length,0);
 assert.equal((f.db.prepare('SELECT phase FROM pos_dispatch_precharge_v1').get() as {phase:string}).phase,'EFFECT_POSSIBLE');
});
test('exact financial replay preserves outbox status and never reapplies ancillary mutations; changed plans conflict',async t=>{
 const f=await setup();t.after(()=>f.db.close());await f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:document,demands:[{quotaId:'quota',quantityMinor:1000000}]});await f.adapter.markDispatchEffectPossible('checkout','b'.repeat(64),document.payments);
 const input=commit();input.documents.push({collectionName:'wallets',document:{id:'wallet',balance:10} as any,requireAbsent:true});await f.adapter.commitFinancialTransaction(input);
 await f.adapter.saveDocument('wallets',{id:'wallet',balance:15});f.db.exec("UPDATE sync_outbox_v2 SET status='SENDING'");
 await f.adapter.commitFinancialTransaction(input);assert.equal(f.documents('wallets')[0].balance,15);assert.equal((f.db.prepare('SELECT status FROM sync_outbox_v2').get() as {status:string}).status,'SENDING');assert.equal((f.db.prepare('SELECT last_sequence n FROM pos_dispatch_capture_cursor_v1').get() as {n:number}).n,1);
 const changed=structuredClone(input);(changed.documents.at(-1)!.document as any).balance=999;
 await assert.rejects(f.adapter.commitFinancialTransaction(changed),/DISPATCH_CAPTURE_REPLAY_CONFLICT/);assert.equal(f.documents('wallets')[0].balance,15);assert.equal((f.db.prepare('SELECT consumed_minor n FROM pos_dispatch_quota_v1').get() as {n:number}).n,1000000);
});
test('a silently ignored history write cannot commit a capture or publish its outbox',async t=>{
 const f=await setup();t.after(()=>f.db.close());await f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:document,demands:[{quotaId:'quota',quantityMinor:1000000}]});await f.adapter.markDispatchEffectPossible('checkout','b'.repeat(64),document.payments);
 f.db.exec("CREATE TRIGGER silently_ignore_history BEFORE INSERT ON documents WHEN NEW.collection_name='transactionHistory' BEGIN SELECT RAISE(IGNORE);END");
 await assert.rejects(f.adapter.commitFinancialTransaction(commit()),/DISPATCH_RETAINED_SOURCE_REQUIRED/);
 assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as {n:number}).n,0);assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_native_capture_v1').get() as {n:number}).n,0);assert.equal((f.db.prepare('SELECT consumed_minor n FROM pos_dispatch_quota_v1').get() as {n:number}).n,0);
});
test('the prior capture schema upgrades without fabricating a missing financial-plan proof or replaying its mutations',async t=>{
 const f=await setup();t.after(()=>f.db.close());await f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:document,demands:[{quotaId:'quota',quantityMinor:1000000}]});await f.adapter.markDispatchEffectPossible('checkout','b'.repeat(64),document.payments);const input=commit();await f.adapter.commitFinancialTransaction(input);
 const source=structuredClone(f.documents('transactionHistory')[0]);
 f.db.exec('ALTER TABLE pos_dispatch_native_capture_v1 DROP COLUMN financial_intent_digest');await (f.adapter as unknown as {initSchema():Promise<void>}).initSchema();
 assert.equal((f.db.prepare('SELECT financial_intent_digest FROM pos_dispatch_native_capture_v1').get() as {financial_intent_digest:string|null}).financial_intent_digest,null);
 await assert.rejects(f.adapter.commitFinancialTransaction(input),/DISPATCH_CAPTURE_RECONCILIATION_REQUIRED/);
 assert.deepEqual(f.documents('transactionHistory')[0],source);assert.equal((f.db.prepare('SELECT last_sequence n FROM pos_dispatch_capture_cursor_v1').get() as {n:number}).n,1);assert.equal((f.db.prepare('SELECT consumed_minor n FROM pos_dispatch_quota_v1').get() as {n:number}).n,1000000);
});
test('the native financial plan is isolated without requiring structuredClone in an older WebView',async t=>{
 const f=await setup();t.after(()=>f.db.close());await f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:document,demands:[{quotaId:'quota',quantityMinor:1000000}]});await f.adapter.markDispatchEffectPossible('checkout','b'.repeat(64),document.payments);
 const input=commit(),original=Object.getOwnPropertyDescriptor(globalThis,'structuredClone');Object.freeze(input);Object.freeze(input.documents);
 Object.defineProperty(globalThis,'structuredClone',{value:undefined,configurable:true,writable:true});
 try{await f.adapter.commitFinancialTransaction(input);}finally{if(original)Object.defineProperty(globalThis,'structuredClone',original);else delete(globalThis as any).structuredClone;}
 assert.equal(f.documents('transactionHistory')[0].companyDispatchSource.sequence,1);assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as {n:number}).n,1);
});

async function capturedForAck(f:Awaited<ReturnType<typeof setup>>){
 const {buildSalePostedPayload}=await import('../services/sync/SalePostedContract');
 const receipt={...structuredClone(document),date:'2026-11-06T16:00:00Z',items:document.items.map(line=>({...line,totalAmount:60}))};
 const input=commit();input.documents=input.documents.map(row=>({...row,document:receipt}));input.outboxEvent.payload={...buildSalePostedPayload(receipt as any),transaction:receipt};
 await f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:receipt.id,poolId:'pool',demandDigest:'a'.repeat(64),source:receipt,demands:[{quotaId:'quota',quantityMinor:1000000}]});await f.adapter.markDispatchEffectPossible('checkout','b'.repeat(64),receipt.payments);await f.adapter.commitFinancialTransaction(input);
 const source=f.documents('transactionHistory')[0];const {canonicalDispatchJSON}=await import('../services/db/CompanyDispatchEscrowStore');
 const nativeSourceHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalDispatchJSON(source)))),n=>n.toString(16).padStart(2,'0')).join('');
 return{sourceEventId:id(92),sourceHash:'e'.repeat(64),bindingId:'binding',generation:'generation',acceptedSequence:1,quotaEffects:[{quotaId:'quota',eventId:id(193),quantityMinor:1000000}],nativeSourceDigestVersion:'DISPATCH_NATIVE_JSON_V1' as const,nativeSourceHash};
}
test('actual sender + native repository requires a direct ERP receipt even if the master says APPLIED; retry adopts once without recredit',async t=>{
 const f=await setup();t.after(()=>f.db.close());const proof=await capturedForAck(f);
 const {DurableOutboxRepository}=await import('../services/sync/DurableOutboxRepository');const {DurableOutboxBatchSender}=await import('../services/sync/DurableOutboxBatchSender');
 const repository=new DurableOutboxRepository(f.adapter);let available=false,reads=0;
 const sender=new DurableOutboxBatchSender(repository,async()=>({eventResults:[{eventId:id(92),disposition:'APPLIED',dispatchAdoptionProof:{forged:true}}]}),async ids=>{reads++;assert.deepEqual(ids,[id(92)]);return available?[proof]:[];});
 const first=await sender.sendNext(new Date('2026-11-06T16:01:00Z'));assert.equal(first.applied,0);assert.equal(first.retrying,1);assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_adoption_v1').get() as {n:number}).n,0);
 available=true;const second=await sender.sendNext(new Date('2026-11-06T16:02:00Z'));assert.equal(second.applied,1);assert.equal(reads,2);assert.equal((f.db.prepare('SELECT status FROM sync_outbox_v2').get() as {status:string}).status,'APPLIED_ERP');assert.equal((f.db.prepare('SELECT consumed_minor n FROM pos_dispatch_quota_v1').get() as {n:number}).n,1000000);
 const before=f.db.prepare('SELECT * FROM sync_outbox_v2').get();await f.adapter.acknowledgeDispatchAdoption(id(92),proof,'2026-11-06T17:00:00Z');assert.deepEqual(f.db.prepare('SELECT * FROM sync_outbox_v2').get(),before);
 await assert.rejects(f.adapter.acknowledgeDispatchAdoption(id(92),{...proof,sourceHash:'f'.repeat(64)},'2026-11-06T17:00:00Z'),/ADOPTION_REPLAY_CONFLICT/);
});
test('native ACK rejects wrong sequence, source, grant or generation atomically and bare APPLIED cannot bypass it',async t=>{
 const f=await setup();t.after(()=>f.db.close());const proof=await capturedForAck(f);f.db.exec("UPDATE sync_outbox_v2 SET status='SENDING'");
 assert.throws(()=>f.db.exec("UPDATE sync_outbox_v2 SET status='APPLIED_ERP'"),/ERP_ADOPTION_PROOF_REQUIRED/);
 for(const changed of [{...proof,acceptedSequence:2},{...proof,generation:'other'},{...proof,nativeSourceHash:'0'.repeat(64)},{...proof,quotaEffects:[{...proof.quotaEffects[0],quantityMinor:2000000}]}]){
  await assert.rejects(f.adapter.acknowledgeDispatchAdoption(id(92),changed,'2026-11-06T17:00:00Z'),/DISPATCH_ADOPTION_/);assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_adoption_v1').get() as {n:number}).n,0);assert.equal((f.db.prepare('SELECT status FROM sync_outbox_v2').get() as {status:string}).status,'SENDING');
 }
 f.db.exec("CREATE TRIGGER ignore_ack BEFORE UPDATE OF status ON sync_outbox_v2 WHEN NEW.status='APPLIED_ERP' BEGIN SELECT RAISE(IGNORE);END");
 await assert.rejects(f.adapter.acknowledgeDispatchAdoption(id(92),proof,'2026-11-06T17:00:00Z'),/ADOPTION_WRITE_REQUIRED/);assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_adoption_v1').get() as {n:number}).n,0);
});

test('a prototype bare APPLIED receipt is requeued unchanged for retained-proof reconciliation, never re-financed',async t=>{
 const f=await setup();t.after(()=>f.db.close());await capturedForAck(f);
 f.db.exec("DROP TRIGGER dispatch_outbox_proof_required;UPDATE sync_outbox_v2 SET status='APPLIED_ERP'");
 const before=f.db.prepare('SELECT event_id,payload_json FROM sync_outbox_v2').get();await (f.adapter as unknown as {initSchema():Promise<void>}).initSchema();
 assert.equal((f.db.prepare('SELECT status FROM sync_outbox_v2').get() as {status:string}).status,'RETRY_WAIT');assert.deepEqual(f.db.prepare('SELECT event_id,payload_json FROM sync_outbox_v2').get(),before);assert.equal((f.db.prepare('SELECT consumed_minor n FROM pos_dispatch_quota_v1').get() as {n:number}).n,1000000);assert.equal((f.db.prepare('SELECT last_sequence n FROM pos_dispatch_capture_cursor_v1').get() as {n:number}).n,1);
});

test('restart cannot turn an unresolved nonfiscal payment into another funded checkout even when quota remains',async t=>{
 const f=await setup();t.after(()=>f.db.close());f.db.exec("INSERT INTO pos_dispatch_quota_v1 SELECT 'spare',pool_id,authority_json,authority_hash,2000000,0,0,'ACTIVE' FROM pos_dispatch_quota_v1;INSERT INTO pos_dispatch_quota_delivery_v1 VALUES('spare','witness')");
 await f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:document,demands:[{quotaId:'quota',quantityMinor:1000000}]});await f.adapter.markDispatchEffectPossible('checkout','b'.repeat(64),document.payments);
 const {CapacitorSQLiteAdapter}=await import('../services/db/adapters/CapacitorSQLiteAdapter');const restarted=new CapacitorSQLiteAdapter();Object.assign(restarted,{db:(f.adapter as any).db,isReady:true});
 const next=structuredClone(document);next.id=id(999);next.companyDispatchSource.checkoutId='after-restart';next.companyDispatchSource.lines[0].quotaAllocations[0].quotaId='spare';
 await assert.rejects(restarted.prepareDispatchPrecharge({checkoutId:'after-restart',transactionId:next.id,poolId:'pool',demandDigest:'a'.repeat(64),source:next,demands:[{quotaId:'spare',quantityMinor:1000000}]}),/PREVIOUS_PAYMENT_RECONCILIATION_REQUIRED/);
 assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_precharge_v1').get() as any).n,1);assert.equal((f.db.prepare('SELECT phase FROM pos_dispatch_precharge_v1').get() as any).phase,'EFFECT_POSSIBLE');assert.equal((f.db.prepare('SELECT consumed_minor n FROM pos_dispatch_quota_v1').get() as any).n,0);
 await restarted.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:document,demands:[{quotaId:'quota',quantityMinor:1000000}]});
});

test('quota read indexes remove correlated history scans without changing V1 source, counters, schema digest or replay',async t=>{
 const f=await setup();t.after(()=>f.db.close());await f.adapter.prepareDispatchPrecharge({checkoutId:'checkout',transactionId:document.id,poolId:'pool',demandDigest:'a'.repeat(64),source:document,demands:[{quotaId:'quota',quantityMinor:1000000}]});await f.adapter.markDispatchEffectPossible('checkout','b'.repeat(64),document.payments);const input=commit();await f.adapter.commitFinancialTransaction(input);
 const snapshot=()=>JSON.stringify(['pos_dispatch_quota_v1','pos_dispatch_precharge_v1','pos_dispatch_precharge_lines_v1','pos_dispatch_native_capture_v1','pos_dispatch_capture_cursor_v1','sync_outbox_v2','documents'].map(table=>[table,f.db.prepare(`SELECT * FROM ${table}`).all()]));const before=snapshot(),schemaHash=await f.adapter.dispatchNativeSchemaHash();f.db.exec('DROP INDEX dispatch_precharge_quota_checkout_v1;DROP INDEX dispatch_quota_pool_state_id_v1');
 const bridge=(f.adapter as any).db,queries:Array<{sql:string;params:unknown[]}>=[],original=bridge.query.bind(bridge);bridge.query=async(sql:string,params:unknown[]=[])=>{queries.push({sql,params});return original(sql,params);};await f.adapter.readDispatchCheckoutAuthority();const read=queries.find(q=>q.sql.includes('COALESCE((SELECT SUM(l.quantity_minor)'));assert.ok(read,'explain the production authority query');const oldPlan=f.db.prepare('EXPLAIN QUERY PLAN '+read.sql).all(...read.params)as Array<{detail:string}>;assert.ok(oldPlan.some(row=>/SCAN l(?:$| )/.test(row.detail)),JSON.stringify(oldPlan));
 f.db.exec(DISPATCH_QUERY_INDEX_SCHEMA);f.db.exec(DISPATCH_QUERY_INDEX_SCHEMA);const plan=f.db.prepare('EXPLAIN QUERY PLAN '+read.sql).all(...read.params)as Array<{detail:string}>;assert.ok(plan.some(row=>row.detail.includes('dispatch_precharge_quota_checkout_v1')),JSON.stringify(plan));assert.ok(plan.some(row=>row.detail.includes('dispatch_quota_pool_state_id_v1')),JSON.stringify(plan));assert.ok(!plan.some(row=>/SCAN l(?:$| )/.test(row.detail)),JSON.stringify(plan));assert.equal(snapshot(),before);assert.equal(await f.adapter.dispatchNativeSchemaHash(),schemaHash);await f.adapter.commitFinancialTransaction(input);assert.equal(snapshot(),before,'exact financial replay remains a no-op after index upgrade');
});
