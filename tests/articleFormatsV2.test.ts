import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeFixture,nativeSale,context,id,dto,policy,options} from './articleFormatsNativeFixture';
import {validateWireEvent,wireHash} from '../services/articleFormats/wire';
import {validateWireEventV2,validateContextV2,FORMAT_EVENT_TYPES_V2,type NetworkContextV2,type WireEventV2} from '../services/articleFormats/v2';
import {saleWireLineV2,returnWireLineV2,prepareFormatFinancialCommit,commitFormatOwnedTransaction,getArticleFormatReadinessV2} from '../services/articleFormats/financialV2';
import {ArticleFormatNetworkMaster} from '../services/articleFormats/networkMaster';
import {canonicalContent} from '../services/articleFormats/store';
import {readNativeFormatAuthority} from '../services/articleFormats/nativeV3Financial';
import {INVENTORY_V2_SCHEMA} from '../services/articleFormats/inventoryV2';
import {ArticleFormatPosting} from '../services/articleFormats/posting';
const scope={...context.scope,deviceId:id(50),localId:id(51)};
const ctx:NetworkContextV2={...context,schema_version:2,ingress_version:2,profile:'DOP_ECF_CASH_CLOSE_V2',scope,authority_hash:'a'.repeat(64),session_expires_at:'2099-10-19T00:00:00Z',event_types:[...FORMAT_EVENT_TYPES_V2],events_url:'/api/sync/article-formats/v2/events',inventory_reconciliation:{schema_version:2,supported:true,capability:'article_formats_inventory_reconciliation_v2',readiness_required:true,baselines_url:'/api/sync/article-formats/v2/inventory-baselines',balance_grain:'ITEM_LOCAL_AGGREGATE',quantity_scale:4,reservations_source:'ERP_OMNICHANNEL_V1',coverage_sources:['ARTICLE_FORMAT_V1','ARTICLE_FORMAT_V2','ORDINARY_V3']}};
function sale():WireEventV2{const e=nativeSale();return {...e,schema_version:2,totals:{...e.totals,vat_amount:'0.00',service_charge_amount:'0.00'},profile:'DOP_ECF_CASH_CLOSE_V2',currency:'DOP',event_type:'ARTICLE_FORMAT_SALE_V2',lines:e.lines.map(l=>({...l,line_kind:'PRESENTATION',vat_amount:'0.00',service_charge_amount:'0.00'})),fiscal:{mode:'ECF',ncf_type:'E32',ncf:'E320000000001',issuer_rnc:'101010101',environment:0,fiscal_issuance:{ncf:'E320000000001',ncfType:'E32'},buyer_snapshot:{},permit:{schemaVersion:2,permitId:id(80),transactionId:e.transaction_id,nonce:'n'.repeat(72),createdAt:'2026-10-18T00:00:00Z',expiresAt:'2099-10-19T00:00:00Z',scope:{tenantId:id(1),companyId:id(2),storeId:id(3),terminalId:id(4),deviceId:id(50)},issuerRnc:'101010101',environment:0,authorityHash:'a'.repeat(64),operationKind:'SALE'},birth:{schemaVersion:2,permitId:id(80),transactionId:e.transaction_id,nonce:'n'.repeat(72),checkoutId:id(81)}}};}
test('V2 holds fiscal/operation mismatches and V1 never admits the extension',()=>{
 const e=sale();assert.deepEqual(validateWireEventV2(e),e);assert.throws(()=>validateWireEvent(e),/FIELD_UNSUPPORTED|EVENT_INVALID/);
 for(const change of [(e:WireEventV2)=>{e.fiscal.permit.operationKind='RETURN';},(e:WireEventV2)=>{e.fiscal.birth.transactionId=id(92);},(e:WireEventV2)=>{e.fiscal.ncf='E340000000001';},(e:WireEventV2)=>{e.currency='USD' as 'DOP';}]){const bad=sale();change(bad);assert.throws(()=>validateWireEventV2(bad));}
});
test('BASE_UNIT shares policy and commercial tax math without a fabricated persisted format',()=>{
 const e=sale(),l={...e.lines[0],line_kind:'BASE_UNIT' as const,article_format:null,commercial_quantity:'2',base_quantity:'2'};
 const base=saleWireLineV2(dto,policy,l,e.occurred_at,id(4));assert.equal(base.article_format,null);assert.equal(base.base_quantity,'2');assert.equal(base.commercial_unit_price,'45');assert.equal(base.total_amount,'90.00');
 const zero=saleWireLineV2({...dto,formats:dto.formats.map(f=>({...f,prices:[{tariffId:id(6),price:0}]}))},policy,e.lines[0],e.occurred_at,id(4));assert.equal(zero.commercial_unit_price,'0');
 const historical=returnWireLineV2(e.lines[0],[],'0.5',id(91));assert.equal(historical.base_quantity,'12');assert.equal(historical.total_amount,'-540.00');assert.equal(historical.article_format?.factor,24);
});
test('Android83 compatible JSON path works with structuredClone absent',()=>{
 const old=globalThis.structuredClone;try{Object.defineProperty(globalThis,'structuredClone',{value:undefined,configurable:true,writable:true});assert.deepEqual(validateWireEventV2(sale()),sale());assert.deepEqual(validateContextV2(ctx),ctx);assert.equal(prepareFormatFinancialCommit({event:sale(),context:ctx,options}).event.fiscal.ncf,'E320000000001');}finally{Object.defineProperty(globalThis,'structuredClone',{value:old,configurable:true,writable:true});}
});
test('V2 stays closed with actual native adapter until a physical authority exists, preserving every financial row',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());f.db.prepare('UPDATE article_format_network_sessions SET context=?').run(canonicalContent(ctx));
 const masters=new ArticleFormatNetworkMaster(f.sql,ctx,{request:async()=>{throw Error('unexpected network');}}),before=f.state();let calls=0;
 const hooks={validateAuthority:async()=>{calls++;},consumeFiscalPermit:async()=>{calls++;}};
 assert.equal((await getArticleFormatReadinessV2(f.sql,ctx)).ready,false);
 await assert.rejects(commitFormatOwnedTransaction(f.sql,masters,prepareFormatFinancialCommit({event:sale(),context:ctx,options}),hooks),/INVENTORY_AUTHORITY_UNPROVEN/);assert.equal(calls,0);assert.deepEqual(f.state(),before);
});
test('V2 native same owner commit calls auth+permit once and never creates ordinary outbox; lost COMMIT replay does not consume again',async t=>{
 const f=await nativeFixture();t.after(()=>f.db.close());f.db.prepare('UPDATE article_format_network_sessions SET context=?').run(canonicalContent(ctx));
 // Explicit isolated authority fixture. This is NOT an operational readiness certificate.
 f.db.exec(INVENTORY_V2_SCHEMA);const authority=await readNativeFormatAuthority(f.sql,ctx);f.db.prepare('INSERT INTO article_format_inventory_v2_authority VALUES(1,?,?,?,?,?)').run(ctx.authority_hash,canonicalContent(ctx.scope),ctx.session_expires_at,authority.baseline,'{}');
 f.db.prepare('INSERT INTO article_format_inventory_v2_cells VALUES(?,?)').run(id(7),canonicalContent({kind:'BALANCE',item_id:id(7),warehouse_id:id(5),local_id:id(51),qty_physical:'137.0000',qty_committed:'0.0000',qty_reserved:'0.0000',source:'ERP_STOCK_AND_OMNICHANNEL_V1',source_version:1,source_hash:'a'.repeat(64),disjunction:'TRIVIAL_ZERO_OPERAND'}));
 const masters=new ArticleFormatNetworkMaster(f.sql,ctx,{request:async()=>{throw Error('unexpected network');}});let auth=0,consume=0;
 const hooks={validateAuthority:async()=>{assert.equal(f.db.inTransaction,true);auth++;},consumeFiscalPermit:async()=>{assert.equal(f.db.inTransaction,true);consume++;}};
 const p=new ArticleFormatPosting(f.sql,ctx,masters,hooks),e=sale();f.fault.loseCommitResponse=true;await assert.rejects(p.post(e,options),/COMMIT_UNCERTAIN/);f.fault.loseCommitResponse=false;
 await p.post(e,options);assert.equal(auth,1);assert.equal(consume,1);assert.equal(f.documents('transactions').length,1);assert.equal(f.documents('transactions')[0].ncf,e.fiscal.ncf);assert.equal(f.documents('transactions')[0].fiscalWorkflowBirth.permitId,e.fiscal.permit.permitId);assert.equal((f.db.prepare('SELECT COUNT(*) n FROM sync_outbox_v2').get() as {n:number}).n,0);assert.equal(await f.balance(),89);assert.equal(await wireHash(JSON.parse((f.db.prepare('SELECT content FROM article_format_outbox').get() as {content:string}).content)),await wireHash(e));
});

