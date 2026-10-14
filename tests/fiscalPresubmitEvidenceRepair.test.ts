import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {sha256Utf8} from '../services/sync/LargeMasterSyncV3Client';
import {MSELLER_UNSUPPORTED_VAT_ERROR} from '../utils/fiscalClassificationProjection';
import {prepareFiscalPresubmitEvidenceRepair,executeApprovedFiscalPresubmitEvidenceRepair,type FiscalEvidenceRepairInput} from '../scripts/diagnostics/fiscalPresubmitEvidenceRepair';
import {LARGE_MASTER_SYNC_V3_SCHEMA_SQL} from '../services/db/LargeMasterSyncV3Schema';
import {CapacitorSQLiteAdapter} from '../services/db/adapters/CapacitorSQLiteAdapter';

async function fixture():Promise<FiscalEvidenceRepairInput>{
 const scope={tenantId:'tenant',companyId:'company',terminalId:'terminal',binding:JSON.stringify(['tenant','terminal','device','sync','origin'])};
 const stamp={binding:scope.binding,syncId:'S',syncVersion:1,inventoryVersion:1,inventoryCursor:'C',warehouseId:'W',tariffId:'T',taxIncluded:false};
 const immutable={id:'505',displayId:'TCK6000026',terminalId:'terminal',ncf:'E3200000505',electronicNcf:'E3200000505',ncfType:'E32',
  fiscalProvider:'MSELLER',items:[{id:'A',cartId:'A',price:85,quantity:1,netAmount:85,taxAmount:23.8,totalAmount:108.8,v3SaleAuthority:stamp}],
  payments:[{amount:108.8,method:'CASH'}],netAmount:85,taxAmount:23.8,total:108.8,taxBreakdown:[
   {id:'VAT',rate:.18,type:'VAT',amount:15.3,taxableBase:85,total:100.3,lineCount:1},
   {id:'TIP',rate:.1,type:'VAT',amount:8.5,taxableBase:85,total:93.5,lineCount:1}]};
 const current={...immutable,v3Binding:scope.binding,v3WarehouseId:'W',v3InventoryBaseline:JSON.stringify([scope.binding,'S',1,1,'C']),
  v3CommitFingerprint:JSON.stringify([JSON.stringify(immutable),'W',false,[],false,false,null]),fiscalProviderStatus:'V3_ISSUE_REQUESTED',fiscalSyncStatus:'ERROR',
  fiscalSyncError:'SYNC_V3_FISCAL_RECONCILIATION_REQUIRED',fiscalResponseMessage:'Existe un intento fiscal sin referencia confirmada. Requiere reconciliación antes de emitir de nuevo.'} as any;
 const financialText=JSON.stringify({displayId:immutable.displayId,ncf:immutable.ncf,electronicNcf:immutable.ncf,netAmount:85,taxAmount:23.8,total:108.8,
  taxBreakdown:immutable.taxBreakdown,fiscalSyncError:MSELLER_UNSUPPORTED_VAT_ERROR,readOnly:true,providerPostExecuted:false});
 const providerText=JSON.stringify({displayId:immutable.displayId,ncf:immutable.ncf,fiscalProvider:'MSELLER',fiscalProviderStatus:'V3_ISSUE_REQUESTED',fiscalSyncStatus:'ERROR',
  fiscalSyncError:MSELLER_UNSUPPORTED_VAT_ERROR,fiscalResponseMessage:MSELLER_UNSUPPORTED_VAT_ERROR,fiscalSecurityCodePresent:false,fiscalQrUrlPresent:false});
 return{current,history:structuredClone(current),currentCatalog:{syncId:'S',syncVersion:1,binding:scope.binding},scope,target:{...scope,id:'505',displayId:immutable.displayId,ncf:immutable.ncf},
  archives:{financialText,providerText,financialSha256:await sha256Utf8(financialText),providerSha256:await sha256Utf8(providerText)},
  guardProof:{installedVersion:'1.1.513',sourceCommit:'a'.repeat(40),apkSha256:'b'.repeat(64),evidenceSha256:'c'.repeat(64),blockedRetryRouteSha256:'d'.repeat(64),
   observedOnlyBlockedRetry:true,independentlyReviewedNoInterveningIssue:true},actorId:'operator',reason:'Restaurar evidencia del rechazo pre-envío comprobado'};
}
function sqlite(input:FiscalEvidenceRepairInput,path=':memory:'){
 const sql=new DatabaseSync(path);sql.exec('CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));');sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
 sql.prepare('INSERT INTO master_v3_operational_owner VALUES(1,\'S\',1,?)').run(input.scope.binding);
 sql.prepare('INSERT INTO documents(collection_name,doc_id,data) VALUES(\'config\',\'current\',?)').run(JSON.stringify({terminals:[{id:input.scope.terminalId,config:{erpBinding:{tenantId:input.scope.tenantId,companyId:input.scope.companyId}}}]}));
 sql.exec("UPDATE master_v3_state SET active_sync_id='S',active_version=1;INSERT INTO master_v3_inventory_state VALUES(1,'S',1,1,'C','now');");
 for(const [collection,document] of [['transactions',input.current],['transactionHistory',input.history],['outbox',{id:'pending',status:'PENDING',lease:'original'}]] as const)
  sql.prepare('INSERT INTO documents(collection_name,doc_id,data) VALUES(?,?,?)').run(collection,document.id,JSON.stringify(document));
 const bridge={query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>sql.prepare(q).run(...v),execute:async(q:string)=>{sql.exec(q);}};
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});
 const read=(name:string)=>JSON.parse(String(sql.prepare('SELECT data FROM documents WHERE collection_name=?').get(name)?.data));
 return{sql,adapter,read};
}

