import type {FiscalTaxBreakdownLine} from '../../utils/fiscalBreakdown';
import {cloneFormatJSON} from './json';
import {canonicalContent,type FormatSQL} from './store';
import {saleWireLine,returnWireLine,ArticleFormatPosting,type NetworkMasterPort,type LocalPostingOptions} from './posting';
import {AMOUNTS,Money,requireFormat,uuid,type WireLine,type FormatACK} from './wire';
import {validateContextV2,validateWireEventV2,FORMAT_PROFILE_V2,AMOUNTS_V2,type NetworkContextV2,type WireEventV2,type WireLineV2,type PostingLine,type FormatWorkflowBirthV2} from './v2';
import type {ArticleFormatsDTO} from './contract';
import type {NetworkLinePolicy} from './networkMaster';

export interface FormatPostingV2Hooks {
 /** Revalidate current authenticated session/device/binding and this exact trusted authority INSIDE tx. */
 validateAuthority(tx:FormatSQL,context:NetworkContextV2,event:WireEventV2):Promise<void>;
 /** Consume birth, ECF allocation/number, and source fence using the supplied connection. Must not open/commit a transaction. */
 consumeFiscalPermit(tx:FormatSQL,birth:FormatWorkflowBirthV2,event:WireEventV2,transaction:Record<string,unknown>):Promise<void>;
}
const same=(a:unknown,b:unknown)=>canonicalContent(a)===canonicalContent(b);
/** Same commercial price/tax calculator as V1, with BASE_UNIT represented solely as factor 1 in a calculation view.
 * No virtual format is saved, sent, or added to the ERP master. */
export function saleWireLineV2(dto:ArticleFormatsDTO,policy:NetworkLinePolicy,line:PostingLine,occurredAt:string,terminalId:string):WireLineV2 {
 const kind='line_kind' in line?line.line_kind:'PRESENTATION';
 let pricingDTO=dto,formatId=line.article_format?.id;
 if(kind==='BASE_UNIT'){
  requireFormat(line.article_format===null,'POS_FORMAT_SNAPSHOT_INVALID');
  formatId='__base_calculation_only__';
  pricingDTO={...dto,formats:[{schemaVersion:1,id:formatId,variantId:line.variant_id,name:'BASE',abbreviation:'BASE',factor:1,barcode:'',active:true,is_base:true,default_purchase:false,default_sale:false,allow_purchase:false,allow_sale:true,allow_transfer:false,sort_order:0,prices:[]}]};
 }
 requireFormat(formatId,'POS_FORMAT_SNAPSHOT_INVALID');
 const quoted=saleWireLine(pricingDTO,policy,{lineId:line.line_id,formatId,variantId:line.variant_id,tariffId:line.tariff_id,quantity:line.commercial_quantity,discountRate:line.discount_rate,promotionId:line.promotion_id,occurredAt,terminalId});
 const serviceRate=new Money(policy.service_charge_rate||'0');requireFormat(serviceRate.gte(0)&&serviceRate.lte(1),'POS_FORMAT_TAX_PROFILE_UNSUPPORTED');
 if(serviceRate.gt(0))requireFormat(policy.tax_components_version===2&&policy.service_charge_base==='NET'&&policy.base_prices.find(p=>p.tariff_id===line.tariff_id&&p.variant_id===line.variant_id)?.tax_included===false&&policy.taxes.filter(t=>t.type==='SERVICE_CHARGE'&&t.fiscalAdditionalTaxCode==='001').length===1,'POS_FORMAT_SERVICE_CHARGE_INCLUDED_PROFILE_UNSUPPORTED');
 const service=new Money(quoted.net_amount).mul(serviceRate).toDecimalPlaces(2),vat=new Money(quoted.tax_amount),tax=vat.plus(service);
 return {...quoted,line_kind:kind,article_format:kind==='BASE_UNIT'?null:quoted.article_format,vat_amount:vat.toFixed(2),service_charge_amount:service.toFixed(2),tax_amount:tax.toFixed(2),total_amount:new Money(quoted.net_amount).plus(tax).toFixed(2)};
}
export function returnWireLineV2(original:PostingLine,returns:PostingLine[],quantity:string,lineId:string):WireLineV2 {
 requireFormat('line_kind' in original,'POS_FORMAT_SOURCE_MISMATCH');
 const magnitude=(l:PostingLine):WireLine=>({...l,article_format:l.article_format??{schemaVersion:1,id:'__base_calculation_only__',variantId:l.variant_id,name:'BASE',abbreviation:'BASE',factor:1,barcode:''},...Object.fromEntries(AMOUNTS.map(k=>[k,new Money(l[k]).abs().toFixed(2)]))});
 const quote=returnWireLine(magnitude(original),returns.map(magnitude),quantity,lineId);
 const sold=new Money(original.commercial_quantity),q=new Money(quantity),used=returns.reduce((n,l)=>n.plus(l.commercial_quantity),new Money(0)),last=q.plus(used).eq(sold);
 const component=(k:'vat_amount'|'service_charge_amount')=>{const consumed=returns.reduce((n,l)=>n.plus('line_kind' in l?new Money(l[k]).abs():0),new Money(0));const total=new Money(original[k]).abs();return (last?total.minus(consumed):total.mul(q).div(sold).toDecimalPlaces(2)).negated();};
 const vat=component('vat_amount'),service=component('service_charge_amount'),tax=vat.plus(service),net=new Money(quote.net_amount).negated();
 return {...quote,line_kind:original.line_kind,article_format:original.article_format,...Object.fromEntries(AMOUNTS.map(k=>[k,new Money(quote[k]).negated().toFixed(2)])),vat_amount:vat.toFixed(2),service_charge_amount:service.toFixed(2),tax_amount:tax.toFixed(2),total_amount:net.plus(tax).toFixed(2)};
}
/** Display/accounting projection from the same frozen policy and signed wire amounts.
 * Does not consult current tax masters or change an existing transaction. */
