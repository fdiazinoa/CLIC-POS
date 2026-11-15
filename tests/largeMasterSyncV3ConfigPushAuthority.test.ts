import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {nativeFixture,id} from './articleFormatsNativeFixture';
import {getInitialConfig} from '../constants';
const ROOT=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
// Real session/coordinator/guards + native SQLite adapter. Only platform/transport boundaries are simulated.
// Candidate returns the already durable fixture runtime: this file does not prove Android/network delivery.
async function nativeSessionFixture() {
  const f = await nativeFixture();
  const config = f.documents('config')[0];
  config.terminals[0].config.pricing = { defaultTariffId: id(6), allowedTariffIds: [id(6)],
    tariffs: [{ id: id(6), strategy: 'BASE', scope: 'ALL', items: [] }] };
  await f.adapter.saveCollection('config', config);
  f.db.prepare("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES(?,32,3,2,'ACTIVE','{}','fixture','fixture')").run(id(60));
  let opens = 0;
  const env: any = { adapter: f.adapter, config, identity: { tenantId: id(1), terminalId: id(4), deviceId: id(50), erpSyncBaseUrl: 'https://erp.invalid', syncToken: 'synthetic' },
    proof: { tenantId: id(1), terminalId: id(4), deviceId: id(50), companyId: id(2) }, guard: 'synthetic-guard', origin: 'https://erp.invalid', downloads: 0 };
  Object.assign(f.adapter, { connect: async () => { opens++; await env.onConnect?.(); } });
  (globalThis as any).__configContext = env;
  const result = await build({ absWorkingDir:ROOT,entryPoints: [ROOT+'/services/sync/LargeMasterSyncV3OperationalSession.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', define: { 'import.meta.env': '{}' }, plugins: [{ name: 'native-local-context', setup(b) {

    b.onResolve({ filter: /^(\.\.\/db|\.\.\/\.\.\/utils\/db|\.\/OfflineV3OperationalIdentity|\.\/LargeMasterSyncV3(?:Platform|Authority|Candidate|BoundTransport|DownloadOrigin))$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: `const E=globalThis.__configContext;` + (path === '../db' ? 'exports.dbAdapter=E.adapter;' : path === '../../utils/db' ? 'exports.db={get:()=>E.adapter.getCollection("config")};' : path.endsWith('Platform') ? 'exports.assertLargeMasterSyncV3NativeAndroid=()=>{};' : path.endsWith('Authority') ? 'exports.LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED=true;' : path.endsWith('Candidate') ? 'const download=()=>{E.downloads++;if(E.ready)return Promise.resolve(E.ready);throw Error("network-forbidden")};exports.prepareLargeMasterSyncV3Candidate=exports.prepareLargeMasterSyncV3CatalogOnly=exports.prepareLargeMasterSyncV3UnusedBaseline=download;exports.isLargeMasterSyncV3Stale=async()=>false;' : path.endsWith('BoundTransport') ? 'exports.readLargeMasterSyncV3BoundIdentity=()=>{if(E.offline)throw Error("token-unavailable");const c=JSON.parse(localStorage.getItem("clic_terminal_credentials_v1"));return {...E.identity,tenantId:c.erpTenantId,terminalId:c.erpTerminalId,deviceId:c.deviceId,syncToken:c.syncToken};};exports.validatedLargeMasterSyncV3ErpSyncBase=x=>x;' : path.endsWith('DownloadOrigin') ? 'exports.largeMasterSyncV3DownloadOrigin=()=>E.origin;' : path.endsWith('OfflineV3OperationalIdentity') ? 'exports.readOfflineV3OperationalAuthority=async()=>{if(!E.offlineAuthority)throw Error("no-offline-authority");return E.offlineAuthority;};' : 'throw Error("Unexpected native boundary");') }));
  } }] });
  const loaded = { exports: {} as any }; new Function('module', 'exports', result.outputFiles[0].text)(loaded, loaded.exports);
  return { ...f, env, module: loaded.exports, opens: () => opens, close: () => { f.db.close(); delete (globalThis as any).__configContext; } };
}


