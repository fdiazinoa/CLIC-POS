import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL, ensureLargeMasterSyncV3ContractColumns,
  backfillLargeMasterSyncV3Categories, V3_CATEGORY_BACKFILL_BATCH_SIZE } from '../services/db/LargeMasterSyncV3Schema';
import { LargeMasterSyncV3SqliteStore } from '../services/db/LargeMasterSyncV3SqliteStore';
import { normalizeV3CategoryKey, resolveV3CategoryAliases } from '../services/sync/LargeMasterSyncV3Categories';

const version = { syncId: 'active', syncVersion: 2, contractVersion: 2 };
function fixture() {
  const db = new DatabaseSync(':memory:');
  // Simulate the exact pre-upgrade shape, including an active and retained rollback snapshot.
  db.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL.replace('  pos_category_key TEXT,\n  pos_category_label TEXT,\n', ''));
  db.exec(`CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT);
    INSERT INTO documents VALUES('inventoryLedger','pending','{"qtyOut":1,"v3InventoryBaseline":"unchanged"}');
    INSERT INTO sync_v3_sessions VALUES('active',2,3,2,'ACTIVE','{}','old','old',NULL,NULL);
    INSERT INTO sync_v3_sessions VALUES('previous',1,3,2,'ROLLED_BACK','{}','old','old',NULL,NULL);
    UPDATE master_v3_state SET active_version=2,active_sync_id='active',previous_version=1,previous_sync_id='previous';
    INSERT INTO master_v3_operational_owner VALUES(1,'active',2,'binding');
    INSERT INTO master_v3_inventory_state VALUES(1,'active',2,7,'cursor','old');
    INSERT INTO master_v3_inventory_balances VALUES('A0000','W',10,1,2,'old');
    INSERT INTO master_v3_tariffs VALUES(2,'T','T','Tariff','DOP',1,'{"id":"T","active":true,"taxIncluded":true}');
    INSERT INTO master_v3_tariffs VALUES(2,'OTHER','OTHER','Other','DOP',1,'{"id":"OTHER","active":true,"taxIncluded":true}');`);
  const categories = ['Bebidas','Carnes','Hamburguesas','CAFÉ','Extras'];
  const insert = db.prepare(`INSERT INTO master_v3_articles(sync_version,article_id,sku,description,taxable,tax_ids_json,
    category_id,active,sellable,record_json) VALUES(?,?,?,?,0,'[]',?,?,?,?)`);
  db.exec('BEGIN');
  for (let i = 0; i < 625; i++) {
    const category = categories[Math.floor(i / 125)];
    const id = `A${String(i).padStart(4, '0')}`;
    insert.run(2,id,id,`Product ${i}`,'raw-classification-uuid',i===500?0:1,i===501?0:1,
      JSON.stringify({ id, name:`Product ${i}`, category, active:i!==500,sellable:i!==501 }));
    db.prepare('INSERT INTO master_v3_prices VALUES(2,?,?,10)').run(id,i===502?'OTHER':'T');
  }
  insert.run(2,'alias-id','alias','Alias',null,1,1,JSON.stringify({id:'alias-id',category:' configured-ID '}));
  insert.run(2,'alias-code','alias','Alias',null,1,1,JSON.stringify({id:'alias-code',category:'CF'}));
  for(const id of ['alias-id','alias-code']) db.prepare('INSERT INTO master_v3_prices VALUES(2,?,?,10)').run(id,'T');
  insert.run(1,'previous-article','old','Old',null,1,1,JSON.stringify({id:'previous-article',category:'CAFÉ'}));
  insert.run(2,'malformed','bad','Bad',null,1,1,'not json');
  insert.run(2,'missing','none','None',null,1,1,null);
  db.exec('COMMIT');
  const queries: Array<{sql:string;params:unknown[];count:number}> = [];
  let updateCount = 0; let failAt = Infinity;
  const bridge = {
    async query(sql:string, params:unknown[] = []) {
      const values = db.prepare(sql).all(...params as any[]) as Array<Record<string,unknown>>;
      queries.push({sql,params,count:values.length});return {values};
    },
    async execute(sql:string) { db.exec(sql); },
    async run(sql:string, params:unknown[] = []) {
      if (sql.startsWith('UPDATE master_v3_articles') && ++updateCount === failAt) throw Error('injected migration interruption');
      db.prepare(sql).run(...params as any[]);
    },
  };
  const store = new LargeMasterSyncV3SqliteStore(()=>bridge,async operation=>operation());
  return {db,bridge,store,queries,failAfter:(count:number)=>{failAt=updateCount+count;}};
}
const protectedData = (db:DatabaseSync) => Object.fromEntries(['master_v3_state','master_v3_operational_owner',
  'master_v3_inventory_state','master_v3_inventory_balances','sync_v3_sessions','documents']
  .map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]));

