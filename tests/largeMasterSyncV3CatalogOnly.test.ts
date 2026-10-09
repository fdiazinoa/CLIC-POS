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
    run: async (query: string, values: any[] = []) => sql.prepare(query).run(...values), execute: async (query: string) => { sql.exec(query); } };
  let tail: Promise<unknown> = Promise.resolve();
  const lock = <T>(operation: () => Promise<T>): Promise<T> => { const next = tail.then(operation); tail = next.catch(() => {}); return next; };
  let fail = false;
  const store = new LargeMasterSyncV3SqliteStore(() => bridge, lock, point => { if (fail && point === 'activation_after_pointer') throw Error('disk fault'); });
  const adapter = new CapacitorSQLiteAdapter(); Object.assign(adapter, { db: bridge, isReady: true });
  const article = { id: 'P', name: 'Agua', type: 'PRODUCT', inventoriable: true, uom: 'UN', taxable: true, taxIds: ['TX'],
    active: true, sellable: true, activeWarehouseIds:['W'], operationalFlags: { trackInventory: true }, familyId: 'old-family' };
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
  const transition = async () => ({ binding: 'binding', expectedCatalog: (await store.getActiveRuntimeVersion())!, inventory: (await store.getInventoryAuthority())! });
  const stock = async () => 100 + await store.getLocalInventoryDelta(baseline, 'P', 'W');
  return { sql, store, adapter, stage, insert, read, transition, stock, fail: (value: boolean) => { fail = value; } };
}
function financial(id: string, quantity: number, version = 47, sourceId = 'S'): DurableDocumentMutation[] {
  const scope = { v3Binding: 'binding', v3WarehouseId: 'W', v3InventoryBaseline: baseline };
  const current = { syncId: sourceId, syncVersion: version, binding: 'binding' };
  return [{ collectionName: 'transactions', document: { id, ...scope }, requireAbsent: true, v3CurrentCatalog: current,
    v3StockRequirements: [{ baseline, productId: 'P', warehouseId: 'W', quantity }] },
    { collectionName: 'inventoryLedger', document: { id: 'ledger-' + id, ...scope, productId: 'P', warehouseId: 'W', qtyOut: quantity, qtyIn: 0, syncStatus: 'PENDING' }, requireAbsent: true, v3CurrentCatalog: current }];
}

test('real SQLite catalog-only 70→85 preserves stock anchor and PENDING/APPLIED deltas across three generations/restart', async () => {
  const f = fixture();
  try {
    await f.adapter.saveDocumentsAtomically(financial('old-sale', 1)); assert.equal(await f.stock(), 99);
    const beforeLedger = f.read('inventoryLedger'); const anchor = JSON.stringify(await f.store.getInventoryAuthority());
    const ticket = { id: 'ticket', tableId: '12', items: [oldLine] }; f.insert('parkedTickets', ticket);
    for (const [id, version] of [['N', 102], ['N2', 103], ['N3', 104]] as const) {
      f.stage(id, version); const transition = await f.transition(); await f.store.activateCatalogOnly(id, transition);
      assert.equal(await f.stock(), 99); assert.deepEqual(f.read('inventoryLedger'), beforeLedger);
      assert.equal(JSON.stringify(await f.store.getInventoryAuthority()), anchor);
      assert.deepEqual(f.read('parkedTickets'), [JSON.stringify(ticket)]);
      const runtime = (await f.store.getActiveRuntimeVersion())!;
      assert.deepEqual(await f.store.getInventorySnapshotVersion(runtime), { version: 4, cursor: 'C' });
      const page = await f.store.readAdministrativeCatalogPage(runtime, { tariffId: 'T', warehouseId: 'W', inventoryVersion: 4, inventoryCursor: 'C' });
      assert.equal(page.rows[0].price, 85);
      await f.store.cleanupExpiredVersions('2099', 5);
    }
    const restarted = new LargeMasterSyncV3SqliteStore(() => ({ query: async (q, p = []) => ({ values: f.sql.prepare(q).all(...p as any[]) }), run: async (q, p = []) => f.sql.prepare(q).run(...p as any[]), execute: async q => { f.sql.exec(q); } }), async op => op());
    assert.equal((await restarted.getOperationalOwner())?.syncVersion, 104);
    assert.equal(await restarted.getLocalInventoryDelta(baseline, 'P', 'W'), -1);
    await f.adapter.saveDocumentsAtomically(financial('new-sale', 1, 104, 'N3')); assert.equal(await f.stock(), 98);
    const ledger = JSON.parse(f.read('inventoryLedger')[0]); ledger.syncStatus = 'APPLIED_ERP'; f.insert('inventoryLedger', ledger);
    assert.equal(await f.stock(), 98); await assert.rejects(f.store.assertCanRefresh(), /INVENTORY_COVERAGE_REQUIRED/);
  } finally { f.sql.close(); }
});

