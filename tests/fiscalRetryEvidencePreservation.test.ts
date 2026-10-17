import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
import {requireFiscalErpAppliedReceipt,FISCAL_DISPATCH_CLAIMS} from '../services/fiscal/FiscalMSellerDispatch';
import {MSELLER_UNSUPPORTED_VAT_ERROR} from '../utils/fiscalClassificationProjection';
const tx=()=>({id:'505',fiscalProvider:'MSELLER',ncfType:'E32',ncf:'E3200000505',fiscalSyncStatus:'ERROR',fiscalProviderStatus:'V3_ISSUE_REQUESTED',
 fiscalSyncError:MSELLER_UNSUPPORTED_VAT_ERROR,fiscalResponseMessage:MSELLER_UNSUPPORTED_VAT_ERROR,items:[],payments:[{amount:108.8}],netAmount:85,taxAmount:23.8,total:108.8});
async function fixture(stored:any,flag=true){
 const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const compile=async(name:string,begin:string,end:string)=>{const a=source.indexOf(begin,source.indexOf('const '+name+' =')),b=source.indexOf(end,a);assert.ok(a>0&&b>a);return(await transform('const callback='+source.slice(a,b+1)+';',{loader:'ts'})).code;};
 const syncCode=await compile('syncFiscalDocument','async (transaction: Transaction,','}, [config, pollFiscalDocumentStatus, upsertFiscalTransaction, loadFiscalStatusContext, fiscalStatusWorker]);');
 const retryCode=await compile('retryFiscalDocument','async (transaction: Transaction): Promise<string> => {','}, [config, pollFiscalDocumentStatus, syncFiscalDocument, upsertFiscalTransaction]);');
 let polls=0,writes=0,issues=0,consumed=0;const history=structuredClone(stored);
 const f:any={LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:flag,v3FiscalInFlightRef:{current:new Map()},db:{getDocument:async(name:string)=>name==='transactions'?structuredClone(stored):null},
  getExistingFiscalProviderReference:(row:any)=>row.fiscalReferenceId||row.fiscalCertifiedNcf,fiscalStatusWorker:{consult:async()=>{polls++;return 'GET-only';}},requireFiscalErpAppliedReceipt,FISCAL_DISPATCH_CLAIMS,
  issueFiscalDocument:async()=>{issues++;throw Error('unexpected POST');},upsertFiscalTransaction:async()=>{writes++;},consumeFiscalClassificationAttempt:async()=>{consumed++;throw Error('unexpected consumption');}};
 const bindings='const {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,v3FiscalInFlightRef,db,getExistingFiscalProviderReference,fiscalStatusWorker,requireFiscalErpAppliedReceipt,FISCAL_DISPATCH_CLAIMS,issueFiscalDocument,upsertFiscalTransaction,consumeFiscalClassificationAttempt,syncFiscalDocument}=f;';
 f.syncFiscalDocument=new Function('f',bindings+syncCode+'return callback;')(f);
 return{retry:new Function('f',bindings+retryCode+'return callback;')(f),sync:f.syncFiscalDocument,read:()=>({stored,history,writes,issues,polls,consumed})};
}
for(const flag of [true,false])for(const error of [MSELLER_UNSUPPORTED_VAT_ERROR,'Network timeout','SYNC_V3_FISCAL_RECONCILIATION_REQUIRED',undefined])test(`retry candidate=${flag} unknown ${String(error)} is GET-only, original and projection attempts untouched`,async()=>{
 const original={...tx(),fiscalSyncError:error,fiscalResponseMessage:error};const f=await fixture(original,flag);await f.retry({...tx(),fiscalProviderStatus:undefined});
 assert.deepEqual(f.read(),{stored:original,history:original,writes:0,issues:0,polls:1,consumed:0});
});
test('stale UI cannot overwrite fresh accepted proof and receipt retry never consumes projection',async()=>{
 for(const original of [{...tx(),fiscalSyncStatus:'SYNCED',fiscalReferenceId:'accepted'},{...tx(),fiscalReferenceId:'receipt',fiscalClassificationProjection:{version:1}}]){
  const f=await fixture(original);assert.match(await f.retry(tx()),/Consulta/);assert.deepEqual(f.read(),{stored:original,history:original,writes:0,issues:0,polls:1,consumed:0});
 }
});
test('missing fresh persisted transaction refuses stale UI without writes',async()=>{
 const f=await fixture(null);await assert.rejects(()=>f.retry(tx()),/ARCHIVED_RECONCILIATION_REQUIRED/);assert.equal(f.read().writes,0);assert.equal(f.read().issues,0);
});
test('unattempted classification projection stays held before attempt consumption or writes',async()=>{
 const original={...tx(),fiscalProviderStatus:undefined,fiscalSyncError:undefined,fiscalResponseMessage:undefined,fiscalClassificationProjection:{version:1}};
 const f=await fixture(original);await assert.rejects(()=>f.retry(original),/APPLIED_RECEIPT_REQUIRED/);assert.deepEqual(f.read(),{stored:original,history:original,writes:0,issues:0,polls:0,consumed:0});
});