test('additive upgrade resumes after partial batches, preserves records/financial baseline/pointers and every retained version',async()=>{
  const f=fixture();try {
    const before=protectedData(f.db);
    const records=f.db.prepare('SELECT sync_version,article_id,record_json,category_id FROM master_v3_articles ORDER BY sync_version,article_id').all();
    await ensureLargeMasterSyncV3ContractColumns(f.bridge);
    f.failAfter(260);
    await assert.rejects(backfillLargeMasterSyncV3Categories(f.bridge),/injected/);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM master_v3_articles WHERE pos_category_key IS NOT NULL').get() as any).n,250);
    assert.deepEqual(protectedData(f.db),before);
    await backfillLargeMasterSyncV3Categories(f.bridge); // restart/retry, no resync
    await ensureLargeMasterSyncV3ContractColumns(f.bridge);
    await backfillLargeMasterSyncV3Categories(f.bridge); // idempotent
    assert.deepEqual(protectedData(f.db),before);
    assert.deepEqual(f.db.prepare('SELECT sync_version,article_id,record_json,category_id FROM master_v3_articles ORDER BY sync_version,article_id').all(),records);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM master_v3_articles WHERE pos_category_key IS NULL').get() as any).n,0);
    assert.equal((f.db.prepare("SELECT pos_category_key FROM master_v3_articles WHERE sync_version=1").get() as any).pos_category_key,'café');
    assert.ok(f.queries.filter(row=>row.sql.includes('WHERE pos_category_key IS NULL')).every(row=>row.count<=V3_CATEGORY_BACKFILL_BATCH_SIZE));
    await assert.rejects(f.store.searchOperationalArticles(version,'Bad'),/SYNC_V3_OPERATIONAL_RECORD_INVALID/);
    assert.equal((f.db.prepare("SELECT pos_category_key FROM master_v3_articles WHERE article_id='malformed'").get() as any).pos_category_key,'');
    const admin=await f.store.readAdministrativeCatalogPage(version,{tariffId:'T',warehouseId:'W',inventoryVersion:7,inventoryCursor:'cursor',category:'NONE',limit:100});
    assert.equal(admin.filteredTotal,4); // aliases + malformed + missing, raw category_id only
  }finally{f.db.close();}
});

test('indexed effective category selects Café and configured aliases beyond first60; fullsnapshot metadata stays stable',async()=>{
  const f=fixture();try {
    await ensureLargeMasterSyncV3ContractColumns(f.bridge); await backfillLargeMasterSyncV3Categories(f.bridge);
    const metadata=await f.store.getOperationalCategories(version,'T');
    assert.deepEqual(metadata.map(row=>row.key),['bebidas','café','carnes','cf','configured-id','extras','hamburguesas']);
    const first=await f.store.searchOperationalArticles(version,'',null,60);
    assert.equal(first.length,60);assert.ok(first.every(row=>row.category==='Bebidas'));
    const cafe=await f.store.searchOperationalArticles(version,'',' CAFÉ ',500);
    assert.equal(cafe.length,100);assert.ok(cafe.every(row=>row.category==='CAFÉ'));
    const query=f.queries[f.queries.length-1];
    const plan=f.db.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.params as any[]) as Array<{detail:string}>;
    assert.ok(plan.some(row=>/SEARCH.*idx_master_v3_articles_pos_category.*sync_version=.*pos_category_key=/.test(row.detail)),JSON.stringify(plan));
    const aliases=new Map([['configured-id','café'],['cf','café'],['café','café']]);
    const equivalent=resolveV3CategoryAliases('CAFÉ',aliases);
    const selected=await f.store.searchOperationalArticles(version,'Alias',equivalent,100);
    assert.ok(selected.some(row=>row.id==='alias-id'));assert.ok(selected.some(row=>row.id==='alias-code'));
    assert.deepEqual(await f.store.searchOperationalArticles(version,'missing text',equivalent,60),[]);
    assert.deepEqual(await f.store.getOperationalCategories(version,'T'),metadata);
    const extras=await f.store.searchOperationalArticles(version,'','Extras',100);
    assert.ok(extras.every(row=>row.active!==false&&row.sellable!==false));
    assert.ok(!extras.some(row=>['A0500','A0501'].includes(String(row.id))));
    assert.equal((await f.store.getOperationalCategories(version,'OTHER')).length,1);
    assert.deepEqual(await f.store.getOperationalCategories(version,'ABSENT'),[]);
    assert.equal(normalizeV3CategoryKey(' CAFÉ '),'café');assert.notEqual(normalizeV3CategoryKey('Cafe'),'café');
  }finally{f.db.close();}
});

test('older WebView without Array.at reads administrative pages forward/back and renders Articles',async()=>{
  const f=fixture();const at=Object.getOwnPropertyDescriptor(Array.prototype,'at');
  try {
    await ensureLargeMasterSyncV3ContractColumns(f.bridge); await backfillLargeMasterSyncV3Categories(f.bridge);
    Object.defineProperty(Array.prototype,'at',{...at,value:undefined});
    const request={tariffId:'T',warehouseId:'W',inventoryVersion:7,inventoryCursor:'cursor',limit:25};
    const first=await f.store.readAdministrativeCatalogPage(version,request);
    assert.equal(first.rows.length,25);assert.ok(first.nextCursor);
    const second=await f.store.readAdministrativeCatalogPage(version,{...request,afterId:first.nextCursor});
    assert.ok(second.rows[0].id>first.rows[24].id);
    assert.deepEqual(await f.store.readAdministrativeCatalogPage(version,request),first);
    const React=await import('react'); const {renderToStaticMarkup}=await import('react-dom/server');
    const {default:Manager}=await import('../components/LargeMasterSyncV3CatalogManager');
    assert.match(renderToStaticMarkup(React.createElement(Manager,{config:{terminals:[]} as any,warehouses:[],onClose:()=>{}})),/Productos V3/);
    // SSR does not run effects; source assertion complements the real browser effect test.
    assert.doesNotMatch(readFileSync(new URL('../components/LargeMasterSyncV3CatalogManager.tsx',import.meta.url),'utf8'),/\.at\(/);
  }finally{if(at)Object.defineProperty(Array.prototype,'at',at);f.db.close();}
});
