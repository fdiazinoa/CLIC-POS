import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {basename,isAbsolute,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import SQLite from 'better-sqlite3';
import {nativeFixture,id,options} from './articleFormatsNativeFixture';
import {prepareArticleFormatsAdapters} from '../services/articleFormats/runtime';
import {ArticleFormatInventoryJournal,installInventoryFixtureBinding,readReconciledPhysicalInventory} from '../services/articleFormats/inventoryJournal';
import {saleWireLine,returnWireLine,wireTotals} from '../services/articleFormats/posting';
import {createFormatTransport,uuid,type WireEvent} from '../services/articleFormats/wire';
import type {InventoryScope} from '../services/articleFormats/inventoryContract';

/** Distinct opt-in: a FRESH original ERP2252 synthetic local runner, actual HTTP + PostgreSQL17 + SQLite file/native host bridge.
 * The host bridge is not Android, Supabase/PostgREST, WebView, a deployed ERP, or an offline device test. */
const fixturePath=process.env.CLIC_FORMATS_INVENTORY_LOCAL_FIXTURE;
test('original ERP2252 inventory channel + real durable SQLite native adapter: ACK/inclusion independence and historical return',
 {skip:!fixturePath,timeout:120000},async t=>{
 const f=JSON.parse(readFileSync(fixturePath!,'utf8')),origin=new URL(f.baseUrl);
 assert.ok(isAbsolute(f.erpSource));assert.equal(createHash('sha256').update(readFileSync(join(f.erpSource,'docs/ARTICLE_FORMATS_POS_NETWORK_V1.md'))).digest('hex'),'5ce0c723fe053b00aaef75a63a36d2c7799cdfedff3a9de508d98ab0592310e8','Use authoritative ERP2252 source bytes');
 assert.equal(origin.protocol,'http:');assert.ok(['127.0.0.1','localhost','[::1]'].includes(origin.hostname));
 assert.ok(isAbsolute(f.postgresSocket)&&basename(f.postgresSocket).startsWith('clic-formats-pg.'));
 assert.match(f.database,/^clic_formats_contract_\d+$/);
 for(const field of ['tenantId','companyId','storeId','terminalId','warehouseId','itemId','tariffId'])uuid(f[field]);
 const pgBin=process.env.CLIC_FORMATS_PG_BINDIR || '/opt/homebrew/opt/postgresql@17/bin';
 const query=(text:string):any[]=>JSON.parse(execFileSync(join(pgBin,'psql'),['-X','-q','-A','-t','-h',f.postgresSocket,'-p','55437','-U','postgres','-d',f.database,'-v','ON_ERROR_STOP=1','-c',`select coalesce(json_agg(q),'[]'::json) from (${text}) q`],{encoding:'utf8'}).trim());
 assert.match(query("select current_setting('server_version') version")[0].version,/^17\./);
 const stock=()=>query(`select qty_physical::text quantity from erp_stock_balance where item_id='${f.itemId}'`)[0].quantity;
 assert.equal(stock(),'137.0000','Restart the disposable ERP fixture before this opt-in suite');
 assert.equal(query(`select count(*)::int n from private.pos_format_events where terminal_id='${f.terminalId}'`)[0].n,0);
 // Only explicit trusted synthetic fixture SQL provides the local_id. Never infer the expected scope from a response.
 const local=query(`select local_id from private.pos_format_grants where terminal_id='${f.terminalId}'`)[0].local_id;uuid(local);
 const scope:InventoryScope={tenant_id:f.tenantId,company_id:f.companyId,store_id:f.storeId,terminal_id:f.terminalId,device_id:f.deviceId,warehouse_id:f.warehouseId,local_id:local};
 const folder=mkdtempSync(join(tmpdir(),'clic-inventory-real-erp-')),file=join(folder,'pos.sqlite');t.after(()=>rmSync(folder,{recursive:true,force:true}));
 let host=await nativeFixture(new SQLite(file));t.after(()=>{if(host.db.open)host.db.close();});
 const transport=createFormatTransport(f.baseUrl,f,fetch,15000,{negotiateReturnContextV1:true,fixtureInventoryReconciliationV1:true});
 const runtime=await prepareArticleFormatsAdapters(host.sql,transport,f.terminalId);await runtime.masters.download();
 const master=await runtime.masters.getPolicy(f.itemId),revision=await runtime.masters.getActiveRevision();assert.ok(master&&revision);
 const binding=JSON.stringify([f.tenantId,f.terminalId,f.deviceId,f.baseUrl,f.baseUrl]);
 host.db.prepare("UPDATE documents SET data=? WHERE collection_name='config' AND doc_id='current'").run(JSON.stringify({id:'current',terminals:[{id:f.terminalId,config:{erpTerminalId:f.terminalId,currentDeviceId:f.deviceId,erpBinding:{tenantId:f.tenantId,companyId:f.companyId,storeId:f.storeId},inventoryScope:{defaultSalesWarehouseId:f.warehouseId}}}]}));
 host.db.prepare('UPDATE master_v3_operational_owner SET binding=?').run(binding);
 host.db.prepare('INSERT INTO master_v3_inventory_balances VALUES(?,?,?,?,?,?)').run(f.itemId,f.warehouseId,137,0,0,'synthetic-ERP2252');
 const raw=(await runtime.masters.getDataset<any>('articles')).find(a=>a.id===f.itemId);assert.ok(raw);
 host.db.prepare('INSERT INTO master_v3_articles(sync_version,article_id,taxable,tax_ids_json,active,sellable,record_json) VALUES(?,?,?,?,?,?,?)').run(32,f.itemId,raw.taxable?1:0,JSON.stringify(raw.taxIds || []),1,1,JSON.stringify(raw));
 await installInventoryFixtureBinding(host.sql,{scope,authorization:'synthetic-only-original-ERP2252'});
 let journal=new ArticleFormatInventoryJournal(host.sql);
 const stamp=JSON.stringify([binding,id(60),32,4,'inventory-cursor']);
 const physical=async()=>{const state=await readReconciledPhysicalInventory(host.sql.query,stamp,[f.itemId],f.warehouseId);assert.ok(state);return state[f.itemId].physical.toFixed(4);};
 const now=new Date().toISOString(),line=saleWireLine(master.dto,master.policy,{lineId:randomUUID(),formatId:'case24',variantId:null,tariffId:f.tariffId,quantity:'2',occurredAt:now,terminalId:f.terminalId}),totals=wireTotals([line]);
 const sale:WireEvent={schema_version:1,event_id:randomUUID(),transaction_id:randomUUID(),event_type:'ARTICLE_FORMAT_SALE_V1',occurred_at:now,master:{sync_id:revision.syncId,revision:revision.revision},fiscal:{mode:'NONE'},lines:[line],payments:[{payment_id:randomUUID(),method:'cash',amount:totals.total_amount}],totals};
 await runtime.posting.post(sale,options);
 const original=(host.db.prepare('SELECT content FROM article_format_outbox WHERE event_id=?').get(sale.event_id) as any).content;
 await journal.reconcileFixture(transport);assert.equal(await physical(),'89.0000');assert.equal(stock(),'137.0000');
 // Real server commits; simulate lost network response without writing an ACK locally.
 await transport.request('/api/sync/article-formats/v1/events',sale);assert.equal(stock(),'89.0000');
 await journal.reconcileFixture(transport);assert.equal(await physical(),'89.0000');assert.equal((await runtime.posting.pending()).length,1);
 assert.equal((host.db.prepare('SELECT content FROM article_format_outbox WHERE event_id=?').get(sale.event_id) as any).content,original);
 await runtime.drain();assert.equal((await runtime.posting.pending()).length,0);assert.equal(await physical(),'89.0000');
 const included=(host.db.prepare('SELECT baseline_id FROM article_format_inventory_state WHERE baseline_id IS NOT NULL').get()) as any;
 assert.ok(included?.baseline_id);
 // Commercial reservation authority is deliberately not inferred from ERP v1. Fixture injects a separately matched source explicitly.
 await installInventoryFixtureBinding(host.sql,{scope,authorization:'synthetic-only-original-ERP2252',reservationAuthority:{baseline_id:included.baseline_id,quantities:{[f.itemId]:'0.0000'}}});
 const returned=returnWireLine(sale.lines[0],[],'0.5',randomUUID()),returnTotals=wireTotals([returned]);
 const ret:WireEvent={schema_version:1,event_id:randomUUID(),transaction_id:randomUUID(),event_type:'ARTICLE_FORMAT_RETURN_V1',occurred_at:new Date().toISOString(),source_event_id:sale.event_id,return_context:structuredClone(runtime.context.return_context!),fiscal:{mode:'NONE'},lines:[returned],payments:[{payment_id:randomUUID(),method:'cash',amount:returnTotals.total_amount}],totals:returnTotals};
 await runtime.posting.post(ret,{...options,seriesId:id(10)});assert.equal(await physical(),'101.0000');await runtime.drain();assert.equal(stock(),'101.0000');
 await journal.reconcileFixture(transport);assert.equal(await physical(),'101.0000');
 const before=host.db.prepare('SELECT * FROM article_format_inventory_absorptions ORDER BY event_id').all();assert.equal(before.length,2);
 host.db.close();host=await nativeFixture(new SQLite(file),false);journal=new ArticleFormatInventoryJournal(host.sql);
 assert.deepEqual(host.db.prepare('SELECT * FROM article_format_inventory_absorptions ORDER BY event_id').all(),before);assert.equal(await physical(),'101.0000');
 await journal.reconcileFixture(transport);assert.equal(await physical(),'101.0000');assert.equal((host.db.prepare('SELECT count(*) n FROM article_format_inventory_originals').get() as any).n,2);
});