export function formatTaxBreakdownV2(event:WireEventV2,policies:Record<string,NetworkLinePolicy>):FiscalTaxBreakdownLine[]{
 const grouped=new Map<string,{line:FiscalTaxBreakdownLine;amount:InstanceType<typeof Money>;base:InstanceType<typeof Money>}>();
 for(const wire of event.lines){
  const taxes=policies[wire.line_id].taxes;
  requireFormat(taxes.filter(t=>t.type==='ITBIS').length<=1&&taxes.filter(t=>t.type==='SERVICE_CHARGE').length<=1,'POS_FORMAT_TAX_PROFILE_UNSUPPORTED');
  for(const tax of taxes){
   requireFormat(tax.type==='ITBIS'||tax.type==='SERVICE_CHARGE','POS_FORMAT_TAX_PROFILE_UNSUPPORTED');
   const service=tax.type==='SERVICE_CHARGE',type:NonNullable<FiscalTaxBreakdownLine['type']>=service?'SERVICE_CHARGE':'VAT',name=typeof tax.name==='string'&&tax.name.trim()?tax.name:(service?'Servicio':'ITBIS');
   requireFormat(!service||tax.fiscalAdditionalTaxCode==='001','POS_FORMAT_SERVICE_CHARGE_CODE_REQUIRED');
   const group=grouped.get(tax.id)||{line:{id:tax.id,name,rate:tax.rate,type,...(service?{fiscalAdditionalTaxCode:'001' as const}:{}),amount:0,taxableBase:0,total:0,lineCount:0},amount:new Money(0),base:new Money(0)};
   requireFormat(group.line.name===name&&group.line.type===type&&group.line.rate===tax.rate,'POS_FORMAT_TAX_PROFILE_UNSUPPORTED');
   group.amount=group.amount.plus(service?wire.service_charge_amount:wire.vat_amount);group.base=group.base.plus(wire.net_amount);group.line.lineCount++;grouped.set(tax.id,group);
  }
 }
 return [...grouped.values()].map(({line,amount,base})=>({...line,amount:amount.toNumber(),taxableBase:base.toNumber(),total:base.plus(amount).toNumber()}));
}
export interface FormatACKV2 extends Omit<FormatACK,'schema_version'> {
 schema_version:2;profile:typeof FORMAT_PROFILE_V2;fiscal_permit_id:string;ncf:string;accounting_policy:'CASH_CLOSE';deferred_contribution_ids:string[];
}
export function validateACKV2(value:unknown,event:WireEventV2,hash:string):FormatACKV2 {
 const v=value as FormatACKV2;
 requireFormat(v?.schema_version===2&&v.profile===FORMAT_PROFILE_V2&&v.eventId===event.event_id&&v.applied===true&&v.disposition==='APPLIED'&&v.content_hash===hash
  &&v.inventory_quantity_unit==='BASE'&&v.fiscal_permit_id===event.fiscal.permit.permitId&&v.ncf===event.fiscal.ncf&&v.accounting_policy==='CASH_CLOSE'
  &&v.payment_entry_id===null&&Array.isArray(v.accounting_entry_ids)&&v.accounting_entry_ids.length===0&&typeof v.document_code==='string'&&v.document_code.length>0&&Number.isFinite(Date.parse(v.committed_at)),'POS_FORMAT_ACK_INVALID');
 uuid(v.document_id);uuid(v.inbox_id);
 const count=event.event_type==='ARTICLE_FORMAT_SALE_V2'||event.return_context?.return_policy==='RESTOCK'?event.lines.length:0;
 requireFormat(Array.isArray(v.inventory_movement_ids)&&v.inventory_movement_ids.length===count&&new Set(v.inventory_movement_ids).size===count,'POS_FORMAT_ACK_PHYSICAL_EFFECT_MISMATCH');v.inventory_movement_ids.forEach(uuid);
 requireFormat(Array.isArray(v.deferred_contribution_ids)&&v.deferred_contribution_ids.length>0&&new Set(v.deferred_contribution_ids).size===v.deferred_contribution_ids.length,'POS_FORMAT_ACK_INVALID');v.deferred_contribution_ids.forEach(uuid);
 if(event.return_context){const a=v.return_authorization,r=event.return_context;requireFormat(a&&Object.entries(r).every(([k,x])=>a[k as keyof typeof a]===x)
  &&a.admission_grant_revision===r.grant_revision&&a.admission_fingerprint===r.fingerprint&&a.recovery_id===null,'POS_FORMAT_ACK_RETURN_AUTHORIZATION_INVALID');}
 return cloneFormatJSON(v);
}
/** Readiness is derived from persisted authorities under the caller's financial transaction.
 * No setter, feature-flag conversion, or supplied readiness booleans. */
