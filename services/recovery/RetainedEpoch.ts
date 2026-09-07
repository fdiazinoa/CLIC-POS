import type { DatabaseAdapter } from "../db/DatabaseAdapter";
import {
  CAPTURE_COLLECTIONS,
  RECOVERY_OUTBOX,
  RECOVERY_STATE,
} from "./OriginalCapture";
import { withRecoveryPreparation } from "./RecoveryDatabase";
import { recoveryCanonicalJson } from "./RecoveryJson";
import { originalDigest } from "./OriginalCodec";
import { recoveryUuid } from "./RecoveryUuid";
import type { RetainedContext } from "./RetainedCaptureSet";
const check = (ok: unknown, code = "RETAINED_EPOCH_INVALID") => {
  if (!ok) throw Error(code);
};
const same = (a: unknown, b: unknown) =>
  recoveryCanonicalJson(a) === recoveryCanonicalJson(b);
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export const retainedRequestHash = (body: unknown) =>
  originalDigest(new TextEncoder().encode(recoveryCanonicalJson(body)));
export function validateRetainedLineage(
  descriptor: any,
  manifestEpochs: string[],
): string {
  const lineage = descriptor.lineage;
  if (!lineage) {
    check(new Set(manifestEpochs).size === 1, "RETAINED_EPOCH_AMBIGUOUS");
    return manifestEpochs[0];
  }
  check(
    lineage.version === 1 &&
      uuid(lineage.currentEpoch) &&
      Array.isArray(lineage.transitions),
  );
  const transitions = lineage.transitions,
    seen = new Set<string>(),
    requests = new Set<string>();
  let epoch = transitions[0]?.predecessorEpoch || lineage.currentEpoch;
  check(uuid(epoch));
  seen.add(epoch);
  let generation = 0n;
  for (const t of transitions) {
    check(
      uuid(t.requestId) &&
        !requests.has(t.requestId) &&
        t.predecessorEpoch === epoch &&
        uuid(t.storageEpoch) &&
        !seen.has(t.storageEpoch),
    );
    check(
      typeof t.generation === "string" &&
        /^[1-9][0-9]*$/.test(t.generation) &&
        BigInt(t.generation) === generation + 1n,
    );
    check(
      t.predecessorManifestReference &&
        seen.has(t.predecessorManifestReference.storageEpoch),
    );
    generation = BigInt(t.generation);
    epoch = t.storageEpoch;
    seen.add(epoch);
    requests.add(t.requestId);
  }
  check(
    epoch === lineage.currentEpoch && manifestEpochs.every((e) => seen.has(e)),
    "RETAINED_EPOCH_AMBIGUOUS",
  );
  return epoch;
}
/** Persist intent before remote CAS. Does not allocate commercial/fiscal numbers. */
export function prepareRetainedEpoch(
  db: DatabaseAdapter,
  ctx: RetainedContext,
  descriptor: any,
) {
  return withRecoveryPreparation(db, ctx.key, async (base) => {
    check(base.saveDocumentsAtomically, "RECOVERY_ATOMIC_STORAGE_UNAVAILABLE");
    const previous = await base.getDocument<any>(
      RECOVERY_STATE,
      "retainedEpochTransition",
    );
    if (previous) {
      check(previous.context === ctx.key, "RECOVERY_SCOPE_CHANGED");
      return previous;
    }
    check(
      (await base.getCollection<any>(RECOVERY_OUTBOX)).every(
        (r) => r.status === "RECEIVED",
      ),
      "RETAINED_LOCAL_CAPTURE_PENDING",
    );
    for (const collection of Object.keys(CAPTURE_COLLECTIONS))
      for (const document of await base.getCollection<any>(collection)) {
        check(
          document._posRecovery?.receiptId &&
            descriptor.placements.some(
              (p: any) =>
                p.collection === collection &&
                p.original.originalId === document.id &&
                p.original.receiptId === document._posRecovery.receiptId,
            ),
          "RETAINED_LOCAL_CAPTURE_PENDING",
        );
      }
    const predecessorEpoch = validateRetainedLineage(descriptor, [
      descriptor.manifestReference.storageEpoch,
    ]);
    const head = descriptor.snapshot.cutoffReceiptId;
    check(typeof head === "string" && /^[1-9][0-9]*$/.test(head));
    const request = {
      version: 1,
      requestId: recoveryUuid(),
      expectedManifestReference: descriptor.manifestReference,
      expectedSnapshotId: descriptor.snapshot.snapshotId,
      expectedSnapshotDigest: descriptor.snapshot.snapshotDigest,
      expectedScopeReceiptHead: head,
      predecessorEpoch,
      newEpoch: recoveryUuid(),
    };
    const state = {
      id: "retainedEpochTransition",
      context: ctx.key,
      status: "PREPARED",
      request,
      requestHash: await retainedRequestHash(request),
      openSetId: recoveryUuid(),
    };
    await base.saveDocumentsAtomically!([
      { collectionName: RECOVERY_STATE, document: state },
    ]);
    return state;
  });
}
export async function validateRetainedEpochAck(
  ctx: RetainedContext,
  state: any,
  ack: any,
) {
  const r = state.request;
  check(
    ack?.version === 1 &&
      ack.profile === "erp.retained-epoch.v1" &&
      ack.requestId === r.requestId &&
      same(ack.scope, ctx.recoveryScope),
  );
  check(
    ack.storageEpoch === r.newEpoch &&
      ack.predecessorEpoch === r.predecessorEpoch &&
      same(ack.predecessorManifestReference, r.expectedManifestReference),
  );
  check(
    ack.nextSequence === "1" &&
      typeof ack.generation === "string" &&
      /^[1-9][0-9]*$/.test(ack.generation),
  );
  check(
    ack.requestHash === state.requestHash &&
      state.requestHash === (await retainedRequestHash(r)),
  );
  check(
    ack.exactZEligible === false &&
      ack.closeAuthorization === "NOT_GRANTED" &&
      ack.replayAllowed === false,
  );
}
/** Publish the CAS ACK and fresh technical counters atomically; never rewrite recovered originals. */
export async function applyRetainedEpoch(
  db: DatabaseAdapter,
  ctx: RetainedContext,
  state: any,
  ack: any,
  descriptor: any,
) {
  await validateRetainedEpochAck(ctx, state, ack);
  check(
    validateRetainedLineage(descriptor, [
      descriptor.manifestReference.storageEpoch,
    ]) === ack.storageEpoch,
    "RETAINED_EPOCH_SUPERSEDED",
  );
  check(
    descriptor.lineage?.transitions.some(
      (t: any) =>
        t.requestId === ack.requestId &&
        t.storageEpoch === ack.storageEpoch &&
        t.generation === ack.generation,
    ),
    "RETAINED_EPOCH_SUPERSEDED",
  );
  return withRecoveryPreparation(db, ctx.key, async (base) => {
    const stored = await base.getDocument<any>(RECOVERY_STATE, state.id);
    check(
      stored &&
        stored.requestHash === state.requestHash &&
        stored.context === ctx.key,
      "RETAINED_EPOCH_STATE_CHANGED",
    );
    if (stored.status === "ACKNOWLEDGED") return;
    check(
      (await base.getCollection<any>(RECOVERY_OUTBOX)).every(
        (r) => r.status === "RECEIVED",
      ),
      "RETAINED_LOCAL_CAPTURE_PENDING",
    );
    check(base.saveDocumentsAtomically, "RECOVERY_ATOMIC_STORAGE_UNAVAILABLE");
    await base.saveDocumentsAtomically!([
      {
        collectionName: RECOVERY_STATE,
        document: { ...state, status: "ACKNOWLEDGED", ack },
      },
      {
        collectionName: RECOVERY_STATE,
        document: {
          id: "capture",
          storageEpoch: ack.storageEpoch,
          openSetId: state.openSetId,
          sequence: "0",
        },
      },
      {
        collectionName: RECOVERY_STATE,
        document: {
          id: "retainedSet",
          context: ctx.key,
          storageEpoch: ack.storageEpoch,
          sequence: "0",
          captureId: null,
          placements: descriptor.placements,
        },
      },
    ]);
  });
}
