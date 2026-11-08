import {assertDispatchDirectNoStock,assertDispatchLineAmounts} from './DispatchFinancedSource';
import {assertDispatchQuotaTrackingSelection} from '../tracking/TrackingLine';
import Money from 'decimal.js';
import {formatPrice,freezeLine,snapshot as issuedFormatSnapshot} from '../articleFormats/domain';
import {resolveVariantSalesPrice} from '../../utils/variantSalesPrice';
import type {CartItem} from '../../types';
import {compileCompanyDispatchDemand} from './companyDispatchDemand.js';
import {canonicalDispatchJSON,type DispatchDemand} from '../db/CompanyDispatchEscrowStore';
export type DispatchCheckoutQuota={authority:Record<string,any>;authorityHash:string;witnessHash:string;availableMinor:number};
export type DispatchCheckoutAuthority={poolId:string;bindingId:string;generation:string;policyRevision:number;nativeBinding:string;quotas:DispatchCheckoutQuota[];noStockSources?:Array<{pin:Record<string,any>;facts:Record<string,any>}>};
const requireValue=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
/** Derive only a canonical issued BASE snapshot; never edit the cart or reprice. */
function issuedBaseLine(line:CartItem,catalog:any):CartItem{
 if(line.articleFormat!=null)return line;
 const master=catalog.commercialItem,formats=master.metadata?.articleFormats,variants=master.metadata?.variants||[];
 if(!Array.isArray(formats)||formats.length===0)return line;
 const variantId=line.variantId??null;
 if(variantId!==null&&(!Array.isArray(variants)||variants.filter((v:any)=>String(v.id||v.variant_id||v.sku)===variantId).length!==1))return line;
 try{
  const snapshots=formats.map((format:any)=>{
   if(!format||format.factor!==1||format.isBase===false)throw Error('NOT_CANONICAL_BASE');
   const value=issuedFormatSnapshot({schemaVersion:1,...format});
   if(value.id!=='base:'+String(value.variantId||'item')||value.variantId!==null&&(!Array.isArray(variants)||!variants.some((v:any)=>String(v.id||v.variant_id||v.sku)===value.variantId)))throw Error('NOT_CANONICAL_BASE');
   return value;
  });
  if(new Set(snapshots.map(value=>value.id)).size!==snapshots.length)return line;
  const matches=formats.map((format:any,index:number)=>({format,value:snapshots[index]})).filter(({format,value})=>value.variantId===variantId&&format.active===true&&format.allowSale===true);
  return matches.length===1?freezeLine(line,matches[0].value):line;
 }catch{return line;}
}
/** Select only installed server-issued rights. The native joint preparation
 * rechecks exact demand and balances in its writer transaction before payment. */
