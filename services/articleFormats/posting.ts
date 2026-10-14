import { ArticleFormatError, snapshot } from './domain';
import { ARTICLE_FORMATS_SCHEMA } from './schema';
import { canonicalContent, type FormatSQL, type FormatStatement } from './store';
import type { ArticleFormatsDTO } from './contract';
import type { NetworkLinePolicy, NetworkMasterRevision } from './networkMaster';
import { AMOUNTS, Money, decimal, requireFormat, validateContext, validateWireEvent, wireHash, validateACK,
  type NetworkContext, type WireLine, type WireEvent, type FormatACK, type FormatTransport, FormatHTTPError } from './wire';

import { ARTICLE_FORMAT_WIRE_SCHEMA } from './schema';
export { ARTICLE_FORMAT_WIRE_SCHEMA } from './schema';
export interface NetworkMasterPort {
 getActiveRevision():Promise<NetworkMasterRevision|undefined>;
 getPolicy(itemId:string,syncId?:string,revision?:number):Promise<{dto:ArticleFormatsDTO;policy:NetworkLinePolicy}|undefined>;
}
export interface LocalPostingOptions {seriesId:string;userId:string;userName:string}
interface SavedWire { content:string;content_hash:string;context:string;policies:string;ack:string|null;attempts:number;next_attempt:number }
function deepFreeze<T>(v:T):T {if(v&&typeof v==='object'){Object.values(v).forEach(deepFreeze);Object.freeze(v);}return v;}
function timeValue(time:string) {
 const m=/^(\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?$/.exec(time);
 requireFormat(m && Number(m[1])<24&&Number(m[2])<60&&Number(m[3]||0)<60,'POS_FORMAT_PROMOTION_FORBIDDEN');
 return new Money(m[1]).mul(3600).plus(new Money(m[2]).mul(60)).plus(`${m[3]||'0'}.${m[4]||'0'}`);
}
const amount=(n:InstanceType<typeof Money>)=>n.toFixed(2);
const assertSame=(a:unknown,b:unknown,code='POS_FORMAT_SOURCE_MISMATCH')=>requireFormat(canonicalContent(a)===canonicalContent(b),code);

/** Builds the wire price and frozen tax/discount amounts from the authenticated revision. */
export function saleWireLine(dto:ArticleFormatsDTO,policy:NetworkLinePolicy,input:{lineId:string;formatId:string;variantId:string|null;tariffId:string;quantity:string;discountRate?:string;promotionId?:string;occurredAt:string;terminalId:string}):WireLine {
 const f=dto.formats.find(f=>f.id===input.formatId&&f.variantId===input.variantId);
 requireFormat(f?.active&&f.allow_sale,'ARTICLE_FORMAT_NOT_SELLABLE');
 requireFormat(input.variantId===null||policy.variant_ids.includes(input.variantId),'ARTICLE_FORMAT_VARIANT_NOT_FOUND');
 const base=policy.base_prices.find(p=>p.tariff_id===input.tariffId&&p.variant_id===input.variantId);
 requireFormat(base,'POS_FORMAT_TARIFF_FORBIDDEN');
 const override=f.prices.find(p=>p.tariffId===input.tariffId);
 const price=override?new Money(String(override.price)):decimal(base.price,4).mul(f.factor);
 const quantity=decimal(input.quantity,4,true),baseQuantity=quantity.mul(f.factor);decimal(baseQuantity.toFixed(),4,true);
 decimal(price.toFixed(),4);decimal(policy.base_unit_cost,6);
 const rate=decimal(input.discountRate??'0',4);requireFormat(rate.lte(decimal(policy.max_discount_rate,4)),'POS_FORMAT_DISCOUNT_FORBIDDEN');
 let promotionRate=new Money(0);
 if(input.promotionId){
  const promo=policy.promotions.find(p=>p.id===input.promotionId);
  const local=new Date(Date.parse(input.occurredAt)-4*3600000),day=local.toISOString().slice(0,10),time=local.toISOString().slice(11,19)+(input.occurredAt.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1]?'.'+input.occurredAt.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)![1]:'');
  const weekday=['D','L','M','X','J','V','S'][local.getUTCDay()];
  requireFormat(promo?.type==='DISCOUNT'&&promo.is_active===true&&(!promo.start_date||day>=String(promo.start_date).slice(0,10))
   &&(!promo.end_date||day<=String(promo.end_date).slice(0,10))&&Array.isArray(promo.terminal_ids)&&(promo.terminal_ids.length===0||promo.terminal_ids.includes(input.terminalId))
   &&(!Array.isArray(promo.schedule_days_of_week)||promo.schedule_days_of_week.length===0||promo.schedule_days_of_week.includes(weekday))
   &&timeValue(time).gte(timeValue(String(promo.schedule_start_time||'00:00:00')))&&timeValue(time).lte(timeValue(String(promo.schedule_end_time||'23:59:59.999999'))),'POS_FORMAT_PROMOTION_FORBIDDEN');
  promotionRate=decimal(String(promo.benefit_value),4);requireFormat(promotionRate.lte(100),'POS_FORMAT_PROMOTION_FORBIDDEN');
 }
 const gross=quantity.mul(price).toDecimalPlaces(2),promoDiscount=gross.mul(promotionRate).div(100).toDecimalPlaces(2);
 const discount=promoDiscount.plus(gross.minus(promoDiscount).mul(rate).div(100).toDecimalPlaces(2));
 const taxRate=decimal(policy.tax_rate,50);requireFormat(taxRate.lte(1),'POS_FORMAT_TAX_PROFILE_UNSUPPORTED');
 const after=gross.minus(discount),net=base.tax_included?after.div(new Money(1).plus(taxRate)).toDecimalPlaces(2):after;
 const tax=base.tax_included?after.minus(net):net.mul(taxRate).toDecimalPlaces(2);
 return {line_id:input.lineId,item_id:dto.item_id,variant_id:input.variantId,article_format:{...snapshot(f),barcode:f.barcode||''},
  tariff_id:input.tariffId,commercial_quantity:input.quantity,commercial_unit_price:price.toFixed(),base_quantity:baseQuantity.toFixed(),
  base_unit_cost:policy.base_unit_cost,discount_rate:input.discountRate??'0',...(input.promotionId?{promotion_id:input.promotionId}:{}),
  net_amount:amount(net),tax_amount:amount(tax),discount_amount:amount(discount),total_amount:amount(net.plus(tax))};
}
export function wireTotals(lines:WireLine[]):WireEvent['totals'] {
 return Object.fromEntries(AMOUNTS.map(k=>[k,amount(lines.reduce((n,l)=>n.plus(l[k]),new Money(0)))])) as unknown as WireEvent['totals'];
}
/** Partial amounts come from historical sale and already committed local returns, never today's master. */
export function returnWireLine(original:WireLine,returns:WireLine[],quantity:string,lineId:string):WireLine {
 const q=decimal(quantity,4,true),sold=decimal(original.commercial_quantity,4,true);
 const used=returns.reduce((n,l)=>n.plus(l.commercial_quantity),new Money(0));
 requireFormat(q.plus(used).lte(sold),'POS_FORMAT_RETURN_EXCEEDS_SOURCE');
 const last=q.plus(used).eq(sold);
 const values=Object.fromEntries(AMOUNTS.filter(k=>k!=='total_amount').map(k=>{
  const consumed=returns.reduce((n,l)=>n.plus(l[k]),new Money(0));
  const n=last?new Money(original[k]).minus(consumed):new Money(original[k]).mul(q).div(sold).toDecimalPlaces(2);
  requireFormat(n.gte(0)&&n.plus(consumed).lte(original[k]),'POS_FORMAT_RETURN_AMOUNT_EXCEEDS_SOURCE');return [k,amount(n)];
 })) as Omit<WireEvent['totals'],'total_amount'>;
 return {...structuredClone(original),line_id:lineId,source_line_id:original.line_id,commercial_quantity:quantity,
  base_quantity:q.mul(original.article_format.factor).toFixed(),...values,total_amount:amount(new Money(values.net_amount).plus(values.tax_amount))};
}