test('prepare is pure; exact approved native CAS restores only errors plus audit in both copies, preserving original financial/provider/stock/outbox',async()=>{
 const input=await fixture(),before=JSON.stringify(input);const plan=await prepareFiscalPresubmitEvidenceRepair(input);assert.equal(JSON.stringify(input),before);
 assert.equal(plan.summary.archiveFullOriginalChecksumAvailable,false);const f=sqlite(input);
 try{
  await assert.rejects(()=>executeApprovedFiscalPresubmitEvidenceRepair(plan,f.adapter,async()=>input.scope,{approved:false,operationId:plan.operationId} as any),/DENIED/);
  assert.deepEqual(f.read('transactions'),input.current);
  await executeApprovedFiscalPresubmitEvidenceRepair(plan,f.adapter,async()=>input.scope,{approved:true,operationId:plan.operationId});
  for(const collection of ['transactions','transactionHistory']){
   const result=f.read(collection);assert.equal(result.fiscalSyncError,MSELLER_UNSUPPORTED_VAT_ERROR);assert.equal(result.fiscalResponseMessage,MSELLER_UNSUPPORTED_VAT_ERROR);
   assert.equal(result.fiscalSyncStatus,'ERROR');assert.equal(result.fiscalProviderStatus,'V3_ISSUE_REQUESTED');assert.equal(result.fiscalPreSubmitRecoveryAudit.length,1);
   delete result.fiscalPreSubmitRecoveryAudit;assert.deepEqual({...result,fiscalSyncError:input.current.fiscalSyncError,fiscalResponseMessage:input.current.fiscalResponseMessage},input.current);
  }
  assert.deepEqual(f.read('outbox'),{id:'pending',status:'PENDING',lease:'original'});
  await assert.rejects(()=>executeApprovedFiscalPresubmitEvidenceRepair(plan,f.adapter,async()=>input.scope,{approved:true,operationId:plan.operationId}),/CONCURRENT/);
 }finally{f.sql.close();}
});
test('history CAS conflict rolls back transaction repair completely',async()=>{
 const input=await fixture(),plan=await prepareFiscalPresubmitEvidenceRepair(input),f=sqlite(input);
 try{
  f.sql.prepare('UPDATE documents SET data=? WHERE collection_name=\'transactionHistory\'').run(JSON.stringify({...input.history,fiscalReferenceId:'new receipt'}));
  await assert.rejects(()=>executeApprovedFiscalPresubmitEvidenceRepair(plan,f.adapter,async()=>input.scope,{approved:true,operationId:plan.operationId}),/CONCURRENT/);
  assert.deepEqual(f.read('transactions'),input.current);assert.equal(f.read('transactionHistory').fiscalReferenceId,'new receipt');
 }finally{f.sql.close();}
});
for(const field of ['fiscalReferenceId','fiscalCertifiedNcf','fiscalResponseCode','fiscalSignedXml','fiscalSyncedAt','fiscalQrUrl','fiscalSecurityCode','fiscalClassificationProjection','fiscalClassificationAttemptedAt'])test(`repair denies current ${field} proof`,async()=>{
 const input=await fixture();(input.current as any)[field]='proof';await assert.rejects(()=>prepareFiscalPresubmitEvidenceRepair(input),/DENIED/);
});
for(const mismatch of ['scope','archivehash','source','amount','unknownerror','history','noPostProof'])test(`repair denies ${mismatch}`,async()=>{
 const input=await fixture();
 if(mismatch==='scope')input.scope.companyId='foreign';if(mismatch==='archivehash')input.archives.providerSha256='0'.repeat(64);
 if(mismatch==='source')input.current.items[0].price=86;if(mismatch==='amount')input.current.total=109;
 if(mismatch==='unknownerror')input.current.fiscalSyncError='Document not found';if(mismatch==='history')input.history.payments=[];
 if(mismatch==='noPostProof')(input.guardProof as any).independentlyReviewedNoInterveningIssue=false;
 await assert.rejects(()=>prepareFiscalPresubmitEvidenceRepair(input),/DENIED/);
});

