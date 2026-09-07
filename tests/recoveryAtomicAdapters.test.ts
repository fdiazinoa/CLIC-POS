import test from "node:test";
import assert from "node:assert/strict";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { DatabaseSync } from "node:sqlite";
import { IndexedDBAdapter } from "../services/db/adapters/IndexedDBAdapter";
import { CapacitorSQLiteAdapter } from "../services/db/adapters/CapacitorSQLiteAdapter";
const localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
test("IndexedDB atomic import aborts every store on duplicate and never falls back", async () => {
  Object.assign(globalThis, {
    indexedDB,
    IDBKeyRange,
    localStorage,
    window: { setTimeout, clearTimeout },
  });
  const db = new IndexedDBAdapter();
  await db.connect();
  await db.saveDocumentsAtomically([
    { collectionName: "transactions", document: { id: "EXISTING", total: 5 } },
  ]);
  await assert.rejects(
    db.saveDocumentsAtomically(
      [
        { collectionName: "collections", document: { id: "C", amount: 3 } },
        {
          collectionName: "transactions",
          document: { id: "EXISTING", total: 99 },
        },
      ],
      true,
    ),
    /LOCAL_CONFLICT/,
  );
  assert.equal(await db.getDocument("collections", "C"), null);
  assert.equal(
    (await db.getDocument<any>("transactions", "EXISTING")).total,
    5,
  );
  await db.saveDocumentsAtomically([
    { collectionName: "transactions", document: { id: "A" } },
    { collectionName: "recoveryOriginals", document: { id: "R" } },
  ]);
  assert(await db.getDocument("transactions", "A"));
  assert(await db.getDocument("recoveryOriginals", "R"));
  await assert.rejects(
    db.saveDocumentsAtomically([
      { collectionName: "collections", document: { id: "NEVER" } },
      {
        collectionName: "transactions",
        document: { id: "INVALID", unsupported: () => 0 },
      },
    ]),
  );
  assert.equal(await db.getDocument("collections", "NEVER"), null);
  await db.disconnect();
});
test("SQLite execution failure rolls back runtime and capture; conflict publication is atomic", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    "CREATE TABLE documents(collection_name TEXT NOT NULL,doc_id TEXT NOT NULL,data TEXT NOT NULL,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id))",
  );
  let fail = false;
  const bridge = {
    query: async (q: string, p: any[]) => ({
      values: sql.prepare(q).all(...p),
    }),
    executeSet: async (rows: any[]) => {
      sql.exec("BEGIN");
      try {
        for (let i = 0; i < rows.length; i++) {
          sql.prepare(rows[i].statement).run(...rows[i].values);
          if (fail && i === 0) throw Error("disk failed");
        }
        sql.exec("COMMIT");
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const adapter = new CapacitorSQLiteAdapter();
  Object.assign(adapter, { db: bridge, isReady: true });
  const docs = [
    { collectionName: "transactions", document: { id: "A" } },
    { collectionName: "recoveryOriginals", document: { id: "R" } },
  ];
  fail = true;
  await assert.rejects(adapter.saveDocumentsAtomically(docs), /disk failed/);
  assert.equal(
    (sql.prepare("SELECT COUNT(*) n FROM documents").get() as any).n,
    0,
  );
  fail = false;
  await adapter.saveDocumentsAtomically(docs);
  await assert.rejects(
    adapter.saveDocumentsAtomically(
      [{ collectionName: "collections", document: { id: "C" } }, ...docs],
      true,
    ),
    /LOCAL_CONFLICT/,
  );
  assert.equal(
    (sql.prepare("SELECT COUNT(*) n FROM documents").get() as any).n,
    2,
  );
  sql.close();
});
