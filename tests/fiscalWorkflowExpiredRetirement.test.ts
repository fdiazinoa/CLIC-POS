import {FINANCIAL_COUNTER_UPSERT_SQL} from '../services/db/FinancialNumberReservation';
import {ARTICLE_FORMAT_RETAINED_UPSERT_SQL} from '../services/db/ArticleFormatFinancialRetention';
import {V3_FINANCIAL_RETAINED_UPSERT_SQL} from '../services/db/LargeMasterSyncV3FinancialRetention';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {NativeFiscalWorkflowV2Store,FISCAL_WORKFLOW_V2_SCHEMA} from '../services/db/FiscalWorkflowV2Store';
import {FISCAL_RETIREMENT_WRITER_SCHEMA,RETIREMENT_SCAN_LIMITS} from '../services/db/FiscalWorkflowRetirementStore';
import {DURABLE_OUTBOX_SCHEMA_SQL} from '../services/sync/DurableOutboxSchema';
import {CapacitorSQLiteAdapter} from '../services/db/adapters/CapacitorSQLiteAdapter';
import {PaymentIntentService} from '../services/payments/PaymentIntentService';
import {fiscalWorkflowScopeKey} from '../services/fiscal/FiscalWorkflowV2Types';
import {cartDigest} from '../services/fiscal/FiscalWorkflowRetirement';
import {encodeOriginal,encodeBase64,originalDigest} from '../services/recovery/OriginalCodec';
import {createFiscalWorkflowV2Client} from '../services/fiscal/FiscalWorkflowV2Client';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={tenantId:id(1),companyId:id(2),storeId:id(3),terminalId:id(4),deviceId:'synthetic'},key=fiscalWorkflowScopeKey(scope);
export async function retirementFixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON;'+FISCAL_WORKFLOW_V2_SCHEMA+DURABLE_OUTBOX_SCHEMA_SQL+`CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));CREATE TABLE sync_queue(id TEXT PRIMARY KEY,type TEXT,payload TEXT,status TEXT);`+FISCAL_RETIREMENT_WRITER_SCHEMA);
 const bridge={query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>({changes:sql.prepare(q).run(...v)}),execute:async(q:string)=>{sql.exec(q);}};
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});const store=adapter.fiscalWorkflowStore;
 const permit:any={schemaVersion:2,permitId:id(10),transactionId:id(11),nonce:'synthetic-nonce',createdAt:new Date(Date.now()-172800000).toISOString(),expiresAt:new Date(Date.now()-86400000).toISOString(),scope,issuerRnc:'101010101',environment:0,authorityHash:'a'.repeat(64),operationKind:'SALE',state:'PERMIT'};
 const checkout:any={checkoutId:id(12),operationId:id(13),transactionId:permit.transactionId,scopeKey:key,cartIdentity:JSON.stringify({items:[{id:'synthetic',quantity:1,price:100}],customerId:null,fiscalType:'E32'}),permit,phase:'PREPARED',paymentIds:[]};
 sql.prepare("INSERT INTO pos_fiscal_permits_v2 VALUES(?,?,?,?,?,'RESERVED',?)").run(permit.permitId,permit.transactionId,key,JSON.stringify(permit),permit.expiresAt,checkout.checkoutId);
 sql.prepare("INSERT INTO pos_fiscal_checkouts_v2 VALUES(?,?,?,?,?,?,'PREPARED')").run(checkout.checkoutId,checkout.transactionId,key,checkout.cartIdentity,permit.permitId,JSON.stringify(checkout));sql.prepare('INSERT INTO pos_fiscal_checkout_current_v2 VALUES(?,?)').run(key,checkout.checkoutId);
 const proof:any={schemaVersion:1,commandId:id(14),checkoutId:checkout.checkoutId,transactionId:checkout.transactionId,permitId:permit.permitId,originalOperationId:checkout.operationId,cartIdentitySha256:await cartDigest(checkout.cartIdentity),reason:'EXPIRED_PREPARED_NO_EFFECTS'};
 const receipt:any={...proof,scope,state:'HELD',closedAt:new Date().toISOString(),historyId:id(15)};
 const doc=(collection:string,data:any)=>sql.prepare('INSERT INTO documents VALUES(?,?,?,0,?)').run(collection,data.id,JSON.stringify(data),new Date().toISOString());
 const snapshot=()=>JSON.stringify(['pos_fiscal_checkout_current_v2','pos_fiscal_checkouts_v2','pos_fiscal_permits_v2','pos_fiscal_checkout_retirements_v1','documents','payment_intents_v2','sync_outbox_v2'].map(t=>sql.prepare('SELECT * FROM '+t).all()));
 return {sql,bridge,adapter,store,permit,checkout,proof,receipt,doc,snapshot};
}
test('expired prepared keeps originals and pointer while CLOSING, receipt atomically closes and only explicit next reserve is new',async()=>{const f=await retirementFixture();try{const originals=JSON.stringify([await f.store.readCheckout(f.checkout.checkoutId),f.sql.prepare('SELECT * FROM pos_fiscal_permits_v2').all()]);
 const pending=await f.store.beginRetirement(key,f.proof);assert.equal(pending.phase,'CLOSING');assert.equal((await f.store.currentCheckout(key))?.checkoutId,f.checkout.checkoutId);assert.deepEqual(await f.store.beginRetirement(key,f.proof),pending);
 const closed=await f.store.completeRetirement(key,f.receipt);assert.equal(closed.phase,'CLOSED');assert.equal(await f.store.currentCheckout(key),null);assert.deepEqual(await f.store.completeRetirement(key,f.receipt),closed);
 assert.equal(JSON.stringify([await f.store.readCheckout(f.checkout.checkoutId),f.sql.prepare('SELECT * FROM pos_fiscal_permits_v2').all()]),originals);
 for(const table of ['documents','sync_outbox_v2','payment_intents_v2','pos_fiscal_watch_v2','pos_fiscal_state_v2'])assert.equal(f.sql.prepare('SELECT count(*) n FROM '+table).get()!.n,0);
 const next=await f.store.reserveCheckout(key,'current UI cart changed',undefined,id(50));assert.notEqual(next.transactionId,f.checkout.transactionId);assert.notEqual(next.operationId,f.checkout.operationId);
 }finally{f.sql.close();}});
