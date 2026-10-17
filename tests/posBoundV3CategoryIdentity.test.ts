import test from 'node:test';
import type { ClassificationItem } from '../types';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL, ensureLargeMasterSyncV3ContractColumns, backfillLargeMasterSyncV3Categories } from '../services/db/LargeMasterSyncV3Schema';
import { LargeMasterSyncV3SqliteStore } from '../services/db/LargeMasterSyncV3SqliteStore';
import { buildPosCategoryIdentity, reconcileBoundV3PosCategories } from '../utils/posCategoryIdentity';

const id = '58b57216-a283-42d0-8da7-de60560a5d0b';
const synthetic = [{ id: 'Bebidas', name: 'Bebidas', code: 'BEB', color: '#123456', isActive: true }];
const native = [{ key: id, label: 'Bebidas' }];
const identity = (categories = synthetic, metadata = native) => buildPosCategoryIdentity(reconcileBoundV3PosCategories(categories, metadata));

test('bound native identity reconciles only synthetic setup metadata without mutating it', () => {
  const before = JSON.stringify({ synthetic, native });
  const result = reconcileBoundV3PosCategories(synthetic, native);
  assert.deepEqual(result, [{ ...synthetic[0], id }]);
  const lookup = identity();
  const allowed = new Set([lookup.canonicalize('Bebidas')]);
  assert.deepEqual([...allowed], [id]);
  for (const sku of ['396', '182', 'BEB-003']) {
    const article = { sku, posCategoryId: id, category: 'Bebidas', price: 85, taxIds: ['ITBIS18', 'SERVICE10'], stock: -3 };
    assert.equal(lookup.isProductAllowed(article, allowed), true);
    assert.equal(lookup.isProductAllowed({ ...article, posCategoryId: 'foreign' }, allowed), false);
  }
  assert.deepEqual(lookup.selectionFilter('Bebidas'), { ids: [id], aliases: [id, 'beb', 'bebidas'] });
  assert.equal(JSON.stringify({ synthetic, native }), before);
});

test('missing, ambiguous, contradictory and out-of-scope metadata never grant the native ID', () => {
  for (const metadata of [[], [{ key: 'foreign', label: 'Postres' }],
    [...native, { key: 'foreign', label: 'Bebidas' }],
    [...native, { key: id, label: 'Postres' }], [{ key: '', label: 'Bebidas' }]]) {
    const lookup = identity(synthetic, metadata);
    assert.equal(lookup.isProductAllowed({ posCategoryId: id, category: 'Bebidas' }, new Set([lookup.canonicalize('Bebidas')])), false);
  }
  assert.equal(identity(synthetic, [...native, ...native]).canonicalize('Bebidas'), id);
  // Each reopen derives solely from that session's metadata; it cannot retain the prior binding.
  assert.equal(identity(synthetic, [{ key: 'other-company-id', label: 'Bebidas' }]).canonicalize('Bebidas'), 'other-company-id');
  assert.equal(identity(synthetic, []).canonicalize('Bebidas'), 'bebidas');
});

test('configured real identities and contradictory aliases remain authoritative regardless of ordering', () => {
  const real = { ...synthetic[0], id: 'configured-real-id' };
  assert.deepEqual(reconcileBoundV3PosCategories([real], native), [real]);
  for (const other of [{ ...real, name: 'Another', code: 'OTHER', id },
    { ...real, code: 'OTHER' }, { ...real, name: 'Other' }, { ...synthetic[0] }]) {
    for (const categories of [[synthetic[0], other], [other, synthetic[0]]]) {
      assert.deepEqual(reconcileBoundV3PosCategories(categories, native), categories);
    }
  }
  const renamed = { ...real, id, name: 'Bebidas nuevas' };
  const lookup = buildPosCategoryIdentity(reconcileBoundV3PosCategories([renamed], native));
  assert.equal(lookup.canonicalize('Bebidas nuevas'), id);
  assert.equal(lookup.isProductAllowed({ posCategoryId: id, category: 'Bebidas' }, new Set([id])), true);
  assert.equal(identity().isProductAllowed({ posCategoryId: id, category: 'Bebidas' }, new Set(['postres'])), false);
});

