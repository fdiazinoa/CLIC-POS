import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL, ensureLargeMasterSyncV3ContractColumns } from '../services/db/LargeMasterSyncV3Schema';
import { LargeMasterSyncV3SqliteStore } from '../services/db/LargeMasterSyncV3SqliteStore';
import { LargeMasterSyncV3Runtime } from '../services/sync/LargeMasterSyncV3Runtime';
import { LargeMasterSyncV3OperationalCatalog } from '../services/sync/LargeMasterSyncV3OperationalCatalog';
import { LargeMasterSyncV3KioskCatalog, V3KioskPaymentAttempt } from '../services/sync/LargeMasterSyncV3KioskCatalog';
import type { BusinessConfig, Transaction } from '../types';
import type { LargeMasterSyncV3OperationalSession } from '../services/sync/LargeMasterSyncV3OperationalSession';
import { validateV3PinnedLineSource } from '../services/sync/LargeMasterSyncV3LineSource';
import { prepareKioskProduction } from '../services/restaurant/KioskProductionPreflight';

async function nativeFixture() {
  const sql = new DatabaseSync(':memory:'); sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
  sql.exec("CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT); INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES('S',2,3,2,'ACTIVE','{}','now','now'); UPDATE master_v3_state SET active_sync_id='S',active_version=2; INSERT INTO master_v3_inventory_state VALUES(1,'S',2,4,'C','now');");
  await ensureLargeMasterSyncV3ContractColumns({ async query(query) { return { values: sql.prepare(query).all() as Record<string, unknown>[] }; }, async execute(query) { sql.exec(query); } });
  const tariff = {id:'T',active:true,taxIncluded:true};
  sql.prepare('INSERT INTO master_v3_tariffs VALUES(?,?,?,?,?,?,?)').run(2,'T','T','Tariff','DOP',1,JSON.stringify(tariff));
  const article = sql.prepare(`INSERT INTO master_v3_articles(sync_version,article_id,description,article_type,taxable,tax_ids_json,active,sellable,record_json,pos_category_key,pos_category_label,pos_category_id) VALUES(2,?,?,'PRODUCT',0,'[]',1,1,?,?,?,?)`);
  const price = sql.prepare('INSERT INTO master_v3_prices VALUES(?,?,?,?)');
  for (let i=0;i<95;i++) {
    const id=`P${String(i).padStart(3,'0')}`;
    const row={id,name:`Producto ${i}`,type:'PRODUCT',active:true,sellable:true,taxable:false,taxIds:[],category:i<30?'Otros':'Café',posCategoryId:i<30?'other':i%2?'café':undefined,activeWarehouseIds:['W'],operationalFlags:{trackInventory:true},images:[`https://images.example.test/${id}.jpg`],image_version:'v1',...(i===30?{modifiers:['unsupported']}: {})};
    article.run(id,row.name,JSON.stringify(row),i<30?'otros':'café',row.category,row.posCategoryId || '');
    price.run(2,id,'T',100+i);
    sql.prepare('INSERT INTO master_v3_inventory_balances VALUES(?,?,?,?,?,?)').run(id,'W',9,2,1,'now');
  }
  let readHook: (()=>void)|undefined;
  const calls: {query:string;size:number}[]=[];
  const bridge={async query(query:string, params:unknown[]=[]) { const values=sql.prepare(query).all(...params as any[]); calls.push({query,size:values.length});readHook?.(); return {values}; },async execute(){throw Error('No writes allowed');},async run(){throw Error('No writes allowed');}};
  const store=new LargeMasterSyncV3SqliteStore(()=>bridge,async()=>{throw Error('No writes allowed');});
  const runtime=LargeMasterSyncV3Runtime.retained(store,{syncId:'S',syncVersion:2,contractVersion:2});
  const ready={runtime,inventoryVersion:4,inventoryCursor:'C'};
  const identity={tenantId:'tenant',terminalId:'ERP',deviceId:'device',syncToken:'synthetic',erpSyncBaseUrl:'https://example.test/api/sync'};
  const proof={tenantId:'tenant',companyId:'company',terminalId:'ERP',deviceId:'device'};
  let context={terminalId:'local',config:{terminals:[{id:'local',config:{currentDeviceId:'device',erpTerminalId:'ERP',erpBinding:proof,pricing:{defaultTariffId:'T',allowedTariffIds:['T']},inventoryScope:{defaultSalesWarehouseId:'W',visibleWarehouseIds:['W']}}}],tariffs:[],taxes:[],posCategories:[]} as unknown as BusinessConfig};
  const session={async assertCurrent(){},async projectConfig(config:BusinessConfig){return {...config,tariffs:[tariff],taxes:[]};},async catalog(t:string,w:string){return LargeMasterSyncV3OperationalCatalog.open(ready,t,w);},async withStocks(rows:unknown[]){return rows;},async validate(){}} as unknown as LargeMasterSyncV3OperationalSession;
  return {sql,calls,ready,store,context,identity,proof,session,replaceContext:()=>{context={...context,terminalId:'different'};},hook:(fn?:()=>void)=>{readHook=fn;},open:()=>LargeMasterSyncV3KioskCatalog.open(()=>context,async()=>session,()=>identity,()=>proof)};
}

