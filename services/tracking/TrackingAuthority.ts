import { sha256Utf8 } from "../sync/LargeMasterSyncV3Client";
export const TRACKING_SCALE = 1000000;
export type TrackingAuthority = {
  schemaVersion: 1;
  allocationId: string;
  unitId: string;
  tenantId: string;
  companyId: string;
  storeId: string;
  warehouseId: string;
  terminalId: string;
  deviceId: string;
  itemId: string;
  variantId: string;
  kind: "LOT" | "SERIAL";
  code: string;
  lotCode: string | null;
  expiresOn: string | null;
  receivedAt: string;
  quantityMinor: number;
  quantityScale: 1000000;
  revision: number;
  unitRevision: number;
  businessTimezone: string;
  bindingHash: string;
  issuedAt: string;
  checksum: string;
};
export type TrackingSelection = {
  authority: TrackingAuthority;
  quantityMinor: number;
  cartId: string;
  itemId: string;
  variantId: string;
};
export const trackingFail = (code: string): never => {
  throw new Error(code);
};
export function assertTrackingAuthority(value: TrackingAuthority): void {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.quantityScale !== TRACKING_SCALE ||
    !["LOT", "SERIAL"].includes(value.kind) ||
    !Number.isSafeInteger(value.quantityMinor) ||
    value.quantityMinor <= 0 ||
    (value.kind === "SERIAL" && value.quantityMinor !== TRACKING_SCALE) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !Number.isSafeInteger(value.unitRevision) ||
    value.unitRevision < 1 ||
    !value.code ||
    value.code.length > 128 ||
    !value.businessTimezone ||
    !Number.isFinite(Date.parse(value.issuedAt)) ||
    !Number.isFinite(Date.parse(value.receivedAt)) ||
    !/^[a-f0-9]{64}$/.test(value.checksum) ||
    !/^[a-f0-9]{64}$/.test(value.bindingHash)
  )
    trackingFail("TRACKING_AUTHORITY_INVALID");
  for (const key of [
    "allocationId",
    "unitId",
    "tenantId",
    "companyId",
    "storeId",
    "warehouseId",
    "terminalId",
    "itemId",
  ] as const)
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        value[key],
      )
    )
      trackingFail("TRACKING_AUTHORITY_INVALID");
  if (
    !value.deviceId ||
    value.deviceId.length > 160 ||
    typeof value.variantId !== "string" ||
    value.variantId.length > 128
  )
    trackingFail("TRACKING_AUTHORITY_INVALID");
}
export function assertTrackingSelection(selection: TrackingSelection): void {
  assertTrackingAuthority(selection.authority);
  if (
    !selection.cartId ||
    selection.cartId.length > 160 ||
    selection.itemId !== selection.authority.itemId ||
    selection.variantId !== selection.authority.variantId ||
    !Number.isSafeInteger(selection.quantityMinor) ||
    selection.quantityMinor <= 0 ||
    selection.quantityMinor > selection.authority.quantityMinor ||
    (selection.authority.kind === "SERIAL" &&
      selection.quantityMinor !== TRACKING_SCALE)
  )
    trackingFail("TRACKING_SELECTION_INVALID");
}

const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export async function verifyTrackingAuthority(
  value: TrackingAuthority,
): Promise<void> {
  assertTrackingAuthority(value);
  const { checksum, ...source } = value;
  if ((await sha256Utf8(JSON.stringify(canonical(source)))) !== checksum)
    trackingFail("TRACKING_AUTHORITY_CHECKSUM_CHANGED");
}
