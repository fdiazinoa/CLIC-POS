import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/closePreparationSQLite";
import { nativeRecoveryOperations } from "./fixtures/nativeRecoveryOperations";
import {
  encodeOriginal,
  decodeOriginal,
  decodeBase64,
  encodeBase64,
  originalDigest,
  ORIGINAL_ENCODING,
} from "../services/recovery/OriginalCodec";
import {
  PendingOperationsRecovery,
  recordBytes,
} from "../services/recovery/PendingOperationsRecovery";
import { buildNativeZReportContent } from "../services/recovery/NativeZReport";
import { RecoveryCloseController } from "../services/recovery/RecoveryCloseController";
import { ReceivedCloseFlow } from "../services/recovery/ReceivedCloseFlow";
test("complete native originals survive SQLite loss with payments/tax/discount/refund/cash/allocations and unchanged Z", async () => {
  let source: ReturnType<typeof fixture> | undefined = fixture();
  const replacement = fixture();
  try {
    const native = nativeRecoveryOperations(crypto.randomUUID());
    const { db } = source.open();
    await db.saveDocument("config", native.config);
    for (const collection of [
      "transactions",
      "cashMovements",
      "collections",
      "transactionHistory",
    ] as const)
      for (const doc of native[collection])
        await db.saveDocument(collection, doc);
    const records: any[] = [];
    const hash = (s: string) => originalDigest(new TextEncoder().encode(s));
    const transport: any = {
      context: async () => ({
        key: "company:terminal",
        terminalIds: ["T1"],
        enabled: true,
      }),
      receive: async (batch: any[]) => {
        for (const record of batch)
          records.push({
            receiptId: crypto.randomUUID(),
            recordHash: await originalDigest(recordBytes(record)),
            receivedAt: new Date().toISOString(),
            record,
          });
        return {
          receipts: records.map((r) => ({
            ...r.record,
            receiptId: r.receiptId,
            receiptStatus: "RECEIVED",
          })),
        };
      },
    };
    const sender = new PendingOperationsRecovery(db, transport);
    assert.equal(await sender.sendPending(), 8);
    for (const receipt of records) {
      const envelope = decodeOriginal(
        new TextDecoder().decode(decodeBase64(receipt.record.bodyBase64)),
      ) as any;
      const original = decodeOriginal(envelope.original) as any;
      const historyConfig = decodeOriginal(envelope.configuration) as any;
      assert.equal(historyConfig.taxRate, 18);
      assert.deepEqual(historyConfig.terminals[0].config.operational, {
        defaultTaxIds: ["itbis"],
      });
      if (original.id === "SALE-MIXED") {
        assert(Object.hasOwn(original.extension, "missing"));
        assert.equal(original.payments[0].currencyCode, "USD");
      }
    }
    source.close();
    source = undefined;
    const fresh = replacement.open();
    await fresh.db.saveDocument("config", native.config);
    await fresh.db.saveDocument("internalSequences", {
      id: native.config.terminals[0].config.documentAssignments.Z_REPORT,
      documentType: "Z_REPORT",
      prefix: "Z-",
      padding: 6,
      nextNumber: 1,
    });
    const snapshot = {
      snapshotId: crypto.randomUUID(),
      totalRecords: records.length,
      snapshotDigest: await hash(
        records.map((r) => `${r.receiptId}:${r.recordHash}\n`).join(""),
      ),
      expiresAt: "2099-01-01T00:00:00.000Z",
      nextCursor: "first",
      completeness: "RECEIVED_ORIGINALS_ONLY",
      exactZEligible: false,
      closeAuthorization: "NOT_GRANTED",
    };
    transport.snapshot = async () => snapshot;
    transport.page = async () => ({
      ...snapshot,
      nextCursor: null,
      pageStart: 0,
      records,
    });
    const receiver = new PendingOperationsRecovery(fresh.db, transport);
    await receiver.download();
    assert.equal(await receiver.restore(), 8);
    const selected: any = {};
    for (const collection of [
      "transactions",
      "cashMovements",
      "collections",
      "transactionHistory",
    ] as const) {
      selected[collection] = await fresh.db.getCollection<any>(collection);
      assert.equal(selected[collection].length, native[collection].length);
      for (const doc of selected[collection]) {
        const { _posRecovery, ...runtime } = doc;
        assert.deepEqual(
          runtime,
          JSON.parse(
            JSON.stringify(native[collection].find((x) => x.id === doc.id)),
          ),
        );
      }
    }
    const common: any = {
      config: native.config,
      terminalId: "T1",
      currentTerminal: native.config.terminals[0],
      currentUser: { id: "operator", name: "Operador" },
      notes: "Original íntegro",
      reportData: native.declaration,
      fallbackOpenedAt: "2026-09-07T01:00:00Z",
    };
    const before = buildNativeZReportContent({
      ...common,
      terminalTransactions: native.transactions,
      terminalCashMovements: native.cashMovements,
      terminalCollections: native.collections,
    });
    const after = buildNativeZReportContent({
      ...common,
      terminalTransactions: selected.transactions,
      terminalCashMovements: selected.cashMovements,
      terminalCollections: selected.collections,
    });
    assert.equal(encodeOriginal(after), encodeOriginal(before));
    // Preparation covers every member and references the closed invoice without re-opening it.
    let observed: any;
    const flow = new ReceivedCloseFlow(fresh.db, {
      context: async () => ({
        key: "company:terminal",
        scope: {
          tenantId: crypto.randomUUID(),
          companyId: crypto.randomUUID(),
          storeId: crypto.randomUUID(),
          terminalId: crypto.randomUUID(),
        },
        enabled: true,
      }),
      observe: async (body: any) => {
        observed = body;
        throw Error("CAPTURE_ONLY");
      },
      submit: async () => {
        throw Error("UNEXPECTED_SUBMIT");
      },
      result: async () => null,
    });
    const controller = new RecoveryCloseController(fresh.db, flow, () => ({
      key: "company:terminal",
      terminalIds: ["T1"],
    }));
    await assert.rejects(
      controller.review({
        terminalId: "T1",
        user: common.currentUser,
        notes: common.notes,
        declaration: native.declaration,
      }),
      /CAPTURE_ONLY/,
    );
    const prepared = decodeOriginal(observed.preparation.body) as any;
    assert.equal(prepared.members.length, 7);
    assert.equal(prepared.dependencies.length, 1);
    assert.equal(prepared.dependencies[0].id, "OLD-CREDIT");
    assert.equal(
      prepared.nativeReport.stats.returnsCount,
      after.stats.returnsCount,
    );
    assert.equal(
      observed.receiptBindings.filter((b: any) => b.group === "dependencies")
        .length,
      1,
    );
    assert.equal(
      (await fresh.db.getDocument<any>("transactionHistory", "OLD-CREDIT"))
        ?.zReportId,
      "Z-OLD",
    );
    assert.equal((await fresh.db.getCollection("zReports")).length, 0);
  } finally {
    source?.close();
    replacement.close();
  }
});