test('used native baseline projection/attempt/audit survive actual file close/reopen and ordinary remote ACK cannot add/remove/null them',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {createFiscalClassificationProjection,consumeFiscalClassificationAttempt}=await import('../utils/fiscalClassificationProjection');
 const directory=mkdtempSync(join(tmpdir(),'clic-cas-protected-')),path=join(directory,'native.db');
 const input=await fixture(),f=sqlite(input,path);advanceCatalog(f,input);
 const plan=await prepareFiscalPresubmitEvidenceRepair(input);
 let persisted:any;
 try{
  await executeApprovedFiscalPresubmitEvidenceRepair(plan,f.adapter,async()=>input.scope,{approved:true,operationId:plan.operationId});
  const original=f.read('transactions');
  const projection=await createFiscalClassificationProjection(original,[{id:'VAT',type:'VAT',rate:.18},{id:'TIP',type:'SERVICE_CHARGE',rate:.1}] as any,'U','Clasificar servicio',input.scope.binding);
  const corrected={...original,fiscalClassificationProjection:projection};
  await f.adapter.saveDocumentsAtomically([{collectionName:'transactions',document:corrected,expectedDocument:JSON.stringify(original),
   v3CurrentCatalog:input.currentCatalog,v3FiscalMetadataOperation:'CLASSIFICATION_PROJECTION_APPEND'}]);
  assert.deepEqual(f.read('transactions'),corrected);
  const consumed=await consumeFiscalClassificationAttempt(corrected);
  await f.adapter.saveDocumentsAtomically([{collectionName:'transactions',document:consumed,expectedDocument:JSON.stringify(corrected),
   v3CurrentCatalog:input.currentCatalog,v3FiscalMetadataOperation:'CLASSIFICATION_ATTEMPT_CONSUME'}]);
  assert.deepEqual(f.read('transactions'),consumed);
  await assert.rejects(()=>f.adapter.saveDocumentsAtomically([{collectionName:'transactions',document:consumed,expectedDocument:JSON.stringify(consumed),
   v3CurrentCatalog:input.currentCatalog,v3FiscalMetadataOperation:'CLASSIFICATION_ATTEMPT_CONSUME'}]),/METADATA_MUTATION_DENIED/);
  await f.adapter.saveDocument('transactions',{...consumed,fiscalClassificationProjection:null,fiscalClassificationAttemptedAt:null,fiscalPreSubmitRecoveryAudit:[]});
  persisted=f.read('transactions');
  assert.deepEqual(persisted.fiscalClassificationProjection,projection);assert.equal(persisted.fiscalClassificationAttemptedAt,consumed.fiscalClassificationAttemptedAt);
  assert.deepEqual(persisted.fiscalPreSubmitRecoveryAudit,original.fiscalPreSubmitRecoveryAudit);
  for(const key of ['items','payments','netAmount','taxAmount','total','ncf','electronicNcf','v3Binding','v3InventoryBaseline','v3CommitFingerprint']) assert.deepEqual(persisted[key],original[key]);
 }finally{f.sql.close();}
 const reopened=new DatabaseSync(path);
 try{
  const read=JSON.parse(String(reopened.prepare('SELECT data FROM documents WHERE collection_name=\'transactions\'').get()?.data));
  assert.deepEqual(read,persisted);await assert.rejects(()=>consumeFiscalClassificationAttempt(read),/RECONCILIATION/);
  const {build,transform}=await import('esbuild');
  Object.assign(globalThis,{__casReopened:read});
  const retainedBundle=await build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3RetainedCheckout.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'native-readonly',setup(b){
   b.onResolve({filter:/^(\.\.\/\.\.\/utils\/db|\.\.\/db)$/},a=>({path:a.path,namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='../db'?'export const dbAdapter={};':'export const db={getDocument:async()=>globalThis.__casReopened};',loader:'js'}));}}]});
  const retainedHelper=await import('data:text/javascript;base64,'+Buffer.from(retainedBundle.outputFiles[0].text).toString('base64'));
  const retained=await retainedHelper.readV3RetainedCheckout({originalTransactionId:'505'},true);
  assert.equal(retained.expected,JSON.stringify(read));assert.deepEqual(retained.items,read.items);
  const {readFileSync}=await import('node:fs');
  const financialSource=readFileSync(new URL('../services/sync/LargeMasterSyncV3FinancialCommit.ts',import.meta.url),'utf8');
  const start=financialSource.indexOf('export const validateV3FrozenFiscalAmounts'),end=financialSource.indexOf('export const buildV3InventoryLedger',start);
  const compiled=(await transform(financialSource.slice(start,end).replace('export const','const'),{loader:'ts'})).code;
  const validate=new Function('isV3FinancialDocument','isVerifiedV3RetainedContext','LargeMasterSyncV3Error','v3StockSource',compiled+'return validateV3FrozenFiscalAmounts;')(
   (row:any)=>row.items.some((line:any)=>Boolean(line.v3SaleAuthority)),retainedHelper.isVerifiedV3RetainedContext,Error,(stamp:any)=>({syncId:stamp.syncId,syncVersion:stamp.syncVersion}));
  assert.doesNotThrow(()=>validate(read,retained));

 }finally{reopened.close();rmSync(directory,{recursive:true,force:true});}
});