/** SQLite-only posting. All canonical collections and the prepared journal/outbox share ONE native commit. */
export class ArticleFormatPosting {
 readonly context:NetworkContext;
 constructor(private readonly sql:FormatSQL,context:NetworkContext,private readonly masters:NetworkMasterPort){
  this.context=deepFreeze(validateContext(context));requireFormat(sql.runExclusive,'POS_FORMAT_ATOMIC_STORAGE_REQUIRED');
 }
 migrate(){return this.sql.executeSchema('CREATE TABLE IF NOT EXISTS collections(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updatedAt TEXT NOT NULL);'+ARTICLE_FORMATS_SCHEMA+ARTICLE_FORMAT_WIRE_SCHEMA);}
 private scope(){return [this.context.scope.tenantId,this.context.scope.companyId];}
 private async saved(sql:FormatSQL,eventId:string):Promise<SavedWire|undefined>{
  return (await sql.query<SavedWire>(`SELECT o.content,w.content_hash,w.context,w.policies,w.ack,w.attempts,w.next_attempt FROM article_format_wire_events w
   JOIN article_format_outbox o USING(tenant_id,company_id,event_id) WHERE w.tenant_id=? AND w.company_id=? AND w.event_id=?`,[...this.scope(),eventId]))[0];
 }
 async post(input:WireEvent,options:LocalPostingOptions):Promise<any>{
  options=structuredClone(options);
  requireFormat(options.userId && options.userName && options.seriesId,'POS_FORMAT_LOCAL_ACTOR_REQUIRED');
  const event=validateWireEvent(input),content=canonicalContent(event),hash=await wireHash(event);
  return this.sql.runExclusive!(async sql=>{
   const previous=await this.saved(sql,event.event_id);
   if(previous){requireFormat(previous.content===content&&previous.content_hash===hash,'POS_FORMAT_IDENTITY_CONFLICT');return this.document(sql,event.transaction_id);}
   const sale=event.event_type==='ARTICLE_FORMAT_SALE_V1',isVoid=event.event_type==='ARTICLE_FORMAT_VOID_V1';
   const policies:Record<string,NetworkLinePolicy & {cogs_amount?:string}>={};const priorCosts:Record<string,string>={};let original:WireEvent|undefined;
   let returns:WireEvent[]=[];
   if(sale){
    const revision=await this.masters.getActiveRevision();requireFormat(revision,'POS_FORMAT_REVISION_INCOMPLETE');
    assertSame(event.master,{sync_id:revision.syncId,revision:revision.revision},'POS_FORMAT_REVISION_INCOMPLETE');
    assertSame(revision.context,this.context,'POS_FORMAT_NEGOTIATION_CHANGED');
    for(const l of event.lines){
     const master=await this.masters.getPolicy(l.item_id,revision.syncId,revision.revision);requireFormat(master,'POS_FORMAT_MASTER_MISSING');
     policies[l.line_id]=master.policy;
     requireFormat(master.policy.warehouse_id===this.context.scope.warehouseId && this.context.tariff_ids.includes(l.tariff_id),'POS_FORMAT_SCOPE_FORBIDDEN');
     assertSame(l,saleWireLine(master.dto,master.policy,{lineId:l.line_id,formatId:l.article_format.id,variantId:l.variant_id,tariffId:l.tariff_id,
      quantity:l.commercial_quantity,discountRate:l.discount_rate,promotionId:l.promotion_id,occurredAt:event.occurred_at,terminalId:this.context.scope.terminalId}),'POS_FORMAT_PRICE_OR_HISTORY_MISMATCH');
    }
   }else{
    const source=await this.saved(sql,event.source_event_id!);requireFormat(source?.ack,'POS_FORMAT_SOURCE_NOT_CONFIRMED');
    original=validateWireEvent(JSON.parse(source.content));requireFormat(original.event_type==='ARTICLE_FORMAT_SALE_V1');
    const sourceCtx:NetworkContext=JSON.parse(source.context);requireFormat(sourceCtx.scope.warehouseId===this.context.scope.warehouseId && sourceCtx.scope.terminalId===this.context.scope.terminalId && sourceCtx.scope.storeId===this.context.scope.storeId,'POS_FORMAT_SOURCE_FORBIDDEN');
    requireFormat(original.fiscal.mode===event.fiscal.mode,'POS_FORMAT_FISCAL_INVALID');
    requireFormat(original.customer_id===event.customer_id,'POS_FORMAT_SOURCE_MISMATCH');
    const rows=await sql.query<{content:string;policies:string}>(`SELECT o.content,w.policies FROM article_format_outbox o JOIN article_format_wire_events w USING(tenant_id,company_id,event_id)
     WHERE o.tenant_id=? AND o.company_id=? AND json_extract(o.content,'$.source_event_id')=?`,[...this.scope(),event.source_event_id!]);
    returns=rows.map(r=>JSON.parse(r.content));
    for(const row of rows)for(const [lineId,p] of Object.entries(JSON.parse(row.policies)))priorCosts[lineId]=(p as {cogs_amount:string}).cogs_amount;
    const sourcePolicies=JSON.parse(source.policies);
    const sources=new Set<string>();
    for(const l of event.lines){
     requireFormat(!sources.has(l.source_line_id),'POS_FORMAT_LINE_DUPLICATE');sources.add(l.source_line_id!);
     const old=original.lines.find(x=>x.line_id===l.source_line_id);requireFormat(old,'POS_FORMAT_SOURCE_MISMATCH');
     const prior=returns.flatMap(r=>r.lines).filter(x=>x.source_line_id===old.line_id);
     assertSame(l,returnWireLine(old,prior,l.commercial_quantity,l.line_id));policies[l.line_id]=sourcePolicies[old.line_id];
     if(isVoid)requireFormat(prior.length===0 && new Money(l.commercial_quantity).eq(old.commercial_quantity),'POS_FORMAT_VOID_REQUIRES_WHOLE_SALE');
    }
    if(isVoid)requireFormat(event.lines.length===original.lines.length&&returns.length===0,'POS_FORMAT_VOID_REQUIRES_WHOLE_SALE');
   }
   const collection=async(name:string):Promise<any[]>=>{
    const rows=await sql.query<{value:string}>('SELECT value FROM collections WHERE key=?',[name]);
    const parsed=rows[0]?JSON.parse(rows[0].value):[];requireFormat(Array.isArray(parsed),'POS_FORMAT_LOCAL_COLLECTION_INVALID');return parsed;
   };
   const names=['transactions','transactionHistory','payments','internalSequences','globalSequenceCounter','inventoryLedger','productStocks','products'];
   if(event.fiscal.mode==='LEGACY_B')names.push('localFiscalBuffer');
   const values=await Promise.all(names.map(collection));const data=Object.fromEntries(names.map((n,i)=>[n,values[i]]));
   if(event.fiscal.mode==='LEGACY_B'){
    const fiscal=event.fiscal,buffer=data.localFiscalBuffer.find(b=>b.type===fiscal.ncf_type);
    requireFormat(buffer && buffer.terminalId===this.context.scope.terminalId && Number.isSafeInteger(buffer.currentNumber)
     &&buffer.currentNumber>0&&buffer.currentNumber<=buffer.endNumber&&buffer.prefix===fiscal.ncf_type
     &&typeof buffer.expiryDate==='string'&&event.occurred_at.slice(0,10)<=buffer.expiryDate.slice(0,10)
     &&`${buffer.prefix}${String(buffer.currentNumber).padStart(8,'0')}`===fiscal.ncf,'POS_FORMAT_FISCAL_ALLOCATION_REQUIRED');
    buffer.currentNumber++;
   }
   const series=data.internalSequences.find(s=>s.id===options.seriesId);
   requireFormat(series && series.active!==false && (series.documentType===(sale?'TICKET':'REFUND')||series.type===(sale?'TICKET':'REFUND')),'POS_FORMAT_SERIES_FORBIDDEN');
   requireFormat(!series.terminalId||series.terminalId===this.context.scope.terminalId,'POS_FORMAT_SERIES_FORBIDDEN');
   const next=series.nextNumber??1;requireFormat(Number.isSafeInteger(next)&&next>0&&(!series.maxNumber||next<=series.maxNumber),'POS_FORMAT_SEQUENCE_EXHAUSTED');
   const global=data.globalSequenceCounter.find(x=>x.id==='value')||{id:'value',count:0};
   requireFormat(Number.isSafeInteger(global.count)&&global.count>=0&&global.count<Number.MAX_SAFE_INTEGER,'POS_FORMAT_SEQUENCE_EXHAUSTED');
   global.count++;data.globalSequenceCounter=[global];series.nextNumber=next+1;
   const displayId=`${series.prefix||''}${String(next).padStart(series.padding||6,'0')}`;
   requireFormat(!event.display_id||event.display_id===displayId,'POS_FORMAT_DISPLAY_ID_CONFLICT');
   requireFormat(!data.transactions.some(t=>t.id===event.transaction_id)&&!data.transactionHistory.some(t=>t.id===event.transaction_id),'POS_FORMAT_IDENTITY_CONFLICT');
   const multiplier=sale?1:-1;
   const statements:FormatStatement[]=[{statement:'INSERT INTO article_format_wire_write_scope VALUES(1)'},{statement:'INSERT INTO article_format_outbox(tenant_id,company_id,event_id,terminal_id,kind,content) VALUES(?,?,?,?,?,?)',
    values:[...this.scope(),event.event_id,this.context.scope.terminalId,sale?'SALE':isVoid?'VOID':'REFUND',content]}];
   const items=[];
   for(const l of event.lines){
    const product=data.products.find(p=>p.id===l.item_id),policy=policies[l.line_id];
    requireFormat(product && product.isInventoriable!==false&&product.operationalFlags?.trackInventory!==false
     &&!product.operationalFlags?.usesLots&&!product.operationalFlags?.usesSerial&&!product.operationalFlags?.usesSerialNumbers
     &&!product.recipeDetails?.length&&['PRODUCT','PRODUCTO_TERMINADO','',undefined].includes(product.type),'POS_FORMAT_ITEM_PROFILE_UNSUPPORTED');
    const sku=l.variant_id===null?undefined:policy.variant_skus[l.variant_id];
    requireFormat(l.variant_id===null||typeof sku==='string'&&product.variants?.filter(v=>v.sku===sku).length===1,'POS_FORMAT_VARIANT_MAPPING_MISSING');
    const stock=data.productStocks.find(s=>s.productId===l.item_id&&s.warehouseId===this.context.scope.warehouseId);
    requireFormat(stock,'POS_FORMAT_STOCK_BASELINE_MISSING');
    const base=decimal(l.base_quantity,4,true),delta=sale?base.negated():this.context.return_policy==='RESTOCK'?base:new Money(0);
    const balance=new Money(String(stock.quantity)).plus(delta);
    requireFormat(balance.dp()<=4&&balance.abs().lte('99999999999.9999'),'POS_FORMAT_PRECISION_INVALID');
    requireFormat(!sale||product.operationalFlags?.allowNegativeStock===true||balance.gte(stock.qtyCommitted||0),'POS_FORMAT_INSUFFICIENT_STOCK');
    stock.quantity=balance.toNumber();stock.qtyPhysical=stock.quantity;stock.qtyAvailable=balance.minus(stock.qtyCommitted||0).toNumber();stock.updatedAt=event.occurred_at;
    product.stockBalances={...product.stockBalances,[this.context.scope.warehouseId]:stock.quantity};
    product.stock=Object.values(product.stockBalances).reduce((n:number,v:number)=>n+v,0);product.updatedAt=event.occurred_at;
    const old=original?.lines.find(x=>x.line_id===l.source_line_id);
    let cogs=new Money(l.base_quantity).mul(l.base_unit_cost).toDecimalPlaces(2);
    if(old){
     const originalCost=new Money(new Money(old.base_quantity).mul(old.base_unit_cost).toDecimalPlaces(2));
     const prior=returns.flatMap(r=>r.lines).filter(x=>x.source_line_id===old.line_id);
     const used=prior.reduce((n,x)=>n.plus(x.commercial_quantity),new Money(0));
     const consumed=prior.reduce((n,x)=>n.plus(priorCosts[x.line_id]),new Money(0));
     cogs=used.plus(l.commercial_quantity).eq(old.commercial_quantity)?originalCost.minus(consumed)
      :originalCost.mul(l.commercial_quantity).div(old.commercial_quantity).toDecimalPlaces(2);
     requireFormat(cogs.gte(0)&&cogs.plus(consumed).lte(originalCost),'POS_FORMAT_RETURN_AMOUNT_EXCEEDS_SOURCE');
    }
    policies[l.line_id]={...policy,cogs_amount:cogs.toFixed(2)};
    const frozen=canonicalContent(l.article_format),scaled=base.mul(10000).toNumber();requireFormat(Number.isSafeInteger(scaled),'POS_FORMAT_PRECISION_INVALID');
    if(sale)statements.push({statement:'INSERT INTO article_format_sale_lines VALUES(?,?,?,?,?,?,?,?)',values:[...this.scope(),event.event_id,l.line_id,l.item_id,frozen,scaled,canonicalContent(l)]});
    else statements.push({statement:'INSERT INTO article_format_returns VALUES(?,?,?,?,?,?,?,?,?)',values:[...this.scope(),event.event_id,l.line_id,event.source_event_id!,l.source_line_id!,frozen,scaled,this.context.return_policy]});
    statements.push({statement:'INSERT INTO article_format_base_movements VALUES(?,?,?,?,?,?,?,?,?)',values:[...this.scope(),event.event_id,l.line_id,l.item_id,JSON.stringify(l.variant_id),this.context.scope.warehouseId,delta.mul(10000).toNumber(),l.base_unit_cost]});
    const ledgerId=l.line_id;
    requireFormat(!data.inventoryLedger.some(m=>m.id===ledgerId),'POS_FORMAT_IDENTITY_CONFLICT');
    data.inventoryLedger.push({id:ledgerId,productId:l.item_id,warehouseId:this.context.scope.warehouseId,variantId:sku,erpVariantId:l.variant_id,
     concept:sale?'SALE':isVoid?'VOID':'REFUND',documentRef:displayId,createdAt:event.occurred_at,qtyIn:delta.gt(0)?delta.toNumber():0,
     qtyOut:delta.lt(0)?delta.negated().toNumber():0,unitCost:Number(l.base_unit_cost),baseUnitCost:l.base_unit_cost,balanceQty:stock.quantity,
     balanceAvgCost:product.cost||0,cogsAmount:cogs.toFixed(2),reversedCOGS:sale?null:this.context.return_policy==='RESTOCK'?cogs.toFixed(2):'0.00',terminalId:this.context.scope.terminalId,syncStatus:'PENDING',articleFormatEventId:event.event_id,articleFormatLineId:l.line_id,
     articleFormatSnapshot:l.article_format,physicalReturn:sale?null:this.context.return_policy});
    items.push({...product,cartId:l.line_id,quantity:new Money(l.commercial_quantity).mul(multiplier).toNumber(),price:Number(l.commercial_unit_price),
     variantSku:sku,articleFormat:l.article_format,baseQuantity:base.mul(multiplier).toNumber(),formatWireLine:l,formatPolicy:policy});
   }
   const payments=event.payments.map(p=>({id:p.payment_id,transactionId:event.transaction_id,amount:new Money(p.amount).mul(multiplier).toNumber(),method:p.method,
    articleFormatEventId:event.event_id,wirePayment:p}));
   for(const p of payments)requireFormat(!data.payments.some(old=>old.id===p.id),'POS_FORMAT_IDENTITY_CONFLICT');
   data.payments.push(...payments);
   const transaction={id:event.transaction_id,date:event.occurred_at,displayId,globalSequence:global.count,seriesNumber:next,seriesId:options.seriesId,
    documentType:sale?'TICKET':'REFUND',items,payments,total:new Money(event.totals.total_amount).mul(multiplier).toNumber(),
    netAmount:new Money(event.totals.net_amount).mul(multiplier).toNumber(),taxAmount:new Money(event.totals.tax_amount).mul(multiplier).toNumber(),
    discountAmount:new Money(event.totals.discount_amount).mul(multiplier).toNumber(),status:'COMPLETED',terminalId:this.context.scope.terminalId,
    userId:options.userId,userName:options.userName,customerId:event.customer_id,originalTransactionId:original?.transaction_id,
    ...(event.fiscal.mode==='LEGACY_B'?{ncf:event.fiscal.ncf,ncfType:event.fiscal.ncf_type}:{}),
    cloudSyncStatus:'PENDING',articleFormatEventId:event.event_id,articleFormatWire:event};
   if(original){
    const allReturns=[...returns,event].flatMap(r=>r.lines);
    const complete=original.lines.every(l=>allReturns.filter(r=>r.source_line_id===l.line_id)
     .reduce((n,r)=>n.plus(r.commercial_quantity),new Money(0)).eq(l.commercial_quantity));
    for(const name of ['transactions','transactionHistory']){
     const source=data[name].find(t=>t.id===original.transaction_id);requireFormat(source,'POS_FORMAT_LOCAL_SOURCE_MISSING');
     source.status=complete?'REFUNDED':'PARTIAL_REFUND';source.relatedTransactions=[...(source.relatedTransactions||[]),event.transaction_id];
    }
   }
   data.transactions.push(transaction);data.transactionHistory.push(transaction);
   for(const name of names)statements.push({statement:'INSERT OR REPLACE INTO collections(key,value,updatedAt) VALUES(?,?,?)',values:[name,JSON.stringify(data[name]),event.occurred_at]});
   statements.push({statement:'INSERT INTO article_format_wire_events(tenant_id,company_id,event_id,transaction_id,content_hash,context,policies) VALUES(?,?,?,?,?,?,?)',
    values:[...this.scope(),event.event_id,event.transaction_id,hash,canonicalContent(this.context),canonicalContent(policies)]});
   statements.push({statement:'DELETE FROM article_format_wire_write_scope WHERE id=1'});
   await sql.executeAtomic(statements);return transaction;
  });
 }
 private async document(sql:FormatSQL,id:string){const row=(await sql.query<{value:string}>('SELECT value FROM collections WHERE key=?',['transactionHistory']))[0];return row&&JSON.parse(row.value).find(t=>t.id===id);}
 async pending(now=Number.MAX_SAFE_INTEGER):Promise<{event:WireEvent;hash:string;context:NetworkContext;attempts:number}[]>{
  const rows=await this.sql.query<SavedWire>(`SELECT o.content,w.content_hash,w.context,w.attempts FROM article_format_wire_events w
   JOIN article_format_outbox o USING(tenant_id,company_id,event_id) WHERE w.tenant_id=? AND w.company_id=? AND o.state='PENDING' AND w.next_attempt<=? ORDER BY w.rowid`,[...this.scope(),now]);
  return rows.map(r=>({event:validateWireEvent(JSON.parse(r.content)),hash:r.content_hash,context:JSON.parse(r.context),attempts:r.attempts}));
 }
 async acknowledge(event:WireEvent,ack:unknown){
  event=validateWireEvent(event);const candidateACK=structuredClone(ack);
  const hash=await wireHash(event);
  return this.sql.runExclusive!(async sql=>{
   const row=await this.saved(sql,event.event_id);requireFormat(row&&row.content===canonicalContent(event)&&row.content_hash===hash,'POS_FORMAT_ACK_CONFLICT');
   const savedContext:NetworkContext=JSON.parse(row.context);
   const validated=validateACK(candidateACK,event,hash,savedContext.return_policy);
   if(row.ack){assertSame(JSON.parse(row.ack),validated,'POS_FORMAT_ACK_CONFLICT');return;}
   const statements:FormatStatement[]=[{statement:'INSERT INTO article_format_wire_write_scope VALUES(1)'},{statement:'UPDATE article_format_wire_events SET ack=?,last_error=NULL WHERE tenant_id=? AND company_id=? AND event_id=?',values:[canonicalContent(validated),...this.scope(),event.event_id]},
    {statement:"UPDATE article_format_outbox SET state='ACKED' WHERE tenant_id=? AND company_id=? AND event_id=?",values:[...this.scope(),event.event_id]}];
   for(const name of ['transactions','transactionHistory']){
    const row=(await sql.query<{value:string}>('SELECT value FROM collections WHERE key=?',[name]))[0];
    requireFormat(row,'POS_FORMAT_LOCAL_DOCUMENT_MISSING');const docs=JSON.parse(row.value),doc=docs.find(t=>t.id===event.transaction_id);
    requireFormat(doc?.articleFormatEventId===event.event_id,'POS_FORMAT_LOCAL_DOCUMENT_MISSING');
    doc.cloudSyncStatus='SYNCED';doc.cloudSyncedAt=validated.committed_at;doc.articleFormatACK=validated;
    statements.push({statement:'UPDATE collections SET value=? WHERE key=?',values:[JSON.stringify(docs),name]});
   }
   statements.push({statement:'DELETE FROM article_format_wire_write_scope WHERE id=1'});
   await sql.executeAtomic(statements);
  });
 }
 async failed(eventId:string,error:string,retryable:boolean,attempts:number,now=Date.now()){
  const next=retryable?now+Math.min(300000,1000*2**Math.min(attempts,8)):Number.MAX_SAFE_INTEGER;
  await this.sql.executeAtomic([{statement:'UPDATE article_format_wire_events SET attempts=attempts+1,next_attempt=?,last_error=? WHERE tenant_id=? AND company_id=? AND event_id=? AND ack IS NULL',values:[next,error,...this.scope(),eventId]}]);
 }
 /** Explicit recovery after resolving a hold; retains immutable event and all original IDs. */
 async retryHeld(){await this.sql.executeAtomic([{statement:'UPDATE article_format_wire_events SET next_attempt=0 WHERE tenant_id=? AND company_id=? AND ack IS NULL',values:this.scope()}]);}
}
const drains=new WeakMap<ArticleFormatPosting,Promise<void>>();
export function drainFormatWireEvents(store:ArticleFormatPosting,transport:FormatTransport):Promise<void>{
 const running=drains.get(store);if(running)return running;
 const work=(async()=>{
  for(const pending of await store.pending(Date.now())){
   try{
    // ERP admits durable receipt recovery even when new admission is closed.
    // Do not require re-negotiation here: it would strand already applied returns.
    // Physical-policy binding remains an explicit readiness blocker for contract v1.
    const ack=await transport.request(pending.context.events_url,pending.event);
    await store.acknowledge(pending.event,ack);
   }catch(error){
    await store.failed(pending.event.event_id,error instanceof Error?error.message:'POS_FORMAT_RETRY_LATER',
     error instanceof FormatHTTPError?error.retryable:!(error instanceof ArticleFormatError&&error.code==='POS_FORMAT_ACK_PHYSICAL_EFFECT_MISMATCH'),pending.attempts);
   }
  }
 })().finally(()=>drains.delete(store));drains.set(store,work);return work;
}
