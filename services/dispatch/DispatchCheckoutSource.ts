import Money from 'decimal.js';
import type {CartItem} from '../../types';
import {compileCompanyDispatchDemand} from './companyDispatchDemand.js';
import {canonicalDispatchJSON,type DispatchDemand} from '../db/CompanyDispatchEscrowStore';
export type DispatchCheckoutQuota={authority:Record<string,any>;authorityHash:string;witnessHash:string;availableMinor:number};
export type DispatchCheckoutAuthority={poolId:string;bindingId:string;generation:string;policyRevision:number;nativeBinding:string;quotas:DispatchCheckoutQuota[]};
const requireValue=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
/** Select only installed server-issued rights. The native joint preparation
 * rechecks exact demand and balances in its writer transaction before payment. */
export async function compileDispatchCheckoutSource(authority:DispatchCheckoutAuthority,items:CartItem[],commercial:Record<string,unknown>){
 requireValue(items.length>0&&items.length<=200,'DISPATCH_CHECKOUT_LINES_REQUIRED');
 requireValue(new Money(commercial.serviceChargeAmount as number||0).eq(0),'DISPATCH_SERVICE_CHARGE_NOT_READY');
 const used=new Map<string,number>(),lines=[];
 for(const line of items){
  const candidates=authority.quotas.filter(row=>row.authority.scope?.warehouseId===commercial.v3WarehouseId&&row.authority.catalogSource?.commercialItem?.id===line.id&&row.authority.itemId===line.id&&row.authority.scope?.bindingId===authority.bindingId&&row.authority.scope.generation===authority.generation&&row.authority.policyRevision===authority.policyRevision);
  requireValue(candidates.length,'DISPATCH_ITEM_QUOTA_REQUIRED');
  let selected:DispatchCheckoutQuota|undefined,quantityMinor=0;
  for(const quota of candidates){
   const catalog=quota.authority.catalogSource,scope=quota.authority.scope;
   const compiled=compileCompanyDispatchDemand({scope,items:catalog.rawGraph},{itemId:line.id,quantity:line.quantity,variantId:line.variantId,articleFormat:line.articleFormat});
   // The connected ordinary writer is singleton; do not underfund a recipe,
   // tracked split or format by pretending it is a direct base item.
   if(compiled.demands.length!==1||compiled.demands[0].itemId!==line.id||compiled.demands[0].trackingKind||line.articleFormat)continue;
   const demand=compiled.demands[0];
   if(canonicalDispatchJSON(demand.dimensions)!==canonicalDispatchJSON(quota.authority.dimensions))continue;
   quantityMinor=demand.quantityMinor;
   if(quota.availableMinor-(used.get(String(quota.authority.id))||0)>=quantityMinor){selected=quota;break;}
  }
  requireValue(selected,'DISPATCH_LOCAL_QUOTA_EXHAUSTED_OR_PROFILE_NOT_READY');
  const quota=selected!,catalog=quota.authority.catalogSource,master=catalog.commercialItem;
  const tariffId=line.v3SaleAuthority?.tariffId,tariff=catalog.tariffs.find((row:any)=>row.id===tariffId),price=master.metadata?.tariffs?.find((row:any)=>row.tariffId===tariffId)?.price;
  requireValue(tariff&&Number.isFinite(Number(price))&&new Money(line.price).eq(price),'DISPATCH_ISSUED_PRICE_MISMATCH');
  requireValue(Boolean(line.taxable)===Boolean(master.taxable)&&canonicalDispatchJSON([...(line.appliedTaxIds||[])].sort())===canonicalDispatchJSON([...(master.metadata?.appliedTaxIds||[])].sort()),'DISPATCH_ISSUED_TAX_ASSIGNMENT');
  const taxIds=line.appliedTaxIds||[],rate=catalog.taxes.filter((tax:any)=>taxIds.includes(tax.id)).reduce((sum:Money,tax:any)=>sum.plus(tax.rate),new Money(0));
  const round=(value:Money)=>value.toDecimalPlaces(2,Money.ROUND_HALF_UP);
  const discounted=round(round(new Money(line.quantity).times(line.price)).minus(line.discountAmount||0));
  const net=tariff.tax_included&&rate.gt(0)?round(discounted.div(rate.plus(1))):discounted;
  const tax=tariff.tax_included?round(discounted.minus(net)):round(net.times(rate));
  requireValue(new Money(line.taxRate||0).eq(rate)&&new Money(line.netAmount??NaN).eq(net)&&new Money(line.taxAmount??NaN).eq(tax)&&new Money(line.totalAmount??NaN).eq(net.plus(tax)),'DISPATCH_ISSUED_COMMERCIAL_TOTALS');
  const quotaId=String(quota.authority.id);used.set(quotaId,(used.get(quotaId)||0)+quantityMinor);
  lines.push({cartId:line.cartId,tariffId,quotaAllocations:[{quotaId,quantityMinor,dimensions:quota.authority.dimensions,authorityHash:quota.authorityHash,deliveryWitnessHash:quota.witnessHash}]});
 }
 requireValue(new Money(commercial.netAmount as number).eq(items.reduce((sum,line)=>sum.plus(line.netAmount||0),new Money(0)))&&new Money(commercial.taxAmount as number).eq(items.reduce((sum,line)=>sum.plus(line.taxAmount||0),new Money(0)))&&new Money(commercial.total as number).eq(new Money(commercial.netAmount as number).plus(commercial.taxAmount as number).plus(commercial.serviceChargeAmount as number||0)),'DISPATCH_ISSUED_HEADER_TOTALS');
 const source={...commercial,items,inventoryEffectsContract:'WAREHOUSE_RESERVATION_V1',v3Binding:authority.nativeBinding,companyDispatchSource:{schemaVersion:1,source:'COMPANY_DISPATCH_ESCROW_V1',bindingId:authority.bindingId,generation:authority.generation,policyRevision:authority.policyRevision,lines}};
 const demands:DispatchDemand[]=[...used].map(([quotaId,quantityMinor])=>({quotaId,quantityMinor}));
 const demandDigest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalDispatchJSON({source,demands})))),n=>n.toString(16).padStart(2,'0')).join('');
 return{poolId:authority.poolId,source,demands,demandDigest};
}
