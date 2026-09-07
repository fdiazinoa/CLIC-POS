import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeOriginal,
  decodeOriginal,
  encodeBase64,
  originalDigest,
  ORIGINAL_ENCODING,
} from "../services/recovery/OriginalCodec";
import {
  captureDocument,
  withOriginal,
  RECOVERY_OUTBOX,
  RECOVERY_STATE,
  RECOVERY_STAGE,
} from "../services/recovery/OriginalCapture";
import { recoveryDatabase } from "../services/recovery/RecoveryDatabase";
import {
  PendingOperationsRecovery,
  recordBytes,
  type OriginalRecord,
  type RecoveryTransport,
} from "../services/recovery/PendingOperationsRecovery";
const clone = <T>(v: T): T => structuredClone(v);
class Memory {
  adapterType = "local" as const;
  rows = new Map<string, any>();
  fail = false;
  async connect() {}
  async disconnect() {}
  async deleteDocument(c: string, id: string) {
    this.rows.delete(c + ":" + id);
  }
  async getDocument<T>(c: string, id: string): Promise<T | null> {
    return clone(this.rows.get(c + ":" + id) || null);
  }
  async getCollection<T>(c: string): Promise<T[]> {
    return clone(
      [...this.rows].filter(([k]) => k.startsWith(c + ":")).map(([, v]) => v),
    );
  }
  async saveDocument(c: string, d: any) {
    this.rows.set(c + ":" + d.id, clone(d));
  }
  async saveCollection(c: string, ds: any[]) {
    await this.saveDocumentsAtomically(
      ds.map((document) => ({ collectionName: c, document })),
      false,
      [c],
    );
  }
  async bulkUpsert(c: string, ds: any[]) {
    for (const d of ds) await this.saveDocument(c, d);
  }
  async bulkUpdateProducts() {}
  async saveDocumentsAtomically(
    ds: any[],
    absent = false,
    replace: string[] = [],
  ) {
    if (this.fail) throw Error("disk failed");
    const next = new Map(this.rows);
    for (const c of replace)
      for (const k of next.keys()) if (k.startsWith(c + ":")) next.delete(k);
    for (const d of ds) {
      const key = d.collectionName + ":" + d.document.id;
      if (absent && next.has(key)) throw Error("RECOVERY_LOCAL_CONFLICT");
      next.set(key, clone(d.document));
    }
    this.rows = next;
  }
}
const provenance = () => ({ key: "scope", terminalId: "T1" });
const record = async (
  document: any,
  collection = "transactions",
  revision = "1",
): Promise<OriginalRecord> => {
  const capture = captureDocument(collection, document, provenance())!;
  const data = new TextEncoder().encode(capture.body);
  return {
    version: 1,
    storageEpoch: "11111111-1111-4111-8111-111111111111",
    openSetId: "22222222-2222-4222-8222-222222222222",
    sequence: revision,
    kind: capture.kind,
    originalId: document.id,
    revision,
    encoding: ORIGINAL_ENCODING,
    bodyBase64: encodeBase64(data),
    bodySha256: await originalDigest(data),
    byteLength: data.length,
  };
};
async function transport(records: OriginalRecord[]) {
  const receipts = await Promise.all(
    records.map(async (record, i) => ({
      receiptId: String(i + 1),
      recordHash: await originalDigest(recordBytes(record)),
      receivedAt: "2026-09-07T00:00:00.000Z",
      record,
    })),
  );
  const digest = await originalDigest(
    new TextEncoder().encode(
      receipts.map((r) => `${r.receiptId}:${r.recordHash}\n`).join(""),
    ),
  );
  let pages = 0,
    breakOnce = false;
  const snapshot = {
    snapshotId: "SNAP",
    totalRecords: records.length,
    snapshotDigest: digest,
    expiresAt: "2099-01-01T00:00:00.000Z",
    nextCursor: records.length ? "0" : null,
    completeness: "RECEIVED_ORIGINALS_ONLY",
    exactZEligible: false,
    closeAuthorization: "NOT_GRANTED",
  };
  const api: RecoveryTransport = {
    context: async () => ({ key: "scope", terminalIds: ["T1"], enabled: true }),
    receive: async (rs) => ({
      receipts: rs.map((r) => ({
        ...r,
        receiptId: "ack",
        receiptStatus: "RECEIVED",
      })),
    }),
    snapshot: async () => clone(snapshot),
    page: async (_id, cursor) => {
      pages++;
      if (breakOnce && cursor === "1") {
        breakOnce = false;
        throw Error("offline");
      }
      const i = Number(cursor);
      return {
        ...clone(snapshot),
        records: [clone(receipts[i])],
        pageStart: i,
        nextCursor: i + 1 < receipts.length ? String(i + 1) : null,
      };
    },
  };
  return {
    api,
    receipts,
    setBreak: () => {
      breakOnce = true;
    },
    pages: () => pages,
  };
}
test("codec preserves aliases, presence, dates, negative zero and harmless prototype keys", () => {
  const v: any = {
    a: undefined,
    n: null,
    d: new Date("2026-01-01T00:00:00Z"),
    negative: -0,
    aliases: { appliedAmount: 70, applied_amount: 60 },
    array: new Array(2),
  };
  v.array[1] = undefined;
  Object.defineProperty(v, "__proto__", {
    enumerable: true,
    value: { safe: true },
  });
  const decoded: any = decodeOriginal(encodeOriginal(v));
  assert.deepEqual(decoded, v);
  assert.equal(Object.hasOwn(decoded.array, 0), false);
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.throws(() =>
    decodeOriginal('["object",[["a",["null"]],["a",["null"]]]]'),
  );
  assert.throws(() => encodeOriginal({ f: () => 0 }));
});
test("document and pre-normalization original commit together; storage failure publishes neither", async () => {
  const base = new Memory(),
    db = recoveryDatabase(base, () => true, provenance);
  const raw = {
    id: "A",
    terminalId: "T1",
    payments: [{ appliedAmount: 70, applied_amount: 60, extension: true }],
  };
  const producerInput = { ...raw, extensionBeforeConstruction: undefined };
  const doc = withOriginal({ ...raw, payments: [{ appliedAmount: 60 }] }, raw, producerInput);
  base.fail = true;
  await assert.rejects(db.saveDocument("transactions", doc));
  assert.equal(base.rows.size, 0);
  base.fail = false;
  await db.saveDocument("transactions", { ...doc });
  const rows = await base.getCollection<any>(RECOVERY_OUTBOX);
  assert.equal(rows.length, 1);
  const envelope: any = decodeOriginal(rows[0].body);
  assert.equal(envelope.originalStage, "PRE_NORMALIZATION");
  assert.deepEqual(decodeOriginal(envelope.original), raw);
  assert.deepEqual(decodeOriginal(envelope.producerInput), producerInput);
  assert.equal(
    (decodeOriginal(envelope.document) as any).payments[0].appliedAmount,
    60,
  );
  await db.saveDocument("transactions", { ...doc });
  assert.equal((await base.getCollection<any>(RECOVERY_OUTBOX)).length, 1);
});
test("interrupted pages resume; latest revision restored once; local operations retained; no commercial replay", async () => {
  const rs = [
    await record({ id: "A", terminalId: "T1", total: 50 }, "transactions", "1"),
    await record({ id: "A", terminalId: "T1", total: 60 }, "transactions", "2"),
  ];
  const t = await transport(rs),
    db = new Memory(),
    service = new PendingOperationsRecovery(db, t.api);
  t.setBreak();
  await db.saveDocument("transactions", { id: "NEW", total: 7 });
  await assert.rejects(service.download(), /offline/);
  assert.equal((await db.getCollection("transactions")).length, 1);
  await service.download();
  assert.equal(await service.restore(), 1);
  assert.equal(await service.restore(), 1);
  const restored = await db.getDocument<any>("transactions", "A");
  assert.equal(restored.total, 60);
  assert.equal(restored._posRecovery.closeAuthorization, "NOT_GRANTED");
  assert.equal((await db.getDocument<any>("transactions", "NEW")).total, 7);
  assert.equal((await db.getCollection(RECOVERY_OUTBOX)).length, 0);
});
test("closed member with lost ACK stays history; close preserved; collection retains closed dependency", async () => {
  const rs = [
    await record({ id: "A", terminalId: "T1", total: 50 }),
    await record(
      {
        id: "Z",
        terminalId: "T1",
        recoveryMemberIds: {
          transactions: ["A"],
          cashMovements: [],
          collections: [],
        },
      },
      "zReports",
      "2",
    ),
    await record(
      {
        id: "C",
        terminalId: "T1",
        allocations: [{ transactionId: "A", amount: 5 }],
      },
      "collections",
      "3",
    ),
  ];
  const t = await transport(rs),
    db = new Memory(),
    service = new PendingOperationsRecovery(db, t.api);
  await service.download();
  await service.restore();
  assert.equal(await db.getDocument("transactions", "A"), null);
  assert.equal(
    (await db.getDocument<any>("transactionHistory", "A")).zReportId,
    "Z",
  );
  assert.equal(
    (await db.getDocument<any>("collections", "C")).allocations[0]
      .transactionId,
    "A",
  );
  assert.equal((await db.getCollection("zReports")).length, 1);
});
test("local collision or staged corruption never partially publishes", async () => {
  const t = await transport([
      await record({ id: "A", terminalId: "T1" }),
      await record({ id: "B", terminalId: "T1" }, "transactions", "2"),
    ]),
    db = new Memory(),
    s = new PendingOperationsRecovery(db, t.api);
  await s.download();
  await db.saveDocument("transactions", { id: "B", local: true });
  await assert.rejects(s.restore(), /LOCAL_CONFLICT/);
  assert.equal(await db.getDocument("transactions", "A"), null);
  const stage = (await db.getCollection<any>(RECOVERY_STAGE))[0];
  stage.record.revision = "9";
  await db.saveDocument(RECOVERY_STAGE, stage);
  await assert.rejects(s.restore(), /STAGE_CHANGED/);
});
test("technical ACK does not update commercial status; wrong ACK retained for retry", async () => {
  const db = new Memory(),
    wrapped = recoveryDatabase(db, () => true, provenance);
  await wrapped.saveDocument("transactions", {
    id: "A",
    terminalId: "T1",
    syncStatus: "PENDING",
  });
  const t = await transport([]),
    s = new PendingOperationsRecovery(db, t.api);
  const receive = t.api.receive;
  t.api.receive = async () => ({ receipts: [] });
  await assert.rejects(s.sendPending(), /ACK_MISMATCH/);
  assert.equal(
    (await db.getCollection<any>(RECOVERY_OUTBOX))[0].status,
    "PENDING",
  );
  t.api.receive = receive;
  assert.equal(await s.sendPending(), 1);
  assert.equal(
    (await db.getDocument<any>("transactions", "A")).syncStatus,
    "PENDING",
  );
  assert.equal(
    (await db.getCollection<any>(RECOVERY_OUTBOX))[0].status,
    "RECEIVED",
  );
});

