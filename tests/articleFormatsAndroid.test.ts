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

test('native adapter enables FK outside BEGIN and atomically migrates legacy pending data',async t => {
  const db=new SQLite(':memory:');t.after(() => db.close());
  db.exec("CREATE TABLE collections(key TEXT PRIMARY KEY,value TEXT,updatedAt TEXT); CREATE TABLE sync_queue(id TEXT PRIMARY KEY,type TEXT,payload TEXT,status TEXT,retryCount INTEGER,createdAt TEXT,error TEXT)");
  db.prepare('INSERT INTO collections VALUES (?,?,?)').run('transactions','[{"id":"fixture-pending","syncStatus":"PENDING"}]','fixture');
  let parsed: string[] = [];
  const bridge={execute:async (sql:string,transaction = true) => {
    const apply=() => {if (sql.includes('article_format_returns')) {for (const statement of parsed) db.exec(statement);} else db.exec(sql);};
    if (transaction) db.transaction(apply)(); else apply();
  },query:async (sql:string,values:unknown[] = []) => ({values:db.prepare(sql).all(...values)})};
  const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge});
  // Capture the complete native schema string without replacing its transaction semantics.
  const capture={execute:async (sql:string) => {if (sql.includes('article_format_returns')) parsed=androidSQLiteStatements(sql,t);}};
  Object.assign(adapter,{db:capture});await (adapter as unknown as {initSchema():Promise<void>}).initSchema();
  Object.assign(adapter,{db:bridge});await (adapter as unknown as {initSchema():Promise<void>}).initSchema();
  assert.equal(db.pragma('foreign_keys',{simple:true}),1);
  assert.equal((db.prepare('SELECT value FROM collections').get() as {value:string}).value,'[{"id":"fixture-pending","syncStatus":"PENDING"}]');
  assert.throws(() => db.prepare('INSERT INTO article_format_sale_lines VALUES (?,?,?,?,?,?,?,?)').run('fixture','fixture','missing-event','line','item','{}',1,'{}'),/FOREIGN KEY/);
});
