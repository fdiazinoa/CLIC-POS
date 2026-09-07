import type {
  DatabaseAdapter,
  DurableDocumentMutation,
} from "../db/DatabaseAdapter";
import {
  CAPTURE_COLLECTIONS,
  RECOVERY_STAGE,
  RECOVERY_STATE,
} from "./OriginalCapture";
import { decodeBase64, decodeOriginal, originalDigest } from "./OriginalCodec";
import { recoveryCanonicalJson } from "./RecoveryJson";
import { recordBytes } from "./PendingOperationsRecovery";
import { retainedReference, type RetainedContext } from "./RetainedCaptureSet";
import { withRecoveryPreparation } from "./RecoveryDatabase";
const require = (ok: unknown, code = "RETAINED_DESCRIPTOR_INVALID") => {
  if (!ok) throw Error(code);
};
const same = (a: unknown, b: unknown) =>
  recoveryCanonicalJson(a) === recoveryCanonicalJson(b);
const hash = (x: unknown) =>
  originalDigest(new TextEncoder().encode(recoveryCanonicalJson(x)));

/** Validate every receipt, including explicitly unselected history. Never infer closure from dates. */
export async function validateRetainedRestore(
  ctx: RetainedContext,
  state: any,
  rows: any[],
  d: any,
) {
  require(
    ctx.recoveryScope &&
      state.context === ctx.key &&
      state.status === "VERIFIED",
  );
  require(Date.parse(state.snapshot.expiresAt) > Date.now());
  require(
    d &&
      d.version === 1 &&
      d.profile === "erp.retained-local-set.v1" &&
      same(d.scope, ctx.recoveryScope) &&
      ctx.terminalIds.includes(d.sourceTerminalId) &&
      d.snapshot?.snapshotId === state.snapshot.snapshotId &&
      d.snapshot?.snapshotDigest === state.snapshot.snapshotDigest &&
      d.snapshot?.totalRecords === state.snapshot.totalRecords &&
      d.commercialState === "UNKNOWN" &&
      d.coverage === "LEGACY_UNKNOWN" &&
      d.exactZEligible === false &&
      d.closeAuthorization === "NOT_GRANTED" &&
      d.replayAllowed === false,
  );
  const { descriptorHash, ...body } = d;
  require((await hash(body)) === descriptorHash);
  require(
    rows.length === state.loaded &&
      rows.length === state.snapshot.totalRecords &&
      rows.length <= 1000,
  );
  const expected = new Map(
    state.receipts.map((r: any) => [r.receiptId, r.recordHash]),
  );
  require(expected.size === rows.length);
  const byReceipt = new Map<string, any>();
  let bytes = 0;
  for (const row of rows) {
    require(!byReceipt.has(row.receiptId) &&
      expected.get(row.receiptId) === row.recordHash, "RECOVERY_STAGE_CHANGED");
    const raw = decodeBase64(row.record.bodyBase64);
    require(raw.length === row.record.byteLength &&
      (await originalDigest(raw)) === row.record.bodySha256 &&
      (await originalDigest(recordBytes(row.record))) ===
        row.recordHash, "RECOVERY_STAGE_CHANGED");
    bytes += raw.length;
    byReceipt.set(row.receiptId, row);
  }
  require(bytes <= 16777216);
  const resolve = (ref: any) => {
    const row = byReceipt.get(ref?.receiptId);
    require(row &&
      same(retainedReference(row), ref), "RETAINED_REFERENCE_MISMATCH");
    return row;
  };
  const manifest = resolve(d.manifestReference);
  require(manifest.record.kind === "MEMBERSHIP");
  const m: any = decodeOriginal(
    new TextDecoder().decode(decodeBase64(manifest.record.bodyBase64)),
  );
  require(
    m?.version === 1 &&
      m.domain === "pos.retained-capture-set.v1" &&
      m.captureSetId === manifest.record.originalId &&
      same(m.scope, ctx.recoveryScope) &&
      same(m.sourceCut, d.sourceCut) &&
      same(m.placements, d.placements),
  );
  require(
    Array.isArray(d.placements) &&
      d.placements.length <= 2000 &&
      Array.isArray(d.unselectedReferences),
  );
  const used = new Set<string>([manifest.receiptId]),
    places = new Set<string>(),
    revisions = new Map<string, string>();
  const decoded: Array<{ collection: string; document: any; row: any }> = [];
  for (const p of d.placements) {
    const row = resolve(p.original),
      r = row.record;
    require(
      Object.prototype.hasOwnProperty.call(CAPTURE_COLLECTIONS, p.collection) &&
        CAPTURE_COLLECTIONS[p.collection] === r.kind,
    );
    require(BigInt(row.receiptId) < BigInt(manifest.receiptId));
    const place = JSON.stringify([p.collection, r.originalId]),
      identity = JSON.stringify([r.kind, r.originalId]);
    require(
      !places.has(place) &&
        (!revisions.has(identity) || revisions.get(identity) === row.receiptId),
    );
    places.add(place);
    revisions.set(identity, row.receiptId);
    used.add(row.receiptId);
    const envelope: any = decodeOriginal(
      new TextDecoder().decode(decodeBase64(r.bodyBase64)),
    );
    const document: any = decodeOriginal(envelope.document);
    decodeOriginal(envelope.original);
    require(
      envelope.version === 1 &&
        (envelope.collection ===
          (p.collection === "transactionHistory"
            ? "transactions"
            : p.collection) ||
          (p.collection === "transactionHistory" &&
            envelope.collection === "transactionHistory")) &&
        document?.id === r.originalId,
    );
    for (const id of [document.terminalId, document.source_terminal_id])
      require(id === undefined ||
        ctx.terminalIds.includes(id), "RETAINED_SCOPE_MISMATCH");
    require(!document._posRecovery);
    // An active placement cannot reopen a document whose original already carries a close.
    require(!["transactions", "cashMovements", "collections"].includes(
      p.collection,
    ) || !document.zReportId, "RETAINED_ALREADY_CLOSED");
    decoded.push({ collection: p.collection, document, row });
  }
  for (const ref of d.unselectedReferences) {
    const row = resolve(ref);
    require(!used.has(row.receiptId), "RETAINED_COVERAGE");
    used.add(row.receiptId);
  }
  require(used.size === rows.length, "RETAINED_COVERAGE");
  return decoded;
}