export async function compileDispatchCheckoutSource(authority:DispatchCheckoutAuthority,items:CartItem[],commercial:Record<string,unknown>){
 requireValue(items.length>0&&items.length<=200,'DISPATCH_CHECKOUT_LINES_REQUIRED');
 requireValue(new Money(commercial.serviceChargeAmount as number||0).eq(0),'DISPATCH_SERVICE_CHARGE_NOT_READY');
 const used=new Map<string,number>(),lines=[],effectiveItems:CartItem[]=[],serialUnits=new Set<string>();
 for(const originalLine of items){
  let line=originalLine;
  const noStock=authority.noStockSources?.find(row=>row.pin.itemId===line.id&&row.pin.syncId===line.v3SaleAuthority?.syncId&&row.pin.syncVersion===line.v3SaleAuthority?.syncVersion&&row.pin.tariffId===line.v3SaleAuthority?.tariffId);
  if(noStock){assertDispatchDirectNoStock(line as any,noStock.pin,noStock.facts,authority.nativeBinding);lines.push({cartId:line.cartId,tariffId:noStock.pin.tariffId,noStockSource:noStock.pin,quotaAllocations:[]});effectiveItems.push(line);continue;}

  const candidates=authority.quotas.filter(row=>row.authority.scope?.warehouseId===commercial.v3WarehouseId&&row.authority.catalogSource?.commercialItem?.id===line.id&&row.authority.itemId===line.id&&row.authority.scope?.bindingId===authority.bindingId&&row.authority.scope.generation===authority.generation&&row.authority.policyRevision===authority.policyRevision);
  requireValue(candidates.length,'DISPATCH_ITEM_QUOTA_REQUIRED');
  let selected:Array<{quota:DispatchCheckoutQuota;quantityMinor:number}>|undefined,selectedLine:CartItem|undefined,profileError:Error|undefined;
  const revisions=new Map<string,DispatchCheckoutQuota[]>();
  for(const row of [...candidates].sort((a,b)=>Number(b.authority.issuedSequence||0)-Number(a.authority.issuedSequence||0)||String(a.authority.id).localeCompare(String(b.authority.id)))){const key=canonicalDispatchJSON(row.authority.catalogSource);revisions.set(key,[...(revisions.get(key)||[]),row]);}
  for(const rows of revisions.values()){
   const catalog=rows[0].authority.catalogSource,scope=rows[0].authority.scope,effectiveLine=issuedBaseLine(originalLine,catalog);
   if(line.trackingData?.some(selection=>selection.dispatchQuotaAuthority&&!rows.some(q=>q.authority.id===selection.dispatchQuotaAuthority.quotaId)))continue;
   let compiled:ReturnType<typeof compileCompanyDispatchDemand>;
   try{compiled=compileCompanyDispatchDemand({scope,items:catalog.rawGraph},{itemId:effectiveLine.id,quantity:effectiveLine.quantity,variantId:effectiveLine.variantId,articleFormat:effectiveLine.articleFormat});}catch(error){if(error instanceof Error&&/^DISPATCH_(FORMAT_|VARIANT_|RECIPE_)/.test(error.message)){profileError=error;continue;}throw error;}
   // Only the existing direct-stock model is connected here. A component graph
   // cannot be flattened into a commercial item or financed as its parent.
   if(compiled.demands.length!==1||compiled.demands[0].itemId!==line.id)continue;
   const demand=compiled.demands[0],parts:Array<{quota:DispatchCheckoutQuota;quantityMinor:number}>=[];let remaining=demand.quantityMinor;
   if(demand.trackingKind){
    if(line.trackingData?.some(selection=>!rows.some(q=>q.authority.id===selection.dispatchQuotaAuthority?.quotaId)))continue; // resolve the selected retained catalogue, not the newest unrelated group
    requireValue(catalog.stockSelectionProfile==='DISPATCH_QUOTA_GRAIN_V2'&&Array.isArray(line.trackingData)&&line.trackingData.length>0,'DISPATCH_TRACKING_SELECTION_REQUIRED');
    const seen=new Set<string>();
    for(const selection of line.trackingData){const id=selection.dispatchQuotaAuthority?.quotaId,quota=rows.find(q=>q.authority.id===id);requireValue(quota&&!seen.has(id),'DISPATCH_TRACKING_SELECTION_CHANGED');const allocation={quantityMinor:selection.quantityMinor,authorityHash:quota!.authorityHash,deliveryWitnessHash:quota!.witnessHash};assertDispatchQuotaTrackingSelection(selection,quota!.authority,allocation);requireValue(selection.cartId===line.cartId&&selection.itemId===line.id&&selection.variantId===String(demand.dimensions.variantId||'')&&selection.quantityMinor<=quota!.availableMinor-(used.get(id)||0),'DISPATCH_TRACKING_SELECTION_CHANGED');if(demand.trackingKind==='SERIAL'){const unit=quota!.authority.dimensions.trackingUnitId;requireValue(!serialUnits.has(unit),'DISPATCH_SERIAL_DUPLICATE');serialUnits.add(unit);}seen.add(id);parts.push({quota:quota!,quantityMinor:selection.quantityMinor});remaining-=selection.quantityMinor;}
    requireValue(remaining===0,'DISPATCH_TRACKING_SELECTION_QUANTITY');selected=parts.sort((a,b)=>String(a.quota.authority.id).localeCompare(String(b.quota.authority.id)));selectedLine=effectiveLine;break;
   }

   for(const quota of [...rows].sort((a,b)=>String(a.authority.id).localeCompare(String(b.authority.id)))){
    if(canonicalDispatchJSON(demand.dimensions)!==canonicalDispatchJSON(quota.authority.dimensions))continue;
    const available=quota.availableMinor-(used.get(String(quota.authority.id))||0),take=Math.min(available,remaining);
    if(take<=0)continue;requireValue(Number.isSafeInteger(take)&&take%100===0,'DISPATCH_QUANTITY_NOT_REPRESENTABLE');
    parts.push({quota,quantityMinor:take});remaining-=take;if(remaining===0)break;
   }
   if(remaining===0){selected=parts;selectedLine=effectiveLine;break;}
  }
  if(!selected&&profileError)throw profileError;
  requireValue(selected,line.trackingData?.length?'DISPATCH_TRACKING_CATALOG_REVISIONS_MIXED_OR_EXHAUSTED':'DISPATCH_LOCAL_QUOTA_EXHAUSTED_OR_PROFILE_NOT_READY');
  line=selectedLine!;
  const quota=selected![0].quota,catalog=quota.authority.catalogSource,master=catalog.commercialItem;
  const tariffId=line.v3SaleAuthority?.tariffId,tariff=catalog.tariffs.find((row:any)=>row.id===tariffId),priceEntry=master.metadata?.tariffs?.find((row:any)=>row.tariffId===tariffId);
  const variant=master.metadata?.variants?.find((row:any)=>String(row.id||row.variant_id||row.sku)===String(line.variantId||''));
  const snapshot=line.articleFormat;
  const issuedFormat=snapshot?master.metadata?.articleFormats?.find((row:any)=>row.id===snapshot.id):undefined;
  // Keep the established native V3 and format-network price precedences. In
  // particular a format tariff's explicit zero is a real price, not a fallback.
  const issuedPrice=catalog.priceAuthority?.schemaVersion===1&&catalog.priceAuthority.nativeProfile==='NATIVE_V3_VARIANT_POSITIVE_V1'&&catalog.priceAuthority.formatProfile==='FORMAT_NETWORK_NULLISH_V1';
  requireValue(!catalog.priceAuthority||issuedPrice,'DISPATCH_ISSUED_PRICE_PROFILE_REQUIRED');
  requireValue(!snapshot||issuedPrice,'DISPATCH_FORMAT_PRICE_PROFILE_REQUIRED');
  const basePrice=priceEntry?.price??variant?.price??master.precio_venta,formatOverride=issuedFormat?.prices?.find((row:any)=>row.tariffId===tariffId);
  requireValue(tariff&&(snapshot?Number.isFinite(Number(formatOverride?.price??basePrice))&&(formatOverride?.price??basePrice)!=null:Number(variant?.price)>0||priceEntry?.price!=null&&Number.isFinite(Number(priceEntry.price))),'DISPATCH_ISSUED_TARIFF_REQUIRED');
  const price=snapshot?formatPrice({...issuedFormat,factor:issuedFormat?.factor||1,prices:issuedFormat?.prices||[]} as any,String(tariffId),basePrice):issuedPrice?resolveVariantSalesPrice(variant,priceEntry?.price):priceEntry?.price;
  if(line!==originalLine)requireValue(issuedPrice&&new Money(resolveVariantSalesPrice(variant,priceEntry?.price)).eq(price),'DISPATCH_ISSUED_PRICE_MISMATCH');
  requireValue(tariff&&Number.isFinite(Number(price))&&new Money(line.price).eq(price),'DISPATCH_ISSUED_PRICE_MISMATCH');
  requireValue(Boolean(line.taxable)===Boolean(master.taxable)&&canonicalDispatchJSON([...(line.appliedTaxIds||[])].sort())===canonicalDispatchJSON([...(master.metadata?.appliedTaxIds||[])].sort()),'DISPATCH_ISSUED_TAX_ASSIGNMENT');
  assertDispatchLineAmounts(line as any,Number(price),tariff.tax_included===true,catalog.taxes);
  const quotaAllocations=selected!.map(({quota,quantityMinor})=>{const quotaId=String(quota.authority.id);used.set(quotaId,(used.get(quotaId)||0)+quantityMinor);return{quotaId,quantityMinor,dimensions:quota.authority.dimensions,authorityHash:quota.authorityHash,deliveryWitnessHash:quota.witnessHash};});
  lines.push({cartId:line.cartId,tariffId,quotaAllocations});effectiveItems.push(line);
 }
 requireValue(new Money(commercial.netAmount as number).eq(items.reduce((sum,line)=>sum.plus(line.netAmount||0),new Money(0)))&&new Money(commercial.taxAmount as number).eq(items.reduce((sum,line)=>sum.plus(line.taxAmount||0),new Money(0)))&&new Money(commercial.total as number).eq(new Money(commercial.netAmount as number).plus(commercial.taxAmount as number).plus(commercial.serviceChargeAmount as number||0)),'DISPATCH_ISSUED_HEADER_TOTALS');
 const source={...commercial,items:effectiveItems,inventoryEffectsContract:'WAREHOUSE_RESERVATION_V1',v3Binding:authority.nativeBinding,companyDispatchSource:{schemaVersion:1,source:'COMPANY_DISPATCH_ESCROW_V1',bindingId:authority.bindingId,generation:authority.generation,policyRevision:authority.policyRevision,lines}};
 const demands:DispatchDemand[]=[...used].map(([quotaId,quantityMinor])=>({quotaId,quantityMinor}));
 const demandDigest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalDispatchJSON({source,demands})))),n=>n.toString(16).padStart(2,'0')).join('');
 return{poolId:authority.poolId,source,demands,demandDigest};
}

