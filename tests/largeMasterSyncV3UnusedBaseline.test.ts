import {build} from 'esbuild';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL } from '../services/db/LargeMasterSyncV3Schema';
import { LargeMasterSyncV3SqliteStore } from '../services/db/LargeMasterSyncV3SqliteStore';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import type { DurableDocumentMutation } from '../services/db/DatabaseAdapter';
import { resetLargeMasterSyncV3OperationGateForTests, setLargeMasterSyncV3CriticalOperation } from '../services/sync/LargeMasterSyncV3OperationGate';
import { v3StockSource } from '../services/sync/LargeMasterSyncV3StockAuthority';

const baseline = JSON.stringify(['binding', 'S', 47, 4, 'C']);
const stamp = { binding: 'binding', warehouseId: 'W', syncId: 'S', syncVersion: 47, tariffId: 'T', taxIncluded: false,
  inventoryVersion: 4, inventoryCursor: 'C' };
const oldLine = { id: 'P', cartId: 'old-line', price: 70, quantity: 1, type: 'PRODUCT', isInventoriable: true,
  taxable: true, appliedTaxIds: ['TX'], v3SaleAuthority: stamp };
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));');
  sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
  const bridge = { query: async (query: string, values: any[] = []) => ({ values: sql.prepare(query).all(...values) }),
    run: async (query: string, values: any[] = []) => { const result=sql.prepare(query).run(...values);if(query.includes('UPDATE master_v3_operational_owner SET sync_id'))lastActivationWrite();return result; }, execute: async (query: string) => { sql.exec(query); } };
  let tail: Promise<unknown> = Promise.resolve();
  const lock = <T>(operation: () => Promise<T>): Promise<T> => { const next = tail.then(operation); tail = next.catch(() => {}); return next; };
  let fail: string | false = false; let lastActivationWrite:()=>void=()=>{};
  const store = new LargeMasterSyncV3SqliteStore(() => bridge, lock, point => { if (fail && point === fail) throw Error('disk fault'); });
  const adapter = new CapacitorSQLiteAdapter(); Object.assign(adapter, { db: bridge, isReady: true });
  const article = { id: 'P', name: 'Agua', type: 'PRODUCT', inventoriable: true, uom: 'UN', taxable: true, taxIds: ['TX'],
    active: true, sellable: true, activeWarehouseIds:['W'], measurementUnit: 'UND', purchaseUnit: 'UND', conversionFactor: 1, operationalFlags: { isWeighted: true, integersOnly: false, trackInventory: true }, familyId: 'old-family' };
  function stage(id: string, version: number, price = 85, patch: Record<string, unknown> = {}) {
    sql.prepare(`INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at)
      VALUES(?,?,3,2,'VALIDATED','{}','2020','2020')`).run(id, version);
    const row = { ...article, familyId: 'new-family', ...patch };
    sql.prepare(`INSERT INTO master_v3_articles(sync_version,article_id,sku,description,article_type,uom,taxable,tax_ids_json,active,sellable,record_json)
      VALUES(?,?,'BEB003','Agua','PRODUCT','UN',1,'["TX"]',1,1,?)`).run(version, 'P', JSON.stringify(row));
    sql.prepare('INSERT INTO master_v3_tariffs(sync_version,tariff_id,active,record_json) VALUES(?,\'T\',1,?)').run(version, JSON.stringify({ id: 'T', taxIncluded: false, active: true }));
    sql.prepare('INSERT INTO master_v3_taxes(sync_version,tax_id,active,rate,record_json) VALUES(?,\'TX\',1,.18,?)').run(version, JSON.stringify({ id: 'TX',name:'ITBIS', type: 'SALES', rate: .18,active:true }));
    sql.prepare('INSERT INTO master_v3_prices VALUES(?,?,?,?)').run(version, 'P', 'T', price);
    sql.prepare('UPDATE master_v3_state SET staging_sync_id=?,staging_version=? WHERE singleton=1').run(id, version);
  }
  stage('S', 47, 70, { familyId: 'old-family' });
  sql.exec("UPDATE sync_v3_sessions SET status='ACTIVE' WHERE sync_id='S'; UPDATE master_v3_state SET active_sync_id='S',active_version=47,staging_sync_id=NULL,staging_version=NULL WHERE singleton=1; INSERT INTO master_v3_operational_owner VALUES(1,'S',47,'binding'); INSERT INTO master_v3_inventory_state VALUES(1,'S',47,4,'C','now'); INSERT INTO master_v3_inventory_balances VALUES('P','W',100,0,0,'now');");
  const read = (collection: string) => sql.prepare('SELECT data FROM documents WHERE collection_name=? ORDER BY doc_id').all(collection).map(row => String(row.data));
  const insert = (collection: string, document: any) => sql.prepare('INSERT OR REPLACE INTO documents(collection_name,doc_id,data) VALUES(?,?,?)').run(collection, document.id, JSON.stringify(document));
  const transition = async () => ({ assertIdentity:()=>{}, binding: 'binding', expectedCatalog: (await store.getActiveRuntimeVersion())!, inventory: (await store.getInventoryAuthority())! });
  const stock = async () => 100 + await store.getLocalInventoryDelta(baseline, 'P', 'W');
  return { sql, store, adapter, stage, insert, read, transition, stock, onLastActivationWrite:(callback:()=>void)=>{lastActivationWrite=callback;}, fail: (value: string | false) => { fail = value; } };
}

