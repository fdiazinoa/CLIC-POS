import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'db.sqlite');

// Initialize database
export const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL'); // Better concurrency

// Ensure sync change log exists (for versioned delta sync)
db.exec(`
    CREATE TABLE IF NOT EXISTS sync_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL,
        itemId TEXT NOT NULL,
        version INTEGER NOT NULL,
        op TEXT NOT NULL,
        payload TEXT,
        createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_changes_collection_version
    ON sync_changes(collection, version);

    CREATE TABLE IF NOT EXISTS inventory_discrepancies (
        id TEXT PRIMARY KEY,
        productId TEXT,
        warehouseId TEXT,
        terminalId TEXT,
        negativeAmount REAL,
        timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory_ledger (
        id TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL,
        warehouseId TEXT NOT NULL,
        productId TEXT NOT NULL,
        concept TEXT NOT NULL,
        documentRef TEXT,
        qtyIn REAL DEFAULT 0,
        qtyOut REAL DEFAULT 0,
        unitCost REAL DEFAULT 0,
        balanceQty REAL DEFAULT 0,
        balanceAvgCost REAL DEFAULT 0,
        terminalId TEXT,
        syncStatus TEXT DEFAULT 'PENDING',
        syncError TEXT,
        FOREIGN KEY (productId) REFERENCES products(id),
        FOREIGN KEY (warehouseId) REFERENCES warehouses(id)
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_product_warehouse ON inventory_ledger(productId, warehouseId);

    -- TRG_STRICT_WAREHOUSE_VALIDATION
    -- Prevents entries in the ledger if the product is not enabled (exists in product_stocks)
    -- This enforces the "Active Product in Warehouse" rule at the database level.
    CREATE TRIGGER IF NOT EXISTS trg_inventory_ledger_integrity
    BEFORE INSERT ON inventory_ledger
    FOR EACH ROW
    WHEN NOT EXISTS (SELECT 1 FROM product_stocks WHERE productId = NEW.productId AND warehouseId = NEW.warehouseId)
    BEGIN
        SELECT RAISE(ABORT, '🚫 INTEGRIDAD DE ALMACÉN: El artículo no está habilitado para operar en el almacén especificado.');
    END;

    -- Optimistic Locking columns
    -- Try/Catch is not possible in .exec(), so we use a safe approach or separate statements
    -- For better-sqlite3, we can just run these separately and ignore errors if column exists
`);

try {
    db.exec(`ALTER TABLE products ADD COLUMN version INTEGER DEFAULT 0`);
} catch (e) {
    // Column already exists
}
try {
    db.exec(`ALTER TABLE customers ADD COLUMN version INTEGER DEFAULT 0`);
} catch (e) {
    // Column already exists
}

/**
 * Helper to get a collection (mimics lowdb .get().value())
 */
export const getCollection = (name: string): any[] => {
    try {
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
        if (tableExists) {
            const columns = db.prepare(`PRAGMA table_info(${name})`).all() as any[];
            const hasDataColumn = columns.some(c => c.name === 'data');
            const rows = db.prepare(`SELECT * FROM ${name}`).all() as any[];

            // Define JSON fields for each table
            const jsonFields: Record<string, string[]> = {
                products: ['images', 'attributes', 'variants', 'tariffs', 'stockBalances', 'activeInWarehouses', 'appliedTaxIds', 'warehouseSettings', 'availableModifiers', 'operationalFlags', 'recipeDetails'],
                roles: ['permissions', 'zReportConfig'],
                customers: ['tags', 'addresses'],
                transactions: ['items', 'payments', 'customerSnapshot', 'relatedTransactions'],
                receptions: ['items'],
                z_reports: ['totalsByMethod', 'cashExpected', 'cashCounted', 'cashDiscrepancy', 'stats'],
                users: [], // No JSON fields
                transaction_history: ['items', 'payments', 'customerSnapshot', 'relatedTransactions'],
                rooms: ['data'],
                tables: ['data']
            };

            // Boolean conversion for dedicated tables
            const booleanFields: Record<string, string[]> = {
                roles: ['isSystem'],
                warehouses: ['allowPosSale', 'allowNegativeStock', 'isMain'],
                customers: ['requiresFiscalInvoice', 'prefersEmail', 'isTaxExempt', 'applyChainedTax'],
                transactions: ['isTaxIncluded'],
                transaction_history: ['isTaxIncluded'],
                products: ['hasActivePromotion', 'is_sellable'], // UI flag if present
                parametros_operativos: ['usa_mesas', 'bloqueo_meseros', 'pedir_comensales']
            };

            return rows.map(row => {
                const newRow = { ...row };
                const fieldsToParse = jsonFields[name] || [];

                // Always try to parse 'data' if it exists in schema but not in our explicit map
                if (hasDataColumn && !fieldsToParse.includes('data')) {
                    fieldsToParse.push('data');
                }

                // Parse JSON fields
                fieldsToParse.forEach(field => {
                    if (field in newRow && typeof newRow[field] === 'string' && newRow[field] !== null) {
                        try {
                            newRow[field] = JSON.parse(newRow[field]);
                        } catch (e) {
                            console.warn(`Failed to parse JSON for ${name}.${field} (id=${newRow.id}):`, e);
                            newRow[field] = null;
                        }
                    } else if (field in newRow && newRow[field] === null) {
                        newRow[field] = null;
                    }
                });

                // Flatten 'data' if it exists
                if (hasDataColumn && newRow.data && typeof newRow.data === 'object') {
                    const data = newRow.data;
                    delete newRow.data;
                    return { ...newRow, ...data };
                }

                // Convert Booleans
                const fieldsToConvert = booleanFields[name] || [];
                fieldsToConvert.forEach(field => {
                    if (field in newRow) {
                        // Special case: is_sellable defaults to true if NULL (legacy data support)
                        if (field === 'is_sellable' && (newRow[field] === null || newRow[field] === undefined)) {
                            newRow[field] = true;
                        } else {
                            newRow[field] = newRow[field] === 1;
                        }
                    }
                });

                return newRow;
            });
        } else {
            const setting = db.prepare("SELECT value FROM settings WHERE key=?").get(name) as any;
            return setting ? JSON.parse(setting.value) : [];
        }
    } catch (error) {
        console.error(`Error getting collection ${name}:`, error);
        return [];
    }
};

/**
 * Helper to get a single object (mimics lowdb .get().value() for objects)
 */
export const getSetting = (key: string): any => {
    try {
        const setting = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as any;
        return setting ? JSON.parse(setting.value) : null;
    } catch (error) {
        console.error(`Error getting setting ${key}:`, error);
        return null;
    }
};

/**
 * Helper to save/update a setting
 */
export const saveSetting = (key: string, value: any) => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
};
