import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { AUDIT_CONTEXT_RETRY_DELAY_MS,isAuditContextMissing,isAuditContextBlocked } from '../services/sync/AuditContextRetry';
import { posAuditWireItem,assertPosAuditAcknowledgement } from '../services/audit/PosOperationalAudit';

const legacy='Operational sync failed: 409 Conflict — {"status":"error","code":"ERP_CONTEXT_MISSING"}';
const originalAuthorization={id:'AUTH-ORIGINAL',schemaVersion:1,kind:'AUTHORIZATION',terminalId:'Master-01',timestamp:'2026-11-17T17:00:00Z',event:{id:'AUTH-ORIGINAL',timestamp:'2026-11-17T17:00:00Z',terminalId:'Master-01',cashierId:'cashier',supervisorId:'supervisor',actionType:'POS_DISCOUNT',actionDescription:'Autorización original',newValue:10},syncStatus:'BLOCKED_FUNCTIONAL',syncError:legacy,syncBlockedReason:legacy,syncBlockedAt:'2026-11-17T18:00:00Z'};
const originalInvoice={id:'INVOICE-LOCAL',idempotencyKey:'INVOICE-STABLE-KEY',terminalId:'Master-01',eventType:'EMAIL_REQUESTED',transactionId:'SALE-EXISTING',actorId:'cashier',actorName:'Original',occurredAt:'2026-11-17T17:00:00Z',syncStatus:'BLOCKED_FUNCTIONAL',syncError:legacy,syncBlockedReason:legacy,syncBlockedAt:'2026-11-17T18:00:00Z'};
function classSource(path:string,name:string){const source=readFileSync(new URL(path,import.meta.url),'utf8'),ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);const node=ast.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text===name);assert.ok(node);return node.getText(ast);}
const workerSource=classSource('../services/sync/BackgroundSyncManager.ts','BackgroundSyncManager');
const apiSource=readFileSync(new URL('../services/sync/ApiSyncAdapter.ts',import.meta.url),'utf8'),apiAST=ts.createSourceFile('ApiSyncAdapter.ts',apiSource,ts.ScriptTarget.Latest,true);
const apiClass=apiAST.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='ApiSyncAdapter') as ts.ClassDeclaration;assert.ok(apiClass);
const pushMethod=apiClass.members.find(member=>member.name?.getText(apiAST)==='pushAuditEvent');assert.ok(pushMethod);
const compile=(source:string)=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;

