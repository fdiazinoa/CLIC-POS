import Money from 'decimal.js';
import {assertDispatchQuotaTrackingSelection} from '../tracking/TrackingLine';
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
export function assertDispatchFinancedSource(source:RecordValue,demands:DispatchDemand[],rows:RecordValue[],pool:RecordValue,checkoutId:string,transactionId:string,noStockSources:Array<{pin:RecordValue;facts:RecordValue}>=[]):void{
 const contract=record(source.companyDispatchSource),lines=array(contract.lines),items=array(source.items);
 requireSource(source.inventoryEffectsContract==='WAREHOUSE_RESERVATION_V1'&&source.id===transactionId&&contract.schemaVersion===1&&contract.source==='COMPANY_DISPATCH_ESCROW_V1'&&contract.checkoutId===checkoutId&&contract.bindingId===pool.binding_id&&contract.generation===pool.generation&&contract.policyRevision===Number(pool.policy_revision)&&items.length>0&&items.length===lines.length,'DISPATCH_CANONICAL_CHECKOUT_SOURCE_REQUIRED');
 const localRows=new Map(rows.map(row=>[String(row.id),row]));
 const quotas=new Map(rows.map(row=>[String(row.id),JSON.parse(String(row.authority_json)) as RecordValue]));
 const funded=new Map<string,number>(),seen=new Set<string>(),serialUnits=new Set<string>();
 for(const item of items){
  const cartId=String(item.cartId||'');requireSource(cartId&&!seen.has(cartId),'DISPATCH_CART_LINE_IDENTITY');seen.add(cartId);
  const matches=lines.filter(line=>line.cartId===cartId);requireSource(matches.length===1,'DISPATCH_CART_LINE_IDENTITY');
  if(matches[0].noStockSource){const pin=record(matches[0].noStockSource),retained=noStockSources.find(row=>canonicalDispatchJSON(row.pin)===canonicalDispatchJSON(pin));requireSource(retained&&array(matches[0].quotaAllocations).length===0,'DISPATCH_NOSTOCK_PIN_REQUIRED');assertDispatchDirectNoStock(item,pin,retained!.facts,String(source.v3Binding));continue;}
  const allocations=array(matches[0].quotaAllocations);requireSource(allocations.length>0&&new Set(allocations.map(a=>a.quotaId)).size===allocations.length,'DISPATCH_ISSUED_LINE_QUOTAS_REQUIRED');
  let catalog:RecordValue|undefined;const selected:Array<{quota:RecordValue;quantity:number;allocation:RecordValue}>=[];
  for(const allocation of allocations){
   const quota=quotas.get(String(allocation.quotaId)),scope=record(quota?.scope);
   requireSource(quota&&canonicalDispatchJSON(allocation.dimensions)===canonicalDispatchJSON(quota.dimensions)&&allocation.authorityHash===localRows.get(String(allocation.quotaId))?.authority_hash&&allocation.deliveryWitnessHash===localRows.get(String(allocation.quotaId))?.witness_hash&&scope.bindingId===pool.binding_id&&scope.generation===pool.generation&&quota.policyRevision===Number(pool.policy_revision)&&Number.isSafeInteger(allocation.quantityMinor)&&Number(allocation.quantityMinor)>0&&Number(allocation.quantityMinor)%100===0,'DISPATCH_ISSUED_LINE_SCOPE');
   const next=record(quota!.catalogSource);
   const projection=(value:RecordValue)=>canonicalDispatchJSON({commercialItem:value.commercialItem,rawGraph:value.rawGraph,tariffs:value.tariffs,taxes:value.taxes,priceAuthority:value.priceAuthority});
   requireSource(!catalog||projection(catalog)===projection(next),'DISPATCH_CATALOG_REVISION_MIXED');catalog=next;
   selected.push({quota:quota!,quantity:Number(allocation.quantityMinor),allocation});
   funded.set(String(allocation.quotaId),(funded.get(String(allocation.quotaId))||0)+Number(allocation.quantityMinor));
  }
  const scope=record(selected[0].quota.scope),root=record(catalog!.commercialItem);
  requireSource(root.id===item.id&&Array.isArray(catalog!.rawGraph),'DISPATCH_ISSUED_GRAPH_REQUIRED');
  if(item.articleFormatSnapshot&&item.articleFormat)requireSource(canonicalDispatchJSON(item.articleFormatSnapshot)===canonicalDispatchJSON(item.articleFormat),'DISPATCH_ISSUED_FORMAT_CONFLICT');
  const compiled=compileCompanyDispatchDemand({scope:{tenantId:String(scope.tenantId),companyId:String(scope.companyId)},items:catalog!.rawGraph as DispatchRawItem[]},{itemId:String(item.id),quantity:Number(item.quantity),variantId:item.variantId as string|undefined,articleFormat:(item.articleFormatSnapshot||item.articleFormat) as Parameters<typeof compileCompanyDispatchDemand>[1]['articleFormat']});
  if(catalog!.stockSelectionProfile==='DISPATCH_QUOTA_GRAIN_V2'&&compiled.demands.some(d=>d.trackingKind)){
   const selections=array(item.trackingData);requireSource(selections.length===selected.length&&new Set(selections.map(s=>record(s.dispatchQuotaAuthority).quotaId)).size===selections.length,'DISPATCH_TRACKING_SELECTION_CHANGED');
   for(const part of selected){const selection=selections.find(s=>record(s.dispatchQuotaAuthority).quotaId===part.quota.id);requireSource(selection&&selection.cartId===cartId&&selection.itemId===item.id,'DISPATCH_TRACKING_SELECTION_CHANGED');assertDispatchQuotaTrackingSelection(selection as any,part.quota,part.allocation);}
  }
  const quantities=new Map<string,number>();
  for(const {quota,quantity} of selected){const dims=record(quota.dimensions),expected=compiled.demands.find(d=>d.itemId===quota.itemId&&String(d.dimensions.variantId||'')===String(dims.variantId||''));
   requireSource(expected&&(!expected.trackingKind||dims.trackingUnitId)&&(!expected||expected.trackingKind!=='SERIAL'||quantity===1000000),'DISPATCH_PHYSICAL_GRAIN_NOT_FINANCED');
   if(expected?.trackingKind==='SERIAL'){requireSource(!serialUnits.has(String(dims.trackingUnitId)),'DISPATCH_SERIAL_DUPLICATE');serialUnits.add(String(dims.trackingUnitId));}
   const key=String(quota.itemId)+'|'+String(dims.variantId||'');quantities.set(key,(quantities.get(key)||0)+quantity);
  }
  requireSource(compiled.demands.every(d=>quantities.get(d.itemId+'|'+String(d.dimensions.variantId||''))===d.quantityMinor),'DISPATCH_PHYSICAL_DEMAND_NOT_FINANCED');
 }
 requireSource(demands.length===funded.size&&demands.every(d=>funded.get(d.quotaId)===d.quantityMinor),'DISPATCH_CHECKOUT_QUOTAS_NOT_FINANCED');
}