for(const operation of ['CLASSIFICATION_PROJECTION_APPEND','CLASSIFICATION_ATTEMPT_CONSUME','PRESUBMIT_EVIDENCE_REPAIR'] as const)test(`native CAS ${operation} denies financial/source/provider changes and unbound writes`,async()=>{
 const input=await fixture(),f=sqlite(input);
 try{
  for(const changes of [{total:109},{payments:[]},{ncf:'other'},{fiscalReferenceId:'receipt'},{v3Binding:'foreign'}]){
   await assert.rejects(()=>f.adapter.saveDocumentsAtomically([{collectionName:'transactions',document:{...input.current,...changes},
    expectedDocument:JSON.stringify(input.current),v3CurrentCatalog:input.currentCatalog,v3FiscalMetadataOperation:operation}]),/METADATA_MUTATION_DENIED|MOVEMENT_AUTHORITY|RUNTIME_VERSION_CHANGED/);
   assert.deepEqual(f.read('transactions'),input.current);
  }
  await assert.rejects(()=>f.adapter.saveDocumentsAtomically([{collectionName:'transactions',document:input.current,
   expectedDocument:JSON.stringify(input.current),v3FiscalMetadataOperation:operation}]),/METADATA_MUTATION_DENIED/);
 }finally{f.sql.close();}
});