function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,PRIMARY KEY(collection_name,doc_id));');
 const save=(collection:string,row:any)=>sql.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?)').run(collection,row.id,JSON.stringify(row));
 const list=(collection:string)=>sql.prepare('SELECT data FROM documents WHERE collection_name=? ORDER BY doc_id').all(collection).map(row=>JSON.parse(String(row.data)));
 save('posAuditEvents',originalAuthorization);save('invoiceAuditEvents',originalInvoice);save('transactions',{id:'SALE-EXISTING',syncStatus:'APPLIED_ERP',total:250,items:[{id:'MEBL02',price:250}]});save('inventoryLedger',{id:'LEDGER',syncStatus:'APPLIED_ERP',qtyOut:1});
 let clock=Date.parse('2026-11-18T12:00:00Z'),online=true,sale=false,enabled=true,target='ERP_ACTIVE',canPush=true,master=true,mode='ok';
 let requests=0,mutateDuringPush:(()=>void)|undefined,mutateDuringSave:((name:string,row:any)=>void)|undefined;
 const recorded=new Map<string,string>(),sent:any[]=[],delays:number[]=[];
 class ClockDate extends Date {constructor(value?:any){super(value===undefined?clock:value);}static now(){return clock;}}
 const noop=()=>{};const local={getItem:()=>null,setItem:noop,removeItem:noop};
 const post=async(_path:string,payload:any,options:any)=>{
  requests++;const wire=payload.items[0],id=wire.kind==='INVOICE'?wire.event.idempotencyKey||wire.event.id:wire.event.id;
  sent.push(structuredClone(wire));
  if(mode==='context')throw Object.assign(new Error(legacy),{httpStatus:409,responseBody:'{"code":"ERP_CONTEXT_MISSING"}'});
  if(mode==='scope')throw Object.assign(new Error('Operational sync failed: 409 Conflict — {"code":"POS_AUDIT_SCOPE_MISMATCH"}'),{httpStatus:409,responseBody:'{"code":"POS_AUDIT_SCOPE_MISMATCH"}'});
  if(recorded.has(id)&&recorded.get(id)!==JSON.stringify(wire))throw Error('POS_AUDIT_REPLAY_CONFLICT');
  recorded.set(id,JSON.stringify(wire));mutateDuringPush?.();
  if(mode==='lost')throw Error('ACK response lost');
  const response={status:'success',results:[{eventId:mode==='invalid-ack'?'wrong-id':id,auditId:'10000000-0000-4000-8000-000000000001',disposition:'RECORDED'}]};
  options.responseValidator.validate(response);return response;
 };
 const PushClass=new Function('posAuditWireItem','assertPosAuditAcknowledgement',compile(`class PushFixture {${pushMethod.getText(apiAST)}}`)+';return PushFixture;')(posAuditWireItem,assertPosAuditAcknowledgement);
 const api=new PushClass();api.postOperationalPayload=post;
 const ports={
  AUDIT_CONTEXT_RETRY_DELAY_MS,isAuditContextMissing,isAuditContextBlocked,
  db:{get:async(name:string)=>list(name),saveDocument:async(name:string,row:any)=>{save(name,row);await Promise.resolve();mutateDuringSave?.(name,row);}},dbAdapter:{adapterType:'sqlite'},apiSyncAdapter:api,
  permissionService:{isMasterTerminal:()=>master,getTerminalId:()=> 'Master-01'},isRecoveredOperation:(row:any)=>Boolean(row?._posRecovery?.snapshotId),isFormatOwnedDocument:()=>false,
  isPosSaleActive:()=>sale,POS_SALE_ACTIVITY_EVENT:'sale',waitForBackgroundSyncWindow:async()=>false,yieldBackgroundSyncChunk:async()=>{},
  syncPolicy:{resolve:()=>({kind:target,canPushOperations:canPush}),targetKind:()=>target},authenticatedActivityTracker:{record:noop},
  syncMetrics:{increment:noop,markAckFinished:noop,markErpApplied:noop,markApplyFinished:noop,setOutboxState:noop},
  isSyncFeatureEnabled:(flag:string)=>flag==='pos_operational_audit'?enabled:false,
  durableOutboxRepository:{hasPendingTrackingEvents:async()=>false,hasPendingReturnEvents:async()=>false,isSupported:()=>false},durableOutboxBatchSender:{sendNext:async()=>({retrying:0})},
  reconcileAuthorizationBackups:async()=>{},completeLegacyMutationAfterDurableAck:async()=>{},
  transferReceiptService:{processDue:async()=>[],list:async()=>[]},getPendingMasterNumberRanges:async()=>[],reportPendingMasterNumberRangeProgress:async()=>{},markNumberedMasterSynced:async()=>{},
  getCatalogEdits:async()=>({catalogEditQueue:{process:async()=>{}},catalogEditsEnabled:()=>false}),
  navigator:{get onLine(){return online;}},window:{localStorage:local,removeEventListener:noop},document:{removeEventListener:noop},localStorage:local,
  Date:ClockDate,console:{log:noop,warn:noop,error:noop,info:noop},clearTimeout:noop,setTimeout:()=>1,clearInterval:noop,setInterval:()=>1,
 };
 const compiled=compile(workerSource.replace("await import('./catalogEdits')",'await getCatalogEdits()'));
 const Manager=new Function(...Object.keys(ports),compiled+';return BackgroundSyncManager;')(...Object.values(ports));
 const create=()=>{const manager=new Manager();manager.yieldToOperatorUi=async()=>{};manager.pruneSyncedItems=async()=>{};manager.scheduleSync=(delay:number)=>{delays.push(delay);};return manager;};
 let worker=create();
 return {sql,list,save,sent,recorded,delays,get requests(){return requests;},get worker(){return worker;},run:()=>worker.sync(),restart:()=>{worker=create();},advance:(ms:number)=>{clock+=ms;},setMode:(next:string)=>{mode=next;},setOnline:(next:boolean)=>{online=next;},setSale:(next:boolean)=>{sale=next;},setEnabled:(next:boolean)=>{enabled=next;},setTarget:(next:string)=>{target=next;},setCanPush:(next:boolean)=>{canPush=next;},setMaster:(next:boolean)=>{master=next;},duringPush:(callback:()=>void)=>{mutateDuringPush=callback;},duringSave:(callback:(name:string,row:any)=>void)=>{mutateDuringSave=callback;}};
}

test('real worker retries both historical queues and marks ACK only after durable identity validation',async()=>{
 const f=fixture();try{
  const business=JSON.stringify([f.list('transactions'),f.list('inventoryLedger')]);await f.run();
  assert.equal(f.requests,2);assert.equal(f.recorded.size,2);
  assert.equal(f.list('posAuditEvents')[0].syncStatus,'APPLIED_ERP');assert.equal(f.list('invoiceAuditEvents')[0].syncStatus,'APPLIED_ERP');
  assert.deepEqual(f.sent[0],posAuditWireItem(originalAuthorization as any));assert.deepEqual(f.sent[1],posAuditWireItem(originalInvoice as any,true));
  assert.equal(f.list('invoiceAuditEvents')[0].idempotencyKey,'INVOICE-STABLE-KEY');assert.equal(f.list('posAuditEvents')[0].event.timestamp,originalAuthorization.event.timestamp);
  assert.equal(JSON.stringify([f.list('transactions'),f.list('inventoryLedger')]),business);await f.run();assert.equal(f.requests,2);
 }finally{f.sql.close();}
});

