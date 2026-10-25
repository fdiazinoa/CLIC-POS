import type { TrackingDeliveryClock } from "../db/TrackingAllocationStore";
import { Preferences } from "@capacitor/preferences";
import { sha256Utf8 } from "../sync/LargeMasterSyncV3Client";
import {
  verifyTrackingAuthority,
  trackingFail,
  type TrackingAuthority,
} from "./TrackingAuthority";
export type TrackingAllocationSnapshot = {
  authority: TrackingAuthority;
  state: "ACTIVE" | "EXHAUSTED" | "RETURN_PENDING" | "RETURNED" | "REVOKED";
  serverConsumedMinor: number;
  delivered: boolean;
  witnessHash: string | null;
};
type Witness = {
  schemaVersion: 1;
  allocationId: string;
  authorityChecksum: string;
  nonce: string;
};
type DeliveryPort = {
  readLocal(
    allocationId: string,
  ): Promise<{ authorityJson: string; witnessHash: string } | null>;
  install(
    authority: TrackingAuthority,
    previouslySeen: boolean,
    serverConsumedMinor: number,
    witnessHash: string,
    clock?: TrackingDeliveryClock,
  ): Promise<void>;
  claim(
    allocationId: string,
    witnessHash: string,
  ): Promise<{
    allocationId: string;
    witnessHash: string;
    firstInstallationAllowed: boolean;
    deliveredAtEpochMs?: number;
  }>;
  readWitness(key: string): Promise<string | null>;
  writeWitness(key: string, value: string): Promise<void>;
};
export const nativeTrackingWitnessPreferences = {
  async readWitness(key: string) {
    return (await Preferences.get({ key })).value;
  },
  async writeWitness(key: string, value: string) {
    await Preferences.set({ key, value });
  },
};
const nonce = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
};
/** No persistent token can recreate first-install permission. Only the one-shot
 * server response on this live attempt authorizes installing an absent row. */
async function acceptTrackingDeliveryOnce(
  snapshot: TrackingAllocationSnapshot,
  port: DeliveryPort,
): Promise<void> {
  await verifyTrackingAuthority(snapshot.authority);
  const authority = snapshot.authority,
    key = `clic.tracking.owner.v1.${authority.allocationId}`;
  if (!["ACTIVE", "EXHAUSTED"].includes(snapshot.state))
    trackingFail("TRACKING_DELIVERY_NOT_ACTIVE");
  const local = await port.readLocal(authority.allocationId),
    raw = await port.readWitness(key);
  let witness: Witness | undefined;
  if (raw !== null) {
    try {
      witness = JSON.parse(raw);
    } catch {
      trackingFail("TRACKING_EXTERNAL_WITNESS_CORRUPT");
    }
    if (
      witness?.schemaVersion !== 1 ||
      witness.allocationId !== authority.allocationId ||
      witness.authorityChecksum !== authority.checksum ||
      !/^[a-f0-9]{64}$/.test(witness.nonce)
    )
      trackingFail("TRACKING_EXTERNAL_WITNESS_CORRUPT");
  }
  if (local) {
    if (
      !witness ||
      local.authorityJson !== JSON.stringify(authority) ||
      local.witnessHash !== (await sha256Utf8(witness.nonce)) ||
      (snapshot.delivered && snapshot.witnessHash !== local.witnessHash)
    )
      trackingFail("TRACKING_LOCAL_OWNERSHIP_MISMATCH");
    await port.install(
      authority,
      true,
      snapshot.serverConsumedMinor,
      local.witnessHash,
    );
    return;
  }
  // A former attempt, acknowledged or not, can never reinstall lost ownership.
  if (witness || snapshot.delivered || snapshot.witnessHash)
    trackingFail("TRACKING_LOCAL_OWNERSHIP_MISSING");
  witness = {
    schemaVersion: 1,
    allocationId: authority.allocationId,
    authorityChecksum: authority.checksum,
    nonce: nonce(),
  };
  const encoded = JSON.stringify(witness);
  await port.writeWitness(key, encoded);
  if ((await port.readWitness(key)) !== encoded)
    trackingFail("TRACKING_EXTERNAL_WITNESS_NOT_DURABLE");
  const witnessHash = await sha256Utf8(witness.nonce);
  const localRequestStartedMs = Date.now();
  const claim = await port.claim(authority.allocationId, witnessHash);
  const localReceivedMs = Date.now();
  if (
    claim.firstInstallationAllowed !== true ||
    claim.allocationId !== authority.allocationId ||
    claim.witnessHash !== witnessHash ||
    !Number.isSafeInteger(claim.deliveredAtEpochMs) ||
    Number(claim.deliveredAtEpochMs) <= 0 ||
    Number(claim.deliveredAtEpochMs) > 8640000000000000 ||
    Number(claim.deliveredAtEpochMs) < Date.parse(authority.issuedAt) ||
    localReceivedMs < localRequestStartedMs
  )
    trackingFail("TRACKING_FIRST_DELIVERY_RECONCILIATION_REQUIRED");
  await port.install(
    authority,
    false,
    snapshot.serverConsumedMinor,
    witnessHash,
    {
      serverDeliveredMs: claim.deliveredAtEpochMs!,
      localRequestStartedMs,
      localReceivedMs,
    },
  );
}

const deliveries = new Map<
  string,
  { identity: string; promise: Promise<void> }
>();
export function acceptTrackingDelivery(
  snapshot: TrackingAllocationSnapshot,
  port: DeliveryPort,
): Promise<void> {
  const key = snapshot.authority.allocationId,
    identity = JSON.stringify(snapshot),
    pending = deliveries.get(key);
  if (pending)
    return pending.identity === identity
      ? pending.promise
      : Promise.reject(Error("TRACKING_DELIVERY_SOURCE_CHANGED"));
  const promise = acceptTrackingDeliveryOnce(snapshot, port).finally(() => {
    if (deliveries.get(key)?.promise === promise) deliveries.delete(key);
  });
  deliveries.set(key, { identity, promise });
  return promise;
}