/** Read-only views of installed quota catalogues for the existing POS selectors.
 * They are not legacy format/tracking allocation authorities. The native writer
 * still recompiles every selected quantity against the installed issuer bytes. */
export function dispatchCatalogueView(authority:DispatchCheckoutAuthority|null,warehouseId?:string){
 const groups=new Map<string,{sequence:number;key:string;catalog:any;availableMinor:number}>();
 for(const q of authority?.quotas||[]){
  if(q.authority.scope?.warehouseId!==warehouseId||q.availableMinor<=0)continue;
  const catalog=q.authority.catalogSource,id=String(catalog?.commercialItem?.id||'');if(!id||q.authority.itemId!==id)continue;
  const key=canonicalDispatchJSON(catalog),sequence=Number(q.authority.issuedSequence||0),prior=groups.get(id);
  if(!prior||sequence>prior.sequence&&prior.key!==key)groups.set(id,{sequence,key,catalog,availableMinor:q.availableMinor});
  else if(prior.key===key){prior.availableMinor+=q.availableMinor;prior.sequence=Math.max(prior.sequence,sequence);}
 }
 const available:Record<string,number>={},catalogues:Record<string,any>={},formats:Record<string,any>={},variantSkus:Record<string,Record<string,string>>={};
 for(const [id,row] of groups){available[id]=row.availableMinor/1000000;catalogues[id]=row.catalog;const raw=row.catalog.commercialItem.metadata?.articleFormats;
  if(row.catalog.priceAuthority?.formatProfile!=='FORMAT_NETWORK_NULLISH_V1'||!Array.isArray(raw)||!raw.some((f:any)=>!String(f.id).startsWith('base:')))continue;
  formats[id]={schema_version:1,inventory_quantity_unit:'BASE',item_id:id,formats:raw.map((f:any)=>({schemaVersion:1,id:f.id,variantId:f.variantId??null,name:f.name,abbreviation:f.abbreviation,factor:f.factor,barcode:f.barcode||null,active:f.active===true,is_base:f.isBase===true||String(f.id).startsWith('base:'),default_purchase:f.defaultPurchase===true,default_sale:f.defaultSale===true,allow_purchase:f.allowPurchase===true,allow_sale:f.allowSale===true,allow_transfer:f.allowTransfer===true,sort_order:f.sortOrder||0,prices:f.prices||[]}))};
  variantSkus[id]=Object.fromEntries((row.catalog.commercialItem.metadata?.variants||[]).map((v:any)=>[String(v.id||v.variant_id||v.sku),String(v.sku||v.id||v.variant_id)]));
 }
 return{available,catalogues,formats,variantSkus};
}