test('real SQLite native category identity/label filter precedes limit, reaches all 65 late rows and guards unsupported',async()=>{
  const f=await nativeFixture();try {
    const catalog=await f.open(); assert.equal(catalog.config.tariffs.length,1);assert.equal(f.context.config.tariffs.length,0);
    let cursor:string|null=null;const ids:string[]=[];const diagnostics:string[]=[];
    do {const page=await catalog.page('','Café',cursor);assert.ok(page.products.length<=30);ids.push(...page.products.map(row=>row.id));diagnostics.push(...page.diagnostics);cursor=page.nextCursor;}while(cursor);
    assert.equal(ids.length,64);assert.equal(new Set(ids).size,64);assert.ok(ids.includes('P094'));assert.ok(!ids.includes('P000'));assert.match(diagnostics.join(' '),/modificadores/);
    const last=await catalog.page('Producto 94','Todos',null);assert.equal(last.products[0].price,194);assert.equal(last.products[0].stock,6);assert.equal(last.products[0].v3SaleAuthority?.tariffId,'T');
    assert.deepEqual(last.products[0].images,['https://images.example.test/P094.jpg']);
    assert.equal(last.products[0].imageVersion,'v1');
    assert.ok(f.calls.every(call=>call.size<=30));
    const empty=await f.store.readAdministrativeCatalogPage(f.ready.runtime.version,{tariffId:'T',warehouseId:'W',inventoryVersion:4,inventoryCursor:'C',operationalCategoryKeys:[],limit:30});assert.equal(empty.rows.length,0);
  }finally{f.sql.close();}
});

test('native simple route reaches preflight and pinned source rejects tampering while advanced DTOs stay unavailable',async()=>{
 const f=await nativeFixture();try{
  f.sql.exec("UPDATE master_v3_articles SET record_json=json_set(record_json,'$.production_area_id','COCINA','$.product_type','SIMPLE','$.restaurant_unsupported',json('false')) WHERE article_id='P094'");
  const catalog=await f.open();const page=await catalog.page('Producto 94','Todos',null);const product=page.products[0];
  assert.equal(product.production_area_id,'COCINA');assert.equal(product.product_type,'SIMPLE');
  const line={...product,cartId:'line-route',quantity:1};
  const targets=prepareKioskProduction([line],[{id:'COCINA',name:'Cocina',modo_salida:'KDS',kds_host:'10.0.0.2'}],f.context.config,'local');
  assert.equal(targets[0].areaId,'COCINA');assert.equal(targets[0].kdsBaseUrl,'http://10.0.0.2:8001');
  validateV3PinnedLineSource(line,product,product.v3SaleAuthority!);
  assert.throws(()=>validateV3PinnedLineSource({...line,production_area_id:'OTHER'},product,product.v3SaleAuthority!),/ARTICLE_SOURCE_CHANGED/);
  for(const indicator of [true,null,'false']){
   f.sql.prepare("UPDATE master_v3_articles SET record_json=json_set(record_json,'$.restaurant_unsupported',json(?)) WHERE article_id='P094'").run(JSON.stringify(indicator));
   const blocked=await catalog.page('Producto 94','Todos',null);assert.deepEqual(blocked.products,[]);assert.match(blocked.diagnostics.join(' '),/restaurante/);
  }
 }finally{f.sql.close();}
});

test('native page rejects changed inventory/context/disposed readers and never falls back after SQL failure',async()=>{
  for(const failure of ['inventory','context','disposed','sql','auth','inplace']) {
    const f=await nativeFixture();try {const catalog=await f.open();
      if(failure==='inventory')f.sql.exec("UPDATE master_v3_inventory_state SET inventory_version=5");
      if(failure==='context')f.replaceContext();
      if(failure==='disposed')catalog.dispose();
      if(failure==='auth')f.identity.syncToken='revoked';
      if(failure==='inplace')f.context.config.terminals[0].config.pricing!.defaultTariffId='other';
      if(failure==='sql')f.hook(()=>{throw Error('SQL unavailable');});
      await assert.rejects(catalog.page('','Todos',null));
    }finally{f.sql.close();}
  }
});

