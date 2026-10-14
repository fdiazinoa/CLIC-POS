import test from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction, TaxDefinition } from '../types';
import { authorizeV3TaxClassification } from '../services/sync/LargeMasterSyncV3TaxClassification';
import { MSELLER_UNSUPPORTED_VAT_ERROR, createFiscalClassificationProjection, applyFiscalClassificationProjection, canProjectFiscalClassification } from '../utils/fiscalClassificationProjection';

const taxes = [{id:'VAT',name:'ITBIS',type:'VAT',rate:.18},{id:'TIP',name:'Servicio',type:'SERVICE_CHARGE',rate:.1}] as TaxDefinition[];
const fixture = (): Transaction => ({id:'505',ncf:'E3200000505',electronicNcf:'E3200000505',ncfType:'E32',terminalId:'T',date:'2026-10-13',
  fiscalProvider:'MSELLER',fiscalSyncStatus:'ERROR',fiscalProviderStatus:'V3_ISSUE_REQUESTED',fiscalSyncError:MSELLER_UNSUPPORTED_VAT_ERROR,
  fiscalResponseMessage:MSELLER_UNSUPPORTED_VAT_ERROR,items:[{id:'A',cartId:'A',quantity:1,price:85,netAmount:85,taxAmount:23.8,totalAmount:108.8,
  appliedTaxIds:['VAT','TIP'],v3SaleAuthority:{binding:'B'}}],netAmount:85,taxAmount:23.8,total:108.8,payments:[{amount:108.8,method:'CASH'}],
  taxBreakdown:[{id:'VAT',name:'ITBIS',rate:.18,type:'VAT',amount:15.3,taxableBase:85,total:100.3,lineCount:1},
  {id:'TIP',name:'10%',rate:.1,type:'VAT',amount:8.5,taxableBase:85,total:93.5,lineCount:1}]}) as Transaction;
for(const mode of ['RESTAURANT','SUPERMARKET']) test(`${mode} explicit projection preserves every source/monetary/provider field; wire only adds001`,async()=>{
  const tx=fixture();(tx as any).subVertical=mode;
  const original=JSON.stringify(tx);
  const projection=await createFiscalClassificationProjection(tx,taxes,'cashier','Clasificar servicio legal','B');
  assert.equal(JSON.stringify(tx),original);
  const corrected={...tx,fiscalClassificationProjection:projection};
  assert.equal(corrected.fiscalSyncStatus,'ERROR');assert.equal(corrected.fiscalProviderStatus,'V3_ISSUE_REQUESTED');
  assert.deepEqual(await createFiscalClassificationProjection(corrected,taxes,'cashier','same','B'),projection);
  const wire=await applyFiscalClassificationProjection(corrected);
  assert.equal(wire.taxBreakdown![0].amount,15.3);assert.equal(wire.taxBreakdown![1].amount,8.5);
  assert.equal(wire.taxBreakdown![1].type,'SERVICE_CHARGE');assert.equal(wire.taxBreakdown![1].fiscalAdditionalTaxCode,'001');
  assert.equal(wire.total,108.8);assert.strictEqual(wire.items,tx.items);assert.strictEqual(wire.payments,tx.payments);
  assert.deepEqual({...wire,taxBreakdown:tx.taxBreakdown},corrected);
  assert.equal(corrected.taxBreakdown![1].type,'VAT');
});
for (const patch of [{fiscalSyncStatus:'SYNCED'},{fiscalSyncStatus:'PENDING'},{fiscalReferenceId:'receipt'},
 {fiscalCertifiedNcf:'E320000000505'},{fiscalProviderStatus:'DGIIAceptado'},
 {fiscalSyncError:'Document not found'},{fiscalResponseMessage:'Connection failed'}, {fiscalQrUrl:'url'}]) test(`deny ambiguous/processed ${JSON.stringify(patch)}`,async()=>{
  const tx={...fixture(),...patch} as Transaction;assert.equal(canProjectFiscalClassification(tx),false);
  await assert.rejects(()=>createFiscalClassificationProjection(tx,taxes,'U','Reason','B'),/DENIED/);
});
test('scope, stale financial source and tampered audit deny',async()=>{
  const tx=fixture();await assert.rejects(()=>createFiscalClassificationProjection(tx,taxes,'U','Reason','other'),/DENIED/);
  const projection=await createFiscalClassificationProjection(tx,taxes,'U','Reason','B');
  await assert.rejects(()=>applyFiscalClassificationProjection({...tx,total:109,netAmount:85.2,fiscalClassificationProjection:projection}),/STALE/);
  projection.after[1].amount=9;
  await assert.rejects(()=>applyFiscalClassificationProjection({...tx,fiscalClassificationProjection:projection}),/SOURCE_INVALID/);
});
for(const target of [{type:'VAT'},{type:'EXEMPT'},{type:'SERVICE_CHARGE',rate:.11},{type:'SERVICE_CHARGE',active:false},{type:'SERVICE_CHARGE',id:'other'}]) test(`migration rejects ${JSON.stringify(target)}`,()=>{
  const old={id:'T',type:'VAT',rate:.1,active:true}, next={...old,...target};
  if(JSON.stringify(old)===JSON.stringify(next)) assert.deepEqual(authorizeV3TaxClassification([old],[next]),[]);
  else assert.throws(()=>authorizeV3TaxClassification([old],[next]),/SEMANTICS/);
});
test('explicit transition audit fingerprints, duplicates and reverse deny',()=>{
  const old={id:'T',type:'VAT',rate:.1,active:true},next={...old,type:'SERVICE_CHARGE'};
  assert.equal(authorizeV3TaxClassification([old],[next])[0].id,'T');
  assert.throws(()=>authorizeV3TaxClassification([next],[old]),/SEMANTICS/);
  assert.throws(()=>authorizeV3TaxClassification([old,old],[next,next]),/TAX_INVALID/);
});

