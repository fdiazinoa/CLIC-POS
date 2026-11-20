import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { build } from 'esbuild';
import { getInitialConfig } from '../constants';
import { createV3ErpStockDisplay, v3ErpStockDisplayScope } from '../services/sync/LargeMasterSyncV3ErpStockDisplay';
import { v3OperationalConfigContext } from '../services/sync/LargeMasterSyncV3OperationalConfigScope';
import { LargeMasterSyncV3Error } from '../services/sync/LargeMasterSyncV3Types';
import { createLargeMasterSyncV3SessionCoordinator } from '../services/sync/LargeMasterSyncV3SetupCompletion';
import { isLargeMasterSyncV3ReplacedCollection } from '../services/sync/LargeMasterSyncV3Authority';

const source = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('SyncManager.ts',source,ts.ScriptTarget.Latest,true);
const cls = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'SyncManager') as ts.ClassDeclaration;
const method = (name:string) => cls.members.find(node => node.name?.getText(parsed) === name)!.getText(parsed);
const actual = ['manualCatalogSync','v3CatalogRefresh','refreshV3Catalog','refreshV3ErpStockDisplay','manualSyncAll','syncAllCatalogs','syncTerminalManifestInBackground'].map(method).join('\n');
const clone = <T>(value:T):T => JSON.parse(JSON.stringify(value));