for(const effect of ['CREATED','DECLINED','history','ledger','outbox-alias','watch','state','recovery','recovery-stage','malformed','unknown','overlimit','legacy-queue'])test('retirement refuses '+effect+' before writes',async()=>{const f=await retirementFixture();try{
 if(['CREATED','DECLINED'].includes(effect))f.sql.prepare("INSERT INTO payment_intents_v2(intent_id,idempotency_key,payment_id,provider,amount,currency_code,status,created_at,updated_at,transaction_id)VALUES('i','key','p','provider',100,'DOP',?,'now','now',?)").run(effect,f.checkout.transactionId);
 if(effect==='history')f.doc('transactionHistory',{id:f.checkout.transactionId});if(effect==='ledger')f.doc('inventoryLedger',{id:'ledger',documentRef:f.checkout.transactionId});
 if(effect==='outbox-alias')f.sql.prepare("INSERT INTO sync_outbox_v2(event_id,event_type,aggregate_type,aggregate_id,schema_version,payload_json,created_at,updated_at)VALUES('e','SALE_POSTED','TRANSACTION','foreign',1,?,'now','now')").run(JSON.stringify({summary:{transaction_id:f.checkout.transactionId}}));
 if(effect==='watch')f.sql.prepare('INSERT INTO pos_fiscal_watch_v2 VALUES(?,?)').run(f.checkout.transactionId,key);if(effect==='state')f.sql.prepare("INSERT INTO pos_fiscal_state_v2 VALUES(?,?,'i','o','{}',1)").run(f.checkout.transactionId,key);
 if(effect==='legacy-queue')f.sql.prepare("INSERT INTO sync_queue VALUES('q','TRANSACTION',?,'PENDING')").run(JSON.stringify({id:f.checkout.transactionId}));
 if(['recovery','recovery-stage','unknown','malformed'].includes(effect)){
 const document=encodeOriginal({id:'unrelated',fiscalWorkflowBirth:{permitId:f.permit.permitId}}),body=encodeOriginal({version:1,collection:'transactions',document,original:document});
 const r={id:'recovery',kind:'TRANSACTION',originalId:'unrelated',body:effect==='malformed'?'invalid':body};
 if(effect==='unknown')(r as any).kind='UNSUPPORTED';
 f.doc(effect==='recovery-stage'?'recoveryStage':'recoveryOriginals',effect==='recovery-stage'?{id:'stage',record:{...r,encoding:'pos.original.typed-json.v1',version:1,byteLength:new TextEncoder().encode(body).length,bodySha256:await originalDigest(new TextEncoder().encode(body)),bodyBase64:encodeBase64(new TextEncoder().encode(body))}}:r);
 }
 if(effect==='overlimit')f.doc('recoveryOriginals',{id:'huge',body:'x'.repeat(RETIREMENT_SCAN_LIMITS.encodedBytes+1)});
 const before=f.snapshot(),writes=f.sql.prepare('SELECT total_changes() n').get()!.n;await assert.rejects(f.store.beginRetirement(key,f.proof),/RETIREMENT/);assert.equal(f.snapshot(),before);assert.equal(f.sql.prepare('SELECT total_changes() n').get()!.n,writes);
 }finally{f.sql.close();}});