export async function getArticleFormatReadinessV2(sql:FormatSQL,input:NetworkContextV2):Promise<{ready:boolean;reasons:string[]}> {
 const c=validateContextV2(input),reasons:string[]=[];
 if(sql.storageLayout!=='DOCUMENTS'||sql.financialPostingReadiness!=='NATIVE_V3_TRANSACTION')reasons.push('POS_FORMAT_V2_ATOMIC_AUTHORITY_REQUIRED');
 try{
  const active=await sql.query<{context:string}>(`SELECT s.context FROM article_format_network_active a JOIN article_format_network_sessions s USING(tenant_id,company_id,terminal_id,sync_id) WHERE a.tenant_id=? AND a.company_id=? AND a.terminal_id=? AND s.state='COMPLETE'`,[c.scope.tenantId,c.scope.companyId,c.scope.terminalId]);
  if(active.length!==1||!same(JSON.parse(active[0].context),c))reasons.push('POS_FORMAT_REVISION_INCOMPLETE');
  const authority=await sql.query<{authority_hash:string;scope:string;expires_at:string}>(`SELECT authority_hash,scope,expires_at FROM article_format_inventory_v2_authority WHERE singleton=1`,[]);
  if(authority.length!==1||authority[0].authority_hash!==c.authority_hash||!same(JSON.parse(authority[0].scope),c.scope)||Date.parse(authority[0].expires_at)<=Date.now())reasons.push('POS_FORMAT_INVENTORY_AUTHORITY_UNPROVEN');
 }catch{reasons.push('POS_FORMAT_INVENTORY_AUTHORITY_UNPROVEN');}
 return {ready:reasons.length===0,reasons:[...new Set(reasons)]};
}
export function prepareFormatFinancialCommit(input:{event:WireEventV2;context:NetworkContextV2;options:LocalPostingOptions}) {
 const event=validateWireEventV2(input.event),context=validateContextV2(input.context),p=event.fiscal.permit;
 for(const k of ['tenantId','companyId','storeId','terminalId','deviceId'] as const)requireFormat(context.scope[k]===p.scope[k],'POS_FORMAT_SCOPE_FORBIDDEN');
 requireFormat(p.authorityHash===context.authority_hash,'POS_FORMAT_NEGOTIATION_CHANGED');
 return Object.freeze({event,context,options:cloneFormatJSON(input.options)});
}
export async function commitFormatOwnedTransaction(sql:FormatSQL,masters:NetworkMasterPort,prepared:ReturnType<typeof prepareFormatFinancialCommit>,hooks:FormatPostingV2Hooks){
 requireFormat(sql.runFinancial,'POS_FORMAT_ATOMIC_STORAGE_REQUIRED');
 return new ArticleFormatPosting(sql,prepared.context,masters,hooks).post(prepared.event,prepared.options);
}

