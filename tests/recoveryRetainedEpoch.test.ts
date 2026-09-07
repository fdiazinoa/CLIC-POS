import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/closePreparationSQLite";
import {
  prepareRetainedEpoch,
  applyRetainedEpoch,
  validateRetainedEpochAck,
  validateRetainedLineage,
} from "../services/recovery/RetainedEpoch";
const old = "11111111-1111-4111-8111-111111111111";
const scope = {
  tenantId: old,
  companyId: "22222222-2222-4222-8222-222222222222",
  storeId: "33333333-3333-4333-8333-333333333333",
  terminalId: "44444444-4444-4444-8444-444444444444",
};
const ctx = {
  key: "company:terminal",
  terminalIds: ["T1", scope.terminalId],
  recoveryScope: scope,
};
const ref = {
  receiptId: "21",
  recordHash: "a".repeat(64),
  storageEpoch: old,
  kind: "MEMBERSHIP",
  originalId: "55555555-5555-4555-8555-555555555555",
  revision: "21",
  bodySha256: "b".repeat(64),
};
const descriptor = {
  manifestReference: ref,
  placements: [],
  snapshot: {
    snapshotId: "66666666-6666-4666-8666-666666666666",
    snapshotDigest: "c".repeat(64),
    cutoffReceiptId: "21",
  },
  lineage: { version: 1, currentEpoch: old, transitions: [] },
};
function ackFor(s: any) {
  return {
    version: 1,
    profile: "erp.retained-epoch.v1",
    requestId: s.request.requestId,
    scope,
    predecessorManifestReference: ref,
    predecessorEpoch: old,
    storageEpoch: s.request.newEpoch,
    generation: "1",
    nextSequence: "1",
    requestHash: s.requestHash,
    exactZEligible: false,
    closeAuthorization: "NOT_GRANTED",
    replayAllowed: false,
  };
}
function resumed(s: any) {
  return {
    ...descriptor,
    lineage: {
      version: 1,
      currentEpoch: s.request.newEpoch,
      transitions: [
        {
          requestId: s.request.requestId,
          predecessorEpoch: old,
          storageEpoch: s.request.newEpoch,
          generation: "1",
          predecessorManifestReference: ref,
        },
      ],
    },
  };
}
test("durable resume intent survives restart, prevents intervening captures, rolls back failed ACK and preserves counters on retry", async () => {
  const f = fixture();
  try {
    let { db } = f.open();
    const s = await prepareRetainedEpoch(db, ctx, descriptor);
    await assert.rejects(
      db.saveDocument("transactions", { id: "must-wait", total: 10 }),
      /CONTINUITY_PENDING/,
    );
    assert.deepEqual(await db.getCollection("transactions"), []);
    ({ db } = f.restart());
    assert.deepEqual(await prepareRetainedEpoch(db, ctx, descriptor), s);
    const ack = ackFor(s),
      d = resumed(s);
    f.failOnCollection("capture");
    // Simulate atomic storage failure after the transition update.
    f.failOnCollection("recoveryState");
    await assert.rejects(applyRetainedEpoch(db, ctx, s, ack, d), /disk failed/);
    assert.equal(
      (await db.getDocument<any>("recoveryState", s.id)).status,
      "PREPARED",
    );
    f.failOnCollection(null);
    await applyRetainedEpoch(db, ctx, s, ack, d);
    await db.saveDocument("transactions", {
      id: "new",
      terminalId: "T1",
      total: 10,
    });
    const capture = await db.getDocument<any>("recoveryState", "capture");
    assert.equal(capture.sequence, "1");
    assert.equal(capture.storageEpoch, ack.storageEpoch);
    await applyRetainedEpoch(db, ctx, s, ack, d);
    assert.deepEqual(await db.getDocument("recoveryState", "capture"), capture);
  } finally {
    f.close();
  }
});
test("wrong ACK scope/hash/epoch/authority and forked/cyclic lineage do not grant local continuation", async () => {
  const f = fixture();
  try {
    const { db } = f.open();
    const s = await prepareRetainedEpoch(db, ctx, descriptor);
    for (const changes of [
      { storageEpoch: old },
      { nextSequence: "0" },
      { requestHash: "0".repeat(64) },
      { scope: { ...scope, companyId: old } },
      { closeAuthorization: "GRANTED" },
      { replayAllowed: true },
    ])
      await assert.rejects(
        validateRetainedEpochAck(ctx, s, { ...ackFor(s), ...changes }),
      );
    const d = resumed(s);
    assert.equal(validateRetainedLineage(d, [old]), s.request.newEpoch);
    assert.throws(() =>
      validateRetainedLineage(
        { ...d, lineage: { ...d.lineage, currentEpoch: old } },
        [old],
      ),
    );
    assert.throws(() =>
      validateRetainedLineage(
        {
          ...d,
          lineage: {
            ...d.lineage,
            transitions: [...d.lineage.transitions, ...d.lineage.transitions],
          },
        },
        [old],
      ),
    );
    await assert.rejects(
      applyRetainedEpoch(db, ctx, s, ackFor(s), descriptor),
      /SUPERSEDED/,
    );
  } finally {
    f.close();
  }
});
