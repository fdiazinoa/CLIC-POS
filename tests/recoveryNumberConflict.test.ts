import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/closePreparationSQLite";
import { ReceivedCloseFlow } from "../services/recovery/ReceivedCloseFlow";
import {
  encodeOriginal,
  originalDigest,
} from "../services/recovery/OriginalCodec";
import { recoveryCanonicalJson } from "../services/recovery/RecoveryJson";
const hash = (s: string) => originalDigest(new TextEncoder().encode(s));
const scope = {
  tenantId: crypto.randomUUID(),
  companyId: crypto.randomUUID(),
  storeId: crypto.randomUUID(),
  terminalId: crypto.randomUUID(),
};
async function setup() {
  const f = fixture(),
    opened = f.open(),
    db = opened.db,
    key = "company:terminal",
    prep = "attempt";
  const commandId = crypto.randomUUID(),
    seriesId = crypto.randomUUID(),
    request = { commandId, original: "immutable" };
  const candidate = {
    scope,
    input: { seriesId },
    observed: {
      membership: { intent: { commandId } },
      trace: {
        resources: {
          series: {
            seriesId,
            prefix: "Z-",
            padding: 3,
            nextNumber: "1",
            revision: "0",
          },
        },
      },
    },
    submissionBody: JSON.stringify(request),
  };
  const body = encodeOriginal(candidate);
  await db.saveDocument("recoveryState", {
    id: JSON.stringify(["receivedCloseCandidate", key, prep]),
    body,
    bodySha256: await hash(body),
  });
  await db.saveDocument("transactions", {
    id: "SALE",
    terminalId: "T1",
    total: 100,
  });
  await db.saveDocument("internalSequences", { id: seriesId, nextNumber: 1 });
  await db.saveDocument("documentSeries", { id: seriesId, nextNumber: 6 });
  await db.saveDocument("config", {
    id: "current",
    terminals: [
      {
        id: "T1",
        config: { documentSeries: [{ id: seriesId, nextNumber: 8 }] },
      },
    ],
  });
  const proof = {
    version: 1,
    status: "CANCELLED",
    reason: "NUMBER_CONFLICT",
    proofId: crypto.randomUUID(),
    scope,
    commandId,
    requestHash: await hash(recoveryCanonicalJson(request)),
    cancelledAt: "2026-09-07T23:30:00Z",
    exactZEligible: false,
    closeAuthorization: "NOT_GRANTED",
    series: {
      seriesId,
      prefix: "Z-",
      padding: 3,
      previousCode: "Z-001",
      previousNext: "1",
      nextNumber: "4",
      previousRevision: "0",
      revision: "1",
    },
  };
  let calls = 0,
    submits = 0;
  const transport = {
    context: async () => ({ key, scope, enabled: true }),
    observe: async () => null,
    result: async () => null,
    submit: async () => {
      submits++;
      return null;
    },
    cancelNumberConflict: async (id: string, exact: string) => {
      calls++;
      assert.equal(id, commandId);
      assert.equal(exact, candidate.submissionBody);
      return proof;
    },
  };
  return {
    f,
    db,
    key,
    prep,
    proof,
    transport,
    seriesId,
    calls: () => calls,
    submits: () => submits,
  };
}
test("durable cancellation archives the observed attempt, advances counters without rewind, and blocks old submissions after restart", async () => {
  const x = await setup();
  try {
    let flow = new ReceivedCloseFlow(x.db, x.transport);
    const sales = await x.db.getCollection("transactions"),
      originals = await x.db.getCollection("recoveryOriginals");
    assert.deepEqual(await flow.resolveNumberConflict(x.key, x.prep), x.proof);
    assert.equal(
      (await x.db.getDocument<any>("internalSequences", x.seriesId))!
        .nextNumber,
      4,
    );
    assert.equal(
      (await x.db.getDocument<any>("documentSeries", x.seriesId))!.nextNumber,
      6,
    );
    assert.equal(
      (await x.db.getDocument<any>("config", "current"))!.terminals[0].config
        .documentSeries[0].nextNumber,
      8,
    );
    assert.deepEqual(await x.db.getCollection("transactions"), sales);
    assert.deepEqual(await x.db.getCollection("recoveryOriginals"), originals);
    const { db } = x.f.restart();
    flow = new ReceivedCloseFlow(db, x.transport);
    assert.deepEqual(await flow.resolveNumberConflict(x.key, x.prep), x.proof);
    assert.equal(x.calls(), 1);
    await assert.rejects(flow.commit(x.key, x.prep), /COMMAND_CANCELLED/);
    assert.equal(x.submits(), 0);
    assert((await flow.progress(x.key, x.prep)).candidate);
    assert((await flow.progress(x.key, x.prep)).cancelled);
    assert.equal((await db.getCollection("zReports")).length, 0);
  } finally {
    x.f.close();
  }
});
test("lost cancellation ACK is retried with identical intent and local failure leaves both proof and counters unmodified", async () => {
  const x = await setup();
  try {
    let lost = true;
    const transport = {
      ...x.transport,
      cancelNumberConflict: async (id: string, body: string) => {
        const proof = await x.transport.cancelNumberConflict(id, body);
        if (lost) {
          lost = false;
          throw Error("ACK_LOST");
        }
        return proof;
      },
    };
    const flow = new ReceivedCloseFlow(x.db, transport);
    await assert.rejects(flow.resolveNumberConflict(x.key, x.prep), /ACK_LOST/);
    x.f.failOnCollection("config");
    await assert.rejects(
      flow.resolveNumberConflict(x.key, x.prep),
      /disk failed/,
    );
    assert.equal((await flow.progress(x.key, x.prep)).cancelled, null);
    assert.equal(
      (await x.db.getDocument<any>("internalSequences", x.seriesId))!
        .nextNumber,
      1,
    );
    x.f.failOnCollection(null);
    assert.deepEqual(await flow.resolveNumberConflict(x.key, x.prep), x.proof);
  } finally {
    x.f.close();
  }
});
test("foreign, rehashed, unauthorized or nonmonotonic cancellation proofs cannot discard a candidate", async () => {
  const x = await setup();
  try {
    for (const alter of [
      (p: any) => (p.scope.companyId = crypto.randomUUID()),
      (p: any) => (p.requestHash = "0".repeat(64)),
      (p: any) => (p.commandId = crypto.randomUUID()),
      (p: any) => (p.proofId = ""),
      (p: any) => (p.exactZEligible = true),
      (p: any) => (p.closeAuthorization = "GRANTED_RECEIVED_SCOPE"),
      (p: any) => (p.series.nextNumber = "1"),
      (p: any) => (p.series.previousNext = "5"),
      (p: any) => (p.series.previousCode = "Z-009"),
      (p: any) => (p.series.revision = "-1"),
    ]) {
      const proof = structuredClone(x.proof);
      alter(proof);
      const flow = new ReceivedCloseFlow(x.db, {
        ...x.transport,
        cancelNumberConflict: async () => proof,
      });
      await assert.rejects(
        flow.resolveNumberConflict(x.key, x.prep),
        /CANCELLATION_INVALID/,
      );
      assert.equal((await flow.progress(x.key, x.prep)).cancelled, null);
    }
  } finally {
    x.f.close();
  }
});