test('activation fault restores pointer/owner/receipts atomically; foreign collision and replay binding deny', async () => {
  const f = fixture(); try {
    f.stage('N', 102); const transition = await f.transition(); f.fail(true);
    await assert.rejects(f.store.activateCatalogOnly('N', transition), /disk fault/);
    assert.equal((await f.store.getOperationalOwner())?.syncId, 'S'); assert.equal((await f.store.getActiveRuntimeVersion())?.syncId, 'S');
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM master_v3_catalog_owners').get()?.count, 0);
    f.fail(false); f.sql.exec("INSERT INTO master_v3_catalog_owners VALUES('N',102,'foreign','S',47,4,'C');");
    await assert.rejects(f.store.activateCatalogOnly('N', transition), /RETAINED_OWNER_REQUIRED/);
    assert.equal((await f.store.getActiveRuntimeVersion())?.syncId, 'S');
    f.sql.exec("DELETE FROM master_v3_catalog_owners;"); await f.store.activateCatalogOnly('N', transition);
    await f.store.activateCatalogOnly('N', transition);
    await assert.rejects(f.store.activateCatalogOnly('N', { ...transition, binding: 'foreign' }), /TRANSITION_CHANGED/);
  } finally { f.sql.close(); }
});

for (const patch of [{ uom: 'KG' }, { inventoriable: false }, { taxable: false }, { operationalFlags: { trackInventory: false } }]) test(`overlap semantics ${JSON.stringify(patch)} deny without owner/anchor changes`, async () => {
  const f = fixture(); try { f.stage('N', 102, 85, patch); await assert.rejects(f.store.activateCatalogOnly('N', await f.transition()), /SEMANTICS_CHANGED/);
    assert.equal((await f.store.getOperationalOwner())?.syncId, 'S'); assert.equal(await f.stock(), 100);
  } finally { f.sql.close(); }
});

test('native retained mixed old70/new85 requires actual ticket CAS, closes once and rejects loose old stamps', async () => {
  const f = fixture(); try {
    const ticket = { id: 'ticket', tableId: '12', items: [oldLine], paymentFraction: { parts: [{ status: 'PAID' }, { status: 'PENDING' }] } };
    f.insert('parkedTickets', ticket); f.stage('N', 102); await f.store.activateCatalogOnly('N', await f.transition());
    const newLine = { ...oldLine, cartId: 'new-line', price: 85, v3SaleAuthority: { ...stamp, syncId: 'N', syncVersion: 102, inventorySyncId: 'S', inventorySyncVersion: 47 } };
    const documents = financial('mixed', 2, 102, 'N');
    Object.assign(documents[0].document, { items: [oldLine, newLine], restaurantOrderId: 'ticket' });
    await assert.rejects(f.adapter.saveDocumentsAtomically(documents), /RETAINED_SOURCE_REQUIRED/);
    assert.deepEqual(f.read('transactions'), []);
    documents[0].v3ExpectedRetainedDocument = { collection: 'parkedTickets', id: 'ticket', expected: JSON.stringify(ticket) };
    const changed = { ...ticket, paymentFraction: { parts: [{ status: 'PAID' }, { status: 'PAID' }] } }; f.insert('parkedTickets', changed);
    await assert.rejects(f.adapter.saveDocumentsAtomically(documents), /RETAINED_TICKET_CHANGED/);
    documents[0].v3ExpectedRetainedDocument.expected = JSON.stringify(changed);
    documents.push({ collectionName: 'v3TicketSettlements', document: { id: 'ticket', transactionId: 'mixed' }, requireAbsent: true,
      v3ExpectedRetainedDocument: documents[0].v3ExpectedRetainedDocument });
    await f.adapter.saveDocumentsAtomically(documents); assert.equal(await f.stock(), 98);
    assert.equal(JSON.parse(f.read('transactions')[0]).items[0].price, 70); assert.equal(JSON.parse(f.read('transactions')[0]).items[1].price, 85);
    const replay = financial('replay', 2, 102, 'N'); Object.assign(replay[0].document, documents[0].document, { id: 'replay' }); replay[0].v3ExpectedRetainedDocument = documents[0].v3ExpectedRetainedDocument;
    await assert.rejects(f.adapter.saveDocumentsAtomically(replay), /RETAINED_TICKET_CHANGED/); assert.equal(await f.stock(), 98);
  } finally { f.sql.close(); }
});

