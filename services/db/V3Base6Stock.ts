import { Money } from "../articleFormats/wire";
type Query = <T>(
  sql: string,
  values: (string | number | null)[],
) => Promise<T[]>;
export function base6(value: unknown): InstanceType<typeof Money> {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw Error("TRACKING_BASE_PRECISION_INVALID");
  const exact = new Money(String(value));
  if (exact.dp() > 6 || exact.abs().times(1000000).gt(Number.MAX_SAFE_INTEGER))
    throw Error("TRACKING_BASE_PRECISION_INVALID");
  return exact;
}
/** Tracking has six-decimal physical base units. Every source operand is checked
 * before integer scaling, and the aggregate must remain within safe bounds. */
export async function readV3Base6Stock(
  query: Query,
  baseline: string,
  itemId: string,
  warehouseId: string,
) {
  const baselineRows = await query<any>(
    "SELECT qty_on_hand,qty_reserved,qty_committed FROM master_v3_inventory_balances WHERE item_id=? AND warehouse_id=?",
    [itemId, warehouseId],
  );
  if (baselineRows.length !== 1)
    throw Error("TRACKING_STOCK_BASELINE_REQUIRED");
  const stored = baselineRows[0],
    onHand = base6(stored.qty_on_hand),
    reserved = base6(stored.qty_reserved),
    committed = base6(stored.qty_committed);
  const qtyIn = "COALESCE(json_extract(data,'$.qtyIn'),0)",
    qtyOut = "COALESCE(json_extract(data,'$.qtyOut'),0)";
  const valid = (field: string, path: string) =>
    `(COALESCE(json_type(data,'$.${path}'),'null') IN ('integer','real','null') AND ${field}>=0 AND ${field}<=9007199254.740991 AND ${field}=ROUND(${field},6))`;
  const predicate = `${valid(qtyIn, "qtyIn")} AND ${valid(qtyOut, "qtyOut")}`;
  const rows = await query<any>(
    `SELECT COALESCE(MAX(CASE WHEN ${predicate} THEN 0 ELSE 1 END),0) invalid_operand,COALESCE(SUM(CASE WHEN ${predicate} THEN CAST(ROUND(${qtyIn}*1000000) AS INTEGER)-CAST(ROUND(${qtyOut}*1000000) AS INTEGER) ELSE 0 END),0) delta_minor FROM documents WHERE collection_name='inventoryLedger' AND json_extract(data,'$.v3InventoryBaseline')=? AND json_extract(data,'$.productId')=? AND json_extract(data,'$.warehouseId')=?`,
    [baseline, itemId, warehouseId],
  );
  const delta = rows[0];
  if (
    !delta ||
    delta.invalid_operand !== 0 ||
    !Number.isSafeInteger(delta.delta_minor)
  )
    throw Error("TRACKING_BASE_PRECISION_INVALID");
  const physical = onHand.plus(new Money(delta.delta_minor).div(1000000));
  if (physical.abs().times(1000000).gt(Number.MAX_SAFE_INTEGER))
    throw Error("TRACKING_BASE_PRECISION_INVALID");
  return {
    physical,
    reserved,
    committed,
    available: physical.minus(reserved).minus(committed),
  };
}
