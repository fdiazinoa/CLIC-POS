import {cloneFormatJSON} from './json';
import { canonicalContent } from './store';
import { AMOUNTS, Money, requireFormat, uuid, validateWireEvent, validateReturnContext, type WireEvent, type WireLine, type NetworkContext, type ReturnContext } from './wire';

export const FORMAT_PROFILE_V2='DOP_ECF_CASH_CLOSE_V2' as const;
export const FORMAT_EVENT_TYPES_V2=['ARTICLE_FORMAT_SALE_V2','ARTICLE_FORMAT_RETURN_V2','ARTICLE_FORMAT_VOID_V2'] as const;
export interface FormatOriginalReferenceV2 {documentId:string;transactionId:string;ncf:string;issuerRnc:string;environment:0|1|2;sourceChecksum:string}
export interface FormatFiscalPermitV2 {
 schemaVersion:2;permitId:string;transactionId:string;nonce:string;createdAt:string;expiresAt:string;
 scope:{tenantId:string;companyId:string;storeId:string;terminalId:string;deviceId:string};
 issuerRnc:string;environment:0|1|2;authorityHash:string;operationKind:'SALE'|'RETURN'|'VOID';originalReference?:FormatOriginalReferenceV2;
}
export interface FormatWorkflowBirthV2 {schemaVersion:2;permitId:string;transactionId:string;nonce:string;checkoutId:string}
export const AMOUNTS_V2=[...AMOUNTS,'vat_amount','service_charge_amount'] as const;
export interface WireLineV2 extends Omit<WireLine,'article_format'> {vat_amount:string;service_charge_amount:string;line_kind:'PRESENTATION'|'BASE_UNIT';article_format:WireLine['article_format']|null}
export interface WireEventV2 extends Omit<WireEvent,'schema_version'|'event_type'|'fiscal'|'lines'|'totals'> {
 schema_version:2;event_type:typeof FORMAT_EVENT_TYPES_V2[number];profile:typeof FORMAT_PROFILE_V2;currency:'DOP';
 fiscal:{mode:'ECF';ncf_type:string;ncf:string;issuer_rnc:string;environment:0|1|2;fiscal_issuance:Record<string,unknown>;buyer_snapshot:Record<string,unknown>;credit_note_reference?:{affected_ncf:string;affected_date:string;modification_code:'1'|'2'|'3'};permit:FormatFiscalPermitV2;birth:FormatWorkflowBirthV2};lines:WireLineV2[];totals:WireEvent['totals'] & {vat_amount:string;service_charge_amount:string};
}
export interface NetworkContextV2 extends Omit<NetworkContext,'schema_version'|'ingress_version'|'profile'|'event_types'|'inventory_reconciliation'> {
 schema_version:2;ingress_version:2;profile:typeof FORMAT_PROFILE_V2;scope:NetworkContext['scope'] & {deviceId:string;localId:string};
 event_types:typeof FORMAT_EVENT_TYPES_V2[number][];authority_hash:string;session_expires_at:string;
 inventory_reconciliation:{schema_version:2;supported:true;capability:'article_formats_inventory_reconciliation_v2';readiness_required:true;baselines_url:string;balance_grain:'ITEM_LOCAL_AGGREGATE';quantity_scale:4;reservations_source:'ERP_OMNICHANNEL_V1';coverage_sources:['ARTICLE_FORMAT_V1','ARTICLE_FORMAT_V2','ORDINARY_V3']};
}
export type PostingEvent=WireEvent|WireEventV2;
export type PostingLine=WireLine|WireLineV2;
export type PostingContext=NetworkContext|NetworkContextV2;
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function exactKeys(v:unknown,allowed:string[]){requireFormat(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k)),'POS_FORMAT_FIELD_UNSUPPORTED');}
export function validatePermitV2(p:FormatFiscalPermitV2,b:FormatWorkflowBirthV2,kind:FormatFiscalPermitV2['operationKind'],transactionId:string){
 exactKeys(p,['schemaVersion','permitId','transactionId','nonce','createdAt','expiresAt','scope','issuerRnc','environment','authorityHash','operationKind','originalReference']);
 exactKeys(b,['schemaVersion','permitId','transactionId','nonce','checkoutId']);
 requireFormat(p?.schemaVersion===2&&b?.schemaVersion===2&&p.operationKind===kind&&p.transactionId===transactionId&&b.transactionId===transactionId
  &&b.permitId===p.permitId&&b.nonce===p.nonce&&typeof p.nonce==='string'&&p.nonce.length===72&&sha(p.authorityHash),'POS_FORMAT_FISCAL_PERMIT_INVALID');
 for(const v of [p.permitId,p.transactionId,b.checkoutId])uuid(v);
 exactKeys(p.scope,['tenantId','companyId','storeId','terminalId','deviceId']);
 for(const k of ['tenantId','companyId','storeId','terminalId'] as const)uuid(p.scope?.[k]);
 requireFormat(typeof p.scope.deviceId==='string'&&p.scope.deviceId.length>0&&p.scope.deviceId.length<=512&&/^\d{9}(?:\d{2})?$/.test(p.issuerRnc)&&[0,1,2].includes(p.environment)
  &&Number.isFinite(Date.parse(p.createdAt))&&Date.parse(p.expiresAt)>Date.parse(p.createdAt),'POS_FORMAT_FISCAL_PERMIT_INVALID');
 if(kind==='SALE')requireFormat(p.originalReference===undefined,'POS_FORMAT_FISCAL_REFERENCE_INVALID');
 else {const r=p.originalReference;exactKeys(r,['documentId','transactionId','ncf','issuerRnc','environment','sourceChecksum']);
  requireFormat(r&&/^E(?:31|32|44|45)\d{10}$/.test(r.ncf)&&r.issuerRnc===p.issuerRnc&&r.environment===p.environment&&sha(r.sourceChecksum),'POS_FORMAT_FISCAL_REFERENCE_INVALID');uuid(r.documentId);uuid(r.transactionId);requireFormat(r.transactionId!==transactionId,'POS_FORMAT_FISCAL_REFERENCE_INVALID');}
}
/** V1 preflight is reused only as a pure precision/shape validator on magnitudes.
 * The validation view is never persisted or transmitted. V1 ingress stays unchanged. */
