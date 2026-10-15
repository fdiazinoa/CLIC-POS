import type SQLite from 'better-sqlite3';
export const legacyInventoryIndexSQL=`CREATE INDEX IF NOT EXISTS idx_documents_v3_inventory_baseline
 ON documents(json_extract(data, '$.v3InventoryBaseline'), json_extract(data, '$.productId'), json_extract(data, '$.warehouseId'))
 WHERE collection_name = 'inventoryLedger' AND json_extract(data, '$.v3InventoryBaseline') IS NOT NULL;`;
/** Real original prefix schema, never a cover-only fixture with its sole index removed. */
export function originalInventoryIndex(db:SQLite.Database){
 db.exec(legacyInventoryIndexSQL);
 db.exec('DROP INDEX IF EXISTS idx_documents_v3_inventory_delta_cover');
}
