import type {
  DatabaseAdapter,
  DurableDocumentMutation,
} from "../db/DatabaseAdapter";
import { withRecoveryPreparation } from "./RecoveryDatabase";
import {
  CAPTURE_COLLECTIONS,
  captureDocument,
  RECOVERY_OUTBOX,
  RECOVERY_STATE,
} from "./OriginalCapture";
import { decodeOriginal, encodeOriginal } from "./OriginalCodec";

/** Capture retained images once when recovery is activated. Never rewrite business rows. */
export function captureRetainedOriginals(
  db: DatabaseAdapter,
  context: { key: string; terminalIds: string[] },
) {
  return withRecoveryPreparation(db, context.key, async (base) => {
    const markerId = "retained-v1:" + context.key;
    if (await base.getDocument(RECOVERY_STATE, markerId)) return 0;
    if (!base.saveDocumentsAtomically)
      throw Error("RECOVERY_ATOMIC_STORAGE_UNAVAILABLE");
    const images = new Map<
      string,
      { collection: string; document: any; body: string }
    >();
    for (const [collection, kind] of Object.entries(CAPTURE_COLLECTIONS)) {
      for (const document of await base.getCollection<any>(collection)) {
        if (document?._posRecovery?.snapshotId) continue;
        const terminal = document.terminalId || document.source_terminal_id;
        if (terminal && !context.terminalIds.includes(terminal))
          throw Error("RETAINED_ORIGINAL_SCOPE_MISMATCH");
        if (!document?.id) throw Error("RETAINED_ORIGINAL_ID_REQUIRED");
        const id = JSON.stringify([kind, document.id]);
        const body = encodeOriginal(document);
        const previous = images.get(id);
        if (previous && previous.body !== body)
          throw Error("RETAINED_ORIGINAL_CONFLICT");
        images.set(id, { collection, document, body });
      }
    }
    const state = (await base.getDocument<any>(RECOVERY_STATE, "capture")) || {
      id: "capture",
      storageEpoch: crypto.randomUUID(),
      openSetId: crypto.randomUUID(),
      sequence: "0",
    };
    const mutations: DurableDocumentMutation[] = [];
    let count = 0;
    for (const [headId, image] of images) {
      // A newer ordinary capture is authoritative; bootstrap must never replace it.
      if (await base.getDocument(RECOVERY_STATE, headId)) continue;
      const capture = captureDocument(
        image.collection,
        image.document,
        {
          key: context.key,
          terminalId: context.terminalIds[0],
        },
        null,
      )!;
      const envelope = decodeOriginal(capture.body) as any;
      capture.body = encodeOriginal({
        ...envelope,
        retainedCapture: {
          version: 1,
          capturedAt: capture.capturedAt,
          coverage: "LEGACY_UNKNOWN",
          historicalConfiguration: "UNKNOWN",
          preNormalizationImage: "UNAVAILABLE",
        },
      });
      state.sequence = (BigInt(state.sequence) + 1n).toString();
      mutations.push(
        {
          collectionName: RECOVERY_OUTBOX,
          document: {
            ...capture,
            storageEpoch: state.storageEpoch,
            openSetId: state.openSetId,
            sequence: state.sequence,
            revision: state.sequence,
          },
        },
        {
          collectionName: RECOVERY_STATE,
          document: {
            id: headId,
            body: capture.body,
            sequence: state.sequence,
            captureId: capture.id,
          },
        },
      );
      count++;
    }
    mutations.push(
      { collectionName: RECOVERY_STATE, document: state },
      {
        collectionName: RECOVERY_STATE,
        document: { id: markerId, count, coverage: "LEGACY_UNKNOWN" },
      },
    );
    await base.saveDocumentsAtomically(mutations);
    return count;
  });
}