test('reconciled selection drives native SQL by UUID and preserves financial/stock records', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
    db.exec(`INSERT INTO master_v3_tariffs VALUES(315,'tariff','T','Tariff','DOP',1,'{"id":"tariff","active":true}');
      INSERT INTO master_v3_tariffs VALUES(315,'other','OTHER','Other','DOP',1,'{"id":"other","active":true}');`);
    const insert=db.prepare(`INSERT INTO master_v3_articles(sync_version,article_id,sku,description,taxable,tax_ids_json,category_id,active,sellable,record_json) VALUES(315,?,?,?,1,?, ?,1,1,?)`);
    const prices:Record<string,number>={'182':275,'183':150,'184':140,'395':260,'396':210,'397':110,'BEB-003':85,foreign:85};
    for (const [sku,price] of Object.entries(prices)) {
      const record={id:sku,sku,name:'Agua',category:'Bebidas',posCategoryId:sku==='foreign'?'foreign-category':id,price,taxIds:['ITBIS18','SERVICE10'],stock:-3};
      insert.run(sku,sku,'Agua',JSON.stringify(record.taxIds),record.posCategoryId,JSON.stringify(record));
      db.prepare('INSERT INTO master_v3_prices VALUES(315,?,?,?)').run(sku,sku==='foreign'?'other':'tariff',price);
      db.prepare("INSERT INTO master_v3_inventory_balances VALUES(?, 'warehouse',-3,0,0,'unchanged')").run(sku);
    }
    const bridge={
      async query(sql:string,params:unknown[]=[]){return {values:db.prepare(sql).all(...params as any[])};},
      async execute(sql:string){db.exec(sql);},
      async run(sql:string,params:unknown[]=[]){db.prepare(sql).run(...params as any[]);},
    };
    const store=new LargeMasterSyncV3SqliteStore(()=>bridge,async operation=>operation());
    await ensureLargeMasterSyncV3ContractColumns(bridge);
    await backfillLargeMasterSyncV3Categories(bridge);
    const before=JSON.stringify(['master_v3_articles','master_v3_prices','master_v3_inventory_balances'].map(table=>db.prepare(`SELECT * FROM ${table}`).all()));
    const version={syncId:'active',syncVersion:315,contractVersion:2};
    const metadata=await store.getOperationalCategories(version,'tariff');
    assert.deepEqual(metadata.map(category=>[category.key,category.label]),[[id,'Bebidas']]);
    const lookup=identity(synthetic,metadata);
    const withoutSetupMasters = buildPosCategoryIdentity(reconcileBoundV3PosCategories([], metadata));
    const missingMasterRows = await store.searchOperationalArticles(version, 'BEB-003', withoutSetupMasters.selectionFilter('Bebidas'), 60);
    assert.deepEqual(missingMasterRows.map(row => row.sku), ['BEB-003']);
    assert.equal(withoutSetupMasters.isProductAllowed(missingMasterRows[0] as { posCategoryId?: string; category?: string }, new Set([withoutSetupMasters.canonicalize('Bebidas')])), true);
    const filter=lookup.selectionFilter('Bebidas');
    const rows=await store.searchOperationalArticles(version,'Agua',filter,60);
    assert.deepEqual(rows.map(row=>row.sku).sort(),['182','183','184','395','396','397','BEB-003']);
    assert.deepEqual(await store.searchOperationalArticles(version,'Agua',identity(synthetic,[]).selectionFilter('Bebidas'),60),[]);
    assert.deepEqual((await store.searchOperationalArticles(version,'BEB-003',filter,60)).map(row=>row.sku),['BEB-003']);
    assert.equal(JSON.stringify(['master_v3_articles','master_v3_prices','master_v3_inventory_balances'].map(table=>db.prepare(`SELECT * FROM ${table}`).all())),before);
  } finally { db.close(); }
});


test('MYKON: a bound category missing from setup masters remains visible under its existing allowlist', () => {
  const categoryId = '8af264ba-6951-44f9-a027-c5b845851868';
  const config: Partial<ClassificationItem>[] = [];
  const metadata = [{ key: categoryId, label: 'Todos1' }];
  const lookup = buildPosCategoryIdentity(reconcileBoundV3PosCategories(config, metadata));
  const allowed = new Set([lookup.canonicalize('Todos1')]);
  for (let index = 0; index < 3010; index++) {
    assert.equal(lookup.isProductAllowed({ posCategoryId: categoryId, category: 'Todos1' }, allowed), true);
  }
  assert.deepEqual(lookup.selectionFilter('Todos1').ids, [categoryId]);
  assert.equal(lookup.isProductAllowed({ posCategoryId: 'other', category: 'Todos1' }, allowed), false);
  assert.equal(lookup.isProductAllowed({ category: 'Other' }, allowed), false);
  assert.deepEqual(config, []);
  for (const native of [[...metadata, { key: 'other', label: 'Todos1' }],
    [...metadata, { key: categoryId, label: 'Other' }]]) {
    assert.deepEqual(reconcileBoundV3PosCategories([], native), []);
  }
  const configured = [{ id: 'explicit-id', name: 'Todos1' }];
  assert.deepEqual(reconcileBoundV3PosCategories(configured, metadata), configured);
});
