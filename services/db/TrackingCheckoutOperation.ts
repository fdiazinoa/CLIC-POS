import { financialIdentity } from "./LargeMasterSyncV3FinancialRetention";
import type { CartItem, Transaction } from "../../types";
import { v3RetainedLineFingerprint } from "../sync/LargeMasterSyncV3StockAuthority";
import {
  trackingFail,
  type TrackingAuthority,
} from "../tracking/TrackingAuthority";
type SQL = {
  query(sql: string, args?: any[]): Promise<{ values?: any[] }>;
  run(sql: string, args?: any[], transaction?: boolean): Promise<any>;
};
export type TrackingScope = Pick<
  TrackingAuthority,
  | "tenantId"
  | "companyId"
  | "storeId"
  | "warehouseId"
  | "terminalId"
  | "deviceId"
>;
export type TrackingOperation = {
  checkoutId: string;
  transactionId: string;
  cartIdentity: string;
  scopeKey: string;
  paymentIds: string[];
  phase: "PREPARED" | "EFFECT_POSSIBLE" | "CONSUMED";
};
export const trackingScopeKey = (scope: TrackingScope) =>
  JSON.stringify([
    scope.tenantId,
    scope.companyId,
    scope.storeId,
    scope.warehouseId,
    scope.terminalId,
    scope.deviceId,
  ]);
