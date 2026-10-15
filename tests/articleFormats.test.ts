import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import SQLite from 'better-sqlite3';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ArticleFormat, ArticleFormatsDTO, ArticleFormatMasterPage } from '../services/articleFormats/contract';
import { ArticleFormatStore, canonicalContent, type FormatLocalEvent, type FormatSQL } from '../services/articleFormats/store';
import { toBaseQuantity, availability, formatPrice, freezeLine, inventoryQuantity, refundLine, resizeLine, resolveFormatBarcode, validateDTO } from '../services/articleFormats/domain';
import { formatsEnabled, formatsNegotiated, assertLegacyFormatPayload, assertFormatsPostingClosed } from '../services/articleFormats/activation';
import { consumeArticleFormatPages, drainArticleFormatEvents, type ArticleFormatEventTransport } from '../services/articleFormats/sync';
import { syncArticleFormatMasters } from '../services/articleFormats/master';
import { addFormatLine, selectedVariantId, legacyMergeCandidate, routeQuickFormat, baseCodeFormat } from '../services/articleFormats/cart';
import { articleFormatTicketLabel, articleFormatTicketHTML } from '../services/articleFormats/ticket';
import ArticleFormatSelector from '../components/ArticleFormatSelector';
import { applyPromotions } from '../utils/promotionEngine';
import type { Product, BusinessConfig } from '../types';
import { buildEscPosTicketPayload } from '../services/printer/EscPosFormatter';

const scope = {tenantId:'fixture-tenant',companyId:'fixture-company'};
function format(id: string, factor: number, variantId: string | null = null): ArticleFormat {
  return {schemaVersion:1,id,variantId,name:`Formato ${factor}`,abbreviation:`F${factor}`,factor,barcode:null,
    active:true,is_base:factor === 1,default_purchase:factor === 1,default_sale:factor === 1,
    allow_purchase:true,allow_sale:true,allow_transfer:true,sort_order:factor,prices:[]};
}
const dto = (): ArticleFormatsDTO => ({schema_version:1,inventory_quantity_unit:'BASE',item_id:'fixture-item',formats:[format('unit',1),format('pack',6),format('box',24)]});
const product = (): Product => ({id:'fixture-item',name:'Fixture article',price:10,cost:3,category:'fixture',stock:137,images:[],attributes:[],variants:[],tariffs:[{tariffId:'retail',price:10}],appliedTaxIds:['tax18'],article_formats:dto()});
const line = (factor = 24, quantity = 2) => freezeLine({...product(),cartId:'stable-line',quantity,price:240,baseUnitCost:3},format('box',factor));
const sale = (): FormatLocalEvent => ({scope,eventId:'stable-sale',terminalId:'fixture-terminal',kind:'SALE',warehouseId:'fixture-wh',lines:[line()],fiscalDocument:{gross:480,tax:73.22,net:406.78,discount:0}});
const returned = (eventId: string, quantity: number, physicalReturn: 'RESTOCK'|'DAMAGED'|'NO_RETURN' = 'RESTOCK'): FormatLocalEvent => ({...sale(),eventId,kind:'REFUND',lines:[{...refundLine(line(),quantity,0),originalSaleEventId:'stable-sale',originalSaleLineId:'stable-line',physicalReturn}],fiscalDocument:{gross:240*quantity}});
function sqlitePort(db: SQLite.Database): FormatSQL {
  return {executeSchema:async sql => { db.exec(sql); },query:async <T>(sql: string,values: (string|number|null)[]) => db.prepare(sql).all(...values) as T[],
    executeAtomic:async statements => { db.transaction(() => { for (const stmt of statements) db.prepare(stmt.statement).run(...(stmt.values || [])); })(); }};
}
async function fixture(t: test.TestContext, file = ':memory:') {
  const db = new SQLite(file); db.pragma('foreign_keys=ON');
  t.after(() => { if (db.open) db.close(); });
  const store = new ArticleFormatStore(sqlitePort(db),scope,['retail','wholesale'],'fixture-terminal');
  await store.migrate();
  return {db,store};
}
const page = (revision = 1, formats = dto()): ArticleFormatMasterPage => ({scope,pageId:`page-${revision}`,revision,nextCursor:null,items:[formats]});