const corrected = { measurementUnit: 'LB', purchaseUnit: 'LB', operationalFlags: { isWeighted: true, integersOnly: false, trackInventory: false } };
const fresh = { version: 5, cursor: 'fresh-LB', balances: [{ item_id: 'P', warehouse_id: 'W', qty_on_hand: 22, qty_reserved: 0, qty_committed: 0, updated_at: 'now' }] };
const authorityState = (f: ReturnType<typeof fixture>) => ['master_v3_state','master_v3_inventory_state','master_v3_inventory_balances','master_v3_operational_owner','sync_v3_sessions','master_v3_catalog_owners']
  .map(table => JSON.stringify(f.sql.prepare('SELECT * FROM ' + table).all()));

test('unused UND/tracked -> LB/untracked installs fresh inventory atomically and survives store reopen', async () => {
 const f=fixture(); try {
  f.stage('N',102,2000,corrected); const transition=await f.transition();
  await assert.rejects(f.store.activateCatalogOnly('N',transition),/SEMANTICS_CHANGED/);
  await f.store.assertCanReplaceUnusedBaseline(transition);
  await f.store.activateUnusedBaseline('N',fresh,transition);
  const reopened=new LargeMasterSyncV3SqliteStore(()=>({query:async(q,p=[])=>({values:f.sql.prepare(q).all(...p as any[])}),run:async(q,p=[])=>f.sql.prepare(q).run(...p as any[]),execute:async q=>{f.sql.exec(q);}}),async op=>op());
  assert.equal((await reopened.getOperationalOwner())?.syncId,'N');
  assert.equal((await reopened.getInventoryAuthority())?.cursor,'fresh-LB');
  assert.equal((await reopened.getInventoryBalance({syncId:'N',syncVersion:102,contractVersion:2},'P','W'))?.qtyOnHand,22);
  assert.equal((await reopened.getOperationalArticle({syncId:'N',syncVersion:102,contractVersion:2},'P'))?.measurementUnit,'LB');
  assert.deepEqual(f.read('transactions'),[]); assert.deepEqual(f.read('inventoryLedger'),[]);
 } finally { f.sql.close(); }
});

for (const point of ['activation_after_pointer','activation_after_inventory','activation_after_owner']) test('fresh baseline rollback at '+point, async()=>{
 const f=fixture();try{f.stage('N',102,2000,corrected);const before=authorityState(f);f.fail(point);
 await assert.rejects(f.store.activateUnusedBaseline('N',fresh,await f.transition()),/disk fault/);
 assert.deepEqual(authorityState(f),before);f.fail(false);await f.store.activateUnusedBaseline('N',fresh,await f.transition());
 }finally{f.sql.close();}
});

for (const [collection,document] of [
 ['inventoryLedger',{id:'pending',v3InventoryBaseline:baseline,qtyIn:0,qtyOut:0,syncStatus:'PENDING'}],
 ['inventoryLedger',{id:'applied',v3InventoryBaseline:baseline,qtyIn:1,qtyOut:1,syncStatus:'APPLIED_ERP'}],
 ['parkedTickets',{id:'parked',items:[oldLine]}],
 ['v3RestoredTicketSources',{id:'restored',items:[oldLine]}],
 ['transactions',{id:'refund',original:{items:[oldLine]}}],
 ['transactionHistory',{id:'historical',snapshot:{items:[oldLine]}}],
 ] as const) test('retained source rejects full refresh: '+collection+document.id,async()=>{
 const f=fixture();try{f.stage('N',102,2000,corrected);f.insert(collection,document);const before=authorityState(f);const transition=await f.transition();
 await assert.rejects(f.store.assertCanReplaceUnusedBaseline(transition),/MIGRATION_REQUIRED/);
 await assert.rejects(f.store.activateUnusedBaseline('N',fresh,transition),/MIGRATION_REQUIRED/);assert.deepEqual(authorityState(f),before);
 assert.deepEqual(f.read(collection),[JSON.stringify(document)]);
 }finally{f.sql.close();}
});

