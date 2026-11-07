import {compileCompanyDispatchDemand,type DispatchRawItem} from './companyDispatchDemand.js';
import {canonicalDispatchJSON,type DispatchDemand} from '../db/CompanyDispatchEscrowStore';
type RecordValue=Record<string,unknown>;
const record=(v:unknown):RecordValue=>v&&typeof v==='object'&&!Array.isArray(v)?v as RecordValue:{};
const array=(v:unknown):RecordValue[]=>Array.isArray(v)?v.map(record):[];
const requireSource=(ok:unknown,code:string):void=>{if(!ok)throw Error(code);};
/** Recompute actual cart demand from immutable installed issuer bytes. A digest
 * copied from a caller is never evidence that one quota finances these items.
 * Payment/tax authority is checked by its versioned fiscal/commercial layer.
 */
export function assertDispatchFinancedSource(source:RecordValue,demands:DispatchDemand[],rows:RecordValue[],pool:RecordValue,checkoutId:string,transactionId:string):void{
 const contract=record(source.companyDispatchSource),lines=array(contract.lines),items=array(source.items);
 requireSource(source.inventoryEffectsContract==='WAREHOUSE_RESERVATION_V1'&&source.id===transactionId&&contract.schemaVersion===1&&contract.source==='COMPANY_DISPATCH_ESCROW_V1'&&contract.checkoutId===checkoutId&&contract.bindingId===pool.binding_id&&contract.generation===pool.generation&&contract.policyRevision===Number(pool.policy_revision)&&items.length>0&&items.length===lines.length,'DISPATCH_CANONICAL_CHECKOUT_SOURCE_REQUIRED');
 const localRows=new Map(rows.map(row=>[String(row.id),row]));
 const quotas=new Map(rows.map(row=>[String(row.id),JSON.parse(String(row.authority_json)) as RecordValue]));
 const funded=new Map<string,number>(),seen=new Set<string>();
 for(const item of items){
  const cartId=String(item.cartId||'');requireSource(cartId&&!seen.has(cartId),'DISPATCH_CART_LINE_IDENTITY');seen.add(cartId);
  const matches=lines.filter(line=>line.cartId===cartId);requireSource(matches.length===1,'DISPATCH_CART_LINE_IDENTITY');
  const allocations=array(matches[0].quotaAllocations);requireSource(allocations.length>0&&new Set(allocations.map(a=>a.quotaId)).size===allocations.length,'DISPATCH_ISSUED_LINE_QUOTAS_REQUIRED');
  let catalog:RecordValue|undefined;const selected:Array<{quota:RecordValue;quantity:number}>=[];
  for(const allocation of allocations){
   const quota=quotas.get(String(allocation.quotaId)),scope=record(quota?.scope);
   requireSource(quota&&canonicalDispatchJSON(allocation.dimensions)===canonicalDispatchJSON(quota.dimensions)&&allocation.authorityHash===localRows.get(String(allocation.quotaId))?.authority_hash&&allocation.deliveryWitnessHash===localRows.get(String(allocation.quotaId))?.witness_hash&&scope.bindingId===pool.binding_id&&scope.generation===pool.generation&&quota.policyRevision===Number(pool.policy_revision)&&Number.isSafeInteger(allocation.quantityMinor)&&Number(allocation.quantityMinor)>0&&Number(allocation.quantityMinor)%100===0,'DISPATCH_ISSUED_LINE_SCOPE');
   const next=record(quota!.catalogSource);
   const projection=(value:RecordValue)=>canonicalDispatchJSON({commercialItem:value.commercialItem,rawGraph:value.rawGraph,tariffs:value.tariffs,taxes:value.taxes});
   requireSource(!catalog||projection(catalog)===projection(next),'DISPATCH_CATALOG_REVISION_MIXED');catalog=next;
   selected.push({quota:quota!,quantity:Number(allocation.quantityMinor)});
   funded.set(String(allocation.quotaId),(funded.get(String(allocation.quotaId))||0)+Number(allocation.quantityMinor));
  }
  const scope=record(selected[0].quota.scope),root=record(catalog!.commercialItem);
  requireSource(root.id===item.id&&Array.isArray(catalog!.rawGraph),'DISPATCH_ISSUED_GRAPH_REQUIRED');
  if(item.articleFormatSnapshot&&item.articleFormat)requireSource(canonicalDispatchJSON(item.articleFormatSnapshot)===canonicalDispatchJSON(item.articleFormat),'DISPATCH_ISSUED_FORMAT_CONFLICT');
  const compiled=compileCompanyDispatchDemand({scope:{tenantId:String(scope.tenantId),companyId:String(scope.companyId)},items:catalog!.rawGraph as DispatchRawItem[]},{itemId:String(item.id),quantity:Number(item.quantity),variantId:item.variantId as string|undefined,articleFormat:(item.articleFormatSnapshot||item.articleFormat) as Parameters<typeof compileCompanyDispatchDemand>[1]['articleFormat']});
  const quantities=new Map<string,number>();
  for(const {quota,quantity} of selected){const dims=record(quota.dimensions),expected=compiled.demands.find(d=>d.itemId===quota.itemId&&String(d.dimensions.variantId||'')===String(dims.variantId||''));
   requireSource(expected&&(!expected.trackingKind||dims.trackingUnitId)&&(!expected||expected.trackingKind!=='SERIAL'||quantity===1000000),'DISPATCH_PHYSICAL_GRAIN_NOT_FINANCED');
   const key=String(quota.itemId)+'|'+String(dims.variantId||'');quantities.set(key,(quantities.get(key)||0)+quantity);
  }
  requireSource(compiled.demands.every(d=>quantities.get(d.itemId+'|'+String(d.dimensions.variantId||''))===d.quantityMinor),'DISPATCH_PHYSICAL_DEMAND_NOT_FINANCED');
 }
 requireSource(demands.length===funded.size&&demands.every(d=>funded.get(d.quotaId)===d.quantityMinor),'DISPATCH_CHECKOUT_QUOTAS_NOT_FINANCED');
}