test('actual immutable financial identity excludes CAS metadata without exposing them to ACK mutable whitelist',async()=>{
 const {V3_FINANCIAL_MUTABLE_FIELDS,V3_FINANCIAL_CAS_PROTECTED_FIELDS}=await import('../services/db/LargeMasterSyncV3FinancialRetention');
 const {readFileSync}=await import('node:fs'),{transform}=await import('esbuild');
 const source=readFileSync(new URL('../services/sync/LargeMasterSyncV3FinancialCommit.ts',import.meta.url),'utf8');
 const start=source.indexOf('const financialIdentity ='),end=source.indexOf('\nexport type V3FinancialOptions',start);
 const code=(await transform(source.slice(start,end),{loader:'ts'})).code;
 const identity=new Function('V3_FINANCIAL_MUTABLE_FIELDS','V3_FINANCIAL_CAS_PROTECTED_FIELDS',code+'return financialIdentity;')(V3_FINANCIAL_MUTABLE_FIELDS,V3_FINANCIAL_CAS_PROTECTED_FIELDS);
 const input=await fixture();const base=identity(input.current);
 assert.equal(identity({...input.current,fiscalClassificationProjection:{audit:'protected'},fiscalClassificationAttemptedAt:'once',fiscalPreSubmitRecoveryAudit:[{audit:'protected'}]}),base);
 assert.notEqual(identity({...input.current,total:109}),base);
 for(const field of V3_FINANCIAL_CAS_PROTECTED_FIELDS) assert.equal((V3_FINANCIAL_MUTABLE_FIELDS as readonly string[]).includes(field),false);
});

test('ordinary ACK cannot add CAS-protected fields on an uncorrected used baseline',async()=>{
 const input=await fixture(),f=sqlite(input);
 try{
  await f.adapter.saveDocument('transactions',{...input.current,fiscalClassificationProjection:{forged:true},fiscalClassificationAttemptedAt:'forged',fiscalPreSubmitRecoveryAudit:[{forged:true}]});
  const read=f.read('transactions');for(const key of ['fiscalClassificationProjection','fiscalClassificationAttemptedAt','fiscalPreSubmitRecoveryAudit'])assert.equal(read[key],undefined);
  for(const key of ['items','payments','total','v3CommitFingerprint']) assert.deepEqual(read[key],input.current[key]);
 }finally{f.sql.close();}
});
test('repair rejects an older unsupported native adapter and current company drift without writes',async()=>{
 const input=await fixture(),plan=await prepareFiscalPresubmitEvidenceRepair(input),f=sqlite(input);
 try{
  await assert.rejects(()=>executeApprovedFiscalPresubmitEvidenceRepair(plan,{saveDocumentsAtomically:f.adapter.saveDocumentsAtomically.bind(f.adapter)},async()=>input.scope,{approved:true,operationId:plan.operationId}),/DENIED/);
  f.sql.prepare('UPDATE documents SET data=? WHERE collection_name=\'config\'').run(JSON.stringify({terminals:[{id:input.scope.terminalId,config:{erpBinding:{tenantId:input.scope.tenantId,companyId:'foreign'}}}]}));
  await assert.rejects(()=>executeApprovedFiscalPresubmitEvidenceRepair(plan,f.adapter,async()=>input.scope,{approved:true,operationId:plan.operationId}),/METADATA_MUTATION_DENIED/);
  assert.deepEqual(f.read('transactions'),input.current);assert.deepEqual(f.read('transactionHistory'),input.history);
 }finally{f.sql.close();}
});

