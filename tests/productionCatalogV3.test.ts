import test from 'node:test';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL } from '../services/db/LargeMasterSyncV3Schema';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import { LargeMasterSyncV3SqliteStore } from '../services/db/LargeMasterSyncV3SqliteStore';
import { ProductionCatalogV3, routingSnapshotConfirms } from '../services/sync/ProductionCatalogV3';
import { v3BindingKey } from '../services/sync/LargeMasterSyncV3OperationalSession';
import { CatalogEditQueue, type CatalogEdit } from '../services/sync/CatalogEditQueue';

const identity={tenantId:'tenant',terminalId:'terminal',deviceId:'device',syncToken:'token',erpSyncBaseUrl:'https://erp.test/api/sync'};
const version={syncId:'S',syncVersion:2,contractVersion:2}; const origin='https://erp.test';
function fixture(size=161) {
 const sql=new DatabaseSync(':memory:');sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
 sql.exec("CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT);INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES('S',2,3,2,'ACTIVE','{}','now','now');UPDATE master_v3_state SET active_sync_id='S',active_version=2;");
 const binding=v3BindingKey(identity,origin);sql.prepare('INSERT INTO master_v3_operational_owner VALUES(1,?,?,?)').run('S',2,binding);
 const insert=sql.prepare('INSERT INTO master_v3_articles(sync_version,article_id,sku,description,article_type,taxable,tax_ids_json,category_id,active,sellable,record_json,pos_category_id,pos_category_key,pos_category_label) VALUES(?,?,?,?,?,0,?,?,?,?,?,?,?,?)');
 for(let i=0;i<size;i++) insert.run(2,`P${String(i).padStart(5,'0')}`,`BEB-${i}`,`Artículo ${i}`,'PRODUCT','[]',null,i%2,i%2,JSON.stringify({production_area_id:i%2?'CAJA_4':null,product_type:i===0?'COMBO':'SIMPLE',restaurant_unsupported:i===0}),i%3?'cat-id':'',i%3?'cat-id':'',i%3?'Bebidas':'');
 insert.run(1,'OLD','OLD','Retenido','PRODUCT','[]',null,1,1,'{}','','','');
 sql.exec("INSERT INTO master_v3_barcodes(sync_version,barcode,article_id) VALUES(2,'UNIQUE-BAR','P00000'),(1,'OLD-BAR','OLD')");
 const queries:Array<{sql:string;count:number}>=[];
 const bridge={query:async(statement:string,params:any[]=[])=>{const values=sql.prepare(statement).all(...params);queries.push({sql:statement,count:values.length});return{values};},run:async()=>{throw Error('WRITE');},execute:async()=>{throw Error('WRITE');}};
 const store=new LargeMasterSyncV3SqliteStore(()=>bridge,async()=>{throw Error('WRITE LOCK');});
 let current={...identity};const deps={enabled:true,store,identity:()=>current,origin:()=>origin};
 return{sql,store,deps,queries,binding,bridge,changeIdentity:()=>{current={...identity,syncToken:'renewed'};}};
}
test('native production administration pages all metadata with no inventory/tariff/legacy; grouped scope and exact filters',async()=>{
 const f=fixture();try{const reader=await ProductionCatalogV3.open(f.deps);let cursor:string|null=null;const ids:string[]=[];
 do{const page=await reader.page({afterId:cursor,limit:80});assert.equal(page.total,161);assert.equal(page.filteredTotal,161);assert.equal(page.assignedCounts.CAJA_4,80);assert.deepEqual(page.categories.map(c=>[c.id,c.count]),[['',54],['cat-id',107]]);ids.push(...page.rows.map(row=>row.id));cursor=page.nextCursor;if(ids.length===80){assert.equal(page.rows[0].unsupported,true);assert.equal(page.rows[1].productionAreaId,'CAJA_4');}}while(cursor);
 assert.equal(ids.length,161);assert.equal(new Set(ids).size,161);
 for(const query of ['UNIQUE-BAR','BEB-0'])assert.equal((await reader.page({query})).filteredTotal,1);
 assert.equal((await reader.page({query:'OLD-BAR'})).filteredTotal,0);
 assert.equal((await reader.page({categoryId:''})).filteredTotal,54);
 assert.equal((await reader.page({categoryId:'cat-id'})).filteredTotal,107);
 assert.equal((await reader.page({categoryId:'Bebidas'})).filteredTotal,0);
 assert.ok(f.queries.every(q=>!q.sql.includes('master_v3_inventory')&&!q.sql.includes('master_v3_tariffs')));
 assert.ok(f.queries.every(q=>q.count<=80));assert.equal(f.sql.prepare('select count(*) n from documents').get()?.n,0);
 f.changeIdentity();await assert.rejects(reader.page({}),{code:'SYNC_V3_CATALOG_CONTEXT_CHANGED'});
 }finally{f.sql.close();}
});
test('generation movement during native await rejects stale actionable page',async()=>{
 const f=fixture();try{const reader=await ProductionCatalogV3.open(f.deps);
 const original=f.store.readProductionCatalogPage.bind(f.store);
 f.store.readProductionCatalogPage=async(...args)=>{const page=await original(...args);f.sql.exec("UPDATE master_v3_state SET active_sync_id='NEW',active_version=3");return page;};
 await assert.rejects(reader.page({}),{code:'SYNC_V3_CATALOG_VERSION_CHANGED'});
 }finally{f.sql.close();}
});
const make=():CatalogEdit=>({id:'m1',scope:{tenantId:'t',companyId:'c',terminalId:'r',deviceId:'d',baseUrl:'https://erp.test'},label:'BEB',mutation:{id:'m1',recordId:'a',domain:'item_operations',field:'production_area_id',before:null,after:'CAJA_4',actorId:'operator'},status:'PENDING',attempts:0,nextAttemptAt:0,createdAt:'now',routingSnapshot:{binding:'B',syncId:'OLD'}});
test('routing ACK loss/restart preserves immutable intent, explicit publication and post-ACK snapshot fence',async()=>{
 let edit=make(),now=0,requests=0;const saved:string[]=[];
 const deps={read:async()=>[structuredClone(edit)],save:async(next:CatalogEdit)=>{edit=next;saved.push(next.status);},matchesScope:()=>true,now:()=>now,
 send:async(item:CatalogEdit)=>{requests++;assert.deepEqual(item.mutation,make().mutation);if(requests===1)throw Error('lost ACK');return{id:item.id,status:'APPLIED' as const,publication_pending:true};},
 onApplied:async(item:CatalogEdit)=>({routingSnapshot:{...item.routingSnapshot!,acknowledgedSyncId:'ACK'}})};
 await new CatalogEditQueue(deps).process();assert.equal(edit.status,'PENDING');now=999999;
 await new CatalogEditQueue(deps).process();assert.equal(edit.status,'APPLIED');assert.equal(edit.publicationPending,true);assert.equal(requests,2);
 const row={id:'a',name:'a',sku:null,categoryId:'',productionAreaId:'CAJA_4',productType:'SIMPLE',unsupported:false};
 for(const syncId of ['OLD','ACK'])assert.equal(routingSnapshotConfirms(edit,{binding:'B',version:{syncId,syncVersion:1}},row),false);
 assert.equal(routingSnapshotConfirms(edit,{binding:'B',version:{syncId:'NEW',syncVersion:2}},row),true);
 assert.equal(routingSnapshotConfirms(edit,{binding:'OTHER',version:{syncId:'NEW',syncVersion:2}},row),false);
 assert.equal(routingSnapshotConfirms(edit,{binding:'B',version:{syncId:'NEW',syncVersion:2}},{...row,productionAreaId:null}),false);
 await new CatalogEditQueue(deps).process();assert.equal(requests,2);
});

