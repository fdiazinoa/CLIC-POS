import assert from 'node:assert/strict';
import test from 'node:test';
import SQLite from 'better-sqlite3';
import { ARTICLE_FORMATS_SCHEMA } from '../services/articleFormats/schema';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import { ArticleFormatStore, type FormatSQL } from '../services/articleFormats/store';
import { freezeLine } from '../services/articleFormats/domain';
import { androidSQLiteStatements } from './nativeSQLiteParser';

test('installed Android Java parser accepts every format DDL and both return trigger branches',async t => {
  const db=new SQLite(':memory:');t.after(() => db.close());db.pragma('foreign_keys=ON');
  const statements=androidSQLiteStatements(ARTICLE_FORMATS_SCHEMA,t);
  db.transaction(() => {for (const statement of statements) db.exec(statement);})();
  const sql: FormatSQL={executeSchema:async () => {},query:async <T>(statement:string,values:(string|number|null)[]) => db.prepare(statement).all(...values) as T[],
    executeAtomic:async statements => {db.transaction(() => {for (const statement of statements) db.prepare(statement.statement).run(...(statement.values || []));})();}};
  const scope={tenantId:'fixture',companyId:'fixture'},store=new ArticleFormatStore(sql,scope,[],'fixture-terminal');
  const format={schemaVersion:1 as const,id:'fixture-box',name:'Caja24',abbreviation:'CJ24',variantId:null,factor:24,barcode:null};
  const line=freezeLine({cartId:'fixture-line',id:'fixture-item',quantity:2,price:240,baseUnitCost:3},format);
  const sale={scope,eventId:'fixture-sale',terminalId:'fixture-terminal',kind:'SALE' as const,warehouseId:'fixture-wh',lines:[line],fiscalDocument:{total:480}};
  await store.commitLocalEvent(sale);
  const refund={...sale,eventId:'fixture-refund',kind:'REFUND' as const,lines:[{...freezeLine({...line,quantity:.5},format),originalSaleEventId:sale.eventId,originalSaleLineId:line.cartId,physicalReturn:'RESTOCK' as const}]};
  await store.commitLocalEvent(refund);
  const changed={...refund,eventId:'changed',lines:refund.lines.map(line => freezeLine(line,{...format,factor:12}))};
  await assert.rejects(store.commitLocalEvent(changed),/ORIGINAL_LINE_MISSING_OR_CHANGED/);
  const excess={...refund,eventId:'excess',lines:refund.lines.map(line => freezeLine({...line,quantity:2},format))};
  await assert.rejects(store.commitLocalEvent(excess),/REFUND_EXCEEDS_SALE/);
});

test('native develop migration preserves pending documents and V3 ownership with FK outside BEGIN',async t => {
  const db=new SQLite(':memory:');t.after(() => db.close());
  db.exec("CREATE TABLE collections(key TEXT PRIMARY KEY,value TEXT,updatedAt TEXT)");
  db.prepare('INSERT INTO collections VALUES (?,?,?)').run('transactions','[{"id":"fixture-pending","syncStatus":"PENDING"}]','fixture');
  let schemaParsed=false;
  const bridge={execute:async (sql:string,transaction = true) => {
    const statements=sql.includes('article_format_returns') ? androidSQLiteStatements(sql,t) : [sql];
    if (sql.includes('article_format_returns')) schemaParsed=true;
    const apply=() => {for (const statement of statements) db.exec(statement);};
    if (transaction) db.transaction(apply)(); else apply();
  },query:async (sql:string,values:unknown[] = []) => ({values:db.prepare(sql).all(...values)}),
    run:async (sql:string,values:unknown[] = []) => ({changes:db.prepare(sql).run(...values)}),
    executeSet:async (statements:{statement:string;values:unknown[]}[]) => {db.transaction(() => {for(const s of statements) db.prepare(s.statement).run(...s.values);})();}};
  Object.assign(bridge,{beginTransaction:async()=>{db.exec('BEGIN IMMEDIATE');},commitTransaction:async()=>{db.exec('COMMIT');},rollbackTransaction:async()=>{db.exec('ROLLBACK');},isTransactionActive:async()=>({result:db.inTransaction})});
  const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge});
  await (adapter as unknown as {initSchema():Promise<void>}).initSchema();
  await (adapter as unknown as {initSchema():Promise<void>}).initSchema();
  assert.ok(schemaParsed);
  assert.equal(db.pragma('foreign_keys',{simple:true}),1);
  assert.equal(JSON.parse((db.prepare("SELECT data FROM documents WHERE collection_name='transactions'").get() as {data:string}).data).id,'fixture-pending');
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='master_v3_articles'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='preserve_v3_financial_authority_update'").get());
  assert.throws(() => db.prepare('INSERT INTO article_format_sale_lines VALUES (?,?,?,?,?,?,?,?)').run('fixture','fixture','missing-event','line','item','{}',1,'{}'),/FOREIGN KEY/);
});
