import type {PostingContext,PostingEvent} from './v2';
import {readV3Base4Stock} from '../db/V3Base4Stock';
import type {BusinessConfig} from '../../types';
import type { FormatSQL } from './store';
import { requireFormat } from './wire';
import type { FormatLocalDocuments } from './localDocuments';

export interface NativeFormatAuthority {
 binding:string; syncId:string;syncVersion:number; inventorySyncId:string;inventorySyncVersion:number;
 configuration:BusinessConfig;inventoryVersion:number;inventoryCursor:string;baseline:string;warehouseId:string;
}

/** Format revision authenticates price/policy; normalized V3 independently owns physical stock.
 * Their revision IDs are deliberately not equated. Both authorities are frozen on the document. */
export async function readNativeFormatAuthority(sql:FormatSQL,context:PostingContext):Promise<NativeFormatAuthority> {
 const rows=await sql.query<any>(`SELECT o.binding,o.sync_id,o.sync_version,i.sync_id AS inventory_sync_id,
  i.sync_version AS inventory_sync_version,i.inventory_version,i.cursor FROM master_v3_operational_owner o
  JOIN master_v3_state s ON s.singleton=1 AND s.active_sync_id=o.sync_id AND s.active_version=o.sync_version
  JOIN master_v3_inventory_state i ON i.singleton=1 WHERE o.singleton=1`,[]);
 requireFormat(rows.length===1,'POS_FORMAT_STOCK_BASELINE_MISSING');
 const row=rows[0];let identity:unknown;
 try {identity=JSON.parse(row.binding);}catch {throw Error('POS_FORMAT_SCOPE_FORBIDDEN');}
 requireFormat(Array.isArray(identity)&&identity[0]===context.scope.tenantId&&identity[1]===context.scope.terminalId,'POS_FORMAT_SCOPE_FORBIDDEN');
 const configs=await sql.query<{data:string}>("SELECT data FROM documents WHERE collection_name='config' AND doc_id='current'",[]);
 const config=configs[0]&&JSON.parse(configs[0].data);
 const terminal=config?.terminals?.filter((t:any)=>(t.config?.erpTerminalId || t.id)===context.scope.terminalId);
 requireFormat(terminal?.length===1&&terminal[0].config?.erpBinding?.tenantId===context.scope.tenantId
  &&terminal[0].config.erpBinding.companyId===context.scope.companyId
  &&terminal[0].config.currentDeviceId===identity[2]
  &&terminal[0].config.erpBinding.storeId===context.scope.storeId
  &&terminal[0].config.inventoryScope?.defaultSalesWarehouseId===context.scope.warehouseId,'POS_FORMAT_SCOPE_FORBIDDEN');
 if(row.sync_id!==row.inventory_sync_id || row.sync_version!==row.inventory_sync_version){
  const receipts=await sql.query(`SELECT sync_id FROM master_v3_catalog_owners WHERE sync_id=? AND sync_version=?
    AND binding=? AND inventory_sync_id=? AND inventory_sync_version=? AND inventory_version=? AND inventory_cursor=?`,
   [row.sync_id,row.sync_version,row.binding,row.inventory_sync_id,row.inventory_sync_version,row.inventory_version,row.cursor]);
  requireFormat(receipts.length===1,'POS_FORMAT_STOCK_BASELINE_MISSING');
 }
 const baseline=JSON.stringify([row.binding,row.inventory_sync_id,row.inventory_sync_version,row.inventory_version,row.cursor]);
 return {configuration:config,binding:row.binding,syncId:row.sync_id,syncVersion:row.sync_version,inventorySyncId:row.inventory_sync_id,
  inventorySyncVersion:row.inventory_sync_version,inventoryVersion:row.inventory_version,inventoryCursor:row.cursor,
  baseline,warehouseId:context.scope.warehouseId};
}

export async function readNativeFinancialDocuments(sql:FormatSQL,local:FormatLocalDocuments,event:PostingEvent,seriesId:string,authority:NativeFormatAuthority,original?:PostingEvent):Promise<Record<string,any[]>> {
 const ids=[event.transaction_id,...(original ? [original.transaction_id] : [])];
 const data:Record<string,any[]>={};
 const filters:Record<string,string[]>={transactions:ids,transactionHistory:ids,payments:event.payments.map(p=>p.payment_id),
  internalSequences:[seriesId],globalSequenceCounter:['value'],inventoryLedger:event.lines.map(l=>l.line_id)};
 for(const [name,keys] of Object.entries(filters)) data[name]=await local.read(name,keys);
 data.products=[];data.productStocks=[];
 if(event.fiscal.mode==='LEGACY_B'){
  const rows=await sql.query<{doc_id:string}>(`SELECT doc_id FROM documents WHERE collection_name='localFiscalBuffer'
   AND json_extract(data,'$.type')=? AND json_extract(data,'$.terminalId')=? LIMIT 2`,[event.fiscal.ncf_type,JSON.parse(authority.binding)[1]]);
  requireFormat(rows.length===1,'POS_FORMAT_FISCAL_ALLOCATION_REQUIRED');
  data.localFiscalBuffer=await local.read('localFiscalBuffer',rows.map(r=>r.doc_id));
  const buffer=data.localFiscalBuffer[0];
  requireFormat(buffer?.allocationId&&buffer?.fiscalRangeId,'POS_FORMAT_FISCAL_ALLOCATION_REQUIRED');
  data.fiscalAllocations=await local.read('fiscalAllocations',[buffer.allocationId]);
  data.fiscalRanges=await local.read('fiscalRanges',[buffer.fiscalRangeId]);
 }
 for(const itemId of new Set(event.lines.map(l=>l.item_id))){
  const article=await sql.query<{record_json:string}>(`SELECT record_json FROM master_v3_articles WHERE sync_version=?
    AND article_id=? AND active=1 AND sellable=1`,[authority.syncVersion,itemId]);
  const source=original ? data.transactions.find(t=>t.id===original.transaction_id) : undefined;
  if(original) requireFormat(source?.v3InventoryBaseline===authority.baseline,'POS_FORMAT_HISTORICAL_BASELINE_UNAVAILABLE');
  const historical=source?.items.find((l:any)=>l.id===itemId);
  requireFormat(historical || article.length===1&&article[0].record_json,'POS_FORMAT_MASTER_MISSING');
  const raw=historical || JSON.parse(article[0].record_json);
  const variants=await sql.query<{record_json:string}>(`SELECT record_json FROM master_v3_variants WHERE sync_version=? AND article_id=? AND active=1`,[authority.syncVersion,itemId]);
  data.products.push({...raw,isInventoriable:historical ? raw.isInventoriable : raw.inventoriable,variants:historical ? raw.variants : variants.map(v=>JSON.parse(v.record_json))});
  const stock=await readV3Base4Stock(sql.query,authority.baseline,itemId,authority.warehouseId);
  data.productStocks.push({productId:itemId,warehouseId:authority.warehouseId,
   quantity:stock.physical.toNumber(),qtyCommitted:stock.committed.plus(stock.reserved).toNumber()});
 }
 return data;
}
