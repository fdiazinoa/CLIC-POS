import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL } from '../services/db/LargeMasterSyncV3Schema';
import { LargeMasterSyncV3SqliteStore } from '../services/db/LargeMasterSyncV3SqliteStore';
import { LargeMasterSyncV3CatalogRead, useV3CatalogBrowser } from '../services/sync/LargeMasterSyncV3CatalogRead';
import { v3BindingKey, v3InventoryBaselineKey } from '../services/sync/LargeMasterSyncV3OperationalSession';
import { createV3CatalogView } from '../services/sync/LargeMasterSyncV3CatalogView';
import CatalogManager, { V3CatalogPageView } from '../components/LargeMasterSyncV3CatalogManager';
import type { BusinessConfig, Warehouse } from '../types';

const version = { syncId: 'S', syncVersion: 2, contractVersion: 2 };
const identity = { tenantId: 'tenant', terminalId: 'erp-terminal', deviceId: 'device',
  syncToken: 'bound-token', erpSyncBaseUrl: 'https://erp.example.test/api/sync' };
const origin = 'https://railway.example.test';
function fixture(size = 260) {
  const sql = new DatabaseSync(':memory:'); sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
  sql.exec("CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT);");
  const binding = v3BindingKey(identity, origin);
  sql.exec("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES('S',2,3,2,'ACTIVE','{}','now','now'); UPDATE master_v3_state SET active_sync_id='S',active_version=2;");
  sql.prepare('INSERT INTO master_v3_operational_owner VALUES(1,?,?,?)').run('S',2,binding);
  sql.exec("INSERT INTO master_v3_inventory_state VALUES(1,'S',2,4,'C','now');");
  sql.prepare('INSERT INTO master_v3_tariffs VALUES(?,?,?,?,?,?,?)').run(2,'T','T','Tariff','DOP',1,JSON.stringify({id:'T',taxIncluded:true}));
  sql.prepare('INSERT INTO master_v3_tariffs VALUES(?,?,?,?,?,?,?)').run(2,'OTHER','OTHER','Other','DOP',1,JSON.stringify({id:'OTHER',taxIncluded:false}));
  const insert = sql.prepare('INSERT INTO master_v3_articles(sync_version,article_id,sku,description,article_type,taxable,tax_ids_json,category_id,active,sellable,record_json) VALUES(?,?,?,?,?,0,?,?,?,?,?)');
  sql.exec('BEGIN');
  for(let i=0;i<size;i++) insert.run(2,`P${String(i).padStart(6,'0')}`,`REF${i}`,i===0?'Literal %_ product':`Product ${i}`,
    i===0?'KIT':'PRODUCT','[]',i%3===0?null:i%3===1?'':'ERP-category',i===0?0:1,i===0?0:1,'invalid JSON deliberately');
  sql.exec('COMMIT');
  insert.run(1,'P000001','OLD','Old version','PRODUCT','[]',null,1,1,'{}');
  sql.prepare('INSERT INTO master_v3_prices(sync_version,article_id,tariff_id,price) VALUES(?,?,?,?)').run(2,'P000000','T',0);
  sql.prepare('INSERT INTO master_v3_prices(sync_version,article_id,tariff_id,price) VALUES(?,?,?,?)').run(2,'P000001','OTHER',999);
  sql.exec("INSERT INTO master_v3_barcodes(sync_version,barcode,article_id) VALUES(2,'CODE-unique','P000000'),(2,'CODE-second','P000000'),(1,'OLD-code','P000001');");
  sql.prepare('INSERT INTO master_v3_inventory_balances VALUES(?,?,?,?,?,?)').run('P000000','W',3,2,1,'now');
  sql.prepare('INSERT INTO master_v3_inventory_balances VALUES(?,?,?,?,?,?)').run('P000001','OTHER',999,0,0,'now');
  const baseline=v3InventoryBaselineKey(binding,{...version,tariffId:'T',taxIncluded:true,inventoryVersion:4,inventoryCursor:'C'});
  for(const [id,base,warehouse,qty] of [['good',baseline,'W',2],['old','old','W',99],['other',baseline,'OTHER',99]] as const)
    sql.prepare('INSERT INTO documents VALUES(?,?,?)').run('inventoryLedger',id,JSON.stringify({productId:'P000000',warehouseId:warehouse,v3InventoryBaseline:base,qtyIn:qty,qtyOut:0}));
  const queries: {sql:string;params:unknown[];length:number}[]=[]; let writes=0; let hook: (()=>void)|undefined;
  const bridge = {query:async(query:string,params:unknown[]=[])=>{ const values=sql.prepare(query).all(...params as any[]);
    queries.push({sql:query,params,length:values.length}); hook?.(); return {values}; },
    execute:async()=>{writes++;throw Error('write forbidden');},run:async()=>{writes++;throw Error('write forbidden');}};
  const store=new LargeMasterSyncV3SqliteStore(()=>bridge,async()=>{writes++;throw Error('write lock forbidden');});
  let currentIdentity={...identity};
  const context={config:{terminals:[{id:'local',config:{erpTerminalId:'erp-terminal',currentDeviceId:'device',
    pricing:{defaultTariffId:'T'},inventoryScope:{defaultSalesWarehouseId:'W'}}}],tariffs:[]} as unknown as BusinessConfig,
    terminalId:'local',warehouses:[{id:'W',name:'Warehouse'}] as Warehouse[]};
  const deps={enabled:true,store,readIdentity:()=>currentIdentity,downloadOrigin:()=>origin};
  const request={tariffId:'T',warehouseId:'W',inventoryVersion:4,inventoryCursor:'C'};
  return {sql,store,queries,context,deps,request,writes:()=>writes,setIdentity:()=>{currentIdentity={...identity,deviceId:'other'};},
    hook:(callback?:()=>void)=>{hook=callback;}};
}

