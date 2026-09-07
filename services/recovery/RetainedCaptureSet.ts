import type { DatabaseAdapter } from "../db/DatabaseAdapter";
import { withRecoveryPreparation } from "./RecoveryDatabase";
import {
  CAPTURE_COLLECTIONS,
  RECOVERY_OUTBOX,
  RECOVERY_STATE,
  RECOVERY_STAGE,
} from "./OriginalCapture";
import {
  decodeOriginal,
  decodeBase64,
  encodeOriginal,
  originalDigest,
} from "./OriginalCodec";
import { originalRecord, recordBytes } from "./PendingOperationsRecovery";
import { recoveryCanonicalJson } from "./RecoveryJson";
import { recoveryUuid } from "./RecoveryUuid";
export interface RetainedContext {
  key: string;
  terminalIds: string[];
  recoveryScope?: {
    tenantId: string;
    companyId: string;
    storeId: string;
    terminalId: string;
  };
}
export const retainedReference = (row: any) => ({
  receiptId: row.receiptId,
  recordHash: row.recordHash,
  storageEpoch: row.record.storageEpoch,
  kind: row.record.kind,
  originalId: row.record.originalId,
  revision: row.record.revision,
  bodySha256: row.record.bodySha256,
});
const same = (a: unknown, b: unknown) =>
  recoveryCanonicalJson(a) === recoveryCanonicalJson(b);
/** Compare the actual SQLite JSON image without discarding the richer captured original. */
export const samePersistedImage = (a: unknown, b: unknown) =>
  same(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

/** Freeze placements behind the same local write queue as checkout. No network or business writes. */
export function captureRetainedSet(
  db: DatabaseAdapter,
  ctx: RetainedContext,
): Promise<string> {
  return withRecoveryPreparation(db, ctx.key, async (base) => {
    if (
      !ctx.recoveryScope ||
      !ctx.terminalIds.includes(ctx.recoveryScope.terminalId)
    )
      throw Error("RETAINED_SCOPE_REQUIRED");
    if (!base.saveDocumentsAtomically)
      throw Error("RECOVERY_ATOMIC_STORAGE_UNAVAILABLE");
    const state = await base.getDocument<any>(RECOVERY_STATE, "capture");
    if (!state) throw Error("RETAINED_CAPTURE_REQUIRED");
    const placements: any[] = [];
    for (const [collection, kind] of Object.entries(CAPTURE_COLLECTIONS)) {
      for (const document of await base.getCollection<any>(collection)) {
        if (document?._posRecovery && !document._posRecovery.closedImage) {
          const marker = document._posRecovery;
          const staged = await base.getDocument<any>(
            RECOVERY_STAGE,
            marker.snapshotId + ":" + marker.receiptId,
          );
          if (
            !staged ||
            staged.snapshotId !== marker.snapshotId ||
            staged.receiptId !== marker.receiptId ||
            staged.record.kind !== kind ||
            staged.record.originalId !== document.id ||
            staged.record.bodySha256 !== marker.bodySha256 ||
            (await originalDigest(recordBytes(staged.record))) !==
              staged.recordHash
          )
            throw Error("RETAINED_RECOVERED_REFERENCE_INVALID");
          const raw = decodeBase64(staged.record.bodyBase64);
          if ((await originalDigest(raw)) !== marker.bodySha256)
            throw Error("RETAINED_RECOVERED_REFERENCE_INVALID");
          const envelope = decodeOriginal(new TextDecoder().decode(raw)) as any;
          const { _posRecovery, ...runtime } = document;
          if (!samePersistedImage(decodeOriginal(envelope.document), runtime))
            throw Error("RETAINED_IMAGE_CHANGED");
          for (const id of [document.terminalId, document.source_terminal_id])
            if (id !== undefined && !ctx.terminalIds.includes(id))
              throw Error("RETAINED_SCOPE_MISMATCH");
          placements.push({ collection, original: retainedReference(staged) });
          continue;
        }
        if (!document?.id) throw Error("RETAINED_ID_REQUIRED");
        for (const id of [document.terminalId, document.source_terminal_id])
          if (id !== undefined && !ctx.terminalIds.includes(id))
            throw Error("RETAINED_SCOPE_MISMATCH");
        const head = await base.getDocument<any>(
          RECOVERY_STATE,
          JSON.stringify([kind, document.id]),
        );
        const row =
          head &&
          (await base.getDocument<any>(RECOVERY_OUTBOX, head.captureId));
        if (
          !row ||
          row.originKey !== ctx.key ||
          row.status !== "RECEIVED" ||
          !row.receipt?.receiptId
        )
          throw Error("RETAINED_ORIGINAL_NOT_RECEIVED");
        const envelope = decodeOriginal(row.body) as any;
        const { _posRecovery, ...unmarked } = document;
        const image = _posRecovery?.closedImage ? unmarked : document;
        if (
          _posRecovery?.closedImage &&
          ((!document.zReportId && kind !== "Z_REPORT") ||
            envelope.closeCommitId !== _posRecovery.commitId)
        )
          throw Error("RETAINED_CLOSE_BINDING");
        if (!samePersistedImage(decodeOriginal(envelope.document), image))
          throw Error("RETAINED_IMAGE_CHANGED");
        const record = await originalRecord(row);
        if (row.receipt.bodySha256 !== record.bodySha256)
          throw Error("RETAINED_RECEIPT_MISMATCH");
        placements.push({
          collection,
          original: retainedReference({
            record,
            receiptId: row.receipt.receiptId,
            recordHash: await originalDigest(recordBytes(record)),
          }),
        });
      }
    }
    if (placements.length > 2000) throw Error("RETAINED_LIMIT");
    const previous = await base.getDocument<any>(RECOVERY_STATE, "retainedSet");
    if (
      previous?.captureId &&
      previous.context === ctx.key &&
      same(previous.placements, placements) &&
      previous.storageEpoch === state.storageEpoch &&
      previous.sequence === state.sequence
    )
      return previous.captureId;
    const captureSetId = recoveryUuid();
    const body = encodeOriginal({
      version: 1,
      domain: "pos.retained-capture-set.v1",
      captureSetId,
      scope: ctx.recoveryScope,
      sourceCut: {
        storageEpoch: state.storageEpoch,
        captureSequence: state.sequence,
      },
      placements,
    });
    if (new TextEncoder().encode(body).length > 524288)
      throw Error("RETAINED_LIMIT");
    const sequence = (BigInt(state.sequence) + 1n).toString();
    const id = recoveryUuid();
    await base.saveDocumentsAtomically([
      {
        collectionName: RECOVERY_OUTBOX,
        document: {
          id,
          kind: "MEMBERSHIP",
          originalId: captureSetId,
          localTerminalId: ctx.recoveryScope.terminalId,
          originKey: ctx.key,
          body,
          capturedAt: new Date().toISOString(),
          status: "PENDING",
          storageEpoch: state.storageEpoch,
          openSetId: state.openSetId,
          sequence,
          revision: sequence,
        },
      },
      { collectionName: RECOVERY_STATE, document: { ...state, sequence } },
      {
        collectionName: RECOVERY_STATE,
        document: {
          id: "retainedSet",
          context: ctx.key,
          captureId: id,
          storageEpoch: state.storageEpoch,
          sequence,
          placements,
        },
      },
    ]);
    return id;
  });
}