test('unrelated valid typed recovery accepted, unknown encoding/malformed stage stays held',async()=>{for(const bad of [false,true]){const f=await retirementFixture();try{const document=encodeOriginal({id:'unrelated',total:10}),body=encodeOriginal({version:1,collection:'transactions',document,original:document});f.doc('recoveryStage',{id:'stage',record:{kind:'TRANSACTION',originalId:'unrelated',encoding:bad?'unknown':'pos.original.typed-json.v1',version:1,byteLength:new TextEncoder().encode(body).length,bodySha256:await originalDigest(new TextEncoder().encode(body)),bodyBase64:encodeBase64(new TextEncoder().encode(body))}});if(bad)await assert.rejects(f.store.beginRetirement(key,f.proof),/RETIREMENT/);else assert.equal((await f.store.beginRetirement(key,f.proof)).phase,'CLOSING');}finally{f.sql.close();}}});
for(const phase of ['CLOSING','CLOSED'])test('persistent '+phase+' fences reject old SQL writers and preserve new unrelated writes',async()=>{const f=await retirementFixture();try{await f.store.beginRetirement(key,f.proof);if(phase==='CLOSED')await f.store.completeRetirement(key,f.receipt);const before=f.snapshot();
 for(const statement of ["UPDATE pos_fiscal_checkouts_v2 SET phase='EFFECT_POSSIBLE'", "UPDATE pos_fiscal_permits_v2 SET state='CONSUMED'",`INSERT INTO pos_fiscal_watch_v2 VALUES('${f.checkout.transactionId}','scope')`,`INSERT INTO pos_fiscal_state_v2 VALUES('${f.checkout.transactionId}','scope','i','o','{}',1)`])assert.throws(()=>f.sql.exec(statement),/FENCED/);
 assert.throws(()=>f.doc('transactionHistory',{id:f.checkout.transactionId}),/FENCED/);
 await assert.rejects(f.store.markPaymentPossible(f.checkout.checkoutId,'p'),/FENCED/);
 const service=new PaymentIntentService(f.adapter,()=>true);await assert.rejects(service.create({paymentId:'p',provider:'TEST',amount:100,currencyCode:'DOP',futureCheckout:{checkoutId:f.checkout.checkoutId,transactionId:f.checkout.transactionId}}),/FENCED/);
 assert.equal(f.snapshot(),before);f.doc('products',{id:'unrelated'});f.doc('transactions',{id:id(99)});
 }finally{f.sql.close();}});
for(const failure of ['404','malformed','scope','lost-remote','lost-local'])test('client recovery '+failure+' remains fenced or idempotently resumes',async()=>{const f=await retirementFixture();try{let calls=0,scopeValid=true;const auth=()=>({base:'https://erp.invalid/api/sync',headers:{},descriptor:scope,assertCurrent(){if(!scopeValid)throw Error('SCOPE_CHANGED');}});
 const client=createFiscalWorkflowV2Client({store:()=>f.store,readAuth:auth,fetchImpl:async()=>{calls++;if(failure==='scope')scopeValid=false;if(failure==='lost-remote'&&calls===1)throw Error('lost response');return {ok:failure!=='404',json:async()=>failure==='malformed'?{...f.receipt,commandId:id(99)}:f.receipt} as Response;}} as any);
 const candidate={...f.proof,scopeKey:key,phase:'CLOSING' as const,receipt:null};
 if(failure==='lost-local'){const original=f.bridge.execute;let lost=false;f.bridge.execute=async q=>{await original(q);if(q==='COMMIT;'&&!lost&&f.sql.prepare("SELECT 1 FROM pos_fiscal_checkout_retirements_v1 WHERE phase='CLOSED'").get()){lost=true;throw Error('lost local commit');}};}
 await assert.rejects(client.retireExpiredCheckout(candidate,{actorId:'operator',pin:'1234'}));
 if(['404','malformed','scope'].includes(failure)){assert.equal((await f.store.retirement(key))!.phase,'CLOSING');assert.equal((await f.store.currentCheckout(key))!.checkoutId,f.checkout.checkoutId);}
 else{const saved=await client.retirementCandidate();assert.ok(saved);assert.equal((await client.retireExpiredCheckout(saved!)).phase,'CLOSED');assert.equal(await f.store.currentCheckout(key),null);}
 }finally{f.sql.close();}});

