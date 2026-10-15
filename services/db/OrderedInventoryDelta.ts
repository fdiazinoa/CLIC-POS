/** Preserve original prefix-index rowid traversal before SQLite's floating SUM.
 * The covering expression index otherwise reorders same-item operands by delta. */
export function orderedInventoryDeltaInput(cover=true,item:'?'|'requested.item_id'='?'):string {
 return `SELECT COALESCE(json_extract(data, '$.qtyIn'), 0) - COALESCE(json_extract(data, '$.qtyOut'), 0) AS delta
  FROM documents${cover?' INDEXED BY idx_documents_v3_inventory_delta_cover':''}
  WHERE collection_name = 'inventoryLedger' AND json_extract(data, '$.v3InventoryBaseline') = ?
   AND json_extract(data, '$.productId') = ${item} AND json_extract(data, '$.warehouseId') = ?
  ORDER BY documents.rowid`;
}
/** Only historical isolated schemas can lack the index; SQL/planner/bridge/corruption errors must propagate. */
export function isMissingInventoryCoverIndex(error:unknown):boolean {
 return error instanceof Error&&/^no such index: idx_documents_v3_inventory_delta_cover$/.test(error.message);
}
