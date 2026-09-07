import type {
  DatabaseAdapter,
  DurableDocumentMutation,
} from "../db/DatabaseAdapter";
import {
  CAPTURE_COLLECTIONS,
  RECOVERY_OUTBOX,
  RECOVERY_STATE,
  captureDocument,
} from "./OriginalCapture";
import { decodeOriginal, encodeOriginal } from "./OriginalCodec";
import { projectNativeZConfiguration } from "./NativeZConfiguration";

/** Called inside the publication transaction after a validated durable ACK.
 * These are backup postimages, not new commercial commands. */
export async function committedCloseCaptures(
  base: DatabaseAdapter,
  changes: DurableDocumentMutation[],
  scopeKey: string,
  ack: any,
): Promise<DurableDocumentMutation[]> {
  const config = await base.getDocument<any>("config", "current");
  const configuration = config ? projectNativeZConfiguration(config) : null;
  const captureMutation = changes.find(
    (c) => c.collectionName === RECOVERY_STATE && c.document.id === "capture",
  );
  if (
    !captureMutation ||
    captureMutation.document.openSetId !== ack.nextOpenSetId
  )
    throw Error("RECEIVED_CLOSE_CAPTURE_STATE");
  const state = { ...captureMutation.document };
  const extra: DurableDocumentMutation[] = [];
  for (const change of changes) {
    if (!CAPTURE_COLLECTIONS[change.collectionName]) continue;
    const isReport =
      change.collectionName === "zReports" &&
      change.document.id === ack.closeId;
    if (!isReport && change.document.zReportId !== ack.closeId) continue;
    const { _posRecovery, ...image } = change.document;
    const capture = captureDocument(
      change.collectionName,
      image,
      { key: scopeKey, terminalId: ack.scope.terminalId },
      configuration,
    );
    if (!capture) throw Error("RECEIVED_CLOSE_CAPTURE_INVALID");
    const envelope = decodeOriginal(capture.body) as any;
    capture.body = encodeOriginal({ ...envelope, closeCommitId: ack.commitId });
    state.sequence = (BigInt(state.sequence) + 1n).toString();
    extra.push({
      collectionName: RECOVERY_OUTBOX,
      document: {
        ...capture,
        storageEpoch: state.storageEpoch,
        openSetId: state.openSetId,
        sequence: state.sequence,
        revision: state.sequence,
      },
    });
    extra.push({
      collectionName: RECOVERY_STATE,
      document: {
        id: JSON.stringify([capture.kind, capture.originalId]),
        body: capture.body,
        sequence: state.sequence,
        captureId: capture.id,
      },
    });
    change.document = {
      ...change.document,
      _posRecovery: {
        ..._posRecovery,
        snapshotId: ack.snapshotId,
        commitId: ack.commitId,
        closedImage: true,
        coverage: "RECEIVED_ONLY",
        exactZEligible: false,
        closeAuthorization: "GRANTED_RECEIVED_SCOPE",
      },
    };
  }
  captureMutation.document = state;
  return [...changes, ...extra];
}
