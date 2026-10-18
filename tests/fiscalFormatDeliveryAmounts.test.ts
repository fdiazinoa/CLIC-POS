/** Synthetic host SQLite fixture; not a grant or deployment certificate for BEB-003. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFixture,nativeSale,context,id,dto,policy,options} from './articleFormatsNativeFixture';
import {canonicalContent} from '../services/articleFormats/store';
import {ArticleFormatNetworkMaster} from '../services/articleFormats/networkMaster';
import {saleWireLineV2} from '../services/articleFormats/financialV2';
import {ArticleFormatPosting} from '../services/articleFormats/posting';
import {readNativeFormatAuthority} from '../services/articleFormats/nativeV3Financial';
import {INVENTORY_V2_SCHEMA} from '../services/articleFormats/inventoryV2';
import {FORMAT_EVENT_TYPES_V2,type NetworkContextV2,type WireEventV2} from '../services/articleFormats/v2';
const ctx:NetworkContextV2={...context,schema_version:2,ingress_version:2,profile:'DOP_ECF_CASH_CLOSE_V2',scope:{...context.scope,deviceId:id(50),localId:id(51)},authority_hash:'a'.repeat(64),session_expires_at:'2099-10-19T00:00:00Z',event_types:[...FORMAT_EVENT_TYPES_V2],events_url:'/api/sync/article-formats/v2/events',inventory_reconciliation:{schema_version:2,supported:true,capability:'article_formats_inventory_reconciliation_v2',readiness_required:true,baselines_url:'/api/sync/article-formats/v2/inventory-baselines',balance_grain:'ITEM_LOCAL_AGGREGATE',quantity_scale:4,reservations_source:'ERP_OMNICHANNEL_V1',coverage_sources:['ARTICLE_FORMAT_V1','ARTICLE_FORMAT_V2','ORDINARY_V3']}};
const master={...dto,formats:[{...dto.formats[0],name:'Unidad',allow_purchase:false,prices:[{tariffId:id(6),price:85}]},{...dto.formats[1],id:'pack',name:'Pack',factor:12,default_sale:true,prices:[{tariffId:id(6),price:250}]}]};
const pricing={...policy,base_prices:[{variant_id:null,tariff_id:id(6),price:'85',tax_included:false}]};
function event(formats:string[],quantities:string[],payments:WireEventV2['payments']):WireEventV2{
 const base=nativeSale();const lines=formats.map((formatId,index)=>saleWireLineV2(master,pricing,{...base.lines[0],line_id:id(120+index),line_kind:'PRESENTATION',commercial_quantity:quantities[index],article_format:{...base.lines[0].article_format!,id:formatId}},base.occurred_at,id(4)));
 const net=lines.reduce((sum,line)=>sum+Number(line.net_amount),0).toFixed(2);
 return {...base,schema_version:2,profile:'DOP_ECF_CASH_CLOSE_V2',currency:'DOP',event_type:'ARTICLE_FORMAT_SALE_V2',lines,payments,totals:{net_amount:net,vat_amount:'0.00',service_charge_amount:'0.00',tax_amount:'0.00',discount_amount:'0.00',total_amount:net},fiscal:{mode:'ECF',ncf_type:'E32',ncf:'E320000000001',issuer_rnc:'101010101',environment:0,fiscal_issuance:{ncf:'E320000000001',ncfType:'E32'},buyer_snapshot:{},permit:{schemaVersion:2,permitId:id(80),transactionId:base.transaction_id,nonce:'n'.repeat(72),createdAt:'2026-10-18T00:00:00Z',expiresAt:'2099-10-19T00:00:00Z',scope:{tenantId:id(1),companyId:id(2),storeId:id(3),terminalId:id(4),deviceId:id(50)},issuerRnc:'101010101',environment:0,authorityHash:'a'.repeat(64),operationKind:'SALE'},birth:{schemaVersion:2,permitId:id(80),transactionId:base.transaction_id,nonce:'n'.repeat(72),checkoutId:id(81)}}};
}
async function fixture(){
 const f=await nativeFixture();f.db.prepare('UPDATE article_format_network_sessions SET context=?').run(canonicalContent(ctx));f.db.prepare('UPDATE article_format_network_policies SET dto=?,policy=?').run(canonicalContent(master),canonicalContent(pricing));
 f.db.exec(INVENTORY_V2_SCHEMA);const authority=await readNativeFormatAuthority(f.sql,ctx);
 f.db.prepare('INSERT INTO article_format_inventory_v2_authority VALUES(1,?,?,?,?,?)').run(ctx.authority_hash,canonicalContent(ctx.scope),ctx.session_expires_at,authority.baseline,'{}');
 f.db.prepare('INSERT INTO article_format_inventory_v2_cells VALUES(?,?)').run(id(7),canonicalContent({kind:'BALANCE',item_id:id(7),warehouse_id:id(5),local_id:id(51),qty_physical:'25.0000',qty_committed:'0.0000',qty_reserved:'0.0000',source:'ERP_STOCK_AND_OMNICHANNEL_V1',source_version:1,source_hash:'a'.repeat(64),disjunction:'TRIVIAL_ZERO_OPERAND'}));
 const masters=new ArticleFormatNetworkMaster(f.sql,ctx,{request:async()=>{throw Error('network-offline');}});let authorizations=0,permits=0;
 const posting=new ArticleFormatPosting(f.sql,ctx,masters,{validateAuthority:async()=>{authorizations++;},consumeFiscalPermit:async()=>{permits++;}});
 return {...f,posting,counts:()=>({authorizations,permits})};
}
for(const methods of [['cash'],['cash','card'],['card','cash']] as const)test(`validated Unit85 + Pack12/250 keeps13BASE/335 and ${methods.join('+')} through native commit/replay offline`,async()=>{
 const f=await fixture();try{
  const payments=methods.map((method,index)=>({payment_id:id(130+index),method,amount:methods.length===1?'335.00':index===0?'100.00':'235.00'}));
  const e=event(['unit','pack'],['1','1'],payments);assert.deepEqual(e.lines.map(l=>[l.base_quantity,l.commercial_unit_price]),[['1','85'],['12','250']]);assert.equal(e.totals.net_amount,'335.00');
  f.fault.loseCommitResponse=true;await assert.rejects(f.posting.post(e,options),/COMMIT_UNCERTAIN/);f.fault.loseCommitResponse=false;await f.posting.post(e,options);
  assert.deepEqual(f.counts(),{authorizations:1,permits:1});assert.equal(f.documents('transactions').length,1);assert.equal(f.documents('transactions')[0].total,335);
  const ledger=f.documents('inventoryLedger');assert.equal(ledger.reduce((sum:any,row:any)=>sum+row.qtyOut,0),13);
  assert.equal((f.db.prepare('SELECT count(*) n FROM article_format_outbox').get() as any).n,1);assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n,0);
  const frozen=JSON.parse((f.db.prepare('SELECT content FROM article_format_outbox').get() as any).content);assert.deepEqual(frozen.payments,payments);assert.deepEqual(frozen.lines,e.lines);
  assert.equal(f.documents('globalSequenceCounter')[0].count,1);
 }finally{f.db.close();}
});
test('two authorized Packs remain24BASE/500; exceeding25BASE is denied without financial effects',async()=>{
 const f=await fixture();try{
  const two=event(['pack'],['2'],[{payment_id:id(130),method:'cash',amount:'500.00'}]);assert.equal(two.lines[0].base_quantity,'24');assert.equal(two.totals.net_amount,'500.00');
  const three=event(['pack'],['3'],[{payment_id:id(130),method:'cash',amount:'750.00'}]);const before=f.state();await assert.rejects(f.posting.post(three,options),/STOCK/);assert.deepEqual(f.state(),before);
  await f.posting.post(two,options);assert.equal(f.documents('inventoryLedger').reduce((sum:any,row:any)=>sum+row.qtyOut,0),24);
 }finally{f.db.close();}
});
