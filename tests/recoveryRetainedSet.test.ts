import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/closePreparationSQLite";
import { captureRetainedSet } from "../services/recovery/RetainedCaptureSet";
import {
  restoreRetainedSet,
  validateRetainedRestore,
} from "../services/recovery/RetainedRestore";
import {
  originalRecord,
  recordBytes,
} from "../services/recovery/PendingOperationsRecovery";
import { originalDigest } from "../services/recovery/OriginalCodec";
import { recoveryCanonicalJson } from "../services/recovery/RecoveryJson";
import { pathToFileURL } from "node:url";
const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  storeId: "33333333-3333-4333-8333-333333333333",
  terminalId: "44444444-4444-4444-8444-444444444444",
};
const ctx = {
  key: "company:terminal",
  terminalIds: ["T1", scope.terminalId],
  recoveryScope: scope,
};
const digest = (x: string) => originalDigest(new TextEncoder().encode(x));
async function prepared() {
  const f = fixture(),
    { db } = f.open();
  const sale = {
    id: "sale",
    terminalId: "T1",
    source_terminal_id: scope.terminalId,
    total: 1500,
    payments: [
      {
        method: "CARD",
        currencyCode: "USD",
        amountOriginal: 25,
        exchangeRate: 60,
        appliedAmount: 1500,
      },
    ],
    extra: { absent: undefined },
  };
  await db.saveDocument("transactions", sale);
  await db.saveDocument("transactionHistory", sale);
  async function ack() {
    const result = [];
    for (const row of await db.getCollection<any>("recoveryOriginals")) {
      const record = await originalRecord(row),
        receiptId = row.sequence;
      await db.saveDocument("recoveryOriginals", {
        ...row,
        status: "RECEIVED",
        receipt: {
          receiptId,
          bodySha256: record.bodySha256,
          receiptStatus: "RECEIVED",
        },
      });
      result.push({
        receiptId,
        recordHash: await originalDigest(recordBytes(record)),
        record,
        receivedAt: "2026-09-07T00:00:00Z",
      });
    }
    return result;
  }
  await assert.rejects(captureRetainedSet(db, ctx), /NOT_RECEIVED/);
  await ack();
  const id = await captureRetainedSet(db, ctx);
  assert.equal(await captureRetainedSet(db, ctx), id);
  const rows = await ack();
  const manifest = rows.find((r) => r.record.kind === "MEMBERSHIP")!;
  const snapshot = {
    snapshotId: "55555555-5555-4555-8555-555555555555",
    snapshotDigest: await digest(
      rows.map((r) => r.receiptId + ":" + r.recordHash + "\n").join(""),
    ),
    totalRecords: rows.length,
    totalBytes: rows.reduce((n, r) => n + r.record.byteLength, 0),
    expiresAt: "2099-01-01T00:00:00Z",
  };
  const state = {
    id: "download",
    context: ctx.key,
    status: "VERIFIED",
    snapshot,
    loaded: rows.length,
    receipts: rows.map((r) => ({
      receiptId: r.receiptId,
      recordHash: r.recordHash,
    })),
  };
  const erp = process.env.CLIC_ERP_REVIEW_PATH;
  if (!erp)
    throw Error("CLIC_ERP_REVIEW_PATH required for independent ERP oracle");
  const { buildRetainedRestoreDescriptor } = await import(
    pathToFileURL(erp + "/server/services/posRetainedRestore.js").href
  );
  const descriptor = buildRetainedRestoreDescriptor(
    {
      p_tenant_id: scope.tenantId,
      p_company_id: scope.companyId,
      p_store_id: scope.storeId,
      p_terminal_id: scope.terminalId,
    },
    snapshot,
    rows,
    manifest.receiptId,
    { owners: [], closureState: "UNKNOWN" },
  );
  await db.saveDocument("recoveryState", state);
  for (const row of rows)
    await db.saveDocument("recoveryStage", {
      ...row,
      id: snapshot.snapshotId + ":" + row.receiptId,
      snapshotId: snapshot.snapshotId,
    });
  return { f, db, rows, state, descriptor, sale };
}
test("ERP descriptor preserves local/ERP aliases, card USD and placements; atomic restore/retry does not recapture or write effects", async () => {
  const { f, db, rows, state, descriptor } = await prepared();
  try {
    assert.equal(
      (await validateRetainedRestore(ctx, state, rows, descriptor)).length,
      2,
    );
    await assert.rejects(
      restoreRetainedSet(db, ctx, state, descriptor),
      /LOCAL_CONFLICT/,
    );
    const before = await db.getCollection("recoveryOriginals");
    await db.saveCollection("transactions", []);
    await db.saveCollection("transactionHistory", []);
    f.failOnCollection("transactionHistory");
    await assert.rejects(
      restoreRetainedSet(db, ctx, state, descriptor),
      /disk failed/,
    );
    assert.equal((await db.getCollection("transactions")).length, 0);
    f.failOnCollection(null);
    assert.equal(await restoreRetainedSet(db, ctx, state, descriptor), 2);
    assert.equal(await restoreRetainedSet(db, ctx, state, descriptor), 2);
    assert.deepEqual(await db.getCollection("recoveryOriginals"), before);
    for (const c of [
      "internalSequences",
      "documentSeries",
      "productStocks",
      "zReports",
    ])
      assert.deepEqual(await db.getCollection(c), []);
    const restored: any = await db.getDocument("transactions", "sale");
    assert.equal(restored.payments[0].amountOriginal, 25);
    assert.equal(restored._posRecovery.closeAuthorization, "NOT_GRANTED");
  } finally {
    f.close();
  }
});
test("rehashed descriptor cannot omit, duplicate, change a reference, promote scope or authorize close", async () => {
  const { f, rows, state, descriptor } = await prepared();
  try {
    for (const mutate of [
      (d: any) => d.placements.pop(),
      (d: any) => d.placements.push(d.placements[0]),
      (d: any) => (d.placements[0].original.revision = "999"),
      (d: any) => (d.scope.companyId = scope.storeId),
      (d: any) => (d.closeAuthorization = "GRANTED"),
      (d: any) => d.unselectedReferences.push(d.manifestReference),
    ]) {
      const d = structuredClone(descriptor);
      mutate(d);
      delete d.descriptorHash;
      d.descriptorHash = await digest(recoveryCanonicalJson(d));
      await assert.rejects(validateRetainedRestore(ctx, state, rows, d));
    }
    const changed = structuredClone(rows);
    changed[0].record.bodyBase64 = "e30=";
    await assert.rejects(
      validateRetainedRestore(ctx, state, changed, descriptor),
      /STAGE_CHANGED/,
    );
  } finally {
    f.close();
  }
});
