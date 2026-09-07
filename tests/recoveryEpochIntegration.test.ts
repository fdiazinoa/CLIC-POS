import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { fixture } from "./helpers/closePreparationSQLite";
import {
  PendingOperationsRecovery,
  type RecoveryTransport,
} from "../services/recovery/PendingOperationsRecovery";
const erp = process.env.CLIC_ERP_REVIEW_PATH,
  module = process.env.CLIC_EMBEDDED_POSTGRES_MODULE;
test(
  "SQLite loss → ERP CAS with lost ACK → restart → new sale + old references → another complete restore",
  { skip: !erp || !module, timeout: 60000 },
  async () => {
    const imp = (p: string) => import(pathToFileURL(join(erp!, p)).href);
    const { default: PG } = await import(pathToFileURL(module!).href);
    const { fixtureSchema, recoveryMigrations } = await imp(
      "server/scripts/helpers/receivedCloseFixtureDatabase.mjs",
    );
    const { createOriginalRecoveryService } = await imp(
      "server/services/posOriginalRecovery.js",
    );
    const { createRetainedRestoreService } = await imp(
      "server/services/posRetainedRestore.js",
    );
    const { createRetainedEpochService } = await imp(
      "server/services/posRetainedEpoch.js",
    );
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as any).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const dir = await mkdtemp(join(tmpdir(), "pos-epoch-joint-"));
    const pg = new PG({
      databaseDir: join(dir, "pg"),
      port,
      user: "postgres",
      password: "offline-only",
      persistent: false,
      postgresFlags: ["-h", "127.0.0.1"],
      onLog: () => {},
      onError: () => {},
    });
    const source = fixture(),
      replacement = fixture(),
      third = fixture();
    let c: any;
    try {
      await pg.initialise();
      await pg.start();
      c = pg.getPgClient("postgres", "127.0.0.1");
      await c.connect();
      await c.query(
        fixtureSchema +
          "create table public.erp_terminals(id uuid primary key,store_id uuid,config jsonb,device_id text,authorized_device_id text);",
      );
      for (const name of [
        ...recoveryMigrations,
        "20260907210000_pos_retained_restore_state.sql",
        "20260907220000_pos_retained_epoch_continuity.sql",
      ])
        await c.query(
          await readFile(join(erp!, "supabase/migrations", name), "utf8"),
        );
      const id = "11111111-1111-4111-8111-111111111111",
        scope = {
          p_tenant_id: id,
          p_company_id: id,
          p_store_id: id,
          p_terminal_id: id,
        },
        terminal = { id, store_id: id, config: {}, device_id: "paired-device" };
      await c.query(
        "insert into erp_terminals(id,store_id,config,device_id) values($1,$1,'{}','paired-device')",
        [id],
      );
      const args: Record<string, string[]> = {
        erp_pos_original_snapshot: [],
        erp_pos_original_receive: ["p_records"],
        erp_pos_original_page: ["p_snapshot_id", "p_cursor"],
        erp_pos_retained_restore_state: ["p_snapshot_id"],
        erp_pos_retained_epoch_result: ["p_request_id", "p_request_hash"],
        erp_pos_retained_epoch_resume: [
          "p_request_json",
          "p_expected_authority",
          "p_expected_closure_state",
        ],
      };
      const client = {
        rpc: async (name: string, params: any) => {
          if (!Object.prototype.hasOwnProperty.call(args, name))
            throw Error("unexpected RPC");
          const values = [
            ...["p_tenant_id", "p_company_id", "p_store_id", "p_terminal_id"],
            ...args[name],
          ].map((k) =>
            params[k] && typeof params[k] === "object"
              ? JSON.stringify(params[k])
              : params[k],
          );
          try {
            return {
              data: (
                await c.query(
                  `select public.${name}(${values.map((_: any, i: number) => "$" + (i + 1)).join(",")}) result`,
                  values,
                )
              ).rows[0].result,
            };
          } catch (e: any) {
            return { error: { message: e.message, code: e.code } };
          }
        },
      };
      const originals = createOriginalRecoveryService(client),
        retained = createRetainedRestoreService(client),
        epochs = createRetainedEpochService(client);
      let loseAck = true;
      const api: RecoveryTransport = {
        context: async () => ({
          key: "company:terminal",
          terminalIds: ["T1", id],
          enabled: true,
          retainedEpochVersion: 1,
          recoveryScope: {
            tenantId: id,
            companyId: id,
            storeId: id,
            terminalId: id,
          },
        }),
        receive: (rs) => originals.receive(scope, rs),
        snapshot: () => originals.snapshot(scope),
        page: (sid, cursor) => originals.page(scope, sid, cursor),
        retainedSet: (sid, receipt) => retained.descriptor(scope, sid, receipt),
        resumeEpoch: async (request) => {
          const ack = await epochs.resume(scope, request, terminal);
          if (loseAck) {
            loseAck = false;
            throw Error("ACK_LOST");
          }
          return ack;
        },
        getRetainedEpoch: async (requestId) => {
          try {
            return await epochs.result(scope, requestId);
          } catch (e: any) {
            if (e.code === "RESUME_REQUEST_NOT_FOUND") return null;
            throw e;
          }
        },
      };
      const { db: first } = source.open();
      const sender = new PendingOperationsRecovery(first, api);
      const old = {
        id: "old-ticket",
        terminalId: "T1",
        total: 1500,
        payments: [
          {
            method: "CARD",
            currencyCode: "USD",
            amountOriginal: 25,
            exchangeRate: 60,
            amount: 1500,
          },
        ],
      };
      await first.saveDocument("transactions", old);
      await first.saveDocument("transactionHistory", old);
      await sender.checkpointRetainedSet();
      let { db } = replacement.open(),
        receiver = new PendingOperationsRecovery(db, api);
      await receiver.download();
      await assert.rejects(receiver.restore(), /ACK_LOST/);
      assert.equal((await db.getCollection("transactions")).length, 1);
      await assert.rejects(
        db.saveDocument("transactions", { id: "blocked" }),
        /CONTINUITY_PENDING/,
      );
      ({ db } = replacement.restart());
      receiver = new PendingOperationsRecovery(db, api);
      await receiver.ensureRetainedContinuity();
      const capture = await db.getDocument<any>("recoveryState", "capture");
      assert.equal(capture.sequence, "0");
      await db.saveDocument("transactions", {
        id: "new-ticket",
        terminalId: "T1",
        total: 550,
        payments: [{ method: "CASH", amount: 550 }],
      });
      await receiver.updateRetainedBackup();
      await receiver.download(true);
      const d = await receiver.preflightRetainedSet();
      assert.equal(d.lineage.transitions.length, 1);
      assert.equal(d.placements.length, 3);
      assert.equal(
        (
          await c.query(
            "select count(*)::int n from private.pos_original_records where kind='TRANSACTION'",
          )
        ).rows[0].n,
        2,
      );
      const { db: last } = third.open(),
        restorer = new PendingOperationsRecovery(last, api);
      await restorer.download();
      assert.equal(await restorer.restore(), 3);
      assert.equal((await last.getCollection("transactions")).length, 2);
      assert.equal(await restorer.restore(), 3); // New descriptor after CAS keeps import idempotent.
      const restored: any = await last.getDocument(
        "transactions",
        "old-ticket",
      );
      assert.equal(restored.payments[0].amountOriginal, 25);
      assert.equal(
        (
          await c.query(
            "select count(*)::int n from private.pos_recovered_close_commits",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (await c.query("select count(*)::int n from erp_sync_inbox")).rows[0].n,
        0,
      );
    } finally {
      source.close();
      replacement.close();
      third.close();
      if (c) await c.end();
      await pg.stop();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
