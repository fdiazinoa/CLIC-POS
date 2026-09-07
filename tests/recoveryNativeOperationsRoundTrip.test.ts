import { originalDigest } from "../services/recovery/OriginalCodec";
import { recoveryCanonicalJson } from "../services/recovery/RecoveryJson";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fixture } from "./helpers/closePreparationSQLite";
import { nativeRecoveryOperations } from "./fixtures/nativeRecoveryOperations";
import { PendingOperationsRecovery } from "../services/recovery/PendingOperationsRecovery";
import { RecoveryCloseController } from "../services/recovery/RecoveryCloseController";
import { ReceivedCloseFlow } from "../services/recovery/ReceivedCloseFlow";
import { buildNativeZReportContent } from "../services/recovery/NativeZReport";
import {
  encodeOriginal,
  decodeOriginal,
} from "../services/recovery/OriginalCodec";
const erp = process.env.CLIC_ERP_REVIEW_PATH,
  postgres = process.env.CLIC_EMBEDDED_POSTGRES_MODULE;
test(
  "native complete operations: HTTP pending selection → restored full documents → explicit Z with durable pending financial work",
  { skip: !erp || !postgres },
  async () => {
    const { default: EmbeddedPostgres } = await import(
      pathToFileURL(postgres!).href
    );
    const { fixtureSchema, recoveryMigrations, postgresRpc } = await import(
      pathToFileURL(
        join(erp!, "server/scripts/helpers/receivedCloseFixtureDatabase.mjs"),
      ).href
    );
    const { createOriginalRecoveryRouter } = await import(
      pathToFileURL(join(erp!, "server/routes/posOriginalRecovery.js")).href
    );
    const { receivedNativeCloseOptions } = await import(
      pathToFileURL(join(erp!, "server/services/posReceivedNativeProducer.js"))
        .href
    );
    const express = createRequire(join(erp!, "package.json"))("express");
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as any).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const directory = await mkdtemp(join(tmpdir(), "pos-native-operations-"));
    const pg = new EmbeddedPostgres({
      databaseDir: join(directory, "db"),
      user: "postgres",
      password: "isolated-only",
      port,
      persistent: false,
      postgresFlags: ["-h", "127.0.0.1"],
      onLog: () => {},
      onError: () => {},
    });
    let admin: any,
      backend: any,
      server: any,
      started = false;
    let source: ReturnType<typeof fixture> | undefined = fixture();
    const target = fixture();
    let targetOpened = false;
    try {
      await pg.initialise();
      await pg.start();
      started = true;
      admin = pg.getPgClient("postgres", "127.0.0.1");
      await admin.connect();
      await admin.query(fixtureSchema);
      for (const name of recoveryMigrations)
        await admin.query(
          await readFile(join(erp!, "supabase/migrations", name), "utf8"),
        );
      backend = pg.getPgClient("postgres", "127.0.0.1");
      await backend.connect();
      await backend.query("set role service_role");
      const scope = {
          tenantId: crypto.randomUUID(),
          companyId: crypto.randomUUID(),
          storeId: crypto.randomUUID(),
          terminalId: crypto.randomUUID(),
        },
        seriesId = crypto.randomUUID();
      await admin.query(
        "insert into public.erp_document_series(id,tenant_id,company_id,prefix,padding,next_number) values($1,$2,$3,'Z-',6,10)",
        [seriesId, scope.tenantId, scope.companyId],
      );
      const app = express();
      app.use(express.json({ limit: "4mb" }));
      app.use(
        "/api/sync/originals",
        createOriginalRecoveryRouter({
          client: postgresRpc(backend),
          ...receivedNativeCloseOptions({
            POS_RECEIVED_NATIVE_CLOSE_ENABLED: "true",
          }),
          authorize: async () => ({ id: scope.terminalId }),
          context: async () => ({
            tenant: { id: scope.tenantId },
            company: { id: scope.companyId },
            store: { id: scope.storeId },
          }),
        }),
      );
      server = await new Promise<any>((r) => {
        const s = app.listen(0, "127.0.0.1", () => r(s));
      });
      const url = `http://127.0.0.1:${server.address().port}/api/sync/originals`;
      async function request(path: string, body?: any) {
        const response = await fetch(url + path, {
          method: body === undefined ? "GET" : "POST",
          headers: { "Content-Type": "application/json" },
          body:
            body === undefined
              ? undefined
              : typeof body === "string"
                ? body
                : JSON.stringify(body),
        });
        const result = (await response.json()) as any;
        if (!response.ok)
          throw Object.assign(Error(result.code), { status: response.status });
        return result;
      }
      const capability = (await request("/capabilities")).receivedClose;
      assert.equal(capability.profile, "erp.received-native-operations.v1");
      assert.equal(capability.enabled, true);
      const transport: any = {
        context: async () => ({
          key: "company:terminal",
          recoveryScope: scope,
          terminalIds: ["T1", scope.terminalId],
          enabled: true,
        }),
        receive: (records: any[]) => request("/batch", { records }),
        snapshot: () => request("/snapshots", {}),
        pending: (id: string) => request(`/snapshots/${id}/pending`),
        page: (id: string, cursor: string) =>
          request(
            `/snapshots/${id}/pages?cursor=${encodeURIComponent(cursor)}`,
          ),
      };
      const native = nativeRecoveryOperations(seriesId),
        original = source.open();
      await original.db.saveDocument("config", native.config);
      for (const c of [
        "transactions",
        "cashMovements",
        "collections",
        "transactionHistory",
        "zReports",
        "wallet_transactions",
      ] as const)
        for (const d of native[c]) await original.db.saveDocument(c, d);
      assert.equal(
        await new PendingOperationsRecovery(
          original.db,
          transport,
        ).sendPending(),
        11,
      );
      await original.db.saveDocument("transactions", {
        ...native.transactions[0],
        id: "NEVER_SENT",
      });
      source.close();
      source = undefined;
      let { db } = target.open();
      targetOpened = true;
      await db.saveDocument("config", native.config);
      await db.saveDocument("internalSequences", {
        id: seriesId,
        documentType: "Z_REPORT",
        prefix: "Z-",
        padding: 6,
        nextNumber: 10,
      });
      const receiver = new PendingOperationsRecovery(db, transport);
      await receiver.download();
      const pending = transport.pending;
      for (const change of [
        (s: any) => {
          s.pending = s.pending.slice(1);
        },
        (s: any) => {
          s.scope.companyId = crypto.randomUUID();
        },
        (s: any) => {
          s.pending.push(s.pending[0]);
        },
        (s: any) => {
          s.closed[0].closeId = "invented-close";
        },
      ]) {
        transport.pending = async (id: string) => {
          const value = structuredClone(await pending(id));
          change(value);
          const { selectionHash, ...body } = value;
          value.selectionHash = await originalDigest(
            new TextEncoder().encode(recoveryCanonicalJson(body)),
          );
          return value;
        };
        await assert.rejects(
          receiver.restore(),
          /RECOVERY_SELECTION_|RECOVERY_MULTIPLE_CLOSES/,
        );
        assert.equal((await db.getCollection("transactions")).length, 0);
      }
      transport.pending = pending;
      await receiver.restore();
      assert.equal(await db.getDocument("transactions", "OLD-CREDIT"), null);
      assert.equal(await db.getDocument("transactions", "NEVER_SENT"), null);
      assert.equal((await db.getCollection("transactions")).length, 3);
      assert.equal((await db.getCollection("zReports")).length, 1); // Context only; importing did not create a new Z.
      const additional = {
        ...native.transactions[2],
        id: "NEW-AFTER-RESTORE",
        displayId: "T-NEW",
      };
      await db.saveDocument("transactions", additional);
      native.declaration.transactionIds.push(additional.id);
      native.declaration.declaredOtherTotal += 106.2;
      native.declaration.expectedOtherTotal += 106.2;
      let posts = 0;
      const closeTransport: any = {
        context: async () => ({
          key: "company:terminal",
          scope,
          enabled: true,
        }),
        observe: (body: any) => request("/close-preparations/observe", body),
        submit: async (body: string) => {
          posts++;
          await request("/close-preparations", body);
          throw Error("ACK_LOST");
        },
        result: async (id: string) => {
          try {
            return await request(`/close-preparations/${id}/result`);
          } catch (e: any) {
            if (e.status === 404) return null;
            throw e;
          }
        },
      };
      let flow = new ReceivedCloseFlow(db, closeTransport),
        controller = new RecoveryCloseController(
          db,
          flow,
          () => ({
            key: "company:terminal",
            terminalIds: ["T1", scope.terminalId],
          }),
          async () => {
            await receiver.sendPending();
            await receiver.download(true);
          },
        );
      // Retained recovery keeps an identical open-history mirror for each active ticket.
      // Closing must update that mirror, not reject it as an unrelated document.
      for (const transaction of await db.getCollection<any>("transactions"))
        await db.saveDocument("transactionHistory", transaction);
      const job = await controller.review({
        terminalId: "T1",
        user: { id: "operator", name: "Operador" },
        notes: "Full recovery",
        declaration: native.declaration,
      });
      assert.equal(
        job.receiptBindings.filter((x: any) => x.group === "members").length,
        8,
      );
      await assert.rejects(controller.confirm(job.preparationId), /ACK_LOST/);
      assert.equal((await db.getCollection("transactions")).length, 4);
      ({ db } = target.restart());
      flow = new ReceivedCloseFlow(db, closeTransport);
      controller = new RecoveryCloseController(db, flow, () => ({
        key: "company:terminal",
        terminalIds: ["T1", scope.terminalId],
      }));
      const ack = await controller.confirm(job.preparationId);
      assert.equal(ack.status, "COMMITTED");
      assert.equal(ack.financialState, "PENDING");
      assert.equal(ack.journal, null);
      assert.equal(ack.journalId, null);
      assert.equal(ack.exactZEligible, false);
      assert.equal(ack.closeAuthorization, "GRANTED_RECEIVED_SCOPE");
      assert.equal((await db.getCollection("transactions")).length, 0);
      assert.equal((await db.getCollection("transactionHistory")).length, 5);
      for (const c of ["cashMovements", "collections"]) {
        const rows = await db.getCollection<any>(c);
        assert.equal(rows.length, 2);
        assert(rows.every((d) => d.zReportId === ack.closeId));
      }
      assert.equal(
        (await db.getDocument<any>("transactionHistory", "OLD-CREDIT"))
          ?.zReportId,
        "Z-OLD",
      );
      assert.equal(
        (await db.getDocument<any>("wallet_transactions", "WALLET-1"))?.amount,
        20,
      );
      assert.equal(
        (await db.getDocument<any>("collections", "COLLECT"))?.allocations[0]
          .transactionId,
        "OLD-CREDIT",
      );
      assert.equal(
        (await db.getDocument<any>("zReports", ack.closeId))?.financialState,
        "PENDING",
      );
      assert.equal(
        (
          await admin.query(
            "select count(*)::int n from public.erp_accounting_journal_entries",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await admin.query(
            "select count(*)::int n from public.erp_sales_documents",
          )
        ).rows[0].n,
        0,
      );
      assert(
        ack.operationStates.some(
          (o: any) =>
            o.reference.originalId === "WALLET-EXTERNAL" &&
            o.businessState !== "APPLIED",
        ),
      );
      assert.equal(posts, 1);
      assert.deepEqual(await controller.confirm(job.preparationId), ack);
      const third = fixture();
      try {
        const clean = third.open();
        const secondRecovery = new PendingOperationsRecovery(
          clean.db,
          transport,
        );
        await secondRecovery.download();
        await secondRecovery.restore();
        for (const c of [
          "transactions",
          "cashMovements",
          "collections",
          "transactionHistory",
        ])
          assert.equal(
            (await clean.db.getCollection(c)).length,
            0,
            "committed members must never reopen: " + c,
          );
        assert.equal(
          (
            await admin.query(
              "select count(*)::int n from public.erp_accounting_journal_entries",
            )
          ).rows[0].n,
          0,
        );
      } finally {
        third.close();
      }
    } finally {
      if (server) await new Promise<void>((r) => server.close(() => r()));
      await backend?.end();
      await admin?.end();
      if (started) await pg.stop();
      await rm(directory, { recursive: true, force: true });
      source?.close();
      if (targetOpened) target.close();
    }
  },
);