test('classification attempt is consumed once before request, persists across timeout/restart and refuses all second attempts',async()=>{
 const {consumeFiscalClassificationAttempt}=await import('../utils/fiscalClassificationProjection');
 const tx=fixture();tx.fiscalClassificationProjection=await createFiscalClassificationProjection(tx,taxes,'U','Reason','B');
 const consumed=await consumeFiscalClassificationAttempt(tx);
 assert.ok(consumed.fiscalClassificationAttemptedAt);assert.equal(consumed.fiscalSyncStatus,'ERROR');
 assert.equal(canProjectFiscalClassification(consumed),false);
 assert.equal((await applyFiscalClassificationProjection(consumed)).taxBreakdown![1].type,'SERVICE_CHARGE');
 for(const status of ['ERROR','PENDING','SYNCED']) await assert.rejects(()=>consumeFiscalClassificationAttempt({
  ...JSON.parse(JSON.stringify(consumed)),fiscalSyncStatus:status}),/RECONCILIATION/);
 assert.equal(JSON.stringify(tx.fiscalClassificationProjection),JSON.stringify(consumed.fiscalClassificationProjection));
});

test('actual App retry commits one-shot CAS before mock issue; timeout/restart/concurrent retry do not issue twice',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {CapacitorSQLiteAdapter}=await import('../services/db/adapters/CapacitorSQLiteAdapter');
 const {readFileSync}=await import('node:fs');const {transform}=await import('esbuild');
 const {consumeFiscalClassificationAttempt}=await import('../utils/fiscalClassificationProjection');
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));');
 const {LARGE_MASTER_SYNC_V3_SCHEMA_SQL}=await import('../services/db/LargeMasterSyncV3Schema');sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
 sql.exec("INSERT INTO master_v3_operational_owner VALUES(1,'S',1,'B');UPDATE master_v3_state SET active_sync_id='S',active_version=1;INSERT INTO master_v3_inventory_state VALUES(1,'S',1,1,'C','now');");
 const bridge={query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>sql.prepare(q).run(...v),execute:async(q:string)=>{sql.exec(q);}};
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});
 let tx=fixture();Object.assign(tx,{v3Binding:'B',v3WarehouseId:'W',v3InventoryBaseline:JSON.stringify(['B','S',1,1,'C'])});
 Object.assign(tx.items[0].v3SaleAuthority!,{syncId:'S',syncVersion:1,inventoryVersion:1,inventoryCursor:'C',warehouseId:'W',tariffId:'T',taxIncluded:false});
 tx.fiscalClassificationProjection=await createFiscalClassificationProjection(tx,taxes,'U','Reason','B');
 await adapter.saveDocument('transactions',tx);
 const read=()=>JSON.parse(String(sql.prepare('SELECT data FROM documents WHERE doc_id=?').get('505')?.data));
 const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');const start=source.indexOf('async (transaction: Transaction): Promise<string> => {',source.indexOf('const retryFiscalDocument ='));
 const end=source.indexOf('}, [config, pollFiscalDocumentStatus, syncFiscalDocument, upsertFiscalTransaction]);',start);assert.ok(start>0&&end>start);
 const compiled=await transform(`const callback=${source.slice(start,end+1)};`,{loader:'ts'});
 const create=new Function('f',`const {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,canProjectFiscalClassification,canRetryFiscalTransaction,config,getEffectiveFiscalComplianceConfig,getProviderEnvironment,getFiscalProviderConfig,getExistingFiscalProviderReference,getFiscalProviderLabel,db,dbAdapter,consumeFiscalClassificationAttempt,getLargeMasterSyncV3OperationalSession,upsertFiscalTransaction,pollFiscalDocumentStatus,syncFiscalDocument}=f;${compiled.code}return callback;`);
 let issues=0;
 const retry=create({LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:true,canProjectFiscalClassification,canRetryFiscalTransaction:()=>true,config:{terminals:[]},getEffectiveFiscalComplianceConfig:()=>({}),getProviderEnvironment:()=>0,
  getFiscalProviderConfig:()=>({}),getExistingFiscalProviderReference:()=>undefined,getFiscalProviderLabel:()=> 'MSeller',db:{getDocument:async()=>read()},dbAdapter:adapter,
  consumeFiscalClassificationAttempt,getLargeMasterSyncV3OperationalSession:async()=>({assertCurrent:async()=>{},ready:{runtime:{version:{syncId:'S',syncVersion:1}}},binding:'B'}),
  upsertFiscalTransaction:async(next:any)=>adapter.saveDocument('transactions',next),pollFiscalDocumentStatus:async()=>{throw Error('unexpected poll');},
  syncFiscalDocument:async(next:any,explicit:boolean)=>{assert.ok(read().fiscalClassificationAttemptedAt);assert.equal(explicit,true);issues++;throw Error('mock timeout');}});
 try{
  const attempts=await Promise.allSettled([retry(tx),retry(tx)]);assert.equal(attempts.filter(row=>row.status==='fulfilled').length,0);assert.equal(issues,1);
  await assert.rejects(()=>retry(JSON.parse(JSON.stringify(read()))),/RECONCILIATION/);assert.equal(issues,1);
  assert.deepEqual(read().payments,tx.payments);assert.equal(read().taxBreakdown[1].type,'VAT');assert.equal(read().ncf,tx.ncf);
 }finally{sql.close();}
});