test('real routing writer freezes displayed IDs, persists intents atomically, rejects unsupported/conflicts and confirms V3 without products writes',async()=>{
 const {build}=await import('esbuild');const sql=new DatabaseSync(':memory:');sql.exec('create table documents(collection_name text,doc_id text,data text,primary key(collection_name,doc_id));');
 const scope={tenantId:'t',companyId:'c',terminalId:'r',deviceId:'d',baseUrl:'https://erp.test'};
 let supported=true,authorized=true,matches=true,reads=0,commits=0,sends=0;
 const rows=[{id:'a',name:'Agua',sku:null,categoryId:'',productionAreaId:null,productType:'SIMPLE',unsupported:false},
 {id:'b',name:'Jugo',sku:null,categoryId:'',productionAreaId:'OTHER',productType:'SIMPLE',unsupported:false}];
 const read=async()=>{reads++;return sql.prepare("select data from documents where collection_name='catalogEdits'").all().map(row=>JSON.parse(String(row.data)));};
 const adapter={saveDocumentsAtomically:async(documents:any[])=>{sql.exec('begin');try{for(const mutation of documents){assert.equal(mutation.collectionName,'catalogEdits');assert.equal(mutation.v3CurrentCatalog.binding,'B');const old=sql.prepare('select data from documents where collection_name=? and doc_id=?').get('catalogEdits',mutation.document.id);
 if(mutation.requireAbsent&&old)throw Error('DUPLICATE');if(mutation.expectedDocument&&old?.data!==mutation.expectedDocument)throw Error('CAS');
 sql.prepare('insert or replace into documents values(?,?,?)').run('catalogEdits',mutation.document.id,JSON.stringify(mutation.document));}sql.exec('commit');commits++;}catch(error){sql.exec('rollback');throw error;}}};
 const fixture={adapter,read,scope:()=>scope,matches:()=>matches,queue:{process:async()=>{sends++;}},auth:async()=>{if(!authorized)throw Error('FORBIDDEN');},api:{productionRoutingCapability:async()=>supported}};
 Object.assign(globalThis,{__productionWriterFixture:fixture});const oldWindow=(globalThis as any).window;(globalThis as any).window=new EventTarget();
 const built=await build({entryPoints:['services/sync/ProductionCatalogV3.ts'],bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent',plugins:[{name:'writer-fixture',setup(builder){
 builder.onResolve({filter:/^(\.\.\/db|\.\/catalogEdits|\.\/catalogEditAuthorization|\.\/ApiSyncAdapter|\.\/LargeMasterSyncV3(?:Authority|BoundTransport|DownloadOrigin|OperationalSession))$/},args=>({path:args.path,namespace:'fixture'}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='../db'?'exports.dbAdapter=globalThis.__productionWriterFixture.adapter;':path.endsWith('catalogEdits')?'exports.catalogEditQueue=globalThis.__productionWriterFixture.queue;exports.currentCatalogScope=globalThis.__productionWriterFixture.scope;exports.catalogScopeMatches=globalThis.__productionWriterFixture.matches;exports.readCatalogEdits=globalThis.__productionWriterFixture.read;':path.endsWith('catalogEditAuthorization')?'exports.assertCurrentPosCatalogEditAuthorized=globalThis.__productionWriterFixture.auth;':'exports.apiSyncAdapter=globalThis.__productionWriterFixture.api;'}));
 }}]});const loaded={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
 const api=loaded.exports;let current=true;const reader={binding:'B',version:{syncId:'OLD',syncVersion:1},assertCurrent:async()=>{if(!current)throw Error('STALE');}};
 try{
 supported=false;await assert.rejects(api.enqueueProductionRouting(reader,rows,'A','actor'));assert.equal(commits,0);supported=true;
 authorized=false;await assert.rejects(api.enqueueProductionRouting(reader,rows,'A','actor'),/FORBIDDEN/);authorized=true;
 const frozen=rows.map(row=>({...row}));await api.enqueueProductionRouting(reader,frozen,'A','actor');assert.equal(commits,1);assert.equal(sends,1);
 const queued=(await read()).sort((a,b)=>a.mutation.recordId.localeCompare(b.mutation.recordId));assert.deepEqual(queued.map(edit=>[edit.mutation.recordId,edit.mutation.before,edit.mutation.after]),[['a',null,'A'],['b','OTHER','A']]);
 assert.ok(queued.every(edit=>edit.status==='PENDING'&&edit.routingSnapshot.syncId==='OLD'));assert.equal(sql.prepare("select count(*) n from documents where collection_name='products'").get()?.n,0);
 await assert.rejects(api.enqueueProductionRouting(reader,frozen,null,'actor'),/pendientes/);assert.equal(commits,1);
 for(const edit of queued){edit.status='APPLIED';edit.routingSnapshot.acknowledgedSyncId='ACK';sql.prepare('update documents set data=? where doc_id=?').run(JSON.stringify(edit),edit.id);}
 const page=rows.map(row=>({...row,productionAreaId:'A'}));reads=0;const statuses=await api.productionRoutingStates({...reader,version:{syncId:'NEW',syncVersion:2}},page);assert.equal(reads,1);assert.deepEqual(Object.values(statuses),['Confirmado por catálogo ERP','Confirmado por catálogo ERP']);
 assert.ok((await read()).every(edit=>Boolean(edit.snapshotConfirmedAt)));assert.equal(commits,2);
 current=false;await assert.rejects(api.enqueueProductionRouting(reader,frozen,'A','actor'),/STALE/);assert.equal(commits,2);
 }finally{sql.close();(globalThis as any).window=oldWindow;delete(globalThis as any).__productionWriterFixture;}
});