for(const change of [{fiscalProvider:'DIGIFACT'},{ncfType:'E34'},{electronicNcf:'E3200000506'},{fiscalQrCode:'processing-proof'}])test(`native raw repair CAS denies ${JSON.stringify(change)} despite supplied audit`,async()=>{
 const input=await fixture(),plan=await prepareFiscalPresubmitEvidenceRepair(input),f=sqlite(input);
 try{
  const invalid={...input.current,...change};
  f.sql.prepare('UPDATE documents SET data=? WHERE collection_name=\'transactions\'').run(JSON.stringify(invalid));
  const mutation={...plan.mutations[0],expectedDocument:JSON.stringify(invalid),document:{...plan.mutations[0].document,...change}};
  await assert.rejects(()=>f.adapter.saveDocumentsAtomically([mutation]),/METADATA_MUTATION_DENIED/);
  assert.deepEqual(f.read('transactions'),invalid);assert.deepEqual(f.read('transactionHistory'),input.history);
 }finally{f.sql.close();}
});

function advanceCatalog(f:ReturnType<typeof sqlite>,input:FiscalEvidenceRepairInput){
 input.currentCatalog={syncId:'S2',syncVersion:2,binding:input.scope.binding};
 f.sql.exec("UPDATE master_v3_operational_owner SET sync_id='S2',sync_version=2;UPDATE master_v3_state SET active_sync_id='S2',active_version=2;");
 for(const [id,version] of [['S',1],['S2',2]] as const) f.sql.prepare('INSERT INTO master_v3_catalog_owners VALUES(?,?,?,?,?,?,?)').run(id,version,input.scope.binding,'S',1,1,'C');
}
test('S2 active catalog/S1 retained financial source permits both repair copies atomically with explicit canonical history context',async()=>{
 const input=await fixture(),f=sqlite(input);advanceCatalog(f,input);
 try{
  const plan=await prepareFiscalPresubmitEvidenceRepair(input);
  assert.deepEqual(plan.mutations[1].v3ExpectedRetainedDocument,{collection:'transactions',id:input.current.id,expected:JSON.stringify(input.current)});
  await executeApprovedFiscalPresubmitEvidenceRepair(plan,f.adapter,async()=>input.scope,{approved:true,operationId:plan.operationId});
  for(const name of ['transactions','transactionHistory']){
   const read=f.read(name);assert.equal(read.fiscalSyncError,MSELLER_UNSUPPORTED_VAT_ERROR);assert.equal(read.fiscalPreSubmitRecoveryAudit.length,1);
   assert.deepEqual(read.items,input.current.items);assert.equal(read.v3CommitFingerprint,input.current.v3CommitFingerprint);
  }
  assert.equal(f.sql.prepare('SELECT sync_id FROM master_v3_inventory_state').get()?.sync_id,'S');
  assert.equal(f.sql.prepare('SELECT sync_id FROM master_v3_operational_owner').get()?.sync_id,'S2');
 }finally{f.sql.close();}
});
for(const stale of ['transactions','transactionHistory'])test(`S2/S1 stale ${stale} refuses complete repair with both copies unchanged`,async()=>{
 const input=await fixture(),f=sqlite(input);advanceCatalog(f,input);
 try{
  const plan=await prepareFiscalPresubmitEvidenceRepair(input);
  const altered={...(stale==='transactions'?input.current:input.history),fiscalResponseMessage:'changed after preparation'};
  f.sql.prepare('UPDATE documents SET data=? WHERE collection_name=?').run(JSON.stringify(altered),stale);
  await assert.rejects(()=>executeApprovedFiscalPresubmitEvidenceRepair(plan,f.adapter,async()=>input.scope,{approved:true,operationId:plan.operationId}),/CONCURRENT_FINANCIAL_UPDATE|RETAINED_TICKET_CHANGED/);
  assert.deepEqual(f.read('transactions'),stale==='transactions'?altered:input.current);
  assert.deepEqual(f.read('transactionHistory'),stale==='transactionHistory'?altered:input.history);
 }finally{f.sql.close();}
});

