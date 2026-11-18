import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { canRetryPendingSyncQueue,pendingSyncDiagnostic,readPendingSyncDocuments,retryPendingSyncQueue } from '../services/sync/PendingSyncDocuments';

function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT);
 CREATE TABLE sync_outbox_v2(event_id TEXT,event_type TEXT,aggregate_id TEXT,payload_json TEXT,status TEXT,attempt_count INTEGER,created_at TEXT,last_error TEXT);
 CREATE TABLE master_number_ranges(range_id TEXT,prefix TEXT,updated_at TEXT,terminal_id TEXT,status TEXT,progress_pending INTEGER,last_issued_number INTEGER,start_number INTEGER,last_reported_number INTEGER,blocked_reason TEXT);`);
 const queryResults:string[]=[];const sqls:string[]=[];
 const adapter={executeSQL:async(sql:string,params:any[]=[])=>{assert.match(sql,/^(SELECT|WITH)\b/);sqls.push(sql);const rows=db.prepare(sql).all(...params);queryResults.push(JSON.stringify(rows));if(!rows.length)return[];const columns=Object.keys(rows[0]);return[{columns,values:rows.map(row=>columns.map(key=>row[key]))}];}};
 const insert=(collection:string,id:string,data:any)=>db.prepare('INSERT INTO documents VALUES(?,?,?)').run(collection,id,JSON.stringify(data));
 return{db,adapter,insert,queryResults,sqls};
}

test('native projection reads a 709KB document without transferring its body and preserves every row',async()=>{
 const f=fixture();try{
  f.insert('transactions','sale-1',{displayId:'FAC-1',total:300,terminalId:'T',syncStatus:'BLOCKED_FUNCTIONAL',syncError:'INVALID_SCOPE token=secret https://private.invalid/auth',items:[{description:'private-payload'.repeat(60000)}]});
  f.insert('transactions','acked',{displayId:'ACK',syncStatus:'APPLIED_ERP'});
  f.insert('transactions','recovered',{syncStatus:'PENDING',_posRecovery:{snapshotId:'S'}});
  const before=JSON.stringify(f.db.prepare('SELECT * FROM documents').all());
  const page=await readPendingSyncDocuments(f.adapter,{page:1,search:'',status:'ALL'});
  assert.equal(page.total,1);assert.equal(page.rows[0].reference,'FAC-1');assert.equal(page.rows[0].amount,300);
  assert.doesNotMatch(JSON.stringify(page),/private-payload|secret|private.invalid/);
  assert.ok(Math.max(...f.queryResults.map(s=>Buffer.byteLength(s)))<6000);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM documents').all()),before);
  const diagnostic=pendingSyncDiagnostic(page.rows[0]);assert.ok(Buffer.byteLength(diagnostic)<16000);assert.doesNotMatch(diagnostic,/private-payload|secret|private.invalid/);
 }finally{f.db.close();}
});

test('pages, searches and filters unsent documents and durable events without including ACKs',async()=>{
 const f=fixture();try{
  for(let i=0;i<43;i++)f.insert('transactions',`S-${i}`,{displayId:`FAC-${i}`,syncStatus:i===0?'ERROR':'PENDING',createdAt:`2026-11-18T10:${String(i).padStart(2,'0')}:00Z`});
  f.db.exec("INSERT INTO sync_outbox_v2 VALUES('event-blocked','SALE_POSTED','SALE','{}','REJECTED',3,'2026-11-18T11:00Z','AUTHORITY_INVALID');INSERT INTO sync_outbox_v2 VALUES('event-ack','SALE_POSTED','ACK','{}','APPLIED_ERP',1,'2026-11-18','');");
  const first=await readPendingSyncDocuments(f.adapter,{page:1,search:'',status:'ALL'});
  const next=await readPendingSyncDocuments(f.adapter,{page:2,search:'',status:'ALL'});
  assert.equal(first.total,44);assert.equal(first.rows.length,20);assert.equal(next.rows.length,20);
  assert.ok(first.rows.every(row=>!next.rows.some(other=>other.id===row.id)));
  const blocked=await readPendingSyncDocuments(f.adapter,{page:1,search:'',status:'BLOCKED'});assert.equal(blocked.total,2);
  const searched=await readPendingSyncDocuments(f.adapter,{page:1,search:'FAC-42',status:'PENDING'});assert.equal(searched.total,1);
  assert.equal((await readPendingSyncDocuments(f.adapter,{page:1,search:"' OR 1=1--",status:'ALL'})).total,0);
 }finally{f.db.close();}
});

test('slave scope excludes documents and outbox events from another terminal, retains receipt and range progress',async()=>{
 const f=fixture();try{
  f.insert('transactions','own',{terminalId:'T',syncStatus:'PENDING'});f.insert('transactions','other',{terminalId:'OTHER',syncStatus:'PENDING'});
  f.insert('transfer_receipt_queue','receipt',{payload:{terminal_id:'T'},status:'APPLIED',snapshotRefreshPending:true});
  f.db.exec(`INSERT INTO sync_outbox_v2 VALUES('own-event','SALE_POSTED','own','{"transaction":{"terminalId":"T"}}','PENDING',0,'2026-11-18','');INSERT INTO sync_outbox_v2 VALUES('other-event','SALE_POSTED','other','{"transaction":{"terminalId":"OTHER"}}','PENDING',0,'2026-11-18','');INSERT INTO master_number_ranges VALUES('range','CLI-','2026-11-18','T','ACTIVE',1,4,1,2,NULL);`);
  const page=await readPendingSyncDocuments(f.adapter,{page:1,search:'',status:'ALL',master:false,terminalId:'T'});
  assert.equal(page.total,4);assert.ok(page.rows.every(row=>!row.id.startsWith('other')));
  assert.equal(page.rows.find(row=>row.id==='own-event')?.terminal,'T');
  assert.equal(canRetryPendingSyncQueue(page.rows.find(row=>row.id==='receipt')!),true);
  assert.equal(canRetryPendingSyncQueue({...page.rows[0],status:'BLOCKED_FUNCTIONAL'}),false);
 }finally{f.db.close();}
});

test('unsupported storage and query failure never masquerade as an empty queue',async()=>{
 await assert.rejects(readPendingSyncDocuments({},{page:1,search:'',status:'ALL'}),/SQLITE_REQUIRED/);
 await assert.rejects(readPendingSyncDocuments({executeSQL:async()=>{throw Error('locked');}},{page:1,search:'',status:'ALL'}),/locked/);
});

test('retry only invokes the existing sender once, offline never invokes it',async()=>{
 let calls=0;const sender={triggerSyncAndWait:async()=>{calls++;}};
 await assert.rejects(retryPendingSyncQueue(sender,false),/Sin conexión/);assert.equal(calls,0);
 await retryPendingSyncQueue(sender,true);assert.equal(calls,1);
 const source=readFileSync(new URL('../components/PendingSyncDocumentsModal.tsx',import.meta.url),'utf8');
 assert.match(source,/retryBusy\.current\|\|!canRetry/);assert.match(source,/retryBusy\.current=true/);
 assert.doesNotMatch(source,/requeueBlockedOperationalDocuments|_forceSyncReplay|deleteDocument|executeSQL/);
 assert.match(source,/disabled title="No hay descarte seguro/);
 assert.match(source,/data-pos-scanner-enabled="false"/);assert.match(source,/'barcodeScanned',blockScan,true/);
});

test('legacy rows owned by tracking and fiscal Outbox are not offered as retryable legacy documents',async()=>{
 const f=fixture();try{
  f.insert('transactions','tracking',{syncStatus:'PENDING',trackingCheckoutId:'tracking-owner'});
  f.insert('transactions','fiscal',{syncStatus:'PENDING',documentType:'REFUND',ncfType:'E34',fiscalWorkflowCheckoutId:'return-owner'});
  f.insert('transactions','ordinary',{syncStatus:'PENDING'});
  f.insert('inventoryLedger','ledger',{syncStatus:'PENDING'});
  assert.equal((await readPendingSyncDocuments(f.adapter,{page:1,search:'',status:'ALL'})).total,2);
  assert.equal((await readPendingSyncDocuments(f.adapter,{page:1,search:'',status:'ALL',durableEnabled:true})).total,0);
 }finally{f.db.close();}
});

test('an unbound slave fails closed and diagnostics omit credentials even when projected values are truncated',async()=>{
 const f=fixture();try{
  f.insert('transactions','missing-terminal',{syncStatus:'PENDING'});
  await assert.rejects(readPendingSyncDocuments(f.adapter,{page:1,search:'',status:'ALL',master:false,terminalId:''}),/TERMINAL_REQUIRED/);
  assert.equal(f.sqls.length,0);
  for(const reason of ['{"password":"my secret value"}','Authorization: Bearer secret value','api_key="unterminated secret value']){
   const json=pendingSyncDiagnostic({source:'transactions',id:'S',reference:'S',kind:'SALE',date:'',terminal:'T',amount:1,status:'ERROR',attempts:1,reason});
   assert.doesNotMatch(json,/my secret|secret value|unterminated/);
  }
 }finally{f.db.close();}
});
