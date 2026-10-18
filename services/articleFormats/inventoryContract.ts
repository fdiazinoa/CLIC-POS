import {cloneFormatJSON} from './json';
import {canonicalContent} from './store';
import {Money,hashText,requireFormat,uuid,validateWireEvent,type WireEvent,type FormatTransport} from './wire';

/** Prepared descriptor only. No runtime writes or advertisement consume it. */
export const FORMAT_INVENTORY_READINESS_V1=Object.freeze({schema_version:1,atomic_baseline_replace:true,baseline_grain:'ITEM_LOCAL_AGGREGATE',variant_effect_identity:'ERP_ID',pending_ack_retention:true});
export const FORMAT_INVENTORY_CAPABILITY='article_formats_inventory_reconciliation';
export const INVENTORY_PREFIX='/api/sync/article-formats/v1';
export interface InventoryScope {tenant_id:string;company_id:string;store_id:string;terminal_id:string;device_id:string;warehouse_id:string;local_id:string}
export interface InventoryEffect {event_id:string;line_id:string;item_id:string;variant_id:string|null;warehouse_id:string;local_id:string;movement_id:string|null;movement_key:string|null;delta_base:string;return_policy:'RESTOCK'|'DAMAGED'|'NO_RETURN'|null}
export interface InventoryBalance {kind:'BALANCE';item_id:string;warehouse_id:string;local_id:string;qty_physical:string;qty_committed:string}
export interface InventoryEventResult {kind:'EVENT';event_id:string;content_hash:string;canonical_original:string;status:'INCLUDED'|'NO_PHYSICAL_EFFECT'|'NOT_INCLUDED'|'UNKNOWN';effects:InventoryEffect[]}
export interface InventoryBaseline {schema_version:1;baseline_id:string;ordinal:string;scope:InventoryScope;balance_grain:'ITEM_LOCAL_AGGREGATE';quantity_scale:4;balance_count:number;cut_kind:'MATERIALIZED_MVCC';snapshot_descriptor:string}
export interface InventoryManifest extends Omit<InventoryBaseline,'cut_kind'|'snapshot_descriptor'> {receipt_id:string;journal_generation:string;requested_event_ids:string[];event_count:number;row_count:number;page_size:100;page_count:number;pages:{index:number;checksum:string;row_count:number}[];checksum:string;complete:boolean}
export interface InventoryPage {schema_version:1;receipt_id:string;baseline_id:string;index:number;next_index:number|null;row_count:number;checksum:string;canonical_payload_text:string;rows:(InventoryBalance|InventoryEventResult)[]}
export interface JournalOriginal {event:WireEvent;effects:Omit<InventoryEffect,'movement_id'|'movement_key'>[]}
function fail(condition:unknown,code='POS_FORMAT_INVENTORY_RECEIPT_INVALID'):asserts condition {requireFormat(condition,code);}
export function same(a:unknown,b:unknown){return canonicalContent(a)===canonicalContent(b);}
export function inventoryScope(value:unknown):InventoryScope {
 const s=value as InventoryScope;
 fail(s&&typeof s==='object'&&Object.keys(s).length===7,'POS_FORMAT_INVENTORY_SCOPE_FORBIDDEN');
 for(const key of ['tenant_id','company_id','store_id','terminal_id','warehouse_id','local_id'])uuid(s[key]);
 fail(typeof s.device_id==='string'&&s.device_id.length>0&&s.device_id.length<=512,'POS_FORMAT_INVENTORY_SCOPE_FORBIDDEN');return cloneFormatJSON(s);
}
export function signedBase4(value:unknown){
 fail(typeof value==='string'&&/^-?(?:0|[1-9]\d{0,10})\.\d{4}$/.test(value)&&value!=='-0.0000','POS_FORMAT_PRECISION_INVALID');
 const n=new Money(value);fail(n.abs().lte('99999999999.9999'),'POS_FORMAT_PRECISION_INVALID');return n;
}
const count=(v:unknown,max=50000)=>fail(Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=max);
const hash=(v:unknown)=>fail(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v));
export function validateInventoryNegotiation(value:any){
 fail(value?.schema_version===1&&value.supported===true&&value.capability===FORMAT_INVENTORY_CAPABILITY
  &&value.readiness_required===true&&value.balance_grain==='ITEM_LOCAL_AGGREGATE'&&value.quantity_scale===4
  &&value.baselines_url===`${INVENTORY_PREFIX}/inventory-baselines`,'POS_FORMAT_INVENTORY_READINESS_REQUIRED');
}
export function validateBaseline(v:any,scope:InventoryScope):InventoryBaseline {
 uuid(v?.baseline_id);fail(v.schema_version===1&&typeof v.ordinal==='string'&&/^[1-9]\d*$/.test(v.ordinal)&&v.ordinal.length<=128
  &&same(inventoryScope(v.scope),scope)&&v.balance_grain==='ITEM_LOCAL_AGGREGATE'&&v.quantity_scale===4);
 count(v.balance_count);fail(v.cut_kind==='MATERIALIZED_MVCC'&&typeof v.snapshot_descriptor==='string'&&v.snapshot_descriptor.length>0);return cloneFormatJSON(v);
}
export async function validateManifest(v:any,b:InventoryBaseline,generation:string,ids:string[],complete=false):Promise<InventoryManifest>{
 uuid(v?.receipt_id);fail(v.schema_version===1&&v.baseline_id===b.baseline_id&&v.ordinal===b.ordinal&&same(v.scope,b.scope)
  &&v.balance_grain===b.balance_grain&&v.quantity_scale===4&&v.balance_count===b.balance_count&&v.journal_generation===generation&&v.complete===complete);
 fail(Array.isArray(v.requested_event_ids)&&new Set(v.requested_event_ids).size===ids.length&&v.requested_event_ids.length===ids.length
  &&ids.every(id=>v.requested_event_ids.includes(id)));count(v.event_count,200);fail(v.event_count===ids.length);
 count(v.row_count,50200);fail(v.row_count===v.balance_count+v.event_count&&v.page_size===100);
 count(v.page_count,502);fail(v.page_count===Math.max(1,Math.ceil(v.row_count/100))&&Array.isArray(v.pages)&&v.pages.length===v.page_count);
 let rows=0;for(let i=0;i<v.pages.length;i++){const p=v.pages[i];fail(p.index===i);hash(p.checksum);count(p.row_count,100);
  fail(p.row_count===(i===v.page_count-1?v.row_count-i*100:100));rows+=p.row_count;}
 hash(v.checksum);fail(rows===v.row_count&&await hashText(v.pages.map(p=>p.checksum).join(''))===v.checksum);return cloneFormatJSON(v);
}
export async function validatePage(v:any,m:InventoryManifest,index:number):Promise<InventoryPage>{
 const expected=m.pages[index];fail(expected&&v?.schema_version===1&&v.receipt_id===m.receipt_id&&v.baseline_id===m.baseline_id
  &&v.index===index&&v.next_index===(index+1<m.page_count?index+1:null)&&v.row_count===expected.row_count&&v.checksum===expected.checksum);
 fail(typeof v.canonical_payload_text==='string'&&new TextEncoder().encode(v.canonical_payload_text).length<=128*1024*1024);
 fail(await hashText(v.canonical_payload_text)===expected.checksum);
 let parsed:unknown;try{parsed=JSON.parse(v.canonical_payload_text);}catch{fail(false);}
 fail(Array.isArray(v.rows)&&v.rows.length===v.row_count&&same(parsed,v.rows));return cloneFormatJSON(v);
}
/** Validates all effects against immutable historical quantities, including zero-policy originals. */
export async function validateInventoryRows(m:InventoryManifest,pages:InventoryPage[],originals:JournalOriginal[]){
 fail(pages.length===m.page_count);const balances:InventoryBalance[]=[],results:InventoryEventResult[]=[],cells=new Set<string>(),events=new Set<string>(),movements=new Set<string>();
 const originalsById=new Map(originals.map(o=>[o.event.event_id,o]));let bytes=0;
 for(let i=0;i<pages.length;i++){
  const p=await validatePage(pages[i],m,i);bytes+=new TextEncoder().encode(p.canonical_payload_text).length;
  fail(bytes<=128*1024*1024,'POS_FORMAT_INVENTORY_SOURCE_INCOMPLETE');
  for(const row of p.rows){
   if(row.kind==='BALANCE'){
    uuid(row.item_id);fail(row.warehouse_id===m.scope.warehouse_id&&row.local_id===m.scope.local_id);signedBase4(row.qty_physical);signedBase4(row.qty_committed);
    const cell=JSON.stringify([row.item_id,row.warehouse_id,row.local_id]);fail(!cells.has(cell));cells.add(cell);balances.push(row);continue;
   }
   fail(row.kind==='EVENT'&&!events.has(row.event_id));events.add(row.event_id);const local=originalsById.get(row.event_id);fail(local);
   hash(row.content_hash);fail(typeof row.canonical_original==='string'&&await hashText(row.canonical_original)===row.content_hash);
   let original:WireEvent;try{original=validateWireEvent(JSON.parse(row.canonical_original));}catch{fail(false);}
   fail(same(original!,local.event)&&['INCLUDED','NO_PHYSICAL_EFFECT','NOT_INCLUDED','UNKNOWN'].includes(row.status)&&Array.isArray(row.effects));
   if(row.status==='UNKNOWN'||row.status==='NOT_INCLUDED'){fail(row.effects.length===0);results.push(row);continue;}
   fail(row.effects.length===local.effects.length&&local.effects.length===local.event.lines.length);
   const lines=new Set<string>();
   for(const e of row.effects){
    fail(!lines.has(e.line_id));lines.add(e.line_id);const saved=local.effects.find(l=>l.line_id===e.line_id);fail(saved);
    const {movement_id,movement_key,...effect}=e;fail(same(effect,saved));signedBase4(e.delta_base);
    if(row.status==='NO_PHYSICAL_EFFECT')fail(local.event.event_type!=='ARTICLE_FORMAT_SALE_V1'&&['DAMAGED','NO_RETURN'].includes(e.return_policy!)
     &&e.delta_base==='0.0000'&&movement_id===null&&movement_key===null);
    else {fail(local.event.event_type==='ARTICLE_FORMAT_SALE_V1'||e.return_policy==='RESTOCK');uuid(movement_id);
     fail(movement_key===`${row.event_id}:${e.line_id}`&&!movements.has(movement_id));movements.add(movement_id);}
   }
   results.push(row);
  }
 }
 fail(balances.length===m.balance_count&&results.length===m.event_count&&originals.every(o=>events.has(o.event.event_id)));
 for(const result of results)for(const e of result.effects)fail(cells.has(JSON.stringify([e.item_id,e.warehouse_id,e.local_id])),'POS_FORMAT_INVENTORY_SOURCE_INCOMPLETE');
 return {balances,results};
}
export function inventoryReceiptRequest(generation:string,originals:JournalOriginal[]){
 fail(typeof generation==='string'&&generation.length>0&&generation.length<=128);
 const events=originals.map(o=>o.event);fail(events.length<=200&&new Set(events.map(e=>e.event_id)).size===events.length,'POS_FORMAT_INVENTORY_BACKLOG_LIMIT');
 const body={schema_version:1,journal_generation:generation,events};
 fail(new TextEncoder().encode(JSON.stringify(body)).length<=8*1024*1024,'POS_FORMAT_INVENTORY_BACKLOG_LIMIT');return body;
}
/** Explicitly fixture-only caller; normal runtime has no route to this channel. */
export async function downloadInventoryReceipt(transport:FormatTransport,scope:InventoryScope,generation:string,originals:JournalOriginal[],stage:(manifest:InventoryManifest,page?:InventoryPage)=>Promise<void>){
 const body=inventoryReceiptRequest(generation,originals);
 const negotiation=await transport.request(`${INVENTORY_PREFIX}/negotiate`,{});validateInventoryNegotiation(negotiation?.inventory_reconciliation);
 const baseline=validateBaseline(await transport.request(`${INVENTORY_PREFIX}/inventory-baselines`,{}),scope);
 const manifest=await validateManifest(await transport.request(`${INVENTORY_PREFIX}/inventory-baselines/${baseline.baseline_id}/receipts`,body),baseline,generation,originals.map(o=>o.event.event_id));
 await stage(manifest);const pages:InventoryPage[]=[];
 for(let i=0;i<manifest.page_count;i++){
  const page=await validatePage(await transport.request(`${INVENTORY_PREFIX}/inventory-receipts/${manifest.receipt_id}/pages/${i}`),manifest,i);
  pages.push(page);await stage(manifest,page);
 }
 const rows=await validateInventoryRows(manifest,pages,originals);
 const completed=await validateManifest(await transport.request(`${INVENTORY_PREFIX}/inventory-receipts/${manifest.receipt_id}/complete`,{schema_version:1,pages:manifest.pages.map(({index,checksum})=>({index,checksum}))}),baseline,generation,originals.map(o=>o.event.event_id),true);
 fail(same({...completed,complete:false},manifest));return {manifest:completed,pages,...rows};
}
