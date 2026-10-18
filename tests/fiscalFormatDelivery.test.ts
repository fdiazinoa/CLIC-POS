import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,Script} from 'node:vm';
import ts from 'typescript';
import {observeFiscalWorkflowCapability,hasFiscalWorkflowCapability,clearFiscalWorkflowCapability,subscribeFiscalWorkflowCapability,fiscalWorkflowCapabilityRevision} from '../services/fiscal/FiscalWorkflowV2Capability';
import {createFiscalFormatPreparation,fiscalFormatPreparationProblem} from '../services/fiscal/FiscalFormatPreparation';
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
 const context=createContext({Error,Promise,JSON,fiscalFormatPreparationProblem,v3Operational:{},activeTerminalId:'terminal',formatCapabilityRevision:1,formatPreparationRetry:0,
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
for(const reason of ['FISCAL_WORKFLOW_DISABLED','POS_FORMAT_DISABLED','ERP_FLAG_DISABLED','POS_FORMAT_GRANT_REQUIRED','POS_FORMAT_SCOPE_FORBIDDEN','POS_FORMAT_AUTHORITY_EXPIRED','HTTP404','HTTP500','network-offline','timeout','POS_FORMAT_MASTER_HASH_INVALID','POS_FORMAT_MASTER_PARTIAL','POS_FORMAT_ACK_REQUIRED'])test(`actual discovery ${reason} shows hold, zero ready runtime and explicit retry can succeed`,async()=>{
 const f=effectFixture();const cleanup=f.effect();await tick();f.jobs[0].reject(Error(reason));await tick();assert.equal(f.state.runtime,null);assert.deepEqual(f.state.error,fiscalFormatPreparationProblem(Error(reason)));assert.equal(f.state.preparing,false);assert.equal(f.calls(),1);await tick();assert.equal(f.calls(),1);
 cleanup?.();f.context.formatPreparationRetry++;const retryCleanup=f.effect();await tick();assert.equal(f.calls(),2);const runtime={assertCurrent:async()=>{}};f.jobs[1].resolve(runtime);await tick();assert.equal(f.state.runtime,runtime);assert.equal(f.state.error,null);retryCleanup?.();
});
test('binding switch/unmount/authority loss cannot publish a stale runtime or selection',async()=>{
 const f=effectFixture();const cleanup=f.effect();await tick();cleanup?.();f.context.activeTerminalId='other';f.context.formatCapabilityRevision++;
 const current=f.effect();await tick();assert.equal(f.calls(),2);const stale={assertCurrent:async()=>{}};f.jobs[0].resolve(stale);await tick();assert.equal(f.state.runtime,null);
 const live={assertCurrent:async()=>{}};f.jobs[1].resolve(live);await tick();assert.equal(f.state.runtime,live);current?.();
 f.context.formatCapabilityRevision++;f.context.fiscalWorkflowV2Client.enabled=()=>false;f.effect();await tick();assert.equal(f.state.runtime,null);assert.equal(f.state.selection,null);assert.equal(f.calls(),2);
});
test('resolved discovery still requires current authority before publication',async()=>{
 const f=effectFixture();f.effect();await tick();f.jobs[0].resolve({assertCurrent:async()=>{throw Error('AUTHORITY_CHANGED');}});await tick();assert.equal(f.state.runtime,null);assert.deepEqual(f.state.error,fiscalFormatPreparationProblem(Error('AUTHORITY_CHANGED')));
});
test('preparation reasons explain ERP enablement, session, network and incomplete data without exposing raw errors',()=>{
 for(const [reason,expected]of [
  ['POS_FORMAT_GRANT_REQUIRED',/habilitación en el ERP para esta caja/],['POS_FORMAT_SCOPE_FORBIDDEN',/habilitación en el ERP para esta caja/],['POS_FORMAT_CAPABILITY_REQUIRED',/habilitación en el ERP para esta caja/],
  ['FISCAL_WORKFLOW_DISABLED',/servicio de presentaciones no está disponible en el ERP configurado/],['POS_FORMAT_DISABLED',/deshabilitadas para esta empresa/],['ERP_FLAG_DISABLED',/deshabilitadas para esta empresa/],['POS_FORMAT_AUTHORITY_EXPIRED',/Valida la sesión/],['FISCAL_TERMINAL_AUTH_REQUIRED',/Valida la sesión/],
  ['network-offline',/Revisa la conexión/],['timeout',/Revisa la conexión/],['Failed to fetch',/Revisa la conexión/],['HTTP500',/Revisa la conexión/],
  ['POS_FORMAT_MASTER_HASH_INVALID',/incompletos o no se pudieron verificar/],['POS_FORMAT_MASTER_PARTIAL',/incompletos o no se pudieron verificar/],['POS_FORMAT_ACK_REQUIRED',/incompletos o no se pudieron verificar/],['POS_FORMAT_INVENTORY_AUTHORITY_UNPROVEN',/incompletos o no se pudieron verificar/],
 ] as const){const result=fiscalFormatPreparationProblem(Error(reason));assert.match(result.message,expected);assert.ok(!result.message.includes(reason));if(/^[A-Z][A-Z0-9_]{2,95}$/.test(reason))assert.equal(result.code,reason);}
 assert.equal(fiscalFormatPreparationProblem(Error('secret-token=value')).code,'FORMAT_PREPARATION_UNAVAILABLE');
});
test('actual banner renders useful guidance with raw diagnostic code confined to expandable details',()=>{
 const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('POSInterface.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression:ts.Expression|undefined;
 const visit=(node:ts.Node)=>{if(ts.isJsxExpression(node)&&node.expression&&node.getText(ast).startsWith('{formatPreparationError &&'))expression=node.expression;ts.forEachChild(node,visit);};visit(ast);assert.ok(expression);
 const context=createContext({React:{createElement:(tag:string,props:any,...children:any[])=>({tag,props,children})},formatPreparationError:fiscalFormatPreparationProblem(Error('POS_FORMAT_GRANT_REQUIRED')),formatPreparing:false,v3Operational:{},fiscalWorkflowV2Client:{enabled:()=>true},setFormatPreparationRetry:()=>{}});
 new Script(ts.transpileModule('globalThis.banner='+expression!.getText(ast)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText).runInContext(context);
 const tree=context.banner;assert.equal(tree.props.role,'alert');
 const detail=tree.children.find((node:any)=>node?.tag==='details');assert.ok(JSON.stringify(detail).includes('POS_FORMAT_GRANT_REQUIRED'));
 const visible=JSON.stringify(tree.children.filter((node:any)=>node?.tag!=='details'));assert.match(visible,/habilitación en el ERP para esta caja/);assert.ok(!visible.includes('POS_FORMAT_GRANT_REQUIRED'));assert.match(visible,/Reintentar presentaciones/);
});
