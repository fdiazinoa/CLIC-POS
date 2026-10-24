import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import {
  TRACKING_ALLOCATION_SCHEMA,
  installTrackingAllocation,
  prepareTrackingCheckout,
  fenceTrackingCheckout,
  consumeTrackingCheckout,
  abandonTrackingCheckout,
} from "../services/db/TrackingAllocationStore";
import type {
  TrackingAuthority,
  TrackingSelection,
} from "../services/tracking/TrackingAuthority";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(TRACKING_ALLOCATION_SCHEMA);
  const sql = {
    async query(q: string, p: any[] = []) {
      return { values: db.prepare(q).all(...p) };
    },
    async run(q: string, p: any[] = []) {
      return db.prepare(q).run(...p);
    },
  };
  const now = Date.now() + 1000,
    a: TrackingAuthority = {
      schemaVersion: 1,
      allocationId: randomUUID(),
      unitId: randomUUID(),
      tenantId: randomUUID(),
      companyId: randomUUID(),
      storeId: randomUUID(),
      warehouseId: randomUUID(),
      terminalId: randomUUID(),
      deviceId: "test-device",
      itemId: randomUUID(),
      variantId: "",
      kind: "SERIAL",
      code: "S-1",
      lotCode: null,
      expiresOn: null,
      receivedAt: new Date(now - 100000).toISOString(),
      quantityMinor: 1000000,
      quantityScale: 1000000,
      revision: 1,
      unitRevision: 1,
      businessTimezone: "America/Santo_Domingo",
      bindingHash: "a".repeat(64),
      issuedAt: new Date(now - 10000).toISOString(),
      checksum: "b".repeat(64),
    };
  const { checksum, ...source } = a;
  a.checksum = createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.keys(source)
            .sort()
            .map((k) => [k, source[k as keyof typeof source]]),
        ),
      ),
    )
    .digest("hex");
  const selection: TrackingSelection = {
    authority: a,
    itemId: a.itemId,
    variantId: "",
    cartId: "cart",
    quantityMinor: 1000000,
  };
  const scope = {
    tenantId: a.tenantId,
    companyId: a.companyId,
    storeId: a.storeId,
    warehouseId: a.warehouseId,
    terminalId: a.terminalId,
    deviceId: a.deviceId,
  };
  return { db, sql, a, selection, scope, now };
}
test("serial ownership admits one checkout before any payment effect", async () => {
  const f = fixture();
  await installTrackingAllocation(f.sql, f.a, false);
  await prepareTrackingCheckout(
    f.sql,
    "checkout-1",
    [f.selection],
    f.scope,
    f.now,
  );
  await assert.rejects(
    prepareTrackingCheckout(f.sql, "checkout-2", [f.selection], f.scope, f.now),
    /QUOTA_EXHAUSTED/,
  );
  await fenceTrackingCheckout(f.sql, "checkout-1", f.now);
  await assert.rejects(
    abandonTrackingCheckout(f.sql, "checkout-1"),
    /RECONCILIATION_REQUIRED/,
  );
  await consumeTrackingCheckout(f.sql, "checkout-1", "sale-1", [f.selection]);
  await consumeTrackingCheckout(f.sql, "checkout-1", "sale-1", [f.selection]);
  assert.equal(
    f.db.prepare("select consumed_minor from pos_tracking_allocations_v1").get()
      ?.consumed_minor,
    1000000,
  );
  await assert.rejects(
    consumeTrackingCheckout(f.sql, "checkout-1", "sale-2", [f.selection]),
    /SOURCE_CHANGED/,
  );
});
test("only a checkout without possible effects can release a selection", async () => {
  const f = fixture();
  await installTrackingAllocation(f.sql, f.a, false);
  await prepareTrackingCheckout(
    f.sql,
    "abandon",
    [f.selection],
    f.scope,
    f.now,
  );
  await abandonTrackingCheckout(f.sql, "abandon");
  await prepareTrackingCheckout(
    f.sql,
    "replacement",
    [f.selection],
    f.scope,
    f.now,
  );
  await fenceTrackingCheckout(f.sql, "replacement", f.now);
  assert.equal(
    f.db
      .prepare(
        "select count(*) n from pos_tracking_checkout_v1 where phase='EFFECT_POSSIBLE'",
      )
      .get()?.n,
    1,
  );
});
test("snapshot refresh never renews consumed serial or lost database ownership", async () => {
  const f = fixture();
  await assert.rejects(
    installTrackingAllocation(f.sql, f.a, true),
    /LOCAL_OWNERSHIP_MISSING/,
  );
  await installTrackingAllocation(f.sql, f.a, false);
  await prepareTrackingCheckout(f.sql, "first", [f.selection], f.scope, f.now);
  await fenceTrackingCheckout(f.sql, "first", f.now);
  await consumeTrackingCheckout(f.sql, "first", "sale", [f.selection]);
  await installTrackingAllocation(f.sql, f.a, true);
  await assert.rejects(
    prepareTrackingCheckout(f.sql, "later", [f.selection], f.scope, f.now),
    /QUOTA_EXHAUSTED/,
  );
});
test("sale and tracking quota roll back together when native writer fails", async () => {
  const f = fixture();
  await installTrackingAllocation(f.sql, f.a, false);
  await prepareTrackingCheckout(
    f.sql,
    "checkout",
    [f.selection],
    f.scope,
    f.now,
  );
  await fenceTrackingCheckout(f.sql, "checkout", f.now);
  f.db.exec("BEGIN IMMEDIATE");
  await consumeTrackingCheckout(f.sql, "checkout", "sale", [f.selection]);
  f.db.exec("ROLLBACK");
  assert.equal(
    f.db.prepare("select consumed_minor from pos_tracking_allocations_v1").get()
      ?.consumed_minor,
    0,
  );
  assert.equal(
    f.db.prepare("select phase from pos_tracking_checkout_v1").get()?.phase,
    "EFFECT_POSSIBLE",
  );
});
test("prepared lot expires before first payment but paid recovery retains original effect time", async () => {
  const f = fixture();
  f.a.kind = "LOT";
  f.a.expiresOn = "2026-10-24";
  const { checksum, ...source } = f.a;
  f.a.checksum = createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.keys(source)
            .sort()
            .map((k) => [k, source[k as keyof typeof source]]),
        ),
      ),
    )
    .digest("hex");
  const before = Date.now() + 1000,
    after = before + 172800000;
  f.a.expiresOn = new Intl.DateTimeFormat("en-CA", {
    timeZone: f.a.businessTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(before));
  f.a.issuedAt = new Date(before - 10000).toISOString();
  f.a.receivedAt = new Date(before - 20000).toISOString();
  const { checksum: unused, ...updated } = f.a;
  f.a.checksum = createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.keys(updated)
            .sort()
            .map((k) => [k, updated[k as keyof typeof updated]]),
        ),
      ),
    )
    .digest("hex");
  await installTrackingAllocation(f.sql, f.a, false);
  f.db
    .prepare("update pos_tracking_allocations_v1 set max_local_ms=?")
    .run(before);
  await prepareTrackingCheckout(
    f.sql,
    "expired",
    [f.selection],
    f.scope,
    before,
  );
  await assert.rejects(
    fenceTrackingCheckout(f.sql, "expired", after),
    /LOT_EXPIRED/,
  );
  await fenceTrackingCheckout(f.sql, "expired", before);
  await fenceTrackingCheckout(f.sql, "expired", after);
  await consumeTrackingCheckout(f.sql, "expired", "original-paid", [
    f.selection,
  ]);
  assert.equal(
    f.db.prepare("select effect_at_ms from pos_tracking_checkout_v1").get()
      ?.effect_at_ms,
    before,
  );
});
test("one lot allocation supports distinct cart lines without merging their source identity", async () => {
  const f = fixture();
  f.a.kind = "LOT";
  f.a.quantityMinor = 3000000;
  const { checksum, ...source } = f.a;
  f.a.checksum = createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.keys(source)
            .sort()
            .map((k) => [k, source[k as keyof typeof source]]),
        ),
      ),
    )
    .digest("hex");
  const second = {
    ...f.selection,
    cartId: "other-price",
    quantityMinor: 1500000,
  };
  await installTrackingAllocation(f.sql, f.a, false);
  await prepareTrackingCheckout(
    f.sql,
    "lot-checkout",
    [f.selection, second],
    f.scope,
    f.now,
  );
  await fenceTrackingCheckout(f.sql, "lot-checkout", f.now);
  await consumeTrackingCheckout(f.sql, "lot-checkout", "sale", [
    f.selection,
    second,
  ]);
  assert.equal(
    f.db.prepare("select consumed_minor from pos_tracking_allocations_v1").get()
      ?.consumed_minor,
    2500000,
  );
  assert.equal(
    f.db
      .prepare(
        "select count(*) n from pos_tracking_checkout_v1 where phase='CONSUMED'",
      )
      .get()?.n,
    2,
  );
});

test("entire checkout selection set is immutable before any paid recovery", async () => {
  const f = fixture();
  f.a.kind = "LOT";
  f.a.quantityMinor = 3000000;
  const { checksum, ...source } = f.a;
  f.a.checksum = createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.keys(source)
            .sort()
            .map((k) => [k, source[k as keyof typeof source]]),
        ),
      ),
    )
    .digest("hex");
  await installTrackingAllocation(f.sql, f.a, false);
  await prepareTrackingCheckout(f.sql, "sealed", [f.selection], f.scope, f.now);
  await fenceTrackingCheckout(f.sql, "sealed", f.now);
  await assert.rejects(
    prepareTrackingCheckout(
      f.sql,
      "sealed",
      [f.selection, { ...f.selection, cartId: "injected" }],
      f.scope,
      f.now,
    ),
    /SELECTION_SET_CHANGED/,
  );
  await consumeTrackingCheckout(f.sql, "sealed", "paid", [f.selection]);
  assert.equal(
    f.db.prepare("select consumed_minor from pos_tracking_allocations_v1").get()
      ?.consumed_minor,
    1000000,
  );
});
