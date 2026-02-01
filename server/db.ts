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

/**
 * Helper to get a collection (mimics lowdb .get().value())
 */
export const getCollection = (name: string): any[] => {
    try {
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
        if (tableExists) {
            const columns = db.prepare(`PRAGMA table_info(${name})`).all() as any[];
            const hasDataColumn = columns.some(c => c.name === 'data');

            if (hasDataColumn) {
                const rows = db.prepare(`SELECT data FROM ${name}`).all() as any[];
                return rows.map(r => JSON.parse(r.data));
            } else {
                const rows = db.prepare(`SELECT * FROM ${name}`).all() as any[];

                // Define JSON fields for each table
                const jsonFields: Record<string, string[]> = {
                    products: ['images', 'attributes', 'variants', 'tariffs', 'stockBalances', 'activeInWarehouses', 'appliedTaxIds', 'warehouseSettings', 'availableModifiers', 'operationalFlags'],
                    roles: ['permissions', 'zReportConfig'],
                    customers: ['tags', 'addresses'],
                    transactions: ['items', 'payments', 'customerSnapshot', 'relatedTransactions'],
                    receptions: ['items'],
                    users: [] // No JSON fields
                };

                // Boolean conversion for dedicated tables
                const booleanFields: Record<string, string[]> = {
                    roles: ['isSystem'],
                    warehouses: ['allowPosSale', 'allowNegativeStock', 'isMain'],
                    customers: ['requiresFiscalInvoice', 'prefersEmail', 'isTaxExempt', 'applyChainedTax'],
                    transactions: ['isTaxIncluded'],
                    products: ['hasActivePromotion'] // UI flag if present
                };

                const fieldsToParse = jsonFields[name] || [];
                const fieldsToConvert = booleanFields[name] || [];

                if (fieldsToParse.length > 0 || fieldsToConvert.length > 0) {
                    return rows.map(row => {
                        const newRow = { ...row };

                        // Parse JSON fields
                        fieldsToParse.forEach(field => {
                            if (field in newRow && typeof newRow[field] === 'string') {
                                try {
                                    newRow[field] = JSON.parse(newRow[field]);
                                } catch (e) {
                                    console.warn(`Failed to parse JSON for ${name}.${field} (id=${newRow.id}):`, e);
                                    newRow[field] = []; // Fallback
                                }
                            }
                        });

                        // Convert Booleans
                        fieldsToConvert.forEach(field => {
                            if (field in newRow) {
                                newRow[field] = newRow[field] === 1;
                            }
                        });

                        return newRow;
                    });
                }

                return rows;
            }
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