/** Commit only runtime images plus an import marker through the existing atomic queue. */
export function restoreRetainedSet(
  db: DatabaseAdapter,
  ctx: RetainedContext,
  state: any,
  descriptor: any,
) {
  return withRecoveryPreparation(db, ctx.key, async (base) => {
    const current = await base.getDocument<any>(RECOVERY_STATE, "download");
    require(same(current, state), "RECOVERY_STAGE_CHANGED");
    const rows = (await base.getCollection<any>(RECOVERY_STAGE)).filter(
      (r) => r.snapshotId === state.snapshot.snapshotId,
    );
    const decoded = await validateRetainedRestore(ctx, state, rows, descriptor);
    const markerId = "retainedImport:" + descriptor.manifestReference.receiptId;
    const marker = await base.getDocument<any>(RECOVERY_STATE, markerId);
    if (marker) {
      require(marker.descriptorHash ===
        descriptor.descriptorHash, "RETAINED_IMPORT_CONFLICT");
      return marker.count;
    }
    const mutations: DurableDocumentMutation[] = [];
    for (const { collection, document, row } of decoded) {
      if (
        collection === "transactions" ||
        collection === "transactionHistory"
      ) {
        const other =
          collection === "transactions" ? "transactionHistory" : "transactions";
        require(!(await base.getDocument(
          other,
          document.id,
        )), "RECOVERY_LOCAL_CONFLICT");
      }
      require(!(await base.getDocument(
        collection,
        document.id,
      )), "RECOVERY_LOCAL_CONFLICT");
      mutations.push({
        collectionName: collection,
        document: {
          ...document,
          _posRecovery: {
            snapshotId: state.snapshot.snapshotId,
            receiptId: row.receiptId,
            bodySha256: row.record.bodySha256,
            businessApplication: "UNKNOWN",
            exactZEligible: false,
            closeAuthorization: "NOT_GRANTED",
          },
        },
      });
    }
    require(base.saveDocumentsAtomically, "RECOVERY_ATOMIC_STORAGE_UNAVAILABLE");
    mutations.push({
      collectionName: RECOVERY_STATE,
      document: {
        id: markerId,
        descriptorHash: descriptor.descriptorHash,
        descriptor,
        count: decoded.length,
        exactZEligible: false,
        closeAuthorization: "NOT_GRANTED",
      },
    });
    await base.saveDocumentsAtomically!(mutations, true);
    return decoded.length;
  });
}