async function fixture(v3=true, primary=true, kind='ERP_ACTIVE') {
  let identity = {tenantId:'tenant',terminalId:'terminal',deviceId:'device',syncToken:'token',erpSyncBaseUrl:'https://erp.test/api/sync'};
  let config:any = getInitialConfig('Supermercado' as any);
  Object.assign(config.terminals[0].config, {
    currentDeviceId: identity.deviceId, erpTerminalId: identity.terminalId,
    erpBinding: { tenantId: identity.tenantId, companyId: 'company', storeId: 'store' },
    inventoryScope: { defaultSalesWarehouseId: 'warehouse' },
    scales: [{ id: 'scale', brand: 'ZEBRA', model: 'MP7000', port: 'USB' }],
  });
  const stockDisplay = createV3ErpStockDisplay();
  const calls:string[]=[]; const events:string[]=[];
  let save:()=>Promise<void>=async()=>{}; let prepare:()=>Promise<void>=async()=>{};
  let reconcile:()=>Promise<void>=async()=>{}; let manifest:()=>Promise<null>=async()=>null;
  let stockRefresh:()=>Promise<void>=async()=>{};
  let corruptReadback=false;
  const session={assertSetupIdentity:()=>{},assertCurrent:async()=>{calls.push('verify');},projectConfig:async(value:any)=>{
    calls.push('project');return {...value,taxRate:0,taxes:[{id:'TX',rate:0.18,type:'VAT',name:'ITBIS'}],tariffs:[{id:'T',name:'General',taxIncluded:false}]};}};
  const getSession=createLargeMasterSyncV3SessionCoordinator(async(refresh:boolean)=>{
    calls.push(refresh?'refresh':'cached');await prepare();return session;
  },()=>JSON.stringify(identity));
  const authority = { localTerminalId: config.terminals[0].id, assertCurrent: () => {} };
  Object.assign(globalThis,{__v3Manual:{db:{get:async()=>{calls.push('read');return corruptReadback?{}:clone(config);},
    save:async(_name:string,value:any)=>{calls.push('save');await save();config=clone(value);}},
    getSession, cas: async(expected:any,next:any,guard:()=>void)=>{
      assert.equal(JSON.stringify(config),JSON.stringify(expected));guard();calls.push('save');await save();config=clone(next);
    }}});
  const mocks:Record<string,string>={
    '../../utils/db':'export const db=globalThis.__v3Manual.db;',
    './LargeMasterSyncV3OperationalSession':'export const getLargeMasterSyncV3OperationalSession=globalThis.__v3Manual.getSession;export const acquireLargeMasterSyncV3ConfigContext=async()=>{};',
    '../db':'export const dbAdapter={compareAndSwapV3SetupConfig:globalThis.__v3Manual.cas};',
  };
  const built=await build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3ConfigPush.ts',import.meta.url).pathname],bundle:true,
    write:false,format:'esm',platform:'node',plugins:[{name:'manual-boundaries',setup(b){
      b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));
    }}]});
  const helper=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text+'\n//'+crypto.randomUUID()).toString('base64')}`);
  const target={kind,canPullMasters:true,canPushMasters:false,dataMaster:'ERP'};
  const context={
    usesLargeMasterSyncV3Authority:()=>v3&&kind==='ERP_ACTIVE',syncPolicy:{resolve:()=>target},
    readLargeMasterSyncV3BoundIdentity:()=>({...identity}),
    readOperationalTerminalBinding:()=>JSON.stringify(identity),LargeMasterSyncV3Error,
    persistLargeMasterSyncV3ConfigPushCatalog:helper.persistLargeMasterSyncV3ConfigPushCatalog,
    captureLargeMasterSyncV3ConfigRefreshAuthorityFromStore:async()=>authority,
    v3ErpStockDisplay:stockDisplay,v3ErpStockDisplayScope,v3OperationalConfigContext,
    v3BindingKey:()=> 'test-binding',largeMasterSyncV3DownloadOrigin:()=> 'https://download.test',
    dbAdapter:{masterSyncV3Store:{
      getActiveRuntimeVersion:async()=>({syncId:'S',syncVersion:2,contractVersion:2}),
      getOperationalOwner:async()=>({syncId:'S',syncVersion:2,binding:'test-binding'}),
    }},
    fetch:()=>{throw Error('unmocked fetch');},
    fetchLargeMasterSyncV3Inventory:async(readIdentity:()=>typeof identity,_fetch:unknown,signal:AbortSignal,origin:string)=>{
      assert.deepEqual(readIdentity(),identity);assert.equal(origin,'https://download.test');
      assert.equal(signal.aborted,false);calls.push('erp-stock');await stockRefresh();
      return {version:45,cursor:'erp-inventory',balances:[{item_id:'example',warehouse_id:'warehouse',
        qty_on_hand:50,qty_reserved:0,qty_committed:0,updated_at:'fixture'}]};
    },
    syncTriggerCoordinator:{request:async()=>{calls.push('coordinator:events0');await reconcile();}},
    window:{dispatchEvent:(event:{type:string})=>{events.push(event.type);}},CustomEvent:class{constructor(public type:string){}},
    permissionService:{isMasterTerminal:()=>true,shouldShowGlobalSales:()=>false},isLargeMasterSyncV3ReplacedCollection,
    isErpMasterPullCollection:()=>true,logSkippedNonMasterPull:()=>{},ERP_SUPPORTED_MASTER_COLLECTIONS:new Set(),
    apiSyncAdapter:{getMetadata:async()=>({version:1})},reportSyncErrorDiagnostic:()=>{},isPaymentMethodsMissingSyncError:()=>false,
    db:(globalThis as any).__v3Manual.db,console:{info(){},warn(){}},
  };
  const Constructor=runInNewContext(ts.transpileModule('class Subject{'+actual+'}\nSubject;',{
    compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const instance=new Constructor();Object.assign(instance,{isDisabled:false,syncVersions:new Map(),lastBackgroundTerminalManifestSyncAt:0,
    isUsingConfigPushV2Primary:()=>primary,purgeSyncedHistoricalData:async()=>{},pullCatalog:async(name:string)=>{calls.push('legacy:'+name);},
    refreshItemLabelPrices:async()=>{calls.push('label-prices');},
    reconcileTerminalManifest:async(_config:any,options:any)=>{calls.push('manifest');const result=await manifest();if(v3&&kind==='ERP_ACTIVE'&&options.explicitV3Refresh)await instance.refreshV3Catalog();return result;},refreshErpPaymentMethods:async()=>{}});
  return {instance,calls,events,helper,authority,config:()=>config,identity:()=>identity,change:(patch:Partial<typeof identity>)=>{identity={...identity,...patch};},
    onSave:(callback:typeof save)=>{save=callback;},onPrepare:(callback:typeof prepare)=>{prepare=callback;},
    onCoordinator:(callback:typeof reconcile)=>{reconcile=callback;},onManifest:(callback:typeof manifest)=>{manifest=callback;},onStockRefresh:(callback:typeof stockRefresh)=>{stockRefresh=callback;},
    corrupt:()=>{corruptReadback=true;}};
}

test('explicit V3 manual refresh receives catalog with zero outbox events and no legacy products',async()=>{
  const f=await fixture();await f.instance.manualSyncAll();
  assert.deepEqual(f.calls.filter(call=>['coordinator:events0','manifest','refresh','project','save'].includes(call)),
    ['coordinator:events0','manifest','refresh','project','save']);
  assert.deepEqual(f.events,['v3CatalogUpdated','configUpdated','v3ErpStockDisplayUpdated']);
  assert.equal(f.config().taxes[0].rate,0.18);assert.equal(f.config().tariffs[0].id,'T');
  assert.equal(f.config().terminals[0].config.scales[0].port,'USB');
  assert(!f.calls.some(call=>call.startsWith('legacy:')));
  assert.equal(f.calls.filter(call=>call==='erp-stock').length,1);
});

test('concurrent explicit refresh shares one flight and cannot succeed before projection commit',async()=>{
  const f=await fixture();let release!:()=>void;let saving=false;let done=false;
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  f.onSave(async()=>{saving=true;await barrier;});
  const first=f.instance.manualSyncAll();const second=f.instance.manualSyncAll();assert.equal(first,second);
  void first.then(()=>{done=true;});while(!saving)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(done,false);assert.deepEqual(f.events,[]);release();await Promise.all([first,second]);
  assert.equal(f.calls.filter(call=>call==='refresh').length,1);
});

for(const point of ['prepare','save','readback','manifest'] as const)test(`manual ${point} failure rejects without notification`,async()=>{
  const f=await fixture();
  if(point==='prepare')f.onPrepare(async()=>{throw new LargeMasterSyncV3Error('SYNC_SNAPSHOT_NOT_READY',undefined,true);});
  if(point==='save')f.onSave(async()=>{throw Error('DISK_WRITE_FAILED');});
  if(point==='readback')f.onSave(async()=>{f.corrupt();});
  if(point==='manifest')f.onManifest(async()=>{throw Error('MANIFEST_UNAVAILABLE');});
  await assert.rejects(f.instance.manualSyncAll());assert.deepEqual(f.events,[]);
  if(point==='manifest')assert(!f.calls.includes('refresh'));
});

for(const field of ['tenantId','terminalId','deviceId','syncToken','erpSyncBaseUrl'] as const)test(`manual refresh rejects changed ${field} before persistence`,async()=>{
  const f=await fixture();f.onCoordinator(async()=>{f.change({[field]:'changed'});});
  await assert.rejects(f.instance.manualSyncAll(),/BINDING_CHANGED/);
  assert(!f.calls.includes('save'));assert(!f.calls.includes('manifest'));assert.deepEqual(f.events,[]);
});

test('foreign scope cannot join an outstanding manual refresh',async()=>{
  const f=await fixture();let release!:()=>void;let entered=false;
  f.onCoordinator(async()=>{entered=true;await new Promise<void>(resolve=>{release=resolve;});});
  const first=f.instance.manualSyncAll();while(!entered)await new Promise(resolve=>setImmediate(resolve));
  f.change({tenantId:'foreign'});await assert.rejects(f.instance.manualSyncAll(),/BINDING_CHANGED/);
  release();await assert.rejects(first,/BINDING_CHANGED/);assert.deepEqual(f.events,[]);
});

test('direct syncAllCatalogs includes V3 refresh while filtering replaced legacy masters',async()=>{
  const f=await fixture(true,false);await f.instance.manualSyncAll();
  assert.equal(f.calls.filter(call=>call==='refresh').length,1);
  assert.equal(f.calls.filter(call=>call==='label-prices').length,1);
  assert.equal(f.calls.filter(call=>call==='erp-stock').length,1);
  for(const collection of ['products','taxes','priceLists','productPrices','productStocks'])assert(!f.calls.includes('legacy:'+collection));
});

test('V2 primary and legacy fallback retain original routes without V3 work',async()=>{
  const primary=await fixture(false,true);await primary.instance.manualSyncAll();
  assert.deepEqual(primary.calls,['coordinator:events0','manifest']);assert.deepEqual(primary.events,[]);
  const fallback=await fixture(false,false);await fallback.instance.manualSyncAll();
  assert(fallback.calls.includes('legacy:products'));assert(!fallback.calls.includes('refresh'));
  assert(!fallback.calls.includes('erp-stock'));
});

test('both manual UI callers use shared route and periodic strategy does not invoke it',()=>{
  for(const name of ['SyncSettings','SyncStatusIndicator']){
    const ui=readFileSync(new URL('../components/'+name+'.tsx',import.meta.url),'utf8');
    assert.match(ui,/await syncManager\.manualSyncAll\(\)/);
  }
  const periodic=source.slice(source.indexOf('private async runAutomaticMasterDataSync'),source.indexOf('setReducedSyncMode(reduced:'));
  assert.doesNotMatch(periodic,/manualSyncAll|refreshV3Catalog/);
});


test('default catalog sweep does not add a V3 download to automatic/startup callers',async()=>{
  const f=await fixture();await f.instance.syncAllCatalogs();
  assert(!f.calls.includes('refresh'));assert.deepEqual(f.events,[]);
  assert(f.calls.includes('label-prices'));assert(!f.calls.includes('erp-stock'));
});


test('manual and config-push projection share session negotiation and retain one bound authority',async()=>{
  const f=await fixture();let release!:()=>void;let preparing=false;
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  f.onPrepare(async()=>{preparing=true;await barrier;});
  const manual=f.instance.manualSyncAll();while(!preparing)await new Promise(resolve=>setImmediate(resolve));
  const identity=JSON.stringify(f.identity());
  const push=f.helper.persistLargeMasterSyncV3ConfigPushCatalog(()=>{assert.equal(JSON.stringify(f.identity()),identity);},f.authority);
  release();await Promise.all([manual,push]);
  assert.equal(f.calls.filter(call=>call==='refresh').length,1);
  assert.equal(f.config().taxes[0].id,'TX');assert.equal(f.config().terminals[0].config.scales[0].port,'USB');
  assert.deepEqual(f.events,['v3CatalogUpdated','configUpdated','v3ErpStockDisplayUpdated']);
});

for (const primary of [true, false]) test(`manual V3 ${primary ? 'config push' : 'catalog sweep'} reports failed stock fetch without a stock publication`, async () => {
  const f = await fixture(true, primary);
  f.onStockRefresh(async () => { throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_HTTP_ERROR'); });
  await assert.rejects(f.instance.manualSyncAll(), /SYNC_V3_INVENTORY_HTTP_ERROR/);
  assert.equal(f.calls.filter(call => call === 'erp-stock').length, 1);
  assert.deepEqual(f.events, ['v3CatalogUpdated', 'configUpdated']);
});
