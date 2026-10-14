import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
import {canProjectFiscalClassification,MSELLER_UNSUPPORTED_VAT_ERROR} from '../utils/fiscalClassificationProjection';

const tx=()=>({id:'505',fiscalProvider:'MSELLER',ncfType:'E32',ncf:'E3200000505',fiscalSyncStatus:'ERROR',fiscalProviderStatus:'V3_ISSUE_REQUESTED',
 fiscalSyncError:MSELLER_UNSUPPORTED_VAT_ERROR,fiscalResponseMessage:MSELLER_UNSUPPORTED_VAT_ERROR,items:[],payments:[{amount:108.8}],netAmount:85,taxAmount:23.8,total:108.8});
async function retryFixture(stored:any){
 const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');const start=source.indexOf('async (transaction: Transaction): Promise<string> => {',source.indexOf('const retryFiscalDocument ='));
 const end=source.indexOf('}, [config, pollFiscalDocumentStatus, syncFiscalDocument, upsertFiscalTransaction]);',start);
 const code=(await transform(`const callback=${source.slice(start,end+1)};`,{loader:'ts'})).code;
 const create=new Function('f',`const {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,canProjectFiscalClassification,canRetryFiscalTransaction,config,getEffectiveFiscalComplianceConfig,getProviderEnvironment,getFiscalProviderConfig,getExistingFiscalProviderReference,getFiscalProviderLabel,db,dbAdapter,consumeFiscalClassificationAttempt,getLargeMasterSyncV3OperationalSession,upsertFiscalTransaction,pollFiscalDocumentStatus,syncFiscalDocument}=f;${code}return callback;`);
 let history=structuredClone(stored),writes=0,issues=0,polls=0,consumed=0;
 const f={LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:true,canProjectFiscalClassification,canRetryFiscalTransaction:(x:any)=>x.fiscalSyncStatus!=='SYNCED',config:{terminals:[]},
 getEffectiveFiscalComplianceConfig:()=>({}),getProviderEnvironment:()=>0,getFiscalProviderConfig:()=>({}),getFiscalProviderLabel:()=> 'MSeller',
 getExistingFiscalProviderReference:(x:any)=>x.fiscalReferenceId||x.fiscalCertifiedNcf,db:{getDocument:async()=>structuredClone(stored)},dbAdapter:{},
 consumeFiscalClassificationAttempt:async()=>{consumed++;throw Error('unexpected consume');},getLargeMasterSyncV3OperationalSession:async()=>{throw Error('unexpected session');},
 upsertFiscalTransaction:async(x:any)=>{writes++;stored=structuredClone(x);history=structuredClone(x);},
 pollFiscalDocumentStatus:async()=>{polls++;},syncFiscalDocument:async()=>{issues++;}};
 return {retry:create(f),read:()=>({stored,history,writes,issues,polls,consumed})};
}
for(const error of [MSELLER_UNSUPPORTED_VAT_ERROR,'Network timeout','SYNC_V3_FISCAL_RECONCILIATION_REQUIRED',undefined]) test(`fresh unresolved ${String(error)} retry preserves transaction/history without issue`,async()=>{
 const original={...tx(),fiscalSyncError:error,fiscalResponseMessage:error};const f=await retryFixture(original);
 await assert.rejects(()=>f.retry({...tx(),fiscalProviderStatus:undefined}),error===MSELLER_UNSUPPORTED_VAT_ERROR?/Corrige primero/:/reconciliación/);
 assert.deepEqual(f.read(),{stored:original,history:original,writes:0,issues:0,polls:0,consumed:0});
});
test('stale UI cannot overwrite fresh accepted proof',async()=>{
 const original={...tx(),fiscalSyncStatus:'SYNCED',fiscalReferenceId:'accepted'};const f=await retryFixture(original);
 await assert.rejects(()=>f.retry(tx()),/Solo se pueden/);assert.deepEqual(f.read().stored,original);assert.equal(f.read().writes,0);
});
test('fresh receipt uses status polling, bypasses projection consumption and never issues',async()=>{
 const original={...tx(),fiscalReferenceId:'receipt',fiscalClassificationProjection:{version:1}};const f=await retryFixture(original);
 assert.match(await f.retry(tx()),/Consulta/);assert.equal(f.read().issues,0);assert.equal(f.read().polls,1);assert.equal(f.read().consumed,0);assert.equal(f.read().stored.fiscalReferenceId,'receipt');assert.equal(f.read().writes,0);assert.deepEqual(f.read().stored,original);
});
test('missing fresh persisted transaction refuses stale UI without writes',async()=>{
 const f=await retryFixture(null);await assert.rejects(()=>f.retry(tx()),/COMMITTED_TRANSACTION_REQUIRED/);assert.equal(f.read().writes,0);assert.equal(f.read().issues,0);
});

for(const error of [MSELLER_UNSUPPORTED_VAT_ERROR,'Unknown timeout','SYNC_V3_FISCAL_RECONCILIATION_REQUIRED']) test(`actual sync early unresolved guard preserves ${error} despite invalid config/source`,async()=>{
 const original={...tx(),fiscalSyncError:error,fiscalResponseMessage:error};let stored=structuredClone(original),writes=0,issues=0,validations=0;
 const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');const start=source.indexOf('async (transaction: Transaction,',source.indexOf('const syncFiscalDocument ='));
 const end=source.indexOf('}, [config, pollFiscalDocumentStatus, upsertFiscalTransaction]);',start);
 const code=(await transform(`const callback=${source.slice(start,end+1)};`,{loader:'ts'})).code;
 const create=new Function('f',`const {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,v3FiscalInFlightRef,config,db,getLargeMasterSyncV3OperationalSession,getExistingFiscalProviderReference,upsertFiscalTransaction,issueFiscalDocument}=f;${code}return callback;`);
 const sync=create({LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:true,v3FiscalInFlightRef:{current:new Map()},config:{},db:{getDocument:async()=>structuredClone(stored)},
 getExistingFiscalProviderReference:()=>undefined,getLargeMasterSyncV3OperationalSession:async()=>{validations++;throw Error('invalid config/source');},
 upsertFiscalTransaction:async(x:any)=>{writes++;stored=x;},issueFiscalDocument:async()=>{issues++;}});
 await sync({...tx(),fiscalProviderStatus:undefined});assert.deepEqual(stored,original);assert.equal(writes,0);assert.equal(issues,0);assert.equal(validations,0);
});
