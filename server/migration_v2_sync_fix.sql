-- migration_v2_sync_fix.sql
-- Goal: Convert 'receptions' to data-bag format and ensure 'transfers' exists as data-bag.

--1. Create a temporary table to store existing reception data
CREATE TABLE receptions_backup AS SELECT * FROM receptions;

-- 2. Drop the structured table
DROP TABLE receptions;

-- 3. Re-create 'receptions' as a data-bag table
CREATE TABLE IF NOT EXISTS receptions (
    id TEXT PRIMARY KEY,
    data TEXT -- JSON object
);

-- 4. Migrate data back
-- Map columns from old schema into new 'data' JSON string
INSERT INTO receptions (id, data)
SELECT 
    id,
    '{"id":"' || id || '"' ||
    ',"purchaseOrderId":' || COALESCE('"' || supplierId || '"', 'null') ||
    ',"date":"' || COALESCE(createdAt, id) || '"' ||
    ',"receivedBy":' || COALESCE('"' || supplierName || '"', '"sys"') ||
    ',"receivedByUserName":' || COALESCE('"' || supplierName || '"', '"System"') ||
    ',"items":' || COALESCE(items, '[]') ||
    ',"terminalId":' || COALESCE('"' || terminalId || '"', 'null') ||
    ',"syncStatus":' || COALESCE('"' || syncStatus || '"', '"PENDING"') ||
    ',"syncError":' || COALESCE('"' || syncError || '"', 'null') ||
    ',"updatedAt":"' || COALESCE(createdAt, datetime('now')) || '"' ||
    '}'
FROM receptions_backup;

-- 5. Cleanup
DROP TABLE receptions_backup;

-- 6. Ensure 'transfers' is also explicitly a data-bag
CREATE TABLE IF NOT EXISTS transfers (
    id TEXT PRIMARY KEY,
    data TEXT -- JSON object
);
