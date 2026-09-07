import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { CapacitorSQLiteAdapter } from "../services/db/adapters/CapacitorSQLiteAdapter";
import { recoveryDatabase } from "../services/recovery/RecoveryDatabase";
import {
  PendingOperationsRecovery,
  type RecoveryTransport,
} from "../services/recovery/PendingOperationsRecovery";
import {
  RECOVERY_OUTBOX,
  RECOVERY_STATE,
  withOriginal,
} from "../services/recovery/OriginalCapture";
import { buildZReportPaymentMethodSummary } from "../utils/zReportPaymentSummary";
import { calculateZReportStats } from "../utils/analytics";
import {
  ALL_CLOSE_REPORT_SECTIONS,
  buildCloseReportDetails,
} from "../utils/closeReportOptions";

// Opt-in: creates its own cluster, never consumes DATABASE_URL or a customer DB.
const erpPath = process.env.CLIC_ERP_REVIEW_PATH;
const pgModule = process.env.CLIC_EMBEDDED_POSTGRES_MODULE;
const scope = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];

function sqlite(path: string) {
  const sql = new DatabaseSync(path);
  sql.exec(
    "CREATE TABLE IF NOT EXISTS documents(collection_name TEXT NOT NULL,doc_id TEXT NOT NULL,data TEXT NOT NULL,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id))",
  );
  const db = new CapacitorSQLiteAdapter();
  Object.assign(db, {
    isReady: true,
    db: {
      query: async (query: string, values: any[] = []) => ({
        values: sql.prepare(query).all(...values),
      }),
      executeSet: async (rows: any[]) => {
        sql.exec("BEGIN");
        try {
          for (const row of rows) sql.prepare(row.statement).run(...row.values);
          sql.exec("COMMIT");
        } catch (error) {
          sql.exec("ROLLBACK");
          throw error;
        }
      },
    },
  });
  return { db, close: () => sql.close() };
}