export function validateWireEventV2(input:unknown):WireEventV2 {
 const e=cloneFormatJSON(input) as WireEventV2;
 exactKeys(e,['schema_version','profile','currency','event_id','event_type','transaction_id','occurred_at','master','source_event_id','return_context','customer_id','display_id','fiscal','lines','payments','totals']);
 requireFormat(e.schema_version===2&&e.profile===FORMAT_PROFILE_V2&&e.currency==='DOP'&&FORMAT_EVENT_TYPES_V2.includes(e.event_type),'POS_FORMAT_VERSION_UNSUPPORTED');
 const sale=e.event_type===FORMAT_EVENT_TYPES_V2[0],kind=sale?'SALE':e.event_type===FORMAT_EVENT_TYPES_V2[1]?'RETURN':'VOID';
 exactKeys(e.fiscal,['mode','ncf_type','ncf','issuer_rnc','environment','fiscal_issuance','buyer_snapshot','credit_note_reference','permit','birth']);
 requireFormat(e.fiscal?.mode==='ECF'&&e.fiscal.ncf.slice(0,3)===e.fiscal.ncf_type
  &&(sale?/^E(?:31|32|44|45)\d{10}$/:/^E34\d{10}$/).test(e.fiscal.ncf),'POS_FORMAT_FISCAL_INVALID');
 validatePermitV2(e.fiscal.permit,e.fiscal.birth,kind,e.transaction_id);
 if(sale)requireFormat(e.fiscal.credit_note_reference===undefined,'POS_FORMAT_FISCAL_REFERENCE_INVALID');
 else{const r=e.fiscal.credit_note_reference;exactKeys(r,['affected_ncf','affected_date','modification_code']);requireFormat(r&&r.affected_ncf===e.fiscal.permit.originalReference?.ncf&&/^\d{4}-\d\d-\d\d$/.test(r.affected_date)&&Number.isFinite(Date.parse(r.affected_date))&&['1','2','3'].includes(r.modification_code),'POS_FORMAT_FISCAL_REFERENCE_INVALID');}
 requireFormat(e.fiscal.issuer_rnc===e.fiscal.permit.issuerRnc&&e.fiscal.environment===e.fiscal.permit.environment,'POS_FORMAT_FISCAL_PERMIT_INVALID');
 const issuance=e.fiscal.fiscal_issuance;
 requireFormat(issuance&&typeof issuance==='object'&&!Array.isArray(issuance)&&issuance.ncf===e.fiscal.ncf&&issuance.ncfType===e.fiscal.ncf_type,'POS_FORMAT_FISCAL_ALLOCATION_REQUIRED');
 requireFormat(Array.isArray(e.lines)&&e.lines.length>0&&Array.isArray(e.payments),'POS_FORMAT_EVENT_INVALID');
 const magnitude=(s:string)=>{requireFormat(typeof s==='string'&&(sale?/^(?:0|[1-9]\d*)(?:\.\d+)?$/:/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).test(s),'POS_FORMAT_DECIMAL_INVALID');const n=new Money(s);requireFormat(sale?n.gte(0):n.lte(0),'POS_FORMAT_REFUND_SIGN_INVALID');return n.abs().toFixed();};
 const lines=e.lines.map(l=>{
  requireFormat(l.line_kind==='PRESENTATION'||l.line_kind==='BASE_UNIT','POS_FORMAT_LINE_KIND_INVALID');
  const {line_kind:lineKind,vat_amount:vat,service_charge_amount:service,...line}=l;
  requireFormat(new Money(magnitude(vat)).plus(magnitude(service)).eq(magnitude(l.tax_amount)),'POS_FORMAT_TAX_COMPONENT_MISMATCH');
  if(lineKind==='BASE_UNIT')requireFormat(line.article_format===null&&new Money(line.base_quantity).eq(line.commercial_quantity),'POS_FORMAT_BASE_MISMATCH');
  else requireFormat(line.article_format!==null,'POS_FORMAT_SNAPSHOT_INVALID');
  // Structural validation token only: no synthetic master or snapshot is stored in the event.
  const f=line.article_format??{schemaVersion:1 as const,id:'__base_validation_only__',variantId:l.variant_id,name:'BASE',abbreviation:'BASE',factor:1,barcode:''};
  return {...line,article_format:f,...Object.fromEntries(AMOUNTS.map(k=>[k,magnitude(l[k])]))};
 });
 for(const key of ['vat_amount','service_charge_amount'] as const)requireFormat(e.lines.reduce((n,l)=>n.plus(l[key]),new Money(0)).eq(e.totals[key]),'POS_FORMAT_TAX_COMPONENT_MISMATCH');
 const view={...e,schema_version:1,event_type:e.event_type.replace('_V2','_V1'),fiscal:{mode:'NONE'},lines,
  payments:e.payments.map(p=>({...p,amount:magnitude(p.amount)})),totals:Object.fromEntries(AMOUNTS.map(k=>[k,magnitude(e.totals[k])]))};
 const {profile:_profile,currency:_currency,...v1View}=view;
 validateWireEvent(v1View);
 requireFormat(new Money(e.totals.total_amount).abs().gt(0),'POS_FORMAT_ZERO_FISCAL_UNSUPPORTED');
 requireFormat(new TextEncoder().encode(JSON.stringify(e)).length<=2097152,'POS_FORMAT_EVENT_TOO_LARGE');
 if(!sale){requireFormat(e.return_context,'POS_FORMAT_RETURN_CONTEXT_REQUIRED');validateReturnContext(e.return_context);}
 return e;
}
export function validateContextV2(input:unknown):NetworkContextV2 {
 const c=cloneFormatJSON(input) as NetworkContextV2;
 requireFormat(c?.contract==='ARTICLE_FORMATS'&&c.schema_version===2&&c.ingress_version===2&&c.master_contract_version===3&&c.profile===FORMAT_PROFILE_V2
  &&c.variant_identity==='ERP_ID'&&sha(c.authority_hash)&&Number.isFinite(Date.parse(c.session_expires_at))&&Number.isSafeInteger(c.grant_revision)&&c.grant_revision>0,'POS_FORMAT_NEGOTIATION_INVALID');
 for(const k of ['tenantId','companyId','storeId','terminalId','warehouseId','localId'] as const)uuid(c.scope?.[k]);
 requireFormat(typeof c.scope.deviceId==='string'&&c.scope.deviceId.length>0&&Array.isArray(c.tariff_ids)&&c.tariff_ids.length>0&&new Set(c.tariff_ids).size===c.tariff_ids.length,'POS_FORMAT_SCOPE_FORBIDDEN');c.tariff_ids.forEach(uuid);
 requireFormat(c.events_url==='/api/sync/article-formats/v2/events'&&c.master_sessions_url==='/api/sync/v3/master-syncs'
  &&canonicalContent(c.event_types)===canonicalContent(FORMAT_EVENT_TYPES_V2)&&c.return_context_contract_version===1&&c.return_context_supported===true&&c.return_context_required===true,'POS_FORMAT_NEGOTIATION_INVALID');
 const rc=validateReturnContext(c.return_context);requireFormat(rc.grant_revision===c.grant_revision&&rc.return_policy===c.return_policy,'POS_FORMAT_RETURN_CONTEXT_CONFLICT');
 const i=c.inventory_reconciliation;
 requireFormat(i?.schema_version===2&&i.supported===true&&i.capability==='article_formats_inventory_reconciliation_v2'&&i.readiness_required===true&&i.balance_grain==='ITEM_LOCAL_AGGREGATE'&&i.quantity_scale===4
  &&i.baselines_url==='/api/sync/article-formats/v2/inventory-baselines'&&i.reservations_source==='ERP_OMNICHANNEL_V1'&&canonicalContent(i.coverage_sources)===canonicalContent(['ARTICLE_FORMAT_V1','ARTICLE_FORMAT_V2','ORDINARY_V3']),'POS_FORMAT_INVENTORY_READINESS_REQUIRED');
 return c;
}
export function v2ReturnContext(c:NetworkContextV2):ReturnContext{return validateReturnContext(validateContextV2(c).return_context);}