test('persisting context failure retains history and observes 60s cooldown across worker restart',async()=>{
 const f=fixture();try{
  f.setMode('context');await f.run();assert.equal(f.requests,2);
  for(const collection of ['posAuditEvents','invoiceAuditEvents']){const row=f.list(collection)[0];assert.equal(row.syncStatus,'RETRY_WAIT');assert.equal(row.syncBlockedReason,legacy);assert.equal(row.syncBlockedAt,originalAuthorization.syncBlockedAt);assert.equal(Date.parse(row.syncRetryAfter),Date.parse('2026-11-18T12:01:00Z'));assert.equal(row._forceSyncReplay,undefined);}
  f.restart();f.advance(59999);await f.run();assert.equal(f.requests,2);
  f.advance(1);f.setMode('ok');await f.run();assert.equal(f.requests,4);assert.equal(f.recorded.size,2);
 }finally{f.sql.close();}
});

for(const mode of ['lost','invalid-ack'])test(`lost or invalid ACK (${mode}) never confirms locally and replay remains idempotent`,async()=>{
 const f=fixture();try{
  f.setMode(mode);await f.run();assert.equal(f.requests,2);assert.equal(f.recorded.size,2);
  assert.equal(f.list('posAuditEvents')[0].syncStatus,'RETRY_WAIT');assert.equal(f.list('invoiceAuditEvents')[0].syncStatus,'RETRY_WAIT');
  f.restart();f.advance(20000);f.setMode('ok');await f.run();assert.equal(f.requests,4);assert.equal(f.recorded.size,2);assert.equal(f.list('invoiceAuditEvents')[0].syncStatus,'APPLIED_ERP');
  assert.deepEqual(f.sent[0],f.sent[2]);assert.deepEqual(f.sent[1],f.sent[3]);
 }finally{f.sql.close();}
});

for(const guard of ['offline','sale','flag','master-target','scope','disabled'])test(`actual whole worker preserves ${guard} policy`,async()=>{
 const f=fixture();try{
  if(guard==='offline')f.setOnline(false);if(guard==='sale')f.setSale(true);if(guard==='flag')f.setEnabled(false);if(guard==='master-target')f.setTarget('POS_MASTER');if(guard==='scope')f.setCanPush(false);if(guard==='disabled')f.worker.remoteEnabled=false;
  const before=JSON.stringify([f.list('posAuditEvents'),f.list('invoiceAuditEvents')]);await f.run();assert.equal(f.requests,0);assert.equal(JSON.stringify([f.list('posAuditEvents'),f.list('invoiceAuditEvents')]),before);
 }finally{f.sql.close();}
});

test('binding generation change while sending ignores stale ACK; restart sends identical original key',async()=>{
 const f=fixture();try{
  f.duringPush(()=>{f.worker.remoteGeneration++;});await f.run();assert.equal(f.requests,1);assert.equal(f.list('posAuditEvents')[0].syncStatus,'SYNCING');assert.equal(f.recorded.size,1);
  f.restart();f.duringPush(()=>{});f.advance(120001);await f.run();assert.equal(f.requests,3);assert.equal(f.recorded.size,2);assert.equal(f.list('posAuditEvents')[0].syncStatus,'APPLIED_ERP');assert.deepEqual(f.sent[0],f.sent[1]);
 }finally{f.sql.close();}
});

test('scope conflicts stay blocked; foreign/recovered and other commercial blocked rows are never replayed',async()=>{
 const f=fixture();try{
  f.setMode('scope');await f.run();assert.equal(f.list('posAuditEvents')[0].syncStatus,'BLOCKED_FUNCTIONAL');const sent=f.requests;await f.run();assert.equal(f.requests,sent);
  f.save('posAuditEvents',{...originalAuthorization,id:'FOREIGN',terminalId:'Other'});f.save('invoiceAuditEvents',{...originalInvoice,id:'RECOVERED',_posRecovery:{snapshotId:'backup'}});f.save('transactions',{id:'blocked-sale',syncStatus:'BLOCKED_FUNCTIONAL',syncError:legacy});
  f.setMaster(false);f.setMode('ok');await f.run();assert.equal(f.requests,sent);assert.equal(f.list('transactions').find(row=>row.id==='blocked-sale').syncStatus,'BLOCKED_FUNCTIONAL');
 }finally{f.sql.close();}
});


for(const guard of ['generation','authorization','offline','sale','flag','target'])test(`audit guard survives ${guard} invalidation during native SYNCING save`,async()=>{
 const f=fixture();try{
  f.duringSave((name,row)=>{
   if(name!=='posAuditEvents'||row.syncStatus!=='SYNCING')return;
   if(guard==='generation')f.worker.remoteGeneration++;
   if(guard==='authorization'){f.worker.remoteEnabled=false;f.worker.remoteGeneration++;}
   if(guard==='offline')f.setOnline(false);if(guard==='sale')f.setSale(true);if(guard==='flag')f.setEnabled(false);if(guard==='target')f.setTarget('POS_MASTER');
  });
  await f.run();assert.equal(f.requests,0);assert.equal(f.recorded.size,0);assert.notEqual(f.list('posAuditEvents')[0].syncStatus,'APPLIED_ERP');
 }finally{f.sql.close();}
});
