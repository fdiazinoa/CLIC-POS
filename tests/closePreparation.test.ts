import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/closePreparationSQLite";
import { type ClosePreparationInput } from "../services/recovery/ClosePreparation";
import {
  encodeOriginal,
  decodeOriginal,
} from "../services/recovery/OriginalCodec";

async function seed(db: ReturnType<ReturnType<typeof fixture>["open"]>["db"]) {
  const a = {
    id: "A",
    terminalId: "T1",
    date: "2026-09-06T23:59:00-04:00",
    total: 100,
  };
  const b = {
    id: "B",
    terminalId: "T1",
    date: "2026-09-07T00:05:00-04:00",
    total: 50,
  };
  await db.saveDocument("transactions", a);
  await db.saveDocument("transactions", b);
  await db.saveDocument("internalSequences", { id: "Z", nextNumber: 10 });
  const input: ClosePreparationInput = {
    preparationId: "attempt-1",
    scopeKey: "company:terminal",
    terminalId: "T1",
    members: [b, a].map((document) => ({
      collection: "transactions",
      id: document.id,
      expectedDocument: encodeOriginal(document),
    })),
    declaration: {
      cashCountedByCurrency: { DOP: 150 },
      notes: "confirmed",
      absent: undefined,
      at: new Date("2026-09-07T05:00:00Z"),
    },
  };
  return { input, a, b };
}

test("SQLite file restart and duplicate preparation retain exact bytes/IDs, order and declaration without operational effects", async () => {
  const f = fixture();
  try {
    let { db, prepare } = f.open();
    const { input } = await seed(db);
    const first = await prepare.prepare(input);
    const body = decodeOriginal(first.body) as any;
    assert.deepEqual(
      body.members.map((m: any) => m.id),
      ["B", "A"],
    );
    assert.equal(new Set(Object.values(body.closeControl)).size, 3);
    assert.equal(body.closeAuthorization, "NOT_GRANTED");
    assert.equal(body.seal, null);
    const request = decodeOriginal(body.requestBody) as any;
    assert(request.declaration.at instanceof Date);
    assert("absent" in request.declaration);
    assert.deepEqual(await prepare.prepare(input), first);
    ({ db, prepare } = f.restart());
    assert.deepEqual(await prepare.listPreparedIds(input.scopeKey), [
      input.preparationId,
    ]);
    assert.deepEqual(
      await prepare.resume(input.scopeKey, input.preparationId),
      first,
    );
    assert.deepEqual(await prepare.prepare(input), first);
    assert.equal(
      (await db.getDocument<any>("internalSequences", "Z"))?.nextNumber,
      10,
    );
    assert.deepEqual(await db.getCollection("zReports"), []);
    assert.deepEqual(await db.getCollection("transactionHistory"), []);
    assert.equal((await db.getCollection("transactions")).length, 2);
    assert.equal((await db.getCollection("recoveryOriginals")).length, 2);
  } finally {
    f.close();
  }
});

test("same key with changed declaration conflicts, failed write leaves no draft and concurrent identical requests converge", async () => {
  const f = fixture();
  try {
    const { db, prepare } = f.open();
    const { input } = await seed(db);
    f.fail(true);
    await assert.rejects(prepare.prepare(input), /disk failed/);
    f.fail(false);
    await assert.rejects(
      prepare.resume(input.scopeKey, input.preparationId),
      /NOT_FOUND/,
    );
    const [a, b] = await Promise.all([
      prepare.prepare(input),
      prepare.prepare(input),
    ]);
    assert.deepEqual(a, b);
    await assert.rejects(
      prepare.prepare({ ...input, declaration: { cash: 999 } }),
      /REQUEST_CONFLICT/,
    );
    assert.deepEqual(
      await prepare.resume(input.scopeKey, input.preparationId),
      a,
    );
  } finally {
    f.close();
  }
});

test("changes in selected docs, new operations, config, series, history, and wallet stale the whole preparation", async () => {
  for (const collection of [
    "transactions",
    "cashMovements",
    "collections",
    "config",
    "internalSequences",
    "transactionHistory",
    "wallet_transactions",
    "zReports",
  ]) {
    const f = fixture();
    try {
      const { db, prepare } = f.open();
      const { input } = await seed(db);
      const saved = await prepare.prepare(input);
      await db.saveDocument(collection, {
        id: "NEW",
        terminalId: "T1",
        amount: 1,
      });
      await assert.rejects(
        prepare.resume(input.scopeKey, input.preparationId),
        /STALE/,
      );
      assert.deepEqual(await db.getDocument("recoveryState", saved.id), saved);
    } finally {
      f.close();
    }
  }
});

