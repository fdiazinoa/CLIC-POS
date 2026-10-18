import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,Script} from 'node:vm';
import ts from 'typescript';
import {observeFiscalWorkflowCapability,hasFiscalWorkflowCapability,clearFiscalWorkflowCapability,subscribeFiscalWorkflowCapability,fiscalWorkflowCapabilityRevision} from '../services/fiscal/FiscalWorkflowV2Capability';
import {createFiscalFormatPreparation} from '../services/fiscal/FiscalFormatPreparation';
const base='https://erp.invalid/api/sync';
const headers={'X-Tenant-Id':'tenant','X-Terminal-Id':'terminal','X-Device-Id':'device','X-Sync-Token':'synthetic'};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('capability scoped subscription deduplicates refresh, notifies binding/clear/expiry and unsubscribes',()=>{
 clearFiscalWorkflowCapability();let events=0;const unsubscribe=subscribeFiscalWorkflowCapability(()=>{events++;});
 const timeout=globalThis.setTimeout,clear=globalThis.clearTimeout;let expire=()=>{};
 try{
  globalThis.setTimeout=((callback:()=>void)=>{expire=callback;return {unref(){}};}) as any;globalThis.clearTimeout=(()=>{}) as any;
  observeFiscalWorkflowCapability(base,headers,null,1000);assert.equal(events,0);
  observeFiscalWorkflowCapability(base,headers,'2',1000);assert.equal(events,1);assert.equal(hasFiscalWorkflowCapability(base,headers,1001),true);
  const version=fiscalWorkflowCapabilityRevision();observeFiscalWorkflowCapability(base,headers,'2',2000);assert.equal(events,1);assert.equal(fiscalWorkflowCapabilityRevision(),version);
  const other={...headers,'X-Sync-Token':'rotated'};observeFiscalWorkflowCapability(base,other,'2',3000);assert.equal(events,2);assert.equal(hasFiscalWorkflowCapability(base,headers,3001),false);
  expire();assert.equal(events,3);assert.equal(hasFiscalWorkflowCapability(base,other,3001),false);
  observeFiscalWorkflowCapability(base,headers,'2',4000);clearFiscalWorkflowCapability();assert.equal(events,5);clearFiscalWorkflowCapability();assert.equal(events,5);
  unsubscribe();observeFiscalWorkflowCapability(base,headers,'2',5000);assert.equal(events,5);
 }finally{globalThis.setTimeout=timeout;globalThis.clearTimeout=clear;clearFiscalWorkflowCapability();unsubscribe();}
});
function effectFixture(){
 const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
 const start=source.indexOf('   useEffect(()=>{\n      let disposed=false;\n      setFormatRuntime(null);setFormatMasters({});setFormatSelection(null);setFormatPreparationError(null);setFormatPreparing(false);');
 const end=source.indexOf('   },[v3Operational,activeTerminalId,formatCapabilityRevision,formatPreparationRetry]);',start);
 assert.ok(start>0&&end>start);
 const jobs:ReturnType<typeof deferred<any>>[]=[];let calls=0;const state={runtime:null as any,masters:{} as any,error:null as any,preparing:false,selection:{} as any};
 const context=createContext({Error,Promise,JSON,v3Operational:{},activeTerminalId:'terminal',formatCapabilityRevision:1,formatPreparationRetry:0,
  fiscalWorkflowV2Client:{enabled:()=>true},formatPreparationRef:{current:createFiscalFormatPreparation<any>()},
  prepareFiscalFormatRuntime:()=>{calls++;const job=deferred<any>();jobs.push(job);return job.promise;},
  setFormatRuntime:(v:any)=>{state.runtime=v;},setFormatMasters:(v:any)=>{state.masters=v;},setFormatSelection:(v:any)=>{state.selection=v;},
  setFormatPreparationError:(v:any)=>{state.error=v;},setFormatPreparing:(v:any)=>{state.preparing=v;},
 });
 const callback=source.slice(start+'   useEffect('.length,end)+'   }';
 new Script(ts.transpileModule('globalThis.effect='+callback+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText).runInContext(context);
 return {context,state,jobs,calls:()=>calls,effect:()=>context.effect() as undefined|(()=>void)};
}
test('actual preparation effect discovers with absent local flag and late capability, StrictMode singleflight and no repeat loop',async()=>{
 const f=effectFixture();let enabled=false;f.context.fiscalWorkflowV2Client.enabled=()=>enabled;
 f.effect();await tick();assert.equal(f.calls(),0);enabled=true;
 const cleanup=f.effect();await tick();assert.equal(f.calls(),1);cleanup?.();const second=f.effect();await tick();assert.equal(f.calls(),1);
 const runtime={assertCurrent:async()=>{}};f.jobs[0].resolve(runtime);await tick();assert.equal(f.state.runtime,runtime);assert.equal(f.state.error,null);assert.equal(f.state.preparing,false);second?.();
});
for(const reason of ['ERP_FLAG_DISABLED','POS_FORMAT_GRANT_REQUIRED','POS_FORMAT_SCOPE_FORBIDDEN','POS_FORMAT_AUTHORITY_EXPIRED','HTTP404','HTTP500','network-offline','timeout','POS_FORMAT_MASTER_HASH_INVALID','POS_FORMAT_MASTER_PARTIAL','POS_FORMAT_ACK_REQUIRED'])test(`actual discovery ${reason} shows hold, zero ready runtime and explicit retry can succeed`,async()=>{
 const f=effectFixture();const cleanup=f.effect();await tick();f.jobs[0].reject(Error(reason));await tick();assert.equal(f.state.runtime,null);assert.equal(f.state.error,reason);assert.equal(f.state.preparing,false);assert.equal(f.calls(),1);await tick();assert.equal(f.calls(),1);
 cleanup?.();f.context.formatPreparationRetry++;const retryCleanup=f.effect();await tick();assert.equal(f.calls(),2);const runtime={assertCurrent:async()=>{}};f.jobs[1].resolve(runtime);await tick();assert.equal(f.state.runtime,runtime);assert.equal(f.state.error,null);retryCleanup?.();
});
test('binding switch/unmount/authority loss cannot publish a stale runtime or selection',async()=>{
 const f=effectFixture();const cleanup=f.effect();await tick();cleanup?.();f.context.activeTerminalId='other';f.context.formatCapabilityRevision++;
 const current=f.effect();await tick();assert.equal(f.calls(),2);const stale={assertCurrent:async()=>{}};f.jobs[0].resolve(stale);await tick();assert.equal(f.state.runtime,null);
 const live={assertCurrent:async()=>{}};f.jobs[1].resolve(live);await tick();assert.equal(f.state.runtime,live);current?.();
 f.context.formatCapabilityRevision++;f.context.fiscalWorkflowV2Client.enabled=()=>false;f.effect();await tick();assert.equal(f.state.runtime,null);assert.equal(f.state.selection,null);assert.equal(f.calls(),2);
});
test('resolved discovery still requires current authority before publication',async()=>{
 const f=effectFixture();f.effect();await tick();f.jobs[0].resolve({assertCurrent:async()=>{throw Error('AUTHORITY_CHANGED');}});await tick();assert.equal(f.state.runtime,null);assert.equal(f.state.error,'AUTHORITY_CHANGED');
});