test('Unit/Pack6/Box24 quantities and derived availability never create format balances',() => {
  assert.deepEqual([1,6,24].map(f => toBaseQuantity(2,f)),[2,12,48]);
  assert.deepEqual([1,6,24].map(f => availability(137,f)),[137,22,5]);
  assert.equal(toBaseQuantity(.5,24),12);
  assert.equal(toBaseQuantity(.1,.3),.03);
});
test('new decimal conversions reject truncation, unsafe range, invalid factors and values',() => {
  for (const [quantity,factor] of [[.0001,.0001],[1,0],[1,-1],[1,1.00001],[99999999999.9999,24],[NaN,1],[Infinity,1]]) assert.throws(() => toBaseQuantity(quantity,factor));
  assert.equal(toBaseQuantity(99999999999.9999,1),99999999999.9999);
});
test('independent tariff overrides, authorized fallback, explicit zero and safe prices',() => {
  const box = {...format('box',24),prices:[{tariffId:'retail',price:0},{tariffId:'wholesale',price:199.99}]};
  assert.equal(formatPrice(box,'retail',10),0);
  assert.equal(formatPrice(box,'wholesale',10),199.99);
  assert.equal(formatPrice(box,'other',10),240);
  assert.equal(formatPrice(format('pack',6),'retail',0),0);
});
test('exact DTO identity, flags, EAN13, tariffs, context bases and defaults validated',() => {
  const value = dto(); value.formats[2].barcode='7501031311309';
  assert.deepEqual(validateDTO(value,['retail']),value);
  const invalids: ArticleFormatsDTO[] = [
    {...value,formats:[...value.formats,value.formats[2]]},
    {...value,formats:[format('box',24)]},
    {...value,formats:value.formats.map(f => ({...f,default_sale:true}))},
    {...value,formats:value.formats.map(f => ({...f,prices:[{tariffId:'secret-tariff',price:1}]}))},
    {...value,formats:value.formats.map(f => ({...f,barcode:'7501031311308'}))}
  ];
  for (const invalid of invalids) assert.throws(() => validateDTO(invalid,['retail']));
});
test('variant barcodes resolve context and refuse ambiguity or disabled sale',() => {
  const variant = {...format('box',24,'red-SKU'),barcode:'7501031311309'};
  const articles = [{id:'fixture-item',article_formats:{...dto(),formats:[variant]}}];
  assert.equal(resolveFormatBarcode(articles,variant.barcode)?.variantId,'red-SKU');
  assert.throws(() => resolveFormatBarcode([...articles,{...articles[0],id:'other'}],variant.barcode));
  assert.equal(resolveFormatBarcode([{...articles[0],article_formats:{...dto(),formats:[{...variant,allow_sale:false}]}}],variant.barcode),null);
});
test('cart uses stable independent format/variant lines, free price and frozen historical factor',() => {
  const p = product();
  let cart = addFormatLine([],p,p.article_formats!.formats[2],2,0,'box-line');
  cart = addFormatLine(cart,p,p.article_formats!.formats[0],2,10,'unit-line');
  cart = addFormatLine(cart,p,p.article_formats!.formats[2],1,0,'ignored-new-id');
  assert.equal(cart.length,2); assert.equal(cart.find(i => i.cartId === 'box-line')?.baseQuantity,72);
  assert.equal(cart.find(i => i.cartId === 'box-line')?.price,0);
  const original = line();
  p.article_formats!.formats[2].factor=12;
  assert.equal(inventoryQuantity(original),48);
  assert.equal(resizeLine(original,3).baseQuantity,72);
  assert.equal(inventoryQuantity({quantity:2}),2);
  assert.throws(() => inventoryQuantity({...original,baseQuantity:2}));
});
test('flag, terminal capability and ALL readiness fields required; runtime stays closed',() => {
  const ready={authenticatedScope:true,paginatedMasterTransport:true,versionedSaleEvent:true,versionedRefundEvent:true,atomicLocalPosting:true,negotiated:true};
  const config={featureFlags:{ARTICLE_FORMATS:true}},terminal={capabilities:{article_formats:1}};
  assert.equal(formatsNegotiated(config,terminal,ready),true);
  assert.equal(formatsEnabled(config,terminal),false);
  assert.equal(formatsNegotiated({},terminal,ready),false);
  assert.equal(formatsNegotiated(config,{},ready),false);
  for (const field of Object.keys(ready)) assert.equal(formatsNegotiated(config,terminal,{...ready,[field]:false}),false);
  assert.throws(() => assertFormatsPostingClosed([line()]),/NOT_NEGOTIATED/);
  assert.doesNotThrow(() => assertFormatsPostingClosed([{quantity:1} as never]));
});
test('legacy outgoing payload guards cover all known containers before network effects',() => {
  for (const field of ['articleFormat','article_format','metadata','workflow']) {
    const payload = field === 'metadata' || field === 'workflow' ? {[field]:{article_format:{factor:24}}} : {[field]:{factor:24}};
    for (const wrapper of ['transaction','sale','document','invoice']) assert.throws(() => assertLegacyFormatPayload({[wrapper]:{lines:[payload]}}),/UNSUPPORTED/);
  }
  assert.doesNotThrow(() => assertLegacyFormatPayload({items:[{quantity:2,conversionFactor:24}]}));
});
test('SQLite additive migration retains pending legacy transaction and queue verbatim',async t => {
  const db = new SQLite(':memory:'); t.after(() => db.close());
  db.exec('CREATE TABLE collections (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE sync_queue(id TEXT PRIMARY KEY,payload TEXT,status TEXT)');
  const old = JSON.stringify([{id:'old-sale',items:[{quantity:2,conversionFactor:24}],syncStatus:'PENDING'}]);
  db.prepare('INSERT INTO collections VALUES (?,?)').run('transactions',old);
  db.prepare('INSERT INTO sync_queue VALUES (?,?,?)').run('old-event',old,'PENDING');
  const store=new ArticleFormatStore(sqlitePort(db),scope,['retail'],'fixture-terminal');
  await store.migrate(); await store.migrate();
  assert.equal((db.prepare('SELECT value FROM collections').get() as {value:string}).value,old);
  assert.equal((db.prepare('SELECT payload FROM sync_queue').get() as {payload:string}).payload,old);
});
test('paginated master duplicate/revision order, exact names, prices and tenant isolation',async t => {
  const {store,db}=await fixture(t);
  const newer=dto();newer.formats[2].factor=12;newer.formats[2].prices=[{tariffId:'retail',price:0}];
  await store.applyMasterPage(page(2,newer)); await store.applyMasterPage(page(1)); await store.applyMasterPage(page(2,newer));
  assert.equal((await store.getMaster('fixture-item'))?.formats[2].factor,12);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM article_format_revisions').get() as {n:number}).n,2);
  assert.equal((db.prepare('SELECT price FROM article_format_prices').get() as {price:string}).price,'0');
  await assert.rejects(store.applyMasterPage({...page(1),scope:{...scope,companyId:'foreign'}}),/SCOPE/);
  const other=new ArticleFormatStore(sqlitePort(db),{...scope,companyId:'other'},['retail'],'fixture-terminal');
  assert.equal(await other.getMaster('fixture-item'),undefined);
});
test('changed contents at same page/revision reject atomically and preserve master',async t => {
  const {store,db}=await fixture(t);await store.applyMasterPage(page());
  const changed=dto();changed.formats[2].factor=12;
  await assert.rejects(store.applyMasterPage(page(1,changed)),/PAGE_CONFLICT/);
  await assert.rejects(store.applyMasterPage({...page(1,changed),pageId:'different-page'}),/REVISION_CONFLICT/);
  assert.equal((await store.getMaster('fixture-item'))?.formats[2].factor,24);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM article_format_master_pages').get() as {n:number}).n,1);
});
test('master ACK failure and retry keep committed pages durable and do not duplicate revisions',async t => {
  const {store,db}=await fixture(t);let attempts=0;
  const transport={nextPage:async () => page(),acknowledge:async () => {if (++attempts === 1) throw new Error('network-after-commit');}};
  await assert.rejects(consumeArticleFormatPages(store,transport),/network/);
  assert.equal((await store.pendingMasterACKs()).length,1);
  await consumeArticleFormatPages(store,transport);
  assert.equal((await store.pendingMasterACKs()).length,0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM article_format_revisions').get() as {n:number}).n,1);
});
test('future master adapter hydrates context without modifying SKUs or stocks, refuses unknown variants',async t => {
  const {store}=await fixture(t);let sent=false;
  const products=await syncArticleFormatMasters(store,{nextPage:async () => sent ? null : (sent=true,page()),acknowledge:async () => {}},[product()]);
  assert.equal(products.length,1);assert.equal(products[0].stock,137);assert.equal(products[0].id,'fixture-item');
  const bad=dto();bad.formats=[format('unit',1,'unknown-SKU')];
  await assert.rejects(syncArticleFormatMasters(store,{nextPage:async () => page(2,bad),acknowledge:async () => {}},[product()]),/VARIANT_NOT_FOUND/);
});
test('sale event snapshot, fiscal document and movement are immutable and replay-safe',async t => {
  const {store,db}=await fixture(t);const event=sale();await store.commitLocalEvent(event);await store.commitLocalEvent(event);
  assert.equal((db.prepare('SELECT base_delta FROM article_format_base_movements').get() as {base_delta:number}).base_delta,-480000);
  const changed=structuredClone(event);changed.lines[0].price=200;
  await assert.rejects(store.commitLocalEvent(changed),/EVENT_CONFLICT/);
  const newer=dto();newer.formats[2].factor=12;await store.applyMasterPage(page(2,newer));
  assert.deepEqual((await store.pendingEvents())[0],event);
  assert.equal((await store.pendingEvents())[0].lines[0].articleFormat?.factor,24);
});
test('partial return .5 box24 uses 12 base, cumulative DB limit and retry/void do not duplicate',async t => {
  const {store,db}=await fixture(t);await store.commitLocalEvent(sale());
  await store.commitLocalEvent(returned('return1',.5));await store.commitLocalEvent(returned('return1',.5));
  assert.equal((db.prepare("SELECT base_delta FROM article_format_base_movements WHERE event_id='return1'").get() as {base_delta:number}).base_delta,120000);
  await store.commitLocalEvent(returned('return2',1.5,'NO_RETURN'));
  await assert.rejects(store.commitLocalEvent(returned('excess',.0001)),/REFUND_EXCEEDS/);
  await assert.rejects(store.commitLocalEvent({...returned('void',2),kind:'VOID'}),/REFUND_EXCEEDS/);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM article_format_outbox').get() as {n:number}).n,3);
  assert.equal((db.prepare("SELECT base_delta FROM article_format_base_movements WHERE event_id='return2'").get() as {base_delta:number}).base_delta,0);
});
test('damaged return has no net physical restock; missing policy and forged price/snapshot reject',async t => {
  const {store,db}=await fixture(t);await store.commitLocalEvent(sale());
  await store.commitLocalEvent(returned('damaged',.5,'DAMAGED'));
  assert.equal((db.prepare("SELECT base_delta FROM article_format_base_movements WHERE event_id='damaged'").get() as {base_delta:number}).base_delta,0);
  const missing=returned('missing',.5);missing.lines[0].physicalReturn=undefined;
  await assert.rejects(store.commitLocalEvent(missing),/POLICY/);
  const forged=returned('forged',.5);forged.lines[0].price=0;
  await assert.rejects(store.commitLocalEvent(forged),/ORIGINAL_LINE/);
  const snapshotChanged=returned('changed',.5);snapshotChanged.lines[0]=freezeLine(snapshotChanged.lines[0],format('box',12));
  await assert.rejects(store.commitLocalEvent(snapshotChanged),/ORIGINAL_LINE/);
});
test('refund before source sale fails without partial writes then succeeds after source arrives',async t => {
  const {store,db}=await fixture(t);
  await assert.rejects(store.commitLocalEvent(returned('before-sale',.5)),/ORIGINAL_LINE/);
  assert.equal((await store.pendingEvents()).length,0);
  await store.commitLocalEvent(sale());await store.commitLocalEvent(returned('before-sale',.5));
  assert.equal((db.prepare('SELECT COUNT(*) n FROM article_format_returns').get() as {n:number}).n,1);
});
test('multi-line failure rolls back event, sales, return and movements together',async t => {
  const {store,db}=await fixture(t);await store.commitLocalEvent(sale());
  const event=returned('atomic',1);event.lines.push({...event.lines[0],cartId:'second-line'});
  await store.commitLocalEvent(event);
  const over=returned('atomic-over',.5);over.lines.push({...over.lines[0],cartId:'second-line'});
  await assert.rejects(store.commitLocalEvent(over),/REFUND_EXCEEDS/);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM article_format_base_movements WHERE event_id='atomic-over'").get() as {n:number}).n,0);
});
test('offline restart then send crash after remote commit replays stable content and ACK once',async t => {
  const folder=mkdtempSync(join(tmpdir(),'clic-formats-fixture-'));t.after(() => rmSync(folder,{recursive:true,force:true}));
  const file=join(folder,'local.db');let {store,db}=await fixture(t,file);await store.commitLocalEvent(sale());db.close();
  ({store,db}=await fixture(t,file));
  const server=new SQLite(':memory:');t.after(() => server.close());
  server.exec('CREATE TABLE inbox(id TEXT PRIMARY KEY,content TEXT); CREATE TABLE movements(id TEXT PRIMARY KEY,qty INTEGER)');
  let failAfterCommit=true;
  const transport: ArticleFormatEventTransport={send:async event => {
    server.transaction(() => {
      const seen=server.prepare('SELECT content FROM inbox WHERE id=?').get(event.eventId) as {content:string}|undefined;
      if (seen) { assert.equal(seen.content,canonicalContent(event)); return; }
      server.prepare('INSERT INTO inbox VALUES (?,?)').run(event.eventId,canonicalContent(event));
      server.prepare('INSERT INTO movements VALUES (?,?)').run(event.eventId,toBaseQuantity(2,24));
    })();
    if (failAfterCommit) {failAfterCommit=false;throw new Error('connection-lost-before-ACK');}
    return {eventId:event.eventId,applied:true};
  }};
  await assert.rejects(drainArticleFormatEvents(store,transport),/connection/);
  assert.equal((await store.pendingEvents()).length,1);
  await Promise.all([drainArticleFormatEvents(store,transport),drainArticleFormatEvents(store,transport)]);
  assert.equal((await store.pendingEvents()).length,0);
  assert.equal((server.prepare('SELECT SUM(qty) n FROM movements').get() as {n:number}).n,48);
  await store.commitLocalEvent(sale());assert.equal((await store.pendingEvents()).length,0);
});
test('incorrect ACK or foreign tenant cannot drain outbox',async t => {
  const {store}=await fixture(t);await store.commitLocalEvent(sale());
  await assert.rejects(drainArticleFormatEvents(store,{send:async () => ({eventId:'other',applied:true})}),/ACK_CONFLICT/);
  await assert.rejects(store.ackEvent({...sale(),scope:{...scope,tenantId:'foreign'}}),/SCOPE/);
  assert.equal((await store.pendingEvents()).length,1);
});
test('historical ticket labels always use snapshot, including flag off and escaped HTML',() => {
  const historical=line();historical.article_formats!.formats[2].factor=12;
  assert.match(articleFormatTicketLabel(historical),/24 base.*48 unidades/);
  const unsafe=freezeLine({...line(),quantity:1}, {...format('box',24),name:'<script>"Caja"</script>'});
  assert.match(articleFormatTicketHTML(unsafe),/&lt;script&gt;/);
  assert.equal(articleFormatTicketLabel({quantity:1}), '');
});
test('selector shows only active permitted context with prices, default and derived availability',() => {
  const value=dto();value.formats.push({...format('private',6),allow_sale:false});value.formats[2].prices=[{tariffId:'retail',price:0}];
  const markup=renderToStaticMarkup(React.createElement(ArticleFormatSelector,{itemName:'Fixture',dto:value,variantId:null,tariffId:'retail',baseTariffPrice:10,stockBase:137,currencySymbol:'$',onSelect:() => {},onClose:() => {}}));
  assert.match(markup,/Disponibles: 5/);assert.match(markup,/\$0.00/);assert.match(markup,/Predeterminada/);
  assert.equal((markup.match(/Formato 6/g)||[]).length,1);
});
test('conditional promotion applies once to chosen commercial line sharing same SKU; base COGS unchanged',() => {
  const box={...line(),originalPrice:240};const unit={...freezeLine({...product(),cartId:'unit-line',quantity:2,price:10,originalPrice:10},format('unit',1))};
  const config={promotions:[{id:'promo',type:'CONDITIONAL_TARGET',targetType:'ALL',benefitValue:50,trigger:{value:1},targetStrategy:{mode:'CHEAPEST_ITEM'},schedule:{isActive:true,days:['D','L','M','X','J','V','S'],startTime:'00:00',endTime:'23:59'}}]} as BusinessConfig;
  const result=applyPromotions([box,unit],config,'fixture-terminal');
  assert.equal(result[0].price,240);assert.equal(result[1].price,5);
  assert.equal(inventoryQuantity(result[0]),48);assert.equal(inventoryQuantity(result[0]) * box.cost!,144);
});

test('existing inventory/COGS engine receives base once and leaves legacy UOM quantities intact',async () => {
  const {processInventoryDeduction} = await import('../utils/inventoryEngine');
  const historical = line();
  const entries = await processInventoryDeduction('fixture-sale',historical,'fixture-wh','fixture-terminal',[product()]);
  assert.equal(entries[0].qtyOut,48);assert.equal(entries[0].unitCost,3);
  assert.equal(entries[0].qtyOut * entries[0].unitCost,144);
  const legacy={...product(),cartId:'old-line',quantity:2,conversionFactor:24};
  assert.equal((await processInventoryDeduction('legacy',legacy,'fixture-wh','fixture-terminal',[product()]))[0].qtyOut,2);
});

test('real ESC/POS fiscal calculation preserves commercial totals, tax, discount and historical label',() => {
  const config={currencySymbol:'$',companyInfo:{name:'Fixture'},taxRate:.18,taxes:[{id:'tax18',name:'ITBIS',rate:.18}],currencies:[]} as BusinessConfig;
  const transaction={id:'fixture-sale',date:'2026-01-01T12:00:00Z',items:[line()],total:0,payments:[],userId:'fixture',userName:'Fixture',status:'COMPLETED',discountAmount:48,isTaxIncluded:false} as import('../types').Transaction;
  const receipt=Buffer.from(buildEscPosTicketPayload(transaction,config)!, 'base64').toString('utf8');
  assert.match(receipt,/24 base/);assert.match(receipt,/48 unidades base/);
  assert.match(receipt,/SUBTOTAL[^\n]*\$432.00/);assert.match(receipt,/ITBIS[^\n]*\$77.76/);assert.match(receipt,/TOTAL[^\n]*\$509.76/);
  const inclusive={...transaction,isTaxIncluded:true};
  const receiptInclusive=Buffer.from(buildEscPosTicketPayload(inclusive,config)!, 'base64').toString('utf8');
  assert.match(receiptInclusive,/SUBTOTAL[^\n]*\$366.10/);assert.match(receiptInclusive,/ITBIS[^\n]*\$65.90/);
});


test('indexed SQLite barcode resolver ignores historic/inactive formats and isolates company',async t => {
  const {store,db}=await fixture(t);const old=dto();old.formats[2].barcode='7501031311309';
  await store.applyMasterPage(page(1,old));
  assert.equal((await store.findBarcode('7501031311309'))?.itemId,'fixture-item');
  const latest=structuredClone(old);latest.formats[2].active=false;
  await store.applyMasterPage(page(2,latest));assert.equal(await store.findBarcode('7501031311309'),null);
  const foreign=new ArticleFormatStore(sqlitePort(db),{...scope,companyId:'foreign'},['retail'],'fixture-terminal');
  assert.equal(await foreign.findBarcode('7501031311309'),null);
});

test('concurrent cumulative refund requests serialize in SQLite and cannot exceed sold base',async t => {
  const {store,db}=await fixture(t);await store.commitLocalEvent(sale());
  const results=await Promise.allSettled([store.commitLocalEvent(returned('race-a',1.5)),store.commitLocalEvent(returned('race-b',1.5))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length,1);
  assert.equal((db.prepare('SELECT SUM(returned_base) n FROM article_format_returns').get() as {n:number}).n,360000);
});

test('failure before local commit leaves no event; failure after ACK survives reopen',async t => {
  const folder=mkdtempSync(join(tmpdir(),'clic-format-ack-fixture-'));t.after(() => rmSync(folder,{recursive:true,force:true}));
  const file=join(folder,'db.sqlite');let {store,db}=await fixture(t,file);
  const invalid=sale();invalid.lines[0].baseQuantity=2;await assert.rejects(store.commitLocalEvent(invalid),/BASE_MISMATCH/);
  assert.equal((await store.pendingEvents()).length,0);
  await store.commitLocalEvent(sale());await store.ackEvent(sale());db.close();
  ({store,db}=await fixture(t,file));await store.commitLocalEvent(sale());
  assert.equal((await store.pendingEvents()).length,0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM article_format_base_movements').get() as {n:number}).n,1);
});


test('variant selection respects name/id attribute keys and rejects ambiguous or incomplete contexts',() => {
  const p=product();p.attributes=[{id:'color-id',name:'Color',options:['Red','Blue'],optionCodes:['R','B']}];
  p.variants=[{sku:'red-SKU',barcode:[],attributeValues:{Color:'Red'},price:10},{sku:'blue-SKU',barcode:[],attributeValues:{'color-id':'Blue'},price:12}];
  assert.equal(selectedVariantId(p,{'color-id':'Red'}),'red-SKU');
  assert.equal(selectedVariantId(p,{'color-id':'Blue'}),'blue-SKU');
  assert.equal(selectedVariantId(p,{}),undefined);
  p.variants.push({...p.variants[0],sku:'red-duplicate'});
  assert.equal(selectedVariantId(p,{'color-id':'Red'}),undefined);
});

test('legacy network adapters reject imported format events before fetch and sequence effects',async t => {
  const {apiSyncAdapter}=await import('../services/sync/ApiSyncAdapter');
  let fetches=0;t.mock.method(globalThis,'fetch',async () => {fetches++;throw new Error('unexpected network');});
  await assert.rejects(apiSyncAdapter.pushTransaction({...sale(),items:[line()]}),/UNSUPPORTED/);
  await assert.rejects(apiSyncAdapter.push('transactions',[{items:[line()]}]),/UNSUPPORTED/);
  const {transactionService}=await import('../services/transactionService');
  await assert.rejects(transactionService.createTransaction({items:[line()]}),/NOT_NEGOTIATED/);
  assert.equal(fetches,0);
});


test('legacy collection full/delta/history reads reject the entire mixed batch before returning',async t => {
  const {apiSyncAdapter}=await import('../services/sync/ApiSyncAdapter');
  const legacy={id:'fixture-legacy',items:[{id:'fixture-item',quantity:1,price:10}]};
  const formatted={id:'fixture-format',items:[line()]};
  const adapter=apiSyncAdapter as unknown as {config:unknown;authToken:string|null;isOnline:boolean;fetchWithRetry:unknown;ensureAuthenticated:unknown};
  const prior={config:adapter.config,authToken:adapter.authToken,isOnline:adapter.isOnline};
  Object.assign(adapter,{config:{masterUrl:'https://fixture.invalid',terminalId:'fixture'},authToken:'synthetic-test-token',isOnline:true});
  t.after(() => Object.assign(adapter,prior));
  t.mock.method(apiSyncAdapter as never,'fetchWithRetry' as never,(async () => ({ok:true,status:200,json:async () => ({items:[legacy,formatted],version:2,isFullDownload:true,data:{transactions:[legacy,formatted]}})})) as never);
  t.mock.method(apiSyncAdapter as never,'ensureAuthenticated' as never,(async () => {}) as never);
  t.mock.method(apiSyncAdapter as never,'resolveOperationalTarget' as never,(() => null) as never);
  t.mock.method(apiSyncAdapter as never,'canUseLocalMasterSyncFallback' as never,(() => true) as never);
  await assert.rejects(apiSyncAdapter.pull('transactions'),/UNSUPPORTED/);
  adapter.isOnline=true;await assert.rejects(apiSyncAdapter.pullDelta('transactions',1),/UNSUPPORTED/);
  adapter.isOnline=true;await assert.rejects(apiSyncAdapter.pullDelta('transactionHistory',1),/UNSUPPORTED/);
  adapter.isOnline=true;await assert.rejects(apiSyncAdapter.pullHistory('fixture'),/UNSUPPORTED/);
  adapter.isOnline=true;await assert.rejects(apiSyncAdapter.pullPendingTransactions(),/UNSUPPORTED/);
});


test('legacy merge never changes box snapshot/base when unit uses the same SKU, price and modifiers',() => {
  const box={...line(),price:10,modifiers:['fixture']};
  assert.equal(legacyMergeCandidate([box],box.id,10,['fixture']),undefined);
  assert.equal(box.quantity,2);assert.equal(box.baseQuantity,48);
  const unit={...product(),cartId:'legacy-unit',price:10,quantity:1,modifiers:['fixture']};
  assert.equal(legacyMergeCandidate([box,unit],box.id,10,['fixture'])?.cartId,'legacy-unit');
});

test('quick Enter/scanner format sale preserves identity; return rejects before sale or legacy fallback',() => {
  const box=format('box',24);let cart: import('../types').CartItem[]=[];let legacyCalls=0;
  const quickEntry=(selected: ArticleFormat|undefined,returnMode: boolean) => {
    if (!routeQuickFormat(selected,returnMode,f => {cart=addFormatLine(cart,product(),f,2,240,'stable-scan-line');})) legacyCalls++;
  };
  quickEntry(box,false);assert.equal(cart[0].articleFormat?.id,'box');assert.equal(cart[0].baseQuantity,48);
  assert.throws(() => quickEntry(box,true),/ORIGINAL_SALE_REQUIRED/);
  assert.equal(cart.length,1);assert.equal(cart[0].quantity,2);assert.equal(legacyCalls,0);
  quickEntry(undefined,true);assert.equal(legacyCalls,1);
});


test('parent/variant codes resolve authorized base format and never bypass allow_sale; empty masters remain Unit legacy',() => {
  assert.equal(baseCodeFormat(dto(),null)?.id,'unit');
  assert.equal(baseCodeFormat(undefined,null),undefined);
  assert.equal(baseCodeFormat({...dto(),formats:[]},null),undefined);
  const value=dto();value.formats[0].allow_sale=false;
  assert.throws(() => baseCodeFormat(value,null),/NOT_SELLABLE/);
  const variants={...dto(),formats:[format('red-unit',1,'red-SKU'),format('blue-unit',1,'blue-SKU')]};
  assert.equal(baseCodeFormat(variants,'blue-SKU')?.id,'blue-unit');
  assert.throws(() => baseCodeFormat(variants,'unknown'),/NOT_SELLABLE/);
});