test("scope change and overlapping epochs block recovery without publishing", async () => {
  const a = await record({ id: "A", terminalId: "T1" }),
    b = {
      ...(await record({ id: "A", terminalId: "T1" }, "transactions", "2")),
      storageEpoch: "33333333-3333-4333-8333-333333333333",
    };
  const t = await transport([a, b]),
    db = new Memory(),
    s = new PendingOperationsRecovery(db, t.api);
  await s.download();
  await assert.rejects(s.restore(), /EPOCH_AUTHORITY_REQUIRED/);
  assert.equal((await db.getCollection("transactions")).length, 0);
  t.api.context = async () => ({
    key: "another-tenant",
    terminalIds: ["T1"],
    enabled: true,
  });
  await assert.rejects(s.restore(), /NOT_VERIFIED/);
});
test("restored documents are not recaptured; inactive flag uses unchanged legacy storage", async () => {
  const db = new Memory(),
    wrapped = recoveryDatabase(db, () => true, provenance);
  await wrapped.saveDocument("transactions", {
    id: "A",
    _posRecovery: { snapshotId: "S" },
  });
  assert.equal((await db.getCollection(RECOVERY_OUTBOX)).length, 0);
  const disabled = recoveryDatabase(db, () => false, provenance);
  await disabled.saveDocument("transactions", { id: "B" });
  assert.equal((await db.getCollection(RECOVERY_OUTBOX)).length, 0);
});
test("a received closure cannot silently leave an already local active sale behind", async () => {
  const t = await transport([
    await record({ id: "A", terminalId: "T1" }),
    await record(
      {
        id: "Z",
        terminalId: "T1",
        recoveryMemberIds: {
          transactions: ["A"],
          cashMovements: [],
          collections: [],
        },
      },
      "zReports",
      "2",
    ),
  ]);
  const db = new Memory(),
    s = new PendingOperationsRecovery(db, t.api);
  await db.saveDocument("transactions", {
    id: "A",
    _posRecovery: { snapshotId: "older" },
  });
  await s.download();
  await assert.rejects(s.restore(), /LOCAL_CONFLICT/);
  assert.equal(await db.getDocument("transactionHistory", "A"), null);
  assert.equal(await db.getDocument("zReports", "Z"), null);
});