for(const drift of ['binding','owner','inventory','catalog','identity','source-at-owner'])test('fresh baseline final native race '+drift,async()=>{
 const f=fixture();try{f.stage('N',102,2000,corrected);const transition=await f.transition();const before=authorityState(f);let identity=true;
 if(drift==='binding')transition.binding='foreign-terminal';
 else if(drift==='owner')f.sql.exec("UPDATE master_v3_operational_owner SET binding='foreign-company'");
 else if(drift==='inventory')f.sql.exec("UPDATE master_v3_inventory_state SET cursor='raced'");
 else if(drift==='catalog')f.sql.exec("UPDATE master_v3_state SET active_version=999");
 else f.onLastActivationWrite(()=>{if(drift==='identity')identity=false;else f.insert('parkedTickets',{id:'racing',items:[oldLine]});});
 transition.assertIdentity=()=>{if(!identity)throw Error('SYNC_V3_BINDING_CHANGED');};
 const afterExternal=authorityState(f);await assert.rejects(f.store.activateUnusedBaseline('N',fresh,transition),/CHANGED|MIGRATION_REQUIRED/);
 assert.deepEqual(authorityState(f),afterExternal);assert.equal(f.read('parkedTickets').length,0);
 }finally{f.sql.close();}
});

test('malformed retained source and active payment fail closed',async()=>{
 const f=fixture();try{f.stage('N',102,2000,corrected);const transition=await f.transition();
 f.sql.exec("INSERT INTO documents(collection_name,doc_id,data) VALUES('parkedTickets','bad','broken')");
 await assert.rejects(f.store.activateUnusedBaseline('N',fresh,transition),/MIGRATION_REQUIRED/);
 f.sql.exec("DELETE FROM documents WHERE doc_id='bad'");setLargeMasterSyncV3CriticalOperation('PAYMENT',true);
 await assert.rejects(f.store.activateUnusedBaseline('N',fresh,transition),/OPERATIONAL_WINDOW_HELD/);
 }finally{resetLargeMasterSyncV3OperationGateForTests();f.sql.close();}
});

test('failed inventory HTTP leaves exact old authority; retry resumes SAME validated staging without negotiation', async()=>{
 const { prepareLargeMasterSyncV3UnusedBaseline } = await import('../services/sync/LargeMasterSyncV3Candidate');
 const { LargeMasterSyncV3Runtime } = await import('../services/sync/LargeMasterSyncV3Runtime');
 const f=fixture();try{
  f.stage('N',102,2000,corrected);const transition=await f.transition();const before=authorityState(f);
  let failFetch=true;let requests=0;const resumed:string[]=[];
  const dependencies={enabled:true,assertPlatform:()=>{},waitForOperationalWindow:async()=>0,
    openRuntime:LargeMasterSyncV3Runtime.open,
    createClient:(store:any)=>({requestSync:async()=>{requests++;throw Error('must not negotiate');},resumeSync:async(id:string)=>{resumed.push(id);return store.activate(id);}}),
    fetchInventory:async()=>{assert.equal((await f.store.getActiveRuntimeVersion())?.syncId,'S');if(failFetch)throw Error('HTTP offline');return fresh;}};
  await assert.rejects(prepareLargeMasterSyncV3UnusedBaseline(f.store,'https://download.test',transition,undefined,dependencies),/HTTP offline/);
  assert.deepEqual(authorityState(f),before);assert.equal((await f.store.findIncomplete())?.syncId,'N');
  failFetch=false;const ready=await prepareLargeMasterSyncV3UnusedBaseline(f.store,'https://download.test',transition,undefined,dependencies);
  assert.equal(ready.runtime.version.syncId,'N');assert.equal(ready.inventoryCursor,'fresh-LB');
  assert.equal(requests,0);assert.deepEqual(resumed,['N','N']);
 }finally{f.sql.close();}
});

test('source inserted after preflight is denied at final transaction, and malformed inventory rolls back pointer',async()=>{
 const f=fixture();try{f.stage('N',102,2000,corrected);const transition=await f.transition();
 await f.store.assertCanReplaceUnusedBaseline(transition);f.insert('transactionHistory',{id:'raced',items:[oldLine]});const before=authorityState(f);
 await assert.rejects(f.store.activateUnusedBaseline('N',fresh,transition),/MIGRATION_REQUIRED/);assert.deepEqual(authorityState(f),before);
 f.sql.exec("DELETE FROM documents WHERE doc_id='raced'");
 await assert.rejects(f.store.activateUnusedBaseline('N',{...fresh,balances:[{...fresh.balances[0],qty_on_hand:NaN}]},transition),/INVENTORY_INVALID/);
 assert.deepEqual(authorityState(f),before);
 }finally{f.sql.close();}
});

