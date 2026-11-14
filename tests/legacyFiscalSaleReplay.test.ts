import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {financialOperationIdentity} from '../services/db/LargeMasterSyncV3FinancialRetention';

test('last-number committed sale is recovered without fresh stock/NCF authority; mismatches fail closed',async()=>{
 const state:any={documents:new Map(),binding:'tenant-terminal-device',reads:0};
 (globalThis as any).__legacyReplayFixture=state;
 const mocks:Record<string,string>={
  '../../utils/db':`export const db={getDocument:async(name,id)=>globalThis.__legacyReplayFixture.documents.get(name+':'+id)||null};`,
  '../db':'export const dbAdapter={};',
  './LargeMasterSyncV3OperationalSession':`export const getLargeMasterSyncV3RetainedSession=async()=>({binding:globalThis.__legacyReplayFixture.binding,assertCurrent:async()=>{globalThis.__legacyReplayFixture.reads++}});export const getLargeMasterSyncV3OperationalSession=async()=>{throw Error('fresh stock unavailable')};export const v3InventoryBaselineKey=()=>'';`,
 };
 const bundle=await build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3FinancialCommit.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'replay-fixture',setup(b){
  b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));
 }}]});
 const {readV3CommittedLegacySaleReplay:replay}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 const candidate:any={id:'same-sale',documentType:'TICKET',ncfType:'B02',ncf:'B0200000020',terminalId:'terminal',total:100,items:[],payments:[{id:'p',method:'CASH',amount:100}]};
 const stored={...candidate,v3Binding:state.binding,v3CommitFingerprint:financialOperationIdentity(candidate,'warehouse',{})};
 const put=(active:any=stored,history:any=stored)=>{state.documents.clear();if(active)state.documents.set('transactions:same-sale',active);if(history)state.documents.set('transactionHistory:same-sale',history);};
 put();assert.deepEqual(await replay(candidate,'warehouse'),stored);assert.equal(state.reads,1);
 for(const changed of [{...candidate,total:101},{...candidate,terminalId:'foreign'},{...candidate,ncf:'B0200000019'},{...candidate,payments:[{method:'CARD',amount:100}]}])await assert.rejects(replay(changed,'warehouse'),/MISMATCH/);
 await assert.rejects(replay(candidate,'foreign-warehouse'),/MISMATCH/);
 put({...stored,v3Binding:'foreign'},stored);await assert.rejects(replay(candidate,'warehouse'),/MISMATCH/);
 put(stored,{...stored,v3CommitFingerprint:'invalid'});await assert.rejects(replay(candidate,'warehouse'),/MISMATCH/);
 put(stored,null);await assert.rejects(replay(candidate,'warehouse'),/MISMATCH/);
 put(null,{...stored,zReportId:'Z-closed'});assert.equal((await replay(candidate,'warehouse')).zReportId,'Z-closed');
 put(null,null);assert.equal(await replay(candidate,'warehouse'),null);
 delete (globalThis as any).__legacyReplayFixture;
});
test('retained draft resumes before fresh checkout stock/NCF checks and order numbering',()=>{
 const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('const handlePaymentConfirm'),source.indexOf('const handleSplitConfirm'));
 assert.ok(body.indexOf('legacyFiscalAttemptRef.current.resume')<body.indexOf('assertCheckoutFiscalAuthority'));
 assert.match(body,/if\(!retainedLegacyTxn\)await assertCheckoutFiscalAuthority/);
 assert.match(body,/if \(!retainedLegacyTxn&&v3Operational/);
 assert.match(body,/saleOrderNumber = retainedLegacyTxn\?\.orderNumber/);
 assert.ok(body.indexOf('legacyFiscalAttemptRef.current.retain')<body.indexOf('onTransactionComplete(settledFinalTxn)'));
});