/** Pure quotation for the explicit refund/void checkout. The writer rechecks all remaining
 * quantities under its native transaction; no network, NCF allocation or business mutation here. */
export function prepareFormatReturnFinancialCommit(input:{original:WireEventV2;priorReturns:WireEventV2[];context:NetworkContextV2;options:LocalPostingOptions;
 permit:import('./v2').FormatFiscalPermitV2;birth:FormatWorkflowBirthV2;eventId:string;occurredAt:string;fiscalIssuance:Record<string,unknown>;
 creditNoteReference:NonNullable<WireEventV2['fiscal']['credit_note_reference']>;quantities:{sourceLineId:string;quantity:string;lineId:string}[];payments:WireEventV2['payments']}){
 const original=validateWireEventV2(input.original),context=validateContextV2(input.context),permit=input.permit;
 requireFormat(original.event_type==='ARTICLE_FORMAT_SALE_V2'&&['RETURN','VOID'].includes(permit.operationKind),'POS_FORMAT_FISCAL_REFERENCE_INVALID');
 const reference=permit.originalReference;
 requireFormat(reference&&reference.transactionId===original.transaction_id&&reference.ncf===original.fiscal.ncf&&reference.issuerRnc===original.fiscal.issuer_rnc&&reference.environment===original.fiscal.environment,'POS_FORMAT_FISCAL_REFERENCE_INVALID');
 const prior=input.priorReturns.map(validateWireEventV2);requireFormat(prior.every(e=>e.source_event_id===original.event_id&&e.event_type!=='ARTICLE_FORMAT_SALE_V2'),'POS_FORMAT_SOURCE_MISMATCH');
 const used=new Set<string>();
 const lines=input.quantities.map(q=>{requireFormat(!used.has(q.sourceLineId),'POS_FORMAT_LINE_DUPLICATE');used.add(q.sourceLineId);const source=original.lines.find(l=>l.line_id===q.sourceLineId);requireFormat(source,'POS_FORMAT_SOURCE_MISMATCH');return returnWireLineV2(source,prior.flatMap(e=>e.lines).filter(l=>l.source_line_id===q.sourceLineId),q.quantity,q.lineId);});
 const totals=Object.fromEntries(AMOUNTS_V2.map(k=>[k,lines.reduce((n,l)=>n.plus(l[k]),new Money(0)).toFixed(2)])) as unknown as WireEventV2['totals'];
 const event:WireEventV2={schema_version:2,profile:FORMAT_PROFILE_V2,currency:'DOP',event_id:input.eventId,transaction_id:permit.transactionId,event_type:permit.operationKind==='VOID'?'ARTICLE_FORMAT_VOID_V2':'ARTICLE_FORMAT_RETURN_V2',occurred_at:input.occurredAt,source_event_id:original.event_id,return_context:context.return_context!,...(original.customer_id?{customer_id:original.customer_id}:{}),
 fiscal:{mode:'ECF',ncf:String(input.fiscalIssuance.ncf||''),ncf_type:'E34',issuer_rnc:permit.issuerRnc,environment:permit.environment,fiscal_issuance:cloneFormatJSON(input.fiscalIssuance),credit_note_reference:cloneFormatJSON(input.creditNoteReference),buyer_snapshot:cloneFormatJSON(original.fiscal.buyer_snapshot),permit:cloneFormatJSON(permit),birth:cloneFormatJSON(input.birth)},lines,payments:cloneFormatJSON(input.payments),totals};
 return prepareFormatFinancialCommit({event,context,options:input.options});
}