test('selected terminal must match actual bound tenant/company/device, even when another session is valid',async()=>{
  for(const field of ['terminal','device','company','tenant']){
    const f=await nativeFixture();try {
      const terminal=f.context.config.terminals[0].config;
      if(field==='terminal')terminal.erpTerminalId='foreign';
      if(field==='device')terminal.currentDeviceId='foreign';
      if(field==='company')terminal.erpBinding={...terminal.erpBinding,companyId:'foreign'};
      if(field==='tenant')terminal.erpBinding={...terminal.erpBinding,tenantId:'foreign'};
      await assert.rejects(f.open(),/IDENTITY_REQUIRED/);
    }finally{f.sql.close();}
  }
});

test('cash attempt shares concurrent result, retains draft identity after commit failure, and cannot reassign a confirmed order',async()=>{
  const attempt=new V3KioskPaymentAttempt();let creates=0,commits=0,fail=true;
  const run=()=>attempt.run('same',async()=>{const tx=await attempt.transaction(async()=>({id:`TX-${++creates}`} as Transaction));commits++;await Promise.resolve();if(fail)throw Error('atomic failure');tx.displayId='COMMITTED-001';return tx;});
  await assert.rejects(Promise.all([run(),run()]),/atomic failure/);assert.equal(creates,1);assert.equal(commits,1);assert.equal(attempt.pending,true);
  await assert.rejects(attempt.run('changed',async()=>({id:'wrong'} as Transaction)),/mismo pedido/);
  fail=false;const [a,b]=await Promise.all([run(),run()]);assert.equal(a,b);assert.equal(a.id,'TX-1');assert.equal(a.displayId,'COMMITTED-001');assert.equal(creates,1);assert.equal(commits,2);
  await run();assert.equal(commits,2);
  await assert.rejects(attempt.run('changed',async()=>({id:'wrong'} as Transaction)),/ya está confirmado/);
  attempt.resetCompleted();await attempt.run('new-order',async()=>({id:'new'} as Transaction));
});

test('an entirely unsupported native page keeps the next cursor and diagnostics; tariff/warehouse revocation is closed',async()=>{
 const f=await nativeFixture();try{
   f.sql.exec(`UPDATE master_v3_articles SET record_json=json_set(record_json,'$.modifiers',json('["unsupported"]')) WHERE article_id<'P030'`);
   const catalog=await f.open();const page=await catalog.page('','Todos',null);
   assert.equal(page.products.length,0);assert.equal(page.diagnostics.length,30);assert.equal(page.nextCursor,'P029');
   assert.ok((await catalog.page('','Todos',page.nextCursor)).products.length>0);
 }finally{f.sql.close();}
 for(const mode of ['tariff','warehouse']){const f=await nativeFixture();try{
   if(mode==='tariff')f.context.config.terminals[0].config.pricing!.allowedTariffIds=[];
   else f.context.config.terminals[0].config.inventoryScope!.visibleWarehouseIds=[];
   await assert.rejects(f.open(),/UNAVAILABLE/);
 }finally{f.sql.close();}}
});

test('opening pins context before the first await and rejects in-place revocations while session preparation waits',async()=>{
 const mutations: Array<(context: Awaited<ReturnType<typeof nativeFixture>>['context'])=>void>=[
  context=>{context.config.terminals[0].config.pricing!.defaultTariffId='REVOKED';},
  context=>{context.config.terminals[0].config.pricing!.allowedTariffIds=[];},
  context=>{context.config.terminals[0].config.inventoryScope!.defaultSalesWarehouseId='OTHER';},
  context=>{context.config.terminals[0].config.inventoryScope!.visibleWarehouseIds=[];},
  context=>{context.config.terminals[0].config.currentDeviceId='OTHER';},
  context=>{context.config.terminals[0].config.erpBinding={...context.config.terminals[0].config.erpBinding,companyId:'OTHER'};},
  context=>{context.config.terminals[0].config.catalog={allowedCategories:['OTHER']};},
  context=>{context.terminalId='OTHER';},
 ];
 for(const mutate of mutations){const f=await nativeFixture();try{
  let resume!:()=>void;const gate=new Promise<void>(resolve=>{resume=resolve;});
  const pending=LargeMasterSyncV3KioskCatalog.open(()=>f.context,async()=>{await gate;return f.session;},()=>f.identity,()=>f.proof);
  mutate(f.context);resume();
  await assert.rejects(pending,/CONTEXT_CHANGED/);
 }finally{f.sql.close();}}
});