/** Existing V3 records, resolved by the native writer or server retained chunks.
 * A copied UI type/empty allocation array alone cannot establish NO_STOCK. */
export function assertDispatchDirectNoStock(line:RecordValue,pin:RecordValue,facts:RecordValue,binding?:string):void{
 const product=record(facts.product),stamp=record(line.v3SaleAuthority),tariff=record(facts.tariff);
 requireSource(product.id===line.id&&pin.itemId===line.id&&pin.syncId===stamp.syncId&&pin.syncVersion===stamp.syncVersion&&pin.tariffId===stamp.tariffId&&pin.binding===stamp.binding&&(!binding||pin.binding===binding),'DISPATCH_NOSTOCK_PIN_CONFLICT');
 requireSource((product.type==='SERVICE'||product.inventoriable===false)&&product.active===true&&product.sellable===true&&!array(product.recipeDetails).length&&!array(product.modifiers).length&&product.kitInventoryMode!=='COMPONENTS'&&!line.articleFormat&&!line.articleFormatSnapshot&&!line.inventoryPresentation&&!array(line.trackingData).length&&!array(line.recipeDetails).length&&!array(line.modifiers).length&&!array(line.selected_combo_items).length&&!array(line.selected_modifiers).length&&!array(line.selected_fraction_parts).length,'DISPATCH_DIRECT_NOSTOCK_SOURCE_REQUIRED');
 requireSource(line.type===product.type&&line.isInventoriable===product.inventoriable&&line.taxable===product.taxable&&canonicalDispatchJSON([...(line.appliedTaxIds as string[]||[])].sort())===canonicalDispatchJSON([...(product.taxIds as string[]||[])].sort())&&stamp.taxIncluded===tariff.taxIncluded,'DISPATCH_NOSTOCK_SEMANTICS_CHANGED');
 requireSource(typeof line.quantity==='number'&&line.quantity>0&&Number.isFinite(line.quantity)&&Number(line.price)===Number(facts.price),'DISPATCH_NOSTOCK_COMMERCIAL_SOURCE_CHANGED');
 assertDispatchLineAmounts(line,Number(facts.price),tariff.taxIncluded===true,array(facts.taxes));
}

export function assertDispatchLineAmounts(line:RecordValue,price:number,taxIncluded:boolean,taxes:RecordValue[]):void{
 const ids=line.appliedTaxIds as string[]||[],rate=taxes.filter(t=>t.active!==false&&ids.includes(String(t.id))).reduce((sum,t)=>sum.plus(Number(t.rate)),new Money(0));
 const round=(value:Money)=>value.toDecimalPlaces(2,Money.ROUND_HALF_UP),discount=Number(line.discountAmount||0);requireSource(Number.isFinite(discount)&&discount>=0&&new Money(discount).lte(new Money(price).times(Number(line.quantity))),'DISPATCH_ISSUED_DISCOUNT_INVALID');
 const discounted=round(round(new Money(Number(line.quantity)).times(price)).minus(discount)),net=taxIncluded&&rate.gt(0)?round(discounted.div(rate.plus(1))):discounted,tax=taxIncluded?round(discounted.minus(net)):round(net.times(rate));
 requireSource(new Money(Number(line.taxRate||0)).eq(rate)&&new Money(Number(line.netAmount??NaN)).eq(net)&&new Money(Number(line.taxAmount??NaN)).eq(tax)&&new Money(Number(line.totalAmount??NaN)).eq(net.plus(tax)),'DISPATCH_ISSUED_COMMERCIAL_TOTALS');
}