test("stale UI selection, duplicates, closed members, terminal mismatch and uncaptured rows fail closed", async () => {
  const f = fixture();
  try {
    const { db, prepare } = f.open();
    const { input, a } = await seed(db);
    await assert.rejects(
      prepare.prepare({
        ...input,
        members: [...input.members, input.members[0]],
      }),
      /DUPLICATE/,
    );
    await assert.rejects(
      prepare.prepare({ ...input, terminalId: "T2" }),
      /TERMINAL_MISMATCH/,
    );
    await db.saveDocument("transactions", { ...a, total: 999 });
    await assert.rejects(prepare.prepare(input), /STALE_SELECTION/);
    const closed = { ...a, zReportId: "OLD" };
    await db.saveDocument("transactions", closed);
    await assert.rejects(
      prepare.prepare({
        ...input,
        members: [
          {
            collection: "transactions",
            id: "A",
            expectedDocument: encodeOriginal(closed),
          },
        ],
      }),
      /ALREADY_CLOSED/,
    );
    f.enabled(false);
    await db.saveDocument("transactions", a);
    f.enabled(true);
    await assert.rejects(
      prepare.prepare({
        ...input,
        members: [
          {
            collection: "transactions",
            id: "A",
            expectedDocument: encodeOriginal(a),
          },
        ],
      }),
      /ORIGINAL_MISMATCH/,
    );
  } finally {
    f.close();
  }
});

test("queued preparation freezes caller input and observes earlier writes; scope and feature switches prevent resume", async () => {
  const f = fixture();
  try {
    const { db, prepare } = f.open();
    const { input, a } = await seed(db);
    const pending = prepare.prepare(input);
    input.declaration = { cash: 999 };
    const saved = await pending;
    assert.notDeepEqual(
      (decodeOriginal(saved.requestBody) as any).declaration,
      input.declaration,
    );
    f.scope("other");
    await assert.rejects(
      prepare.resume("company:terminal", "attempt-1"),
      /SCOPE_CHANGED/,
    );
    f.scope("company:terminal");
    f.enabled(false);
    await assert.rejects(
      prepare.resume("company:terminal", "attempt-1"),
      /DISABLED/,
    );
    f.enabled(true);
    await db.saveDocument("recoveryState", {
      ...saved,
      body: saved.body + " ",
    });
    await assert.rejects(
      prepare.resume("company:terminal", "attempt-1"),
      /CORRUPT/,
    );
    const write = db.saveDocument("transactions", { ...a, total: 42 });
    const attempt = prepare.prepare({ ...input, preparationId: "attempt-2" });
    await write;
    await assert.rejects(attempt, /STALE_SELECTION/);
  } finally {
    f.close();
  }
});

test("recovered source retains original revision and receipt; altered stage blocks resume", async () => {
  const { captureDocument } =
    await import("../services/recovery/OriginalCapture");
  const { encodeBase64, originalDigest, ORIGINAL_ENCODING } =
    await import("../services/recovery/OriginalCodec");
  const { recordBytes } =
    await import("../services/recovery/PendingOperationsRecovery");
  const f = fixture();
  try {
    const { db, prepare } = f.open();
    const document = {
      id: "REC",
      terminalId: "T1",
      date: "2026-09-07",
      total: 75,
    };
    const captured = captureDocument("transactions", document, {
      key: "company:terminal",
      terminalId: "T1",
    })!;
    const bytes = new TextEncoder().encode(captured.body);
    const record = {
      version: 1 as const,
      storageEpoch: crypto.randomUUID(),
      openSetId: crypto.randomUUID(),
      sequence: "9",
      revision: "9",
      kind: "TRANSACTION",
      originalId: "REC",
      encoding: ORIGINAL_ENCODING,
      bodyBase64: encodeBase64(bytes),
      bodySha256: await originalDigest(bytes),
      byteLength: bytes.length,
    };
    const receipt = {
      id: "snapshot:1",
      snapshotId: "snapshot",
      receiptId: "1",
      recordHash: await originalDigest(recordBytes(record)),
      receivedAt: "2026-09-07T05:00:00Z",
      record,
    };
    const restored = {
      ...document,
      _posRecovery: {
        snapshotId: "snapshot",
        receiptId: "1",
        bodySha256: record.bodySha256,
        businessApplication: "UNKNOWN",
        exactZEligible: false,
        closeAuthorization: "NOT_GRANTED",
      },
    };
    await db.saveDocument("recoveryStage", receipt);
    await db.saveDocument("transactions", restored);
    const input: ClosePreparationInput = {
      preparationId: "restored",
      scopeKey: "company:terminal",
      terminalId: "T1",
      members: [
        {
          collection: "transactions",
          id: "REC",
          expectedDocument: encodeOriginal(restored),
        },
      ],
      declaration: { cash: 75 },
    };
    const saved = await prepare.prepare(input);
    const body = decodeOriginal(saved.body) as any;
    assert.equal(body.members[0].source.receipt.record.revision, "9");
    assert.equal(
      body.members[0].source.receipt.record.bodyBase64,
      record.bodyBase64,
    );
    assert.deepEqual(
      await prepare.resume(input.scopeKey, input.preparationId),
      saved,
    );
    await db.saveDocument("recoveryStage", {
      ...receipt,
      record: { ...record, revision: "10" },
    });
    await assert.rejects(
      prepare.resume(input.scopeKey, input.preparationId),
      /ORIGINAL_MISMATCH/,
    );
    assert.deepEqual(await db.getCollection("zReports"), []);
  } finally {
    f.close();
  }
});

