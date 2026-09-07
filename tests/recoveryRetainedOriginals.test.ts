import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/closePreparationSQLite";
import { captureRetainedOriginals } from "../services/recovery/RetainedOriginals";
import { decodeOriginal } from "../services/recovery/OriginalCodec";
const context = { key: "company:terminal", terminalIds: ["T1"] };
test("retained bootstrap deduplicates history, preserves originals and unknown historical configuration across restart", async () => {
  const f = fixture();
  try {
    let { db } = f.open();
    f.enabled(false);
    const sale = {
      id: "old",
      terminalId: "T1",
      total: 118,
      tax: 18,
      payments: [{ method: "CARD", amount: 118 }],
      extension: { alias: null },
    };
    await db.saveDocument("transactions", sale);
    await db.saveDocument("transactionHistory", sale);
    await db.saveDocument("zReports", { id: "previous", terminalId: "T1" });
    f.enabled(true);
    assert.equal(await captureRetainedOriginals(db, context), 2);
    assert.deepEqual(await db.getCollection("transactions"), [sale]);
    const rows = await db.getCollection<any>("recoveryOriginals");
    const record = rows.find((x) => x.originalId === "old");
    const envelope = decodeOriginal(record.body) as any;
    assert.deepEqual(decodeOriginal(envelope.document), sale);
    assert.equal(decodeOriginal(envelope.configuration), null);
    assert.equal(envelope.retainedCapture.coverage, "LEGACY_UNKNOWN");
    assert.equal(record.status, "PENDING");
    ({ db } = f.restart());
    assert.equal(await captureRetainedOriginals(db, context), 0);
    assert.deepEqual(await db.getCollection("recoveryOriginals"), rows);
  } finally {
    f.close();
  }
});
test("retained bootstrap rolls back partial capture and preserves a newer normal capture", async () => {
  const f = fixture();
  try {
    const { db } = f.open();
    f.enabled(false);
    await db.saveDocument("transactions", { id: "old", terminalId: "T1" });
    f.enabled(true);
    await db.saveDocument("transactions", { id: "new", terminalId: "T1" });
    const before = await db.getCollection("recoveryOriginals");
    f.failOnCollection("recoveryOriginals");
    await assert.rejects(captureRetainedOriginals(db, context));
    assert.deepEqual(await db.getCollection("recoveryOriginals"), before);
    f.failOnCollection(null);
    assert.equal(await captureRetainedOriginals(db, context), 1);
    assert.deepEqual(
      (await db.getCollection<any>("recoveryOriginals")).find(
        (r) => r.originalId === "new",
      ),
      before[0],
    );
  } finally {
    f.close();
  }
});
for (const variant of ["conflict", "scope"])
  test(
    "retained bootstrap blocks " + variant + " without partial backup",
    async () => {
      const f = fixture();
      try {
        const { db } = f.open();
        f.enabled(false);
        await db.saveDocument("transactions", {
          id: "old",
          terminalId: "T1",
          total: 10,
        });
        await db.saveDocument("transactionHistory", {
          id: "old",
          terminalId: variant === "scope" ? "OTHER" : "T1",
          total: 20,
        });
        f.enabled(true);
        await assert.rejects(
          captureRetainedOriginals(db, context),
          new RegExp(variant === "scope" ? "SCOPE_MISMATCH" : "CONFLICT"),
        );
        assert.deepEqual(await db.getCollection("recoveryOriginals"), []);
      } finally {
        f.close();
      }
    },
  );
