import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import express from "express";
import {
  encodeOriginal,
  encodeBase64,
  originalDigest,
  ORIGINAL_ENCODING,
} from "../services/recovery/OriginalCodec";
import { PendingOperationsRecovery } from "../services/recovery/PendingOperationsRecovery";

// Optional cross-repository contract test. The actual ERP router and validation run;
// the RPC store is an in-memory double, not evidence of database durability.
const erpPath = process.env.CLIC_ERP_REVIEW_PATH;
test(
  "POS sends original bytes through ERP router and restores the returned snapshot",
  { skip: !erpPath },
  async () => {
    const { createOriginalRecoveryRouter } = await import(
      pathToFileURL(`${erpPath}/server/routes/posOriginalRecovery.js`).href
    );
    const uuid = "11111111-1111-4111-8111-111111111111";
    const rows: any[] = [];
    const snapshot = () => ({
      snapshotId: uuid,
      totalRecords: rows.length,
      snapshotDigest: createHash("sha256")
        .update(rows.map((r) => `${r.receiptId}:${r.recordHash}\n`).join(""))
        .digest("hex"),
      expiresAt: "2099-01-01T00:00:00.000Z",
      nextCursor: rows.length ? "first" : null,
    });
    const client = {
      rpc: async (name: string, args: any) => {
        if (name === "erp_pos_original_capabilities")
          return { data: { enabled: true } };
        assert.equal(args.p_terminal_id, uuid);
        if (name === "erp_pos_original_receive") {
          for (const item of args.p_records)
            rows.push({
              ...item,
              receiptId: String(rows.length + 1),
              receivedAt: "2026-09-07T00:00:00.000Z",
            });
          return {
            data: {
              receipts: rows.map((r) => ({
                ...r.record,
                receiptId: r.receiptId,
                receiptStatus: "RECEIVED",
              })),
            },
          };
        }
        if (name === "erp_pos_original_snapshot") return { data: snapshot() };
        if (name === "erp_pos_original_page")
          return {
            data: {
              ...snapshot(),
              pageStart: 0,
              records: rows,
              nextCursor: null,
            },
          };
        throw Error(`Unexpected RPC ${name}`);
      },
    };
    const app = express();
    app.use(express.json({ limit: "3mb" }));
    app.use(
      "/api/sync/originals",
      createOriginalRecoveryRouter({
        client,
        authorize: async (req: any) => {
          assert.equal(req.headers["x-sync-token"], "offline-test");
          return { id: uuid };
        },
        context: async () => ({
          tenant: { id: uuid },
          company: { id: uuid },
          store: { id: uuid },
        }),
      }),
    );
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const url = `http://127.0.0.1:${(server.address() as any).port}/api/sync/originals`;
      const request = async (path: string, body?: unknown) => {
        const response = await fetch(url + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "content-type": "application/json",
            "x-sync-token": "offline-test",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const result = await response.json();
        assert.equal(response.status, 200, JSON.stringify(result));
        return result;
      };
      const document = {
        id: "SALE",
        terminalId: uuid,
        total: 50,
        timestamp: new Date("2026-09-06T23:59:00-04:00"),
        payments: [{ received: 100, change: 50, extension: undefined }],
      };
      const body = new TextEncoder().encode(
        encodeOriginal({
          version: 1,
          collection: "transactions",
          original: encodeOriginal(document),
          document: encodeOriginal(document),
          configuration: encodeOriginal(null),
        }),
      );
      const record = {
        version: 1,
        storageEpoch: uuid,
        openSetId: uuid,
        sequence: "1",
        kind: "TRANSACTION",
        originalId: document.id,
        revision: "1",
        encoding: ORIGINAL_ENCODING,
        bodyBase64: encodeBase64(body),
        bodySha256: await originalDigest(body),
        byteLength: body.length,
      };
      await request("/batch", { records: [record] });
      const stored = new Map<string, any>();
      const db: any = {
        getDocument: async (c: string, id: string) =>
          structuredClone(stored.get(c + ":" + id) || null),
        getCollection: async (c: string) =>
          structuredClone(
            [...stored]
              .filter(([key]) => key.startsWith(c + ":"))
              .map(([, value]) => value),
          ),
        saveDocumentsAtomically: async (ds: any[]) => {
          for (const d of ds)
            stored.set(
              d.collectionName + ":" + d.document.id,
              structuredClone(d.document),
            );
        },
      };
      const recovery = new PendingOperationsRecovery(db, {
        context: async () => ({
          key: "scope",
          terminalIds: [uuid],
          enabled: true,
        }),
        receive: (records) => request("/batch", { records }),
        snapshot: () => request("/snapshots", {}),
        page: (id, cursor) =>
          request(`/snapshots/${id}/pages?cursor=${cursor}`),
      });
      await recovery.download();
      assert.equal(await recovery.restore(), 1);
      const restored = stored.get("transactions:SALE");
      assert.deepEqual(restored.timestamp, document.timestamp);
      assert.deepEqual(restored.payments, document.payments);
      assert.equal(restored._posRecovery.closeAuthorization, "NOT_GRANTED");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
