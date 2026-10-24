import {
  verifyTrackingAuthority,
  assertTrackingSelection,
  trackingFail,
  type TrackingAuthority,
  type TrackingSelection,
} from "../tracking/TrackingAuthority";
export type TrackingDeliveryClock = {
  serverDeliveredMs: number;
  localRequestStartedMs: number;
  localReceivedMs: number;
};
type SQL = {
  query(sql: string, params?: any[]): Promise<{ values?: any[] }>;
  run(sql: string, params?: any[], transaction?: boolean): Promise<any>;
};
export const TRACKING_ALLOCATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS pos_tracking_allocations_v1(id TEXT PRIMARY KEY,authority_json TEXT NOT NULL,delivery_witness_hash TEXT NOT NULL,consumed_minor INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL CHECK(state IN('ACTIVE','RETURN_PENDING','RETURNED','REVOKED')),max_local_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pos_tracking_delivery_clock_v1(allocation_id TEXT PRIMARY KEY REFERENCES pos_tracking_allocations_v1(id),witness_hash TEXT NOT NULL,server_delivered_ms INTEGER NOT NULL,local_request_started_ms INTEGER NOT NULL,local_received_ms INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS pos_tracking_clock_immutable_v1 BEFORE UPDATE ON pos_tracking_delivery_clock_v1 BEGIN SELECT RAISE(ABORT,'TRACKING_CLOCK_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_tracking_clock_durable_v1 BEFORE DELETE ON pos_tracking_delivery_clock_v1 BEGIN SELECT RAISE(ABORT,'TRACKING_CLOCK_DURABLE');END;
CREATE TABLE IF NOT EXISTS pos_tracking_checkout_v1(checkout_id TEXT NOT NULL,allocation_id TEXT NOT NULL REFERENCES pos_tracking_allocations_v1(id),cart_id TEXT NOT NULL,selection_set_json TEXT NOT NULL,selection_json TEXT NOT NULL,quantity_minor INTEGER NOT NULL CHECK(quantity_minor>0),phase TEXT NOT NULL CHECK(phase IN('PREPARED','EFFECT_POSSIBLE','CONSUMED','ABANDONED')),transaction_id TEXT,effect_at_ms INTEGER,PRIMARY KEY(checkout_id,allocation_id,cart_id));
CREATE TRIGGER IF NOT EXISTS pos_tracking_allocation_immutable_v1 BEFORE UPDATE ON pos_tracking_allocations_v1 WHEN OLD.id IS NOT NEW.id OR OLD.authority_json IS NOT NEW.authority_json OR OLD.delivery_witness_hash IS NOT NEW.delivery_witness_hash OR NEW.consumed_minor<OLD.consumed_minor OR NEW.max_local_ms<OLD.max_local_ms OR OLD.state IN('RETURNED','REVOKED') AND OLD.state IS NOT NEW.state BEGIN SELECT RAISE(ABORT,'TRACKING_ALLOCATION_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_tracking_checkout_immutable_v1 BEFORE UPDATE ON pos_tracking_checkout_v1 WHEN OLD.checkout_id IS NOT NEW.checkout_id OR OLD.allocation_id IS NOT NEW.allocation_id OR OLD.cart_id IS NOT NEW.cart_id OR OLD.selection_set_json IS NOT NEW.selection_set_json OR OLD.selection_json IS NOT NEW.selection_json OR OLD.quantity_minor IS NOT NEW.quantity_minor OR OLD.effect_at_ms IS NOT NULL AND OLD.effect_at_ms IS NOT NEW.effect_at_ms OR OLD.phase IN('CONSUMED','ABANDONED') AND OLD.phase IS NOT NEW.phase OR OLD.phase='EFFECT_POSSIBLE' AND NEW.phase NOT IN('EFFECT_POSSIBLE','CONSUMED') BEGIN SELECT RAISE(ABORT,'TRACKING_CHECKOUT_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_tracking_allocation_durable_v1 BEFORE DELETE ON pos_tracking_allocations_v1 BEGIN SELECT RAISE(ABORT,'TRACKING_ALLOCATION_DURABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_tracking_checkout_durable_v1 BEFORE DELETE ON pos_tracking_checkout_v1 BEGIN SELECT RAISE(ABORT,'TRACKING_CHECKOUT_DURABLE');END;
`;
/** Each call runs inside the adapter's sole BEGIN IMMEDIATE writer. Seen ownership is
 * persisted outside SQLite before installation, so losing this DB never renews quota. */
export async function installTrackingAllocation(
  sql: SQL,
  authority: TrackingAuthority,
  previouslySeen: boolean,
  serverConsumedMinor = 0,
  deliveryWitnessHash?: string,
  deliveryClock?: TrackingDeliveryClock,
): Promise<void> {
  await verifyTrackingAuthority(authority);
  if (!deliveryWitnessHash || !/^[a-f0-9]{64}$/.test(deliveryWitnessHash))
    trackingFail("TRACKING_DELIVERY_PROOF_REQUIRED");
  if (
    !Number.isSafeInteger(serverConsumedMinor) ||
    serverConsumedMinor < 0 ||
    serverConsumedMinor > authority.quantityMinor
  )
    trackingFail("TRACKING_SERVER_CONSUMPTION_INVALID");
  const json = JSON.stringify(authority),
    old = (
      await sql.query("SELECT * FROM pos_tracking_allocations_v1 WHERE id=?", [
        authority.allocationId,
      ])
    ).values?.[0];
  if (old) {
    if (
      old.delivery_witness_hash !== deliveryWitnessHash ||
      old.authority_json !== json
    )
      trackingFail("TRACKING_AUTHORITY_CHANGED");
    if (deliveryClock) {
      const saved = (
        await sql.query(
          "SELECT * FROM pos_tracking_delivery_clock_v1 WHERE allocation_id=?",
          [authority.allocationId],
        )
      ).values?.[0];
      if (
        !saved ||
        saved.witness_hash !== deliveryWitnessHash ||
        Number(saved.server_delivered_ms) !== deliveryClock.serverDeliveredMs ||
        Number(saved.local_request_started_ms) !==
          deliveryClock.localRequestStartedMs ||
        Number(saved.local_received_ms) !== deliveryClock.localReceivedMs
      )
        trackingFail("TRACKING_DELIVERY_CLOCK_IMMUTABLE");
    }
    if (serverConsumedMinor > Number(old.consumed_minor))
      trackingFail("TRACKING_SERVER_CONSUMPTION_REQUIRES_RECONCILIATION");
    return;
  }
  if (previouslySeen) trackingFail("TRACKING_LOCAL_OWNERSHIP_MISSING");
  if (
    !deliveryClock ||
    !Object.values(deliveryClock).every(
      (value) =>
        Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000,
    ) ||
    deliveryClock.localReceivedMs < deliveryClock.localRequestStartedMs ||
    deliveryClock.serverDeliveredMs < Date.parse(authority.issuedAt)
  )
    trackingFail("TRACKING_DELIVERY_CLOCK_REQUIRED");
  await sql.run(
    "INSERT INTO pos_tracking_allocations_v1 VALUES(?,?,?,?,'ACTIVE',?)",
    [
      authority.allocationId,
      json,
      deliveryWitnessHash,
      serverConsumedMinor,
      deliveryClock.localReceivedMs,
    ],
    false,
  );
  await sql.run(
    "INSERT INTO pos_tracking_delivery_clock_v1 VALUES(?,?,?,?,?)",
    [
      authority.allocationId,
      deliveryWitnessHash,
      deliveryClock.serverDeliveredMs,
      deliveryClock.localRequestStartedMs,
      deliveryClock.localReceivedMs,
    ],
    false,
  );
}
async function trackingLogicalNow(
  sql: SQL,
  allocation: any,
  localNow: number,
): Promise<number> {
  const anchor = (
    await sql.query(
      "SELECT * FROM pos_tracking_delivery_clock_v1 WHERE allocation_id=?",
      [allocation.id],
    )
  ).values?.[0];
  if (!anchor || anchor.witness_hash !== allocation.delivery_witness_hash)
    trackingFail("TRACKING_DELIVERY_CLOCK_REQUIRED");
  if (
    !Number.isSafeInteger(localNow) ||
    localNow < Number(allocation.max_local_ms) ||
    localNow < Number(anchor.local_received_ms)
  )
    trackingFail("TRACKING_CLOCK_REVERSED");
  const logical =
    Number(anchor.server_delivered_ms) +
    (localNow - Number(anchor.local_request_started_ms));
  if (!Number.isSafeInteger(logical) || logical > 8640000000000000)
    trackingFail("TRACKING_CLOCK_INVALID");
  return logical;
}
function assertTrackingTime(a: TrackingAuthority, logicalNow: number): void {
  if (
    logicalNow < Date.parse(a.issuedAt) ||
    logicalNow < Date.parse(a.receivedAt)
  )
    trackingFail("TRACKING_CLOCK_REVERSED");
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: a.businessTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(logicalNow));
  if (a.expiresOn && date > a.expiresOn) trackingFail("TRACKING_LOT_EXPIRED");
}
export async function prepareTrackingCheckout(
  sql: SQL,
  checkoutId: string,
  selections: TrackingSelection[],
  scope: Pick<
    TrackingAuthority,
    | "tenantId"
    | "companyId"
    | "storeId"
    | "warehouseId"
    | "terminalId"
    | "deviceId"
  >,
  now = Date.now(),
): Promise<void> {
  if (
    !checkoutId ||
    !selections.length ||
    new Set(selections.map((s) => s.authority.allocationId + ":" + s.cartId))
      .size !== selections.length
  )
    trackingFail("TRACKING_CHECKOUT_INVALID");
  const previousSet =
    (
      await sql.query(
        "SELECT selection_set_json,phase,effect_at_ms FROM pos_tracking_checkout_v1 WHERE checkout_id=?",
        [checkoutId],
      )
    ).values || [];
  if (
    previousSet.length &&
    (previousSet.length !== selections.length ||
      previousSet.some(
        (row) => row.selection_set_json !== JSON.stringify(selections),
      ))
  )
    trackingFail("TRACKING_CHECKOUT_SELECTION_SET_CHANGED");
  const requiresTime =
    !previousSet.length || previousSet.every((row) => row.phase === "PREPARED");
  if (
    previousSet.length &&
    !requiresTime &&
    previousSet.some((row) => row.phase === "PREPARED")
  )
    trackingFail("TRACKING_CHECKOUT_PHASE_CHANGED");
  let logicalNow = 0;
  if (requiresTime)
    for (const selection of selections) {
      const allocation = (
        await sql.query(
          "SELECT * FROM pos_tracking_allocations_v1 WHERE id=?",
          [selection.authority.allocationId],
        )
      ).values?.[0];
      if (!allocation) trackingFail("TRACKING_ALLOCATION_NOT_ACTIVE");
      logicalNow = Math.max(
        logicalNow,
        await trackingLogicalNow(sql, allocation, now),
      );
    }
  for (const selection of selections) {
    assertTrackingSelection(selection);
    const a = selection.authority;
    for (const key of Object.keys(scope) as (keyof typeof scope)[])
      if (a[key] !== scope[key]) trackingFail("TRACKING_OWNER_CHANGED");
    const allocation = (
      await sql.query("SELECT * FROM pos_tracking_allocations_v1 WHERE id=?", [
        a.allocationId,
      ])
    ).values?.[0];
    if (
      !allocation ||
      allocation.authority_json !== JSON.stringify(a) ||
      allocation.state !== "ACTIVE"
    )
      trackingFail("TRACKING_ALLOCATION_NOT_ACTIVE");
    const previous = (
      await sql.query(
        "SELECT * FROM pos_tracking_checkout_v1 WHERE checkout_id=? AND allocation_id=? AND cart_id=?",
        [checkoutId, a.allocationId, selection.cartId],
      )
    ).values?.[0];
    if (!previous || previous.phase === "PREPARED")
      assertTrackingTime(a, logicalNow);
    if (previous) {
      if (
        previous.selection_json !== JSON.stringify(selection) ||
        previous.phase === "ABANDONED"
      )
        trackingFail("TRACKING_CHECKOUT_REPLAY_CHANGED");
      if (previous.phase === "PREPARED")
        await sql.run(
          "UPDATE pos_tracking_allocations_v1 SET max_local_ms=? WHERE id=?",
          [now, a.allocationId],
          false,
        );
      continue;
    }
    const reserved = Number(
      (
        await sql.query(
          "SELECT coalesce(sum(quantity_minor),0) quantity FROM pos_tracking_checkout_v1 WHERE allocation_id=? AND phase IN('PREPARED','EFFECT_POSSIBLE')",
          [a.allocationId],
        )
      ).values?.[0]?.quantity || 0,
    );
    if (
      Number(allocation.consumed_minor) + reserved + selection.quantityMinor >
      a.quantityMinor
    )
      trackingFail("TRACKING_QUOTA_EXHAUSTED");
    await sql.run(
      "INSERT INTO pos_tracking_checkout_v1(checkout_id,allocation_id,cart_id,selection_set_json,selection_json,quantity_minor,phase) VALUES(?,?,?,?,?,?,'PREPARED')",
      [
        checkoutId,
        a.allocationId,
        selection.cartId,
        JSON.stringify(selections),
        JSON.stringify(selection),
        selection.quantityMinor,
      ],
      false,
    );
    await sql.run(
      "UPDATE pos_tracking_allocations_v1 SET max_local_ms=? WHERE id=?",
      [now, a.allocationId],
      false,
    );
  }
}
export async function fenceTrackingCheckout(
  sql: SQL,
  checkoutId: string,
  now = Date.now(),
): Promise<number> {
  const rows =
    (
      await sql.query(
        "SELECT * FROM pos_tracking_checkout_v1 WHERE checkout_id=?",
        [checkoutId],
      )
    ).values || [];
  if (
    !rows.length ||
    rows.some((r) => !["PREPARED", "EFFECT_POSSIBLE"].includes(r.phase))
  )
    trackingFail("TRACKING_PAYMENT_OWNER_REQUIRED");
  const effects = rows.filter((row) => row.phase === "EFFECT_POSSIBLE");
  if (effects.length) {
    if (
      effects.length !== rows.length ||
      effects.some(
        (row) =>
          !Number.isSafeInteger(row.effect_at_ms) || row.effect_at_ms <= 0,
      ) ||
      new Set(effects.map((row) => row.effect_at_ms)).size !== 1
    )
      trackingFail("TRACKING_CHECKOUT_PHASE_CHANGED");
    return Number(effects[0].effect_at_ms);
  }
  const allocations = [];
  let effectAt = 0;
  for (const row of rows) {
    const allocation = (
      await sql.query("SELECT * FROM pos_tracking_allocations_v1 WHERE id=?", [
        row.allocation_id,
      ])
    ).values?.[0];
    if (!allocation || allocation.state !== "ACTIVE")
      trackingFail("TRACKING_ALLOCATION_NOT_ACTIVE");
    allocations.push(allocation);
    effectAt = Math.max(
      effectAt,
      await trackingLogicalNow(sql, allocation, now),
    );
  }
  for (let index = 0; index < rows.length; index++) {
    assertTrackingTime(JSON.parse(allocations[index].authority_json), effectAt);
    await sql.run(
      "UPDATE pos_tracking_allocations_v1 SET max_local_ms=? WHERE id=?",
      [now, rows[index].allocation_id],
      false,
    );
    await sql.run(
      "UPDATE pos_tracking_checkout_v1 SET phase='EFFECT_POSSIBLE',effect_at_ms=? WHERE checkout_id=? AND allocation_id=? AND cart_id=?",
      [effectAt, checkoutId, rows[index].allocation_id, rows[index].cart_id],
      false,
    );
  }
  return effectAt;
}
export async function abandonTrackingCheckout(
  sql: SQL,
  checkoutId: string,
): Promise<void> {
  const rows =
    (
      await sql.query(
        "SELECT phase FROM pos_tracking_checkout_v1 WHERE checkout_id=?",
        [checkoutId],
      )
    ).values || [];
  if (rows.some((r) => r.phase === "EFFECT_POSSIBLE" || r.phase === "CONSUMED"))
    trackingFail("TRACKING_EFFECT_POSSIBLE_RECONCILIATION_REQUIRED");
  await sql.run(
    "UPDATE pos_tracking_checkout_v1 SET phase='ABANDONED' WHERE checkout_id=? AND phase='PREPARED'",
    [checkoutId],
    false,
  );
}
export async function consumeTrackingCheckout(
  sql: SQL,
  checkoutId: string,
  transactionId: string,
  selections: TrackingSelection[],
): Promise<void> {
  const rows =
    (
      await sql.query(
        "SELECT * FROM pos_tracking_checkout_v1 WHERE checkout_id=?",
        [checkoutId],
      )
    ).values || [];
  if (
    rows.length !== selections.length ||
    !rows.length ||
    rows.some((row) => row.selection_set_json !== JSON.stringify(selections))
  )
    trackingFail("TRACKING_COMMIT_SOURCE_CHANGED");
  for (const row of rows) {
    const selection = selections.find(
      (s) =>
        s.authority.allocationId === row.allocation_id &&
        s.cartId === row.cart_id,
    );
    if (
      !selection ||
      row.selection_json !== JSON.stringify(selection) ||
      (row.phase !== "EFFECT_POSSIBLE" &&
        !(row.phase === "CONSUMED" && row.transaction_id === transactionId))
    )
      trackingFail("TRACKING_COMMIT_SOURCE_CHANGED");
    if (row.phase === "CONSUMED") continue;
    if (!Number.isSafeInteger(row.effect_at_ms))
      trackingFail("TRACKING_EFFECT_TIME_REQUIRED");
    const allocation = (
      await sql.query("SELECT * FROM pos_tracking_allocations_v1 WHERE id=?", [
        row.allocation_id,
      ])
    ).values?.[0];
    if (
      !allocation ||
      allocation.state !== "ACTIVE" ||
      Number(allocation.consumed_minor) + Number(row.quantity_minor) >
        selection.authority.quantityMinor
    )
      trackingFail("TRACKING_QUOTA_EXHAUSTED");
    await sql.run(
      "UPDATE pos_tracking_allocations_v1 SET consumed_minor=consumed_minor+? WHERE id=?",
      [row.quantity_minor, row.allocation_id],
      false,
    );
    await sql.run(
      "UPDATE pos_tracking_checkout_v1 SET phase='CONSUMED',transaction_id=? WHERE checkout_id=? AND allocation_id=? AND cart_id=?",
      [transactionId, checkoutId, row.allocation_id, row.cart_id],
      false,
    );
  }
}
