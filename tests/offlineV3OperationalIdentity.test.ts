import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext,Script} from 'node:vm';
import {build} from 'esbuild';

// Compile the actual operational entry point; replace only cached read-only ports.
const ports:Record<string,string>={
 './SyncProfile':`export const resolveSyncTarget=()=>({kind:'ERP_ACTIVE',useLocalTarget:false,baseUrl:'https://synthetic.invalid/api/sync',terminalId:'terminal'});`,
 '../fiscal/OfflineFiscalLeaseContext':`export const readOfflineFiscalLocalAuthority=async()=>globalThis.fixture.authority;`,
 './LargeMasterSyncV3BoundTransport':`export const validatedLargeMasterSyncV3ErpSyncBase=x=>x;`,
 '../db':`export const dbAdapter={fiscalWorkflowStore:{currentCheckout:async()=>globalThis.fixture.current,offlineLease:async(a,recovery,id)=>{globalThis.fixture.calls.push(['V1',recovery,id]);return globalThis.fixture.lease;},allocationDraft:async(c)=>{globalThis.fixture.calls.push(['V2_DRAFT',c.checkoutId]);if(globalThis.fixture.draftError)throw Error(globalThis.fixture.draftError);return {ncf:'original-ncf'};},allocationAvailability:async()=>{globalThis.fixture.calls.push(['V2_AVAILABILITY']);if(globalThis.fixture.mode==='REVOKED')throw Error('OFFLINE_FISCAL_AUTHORITY_REVOKED');if(globalThis.fixture.mode==='EXPIRED')throw Error('OFFLINE_FISCAL_RANGE_EXPIRED');return globalThis.fixture.mode==='EXPANDED'?{authorizationId:'new-v2',remaining:{E32:10}}:null;}}};`
};
const compiled=build({entryPoints:[new URL('../services/sync/OfflineV3OperationalIdentity.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'cached-native-ports',setup(builder){builder.onResolve({filter:/.*/},args=>ports[args.path]?{path:args.path,namespace:'fixture-port'}:undefined);builder.onLoad({filter:/.*/,namespace:'fixture-port'},args=>({contents:ports[args.path],loader:'js'}));}}]});
async function fixture(){
 const state:any={authority:{scope:{tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device'},bindingHash:'same'},current:{checkoutId:'checkout-original',transactionId:'tx-original',phase:'EFFECT_POSSIBLE',paymentIds:['payment-original'],permit:{leaseId:'v1-original'},offlineBindingHash:'same',offlineEffectAt:'2026-10-21T12:00:00Z',cartIdentity:'original-cart'},lease:{leaseId:'v1-original',issuedAt:'2026-10-20T00:00:00Z',validUntil:'2026-10-22T00:00:00Z'},mode:'NONE',calls:[]};
 const module={exports:{} as any};const context=createContext({fixture:state,module,exports:module.exports});new Script((await compiled).outputFiles[0].text).runInContext(context);return {state,read:module.exports.readOfflineV3OperationalAuthority as ()=>Promise<any>};
}
test('original paid V1 authority wins over unavailable, revoked, expired and expanded V2',async()=>{
 for(const mode of ['NONE','REVOKED','EXPIRED','EXPANDED']){const {state,read}=await fixture();state.mode=mode;const before=JSON.stringify(state.current);const result=await read();assert.equal(result.recovery.leaseId,'v1-original');assert.equal(result.recovery.checkoutId,'checkout-original');assert.equal(result.recovery.transactionId,'tx-original');assert.equal(result.recovery.cartIdentity,'original-cart');assert.equal(JSON.stringify(result.recovery.paymentIds),'["payment-original"]');assert.equal(JSON.stringify(state.current),before);assert.deepEqual(JSON.parse(JSON.stringify(state.calls)),[['V1',true,'v1-original']]);}
});
test('invalid original paid V1 proof never falls through to a fresh V2 or V1 authority',async()=>{
 for(const fault of ['binding','missing','different','lateEffect']){const {state,read}=await fixture();state.mode='EXPANDED';if(fault==='binding')state.current.offlineBindingHash='other';if(fault==='missing')state.lease=null;if(fault==='different')state.lease.leaseId='different-lease';if(fault==='lateEffect')state.current.offlineEffectAt='2026-10-23T12:00:00Z';await assert.rejects(read(),/RECONCILIATION_REQUIRED/);assert.ok(state.calls.every((call:any)=>call[0]==='V1'));}
});
test('retained V2 paid attempt uses its own native draft; withdrawal holds instead of selecting V1',async()=>{
 for(const draftError of [null,'OFFLINE_FISCAL_AUTHORITY_REVOKED','OFFLINE_FISCAL_RANGE_EXPIRED']){const {state,read}=await fixture();delete state.current.permit;state.current.allocation={authorizationId:'v2-original'};state.draftError=draftError;state.mode='EXPANDED';if(draftError)await assert.rejects(read(),new RegExp(draftError));else{const result=await read();assert.equal(result.recovery.authorizationId,'v2-original');assert.equal(result.recovery.leaseId,undefined);assert.equal(result.recovery.transactionId,'tx-original');}assert.deepEqual(JSON.parse(JSON.stringify(state.calls)),[['V2_DRAFT','checkout-original']]);}
});
test('PREPARED attempt retains original kind without granting a paid-recovery descriptor',async()=>{
 for(const kind of ['V1','V2']){const {state,read}=await fixture();state.current.phase='PREPARED';state.current.paymentIds=[];state.mode='REVOKED';if(kind==='V2'){delete state.current.permit;state.current.allocation={authorizationId:'v2-original'};}const result=await read();assert.equal(result.recovery,undefined);assert.equal(state.calls.length,1);assert.equal(state.calls[0][0],kind==='V1'?'V1':'V2_DRAFT');if(kind==='V1')assert.deepEqual(JSON.parse(JSON.stringify(state.calls[0])),['V1',false,'v1-original']);}
});
