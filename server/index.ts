import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import walletRoutes from './routes/walletRoutes.js';
import passKitRoutes from './routes/passKitRoutes.js';
import emailRoutes from './routes/emailRoutes.js';
import syncRoutes from './routes/sync.js';
import supplierRoutes from './routes/supplierRoutes.js';
import currencyRoutes from './routes/currencies.js';
import maintenanceRoutes from './routes/maintenance.js'; // Restore missing import
import dgiiRoutes from './routes/dgiiRoutes.js'; // Import new route

import { db, getCollection, getSetting, saveSetting } from './db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Starting CLIC-POS SQLite Server...');

const server = express();
server.set('trust proxy', true);

server.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Sync-Token']
}));

server.use(express.json({ limit: '50mb' }));
server.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Global logger
server.use((req, res, next) => {
    console.log(`[Server] ${req.method} ${req.url} - IP: ${req.ip}`);
    next();
});

// Healthcheck
server.get('/api/status', (req, res) => {
    res.json({ status: 'ok', database: 'sqlite', timestamp: Date.now() });
});

// Root route
server.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'CLIC-POS Backend (SQLite)',
        version: '1.1.0',
        timestamp: new Date().toISOString()
    });
});

// Email config routes
server.get('/smtp/config', (req, res) => {
    const config = getSetting('emailConfig');
    res.json(config || {});
});

server.post('/smtp/config', (req, res) => {
    const config = req.body;
    if (!config.apiKey || !config.from) {
        return res.status(400).json({ success: false, message: 'Missing apiKey or from' });
    }
    saveSetting('emailConfig', config);
    res.json({ success: true, message: 'Configuration saved' });
});