test('partial stock stamps are invalid and active payment blocks catalog activation', async () => {
  assert.throws(() => v3StockSource({ ...stamp, inventorySyncId: 'S' }), /STOCK_AUTHORITY_INVALID/);
  const f = fixture(); try { f.stage('N', 102); const transition = await f.transition(); setLargeMasterSyncV3CriticalOperation('PAYMENT', true);
    await assert.rejects(f.store.activateCatalogOnly('N', transition), /OPERATIONAL_WINDOW_HELD/);
    assert.equal((await f.store.getOperationalOwner())?.syncId, 'S');
  } finally { resetLargeMasterSyncV3OperationGateForTests(); f.sql.close(); }
});

test('initial unchanged owned generation derives receipt atomically without moving inventory',async()=>{
 const f=fixture();try { const anchor=JSON.stringify(await f.store.getInventoryAuthority());
  await f.store.activateCatalogOnly('S',await f.transition());
  assert.ok(await f.store.getCatalogReceipt({syncId:'S',syncVersion:47},'binding'));
  assert.equal(JSON.stringify(await f.store.getInventoryAuthority()),anchor);
  await assert.rejects(f.store.activateCatalogOnly('S',{...await f.transition(),binding:'foreign'}),/TRANSITION_CHANGED/);
 }finally{f.sql.close();}
});

test('native direct claim survives parked replacement, reuses identity and rejects forged/closed sources',async()=>{
 const f=fixture();try{
  const ticket={id:'direct',items:[oldLine]};f.insert('parkedTickets',ticket);
  f.stage('N',102);await f.store.activateCatalogOnly('N',await f.transition());
  const claim={...ticket,state:'PENDING',v3Binding:'binding',v3WarehouseId:'W',v3InventoryBaseline:baseline,restaurantOrderId:'direct'};
  const current={syncId:'N',syncVersion:102,binding:'binding'};
  const source={collection:'parkedTickets',id:'direct',expected:JSON.stringify(ticket)};
  const mutation:DurableDocumentMutation={collectionName:'v3RestoredTicketSources',document:claim,requireAbsent:true,v3CurrentCatalog:current,v3ExpectedRetainedDocument:source};
  await f.adapter.saveDocumentsAtomically([mutation]);
  f.sql.exec("DELETE FROM documents WHERE collection_name='parkedTickets';");
  assert.equal(f.read('v3RestoredTicketSources').length,1);assert.equal(await f.stock(),100);
  const changed={...claim,items:[{...oldLine,price:999}]};
  await assert.rejects(f.adapter.saveDocumentsAtomically([{...mutation,requireAbsent:false,expectedDocument:JSON.stringify(claim),document:changed,
    v3ExpectedRetainedDocument:{collection:'v3RestoredTicketSources',id:'direct',expected:JSON.stringify(claim)}}]),/RETAINED_LINE_CHANGED/);
  const documents=financial('direct-sale',1,102,'N');Object.assign(documents[0].document,{items:[oldLine],restaurantOrderId:'direct'});
  documents[0].v3ExpectedRetainedDocument={collection:'v3RestoredTicketSources',id:'direct',expected:JSON.stringify(claim)};
  documents.push({collectionName:'v3TicketSettlements',document:{id:'direct',transactionId:'direct-sale'},requireAbsent:true,v3ExpectedRetainedDocument:documents[0].v3ExpectedRetainedDocument});
  await f.adapter.saveDocumentsAtomically(documents);assert.equal(await f.stock(),99);
  assert.equal(await f.adapter.isV3TicketClosed('direct'),true);
  await assert.rejects(f.adapter.saveDocumentsAtomically([{...mutation,requireAbsent:false,expectedDocument:JSON.stringify(claim),
    v3ExpectedRetainedDocument:{collection:'v3RestoredTicketSources',id:'direct',expected:JSON.stringify(claim)}}]),/RETAINED_TICKET_CHANGED/);
 }finally{f.sql.close();}
});

