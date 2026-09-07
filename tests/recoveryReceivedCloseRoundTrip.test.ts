import { RecoveryCloseController } from "../services/recovery/RecoveryCloseController";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fixture } from "./helpers/closePreparationSQLite";
import {
  encodeOriginal,
  decodeOriginal,
  originalDigest,
} from "../services/recovery/OriginalCodec";
import {
  PendingOperationsRecovery,
  type RecoveryTransport,
} from "../services/recovery/PendingOperationsRecovery";
import {
  ReceivedCloseFlow,
  type ReceivedCloseTransport,
} from "../services/recovery/ReceivedCloseFlow";
import { buildNativeZReportContent } from "../services/recovery/NativeZReport";
const erp = process.env.CLIC_ERP_REVIEW_PATH;
const postgres = process.env.CLIC_EMBEDDED_POSTGRES_MODULE;
const hash = (s: string) => originalDigest(new TextEncoder().encode(s));

test(
  "SQLite loss → HTTP restore → native Z → ERP commit with lost ACK → atomic local publication",
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
    const { resolveAuthenticatedOperationalTerminal } = await import(
      pathToFileURL(join(erp!, "server/services/terminalOperationalAuth.js"))
        .href
    );
    const { resolveDeviceAuthorizationStatus, createDeviceSupersededError } =
      await import(
        pathToFileURL(
          join(erp!, "server/services/terminalDeviceAuthorization.js"),
        ).href
      );
    const express = createRequire(join(erp!, "package.json"))("express");
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as any).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const directory = await mkdtemp(join(tmpdir(), "pos-received-loop-"));
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
    let started = false,
      admin: any,
      backend: any,
      server: any;
    let source: ReturnType<typeof fixture> | undefined = fixture();
    let target: ReturnType<typeof fixture> | undefined;
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
      const sqlScope = {
        p_tenant_id: crypto.randomUUID(),
        p_company_id: crypto.randomUUID(),
        p_store_id: crypto.randomUUID(),
        p_terminal_id: crypto.randomUUID(),
      };
      const scope = {
        tenantId: sqlScope.p_tenant_id,
        companyId: sqlScope.p_company_id,
        storeId: sqlScope.p_store_id,
        terminalId: sqlScope.p_terminal_id,
      };
      const client = postgresRpc(backend),
        seriesId = crypto.randomUUID();
      await admin.query(
        "insert into public.erp_document_series(id,tenant_id,company_id,prefix,padding,next_number) values($1,$2,$3,'Z-',6,1)",
        [seriesId, scope.tenantId, scope.companyId],
      );
      // Persisted credential fixture + existing auth helpers; provisioning is not remote pairing.
      await admin.query(
        "create table laboratory_terminal(id uuid primary key, document jsonb)",
      );
      await admin.query("insert into laboratory_terminal values($1,$2)", [
        scope.terminalId,
        JSON.stringify({
          id: scope.terminalId,
          authorized_device_id: "old",
          config: { auth: { syncAuthToken: "laboratory-only" } },
        }),
      ]);
      const app = express();
      app.use(express.json({ limit: "4mb" }));
      app.use(
        "/api/sync/originals",
        createOriginalRecoveryRouter({
          receivedCloseProfile: "erp.received-ticket-dop-cash.v1",
          client,
          nativeZProducer: buildNativeZReportContent,
          authorize: async (req: any) => {
            const terminal = await resolveAuthenticatedOperationalTerminal(
              req,
              {
                findTerminalByRef: async (id: string) =>
                  (
                    await admin.query(
                      "select document from laboratory_terminal where id=$1",
                      [id],
                    )
                  ).rows[0]?.document,
              },
            );
            const status = resolveDeviceAuthorizationStatus(
              terminal,
              req.headers["x-device-id"],
            );
            if (!status.ok)
              throw createDeviceSupersededError({
                terminal,
                requestDeviceId: req.headers["x-device-id"],
              });
            return terminal;
          },
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
      const base = `http://127.0.0.1:${server.address().port}/api/sync/originals`;
      async function request(
        device: string,
        path: string,
        body?: any,
        exact = false,
      ) {
        const response = await fetch(base + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "x-device-id": device,
            "x-terminal-id": scope.terminalId,
            "x-sync-token": "laboratory-only",
            "Content-Type": "application/json",
          },
          body:
            body === undefined
              ? undefined
              : exact
                ? body
                : JSON.stringify(body),
        });
        const data = (await response.json()) as any;
        if (!response.ok)
          throw Object.assign(Error(data.code), { status: response.status });
        return data;
      }
      const recoveryTransport = (device: string): RecoveryTransport => ({
        context: async () => ({
          key: "company:terminal",
          terminalIds: ["T1", scope.terminalId],
          enabled: true,
        }),
        receive: (records) => request(device, "/batch", { records }),
        snapshot: () => request(device, "/snapshots", {}),
        page: (id, cursor) =>
          request(
            device,
            `/snapshots/${id}/pages?cursor=${encodeURIComponent(cursor)}`,
          ),
      });
      const config = {
        id: "current",
        currencies: [{ code: "DOP", isBase: true, exchangeRate: 1 }],
        paymentMethods: [
          { id: "cash", name: "Efectivo", type: "CASH", isEnabled: true },
        ],
        terminals: [{ id: "T1", config: {} }],
        taxes: [],
      };
      const docs = [100, 50].map((total, i) => ({
        id: `SALE${i + 1}`,
        terminalId: "T1",
        documentType: "TICKET",
        status: "COMPLETED",
        date: i ? "2026-09-07T00:02:00-04:00" : "2026-09-06T23:59:00-04:00",
        total,
        items: [
          {
            id: `p${i}`,
            cartId: `line${i}`,
            name: "Producto",
            price: total,
            quantity: 1,
            totalAmount: total,
          },
        ],
        payments: [
          {
            method: "CASH",
            methodId: "cash",
            amount: total,
            appliedAmount: total,
          },
        ],
      }));
      const original = source.open();
      await original.db.saveDocument("config", config);
      for (const d of docs) await original.db.saveDocument("transactions", d);
      const sender = new PendingOperationsRecovery(
        original.db,
        recoveryTransport("old"),
      );
      assert.equal(await sender.sendPending(), 2);
      for (const row of await original.db.getCollection<any>(
        "recoveryOriginals",
      )) {
        const reference = await sender.receiveCapturedOriginal(row.id);
        assert(reference);
        const d = docs.find((d) => d.id === reference.originalId)!;
        const eventId = crypto.randomUUID(),
          documentId = crypto.randomUUID(),
          expected = { transaction: d };
        // Seed explicit pre-existing commercial results. Never call sale/inventory appliers.
        await admin.query(
          "insert into public.erp_sales_documents(id,tenant_id,company_id,metadata) values($1,$2,$3,'{\"accounting_deferred\":true}')",
          [documentId, scope.tenantId, scope.companyId],
        );
        await admin.query(
          "insert into public.erp_sync_inbox(event_id,tenant_id,store_id,terminal_id,event_type,payload,status) values($1,$2,$3,$4,'SALE_POSTED',$5,'APPLIED')",
          [
            eventId,
            scope.tenantId,
            scope.storeId,
            scope.terminalId,
            JSON.stringify({
              ...expected,
              company_id: scope.companyId,
              timezone: "America/Santo_Domingo",
              application_result: {
                document_id: documentId,
                document_code: d.id,
                accounting_deferred_to_cash_close: true,
                deferred_accounting_lines: [
                  { accountCode: "100", debit: d.total, credit: 0 },
                  { accountCode: "200", debit: 0, credit: d.total },
                ],
              },
            }),
          ],
        );
        const linked = await client.rpc("erp_pos_original_link_events", {
          ...sqlScope,
          p_links: [
            {
              reference,
              events: [
                { eventId, eventType: "SALE_POSTED", payload: expected },
              ],
            },
          ],
        });
        assert.ifError(linked.error);
      }
      await original.db.saveDocument("transactions", {
        ...docs[0],
        id: "NEVER_SENT",
      });
      source.close();
      source = undefined; // Delete only this test's private source DB; genuine missing original remains missing.
      await assert.rejects(
        request("new", "/snapshots", {}),
        /DEVICE_SUPERSEDED/,
      );
      await admin.query(
        "update laboratory_terminal set document=jsonb_set(document,'{authorized_device_id}','\"new\"') where id=$1",
        [scope.terminalId],
      );
      await assert.rejects(
        request("old", "/snapshots", {}),
        /DEVICE_SUPERSEDED/,
      );
      target = fixture();
      let { db, prepare } = target.open();
      await db.saveDocument("config", config);
      await db.saveDocument("internalSequences", {
        id: seriesId,
        documentType: "Z_REPORT",
        prefix: "Z-",
        padding: 6,
        nextNumber: 1,
      });
      const receiver = new PendingOperationsRecovery(
        db,
        recoveryTransport("new"),
      );
      const snapshot = await receiver.download();
      assert.equal(snapshot.totalRecords, 2);
      assert.equal(await receiver.restore(), 2);
      assert.equal(await db.getDocument("transactions", "NEVER_SENT"), null);
      const restored = await db.getCollection<any>("transactions");
      assert.equal(restored.length, 2);
      for (const d of restored) {
        const { _posRecovery, ...value } = d;
        assert.deepEqual(
          value,
          docs.find((x) => x.id === d.id),
        );
        assert.equal(_posRecovery.businessApplication, "UNKNOWN");
      }
      const input = {
        preparationId: "full-loop",
        scopeKey: "company:terminal",
        terminalId: "T1",
        members: restored.map((d) => ({
          collection: "transactions" as const,
          id: d.id,
          expectedDocument: encodeOriginal(d),
        })),
        declaration: {
          cashCountedByCurrency: { DOP: 150 },
          expectedCashByCurrency: { DOP: 150 },
          cashSalesTotal: 150,
        },
        nativeZ: {
          configurationSha256: await hash(encodeOriginal(config)),
          notes: "Offline laboratory",
          user: { id: "u1", name: "QA" },
        },
      };
      const storage = new Map<string, string>();
      Object.assign(globalThis, {
        localStorage: {
          getItem: (k: string) => storage.get(k) ?? null,
          setItem: (k: string, v: string) => storage.set(k, v),
          removeItem: (k: string) => storage.delete(k),
        },
      });
      const { apiSyncAdapter } =
        await import("../services/sync/ApiSyncAdapter");
      const adapter = apiSyncAdapter as any;
      const operationalTarget = {
        baseUrl: base.replace(/\/originals$/, ""),
        terminalId: scope.terminalId,
        useLocalTarget: false,
        token: "laboratory-only",
      };
      // Credential acquisition is a lab fixture; actual adapter method and ERP authorization execute.
      adapter.authenticateOperationalTarget = async () => operationalTarget;
      adapter.resolveOperationalTarget = () => operationalTarget;
      adapter.buildOperationalHeaders = () => ({
        "Content-Type": "application/json",
        "x-terminal-id": scope.terminalId,
        "x-sync-token": "laboratory-only",
      });
      adapter.getLocalDeviceHeaders = () => ({ "x-device-id": "new" });
      adapter.fetchWithRetry = async (
        url: string,
        options: any,
        retries: number,
      ) => {
        if (url.includes("/close-preparations")) assert.equal(retries, 0);
        return fetch(url, options);
      };
      const capability = (await apiSyncAdapter.recoveryCapabilities())
        .receivedClose;
      assert.equal(capability.enabled, true);
      assert.equal(capability.profile, "erp.received-ticket-dop-cash.v1");
      assert.deepEqual(capability.scope, scope);
      assert.equal(capability.closeAuthorization, "NOT_GRANTED");
      let submits = 0,
        lookups = 0;
      const transport: ReceivedCloseTransport = {
        context: async () => ({
          key: "company:terminal",
          scope,
          enabled: true,
        }),
        observe: (body) =>
          apiSyncAdapter.receivedCloseRequest(
            "/close-preparations/observe",
            JSON.stringify(body),
          ),
        submit: async (body) => {
          submits++;
          await apiSyncAdapter.receivedCloseRequest(
            "/close-preparations",
            body,
          );
          throw Error("ACK_LOST");
        },
        result: async (id) => {
          lookups++;
          try {
            return await apiSyncAdapter.receivedCloseRequest(
              `/close-preparations/${id}/result`,
            );
          } catch (e: any) {
            if (e.status === 404) return null;
            throw e;
          }
        },
      };
      let flow = new ReceivedCloseFlow(db, transport);
      const disabledController = new RecoveryCloseController(
        db,
        new ReceivedCloseFlow(db, {
          ...transport,
          context: async () => ({ key: input.scopeKey, scope, enabled: false }),
        }),
        () => ({ key: input.scopeKey, terminalIds: ["T1"] }),
      );
      await assert.rejects(
        disabledController.review({
          terminalId: "T1",
          user: input.nativeZ.user,
          notes: "",
          declaration: input.declaration,
        }),
        /RECEIVED_CLOSE_DISABLED/,
      );
      assert.deepEqual(await disabledController.list(), []);
      const controller = new RecoveryCloseController(db, flow, () => ({
        key: input.scopeKey,
        terminalIds: ["T1", scope.terminalId],
      }));
      const uiInput = {
        terminalId: input.terminalId,
        user: input.nativeZ.user,
        notes: input.nativeZ.notes,
        declaration: input.declaration,
      };
      await assert.rejects(
        controller.review({
          ...uiInput,
          declaration: { ...input.declaration, transactionIds: [] },
        }),
        /RECOVERY_CLOSE_SELECTION_CHANGED/,
      );
      const job = await controller.review(uiInput);
      input.preparationId = job.preparationId;
      await assert.rejects(
        controller.discardUnsentReview(job.preparationId),
        /RECEIVED_CLOSE_CANNOT_DISCARD_OBSERVED/,
      );
      assert.equal((await controller.list()).length, 1);
      await assert.rejects(
        controller.review(uiInput),
        /RECOVERY_CLOSE_RESUME_REQUIRED/,
      );
      const prepared = await prepare.resume(
          input.scopeKey,
          input.preparationId,
        ),
        frozen = decodeOriginal(prepared.body) as any;
      const observed = job.candidate.observed;
      assert.equal(observed.closeAuthorization, "NOT_GRANTED");
      ({ db, prepare } = target.restart());
      flow = new ReceivedCloseFlow(db, transport);
      await assert.rejects(
        flow.commit(input.scopeKey, input.preparationId),
        /ACK_LOST/,
      );
      assert.equal((await db.getCollection("zReports")).length, 0);
      assert.equal((await db.getCollection("transactions")).length, 2);
      const durableAck = await request(
        "new",
        `/close-preparations/${frozen.commandId}/result`,
      );
      for (const alter of [
        (a: any) => {
          a.status = "RECEIVED";
        },
        (a: any) => {
          a.scope.companyId = crypto.randomUUID();
        },
        (a: any) => {
          a.requestHash = "0".repeat(64);
        },
        (a: any) => {
          a.report.totalSales = 999;
        },
        (a: any) => {
          a.number = "999";
        },
        (a: any) => {
          a.closeId = crypto.randomUUID();
        },
      ]) {
        const invalid = structuredClone(durableAck);
        alter(invalid);
        await assert.rejects(
          new ReceivedCloseFlow(db, {
            ...transport,
            result: async () => invalid,
          }).commit(input.scopeKey, input.preparationId),
          /RECEIVED_CLOSE_ACK_/,
        );
        assert.equal((await db.getCollection("zReports")).length, 0);
      }
      await assert.rejects(
        new ReceivedCloseFlow(db, {
          ...transport,
          context: async () => ({
            key: input.scopeKey,
            enabled: true,
            scope: { ...scope, companyId: crypto.randomUUID() },
          }),
        }).commit(input.scopeKey, input.preparationId),
        /RECEIVED_CLOSE_NOT_OBSERVED/,
      );
      target.failOnCollection("zReports");
      await assert.rejects(
        flow.commit(input.scopeKey, input.preparationId),
        /disk failed/,
      );
      assert.equal((await db.getCollection("zReports")).length, 0);
      assert.equal((await db.getCollection("transactionHistory")).length, 0);
      assert.equal((await db.getCollection("transactions")).length, 2);
      assert.equal(
        (await db.getDocument<any>("internalSequences", seriesId))?.nextNumber,
        1,
      );
      target.failOnCollection(null);
      ({ db, prepare } = target.restart());
      flow = new ReceivedCloseFlow(db, transport);
      const ack = await flow.commit(input.scopeKey, input.preparationId);
      assert.equal(ack.status, "COMMITTED");
      assert.equal(ack.coverage, "RECEIVED_ONLY");
      assert.equal(ack.exactZEligible, false);
      assert.equal(ack.closeAuthorization, "GRANTED_RECEIVED_SCOPE");
      assert.equal(ack.summary.total_sales, 150);
      assert.equal(ack.code, "Z-000001");
      assert.deepEqual(ack.report, {
        ...JSON.parse(JSON.stringify(frozen.nativeReport)),
        sequenceNumber: ack.code,
      });
      assert.equal((await db.getCollection("transactions")).length, 0);
      const history = await db.getCollection<any>("transactionHistory");
      assert.equal(history.length, 2);
      assert(history.every((d) => d.zReportId === ack.closeId));
      assert.equal((await db.getCollection("zReports")).length, 1);
      assert.equal(
        (await db.getDocument<any>("internalSequences", seriesId))?.nextNumber,
        2,
      );
      assert.equal(
        (await db.getDocument<any>("recoveryState", "capture"))?.openSetId,
        ack.nextOpenSetId,
      );
      assert.equal(
        await new PendingOperationsRecovery(
          db,
          recoveryTransport("new"),
        ).sendPending(),
        3, // Closed history + Z backup postimages, never new commercial commands.
      );
      assert.equal(
        await new PendingOperationsRecovery(
          db,
          recoveryTransport("new"),
        ).sendPending(),
        0,
      );
      const postimages = (
        await db.getCollection<any>("recoveryOriginals")
      ).filter(
        (row) =>
          (decodeOriginal(row.body) as any).closeCommitId === ack.commitId,
      );
      assert.equal(postimages.length, 3);
      assert(postimages.every((row) => row.status === "RECEIVED"));
      ({ db, prepare } = target.restart());
      flow = new ReceivedCloseFlow(db, transport);
      assert.deepEqual(
        await flow.commit(input.scopeKey, input.preparationId),
        ack,
      );
      assert.equal(submits, 1);
      assert.equal(lookups, 2);
      assert.equal((await db.getCollection("transactionHistory")).length, 2);
      for (const [table, expected] of [
        ["private.pos_recovered_close_commits", 1],
        ["public.erp_accounting_journal_entries", 1],
        ["public.erp_sales_documents", 2],
        ["public.erp_sync_inbox", 3],
      ] as const)
        assert.equal(
          (await admin.query(`select count(*)::int n from ${table}`)).rows[0].n,
          expected,
        );
      assert.equal(
        (
          await admin.query(
            "select next_number::text n from public.erp_document_series where id=$1",
            [seriesId],
          )
        ).rows[0].n,
        "2",
      );
    } finally {
      if (server) await new Promise<void>((r) => server.close(() => r()));
      await backend?.end();
      await admin?.end();
      if (started) await pg.stop();
      await rm(directory, { recursive: true, force: true });
      source?.close();
      target?.close();
    }
  },
);