test('native atomic intent insert/confirmation rejects changed generation and CAS without writing products',async()=>{
 const f=fixture();try{
  f.sql.exec('ALTER TABLE documents ADD COLUMN sort_order INTEGER;ALTER TABLE documents ADD COLUMN updatedAt TEXT;CREATE UNIQUE INDEX docs_id ON documents(collection_name,doc_id);');
  const native={...f.bridge,run:async(query:string,values:any[]=[])=>f.sql.prepare(query).run(...values),execute:async(query:string)=>{f.sql.exec(query);}};
  const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:native,isReady:true});
  const edit=make();edit.routingSnapshot={binding:f.binding,syncId:'S'};
  const command={collectionName:'catalogEdits',document:edit,requireAbsent:true,v3CurrentCatalog:{...version,binding:f.binding}};
  await adapter.saveDocumentsAtomically([command]);
  await assert.rejects(adapter.saveDocumentsAtomically([command]),/DUPLICATE/);
  const before=f.sql.prepare("select data from documents where collection_name='catalogEdits'").get()?.data;
  f.sql.exec("UPDATE master_v3_state SET active_sync_id='NEW',active_version=3;");
  await assert.rejects(adapter.saveDocumentsAtomically([{...command,requireAbsent:false,expectedDocument:String(before),document:{...edit,snapshotConfirmedAt:'now'}}]),/CATALOG_VERSION_CHANGED/);
  assert.equal(f.sql.prepare("select data from documents where collection_name='catalogEdits'").get()?.data,before);
  f.sql.exec("UPDATE master_v3_state SET active_sync_id='S',active_version=2;");
  await assert.rejects(adapter.saveDocumentsAtomically([{...command,requireAbsent:false,expectedDocument:'wrong',document:{...edit,snapshotConfirmedAt:'now'}}]),/CONCURRENT/);
  assert.equal(f.sql.prepare("select count(*) n from documents where collection_name='products'").get()?.n,0);
 }finally{f.sql.close();}
});