test('completed pre-upgrade sale closes stale parked source without new settlement marker',async()=>{
 const f=fixture();try{
  const ticket={id:'old-completed',items:[oldLine]};f.insert('parkedTickets',ticket);
  f.insert('transactions',{id:'507-sale',type:'SALE',restaurantOrderId:ticket.id,items:[oldLine]});
  f.stage('N',102);await f.store.activateCatalogOnly('N',await f.transition());
  assert.equal(await f.adapter.isV3TicketClosed(ticket.id),true);
  const documents=financial('illegal-replay',1,102,'N');Object.assign(documents[0].document,{items:[oldLine],restaurantOrderId:ticket.id});
  documents[0].v3ExpectedRetainedDocument={collection:'parkedTickets',id:ticket.id,expected:JSON.stringify(ticket)};
  await assert.rejects(f.adapter.saveDocumentsAtomically(documents),/RETAINED_TICKET_CHANGED/);assert.equal(await f.stock(),100);
 }finally{f.sql.close();}
});

test('public direct claim recovery/repark/cancel keeps one native CAS identity',async()=>{
  const f=fixture();try{
   const ticket={id:'waiting',items:[oldLine]};f.insert('parkedTickets',ticket);f.stage('N',102);await f.store.activateCatalogOnly('N',await f.transition());
   const db={getDocument:async(collection:string,id:string)=>{const row=f.sql.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(collection,id);return row?JSON.parse(String(row.data)):null;},
    get:async(collection:string)=>collection==='config'?{}:f.read(collection).map(value=>JSON.parse(value))};
   const session={binding:'binding',ready:{runtime:{version:{syncId:'N',syncVersion:102}}},assertCurrent:async()=>{
     assert.equal((await f.store.getOperationalOwner())?.syncId,'N');},projectConfig:async(value:any)=>value,validate:async()=>{}};
   Object.assign(globalThis,{__directClaim:{db,adapter:f.adapter,session}});
   const mocks:Record<string,string>={'../../utils/db':'export const db=globalThis.__directClaim.db;',
     '../db':'export const dbAdapter=globalThis.__directClaim.adapter;',
     './LargeMasterSyncV3OperationalSession':`export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__directClaim.session;export const v3InventoryBaselineKey=()=>${JSON.stringify(baseline)};`};
   const bundled=await build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3DirectTicketSource.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'claim-io',setup(b){
     b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
   const helper=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
   await helper.claimV3DirectTicket('waiting');
   assert.equal((await helper.readV3DirectWaitingTickets([ticket])).length,1);
   f.sql.exec("DELETE FROM documents WHERE collection_name='parkedTickets';");
   assert.equal((await helper.readV3DirectWaitingTickets([])).length,1);
   await helper.claimV3DirectTicket('waiting');assert.equal(f.read('v3RestoredTicketSources').length,1);
   await helper.updateV3DirectTicket('waiting',ticket);assert.equal(JSON.parse(f.read('v3RestoredTicketSources')[0]).state,'PARKED');
   await helper.claimV3DirectTicket('waiting');await helper.updateV3DirectTicket('waiting');
   assert.equal((await helper.readV3DirectWaitingTickets([ticket])).length,0);
   await assert.rejects(helper.claimV3DirectTicket('waiting'),/RETAINED_TICKET_CHANGED/);
   assert.equal(await f.stock(),100);
  }finally{f.sql.close();}
 });

test('native new tracked item with negative sales allowed still requires real stock-anchor coverage',async()=>{
 const f=fixture();try{f.stage('N',102);await f.store.activateCatalogOnly('N',await f.transition());
 const documents=financial('missing-covered-sale',1,102,'N');
 Object.assign(documents[0].document,{items:[{...oldLine,id:'NEW',allowNegativeStock:true,v3SaleAuthority:{...stamp,syncId:'N',syncVersion:102,inventorySyncId:'S',inventorySyncVersion:47}}]});
 documents[0].v3StockRequirements=[];
 await assert.rejects(f.adapter.saveDocumentsAtomically(documents),/INVENTORY_COVERAGE_REQUIRED/);
 assert.deepEqual(f.read('transactions'),[]);assert.equal(await f.stock(),100);
 }finally{f.sql.close();}
});

test('actual operational validation accepts saved old70/current85 and rejects loose or forged retained carts',async()=>{
  const f=fixture();try{
   f.stage('N',102);await f.store.activateCatalogOnly('N',await f.transition());
   const identity={tenantId:'tenant',terminalId:'terminal',deviceId:'device',syncToken:'token',erpSyncBaseUrl:'https://erp.test/api/sync'};
   const origin='https://download.test';const binding=JSON.stringify([identity.tenantId,identity.terminalId,identity.deviceId,identity.erpSyncBaseUrl,origin]);
   f.sql.prepare('UPDATE master_v3_operational_owner SET binding=?').run(binding);f.sql.prepare('UPDATE master_v3_catalog_owners SET binding=?').run(binding);
   const db={getDocument:async(collection:string,id:string)=>{const row=f.sql.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(collection,id);return row?JSON.parse(String(row.data)):null;}};
   Object.assign(globalThis,{__realSession:{db,adapter:f.adapter,identity}});
   const mocks:Record<string,string>={'../../utils/db':'export const db=globalThis.__realSession.db;','../db':'export const dbAdapter=globalThis.__realSession.adapter;',
     './LargeMasterSyncV3BoundTransport':`export const readLargeMasterSyncV3BoundIdentity=()=>({...globalThis.__realSession.identity});export const validatedLargeMasterSyncV3ErpSyncBase=value=>value;export const createLargeMasterSyncV3BoundClient=()=>{throw Error('not downloaded in validation');};`,
     './LargeMasterSyncV3Platform':'export const assertLargeMasterSyncV3NativeAndroid=()=>{};',
     './LargeMasterSyncV3DownloadOrigin':`export const largeMasterSyncV3DownloadOrigin=()=>${JSON.stringify(origin)};`};
   const bundled=await build({entryPoints:[new URL('../services/sync/LargeMasterSyncV3OperationalSession.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'session-io',setup(b){
    b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
   const helper=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
   const {LargeMasterSyncV3Runtime}=await import('../services/sync/LargeMasterSyncV3Runtime');
   const runtime=LargeMasterSyncV3Runtime.retained(f.store,{syncId:'N',syncVersion:102,contractVersion:2});
   const session=new helper.LargeMasterSyncV3OperationalSession({runtime,inventorySyncId:'S',inventorySyncVersion:47,inventoryVersion:4,inventoryCursor:'C'},binding,f.store,origin,identity);
   const catalog=await session.catalog('T','W');const current=await catalog.get('P');
   const previous=LargeMasterSyncV3Runtime.retained(f.store,{syncId:'S',syncVersion:47,contractVersion:2});
   const {LargeMasterSyncV3OperationalCatalog}=await import('../services/sync/LargeMasterSyncV3OperationalCatalog');
   const oldCatalog=await LargeMasterSyncV3OperationalCatalog.open({runtime:previous,inventorySyncId:'S',inventorySyncVersion:47,inventoryVersion:4,inventoryCursor:'C'},'T','W');
   const saved={...(await oldCatalog.get('P'))!.product,cartId:'old',quantity:1,v3SaleAuthority:{...(await oldCatalog.get('P'))!.authority,binding,warehouseId:'W'}};
   const added={...current.product,cartId:'new',quantity:1,v3SaleAuthority:{...current.authority,binding,warehouseId:'W'}};
   const ticket={id:'table-source',tableId:'12',items:[saved]};f.insert('parkedTickets',ticket);
   const config=await session.projectConfig({terminals:[],tariffs:[],taxes:[]});
   const context=await session.validate(config,[saved,added],'T','W','SALE',undefined,{ticketId:ticket.id,tableId:'12'});
   assert.equal(context.id,ticket.id);assert.equal(saved.price,70);assert.equal(added.price,85);
   await assert.rejects(session.validate(config,[saved,added],'T','W'),/CART_MIXED_VERSION/);
   await assert.rejects(session.validate(config,[{...saved,price:999},added],'T','W','SALE',undefined,{ticketId:ticket.id}),/RETAINED_LINE_CHANGED/);
  }finally{f.sql.close();}
 });

test('historical refund requires actual original transaction CAS and preserves its old price/source',async()=>{
 const f=fixture();try{
  const original={id:'original',items:[oldLine],type:'SALE'};f.insert('transactions',original);
  f.stage('N',102);await f.store.activateCatalogOnly('N',await f.transition());
  const documents=financial('refund',1,102,'N');
  Object.assign(documents[0].document,{type:'REFUND',originalTransactionId:'original',items:[{...oldLine,quantity:-1}]});
  documents[0].v3StockRequirements=[];
  Object.assign(documents[1].document,{qtyOut:0,qtyIn:1});
  await assert.rejects(f.adapter.saveDocumentsAtomically(documents),/RETAINED_SOURCE_REQUIRED/);
  documents[0].v3ExpectedRetainedDocument={collection:'transactions',id:'original',expected:JSON.stringify(original)};
  await f.adapter.saveDocumentsAtomically(documents);assert.equal(await f.stock(),101);
  assert.equal(JSON.parse(f.read('transactions').find(value=>JSON.parse(value).id==='refund')!).items[0].price,70);
  assert.deepEqual(JSON.parse(f.read('transactions').find(value=>JSON.parse(value).id==='original')!),original);
 }finally{f.sql.close();}
});
