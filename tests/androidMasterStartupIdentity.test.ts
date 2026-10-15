import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Execute the actual production startup callback with isolated bridge/catalog ports.
const source=readFileSync('App.tsx','utf8');
const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let callback:ts.ArrowFunction|undefined;
function visit(node:ts.Node){
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='ensureMasterServer'&&node.initializer&&ts.isArrowFunction(node.initializer))callback=node.initializer;
 ts.forEachChild(node,visit);
}
visit(ast);assert.ok(callback);
const javascript=ts.transpileModule(`const ensureMasterServer=${callback.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(terminal:any,master=true){
 const effects:{kind:string;value?:any}[]=[];
 const env={terminal,master,snapshot:async()=>{effects.push({kind:'catalog'});return {products:[]};}};
 const config={terminals:[],currencySymbol:'RD$'},users=[{id:'existing-user'}];
 const bridge={startMasterServer:async(value:any)=>{effects.push({kind:'start',value});return {running:true,port:3001};},stopMasterServer:async(value:any)=>{effects.push({kind:'stop',value});}};
 const bindings={window:{ClicPOSNativePrinter:bridge},getCurrentTerminal:()=>env.terminal,
  isNativeStandaloneTerminalRuntime:()=>env.master,buildPosMasterCatalogSnapshot:()=>env.snapshot(),db:{get:async()=>{effects.push({kind:'read'});return [];}},liveCatalogs:{},config,users,
  resolveSetupErpBaseUrl:()=> 'https://fixture.invalid',getStoredTerminalSetupMode:()=> 'SERVER_LOCAL',isErpManagedPosUserRuntime:()=>false,
  masterRestaurantRevisionRef:{current:3},masterOperationalSnapshotRef:{current:{rooms:[],tables:[],parkedTickets:[]}},masterRestaurantBootstrapRequestedRef:{current:false},
  console:{info:()=>{},error:(value:any)=>effects.push({kind:'error',value})}};
 const harness=new Function(...Object.keys(bindings),`let disposed=false,catalogPublishInFlight=false;${javascript};return {run:ensureMasterServer,setDisposed:value=>disposed=value,inFlight:()=>catalogPublishInFlight};`)(...Object.values(bindings));
 return {effects,env,config,users,...harness};
}
for(const terminal of [undefined,null,{}, {config:{isPrimaryNode:true}}])test(`native Master does not publish/read/stop before bound terminal identity: ${JSON.stringify(terminal)}`,async()=>{
 const f=fixture(terminal);await f.run(false);assert.deepEqual(f.effects,[]);assert.equal(f.inFlight(),false);
 // The existing effect can retry when the configured terminal becomes available.
 f.env.terminal={id:'bound-master',config:{erpTerminalId:'erp-master',erpBinding:{terminalId:'erp-master'}}};
 await f.run(false);assert.deepEqual(f.effects.map((e:any)=>e.kind),['catalog','start']);
 assert.equal(f.effects[1].value.config.runtimeTerminalId,'erp-master');assert.equal(f.effects[1].value.config.masterSetupContext.terminalId,'erp-master');
 assert.deepEqual(f.effects[1].value.users,f.users);assert.equal(f.inFlight(),false);
});
test('hydrated native Master without optional config keeps its bound ID and operational snapshot',async()=>{
 const f=fixture({id:'local-master'});await f.run(true);
 const payload=f.effects.find((e:any)=>e.kind==='start')!.value;
 assert.equal(payload.config.runtimeTerminalId,'local-master');assert.deepEqual(payload.rooms,[]);assert.deepEqual(payload.tables,[]);assert.deepEqual(payload.parkedTickets,[]);
 assert.equal(payload.restaurantRevision,3);
});
test('bound client/order-taker runtime still stops rather than publishes Master server',async()=>{
 const f=fixture({id:'bound-client'},false);await f.run();assert.deepEqual(f.effects,[{kind:'stop',value:{port:3001}}]);
});
test('disposed native startup before or during catalog hydration never publishes',async()=>{
 const first=fixture({id:'master'});first.setDisposed(true);await first.run();assert.deepEqual(first.effects,[]);
 const next=fixture({id:'master'});let release!:()=>void;let started!:()=>void;
 const waiting=new Promise<void>(resolve=>release=resolve),began=new Promise<void>(resolve=>started=resolve);
 next.env.snapshot=async()=>{started();await waiting;return {products:[]};};
 const pending=next.run();await began;next.setDisposed(true);release();await pending;
 assert.deepEqual(next.effects,[]);assert.equal(next.inFlight(),false);
});
