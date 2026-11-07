import Decimal from 'decimal.js';
import type { CartItem, InventoryTracking, Product } from "../../types";
import { presentationInventoryQuantity } from "../inventoryPresentations/selection";
import {
  assertTrackingSelection,
  trackingFail,
  type TrackingSelection,
} from "./TrackingAuthority";
export type DispatchQuotaTrackingAuthority={source:'COMPANY_DISPATCH_QUOTA_TRACKING_V1';quotaId:string;authorityHash:string;deliveryWitnessHash:string;scope:Record<string,any>;dimensions:Record<string,any>};
export type DispatchQuotaTrackingSelection={dispatchQuotaAuthority:DispatchQuotaTrackingAuthority;quantityMinor:number;cartId:string;itemId:string;variantId:string};
export function assertDispatchQuotaTrackingSelection(selection:DispatchQuotaTrackingSelection,quota?:Record<string,any>,allocation?:Record<string,any>):void{
 const a=selection?.dispatchQuotaAuthority;
 if(a?.source!=='COMPANY_DISPATCH_QUOTA_TRACKING_V1'||!a.quotaId||!a.dimensions?.trackingUnitId||!a.scope||selection.itemId!==a.scope.itemId&&a.scope.itemId!==undefined||selection.variantId!==String(a.dimensions.variantId||'')||!selection.cartId||!Number.isSafeInteger(selection.quantityMinor)||selection.quantityMinor<=0||selection.quantityMinor%100!==0||a.dimensions.serialNumber&&selection.quantityMinor!==1000000)trackingFail('DISPATCH_TRACKING_SELECTION_INVALID');
 if(quota&&(selection.itemId!==quota.itemId||a.quotaId!==quota.id||['tenantId','companyId','storeId','warehouseId','terminalId','deviceId','bindingId','generation'].some(k=>a.scope[k]!==quota.scope[k])||JSON.stringify(Object.entries(a.dimensions).sort())!==JSON.stringify(Object.entries(quota.dimensions).sort())||allocation&&(a.authorityHash!==allocation.authorityHash||a.deliveryWitnessHash!==allocation.deliveryWitnessHash||selection.quantityMinor!==allocation.quantityMinor)))trackingFail('DISPATCH_TRACKING_SELECTION_CHANGED');
}
export function trackingSelectionsForCart(
  records: InventoryTracking[],
  product: Product,
  cartId: string,
): Array<TrackingSelection|DispatchQuotaTrackingSelection> {
  return records.map((record) => {
    if(record.dispatchQuotaAuthority){const selected={dispatchQuotaAuthority:record.dispatchQuotaAuthority,quantityMinor:Number(record.selectedQuantityMinor),cartId,itemId:product.id,variantId:record.variantId||''};assertDispatchQuotaTrackingSelection(selected);return selected;}
    if (!record.v3Authority || !record.selectedQuantityMinor)
      trackingFail("TRACKING_SELECTION_REQUIRED");
    return {
      authority: record.v3Authority,
      quantityMinor: record.selectedQuantityMinor,
      cartId,
      itemId: product.id,
      variantId: record.v3Authority.variantId,
    };
  });
}
export function assertTrackingLine(line: CartItem, product: Product): void {
  const required =
    product.operationalFlags?.usesLots || product.operationalFlags?.usesSerial;
  if (!required) {
    if (line.trackingData?.length)
      trackingFail("TRACKING_PRODUCT_NOT_CONFIGURED");
    return;
  }
  if (
    !Array.isArray(line.trackingData) ||
    !line.trackingData.length ||
    line.trackingData.length > 128
  )
    trackingFail("TRACKING_SELECTION_REQUIRED");
  if(line.trackingData.some(row=>row.dispatchQuotaAuthority)){
    let quantity=0;const units=new Set<string>(),quotas=new Set<string>();
    for(const selected of line.trackingData as DispatchQuotaTrackingSelection[]){assertDispatchQuotaTrackingSelection(selected);const a=selected.dispatchQuotaAuthority;if(selected.cartId!==line.cartId||selected.itemId!==line.id||selected.variantId!==(line.variantId||line.variantSku||'')||a.scope.warehouseId!==line.v3SaleAuthority?.warehouseId||quotas.has(a.quotaId)||product.operationalFlags?.usesSerial&&!a.dimensions.serialNumber||!product.operationalFlags?.usesSerial&&!a.dimensions.lotCode||a.dimensions.serialNumber&&units.has(a.dimensions.trackingUnitId))trackingFail('DISPATCH_TRACKING_LINE_CHANGED');quotas.add(a.quotaId);units.add(a.dimensions.trackingUnitId);quantity+=selected.quantityMinor;}
    const expected=new Decimal(line.quantity).times(line.articleFormat?.factor||1).times(1000000);if(!(expected.isInteger()&&expected.lte(Number.MAX_SAFE_INTEGER))||!expected.eq(quantity))trackingFail('TRACKING_BASE_QUANTITY_CHANGED');return;
  }
  let quantity = 0;
  const seen = new Set<string>();
  for (const selection of line.trackingData as TrackingSelection[]) {
    assertTrackingSelection(selection);
    const a = selection.authority;
    if (
      selection.cartId !== line.cartId ||
      selection.itemId !== line.id ||
      selection.variantId !== (line.variantId || line.variantSku || "") ||
      seen.has(a.allocationId) ||
      a.warehouseId !== line.v3SaleAuthority?.warehouseId ||
      !product.v3TrackingAuthorities?.some(
        (row) =>
          JSON.stringify(row.authority) === JSON.stringify(a) &&
          ["ACTIVE", "EXHAUSTED"].includes(row.state),
      )
    )
      trackingFail("TRACKING_LINE_SOURCE_CHANGED");
    if (
      (product.operationalFlags?.usesSerial && a.kind !== "SERIAL") ||
      (!product.operationalFlags?.usesSerial && a.kind !== "LOT") ||
      (product.operationalFlags?.usesLots &&
        product.operationalFlags?.usesSerial &&
        !a.lotCode)
    )
      trackingFail("TRACKING_LINE_FLAGS_CHANGED");
    seen.add(a.allocationId);
    quantity += selection.quantityMinor;
  }
  const base = presentationInventoryQuantity(line) * 1000000;
  if (!Number.isSafeInteger(base) || base !== quantity)
    trackingFail("TRACKING_BASE_QUANTITY_CHANGED");
}