for(const field of ['netAmount','taxAmount','total']) for(const value of [NaN,Infinity,undefined,-1]) test(`classification rejects malformed ${field}=${String(value)} before attempt`,async()=>{
 const tx=fixture();(tx as any)[field]=value;
 await assert.rejects(()=>createFiscalClassificationProjection(tx,taxes,'U','Reason','B'),/SOURCE_INVALID/);
 assert.equal(tx.fiscalClassificationAttemptedAt,undefined);
 const valid=fixture();const projection=await createFiscalClassificationProjection(valid,taxes,'U','Reason','B');
 await assert.rejects(()=>applyFiscalClassificationProjection({...tx,fiscalClassificationProjection:projection}),/SOURCE_INVALID/);
});
for(const field of ['fiscalResponseCode','fiscalSignedXml','fiscalQrCode']) test(`contradictory ${field} proof dominates unsupported error for correction, wire and consumption`,async()=>{
 const tx=fixture();const projection=await createFiscalClassificationProjection(tx,taxes,'U','Reason','B');
 const proved={...tx,[field]:field==='fiscalResponseCode'?'1':'<signed>proof</signed>',fiscalClassificationProjection:projection};
 assert.equal(canProjectFiscalClassification(proved),false);
 await assert.rejects(()=>createFiscalClassificationProjection(proved,taxes,'U','Reason','B'),/DENIED/);
 await assert.rejects(()=>applyFiscalClassificationProjection(proved),/STALE/);
 const {consumeFiscalClassificationAttempt}=await import('../utils/fiscalClassificationProjection');
 await assert.rejects(()=>consumeFiscalClassificationAttempt(proved),/RECONCILIATION/);
 for(const value of [null,undefined,'','  ']) assert.equal(canProjectFiscalClassification({...tx,[field]:value}),true);
});