import {readFileSync} from 'node:fs';
import ts from 'typescript';
const oldWriters=JSON.parse(readFileSync(new URL('./fixtures/fiscal546-writers.json',import.meta.url),'utf8'));
function oldMethod(name:string,bindings:Record<string,unknown>={}){
 const js=ts.transpileModule('class Legacy {'+oldWriters.methods[name]+'};const result=Legacy.prototype.'+name,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new Function(...Object.keys(bindings),js+';return result;')(...Object.values(bindings));
}
for(const phase of ['CLOSING','CLOSED'])test('actual saved 546 writer bodies fail behind persistent '+phase+' triggers',async()=>{const f=await retirementFixture();try{
 await f.store.beginRetirement(key,f.proof);if(phase==='CLOSED')await f.store.completeRetirement(key,f.receipt);
 const before=f.snapshot(),writes=f.sql.prepare('SELECT total_changes() n').get()!.n;
 await assert.rejects(oldMethod('markPaymentPossible',{one:(r:any)=>r.values?.[0],fail:()=>{throw Error('CONFLICT');}}).call(f.store,f.checkout.checkoutId,'p'),/FENCED/);
 const service=new PaymentIntentService(f.adapter,()=>true),create=oldMethod('create',{createId:()=>id(80),clean:(v:any)=>String(v||'').trim()});
 await assert.rejects(create.call(service,{paymentId:'payment',provider:'TEST',amount:100,currencyCode:'DOP',futureCheckout:{checkoutId:f.checkout.checkoutId,transactionId:f.checkout.transactionId}}),/FENCED/);
 // The old commit adapter body is byte-identical to the running method; this executes that old body on the real native adapter.
 const text=readFileSync(new URL('../services/db/adapters/CapacitorSQLiteAdapter.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('adapter.ts',text,ts.ScriptTarget.Latest,true);let method='';function visit(n:ts.Node){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)==='commitFinancialTransaction')method=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);assert.equal(method,oldWriters.methods.commitFinancialTransaction);
 const tx:any={id:f.checkout.transactionId,total:100,items:[],payments:[]};await assert.rejects(f.adapter.commitFinancialTransaction({documents:[{collectionName:'transactions',document:tx,requireAbsent:true},{collectionName:'transactionHistory',document:tx,requireAbsent:true}],outboxEvent:{eventId:id(81),eventType:'SALE_POSTED',aggregateType:'TRANSACTION',aggregateId:tx.id,schemaVersion:1,payload:{transaction:tx},createdAt:new Date().toISOString()}} as any),/FENCED/);
 assert.equal(f.snapshot(),before);assert.equal(f.sql.prepare('SELECT total_changes() n').get()!.n,writes);
 // Re-executing old CREATE IF NOT EXISTS initialization cannot remove unknown sidecars/triggers.
 f.sql.exec(oldWriters.schema+DURABLE_OUTBOX_SCHEMA_SQL);assert.equal((await f.store.retirement(key))!.phase,phase);assert.throws(()=>f.doc('transactions',{id:f.checkout.transactionId}),/FENCED/);
 }finally{f.sql.close();}});

test('actual UI closure callback uses latest current lines and removes only retired operation tags',async()=>{
 const text=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('POSInterface.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:any;
 function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='onFiscalAttemptClosed')arrow=n.initializer;ts.forEachChild(n,visit);}visit(ast);
 const latest=[{id:'edited-current-line',quantity:4,fiscalCheckoutOperationId:id(13)},{id:'other',quantity:2,fiscalCheckoutOperationId:id(99)}],updates:any[]=[],ref:any={current:{checkoutId:id(12)}},op:any={current:id(13)};let modal=true,message='';
 const bindings={fiscalRetirementUIRef:{current:{cart:latest,terminalConfig:{},terminalId:scope.terminalId}},readFiscalWorkflowLocalScope:()=>scope,fiscalWorkflowScopeKey,fiscalCheckoutRef:ref,fiscalCheckoutOperationRef:op,onUpdateCart:(rows:any)=>updates.push(rows),setShowPaymentModal:(v:boolean)=>modal=v,setSuccessToast:(v:string)=>message=v};
 const js=ts.transpileModule('const invoke='+arrow.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,invoke=new Function(...Object.keys(bindings),js+';return invoke;')(...Object.values(bindings));
 invoke({phase:'CLOSED',receipt:{},scopeKey:key,checkoutId:id(12),originalOperationId:id(13)});assert.deepEqual(updates[0],[{id:'edited-current-line',quantity:4},latest[1]]);assert.equal(ref.current,null);assert.equal(op.current,null);assert.equal(modal,false);assert.match(message,/Revisa el ticket actual/);
 assert.throws(()=>invoke({phase:'CLOSING',receipt:null,scopeKey:key}),/RETIREMENT/);
});

test('old 546 consume and authorization cannot cross a CLOSING fence; concurrent mark either wins first or is rejected',async()=>{
 const f=await retirementFixture();try{await f.store.beginRetirement(key,f.proof);
 const source=oldWriters.methods.consume.replace('export ','');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const consume=new Function('one','fail',js+';return consumeFiscalWorkflowBirth;')((r:any)=>r.values?.[0],()=>{throw Error('CONFLICT');});
 const before=f.snapshot();await assert.rejects(consume(f.bridge,{checkoutId:f.checkout.checkoutId,transactionId:f.checkout.transactionId,birth:{schemaVersion:2,checkoutId:f.checkout.checkoutId,transactionId:f.checkout.transactionId,permitId:f.permit.permitId,nonce:f.permit.nonce}},{id:f.checkout.transactionId}),/FENCED/);assert.equal(f.snapshot(),before);
 const intents=new PaymentIntentService(f.adapter,()=>true);await intents.create({paymentId:'unrelated-intent',provider:'TEST',amount:100,currencyCode:'DOP'});
 await assert.rejects(oldMethod('markAuthorizing').call(intents,id(80),false,{checkoutId:f.checkout.checkoutId,transactionId:f.checkout.transactionId}),/RECONCILIATION/);
 }finally{f.sql.close();}
 for(const beginFirst of [true,false]){const f=await retirementFixture();try{
  const mark=()=>oldMethod('markPaymentPossible',{one:(r:any)=>r.values?.[0],fail:()=>{throw Error('CONFLICT');}}).call(f.store,f.checkout.checkoutId,'payment');
  const actions=beginFirst?[f.store.beginRetirement(key,f.proof),mark()]:[mark(),f.store.beginRetirement(key,f.proof)];const results=await Promise.allSettled(actions);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal((await f.store.readCheckout(f.checkout.checkoutId))!.phase,beginFirst?'PREPARED':'EFFECT_POSSIBLE');assert.equal(Boolean(await f.store.retirement(key)),beginFirst);
 }finally{f.sql.close();}}
});
for(const location of ['transport','recoveryState','sourceExpected'])test('decodes actual '+location+' retained source before absence proof',async()=>{const f=await retirementFixture();try{
 const document=encodeOriginal({id:'unrelated'}),body=encodeOriginal({version:1,collection:'transactions',document,original:document,transport:{version:1,route:'/api/sync/transactions',item:encodeOriginal({id:f.checkout.transactionId})}});
 if(location==='transport')f.doc('recoveryOriginals',{id:'r',kind:'TRANSACTION',originalId:'unrelated',body});
 if(location==='recoveryState')f.doc('recoveryState',{id:'head',body});
 if(location==='sourceExpected')f.doc('v3RestoredTicketSources',{id:'r',sourceExpected:JSON.stringify({id:f.checkout.transactionId})});
 await assert.rejects(f.store.beginRetirement(key,f.proof),/RETIREMENT/);assert.equal(await f.store.retirement(key),null);
 }finally{f.sql.close();}});
for(const invalid of ['proof','cart-durable','json-id','payments','phase','pointer','foreign-permit'])test('exact durable CAS denies '+invalid+' with no retirement writes',async()=>{const f=await retirementFixture();try{
 let proof={...f.proof};if(invalid==='proof')proof.cartIdentitySha256='c'.repeat(64);
 if(invalid==='cart-durable')f.sql.prepare("UPDATE pos_fiscal_checkouts_v2 SET checkout_json=json_set(checkout_json,'$.cartIdentity','changed')").run();
 if(invalid==='json-id')f.sql.prepare("UPDATE pos_fiscal_checkouts_v2 SET checkout_json=json_set(checkout_json,'$.checkoutId',?)").run(id(99));
 if(invalid==='payments')await f.store.markPaymentPossible(f.checkout.checkoutId,'p');
 if(invalid==='phase')f.sql.prepare("UPDATE pos_fiscal_checkouts_v2 SET phase='COMMITTED'").run();
 if(invalid==='pointer')f.sql.prepare('DELETE FROM pos_fiscal_checkout_current_v2').run();
 if(invalid==='foreign-permit')f.sql.prepare("UPDATE pos_fiscal_checkouts_v2 SET checkout_json=json_set(checkout_json,'$.permit.scope.deviceId','other')").run();
 const before=f.snapshot(),writes=f.sql.prepare('SELECT total_changes() n').get()!.n;await assert.rejects(f.store.beginRetirement(key,proof),/RETIREMENT/);assert.equal(f.snapshot(),before);assert.equal(f.sql.prepare('SELECT total_changes() n').get()!.n,writes);
 }finally{f.sql.close();}});

test('old 546 reserve cannot reuse a retired operation after CLOSED; explicit unrelated operation works',async()=>{const f=await retirementFixture();try{await f.store.beginRetirement(key,f.proof);await f.store.completeRetirement(key,f.receipt);const before=f.snapshot();const reserve=oldMethod('reserveCheckout',{one:(r:any)=>r.values?.[0],fail:()=>{throw Error('CONFLICT');},createUuid:()=>id(80),fiscalWorkflowScopeKey});await assert.rejects(reserve.call(f.store,key,'edited cart',undefined,f.checkout.operationId),/FENCED/);assert.equal(f.snapshot(),before);await assert.rejects(f.store.reserveCheckout(key,'edited cart',undefined,f.checkout.operationId),/FENCED/);const next=await f.store.reserveCheckout(key,'edited cart',undefined,id(90));assert.notEqual(next.operationId,f.checkout.operationId);assert.notEqual(next.transactionId,f.checkout.transactionId);}finally{f.sql.close();}});
for(const location of ['sync_queue','retained-original','aliased-history'])test('persistent fence denies late '+location+' from actual producer shape',async()=>{const f=await retirementFixture();try{await f.store.beginRetirement(key,f.proof);await f.store.completeRetirement(key,f.receipt);const before=f.snapshot();
 if(location==='sync_queue')assert.throws(()=>f.sql.prepare("INSERT INTO sync_queue VALUES('q','TRANSACTION',?,'PENDING')").run(JSON.stringify({id:f.checkout.transactionId})),/FENCED/);
 if(location==='retained-original'){const {captureDocument}=await import('../services/recovery/OriginalCapture');const captured=captureDocument('transactions',{id:f.checkout.transactionId,total:100},{key:'synthetic'})!;assert.throws(()=>f.doc('recoveryOriginals',captured),/FENCED/);}
 if(location==='aliased-history')assert.throws(()=>f.doc('transactionHistory',{id:'foreign',fiscalWorkflowBirth:{transactionId:f.checkout.transactionId,permitId:f.permit.permitId,checkoutId:f.checkout.checkoutId}}),/FENCED/);
 assert.equal(f.snapshot(),before);f.doc('recoveryState',{id:'unrelated',body:encodeOriginal({scopeKey:'other',preparationId:'closejob',published:true})});
 }finally{f.sql.close();}});
test('preexisting nested fiscal birth alias blocks retirement; unrelated close-job body is accepted',async()=>{for(const related of [true,false]){const f=await retirementFixture();try{if(related){f.doc('transactionHistory',{id:'foreign',fiscalWorkflowBirth:{transactionId:f.checkout.transactionId}});await assert.rejects(f.store.beginRetirement(key,f.proof),/RETIREMENT/);}else{f.doc('recoveryState',{id:'unrelated-close',body:encodeOriginal({scopeKey:'other',preparationId:'closejob',published:true})});assert.equal((await f.store.beginRetirement(key,f.proof)).phase,'CLOSING');}}finally{f.sql.close();}}});

test('actual old 546 financial adapter invokes actual old consume and persistent triggers reject before effects',async()=>{const f=await retirementFixture();try{await f.store.beginRetirement(key,f.proof);
 const consumeJS=ts.transpileModule(oldWriters.methods.consume.replace('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const consume=new Function('one','fail',consumeJS+';return consumeFiscalWorkflowBirth;')((r:any)=>r.values?.[0],()=>{throw Error('CONFLICT');});
 const source=readFileSync(new URL('../services/db/adapters/CapacitorSQLiteAdapter.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('a.ts',source,ts.ScriptTarget.Latest,true);let sql='';function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='DOCUMENT_UPSERT_SQL')sql=new Function('FINANCIAL_COUNTER_UPSERT_SQL','ARTICLE_FORMAT_RETAINED_UPSERT_SQL','V3_FINANCIAL_RETAINED_UPSERT_SQL','return '+n.initializer!.getText(ast))(FINANCIAL_COUNTER_UPSERT_SQL,ARTICLE_FORMAT_RETAINED_UPSERT_SQL,V3_FINANCIAL_RETAINED_UPSERT_SQL);ts.forEachChild(n,visit);}visit(ast);
 const commit=oldMethod('commitFinancialTransaction',{DOCUMENT_UPSERT_SQL:sql,consumeFiscalWorkflowBirth:consume});
 const tx:any={id:f.checkout.transactionId,total:100,items:[],payments:[]},birth={schemaVersion:2,checkoutId:f.checkout.checkoutId,transactionId:tx.id,permitId:f.permit.permitId,nonce:f.permit.nonce};const before=f.snapshot();
 await assert.rejects(commit.call(f.adapter,{documents:[{collectionName:'transactions',document:tx,requireAbsent:true},{collectionName:'transactionHistory',document:tx,requireAbsent:true}],outboxEvent:{eventId:id(82),eventType:'SALE_POSTED',aggregateType:'TRANSACTION',aggregateId:tx.id,schemaVersion:1,payload:{transaction:tx,fiscalWorkflowBirth:birth},createdAt:new Date().toISOString()},fiscalWorkflowCommits:[{checkoutId:f.checkout.checkoutId,transactionId:tx.id,birth}]}),/FENCED/);assert.equal(f.snapshot(),before);
 }finally{f.sql.close();}});

test('actual unchanged old recovery download/restore cannot materialize a retired original; audit rows do not authorize replay',async()=>{const f=await retirementFixture();try{
 const {captureDocument}=await import('../services/recovery/OriginalCapture'),{PendingOperationsRecovery,originalRecord,recordBytes}=await import('../services/recovery/PendingOperationsRecovery');
 await f.store.beginRetirement(key,f.proof);await f.store.completeRetirement(key,f.receipt);
 const captured={...captureDocument('transactions',{id:f.checkout.transactionId,terminalId:scope.terminalId,total:100},{key})!,storageEpoch:id(91),openSetId:id(92),sequence:'1',revision:'1'};
 const r=await originalRecord(captured),row={receiptId:'1',recordHash:await originalDigest(recordBytes(r)),receivedAt:new Date().toISOString(),record:r};
 const snapshot={snapshotId:'synthetic-snapshot',totalRecords:1,snapshotDigest:await originalDigest(new TextEncoder().encode('1:'+row.recordHash+'\n')),expiresAt:'2099-01-01T00:00:00Z',nextCursor:'0',completeness:'RECEIVED_ORIGINALS_ONLY',exactZEligible:false,closeAuthorization:'NOT_GRANTED'};
 const api:any={context:async()=>({key,terminalIds:[scope.terminalId],enabled:true}),snapshot:async()=>snapshot,page:async()=>({...snapshot,records:[row],pageStart:0,nextCursor:null})};
 const recovery=new PendingOperationsRecovery(f.adapter,api);await assert.rejects(recovery.download(),/FENCED/);await assert.rejects(recovery.restore(),/NOT_VERIFIED/);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM documents WHERE collection_name IN ('transactions','transactionHistory','inventoryLedger','recoveryStage')").get()!.n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM sync_outbox_v2').get()!.n,0);assert.equal((await f.store.retirement(key))!.phase,'CLOSED');
 }finally{f.sql.close();}});