const fiscalDomain={documents:{document_series:[{id:id(80),name:'Synthetic Ticket',document_type:'TICKET',prefix:'QA',next_number:1}],fiscal_ranges:[],fiscal_allocations:[]},fiscal:{mode:'LEGACY_B',enabled:true}};
const domains={catalog:{users:[],roles:[]},fiscal:fiscalDomain};
const originals={localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,window:globalThis.window,CustomEvent:globalThis.CustomEvent,fetch:globalThis.fetch};
function financialState(f:any){const state=f.state();delete state.documents;return {...state,documents:Object.fromEntries(['transactions','inventoryLedger','cashMovements','zReports','wallet_transactions','loyalty_events','internalSequences','globalSequenceCounter'].map(name=>[name,f.documents(name)])),inventoryBalances:f.db.prepare('SELECT * FROM master_v3_inventory_balances ORDER BY item_id,warehouse_id').all()};}

async function fixture(){
 const f=await nativeSessionFixture();
 const config=getInitialConfig('Supermercado' as any) as any;
 const native=f.documents('config')[0];config.id='current';config.terminals=[{...config.terminals[0],id:id(4),config:{...config.terminals[0].config,...native.terminals[0].config,fiscal:{mode:'NONE',enabled:false,providerId:'NONE',fiscalRanges:[],fiscalAllocations:[]}}}];
 await f.adapter.saveCollection('config',config);f.env.config=config;
 const credentials={erpTenantId:id(1),tenantId:id(1),companyId:id(2),storeId:id(3),erpTerminalId:id(4),terminalId:id(4),deviceId:id(50),syncToken:'synthetic-token',deviceToken:'synthetic-device-token',authStatus:'AUTHORIZED'};
 const profile={contractedProduct:'POS_ERP',posRuntime:'MASTER',cloudChannel:'ERP_ACTIVE',dataMaster:'ERP',cloudSyncEnabled:true,customerErpAccess:true,erpUiEnabled:true,erpBaseUrl:'https://erp.invalid',erpTenantId:id(1),erpTerminalId:id(4),contractSource:'ERP_REGISTER'};
 const values=new Map<string,string>(Object.entries({clic_terminal_credentials_v1:JSON.stringify(credentials),clic_sync_profile:JSON.stringify(profile),CLIC_POS_DEVICE_ID:id(50),active_terminal_id:id(4),clic_erp_sync_local_terminal_id:id(4),clic_erp_sync_terminal_id:id(4),clic_erp_sync_tenant_id:id(1),clic_erp_sync_company_id:id(2),clic_erp_sync_store_id:id(3),CLIC_ERP_BASE_URL:'https://erp.invalid'}));
 let storageWrites=0;const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:any)=>{storageWrites++;values.set(k,String(v));},removeItem:(k:string)=>{storageWrites++;values.delete(k);}};
 const env:any={db:{get:(n:string)=>f.adapter.getCollection(n),save:(n:string,v:any)=>f.adapter.saveCollection(n,v)},adapter:f.adapter,module:f.module};
 Object.assign(globalThis,{__configPushAuthority:env,localStorage:storage,sessionStorage:storage,window:{localStorage:storage,setTimeout,clearTimeout,dispatchEvent:()=>true},CustomEvent:class{constructor(public type:string){}}});
 const old=await f.module.getLargeMasterSyncV3OperationalSession();f.env.ready=old.ready;
 const mockSession=`export const getLargeMasterSyncV3OperationalSession=globalThis.__configPushAuthority.module.getLargeMasterSyncV3OperationalSession;export const acquireLargeMasterSyncV3ConfigContext=globalThis.__configPushAuthority.module.acquireLargeMasterSyncV3ConfigContext;`;
 const mocks:Record<string,string>={
 './db':'export const db=globalThis.__configPushAuthority.db;', '../../utils/db':'export const db=globalThis.__configPushAuthority.db;',
 '../services/db':'export const dbAdapter=globalThis.__configPushAuthority.adapter;', '../db':'export const dbAdapter=globalThis.__configPushAuthority.adapter;',
 './LargeMasterSyncV3OperationalSession':mockSession,'../services/sync/LargeMasterSyncV3OperationalSession':mockSession,
 '../services/sync/SyncManager':'export const syncManager={};',
 '../services/sync/ProductImageCacheService':'export const productImageCacheService={normalizeIncomingProducts:async x=>x};',
 '../services/sync/MasterNumberRangeService':'export const persistMasterNumberRangesFromSnapshot=async()=>{throw Error("unexpected-range-write")};',
 '../services/sync/SyncMetrics':'export const syncMetrics=new Proxy({}, {get:()=>()=>{}});',
 '../services/sync/AuthenticatedActivityTracker':'export const authenticatedActivityTracker={record:()=>{}};',
 '../services/sync/SyncErrorDiagnostic':'export const setCatalogDiagnosticStatus=()=>{};export const setSalesPushDiagnosticStatus=()=>{};export const setSyncAuthDiagnosticStatus=()=>{};export const setTerminalBindingDiagnosticStatus=()=>{};',
 '../services/sync/deviceToken':'export const getSyncDeviceToken=()=>JSON.parse(localStorage.getItem("clic_terminal_credentials_v1")).deviceToken;export const persistSyncDeviceToken=()=>{throw Error("credential-migration-forbidden")};',
 '../services/sync/TerminalCredentialStore':'export const readTerminalCredentialsSync=()=>JSON.parse(localStorage.getItem("clic_terminal_credentials_v1"));export const buildTerminalSyncAuthHeaders=()=>({"X-Sync-Token":readTerminalCredentialsSync().syncToken});export const clearStoredSyncToken=()=>{throw Error("credential-migration-forbidden")};export const awaitTerminalCredentialWrites=async()=>{};export const saveTerminalCredentialsSync=()=>{throw Error("credential-migration-forbidden")};',
 '../services/sync/SyncProfile':`import {resolveSyncTarget} from ${JSON.stringify(ROOT+'/services/sync/SyncProfile.ts')};export const syncPolicy={resolve:()=>resolveSyncTarget(JSON.parse(localStorage.getItem('clic_sync_profile')))};export const loadSyncProfile=()=>{throw Error('profile-migration-forbidden')};export const restoreClientMasterUrl=()=>null;export const updateClientMasterUrl=()=>{throw Error('profile-migration-forbidden')};`,
 };
 const built=await build({stdin:{contents:`export {captureLargeMasterSyncV3ConfigRefreshAuthority} from './services/sync/LargeMasterSyncV3ConfigRefreshAuthority';export {persistLargeMasterSyncV3ConfigPushCatalog} from './services/sync/LargeMasterSyncV3ConfigPush';export {buildConfigPushV2DomainWrites,diagnosticAtomicApply,triggerErpSyncOutbox,getConfigPushV2Diagnostics} from './utils/erpSyncLifecycle';`,resolveDir:ROOT,loader:'ts'},absWorkingDir:ROOT,bundle:true,write:false,format:'cjs',platform:'node',define:{'import.meta.env':JSON.stringify({VITE_LARGE_MASTER_SYNC_V3_CANDIDATE:'true',VITE_LARGE_MASTER_SYNC_V3_BASE_URL:'https://erp.invalid'})},plugins:[{name:'actual-config-authority-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:a.namespace==='fixture'&&a.path.startsWith(ROOT+'/')?{path:a.path,namespace:'file'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));b.onLoad({filter:/erpSyncLifecycle\.ts$/},a=>({contents:readFileSync(a.path,'utf8')+'\nexport {applyConfigPushV2DomainsAtomically as diagnosticAtomicApply};',loader:'ts'}));}}]});
 const loaded={exports:{} as any};new Function('module','exports',built.outputFiles[0].text)(loaded,loaded.exports);
 const api=loaded.exports;
 const before=financialState(f);
 const capture=()=>api.captureLargeMasterSyncV3ConfigRefreshAuthority(f.documents('config')[0]);
 const commit=(authority:any)=>api.diagnosticAtomicApply(['catalog','fiscal'],domains,()=>{},authority);
 const patchCredentials=(patch:any)=>values.set('clic_terminal_credentials_v1',JSON.stringify({...JSON.parse(values.get('clic_terminal_credentials_v1')!),...patch}));
 return {...f,api,old,values,storageWrites:()=>storageWrites,capture,commit,patchCredentials,
  assertFinancial:()=>assert.deepEqual(financialState(f),before),
  close:()=>{f.close();delete(globalThis as any).__configPushAuthority;Object.assign(globalThis,originals);}};
}

test('real fiscal builder and native atomic commit renew actual session before refresh/projection; old context remains invalid',async()=>{
 const f=await fixture();try{
  const authority=f.capture();assert.equal(f.storageWrites(),0,'factory canonical reads must not migrate storage');
  const writes=await f.api.buildConfigPushV2DomainWrites('fiscal',fiscalDomain);assert(writes.some((w:any)=>w.collection==='config'));
  await f.commit(authority);await assert.rejects(f.old.assertCurrent(),/BINDING_CHANGED/);
  await f.api.persistLargeMasterSyncV3ConfigPushCatalog(()=>{},authority);
  await (await f.module.getLargeMasterSyncV3OperationalSession()).assertCurrent();
  await assert.rejects(f.old.assertCurrent(),/BINDING_CHANGED/);
  assert.equal(f.env.downloads,1,'external Candidate boundary returns existing durable ready, not a network transfer');f.assertFinancial();
 }finally{f.close();}
});

for(const problem of ['tenant','company','store','device','terminal','token','origin','missing-terminal','ambiguous-terminal','missing-credentials','invalid-profile','migration-required','mirror','revoked'] as const)test(`authority rejects ${problem} without credential/profile migration`,async()=>{
 const f=await fixture();try{
  const authority=f.capture();await f.commit(authority);
  const config=f.documents('config')[0];
  if(['tenant','company','store'].includes(problem))config.terminals[0].config.erpBinding[problem+'Id']=id(999);
  if(problem==='device')config.terminals[0].config.currentDeviceId=id(999);
  if(problem==='terminal')config.terminals[0].config.erpTerminalId=id(999);
  if(problem==='missing-terminal')config.terminals=[];
  if(problem==='ambiguous-terminal')config.terminals.push(structuredClone(config.terminals[0]));
  await f.adapter.saveCollection('config',config);
  if(problem==='token')f.patchCredentials({syncToken:'different-synthetic-token'});
  if(problem==='origin'){const profile=JSON.parse(f.values.get('clic_sync_profile')!);profile.erpBaseUrl='https://other.invalid';f.values.set('clic_sync_profile',JSON.stringify(profile));}
  if(problem==='missing-credentials')f.values.delete('clic_terminal_credentials_v1');
  if(problem==='invalid-profile')f.values.set('clic_sync_profile','{}');
  if(problem==='migration-required')f.patchCredentials({identityMigrationRequired:true});
  if(problem==='mirror')f.values.set('clic_erp_sync_store_id',id(999));
  if(problem==='revoked')f.patchCredentials({authStatus:'REVOKED'});
  const writesBeforeFailure=f.storageWrites();
  await assert.rejects(f.api.persistLargeMasterSyncV3ConfigPushCatalog(()=>{},authority),/BINDING_CHANGED|AUTHORITY_CHANGED/);
  assert.equal(f.env.downloads,0);assert.equal(f.storageWrites(),writesBeforeFailure,'failed authority check must not migrate storage');f.assertFinancial();
 }finally{f.close();}
});

for(const problem of ['store','token','origin','owner','runtime','inventory'] as const)test(`actual acquire/owner guards reject ${problem} drift during native acquisition`,async()=>{
 const f=await fixture();try{
  const authority=f.capture();await f.commit(authority);let connects=0;
  f.env.onConnect=async()=>{if(++connects!==2)return;
   if(problem==='store'){const config=f.documents('config')[0];config.terminals[0].config.erpBinding.storeId=id(999);await f.adapter.saveCollection('config',config);}
   if(problem==='token')f.patchCredentials({syncToken:'different-synthetic-token'});
   if(problem==='origin')f.env.origin='https://other.invalid';
   if(problem==='owner')f.db.prepare("UPDATE master_v3_operational_owner SET binding='foreign'").run();
   if(problem==='runtime')f.db.prepare('UPDATE master_v3_state SET active_version=33').run();
   if(problem==='inventory')f.db.prepare("UPDATE master_v3_inventory_state SET cursor='foreign'").run();
  };
  await assert.rejects(f.api.persistLargeMasterSyncV3ConfigPushCatalog(()=>{},authority));assert.equal(f.env.downloads,0);f.assertFinancial();
 }finally{f.close();}
});

for(const phase of ['domain','projection'] as const)test(`${phase} native CAS preserves a concurrent store change instead of overwriting it`,async()=>{
 const f=await fixture();try{
  const authority=f.capture();
  const writeConcurrent=async()=>{const config=f.documents('config')[0];config.terminals[0].config.erpBinding.storeId=id(999);await f.adapter.saveCollection('config',config);};
  if(phase==='domain'){
   const original=f.adapter.saveDocumentsAtomically.bind(f.adapter);let called=false;
   f.adapter.saveDocumentsAtomically=async(...args:any[])=>{if(!called){called=true;await writeConcurrent();}return (original as any)(...args);};
   await assert.rejects(f.commit(authority),/BINDING_CHANGED|AUTHORITY_CHANGED/);
   assert.equal(f.documents('documentSeries').length,0,'atomic domain writes rolled back');assert.equal(f.env.downloads,0);
  }else{
   await f.commit(authority);const original=f.adapter.compareAndSwapV3SetupConfig.bind(f.adapter);
   f.adapter.compareAndSwapV3SetupConfig=async(...args:any[])=>{await writeConcurrent();return (original as any)(...args);};
   await assert.rejects(f.api.persistLargeMasterSyncV3ConfigPushCatalog(()=>{},authority),/BINDING_CHANGED|AUTHORITY_CHANGED/);
  }
  assert.equal(f.documents('config')[0].terminals[0].config.erpBinding.storeId,id(999));f.assertFinancial();
 }finally{f.close();}
});

test('domain authority guard runs after native BEGIN and rejects changed credential before writes',async()=>{
 const f=await fixture();try{
  const authority=f.capture();const configBefore=f.documents('config')[0];
  const bridge=(f.adapter as any).db;const execute=bridge.execute.bind(bridge);let entered=false;
  bridge.execute=async(sql:string,...args:any[])=>{const result=await execute(sql,...args);if(/^BEGIN/i.test(sql.trim())){entered=true;f.patchCredentials({syncToken:'changed-inside-begin'});}return result;};
  await assert.rejects(f.commit(authority),/AUTHORITY_CHANGED/);
  assert.equal(entered,true);assert.deepEqual(f.documents('config')[0],configBefore);assert.deepEqual(f.documents('documentSeries'),[]);assert.equal(f.env.downloads,0);f.assertFinancial();
 }finally{f.close();}
});

test('full real lifecycle captures authority before fiscal commit and only ACKs after actual projection',async()=>{
 const f=await fixture();try{
  const versions={catalog:1,fiscal:1};const event={id:id(90),event_type:'CONFIG_PUSH_V2',status:'PROCESSING',payload:{contract_version:2,snapshot_id:id(91),version_hash:'synthetic-version',versions,scopes:['catalog','fiscal'],terminal_id:id(4),tenant_id:id(1)}};
  const acks:any[]=[];let projectionCommitted=false;const cas=f.adapter.compareAndSwapV3SetupConfig.bind(f.adapter);
  f.adapter.compareAndSwapV3SetupConfig=async(...args:any[])=>{await (cas as any)(...args);projectionCommitted=true;};
  globalThis.fetch=(async(input:any,init:any)=>{
   const url=String(input);
   if(url.includes('/outbox/pull'))return Response.json({status:'success',events:[event],count:1});
   if(url.includes('/config-snapshots/'))return Response.json({status:'success',snapshot_id:id(91),version_hash:'synthetic-version',tenant_id:id(1),terminal_id:id(4),versions,scopes:['catalog','fiscal'],domains});
   if(url.includes('/outbox/ack')){assert.equal(projectionCommitted,true,'ACK waits for actual native projection CAS');acks.push(JSON.parse(init.body));await (await f.module.getLargeMasterSyncV3OperationalSession()).assertCurrent();return Response.json({status:'success'});}
   throw Error('unexpected-route');
  }) as any;
  const result=await f.api.triggerErpSyncOutbox('manual_sync');assert.equal(result.applied,1);assert.equal(result.failed,0);
  assert.equal(acks.length,1);assert.equal(acks[0].status,'APPLIED');assert.equal(f.api.getConfigPushV2Diagnostics().versionHash,'synthetic-version');
  await assert.rejects(f.old.assertCurrent(),/BINDING_CHANGED/);assert.equal(f.env.downloads,1);f.assertFinancial();
 }finally{f.close();}
});

for(const problem of ['missing-store','missing-device-mirror','invalid-credentials-json','invalid-profile-json','foreign-profile-terminal','local-target','migration-required','ambiguous-config'] as const)test(`actual pure factory fails closed on ${problem} without storage writes`,async()=>{
 const f=await fixture();try{
  const config=f.documents('config')[0];
  if(problem==='missing-store')f.patchCredentials({storeId:null});
  if(problem==='missing-device-mirror')f.values.delete('CLIC_POS_DEVICE_ID');
  if(problem==='invalid-credentials-json')f.values.set('clic_terminal_credentials_v1','{');
  if(problem==='invalid-profile-json')f.values.set('clic_sync_profile','{');
  if(problem==='foreign-profile-terminal'){const p=JSON.parse(f.values.get('clic_sync_profile')!);p.erpTerminalId=id(999);f.values.set('clic_sync_profile',JSON.stringify(p));}
  if(problem==='local-target'){const p=JSON.parse(f.values.get('clic_sync_profile')!);p.posRuntime='SLAVE';p.masterUrl='http://192.0.2.1:3001';p.masterTerminalId=id(999);f.values.set('clic_sync_profile',JSON.stringify(p));}
  if(problem==='migration-required')f.patchCredentials({identityMigrationRequired:true});
  if(problem==='ambiguous-config')config.terminals.push(structuredClone(config.terminals[0]));
  assert.throws(()=>f.api.captureLargeMasterSyncV3ConfigRefreshAuthority(config),/AUTHORITY_CHANGED/);
  assert.equal(f.storageWrites(),0,'pure factory must not repair/migrate malformed canonical state');assert.equal(f.env.downloads,0);f.assertFinancial();
 }finally{f.close();}
});

test('authority domain commit rejects adapters without the native precondition contract',async()=>{
 const f=await fixture();try{
  const authority=f.capture();const before=f.documents('config')[0];
  Object.defineProperty(f.adapter,'supportsV3ConfigPushAuthority',{value:false});
  await assert.rejects(f.commit(authority),/SYNC_V3_NATIVE_STORE_UNAVAILABLE/);
  assert.deepEqual(f.documents('config')[0],before);assert.deepEqual(f.documents('documentSeries'),[]);assert.equal(f.env.downloads,0);f.assertFinancial();
 }finally{f.close();}
});

test('native atomic authority rejects a thenable identity guard inside BEGIN and rolls back',async()=>{
 const f=await fixture();try{
  const before=f.documents('config')[0];const next={...before,diagnosticMarker:'must-not-commit'};
  await assert.rejects(f.adapter.saveDocumentsAtomically([{collectionName:'config',document:next}],false,['config'],
   {expectedConfig:before,assertIdentity:(()=>Promise.resolve()) as any}),/SYNC_V3_ASYNC_IDENTITY_GUARD_FORBIDDEN/);
  assert.deepEqual(f.documents('config')[0],before);assert.equal(f.db.inTransaction,false);f.assertFinancial();
 }finally{f.close();}
});

test('native atomic authority freezes expectedConfig before it waits for the shared writer lane',async()=>{
 const f=await fixture();let release!:()=>void;try{
  let entered!:()=>void;const held=new Promise<void>(resolve=>{entered=resolve;});const hold=new Promise<void>(resolve=>{release=resolve;});
  const writer=(f.adapter as any).withWriteLock(async()=>{entered();await hold;});await held;
  const expected=f.documents('config')[0];const next={...structuredClone(expected),diagnosticMarker:'queued-commit'};
  const pending=f.adapter.saveDocumentsAtomically([{collectionName:'config',document:next}],false,['config'],
   {expectedConfig:expected,assertIdentity:()=>{}});
  expected.terminals[0].config.erpBinding.storeId=id(999);
  release();await writer;await pending;
  const saved=f.documents('config')[0];assert.equal(saved.diagnosticMarker,'queued-commit');assert.equal(saved.terminals[0].config.erpBinding.storeId,id(3));f.assertFinancial();
 }finally{release?.();f.close();}
});
