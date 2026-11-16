// Real React component lifecycle; acquire/native authority is modeled, not an Android/network test.
// CLIC_ROUTING_REACT_TEST_RUNTIME=/tmp/<matching-react-runtime> node tests/largeMasterSyncV3ConfigRetry.react.mjs
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const runtime=process.env.CLIC_ROUTING_REACT_TEST_RUNTIME;
if(!runtime)throw Error('Set CLIC_ROUTING_REACT_TEST_RUNTIME to an isolated matching React/test-renderer runtime');
const require=createRequire(`${runtime}/package.json`),React=require('react'),Renderer=require('react-test-renderer');
const {act}=React;
const original={window:globalThis.window,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
globalThis.window=new EventTarget();globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const env={React};globalThis.__v3ConfigRetry=env;
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const config=()=>({terminals:[{id:'local',config:{currentDeviceId:'device',erpTerminalId:'erp',erpBinding:{tenantId:'tenant',companyId:'company',storeId:'store'},inventoryScope:{defaultSalesWarehouseId:'W'},pricing:{defaultTariffId:'T',allowedTariffIds:['T']}}}],tariffs:[{id:'T',taxIncluded:false}],taxes:[],taxRate:0});
const cart=()=>[{id:'retained',cartId:'same-line',quantity:2,price:45,v3SaleAuthority:{syncId:'old-cart-generation',syncVersion:4,binding:'same-owner'}}];
const mocks={
 react:'module.exports=globalThis.__v3ConfigRetry.React;module.exports.default=module.exports;',
 './POSInterface':`const E=globalThis.__v3ConfigRetry,R=E.React;module.exports=function POS(props){const [retained]=R.useState({ticket:'same-ticket',reservation:'same-reservation',payment:'same-local-state'});R.useEffect(()=>{E.mounts++;return()=>E.unmounts++;},[]);E.child={props,retained};return R.createElement('section',{'data-pos':true});};`,
 '../services/sync/LargeMasterSyncV3OperationalSession':'exports.acquireLargeMasterSyncV3ConfigContext=(config)=>globalThis.__v3ConfigRetry.acquire(config);',
 '../services/sync/LargeMasterSyncV3CatalogUpdates':'exports.subscribeLargeMasterSyncV3CatalogUpdates=callback=>{globalThis.__v3ConfigRetry.catalogUpdated=callback;return()=>{globalThis.__v3ConfigRetry.catalogUpdated=undefined;};};',
 '../services/sync/LargeMasterSyncV3FinancialCommit':'exports.readV3CompletedReservation=()=>{throw Error("unused-financial-boundary")};',
 '../services/sync/LargeMasterSyncV3ReservationRecovery':'exports.restoreV3ReservationReference=exports.expireV3Reservation=()=>{throw Error("unused-financial-boundary")};',
 '../services/sync/LargeMasterSyncV3DirectTicketSource':'exports.claimV3DirectTicket=exports.readV3DirectWaitingTickets=exports.updateV3DirectTicket=()=>{throw Error("unused-financial-boundary")};',
};
const built=await build({entryPoints:['components/LargeMasterSyncV3OperationalPOS.tsx'],bundle:true,write:false,format:'cjs',platform:'node',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'config-retry-react-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));}}]});
const loaded={exports:{}};new Function('module','exports',built.outputFiles[0].text)(loaded,loaded.exports);const Component=loaded.exports.default;
const settle=()=>act(async()=>{for(let n=0;n<30;n++)await Promise.resolve();});
async function fixture({initialHold}={}){
 Object.assign(env,{child:undefined,mounts:0,unmounts:0,requests:[],outcomes:initialHold?[{acquire:initialHold.promise}]:[],validIdentity:true,projects:[],categoryReads:[]});
 let rendered=config();const lines=cart(),before=JSON.stringify(lines);let renderer;
 env.acquire=async input=>{
  const index=env.requests.length+1,outcome=env.outcomes.shift()||{};env.requests.push(input);
  if(outcome.acquire)await outcome.acquire;
  if(outcome.fail||!env.validIdentity)throw Error('SYNC_V3_BINDING_CHANGED');
  const source={categories:async()=>{env.categoryReads.push(index);if(outcome.categories)await outcome.categories;return [{key:`C${index}`,label:`category-${index}`,count:1}];},search:async()=>[],get:async()=>null,findBarcode:async()=>({item:{product:{id:`P${index}`,name:`product-${index}`,price:index}}})};
  return {assertCurrent:async()=>{if(!env.validIdentity)throw Error('SYNC_V3_BINDING_CHANGED');},projectConfig:async value=>{env.projects.push(index);return value;},catalog:async()=>source,withStocks:async rows=>rows,withStock:async row=>row,validate:async()=>{if(!env.validIdentity)throw Error('SYNC_V3_BINDING_CHANGED');}};
 };
 const props=()=>({config:rendered,activeTerminalId:'local',cart:lines,onOpenSettings(){},onUpdateCart(){throw Error('cart-mutation-forbidden');}});
 await act(async()=>{renderer=Renderer.create(React.createElement(Component,props()));});await settle();
 return {renderer,lines,before,props,update:async({newRef=false,name}={})=>{if(newRef)rendered={...rendered,...(name?{name}:{})};await act(async()=>renderer.update(React.createElement(Component,props())));await settle();},event:async()=>{await act(async()=>env.catalogUpdated());await settle();},text:()=>JSON.stringify(renderer.toJSON()),unchanged:retained=>{assert.equal(env.mounts,1);assert.equal(env.unmounts,0);assert.strictEqual(env.child.retained,retained);assert.strictEqual(env.child.props.cart,lines);assert.equal(JSON.stringify(lines),before);},close:async()=>{await act(async()=>renderer.unmount());}};
}
const results=[];
try{
 // New props before rejection: replacement succeeds; the retired catch cannot overwrite it.
 {const f=await fixture();try{
  const retained=env.child.retained,old=env.child.props.v3Operational,gate=defer();
  env.outcomes.push({acquire:gate.promise});await f.event();assert.equal(env.requests.length,2);
  await f.update({newRef:true});assert.equal(env.requests.length,3,'new pending config ref permits exactly one strict replacement');
  const current=env.child.props.v3Operational;await act(async()=>gate.reject(Error('late-retired-binding-failure')));await settle();
  assert.ok(!f.text().includes('late-retired-binding-failure'));assert.strictEqual(env.child.props.v3Operational,current);
  await assert.rejects(old.resolveCode('P'),/UI_CONTEXT_CHANGED/);
  await f.update();assert.equal(env.requests.length,3,'same config ref cannot retry');f.unchanged(retained);
  results.push('props-before-catch: replacement once, retired rejection ignored');
 }finally{await f.close();}}
 // New props after rejection: same scope may recover, while READY display changes do no work.
 {const f=await fixture();try{
  const retained=env.child.retained;env.outcomes.push({fail:true});await f.event();assert.ok(f.text().includes('SYNC_V3_BINDING_CHANGED'));
  const failedCount=env.requests.length;await f.update();assert.equal(env.requests.length,failedCount);
  await f.update({newRef:true});assert.equal(env.requests.length,failedCount+1);assert.ok(!f.text().includes('SYNC_V3_BINDING_CHANGED'));
  const current=env.child.props.v3Operational,reads=env.requests.length;
  await f.update({newRef:true,name:'presentation-only'});assert.equal(env.requests.length,reads,'READY same-scope presentation change does not acquire');
  assert.strictEqual(env.child.props.v3Operational,current,'READY boundary was not retired by an effect cleanup');
  let match;await act(async()=>{match=await current.resolveCode('P');});assert.equal(match.product.id,`P${reads}`);f.unchanged(retained);
  results.push('props-after-catch: recovers; READY display update keeps boundary and zero reads');
 }finally{await f.close();}}
 // A pending categories completion cannot publish its old session after the newer props attempt.
 {const f=await fixture();try{
  const retained=env.child.retained,gate=defer();env.outcomes.push({categories:gate.promise});await f.event();
  assert.equal(env.requests.length,2);await f.update({newRef:true});assert.equal(env.requests.length,3);
  const current=env.child.props.v3Operational;assert.equal(current.categories[0].key,'C3');
  await act(async()=>gate.resolve());await settle();assert.strictEqual(env.child.props.v3Operational,current);assert.equal(current.categories[0].key,'C3');f.unchanged(retained);
  results.push('pending stale success cannot replace newer session/categories');
 }finally{await f.close();}}
 // Actual identity remains invalid: new refs may try once but cannot bypass strict acquisition.
 {const f=await fixture();try{
  const retained=env.child.retained,old=env.child.props.v3Operational;env.validIdentity=false;await f.event();
  assert.ok(f.text().includes('SYNC_V3_BINDING_CHANGED'));let count=env.requests.length;
  await f.update({newRef:true});assert.equal(env.requests.length,count+1);assert.ok(f.text().includes('SYNC_V3_BINDING_CHANGED'));
  count=env.requests.length;await f.update();await settle();assert.equal(env.requests.length,count,'invalid identity must not create an effect retry loop');
  await assert.rejects(env.child.props.v3Operational.validate(f.lines),/UI_CONTEXT_CHANGED/);await assert.rejects(old.resolveCode('P'),/UI_CONTEXT_CHANGED/);f.unchanged(retained);
  results.push('invalid identity remains blocked; same props do not loop');
 }finally{await f.close();}}
 // Initial acquisition has no mounted child yet; a deferred replacement must still make progress.
 {const gate=defer(),f=await fixture({initialHold:gate});try{
  assert.equal(env.mounts,0);await f.update({newRef:true});assert.equal(env.requests.length,2);assert.equal(env.mounts,1);
  await act(async()=>gate.resolve());await settle();assert.equal(env.mounts,1);assert.equal(env.unmounts,0);assert.equal(env.projects.filter(n=>n===1).length,0,'retired initial read must not project');
  let match;await act(async()=>{match=await env.child.props.v3Operational.resolveCode('P');});assert.equal(match.product.id,'P2');assert.equal(JSON.stringify(f.lines),f.before);
  results.push('initial pending replacement publishes once and drops stale acquire completion');
 }finally{await f.close();}}
 console.log(JSON.stringify({result:'PASS',cases:results,limits:'Actual React component, effects and context checks; acquire/native identity boundary modeled. No financial/native Android/network proof.'}));
}finally{globalThis.window=original.window;globalThis.IS_REACT_ACT_ENVIRONMENT=original.act;delete globalThis.__v3ConfigRetry;}
