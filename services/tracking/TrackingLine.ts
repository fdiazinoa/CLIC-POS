import type { CartItem, InventoryTracking, Product } from "../../types";
import { presentationInventoryQuantity } from "../inventoryPresentations/selection";
import {
  assertTrackingSelection,
  trackingFail,
  type TrackingSelection,
} from "./TrackingAuthority";
export function trackingSelectionsForCart(
  records: InventoryTracking[],
  product: Product,
  cartId: string,
): TrackingSelection[] {
  return records.map((record) => {
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