test(
  "durable SQLite → HTTP ERP → PostgreSQL → replacement SQLite, without commercial replay",
  { skip: !erpPath || !pgModule, timeout: 60000 },
  async (t) => {
    const { default: EmbeddedPostgres } = await import(
      pathToFileURL(pgModule!).href
    );
    const { createOriginalRecoveryRouter } = await import(
      pathToFileURL(join(erpPath!, "server/routes/posOriginalRecovery.js")).href
    );
    const directory = await mkdtemp(join(tmpdir(), "pos-recovery-roundtrip-"));
    const probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = (probe.address() as any).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const pg = new EmbeddedPostgres({
      databaseDir: join(directory, "postgres"),
      port,
      user: "postgres",
      password: "local-synthetic-only",
      persistent: true,
      postgresFlags: ["-h", "127.0.0.1"],
      onLog: () => {},
      onError: () => {},
    });
    let started = false,
      rpcConnection: any,
      admin: any,
      server: any;
    const openSqlite = new Set<ReturnType<typeof sqlite>>();
    const open = (name: string) => {
      const x = sqlite(join(directory, name));
      openSqlite.add(x);
      return x;
    };
    const close = (x: ReturnType<typeof sqlite>) => {
      x.close();
      openSqlite.delete(x);
    };
    let device = "original-device",
      acceptedDevice = device,
      token = "synthetic-token",
      authScope = [...scope];
    let discardAck = true,
      disconnectPage = true,
      pageRequests = 0;
    try {
      await pg.initialise();
      await pg.start();
      started = true;
      const connect = async () => {
        admin = pg.getPgClient("postgres", "127.0.0.1");
        await admin.connect();
        rpcConnection = pg.getPgClient("postgres", "127.0.0.1");
        await rpcConnection.connect();
        await rpcConnection.query("SET ROLE service_role");
      };
      admin = pg.getPgClient("postgres", "127.0.0.1");
      await admin.connect();
      await admin.query(
        "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;",
      );
      await admin.query(
        await readFile(
          join(
            erpPath!,
            "supabase/migrations/20260907130141_pos_original_recovery.sql",
          ),
          "utf8",
        ),
      );
      await admin.end();
      await connect();
      const version = (await admin.query("SHOW server_version")).rows[0]
        .server_version;
      const rpc = async (name: string, args: Record<string, unknown> = {}) => {
        // Actual RPC functions/permissions; explicit allowlist, no arbitrary SQL names.
        const keys: Record<string, string[]> = {
          erp_pos_original_capabilities: [],
          erp_pos_original_receive: [
            "p_tenant_id",
            "p_company_id",
            "p_store_id",
            "p_terminal_id",
            "p_records",
          ],
          erp_pos_original_snapshot: [
            "p_tenant_id",
            "p_company_id",
            "p_store_id",
            "p_terminal_id",
          ],
          erp_pos_original_page: [
            "p_tenant_id",
            "p_company_id",
            "p_store_id",
            "p_terminal_id",
            "p_snapshot_id",
            "p_cursor",
          ],
        };
        assert(Object.hasOwn(keys, name));
        try {
          const result = await rpcConnection.query(
            `SELECT public.${name}(${keys[name].map((_, i) => "$" + (i + 1)).join(",")}) result`,
            keys[name].map((k) =>
              k === "p_records" ? JSON.stringify(args[k]) : args[k],
            ),
          );
          return { data: result.rows[0].result };
        } catch (error) {
          return { error };
        }
      };
      const app = express();
      app.use(express.json({ limit: "3mb" }));
      // Synthetic authorization boundary: this test does not claim real pairing or device UI.
      app.use(
        "/api/sync/originals",
        createOriginalRecoveryRouter({
          client: { rpc },
          authorize: async (req: any) => {
            if (req.headers["x-sync-token"] !== "synthetic-token")
              throw Object.assign(Error("Unauthorized"), { status: 401 });
            if (req.headers["x-device-id"] !== acceptedDevice)
              throw Object.assign(Error("DEVICE_SUPERSEDED"), { status: 403 });
            return { id: authScope[3] };
          },
          context: async () => ({
            tenant: { id: authScope[0] },
            company: { id: authScope[1] },
            store: { id: authScope[2] },
          }),
        }),
      );
      server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = `http://127.0.0.1:${server.address().port}/api/sync/originals`;
      const request = async (path: string, body?: unknown) => {
        const response = await fetch(base + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "content-type": "application/json",
            "x-sync-token": token,
            "x-device-id": device,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const value = await response.json();
        if (!response.ok) throw Error(`${response.status}:${value.code}`);
        return value;
      };
      const transport: RecoveryTransport = {
        context: async () => ({
          key: "scope",
          terminalIds: [scope[3]],
          enabled: (await request("/capabilities")).enabled,
        }),
        receive: async (records) => {
          const receipt = await request("/batch", { records });
          if (discardAck) {
            discardAck = false;
            throw Error("ACK_LOST_AFTER_COMMIT");
          }
          return receipt;
        },
        snapshot: () => request("/snapshots", {}),
        page: async (id, cursor) => {
          pageRequests++;
          const page = await request(
            `/snapshots/${id}/pages?cursor=${encodeURIComponent(cursor)}`,
          );
          if (disconnectPage && page.pageStart > 0) {
            disconnectPage = false;
            throw Error("DOWNLOAD_INTERRUPTED");
          }
          return page;
        },
      };
      const source = open("source.sqlite");
      const db = recoveryDatabase(
        source.db,
        () => true,
        () => ({ key: "scope", terminalId: scope[3] }),
      );
      const config: any = {
        id: "current",
        currencies: [{ code: "DOP", isBase: true, symbol: "RD$", rate: 1 }],
        taxes: [],
        paymentMethods: [
          { id: "CASH", name: "Cash", type: "CASH", isEnabled: true },
        ],
        terminals: [{ id: scope[3], config: {} }],
      };
      await db.saveDocument("config", config);
      const sale = (id: string, date: string, amount: number): any => ({
        id,
        displayId: id,
        terminalId: scope[3],
        date,
        status: "COMPLETED",
        documentType: "TICKET",
        userId: "U",
        userName: "Offline",
        serviceType: "TAKEOUT",
        total: amount,
        netAmount: amount,
        taxAmount: 0,
        discountAmount: 0,
        items: [
          {
            id: "PRODUCT",
            cartId: id + "-L",
            name: "Product",
            price: amount,
            quantity: 1,
            taxable: false,
            appliedTaxIds: [],
          },
        ],
        payments: [
          {
            id: id + "-PAY",
            method: "CASH",
            amount,
            appliedAmount: amount,
            currencyCode: "DOP",
            exchangeRate: 1,
            changeAmount: 0,
            timestamp: new Date(date),
          },
        ],
        syncStatus: "PENDING",
      });
      const a = sale("A", "2026-09-06T23:59:00-04:00", 40),
        b = sale("B", "2026-09-07T00:01:00-04:00", 60);
      await db.saveDocument(
        "transactions",
        withOriginal(a, { ...a, discardedAlias: undefined }),
      );
      await db.saveDocument("transactions", b);
      await db.saveDocument("cashMovements", {
        id: "M2",
        terminalId: scope[3],
        type: "OUT",
        amount: 5,
        currencyCode: "DOP",
        timestamp: "2026-09-07T00:02:00-04:00",
        reason: "out",
      });
      await db.saveDocument("cashMovements", {
        id: "M1",
        terminalId: scope[3],
        type: "IN",
        amount: 20,
        currencyCode: "DOP",
        timestamp: "2026-09-06T23:58:00-04:00",
        reason: "fund",
      });
      await db.saveDocument("collections", {
        id: "C",
        terminalId: scope[3],
        totalAmount: 10,
        receivedAmountOriginal: 10,
        receivedAmountBase: 10,
        appliedAmountBase: 10,
        exchangeRate: 1,
        bookingActivityId: "BOOKING",
        allocations: [{ transactionId: "CLOSED", amount: 10 }],
      });
      await db.saveDocument("transactionHistory", {
        ...sale("CLOSED", "2026-09-05T10:00:00-04:00", 25),
        zReportId: "Z-OLD",
      });
      await db.saveDocument("zReports", {
        id: "Z-OLD",
        terminalId: scope[3],
        recoveryMemberIds: {
          transactions: ["CLOSED"],
          cashMovements: [],
          collections: [],
        },
      });
      await db.saveDocument("wallet_transactions", {
        id: "W",
        terminalId: scope[3],
        amount: 4,
        type: "CREDIT",
      });
      // Enough revisions to force a second page. Only latest runtime revision is restored.
      for (let i = 0; i < 96; i++)
        await db.saveDocument("transactions", { ...b, nativeRevision: i });
      const originals = (await source.db.getCollection<any>(RECOVERY_OUTBOX))
        .length;
      const sender = new PendingOperationsRecovery(source.db, transport);
      await assert.rejects(sender.sendPending(), /ACK_LOST/);
      assert.equal(
        (await source.db.getCollection<any>(RECOVERY_OUTBOX)).filter(
          (x) => x.status === "RECEIVED",
        ).length,
        0,
      );
      const receivedAfterLostAck = Number(
        (
          await admin.query(
            "SELECT count(*) n FROM private.pos_original_records",
          )
        ).rows[0].n,
      );
      assert.equal(receivedAfterLostAck, 100);
      assert.equal(await sender.sendPending(), 100);
      assert.equal(
        Number(
          (
            await admin.query(
              "SELECT count(*) n FROM private.pos_original_records",
            )
          ).rows[0].n,
        ),
        100,
      );
      while (await sender.sendPending()) {}
      assert.equal(
        Number(
          (
            await admin.query(
              "SELECT count(*) n FROM private.pos_original_records",
            )
          ).rows[0].n,
        ),
        originals,
      );
      assert.equal(
        (await source.db.getDocument<any>("transactions", "A"))!.syncStatus,
        "PENDING",
      );
      await db.saveDocument(
        "transactions",
        sale("NEVER-SENT", "2026-09-07T00:05:00-04:00", 9),
      );
      const referenceTx = (
        await source.db.getCollection<any>("transactions")
      ).filter((x) => x.id !== "NEVER-SENT");
      const referenceCollections =
        await source.db.getCollection<any>("collections");
      const referenceCash = await source.db.getCollection<any>("cashMovements");
      // Actual process shutdown/start: records must survive outside JS memory.
      await rpcConnection.end();
      await admin.end();
      await pg.stop();
      started = false;
      await pg.start();
      started = true;
      await connect();
      acceptedDevice = "replacement-device"; // Simulates authorization result of the existing takeover layer.
      await assert.rejects(request("/capabilities"), /403/);
      device = acceptedDevice;
      let replacement = open("replacement.sqlite");
      let recovery = new PendingOperationsRecovery(replacement.db, transport);
      await assert.rejects(recovery.download(), /DOWNLOAD_INTERRUPTED/);
      const progress = await replacement.db.getDocument<any>(
        RECOVERY_STATE,
        "download",
      );
      assert.equal(progress.loaded, 100);
      assert.equal(
        (await replacement.db.getCollection("transactions")).length,
        0,
      );
      close(replacement);
      replacement = open("replacement.sqlite");
      recovery = new PendingOperationsRecovery(replacement.db, transport);
      await recovery.download();
      assert.equal(await recovery.restore(), 8);
      assert.equal(await recovery.restore(), 8);
      const tx = await replacement.db.getCollection<any>("transactions");
      assert.deepEqual(
        tx,
        referenceTx.map((x) => ({
          ...x,
          _posRecovery: tx.find((y) => y.id === x.id)._posRecovery,
        })),
      );
      assert.equal(
        await replacement.db.getDocument("transactions", "NEVER-SENT"),
        null,
      );
      assert.equal(
        await replacement.db.getDocument("transactions", "CLOSED"),
        null,
      );
      assert.equal(
        (await replacement.db.getDocument<any>("transactionHistory", "CLOSED"))!
          .zReportId,
        "Z-OLD",
      );
      assert.deepEqual(
        (await replacement.db.getDocument<any>("collections", "C"))!
          .allocations,
        [{ transactionId: "CLOSED", amount: 10 }],
      );
      assert.deepEqual(
        buildZReportPaymentMethodSummary(tx, config),
        buildZReportPaymentMethodSummary(referenceTx, config),
      );
      const collections =
        await replacement.db.getCollection<any>("collections");
      assert.deepEqual(
        calculateZReportStats(tx, collections),
        calculateZReportStats(referenceTx, referenceCollections),
      );
      assert.deepEqual(
        buildCloseReportDetails(
          tx,
          config,
          config.terminals[0].config,
          ALL_CLOSE_REPORT_SECTIONS,
        ),
        buildCloseReportDetails(
          referenceTx,
          config,
          config.terminals[0].config,
          ALL_CLOSE_REPORT_SECTIONS,
        ),
      );
      const cash = await replacement.db.getCollection<any>("cashMovements");
      assert.deepEqual(
        cash.map((x) => x.id),
        referenceCash.map((x) => x.id),
      );
      assert.equal(
        (await replacement.db.getCollection(RECOVERY_OUTBOX)).length,
        0,
      );
      assert.equal(await recovery.sendPending(), 0);
      assert.equal(
        await replacement.db.getDocument("internalSequences", "ANY"),
        null,
      );
      const snap = await request("/snapshots", {});
      authScope = [...scope];
      authScope[3] = "55555555-5555-4555-8555-555555555555";
      await assert.rejects(
        request(
          `/snapshots/${snap.snapshotId}/pages?cursor=${encodeURIComponent(snap.nextCursor)}`,
        ),
        /404/,
      );
      authScope = [...scope];
      authScope[0] = "66666666-6666-4666-8666-666666666666";
      assert.equal((await request("/snapshots", {})).totalRecords, 0);
      authScope = [...scope];
      token = "invalid";
      await assert.rejects(request("/capabilities"), /401/);
      token = "synthetic-token";
      t.diagnostic(
        `PostgreSQL ${version}; ${originals} immutable originals; ${pageRequests} page requests; 8 runtime documents; ACK retry, PostgreSQL restart, SQLite reopen, unsent tail, scoped snapshot and native Z helper equivalence PASS. Authorization boundary and Android bridge remain synthetic.`,
      );
    } finally {
      for (const x of openSqlite) x.close();
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
      }
      await rpcConnection?.end().catch(() => {});
      await admin?.end().catch(() => {});
      if (started) await pg.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