test('coverage V2 atomically absorbs only the exact original, keeping 137-48 then INCLUDED89 at89',async t=>{
 const {captureInventoryV2,downloadInventoryV2,installInventoryV2,readInventoryV2}=await import('../services/articleFormats/inventoryV2');
 const {postgresJSON,hashText}=await import('../services/articleFormats/wire');
 const f=await nativeFixture();t.after(()=>f.db.close());const e=nativeSale();await f.posting.post(e,options);
 f.db.prepare('UPDATE article_format_network_sessions SET context=?').run(canonicalContent(ctx));f.db.exec(INVENTORY_V2_SCHEMA);
 const capture=await captureInventoryV2(f.sql,ctx);assert.equal(capture.ledger.length,1);assert.equal(capture.originals.length,1);
 const baseline=id(90),receipt=id(91),scope={tenant_id:id(1),company_id:id(2),store_id:id(3),terminal_id:id(4),device_id:id(50),warehouse_id:id(5),local_id:id(51)};
 const rows=[{kind:'BALANCE',item_id:id(7),warehouse_id:id(5),local_id:id(51),qty_physical:'89.0000',qty_committed:'0.0000',qty_reserved:'0.0000',source:'ERP_STOCK_AND_OMNICHANNEL_V1',source_version:1,source_hash:'a'.repeat(64),disjunction:'TRIVIAL_ZERO_OPERAND'},
 {kind:'EVENT',source_kind:'ARTICLE_FORMAT_V1',event_id:e.event_id,canonical_original:postgresJSON(e),content_hash:await wireHash(e),status:'INCLUDED',effects:[{event_id:e.event_id,item_id:id(7),variant_id:null,line_id:e.lines[0].line_id,warehouse_id:id(5),local_id:id(51),delta_base:'-48.0000',movement_id:id(92),movement_key:`${e.event_id}:${e.lines[0].line_id}`,return_policy:null}]}];
 const payload=postgresJSON(rows),checksum=await hashText(payload),m={schema_version:2,receipt_id:receipt,baseline_id:baseline,ordinal:'1',scope,authority_hash:ctx.authority_hash,journal_generation:capture.generation,balance_grain:'ITEM_LOCAL_AGGREGATE',quantity_scale:4,balance_count:1,event_count:1,row_count:2,requested_event_ids:[e.event_id],page_size:100,page_count:1,pages:[{index:0,checksum,row_count:2}],checksum:await hashText(checksum),complete:false};
 const transport={request:async(path:string)=>path.endsWith('/inventory-baselines')?{schema_version:2,baseline_id:baseline,ordinal:'1',scope,authority_hash:ctx.authority_hash,cut_kind:'MATERIALIZED_MVCC',balance_grain:'ITEM_LOCAL_AGGREGATE',quantity_scale:4,balance_count:1}:path.endsWith('/receipts')?m:path.endsWith('/complete')?{...m,complete:true}:{schema_version:2,receipt_id:receipt,baseline_id:baseline,index:0,next_index:null,row_count:2,checksum,canonical_payload_text:payload,rows}};
 const download=await downloadInventoryV2(transport,capture);await installInventoryV2(f.sql,capture,download,async()=>{assert.equal(f.db.inTransaction,true);});
 const stock=await readInventoryV2(f.sql.query,capture.nativeBaseline,[id(7)],id(5));assert.equal(stock![id(7)].physical.toString(),'89');assert.equal(stock![id(7)].available.toString(),'89');
 const prior=f.db.prepare('SELECT * FROM article_format_inventory_v2_authority').all();await assert.rejects(installInventoryV2(f.sql,capture,download,async()=>{}),/ORDINAL_STALE/);assert.deepEqual(f.db.prepare('SELECT * FROM article_format_inventory_v2_authority').all(),prior);
 const bad={request:async(path:string)=>path.endsWith('/pages/0')?{schema_version:2,receipt_id:receipt,baseline_id:baseline,index:0,next_index:null,row_count:2,checksum,canonical_payload_text:'[]',rows:[]}:transport.request(path)};await assert.rejects(downloadInventoryV2(bad,capture),/RECEIPT_INVALID/);assert.deepEqual(f.db.prepare('SELECT * FROM article_format_inventory_v2_authority').all(),prior);
 const stable=download.rows[0].qty_physical;download.rows[0].qty_physical='999.0000';await assert.rejects(installInventoryV2(f.sql,capture,download,async()=>{}),/STAGING_CHANGED/);download.rows[0].qty_physical=stable;
 capture.ledger[0].qtyOut=0;await assert.rejects(installInventoryV2(f.sql,capture,download,async()=>{}),/STAGING_CHANGED/);assert.deepEqual(f.db.prepare('SELECT * FROM article_format_inventory_v2_authority').all(),prior);
 assert.equal((await f.posting.pending()).length,1,'physical receipt preserves the financial Outbox');
});

