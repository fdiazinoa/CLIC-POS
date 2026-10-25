import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { base6, readV3Base6Stock } from "../services/db/V3Base6Stock";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE master_v3_inventory_balances(item_id TEXT,warehouse_id TEXT,qty_on_hand REAL,qty_reserved REAL,qty_committed REAL);CREATE TABLE documents(collection_name TEXT,data TEXT);",
  );
  db.prepare("insert into master_v3_inventory_balances values(?,?,?,?,?)").run(
    "item",
    "warehouse",
    0.125001,
    0,
    0,
  );
  return {
    db,
    query: async <T>(sql: string, args: (string | number | null)[]) =>
      db.prepare(sql).all(...args) as T[],
  };
}
test("fractional lot stock preserves .125 and one micro-unit exactly", async () => {
  const f = fixture();
  f.db
    .prepare("insert into documents values(?,?)")
    .run(
      "inventoryLedger",
      JSON.stringify({
        v3InventoryBaseline: "base",
        productId: "item",
        warehouseId: "warehouse",
        qtyIn: 0,
        qtyOut: 0.125,
      }),
    );
  const stock = await readV3Base6Stock(f.query, "base", "item", "warehouse");
  assert.equal(stock.available.toFixed(6), "0.000001");
  f.db
    .prepare("insert into documents values(?,?)")
    .run(
      "inventoryLedger",
      JSON.stringify({
        v3InventoryBaseline: "base",
        productId: "item",
        warehouseId: "warehouse",
        qtyIn: 0,
        qtyOut: 0.000001,
      }),
    );
  assert.equal(
    (
      await readV3Base6Stock(f.query, "base", "item", "warehouse")
    ).available.toFixed(6),
    "0.000000",
  );
});
test("tracking never rounds a seventh decimal or unsafe source quantity", async () => {
  assert.throws(() => base6(0.0000001), /PRECISION/);
  const f = fixture();
  f.db
    .prepare("insert into documents values(?,?)")
    .run(
      "inventoryLedger",
      JSON.stringify({
        v3InventoryBaseline: "base",
        productId: "item",
        warehouseId: "warehouse",
        qtyOut: 0.0000001,
      }),
    );
  await assert.rejects(
    readV3Base6Stock(f.query, "base", "item", "warehouse"),
    /PRECISION/,
  );
});
