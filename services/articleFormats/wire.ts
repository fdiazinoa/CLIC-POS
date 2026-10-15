import Decimal from 'decimal.js';
import { ArticleFormatError, snapshot } from './domain';
import type { ArticleFormatSnapshot } from './contract';

export const FORMAT_EVENT_TYPES = ['ARTICLE_FORMAT_SALE_V1','ARTICLE_FORMAT_RETURN_V1','ARTICLE_FORMAT_VOID_V1'] as const;
export type PhysicalReturn = 'RESTOCK'|'DAMAGED'|'NO_RETURN';
/** Server-issued authorization. Never compute its fingerprint or replace it on retry. */
export interface ReturnContext {
  schema_version:1;id:string;grant_revision:number;fingerprint:string;return_policy:PhysicalReturn;
}
export interface ReturnAuthorization extends ReturnContext {
  admission_grant_revision:number;admission_fingerprint:string;recovery_id:string|null;
}
export interface NetworkContext {
  contract: 'ARTICLE_FORMATS'; schema_version: 1; ingress_version: 1; master_contract_version: 3;
  profile: 'DOP_SETTLED_REALTIME_V1'; variant_identity: 'ERP_ID'; grant_revision: number;
  scope: {tenantId:string;companyId:string;storeId:string;terminalId:string;warehouseId:string};
  tariff_ids: string[]; return_policy: PhysicalReturn|null;
  return_context_contract_version?:1;return_context_required?:true;return_context_supported?:boolean;return_context?:ReturnContext|null; event_types: typeof FORMAT_EVENT_TYPES[number][];
  inventory_reconciliation?:{schema_version:1;supported:boolean;capability:'article_formats_inventory_reconciliation';readiness_required:true;baselines_url:string;balance_grain?:'ITEM_LOCAL_AGGREGATE';quantity_scale?:4};
  events_url: string; master_sessions_url: string;
}
export interface FormatTransport { request(path:string, body?:unknown):Promise<any> }
export interface WireAmounts { net_amount:string;tax_amount:string;discount_amount:string;total_amount:string }
export interface WireLine extends WireAmounts {
  line_id:string;item_id:string;variant_id:string|null;article_format:ArticleFormatSnapshot & {barcode:string};
  tariff_id:string;commercial_quantity:string;commercial_unit_price:string;base_quantity:string;base_unit_cost:string;
  discount_rate:string;promotion_id?:string;source_line_id?:string;
}
export interface WireEvent {
  schema_version:1;event_id:string;transaction_id:string;event_type:typeof FORMAT_EVENT_TYPES[number];occurred_at:string;
  master?:{sync_id:string;revision:number};source_event_id?:string;return_context?:ReturnContext;customer_id?:string;display_id?:string;
  fiscal:{mode:'NONE'}|{mode:'LEGACY_B';ncf_type:string;ncf:string};lines:WireLine[];
  payments:{payment_id:string;method:'cash'|'card'|'transfer';amount:string}[];totals:WireAmounts;
}
export interface FormatACK {
  schema_version:1;eventId:string;applied:true;disposition:'APPLIED';inbox_id:string;document_id:string;document_code:string;
  inventory_movement_ids:string[];accounting_entry_ids:string[];payment_entry_id:string|null;
  inventory_quantity_unit:'BASE';content_hash:string;committed_at:string;return_authorization?:ReturnAuthorization;
}
export const Money = Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
export function requireFormat(condition:unknown, code='POS_FORMAT_EVENT_INVALID'):asserts condition {
  if (!condition) throw new ArticleFormatError(code);
}
export function uuid(value:unknown):asserts value is string {
  requireFormat(typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),'POS_FORMAT_ID_INVALID');
}
export function decimal(value:unknown,scale:number,positive=false):Decimal {
  requireFormat(typeof value==='string' && /^(0|[1-9]\d{0,10})(\.\d+)?$/.test(value),'POS_FORMAT_DECIMAL_INVALID');
  const n=new Money(value);
  requireFormat(n.dp()<=scale && n.lte('99999999999.9999') && (positive?n.gt(0):n.gte(0)),'POS_FORMAT_PRECISION_INVALID');
  return n;
}
function fields(value:any, names:string[], code='POS_FORMAT_FIELD_UNSUPPORTED') {
  requireFormat(value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>names.includes(k)),code);
}
export function validateReturnContext(value:any):ReturnContext {
  fields(value,['schema_version','id','grant_revision','fingerprint','return_policy']);
  requireFormat(value.schema_version===1 && Number.isSafeInteger(value.grant_revision)&&value.grant_revision>0
    &&typeof value.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(value.fingerprint)
    &&['RESTOCK','DAMAGED','NO_RETURN'].includes(value.return_policy),'POS_FORMAT_RETURN_CONTEXT_INVALID');
  uuid(value.id);return structuredClone(value);
}
/** Legacy negotiation remains usable for sales/history, never authorizes a new RETURN/VOID. */
export function validateContext(ctx:any):NetworkContext {
  requireFormat(ctx?.contract==='ARTICLE_FORMATS' && ctx.schema_version===1 && ctx.ingress_version===1 && ctx.master_contract_version===3
    && ctx.profile==='DOP_SETTLED_REALTIME_V1' && ctx.variant_identity==='ERP_ID' && Number.isSafeInteger(ctx.grant_revision) && ctx.grant_revision>0,'POS_FORMAT_NEGOTIATION_INVALID');
  for(const key of ['tenantId','companyId','storeId','terminalId','warehouseId']) uuid(ctx.scope?.[key]);
  requireFormat(Array.isArray(ctx.tariff_ids) && ctx.tariff_ids.length>0 && new Set(ctx.tariff_ids).size===ctx.tariff_ids.length);
  ctx.tariff_ids.forEach(uuid);
  requireFormat(Array.isArray(ctx.event_types)&&new Set(ctx.event_types).size===ctx.event_types.length
    &&ctx.event_types.includes(FORMAT_EVENT_TYPES[0])&&ctx.event_types.every(t=>FORMAT_EVENT_TYPES.includes(t))
    &&ctx.events_url==='/api/sync/article-formats/v1/events'&&ctx.master_sessions_url==='/api/sync/v3/master-syncs','POS_FORMAT_NEGOTIATION_INVALID');
  const extension=['return_context_contract_version','return_context_required','return_context_supported','return_context'].some(k=>k in ctx);
  if(extension){
    requireFormat(ctx.return_context_contract_version===1&&ctx.return_context_required===true
      &&typeof ctx.return_context_supported==='boolean','POS_FORMAT_RETURN_CONTEXT_VERSION_UNSUPPORTED');
    if(ctx.return_context_supported){
      const rc=validateReturnContext(ctx.return_context);
      requireFormat(rc.grant_revision===ctx.grant_revision&&rc.return_policy===ctx.return_policy
        &&FORMAT_EVENT_TYPES.every(t=>ctx.event_types.includes(t)),'POS_FORMAT_RETURN_CONTEXT_INVALID');
    }else requireFormat(ctx.return_context===null&&ctx.return_policy===null&&ctx.event_types.length===1,'POS_FORMAT_NEGOTIATION_INVALID');
  }else requireFormat(['RESTOCK','DAMAGED','NO_RETURN'].includes(ctx.return_policy),'POS_FORMAT_NEGOTIATION_INVALID');
  if(ctx.inventory_reconciliation!==undefined){
    const r=ctx.inventory_reconciliation;
    requireFormat(r?.schema_version===1&&typeof r.supported==='boolean'&&r.capability==='article_formats_inventory_reconciliation'
      &&r.readiness_required===true&&r.baselines_url==='/api/sync/article-formats/v1/inventory-baselines'
      &&(!r.supported||r.balance_grain==='ITEM_LOCAL_AGGREGATE'&&r.quantity_scale===4),'POS_FORMAT_INVENTORY_NEGOTIATION_INVALID');
  }
  return structuredClone(ctx);
}
/** Checks before any new local posting. Historical Outbox replay does not call this. */
export function authorizedReturnContext(ctx:NetworkContext):ReturnContext {
  requireFormat(ctx.return_context_contract_version===1&&ctx.return_context_required===true
    &&ctx.return_context_supported===true&&FORMAT_EVENT_TYPES.every(t=>ctx.event_types.includes(t)),
    'POS_FORMAT_RETURN_CONTEXT_REQUIRED');
  return validateReturnContext(ctx.return_context);
}
/** Exact ERP wire schema; the internal FormatLocalEvent is deliberately not accepted. */
export function validateWireEvent(input:unknown):WireEvent {
  const e=input as WireEvent;
  requireFormat(new TextEncoder().encode(JSON.stringify(e)).length<=2097152,'POS_FORMAT_EVENT_TOO_LARGE');
  fields(e,['schema_version','event_id','event_type','transaction_id','occurred_at','master','source_event_id','return_context','customer_id','display_id','fiscal','lines','payments','totals']);
  requireFormat(e.schema_version===1 && FORMAT_EVENT_TYPES.includes(e.event_type));uuid(e.event_id);uuid(e.transaction_id);
  requireFormat(typeof e.occurred_at==='string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(e.occurred_at) && Number.isFinite(Date.parse(e.occurred_at)));
  if(e.customer_id!==undefined)uuid(e.customer_id);
  if(e.display_id!==undefined)requireFormat(typeof e.display_id==='string' && e.display_id.length<=100);
  const sale=e.event_type===FORMAT_EVENT_TYPES[0];
  if(sale){fields(e.master,['sync_id','revision']);uuid(e.master.sync_id);requireFormat(Number.isSafeInteger(e.master.revision)&&e.master.revision>0 && e.source_event_id===undefined && e.return_context===undefined);}
  else {uuid(e.source_event_id);requireFormat(e.master===undefined);if(e.return_context!==undefined)validateReturnContext(e.return_context);}
  fields(e.fiscal,['mode','ncf_type','ncf']);
  requireFormat(e.fiscal.mode==='NONE'||e.fiscal.mode==='LEGACY_B','POS_FORMAT_FISCAL_UNSUPPORTED');
  if(e.fiscal.mode==='NONE')requireFormat(!('ncf' in e.fiscal)&&!('ncf_type' in e.fiscal));
  else requireFormat(/^B(?:01|02|04|14|15)\d{8}$/.test(e.fiscal.ncf) && e.fiscal.ncf.slice(0,3)===e.fiscal.ncf_type,'POS_FORMAT_FISCAL_INVALID');
  requireFormat(Array.isArray(e.lines)&&e.lines.length>0&&e.lines.length<=200);
  const ids=new Set<string>();
  for(const l of e.lines){
    fields(l,['line_id','item_id','variant_id','article_format','tariff_id','commercial_quantity','commercial_unit_price','base_quantity','base_unit_cost','discount_rate','promotion_id','net_amount','tax_amount','discount_amount','total_amount','source_line_id']);
    uuid(l.line_id);uuid(l.item_id);uuid(l.tariff_id);requireFormat(!ids.has(l.line_id),'POS_FORMAT_LINE_DUPLICATE');ids.add(l.line_id);
    fields(l.article_format,['schemaVersion','id','variantId','name','abbreviation','factor','barcode']);
    const f=l.article_format;
    requireFormat(f.schemaVersion===1&&typeof f.id==='string'&&f.id.length>0&&f.id.length<=128&&typeof f.name==='string'&&f.name.length>0&&f.name.length<=100
      &&typeof f.abbreviation==='string'&&f.abbreviation.length>0&&f.abbreviation.length<=20&&typeof f.factor==='number'
      &&(f.variantId===null||typeof f.variantId==='string'&&f.variantId.length>0)&&l.variant_id===f.variantId
      &&typeof f.barcode==='string'&&(f.barcode===''||/^\d{13}$/.test(f.barcode)),'POS_FORMAT_SNAPSHOT_INVALID');
    snapshot({...f,barcode:f.barcode||null});
    const q=decimal(l.commercial_quantity,4,true),base=decimal(l.base_quantity,4,true);
    requireFormat(q.mul(f.factor).eq(base),'POS_FORMAT_BASE_MISMATCH');decimal(l.commercial_unit_price,4);decimal(l.base_unit_cost,6);
    requireFormat(decimal(l.discount_rate,4).lte(100));
    for(const k of AMOUNTS)decimal(l[k],2);
    requireFormat(new Money(l.net_amount).plus(l.tax_amount).eq(l.total_amount),'POS_FORMAT_TOTAL_MISMATCH');
    if(l.promotion_id!==undefined)uuid(l.promotion_id);
    if(sale)requireFormat(l.source_line_id===undefined);else uuid(l.source_line_id);
  }
  fields(e.totals,[...AMOUNTS]);
  for(const k of AMOUNTS)requireFormat(e.lines.reduce((n,l)=>n.plus(l[k]),new Money(0)).eq(decimal(e.totals[k],2)),'POS_FORMAT_TOTAL_MISMATCH');
  requireFormat(Array.isArray(e.payments)&&e.payments.length<=20);
  const paymentIds=new Set<string>();
  for(const p of e.payments){fields(p,['payment_id','method','amount']);uuid(p.payment_id);requireFormat(!paymentIds.has(p.payment_id));paymentIds.add(p.payment_id);
    requireFormat(['cash','card','transfer'].includes(p.method),'POS_FORMAT_PAYMENT_UNSUPPORTED');decimal(p.amount,2,true);}
  requireFormat(e.payments.reduce((n,p)=>n.plus(p.amount),new Money(0)).eq(e.totals.total_amount),'POS_FORMAT_FULL_SETTLEMENT_REQUIRED');
  return structuredClone(e);
}
export const AMOUNTS=['net_amount','tax_amount','discount_amount','total_amount'] as const;
/** PostgreSQL jsonb::text canonical form, including its byte-length-first object key order. */
export function postgresJSON(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(postgresJSON).join(', ')}]`;
  if(value && typeof value==='object'){
    const encode=new TextEncoder();
    return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>{
      const x=encode.encode(a),y=encode.encode(b);if(x.length!==y.length)return x.length-y.length;
      for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;
    }).map(([k,v])=>`${JSON.stringify(k)}: ${postgresJSON(v)}`).join(', ')}}`;
  }
  if(typeof value==='number'){requireFormat(Number.isFinite(value));return new Money(value).toFixed();}
  requireFormat(value!==undefined && typeof value!=='bigint'&&typeof value!=='function'&&typeof value!=='symbol');
  return JSON.stringify(value);
}
export async function hashText(text:string):Promise<string>{
  const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
export async function wireHash(event:WireEvent):Promise<string>{return hashText(postgresJSON(event));}
export function validateACK(value:any,event:WireEvent,hash:string,physicalPolicy?:PhysicalReturn):FormatACK {
  requireFormat(value?.schema_version===1 && value.eventId===event.event_id && value.applied===true && value.disposition==='APPLIED'
    &&value.inventory_quantity_unit==='BASE'&&value.content_hash===hash&&typeof value.document_code==='string'&&value.document_code.length>0
    && typeof value.committed_at==='string'&&Number.isFinite(Date.parse(value.committed_at)),'POS_FORMAT_ACK_INVALID');
  uuid(value.inbox_id);uuid(value.document_id);
  for(const key of ['inventory_movement_ids','accounting_entry_ids']){requireFormat(Array.isArray(value[key]));value[key].forEach(uuid);requireFormat(new Set(value[key]).size===value[key].length);}
  const expectedMovements=event.event_type==='ARTICLE_FORMAT_SALE_V1'?event.lines.length
    :event.return_context?event.return_context.return_policy==='RESTOCK'?event.lines.length:0
    :physicalPolicy===undefined?undefined:physicalPolicy==='RESTOCK'?event.lines.length:0;
  requireFormat(expectedMovements===undefined||value.inventory_movement_ids.length===expectedMovements,'POS_FORMAT_ACK_PHYSICAL_EFFECT_MISMATCH');
  requireFormat(value.accounting_entry_ids.length>0,'POS_FORMAT_ACK_INVALID');
  if(value.payment_entry_id!==null)uuid(value.payment_entry_id);
  requireFormat(event.payments.length===0?value.payment_entry_id===null:value.payment_entry_id!==null,'POS_FORMAT_ACK_INVALID');
  if(event.return_context){
    const original=validateReturnContext(event.return_context),auth=value.return_authorization;
    requireFormat(auth&&typeof auth==='object'&&!Array.isArray(auth),'POS_FORMAT_ACK_RETURN_AUTHORIZATION_INVALID');
    fields(auth,['schema_version','id','grant_revision','fingerprint','return_policy','admission_grant_revision','admission_fingerprint','recovery_id'],'POS_FORMAT_ACK_RETURN_AUTHORIZATION_INVALID');
    requireFormat(Object.entries(original).every(([k,v])=>auth[k]===v),'POS_FORMAT_ACK_RETURN_AUTHORIZATION_INVALID');
    requireFormat(Number.isSafeInteger(auth.admission_grant_revision)&&auth.admission_grant_revision>0
      &&typeof auth.admission_fingerprint==='string'&&/^[a-f0-9]{64}$/.test(auth.admission_fingerprint),
      'POS_FORMAT_ACK_RETURN_AUTHORIZATION_INVALID');
    if(auth.recovery_id!==null){try{uuid(auth.recovery_id);}catch{requireFormat(false,'POS_FORMAT_ACK_RETURN_AUTHORIZATION_INVALID');}}
    else requireFormat(auth.admission_grant_revision===original.grant_revision&&auth.admission_fingerprint===original.fingerprint,
      'POS_FORMAT_ACK_RETURN_AUTHORIZATION_INVALID');
  }
  // An old APPLIED event without context keeps its historical ACK, without fabricated authorization.
  return structuredClone(value);
}
export class FormatHTTPError extends Error {
  constructor(readonly status:number,readonly code:string,readonly retryable:boolean){super(code);}
}
/** Only explicitly supplied ERP credentials; never derives scope from request bodies. */
export function createFormatTransport(baseURL:string,credentials:{syncToken:string;terminalId:string;tenantId:string;deviceToken:string;deviceId:string},
  fetcher:typeof fetch=fetch,timeoutMs=15000,options:{negotiateReturnContextV1?:boolean;fixtureInventoryReconciliationV1?:boolean}={}):FormatTransport {
  const origin=new URL(baseURL);
  requireFormat(origin.protocol==='https:' || origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname),'POS_FORMAT_TRANSPORT_INSECURE');
  return {async request(path,body){
    requireFormat(typeof path==='string'&&path.startsWith('/api/sync/')&&!path.startsWith('//'),'POS_FORMAT_URL_INVALID');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetcher(new URL(path,origin),{method:body===undefined?'GET':'POST',signal:controller.signal,redirect:'error',headers:{
        'Authorization':`Bearer ${credentials.syncToken}`,'x-sync-token':credentials.syncToken,'x-terminal-id':credentials.terminalId,
        'x-tenant-id':credentials.tenantId,'x-device-token':credentials.deviceToken,'x-device-id':credentials.deviceId,
        'x-article-formats-contract':'1',...(options.fixtureInventoryReconciliationV1&&/^\/api\/sync\/article-formats\/v1\/(?:negotiate$|inventory-baselines(?:\/|$)|inventory-receipts\/)/.test(path)?{'x-article-formats-inventory-reconciliation':'1'}:{}),...(options.negotiateReturnContextV1&&path==='/api/sync/article-formats/v1/negotiate'?{'x-article-formats-return-context':'1'}:{}),'x-pos-capabilities':'largeMasterSyncV3','Content-Type':'application/json'
      },...(body===undefined?{}:{body:JSON.stringify(body)})});
      const text=await response.text();let result:any;try{result=JSON.parse(text);}catch{throw new FormatHTTPError(response.status,'POS_FORMAT_RESPONSE_INVALID',true);}
      if(response.status===202)throw new FormatHTTPError(202,'POS_FORMAT_SESSION_NOT_READY',true);
      if(!response.ok||result?.status==='error')throw new FormatHTTPError(response.status,result?.code||'POS_FORMAT_RETRY_LATER',result?.retryable===true||response.status>=500||response.status===202);
      return /\/datasets\/[^/]+\/chunks\/\d+(?:\?|$)/.test(path) ? text : result;
    }finally{clearTimeout(timer);}
  }};
}