test("native report is frozen with preparation IDs and complete annexes, without assigning a number", async () => {
  const { readFileSync } = await import("node:fs");
  const { originalDigest } = await import("../services/recovery/OriginalCodec");
  const corpus = JSON.parse(
    readFileSync(
      new URL("./fixtures/nativeZReport-parent.json", import.meta.url),
      "utf8",
    ),
  );
  const native = decodeOriginal(corpus.fixtures[1].input) as any;
  const f = fixture();
  try {
    let { db, prepare } = f.open();
    await db.saveDocument("config", native.config);
    const members: ClosePreparationInput["members"] = [];
    for (const [collection, documents] of [
      ["transactions", native.terminalTransactions],
      ["cashMovements", native.terminalCashMovements],
      ["collections", native.terminalCollections],
    ] as const) {
      for (const doc of documents) {
        await db.saveDocument(collection, doc);
        members.push({
          collection,
          id: doc.id,
          expectedDocument: encodeOriginal(
            await db.getDocument(collection, doc.id),
          ),
        });
      }
    }
    const input: ClosePreparationInput = {
      preparationId: "native",
      scopeKey: "company:terminal",
      terminalId: "T1",
      members,
      declaration: native.reportData,
      nativeZ: {
        configurationSha256: await originalDigest(
          new TextEncoder().encode(encodeOriginal(native.config)),
        ),
        user: native.currentUser,
        notes: native.notes,
      },
    };
    await assert.rejects(
      prepare.prepare({
        ...input,
        nativeZ: { ...input.nativeZ!, configurationSha256: "wrong" },
      }),
      /CONFIGURATION_CHANGED/,
    );
    const prepared = await prepare.prepare(input);
    const body = decodeOriginal(prepared.body) as any;
    const { id, closedAt, recoveryMemberIds, ...content } = body.nativeReport;
    assert.equal(
      body.nativeConfiguration.profile,
      "pos.native-z.configuration.v1",
    );
    assert.equal(
      body.nativeConfiguration.sourceConfigurationSha256,
      input.nativeZ!.configurationSha256,
    );
    assert.equal(
      await originalDigest(
        new TextEncoder().encode(body.nativeConfiguration.body),
      ),
      body.nativeConfiguration.bodySha256,
    );
    assert.equal(encodeOriginal(content), corpus.fixtures[1].expected);
    assert.equal(id, body.closeControl.closeId);
    assert.equal(closedAt, body.preparedAt);
    assert.deepEqual(recoveryMemberIds, {
      transactions: ["A", "R"],
      cashMovements: ["M2", "M1"],
      collections: ["C"],
    });
    for (const field of [
      "seriesId",
      "seriesNumber",
      "sequenceNumber",
      "syncStatus",
    ])
      assert.equal(field in body.nativeReport, false);
    ({ db, prepare } = f.restart());
    assert.deepEqual(
      await prepare.resume(input.scopeKey, input.preparationId),
      prepared,
    );
    assert.deepEqual(await db.getCollection("zReports"), []);
    assert.deepEqual(await db.getCollection("internalSequences"), []);
    await db.saveDocument("config", {
      ...native.config,
      backgroundCatalogRefresh: { completedAt: "2026-09-08T00:00:00Z" },
    });
    assert.deepEqual(
      await prepare.resume(input.scopeKey, input.preparationId),
      prepared,
    );
    await db.saveDocument("config", { ...native.config, paymentMethods: [] });
    await assert.rejects(
      prepare.resume(input.scopeKey, input.preparationId),
      /STALE/,
    );
    const saved = await db.getDocument<any>("recoveryState", prepared.id);
    assert.equal(
      (decodeOriginal(saved.body) as any).nativeConfiguration.body,
      body.nativeConfiguration.body,
    );
  } finally {
    f.close();
  }
});

test("retained v2 preparation binds the manifest and current configuration basis without translating v1", async () => {
  const f = fixture();
  try {
    let { db, prepare } = f.open();
    const { input } = await seed(db);
    const legacy = await prepare.prepare(input);
    assert.equal(
      (decodeOriginal(legacy.body) as any).receivedContext.version,
      1,
    );
    const retainedSet = {
      manifestReference: { receiptId: "25", storageEpoch: "epoch" },
      descriptorHash: "a".repeat(64),
      configurationBasis: "CURRENT_AT_PREPARATION" as const,
    };
    const v2Input = { ...input, preparationId: "retained-v2", retainedSet };
    const prepared = await prepare.prepare(v2Input);
    const body = decodeOriginal(prepared.body) as any;
    assert.equal(body.receivedContext.version, 2);
    assert.deepEqual(body.receivedContext.retainedSet, retainedSet);
    ({ db, prepare } = f.restart());
    assert.deepEqual(await prepare.prepare(v2Input), prepared);
    await assert.rejects(
      prepare.prepare({
        ...v2Input,
        retainedSet: { ...retainedSet, descriptorHash: "b".repeat(64) },
      }),
      /REQUEST_CONFLICT/,
    );
    assert.equal((await db.getCollection("zReports")).length, 0);
  } finally {
    f.close();
  }
});