export function dispatchTrackingOptions(authority:DispatchCheckoutAuthority,itemId:string,warehouseId:string,variantId=''):import('../../types').InventoryTracking[]{
 const active=dispatchCatalogueView(authority,warehouseId).catalogues[itemId];
 return authority.quotas.filter(q=>q.availableMinor>0&&canonicalDispatchJSON(q.authority.catalogSource)===canonicalDispatchJSON(active)&&q.authority.itemId===itemId&&q.authority.scope.warehouseId===warehouseId&&String(q.authority.dimensions.variantId||'')===variantId&&q.authority.catalogSource.stockSelectionProfile==='DISPATCH_QUOTA_GRAIN_V2'&&q.authority.trackingClockSource&&q.authority.dimensions.trackingUnitId).map(q=>{const dims=q.authority.dimensions;return{id:String(q.authority.id),productId:itemId,variantId:variantId||undefined,warehouseId,type:dims.serialNumber?'SERIE' as const:'LOTE' as const,trackingCode:String(dims.serialNumber||dims.lotCode),expirationDate:dims.expiresOn,status:'AVAILABLE' as const,receivedAt:'',availableMinor:q.availableMinor,dispatchQuotaAuthority:{source:'COMPANY_DISPATCH_QUOTA_TRACKING_V1' as const,quotaId:String(q.authority.id),authorityHash:q.authorityHash,deliveryWitnessHash:q.witnessHash,scope:q.authority.scope,dimensions:dims}};});
}