/** Bounded checkout quotation; the same frozen revision and every line are re-read by post() under BEGIN. */
export async function prepareFormatSaleFinancialCommit(input:{masters:NetworkMasterPort;context:NetworkContextV2;options:LocalPostingOptions;
 permit:import('./v2').FormatFiscalPermitV2;birth:FormatWorkflowBirthV2;eventId:string;occurredAt:string;fiscalIssuance:Record<string,unknown>;buyer:Record<string,unknown>;customerId?:string;
 lines:{lineId:string;itemId:string;variantId:string|null;tariffId:string;formatId:string|null;quantity:string;discountRate?:string;promotionId?:string}[];payments:WireEventV2['payments']}){
 const context=validateContextV2(input.context),revision=await input.masters.getActiveRevision();requireFormat(revision&&same(revision.context,context),'POS_FORMAT_REVISION_INCOMPLETE');
 const lines:WireLineV2[]=[];
 for(const l of input.lines){const master=await input.masters.getPolicy(l.itemId,revision.syncId,revision.revision);requireFormat(master,'POS_FORMAT_MASTER_MISSING');
  const format=l.formatId===null?null:master.dto.formats.find(f=>f.id===l.formatId&&f.variantId===l.variantId);requireFormat(l.formatId===null||format,'POS_FORMAT_SNAPSHOT_INVALID');
  const quote=saleWireLineV2(master.dto,master.policy,{line_kind:l.formatId===null?'BASE_UNIT':'PRESENTATION',line_id:l.lineId,item_id:l.itemId,variant_id:l.variantId,article_format:format?{schemaVersion:1,id:format.id,variantId:format.variantId,name:format.name,abbreviation:format.abbreviation,factor:format.factor,barcode:format.barcode||''}:null,tariff_id:l.tariffId,commercial_quantity:l.quantity,commercial_unit_price:'0',base_quantity:l.quantity,base_unit_cost:'0',discount_rate:l.discountRate??'0',...(l.promotionId?{promotion_id:l.promotionId}:{}),net_amount:'0',tax_amount:'0',discount_amount:'0',total_amount:'0',vat_amount:'0',service_charge_amount:'0'},input.occurredAt,context.scope.terminalId);
  lines.push(quote);
 }
 const totals=Object.fromEntries(AMOUNTS_V2.map(k=>[k,lines.reduce((n,l)=>n.plus(l[k]),new Money(0)).toFixed(2)])) as unknown as WireEventV2['totals'];
 const event:WireEventV2={schema_version:2,profile:FORMAT_PROFILE_V2,currency:'DOP',event_id:input.eventId,transaction_id:input.permit.transactionId,event_type:'ARTICLE_FORMAT_SALE_V2',occurred_at:input.occurredAt,master:{sync_id:revision.syncId,revision:revision.revision},...(input.customerId?{customer_id:input.customerId}:{}),
 fiscal:{mode:'ECF',ncf:String(input.fiscalIssuance.ncf||''),ncf_type:String(input.fiscalIssuance.ncfType||''),issuer_rnc:input.permit.issuerRnc,environment:input.permit.environment,fiscal_issuance:cloneFormatJSON(input.fiscalIssuance),buyer_snapshot:cloneFormatJSON(input.buyer),permit:cloneFormatJSON(input.permit),birth:cloneFormatJSON(input.birth)},lines,payments:cloneFormatJSON(input.payments),totals};
 return prepareFormatFinancialCommit({event,context,options:input.options});
}