test('Caja12 net550 +18%ITBIS +10%SERVICE is704 and partial returns preserve each frozen component',()=>{
 const p={...policy,taxes:[{id:id(95),type:'ITBIS',rate:.18},{id:id(96),type:'SERVICE_CHARGE',rate:.1,fiscalAdditionalTaxCode:'001'}],tax_rate:'0.18',service_charge_rate:'0.1',tax_components_version:2 as const,service_charge_base:'NET' as const};
 const master={...dto,formats:dto.formats.map(f=>f.id==='case'?{...f,factor:12,prices:[{tariffId:id(6),price:550}]}:f)};
 const original=saleWireLineV2(master,p,{...sale().lines[0],commercial_quantity:'1',base_quantity:'12'},sale().occurred_at,id(4));
 assert.equal(original.net_amount,'550.00');assert.equal(original.vat_amount,'99.00');assert.equal(original.service_charge_amount,'55.00');assert.equal(original.tax_amount,'154.00');assert.equal(original.total_amount,'704.00');assert.equal(original.base_quantity,'12');
 const a=returnWireLineV2(original,[],'0.3',id(97)),b=returnWireLineV2(original,[a],'0.7',id(98));assert.equal(Number(a.vat_amount)+Number(b.vat_amount),-99);assert.equal(Number(a.service_charge_amount)+Number(b.service_charge_amount),-55);assert.equal(Number(a.total_amount)+Number(b.total_amount),-704);
 const event=sale();event.lines=[original];event.totals={net_amount:'550.00',vat_amount:'99.00',service_charge_amount:'55.00',tax_amount:'154.00',discount_amount:'0.00',total_amount:'704.00'};event.payments[0].amount='704.00';assert.equal(validateWireEventV2(event).totals.total_amount,'704.00');
 const bad={...p,taxes:[{id:id(95),type:'ITBIS',rate:.18},{id:id(96),type:'ITBIS',rate:.1}]};assert.throws(()=>saleWireLineV2(master,bad,event.lines[0],event.occurred_at,id(4)),/SERVICE_CHARGE/);
});