test('real SQLite keyset pages all 260 including inactive/unpriced/advanced; bridge never returns 101',async()=>{
  const f=fixture();try {let afterId:string|null=null;const ids:string[]=[];
    do {const start=f.queries.length;const page=await f.store.readAdministrativeCatalogPage(version,{...f.request,afterId,limit:100});
      assert.equal(page.total,260);assert.equal(page.filteredTotal,260);assert.equal(f.queries.length-start,4);
      ids.push(...page.rows.map(row=>row.id));afterId=page.nextCursor;
      if(ids.length===100){assert.equal(page.rows[0].active,false);assert.equal(page.rows[0].sellable,false);
        assert.equal(page.rows[0].type,'KIT');assert.equal(page.rows[0].price,0);assert.equal(page.rows[0].balance,0);
        assert.equal(page.rows[1].price,null);assert.equal(page.rows[1].balance,null);}
    }while(afterId);
    assert.equal(new Set(ids).size,260);assert.equal(ids.length,260);
    assert.ok(f.queries.every(row=>row.length<=100));assert.equal(f.writes(),0);
  }finally{f.sql.close();}
});
test('literal searches and scoped barcode EXISTS share filtered count, NONE includes null/empty and no duplicate',async()=>{
  const f=fixture();try {
    for(const query of ['%_','CODE-','REF0']){const page=await f.store.readAdministrativeCatalogPage(version,{...f.request,query});
      assert.equal(page.filteredTotal,1);assert.equal(page.rows.length,1);assert.equal(page.rows[0].id,'P000000');}
    for(const query of ["' OR 1=1 --",'OLD-code']){const page=await f.store.readAdministrativeCatalogPage(version,{...f.request,query});assert.equal(page.filteredTotal,0);}
    const none=await f.store.readAdministrativeCatalogPage(version,{...f.request,category:'NONE',limit:100});
    assert.equal(none.filteredTotal,174);assert.ok(none.rows.every(row=>!row.categoryId?.trim()));
    await assert.rejects(f.store.readAdministrativeCatalogPage(version,{...f.request,tariffId:'missing'}),{code:'SYNC_V3_TARIFF_UNAVAILABLE'});
  }finally{f.sql.close();}
});
test('53000 native rows still return only 100 through four SELECTs, with SQL runtime counts',async()=>{
  const f=fixture(53000);try {const page=await f.store.readAdministrativeCatalogPage(version,{...f.request,limit:500});
    assert.equal(page.total,53000);assert.equal(page.rows.length,100);assert.equal(f.queries.length,4);
    assert.ok(f.queries.every(row=>row.length<=100));assert.equal(f.writes(),0);
  }finally{f.sql.close();}
});
test('cached reader validates native tariff even with empty legacy tariffs; batches exact-baseline delta and fences owner',async()=>{
  const f=fixture();try {const reader=await LargeMasterSyncV3CatalogRead.open(()=>f.context,f.deps);assert.equal(f.queries.length,6);
    const start=f.queries.length;const page=await reader.page({limit:25});assert.equal(f.queries.length-start,11);
    assert.equal(page.rows[0].balance,2);assert.equal(page.rows[1].balance,null);assert.equal(f.writes(),0);
    const emptyStart=f.queries.length;assert.equal((await reader.page({query:'absent'})).rows.length,0);
    assert.equal(f.queries.length-emptyStart,9);
    f.sql.exec("UPDATE master_v3_operational_owner SET binding='foreign'");
    await assert.rejects(reader.page({}),{code:'SYNC_V3_CATALOG_VERSION_CHANGED'});
  }finally{f.sql.close();}
});
test('native tariff active exact-version boolean required, no substitute; true and false preserve baseline',async()=>{
  for(const taxIncluded of [true,false]) {const f=fixture();try {
    f.sql.prepare('UPDATE master_v3_tariffs SET record_json=? WHERE tariff_id=?').run(JSON.stringify({id:'T',taxIncluded}),'T');
    const reader=await LargeMasterSyncV3CatalogRead.open(()=>f.context,f.deps);await reader.page({});
    const delta=f.queries.find(row=>row.sql.includes("collection_name = 'inventoryLedger'"));
    assert.equal(delta?.params[0],v3InventoryBaselineKey(v3BindingKey(identity,origin),{...version,tariffId:'T',taxIncluded,inventoryVersion:4,inventoryCursor:'C'}));
  }finally{f.sql.close();}}
  for(const mutation of ["UPDATE master_v3_tariffs SET active=0 WHERE tariff_id='T'",
    "DELETE FROM master_v3_tariffs WHERE tariff_id='T'", "UPDATE master_v3_tariffs SET record_json='{\"taxIncluded\":\"false\"}' WHERE tariff_id='T'"]) {
    const f=fixture();try {if(mutation.startsWith('DELETE'))f.sql.exec("DELETE FROM master_v3_prices WHERE tariff_id='T'");
      f.sql.exec(mutation);await assert.rejects(LargeMasterSyncV3CatalogRead.open(()=>f.context,f.deps),{code:'SYNC_V3_TARIFF_UNAVAILABLE'});
      assert.equal(f.writes(),0);
    }finally{f.sql.close();}
  }
});
test('identity/config/inventory changes during native read reject before publishing; OFF does zero reads',async()=>{
  const f=fixture();try {
    await assert.rejects(LargeMasterSyncV3CatalogRead.open(()=>f.context,{...f.deps,enabled:false}),{code:'SYNC_V3_CANDIDATE_DISABLED'});
    assert.equal(f.queries.length,0);
    const reader=await LargeMasterSyncV3CatalogRead.open(()=>f.context,f.deps);
    f.hook(()=>{if(f.queries.at(-1)?.sql.includes('SELECT a.article_id AS id')){f.hook();f.sql.exec("UPDATE master_v3_inventory_state SET cursor='new'");}});
    await assert.rejects(reader.page({}),{code:'SYNC_V3_CATALOG_VERSION_CHANGED'});
    f.sql.exec("UPDATE master_v3_inventory_state SET cursor='C'");f.context.config.terminals[0].config.pricing!.defaultTariffId='different';
    await assert.rejects(reader.page({}),{code:'SYNC_V3_CATALOG_CONTEXT_CHANGED'});
    f.context.config.terminals[0].config.pricing!.defaultTariffId='T';f.setIdentity();
    await assert.rejects(reader.page({}));assert.equal(f.writes(),0);
  }finally{f.sql.close();}
});
test('missing cached context/runtime and native SQL error are errors, runtime rollover is fenced',async()=>{
  for(const mode of ['context','runtime','rollover','sql']) {const f=fixture();try {
    if(mode==='context'){f.context.terminalId='missing';await assert.rejects(LargeMasterSyncV3CatalogRead.open(()=>f.context,f.deps),{code:'SYNC_V3_CATALOG_CONTEXT_REQUIRED'});continue;}
    if(mode==='runtime'){f.sql.exec('UPDATE master_v3_state SET active_sync_id=NULL,active_version=NULL');
      await assert.rejects(LargeMasterSyncV3CatalogRead.open(()=>f.context,f.deps),{code:'SYNC_V3_CATALOG_NOT_READY'});continue;}
    const reader=await LargeMasterSyncV3CatalogRead.open(()=>f.context,f.deps);
    f.hook(()=>{if(f.queries.at(-1)?.sql.includes('SELECT a.article_id AS id')) {f.hook();
      if(mode==='sql')throw Error('injected readonly SQL failure');
      f.sql.exec('UPDATE master_v3_state SET active_version=3');}});
    const view=createV3CatalogView();await view.load(()=>reader.page({}));
    assert.equal(view.getSnapshot().status,'error');assert.equal(view.getSnapshot().page,undefined);
    assert.equal(f.writes(),0);
  }finally{f.sql.close();}}
});
test('real view and rendered component distinguish loading/error/zero/filtered/unknown, fence stale and unsubscribe',async()=>{
  const f=fixture();try {const page=await f.store.readAdministrativeCatalogPage(version,{...f.request});
    const render=(state:any)=>renderToStaticMarkup(<V3CatalogPageView state={state}/>);
    assert.match(render({status:'loading'}),/role="status"/);assert.match(render({status:'error',error:'disk'}),/role="alert"/);
    assert.doesNotMatch(render({status:'error',error:'disk'}),/Todos \(0\)/);
    assert.match(render({status:'ready',page}),/Sin precio/);assert.match(render({status:'ready',page}),/Desconocido/);
    assert.match(render({status:'ready',page:{...page,total:0,rows:[]}}),/está vacío/);
    assert.match(render({status:'ready',page:{...page,filteredTotal:0,rows:[]}}),/Sin resultados/);
    const view=createV3CatalogView();let release!:(value:typeof page)=>void;
    const old=view.load(()=>new Promise(resolve=>{release=resolve;}));view.cancel();
    await view.load(async()=>({...page,rows:[]}));release(page);await old;assert.equal(view.getSnapshot().page?.rows.length,0);
    let callbacks=0;let stopB=()=>{};const stopA=view.subscribe(()=>stopB());stopB=view.subscribe(()=>callbacks++);
    view.cancel();assert.equal(callbacks,0);stopA();
    const markup=renderToStaticMarkup(<CatalogManager {...f.context} onClose={()=>{}}/>);
    assert.match(markup,/Sólo lectura/);assert.doesNotMatch(markup,/Editar|Eliminar|Guardar|Importar/);
    assert.equal(useV3CatalogBrowser(false,'ERP_ACTIVE'),false);
    for(const kind of ['LAN','LOCAL','ERP_CLIENT','UNBOUND'])assert.equal(useV3CatalogBrowser(true,kind),false);
    assert.equal(useV3CatalogBrowser(true,'ERP_ACTIVE'),true);
  }finally{f.sql.close();}
});
