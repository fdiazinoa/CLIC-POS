import { Capacitor } from "@capacitor/core";
import { dbAdapter } from "../db";
import type { Product, InventoryTracking } from "../../types";
import {
  createLargeMasterSyncV3BoundTransport,
  readLargeMasterSyncV3BoundIdentity,
} from "../sync/LargeMasterSyncV3BoundTransport";
import { readTerminalCredentialsSync } from "../sync/TerminalCredentialStore";
import {
  acceptTrackingDelivery,
  nativeTrackingWitnessPreferences,
} from "./TrackingDeliveryWitness";
import { trackingFail } from "./TrackingAuthority";
/** V3 never falls back to the unowned legacy inventoryTracking collection. */
export async function loadV3TrackingOptions(
  product: Product,
  warehouseId: string,
  variantId = "",
): Promise<InventoryTracking[]> {
  if (
    !Capacitor.isNativePlatform() ||
    !dbAdapter.readTrackingAuthority ||
    !dbAdapter.installTrackingAuthority
  )
    trackingFail("TRACKING_NATIVE_AUTHORITY_REQUIRED");
  const identity = readLargeMasterSyncV3BoundIdentity(),
    credentials = readTerminalCredentialsSync();
  const transport = createLargeMasterSyncV3BoundTransport(
    new URL(identity.erpSyncBaseUrl).origin,
  );
  const available: InventoryTracking[] = [];
  for (const snapshot of product.v3TrackingAuthorities || []) {
    const a = snapshot.authority;
    if (
      a.itemId !== product.id ||
      a.warehouseId !== warehouseId ||
      a.variantId !== variantId
    )
      continue;
    if (
      a.tenantId !== identity.tenantId ||
      a.terminalId !== identity.terminalId ||
      a.deviceId !== identity.deviceId ||
      a.companyId !== credentials.companyId ||
      a.storeId !== credentials.storeId
    )
      trackingFail("TRACKING_OWNER_CHANGED");
    if (!["ACTIVE", "EXHAUSTED"].includes(snapshot.state)) continue;
    await acceptTrackingDelivery(snapshot, {
      ...nativeTrackingWitnessPreferences,
      readLocal: (id) => dbAdapter.readTrackingAuthority!(id),
      install: (authority, seen, consumed, witnessHash) =>
        dbAdapter.installTrackingAuthority!(
          authority,
          seen,
          consumed,
          witnessHash,
        ),
      async claim(id, witnessHash) {
        const response = await transport.request(
          `/api/sync/v3/tracking/allocations/${id}/claim`,
          { method: "POST", body: { witnessHash } },
        );
        if (response.status !== 200)
          trackingFail("TRACKING_FIRST_DELIVERY_RECONCILIATION_REQUIRED");
        return JSON.parse(response.text);
      },
    });
    const row = await dbAdapter.readTrackingAuthority(a.allocationId);
    if (!row || row.availableMinor <= 0) continue;
    available.push({
      id: a.allocationId,
      productId: product.id,
      variantId: a.variantId || undefined,
      warehouseId,
      type: a.kind === "SERIAL" ? "SERIE" : "LOTE",
      trackingCode: a.code,
      expirationDate: a.expiresOn || undefined,
      status: "AVAILABLE",
      receivedAt: a.receivedAt,
      v3Authority: a,
      availableMinor: row.availableMinor,
    });
  }
  return available;
}