test('prepare rejects a sealed E31 with E32 NCF instead of changing the existing sequence',async()=>{
 const input=await fixture();
 for(const document of [input.current,input.history]){
  document.ncfType='E31';const fingerprint=JSON.parse(document.v3CommitFingerprint),sealed=JSON.parse(fingerprint[0]);sealed.ncfType='E31';
  fingerprint[0]=JSON.stringify(sealed);document.v3CommitFingerprint=JSON.stringify(fingerprint);
 }
 await assert.rejects(()=>prepareFiscalPresubmitEvidenceRepair(input),/REPAIR_DENIED/);
});
test('native raw repair CAS rejects a sealed E31/E32 prefix mismatch despite valid old financial source',async()=>{
 const input=await fixture(),plan=await prepareFiscalPresubmitEvidenceRepair(input),f=sqlite(input);
 try{
  const invalid={...input.current,ncfType:'E31'};
  f.sql.prepare('UPDATE documents SET data=? WHERE collection_name=\'transactions\'').run(JSON.stringify(invalid));
  const mutation={...plan.mutations[0],expectedDocument:JSON.stringify(invalid),document:{...plan.mutations[0].document,ncfType:'E31'}};
  await assert.rejects(()=>f.adapter.saveDocumentsAtomically([mutation]),/METADATA_MUTATION_DENIED/);
  assert.deepEqual(f.read('transactions'),invalid);assert.deepEqual(f.read('transactionHistory'),input.history);
 }finally{f.sql.close();}
});
for(const fiscalCode of ['E31','E32'] as const)for(const originalNcf of ['E3200000505','E320000000505'])test(`correct ${fiscalCode} prefix preserves ${originalNcf.replace('E32',fiscalCode)} formatting`,async()=>{
 const ncf=originalNcf.replace('E32',fiscalCode);
 const input=await fixture();input.target.ncf=ncf;
 for(const document of [input.current,input.history]){
  document.ncf=ncf;document.electronicNcf=ncf;document.ncfType=fiscalCode;
  const fingerprint=JSON.parse(document.v3CommitFingerprint),sealed=JSON.parse(fingerprint[0]);sealed.ncf=ncf;sealed.electronicNcf=ncf;sealed.ncfType=fiscalCode;
  fingerprint[0]=JSON.stringify(sealed);document.v3CommitFingerprint=JSON.stringify(fingerprint);
 }
 const financial=JSON.parse(input.archives.financialText);financial.ncf=ncf;financial.electronicNcf=ncf;
 const provider=JSON.parse(input.archives.providerText);provider.ncf=ncf;
 input.archives.financialText=JSON.stringify(financial);input.archives.providerText=JSON.stringify(provider);
 input.archives.financialSha256=await sha256Utf8(input.archives.financialText);input.archives.providerSha256=await sha256Utf8(input.archives.providerText);
 const plan=await prepareFiscalPresubmitEvidenceRepair(input),f=sqlite(input);
 try{
  await executeApprovedFiscalPresubmitEvidenceRepair(plan,f.adapter,async()=>input.scope,{approved:true,operationId:plan.operationId});
  assert.equal(f.read('transactions').ncf,ncf);assert.equal(f.read('transactionHistory').electronicNcf,ncf);
 }finally{f.sql.close();}
});