export const TRACKING_OPERATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS pos_tracking_operations_v1(checkout_id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL UNIQUE,scope_key TEXT NOT NULL,cart_identity TEXT NOT NULL,payment_ids_json TEXT NOT NULL DEFAULT '[]',state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(state IN('ACTIVE','RETIRED')));
CREATE UNIQUE INDEX IF NOT EXISTS pos_tracking_live_cart_v1 ON pos_tracking_operations_v1(scope_key,cart_identity) WHERE state='ACTIVE';
CREATE INDEX IF NOT EXISTS pos_tracking_operation_scope_v1 ON pos_tracking_operations_v1(scope_key);
CREATE TRIGGER IF NOT EXISTS pos_tracking_operation_immutable_v1 BEFORE UPDATE ON pos_tracking_operations_v1 WHEN OLD.checkout_id IS NOT NEW.checkout_id OR OLD.transaction_id IS NOT NEW.transaction_id OR OLD.scope_key IS NOT NEW.scope_key OR OLD.cart_identity IS NOT NEW.cart_identity OR OLD.state='RETIRED' AND NEW.state IS NOT OLD.state OR json_type(NEW.payment_ids_json)<>'array' OR EXISTS(SELECT 1 FROM json_each(OLD.payment_ids_json) old_id WHERE NOT EXISTS(SELECT 1 FROM json_each(NEW.payment_ids_json) new_id WHERE new_id.value=old_id.value)) OR NEW.state='RETIRED' AND (json_array_length(NEW.payment_ids_json)<>0 OR EXISTS(SELECT 1 FROM pos_tracking_checkout_v1 c WHERE c.checkout_id=NEW.checkout_id AND c.phase<>'ABANDONED')) BEGIN SELECT RAISE(ABORT,'TRACKING_OPERATION_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_tracking_operation_durable_v1 BEFORE DELETE ON pos_tracking_operations_v1 BEGIN SELECT RAISE(ABORT,'TRACKING_OPERATION_DURABLE');END;`;
export async function prepareTrackingOperation(
  sql: SQL,
  checkoutId: string,
  transactionId: string,
  cartIdentity: string,
  scope: TrackingScope,
) {
  if (
    !checkoutId ||
    !transactionId ||
    typeof cartIdentity !== "string" ||
    !cartIdentity ||
    cartIdentity.length > 524288
  )
    trackingFail("TRACKING_OPERATION_SOURCE_REQUIRED");
  const key = trackingScopeKey(scope);
  if (Object.values(scope).some((v) => typeof v !== "string" || !v))
    trackingFail("TRACKING_OWNER_REQUIRED");
  const old = (
    await sql.query(
      "SELECT * FROM pos_tracking_operations_v1 WHERE checkout_id=?",
      [checkoutId],
    )
  ).values?.[0];
  if (old) {
    if (
      old.transaction_id !== transactionId ||
      old.scope_key !== key ||
      old.cart_identity !== cartIdentity
    )
      trackingFail("TRACKING_OPERATION_SOURCE_CHANGED");
    return;
  }
  await sql.run(
    "INSERT INTO pos_tracking_operations_v1(checkout_id,transaction_id,scope_key,cart_identity) VALUES(?,?,?,?)",
    [checkoutId, transactionId, key, cartIdentity],
    false,
  );
}
export async function readTrackingOperation(
  sql: SQL,
  cartIdentity: string,
  scope: TrackingScope,
): Promise<TrackingOperation | null> {
  const rows =
    (
      await sql.query(
        "SELECT o.* FROM pos_tracking_operations_v1 o WHERE o.state='ACTIVE' AND scope_key=? AND cart_identity=? AND EXISTS(SELECT 1 FROM pos_tracking_checkout_v1 c WHERE c.checkout_id=o.checkout_id AND c.phase<>'ABANDONED')",
        [trackingScopeKey(scope), cartIdentity],
      )
    ).values || [];
  if (rows.length > 1) trackingFail("TRACKING_OPERATION_AMBIGUOUS");
  if (!rows.length) return null;
  const row = rows[0],
    phases =
      (
        await sql.query(
          "SELECT phase FROM pos_tracking_checkout_v1 WHERE checkout_id=?",
          [row.checkout_id],
        )
      ).values || [];
  const phase = phases.every((p) => p.phase === "CONSUMED")
    ? "CONSUMED"
    : phases.some((p) => p.phase === "EFFECT_POSSIBLE")
      ? "EFFECT_POSSIBLE"
      : "PREPARED";
  return {
    checkoutId: row.checkout_id,
    transactionId: row.transaction_id,
    scopeKey: row.scope_key,
    cartIdentity: row.cart_identity,
    paymentIds: JSON.parse(row.payment_ids_json),
    phase,
  };
}
export async function recordTrackingPaymentEffect(
  sql: SQL,
  checkoutId: string,
  paymentId: string,
) {
  if (!paymentId || paymentId.length > 160)
    trackingFail("TRACKING_PAYMENT_ID_REQUIRED");
  const operation = (
    await sql.query(
      "SELECT payment_ids_json FROM pos_tracking_operations_v1 WHERE checkout_id=?",
      [checkoutId],
    )
  ).values?.[0];
  if (!operation) trackingFail("TRACKING_OPERATION_SOURCE_REQUIRED");
  const ids = JSON.parse(operation.payment_ids_json);
  if (ids.includes(paymentId)) return;
  if (ids.length >= 64) trackingFail("TRACKING_PAYMENT_BOUND_EXCEEDED");
  ids.push(paymentId);
  await sql.run(
    "UPDATE pos_tracking_operations_v1 SET payment_ids_json=? WHERE checkout_id=?",
    [JSON.stringify(ids), checkoutId],
    false,
  );
}
export function assertTrackingOperationReceipt(
  operation: TrackingOperation,
  source: Transaction,
  cartIdentity: string,
  scope: TrackingScope,
  paymentIds: string[] = [],
) {
  const cart = JSON.parse(operation.cartIdentity),
    ids = source.payments.map((p) => p.id),
    lineSources =
      cart.lineSources ||
      cart.items?.map((line: CartItem) => v3RetainedLineFingerprint(line));
  if (
    operation.cartIdentity !== cartIdentity ||
    operation.scopeKey !== trackingScopeKey(scope) ||
    source.id !== operation.transactionId ||
    source.trackingCheckoutId !== operation.checkoutId ||
    source.terminalId !== scope.terminalId ||
    (source.customerId || null) !== (cart.customerId || null) ||
    source.ncfType !== cart.fiscalType ||
    (cart.total !== undefined && source.total !== cart.total) ||
    (cart.serviceChargeAmount !== undefined &&
      Number(source.serviceChargeAmount || 0) !==
        Number(cart.serviceChargeAmount)) ||
    String(source.restaurantTableId || "") !== String(cart.tableId || "") ||
    String(source.restaurantOrderId || "") !== String(cart.accountId || "") ||
    !Array.isArray(lineSources) ||
    source.items.length !== lineSources.length ||
    source.items.some(
      (line, index) => v3RetainedLineFingerprint(line) !== lineSources[index],
    ) ||
    JSON.stringify([...operation.paymentIds].sort()) !==
      JSON.stringify([...ids].sort()) ||
    (paymentIds.length &&
      JSON.stringify([...paymentIds].sort()) !==
        JSON.stringify([...ids].sort()))
  )
    trackingFail("TRACKING_RECEIPT_RECONCILIATION_REQUIRED");
}
export async function assertTrackingOperationCommit(
  sql: SQL,
  checkoutId: string,
  source: Transaction,
) {
  const row = (
    await sql.query(
      "SELECT * FROM pos_tracking_operations_v1 WHERE checkout_id=?",
      [checkoutId],
    )
  ).values?.[0];
  if (!row) trackingFail("TRACKING_OPERATION_SOURCE_REQUIRED");
  const scopeArray = JSON.parse(row.scope_key),
    scope = Object.fromEntries(
      [
        "tenantId",
        "companyId",
        "storeId",
        "warehouseId",
        "terminalId",
        "deviceId",
      ].map((key, index) => [key, scopeArray[index]]),
    ) as TrackingScope;
  assertTrackingOperationReceipt(
    {
      checkoutId,
      transactionId: row.transaction_id,
      scopeKey: row.scope_key,
      cartIdentity: row.cart_identity,
      paymentIds: JSON.parse(row.payment_ids_json),
      phase: "EFFECT_POSSIBLE",
    },
    source,
    row.cart_identity,
    scope,
  );
}

export async function readCommittedTrackingReceipt(
  sql: SQL,
  operation: TrackingOperation,
): Promise<Transaction | null> {
  const phases =
    (
      await sql.query(
        "SELECT * FROM pos_tracking_checkout_v1 WHERE checkout_id=?",
        [operation.checkoutId],
      )
    ).values || [];
  if (!phases.length) trackingFail("TRACKING_OPERATION_SOURCE_REQUIRED");
  if (phases.every((row) => row.phase !== "CONSUMED")) return null;
  if (phases.some((row) => row.phase !== "CONSUMED"))
    trackingFail("TRACKING_RECEIPT_RECONCILIATION_REQUIRED");
  const documents =
    (
      await sql.query(
        "SELECT collection_name,data FROM documents WHERE collection_name IN('transactions','transactionHistory') AND doc_id=?",
        [operation.transactionId],
      )
    ).values || [];
  const history = documents.find(
      (row) => row.collection_name === "transactionHistory",
    ),
    active = documents.find((row) => row.collection_name === "transactions");
  if (!history) trackingFail("TRACKING_COMMITTED_RECEIPT_REQUIRED");
  const source = JSON.parse((active || history).data) as Transaction,
    retained = JSON.parse(history.data) as Transaction;
  if (
    (!active && !retained.zReportId) ||
    !source.v3CommitFingerprint ||
    source.v3CommitFingerprint !== retained.v3CommitFingerprint ||
    financialIdentity(source) !== financialIdentity(retained)
  )
    trackingFail("TRACKING_COMMITTED_RECEIPT_REQUIRED");
  await assertTrackingOperationCommit(sql, operation.checkoutId, source);
  const outbox =
    (
      await sql.query(
        "SELECT payload_json FROM sync_outbox_v2 WHERE aggregate_id=? AND event_type='SALE_POSTED'",
        [operation.transactionId],
      )
    ).values || [];
  if (
    outbox.length !== 1 ||
    financialIdentity(JSON.parse(outbox[0].payload_json).transaction) !==
      financialIdentity(source) ||
    phases.some(
      (row) =>
        row.selection_set_json !==
        JSON.stringify(source.items.flatMap((line) => line.trackingData || [])),
    )
  )
    trackingFail("TRACKING_COMMITTED_SOURCE_REQUIRED");
  return source;
}

export async function retireTrackingOperation(sql: SQL, checkoutId: string) {
  const row = (
    await sql.query(
      "SELECT payment_ids_json FROM pos_tracking_operations_v1 WHERE checkout_id=?",
      [checkoutId],
    )
  ).values?.[0];
  if (!row || JSON.parse(row.payment_ids_json).length)
    trackingFail("TRACKING_EFFECT_POSSIBLE_RECONCILIATION_REQUIRED");
  await sql.run(
    "UPDATE pos_tracking_operations_v1 SET state='RETIRED' WHERE checkout_id=?",
    [checkoutId],
    false,
  );
}