// NEW: Z-Report Email Route
import { EmailService } from './services/emailService.js';
server.post('/smtp/z-report', async (req, res) => {
    const { to, reportData } = req.body;
    if (!to || !reportData) {
        return res.status(400).json({ success: false, message: 'Missing to or reportData' });
    }

    try {
        const emailService = new EmailService();
        await emailService.sendZReport(to, reportData);
        res.json({ success: true, message: 'Z-Report sent' });
    } catch (error: any) {
        console.error('❌ Error sending Z-Report email:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Custom Product Stocks Endpoint
server.get('/api/productStocks', (req, res) => {
    try {
        const stocks = getCollection('product_stocks');
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 500;
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;

        const paginatedStocks = stocks.slice(startIndex, endIndex);
        const safeStocks = paginatedStocks.map((s: any) => ({
            id: s.id,
            productId: s.productId,
            warehouseId: s.warehouseId,
            quantity: s.quantity || 0,
            updatedAt: s.updatedAt || new Date().toISOString()
        }));

        res.set('X-Total-Count', stocks.length.toString());
        res.json(safeStocks);
    } catch (error: any) {
        console.error('❌ Error fetching productStocks:', error);
        res.json([]);
    }
});

// Mount custom routes
server.use('/api/sync', syncRoutes);
server.use('/api/wallet', walletRoutes);
server.use('/v1', passKitRoutes);
server.use('/api/email', emailRoutes);
server.use('/api/suppliers', supplierRoutes);
server.use('/api/currencies', currencyRoutes);
server.use('/api/maintenance', maintenanceRoutes);
server.use('/api/dgii', dgiiRoutes); // Mount new route

// Helper to process json-server style queries
const processQuery = (data: any[], query: any) => {
    // Safety check: if data is not an array, return it as is (single object resource)
    if (!Array.isArray(data)) {
        return { result: data, totalCount: 1 };
    }

    let result = [...data];

    // 1. Full-text search (?q=...)
    if (query.q) {
        const q = String(query.q).toLowerCase();
        result = result.filter(item =>
            Object.values(item).some(val =>
                String(val).toLowerCase().includes(q)
            )
        );
    }

    // 2. Filtering (?field=value)
    Object.keys(query).forEach(key => {
        if (!['_page', '_limit', '_per_page', '_sort', '_order', 'q'].includes(key)) {
            const val = String(query[key]).toLowerCase();
            result = result.filter(item => String(item[key]).toLowerCase() === val);
        }
    });

    // 3. Sorting (?_sort=field&_order=asc|desc)
    if (query._sort) {
        const sortField = query._sort as string;
        const order = (query._order as string || 'asc').toLowerCase();

        result.sort((a, b) => {
            const valA = a[sortField];
            const valB = b[sortField];

            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });
    }

    // 4. Pagination (?_page=N&_limit=M)
    const page = parseInt(query._page as string) || 1;
    const limit = parseInt(query._limit as string || query._per_page as string) || null;

    const totalCount = result.length;

    if (limit) {
        const start = (page - 1) * limit;
        result = result.slice(start, start + limit);
    }

    return { result, totalCount };
};

// Helper to map API collection names to DB table names
const mapCollectionName = (name: string): string => {
    const mapping: Record<string, string> = {
        'purchaseOrders': 'purchase_orders',
        'inventoryLedger': 'inventory_ledger',
        'productStocks': 'product_stocks',
        'cashMovements': 'cash_movements',
        'zReports': 'z_reports',
        'wallets': 'wallets',
        'walletTransactions': 'wallet_transactions',
        'connectedTerminals': 'connected_terminals',
        'syncTokens': 'sync_tokens',
        'transactionHistory': 'transaction_history'
    };
    return mapping[name] || name;
};

// Generic CRUD API for all other collections
server.get('/api/:collection', (req, res) => {
    const { collection } = req.params;
    const dbName = mapCollectionName(collection);
    const data = getCollection(dbName);

    const { result, totalCount } = processQuery(data, req.query);

    res.set('X-Total-Count', totalCount.toString());
    res.set('Access-Control-Expose-Headers', 'X-Total-Count');
    res.json(result);
});

server.get('/api/:collection/:id', (req, res) => {
    const { collection, id } = req.params;
    const dbName = mapCollectionName(collection);
    const data = getCollection(dbName);
    const item = data.find((i: any) => i.id === id);
    if (item) res.json(item);
    else res.status(404).json({ error: 'Not found' });
});

// Generic POST (Create)
server.post('/api/:collection', (req, res) => {
    const { collection } = req.params;
    const dbName = mapCollectionName(collection);
    const item = req.body;

    if (!item.id) {
        item.id = `${collection.substring(0, 3).toUpperCase()}-${Date.now()}`;
    }

    try {
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(dbName);

        if (tableExists) {
            const columns = db.prepare(`PRAGMA table_info(${dbName})`).all() as any[];
            const hasDataColumn = columns.some(c => c.name === 'data');

            if (hasDataColumn) {
                db.prepare(`INSERT INTO ${dbName} (id, data) VALUES (?, ?)`).run(item.id, JSON.stringify(item));
            } else {
                // Structured table
                const colNames = columns.map(c => c.name);
                const placeholders = colNames.map(() => '?').join(',');

                // Filter item keys to match columns
                const values = colNames.map(col => {
                    const val = item[col];
                    if (typeof val === 'object') return JSON.stringify(val);
                    if (typeof val === 'boolean') return val ? 1 : 0;
                    return val;
                });

                db.prepare(`INSERT INTO ${dbName} (${colNames.join(',')}) VALUES (${placeholders})`).run(...values);
            }
        } else {
            // Fallback to settings for non-table collections
            const current = getSetting(dbName);
            if (Array.isArray(current)) {
                current.push(item);
                saveSetting(dbName, current);
            } else {
                // If it's not an array, it's a singleton (like config)
                // We should probably replace it or return error. 
                // Given the context, replacing it is safer for "save" operations.
                saveSetting(dbName, item);
            }
        }

        res.status(201).json(item);
    } catch (error: any) {
        console.error(`❌ Error creating item in ${dbName}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Generic PUT for single-object collections (e.g., /api/config)
server.put('/api/:collection', (req, res) => {
    const { collection } = req.params;
    const dbName = mapCollectionName(collection);
    const data = req.body;

    try {
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(dbName);

        if (tableExists) {
            return res.status(400).json({ error: 'Collection is a table, ID required' });
        }

        saveSetting(dbName, data);
        res.json(data);
    } catch (error: any) {
        console.error(`❌ Error updating setting ${dbName}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Generic PUT (Update)
server.put('/api/:collection/:id', (req, res) => {
    const { collection, id } = req.params;
    const dbName = mapCollectionName(collection);
    const item = req.body;

    try {
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(dbName);

        if (tableExists) {
            const columns = db.prepare(`PRAGMA table_info(${dbName})`).all() as any[];
            const hasDataColumn = columns.some(c => c.name === 'data');

            if (hasDataColumn) {
                db.prepare(`UPDATE ${dbName} SET data = ? WHERE id = ?`).run(JSON.stringify(item), id);
            } else {
                // Structured table
                const colNames = columns.map(c => c.name).filter(c => c !== 'id'); // Don't update ID
                const setClause = colNames.map(c => `${c} = ?`).join(',');

                const values = colNames.map(col => {
                    const val = item[col];
                    if (val === undefined) return null; // FIX: Better-sqlite3 throws on undefined
                    if (typeof val === 'object' && val !== null) return JSON.stringify(val);
                    if (typeof val === 'boolean') return val ? 1 : 0;
                    return val;
                });

                db.prepare(`UPDATE ${dbName} SET ${setClause} WHERE id = ?`).run(...values, id);
            }
        } else {
            const current = getSetting(dbName) || [];
            const index = current.findIndex((i: any) => i.id === id);
            if (index !== -1) {
                current[index] = { ...current[index], ...item };
                saveSetting(dbName, current);
            } else {
                return res.status(404).json({ error: 'Not found' });
            }
        }

        res.json(item);
    } catch (error: any) {
        console.error(`❌ Error updating item in ${dbName}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Generic DELETE
server.delete('/api/:collection/:id', (req, res) => {
    const { collection, id } = req.params;
    const dbName = mapCollectionName(collection);

    try {
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(dbName);

        if (tableExists) {
            db.prepare(`DELETE FROM ${dbName} WHERE id = ?`).run(id);
        } else {
            const current = getSetting(dbName) || [];
            const filtered = current.filter((i: any) => i.id !== id);
            saveSetting(dbName, filtered);
        }

        res.json({ success: true });
    } catch (error: any) {
        console.error(`❌ Error deleting item in ${dbName}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Generic DELETE Collection (Clear)
server.delete('/api/:collection', (req, res) => {
    const { collection } = req.params;
    const dbName = mapCollectionName(collection);

    try {
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(dbName);

        if (tableExists) {
            db.prepare(`DELETE FROM ${dbName}`).run();
        } else {
            saveSetting(dbName, []);
        }

        res.json({ success: true, message: `Collection ${dbName} cleared` });
    } catch (error: any) {
        console.error(`❌ Error clearing collection ${dbName}:`, error);
        res.status(500).json({ error: error.message });
    }
});


// Global Error Handler
server.use((err: any, req: any, res: any, next: any) => {
    console.error('❌ Global Server Error:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error', error: err.message });
});

const PORT = 3001;
const HOST = '0.0.0.0';
const appInstance = server.listen(PORT, HOST, () => {
    console.log(`🚀 SQLite Server is running on http://${HOST}:${PORT}`);
});

appInstance.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use.`);
    } else {
        console.error('❌ Server startup error:', e);
    }
});

// Helper to auto-migrate transaction_history if missing
const ensureTransactionHistoryTable = () => {
    try {
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transaction_history'").get();
        if (!tableExists) {
            console.log('📦 Migrating transaction_history table...');
            db.prepare(`
                CREATE TABLE IF NOT EXISTS transaction_history (
                    id TEXT PRIMARY KEY,
                    globalSequence INTEGER,
                    displayId TEXT,
                    documentType TEXT,
                    seriesId TEXT,
                    seriesNumber INTEGER,
                    date TEXT NOT NULL,
                    items TEXT NOT NULL, -- JSON array
                    total REAL NOT NULL,
                    payments TEXT, -- JSON array
                    userId TEXT,
                    userName TEXT,
                    terminalId TEXT,
                    status TEXT,
                    customerId TEXT,
                    customerName TEXT,
                    customerSnapshot TEXT, -- JSON object
                    taxAmount REAL DEFAULT 0,
                    netAmount REAL DEFAULT 0,
                    discountAmount REAL DEFAULT 0,
                    isTaxIncluded INTEGER DEFAULT 0,
                    ncf TEXT,
                    ncfType TEXT,
                    relatedTransactions TEXT, -- JSON array
                    originalTransactionId TEXT,
                    refundReason TEXT,
                    affectedInvoiceNumber TEXT,
                    affectedNCF TEXT,
                    syncStatus TEXT DEFAULT 'PENDING',
                    syncError TEXT,
                    zReportId TEXT
                );
            `).run();
            db.prepare("CREATE INDEX IF NOT EXISTS idx_transaction_history_zreport ON transaction_history(zReportId)").run();
            console.log('✅ transaction_history table created.');
        }
    } catch (error) {
        console.error('❌ Failed to ensure transaction_history table:', error);
    }
}

// Run migration on startup
ensureTransactionHistoryTable();
