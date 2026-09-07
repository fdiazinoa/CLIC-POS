import { recoveryUuid } from './RecoveryUuid';
import { encodeOriginal } from "./OriginalCodec";
export const RECOVERY_OUTBOX = "recoveryOriginals";
export const RECOVERY_STATE = "recoveryState";
export const RECOVERY_STAGE = "recoveryStage";
export const CAPTURE_COLLECTIONS: Record<string, string> = {
  transactions: "TRANSACTION",
  transactionHistory: "TRANSACTION",
  cashMovements: "CASH_MOVEMENT",
  collections: "COLLECTION",
  wallet_transactions: "WALLET",
  zReports: "Z_REPORT",
};
const sourceOriginal = Symbol("recoveryOriginal");
/** Keep native before-normalization image off JSON payloads and structured clones. */
export function withOriginal<T extends object>(
  document: T,
  original: unknown,
  producerInput?: unknown,
): T {
  Object.defineProperty(document, sourceOriginal, {
    value: {
      original: encodeOriginal(original),
      producerInput:
        producerInput === undefined ? undefined : encodeOriginal(producerInput),
    },
    enumerable: true,
  });
  return document;
}
export interface CapturedOriginal {
  id: string;
  kind: string;
  originalId: string;
  localTerminalId: string | null;
  originKey: string;
  body: string;
  capturedAt: string;
  status: "PENDING" | "RECEIVED";
}
export function captureDocument(
  collection: string,
  document: any,
  provenance: { key: string; terminalId?: string } = { key: "" },
  configuration: unknown = null,
): CapturedOriginal | null {
  const kind = CAPTURE_COLLECTIONS[collection];
  if (
    !kind ||
    document?._posRecovery?.snapshotId ||
    !document ||
    typeof document.id !== "string" ||
    !document.id
  )
    return null;
  const clean = { ...document };
  delete clean[sourceOriginal];
  // Symbol is not operational content and is deliberately not persisted in runtime image.
  const source = document[sourceOriginal] as
    | { original: string; producerInput?: string }
    | undefined;
  const body = encodeOriginal({
    version: 1,
    collection:
      collection === "transactionHistory" ? "transactions" : collection,
    original: source?.original ?? encodeOriginal(clean),
    originalStage: source ? "PRE_NORMALIZATION" : "LOCAL_PERSISTENCE",
    ...(source?.producerInput === undefined
      ? {}
      : { producerInput: source.producerInput }),
    document: encodeOriginal(clean),
    configuration: encodeOriginal(configuration),
  });
  return {
    id: recoveryUuid(),
    kind,
    originalId: document.id,
    localTerminalId:
      document.terminalId ||
      document.source_terminal_id ||
      provenance.terminalId ||
      null,
    originKey: provenance.key,
    body,
    capturedAt: new Date().toISOString(),
    status: "PENDING",
  };
}