for(const result of ['success','identity-race','retained-race','other-error','normal-retry'])test('actual Session→catalog-only semantic rejection→atomic fresh route '+result,async()=>{
 const f=fixture();try{
  f.stage('N',102,2000,corrected);
  const state:any={identity:{tenantId:'tenant',terminalId:'terminal',deviceId:'device',syncToken:'token',erpSyncBaseUrl:'https://erp.test/api/sync'},origin:'https://download.test',
    config:{terminals:[{id:'local',config:{currentDeviceId:'device',erpTerminalId:'terminal',erpBinding:{companyId:'company'},inventoryScope:{defaultSalesWarehouseId:'W'}}}]},fetches:0,resumed:[]};
  const binding=JSON.stringify([state.identity.tenantId,state.identity.terminalId,state.identity.deviceId,state.identity.erpSyncBaseUrl,state.origin]);
  f.sql.prepare('UPDATE master_v3_operational_owner SET binding=?').run(binding);
  const adapter=Object.create(f.adapter);adapter.masterSyncV3Store=f.store;adapter.connect=async()=>{};
  Object.assign(globalThis,{__unusedSession:{state,adapter,db:{get:async()=>state.config},fresh}});
  const mocks:Record<string,string>={
    '../../utils/db':'export const db=globalThis.__unusedSession.db;', '../db':'export const dbAdapter=globalThis.__unusedSession.adapter;',
    './LargeMasterSyncV3Authority':'export const LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED=true;',
    './LargeMasterSyncV3CanaryFacade':'export const LARGE_MASTER_SYNC_V3_CANARY=false;export const validateLargeMasterSyncV3CanaryUrl=value=>value;',
    './OperationalTerminalConfig':'export const readOperationalTerminalBinding=()=>"credentials";',
    './LargeMasterSyncV3Platform':'export const assertLargeMasterSyncV3NativeAndroid=()=>{};',
    './LargeMasterSyncV3DownloadOrigin':'export const largeMasterSyncV3DownloadOrigin=()=>globalThis.__unusedSession.state.origin;',
    './LargeMasterSyncV3Inventory':`export const fetchLargeMasterSyncV3Inventory=async()=>{const {state,fresh}=globalThis.__unusedSession;state.fetches++;if(state.failFetch)throw Error('HTTP offline');${result==='identity-race'?"state.identity={...state.identity,terminalId:'foreign'};":''}return fresh;};`,
    './LargeMasterSyncV3BoundTransport':`export const readLargeMasterSyncV3BoundIdentity=()=>({...globalThis.__unusedSession.state.identity});export const validatedLargeMasterSyncV3ErpSyncBase=value=>value;
      export const createLargeMasterSyncV3BoundClient=store=>({requestSync:async()=>{throw Error('new ERP session forbidden while staging exists');},resumeSync:async id=>{globalThis.__unusedSession.state.resumed.push(id);${result==='other-error'?"throw Error('SYNC_V3_UNKNOWN_ERROR');":'return store.activate(id);'}}});`,
  };
  if(result==='retained-race')f.onLastActivationWrite(()=>f.insert('parkedTickets',{id:'late',items:[oldLine]}));
  const bundled=await build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3OperationalSession.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'fresh-session-io',setup(b){
    b.onResolve({filter:/LargeMasterSyncV3Types$/},()=>({path:new URL('../services/sync/LargeMasterSyncV3Types.ts',import.meta.url).href,external:true}));
    b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
  const helper=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text+'\n//'+result).toString('base64'));
  if(result==='normal-retry'){
    state.failFetch=true;const before=authorityState(f);
    await assert.rejects(helper.LargeMasterSyncV3OperationalSession.open(true),/HTTP offline/);
    assert.deepEqual(authorityState(f),before);state.failFetch=false;
    const session=await helper.LargeMasterSyncV3OperationalSession.open(true);assert.equal(session.ready.runtime.version.syncId,'N');
    assert.deepEqual(state.resumed,['N','N','N','N']);assert.equal(state.fetches,2);
  }else if(result==='success'){
    const session=await helper.LargeMasterSyncV3OperationalSession.open(true);assert.equal(session.ready.runtime.version.syncId,'N');
    assert.equal(session.ready.inventoryCursor,'fresh-LB');assert.equal(state.fetches,1);assert.deepEqual(state.resumed,['N','N']);
    const catalog=await session.catalog('T','W');assert.equal((await catalog.get('P'))?.product.measurementUnit,'LB');
  }else{
    await assert.rejects(helper.LargeMasterSyncV3OperationalSession.open(true),/BINDING_CHANGED|MIGRATION_REQUIRED|UNKNOWN_ERROR/);
    assert.equal((await f.store.getActiveRuntimeVersion())?.syncId,'S');assert.equal((await f.store.getInventoryAuthority())?.cursor,'C');
    assert.equal(f.read('parkedTickets').length,0);if(result==='other-error')assert.equal(state.fetches,0);
  }
 }finally{f.sql.close();}
});
