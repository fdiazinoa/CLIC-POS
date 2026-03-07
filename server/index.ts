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
import bulkRoutes from './routes/bulkRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import cloudRegistryRoutes from './routes/cloudRegistry.js';
import os from 'os';
import { createServer } from 'http';
import { initSocket } from './socket.js';

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

// NEW: Network info for diagnostics
server.get('/api/network', (req, res) => {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];
    for (const k in interfaces) {
        for (const k2 in interfaces[k]!) {
            const address = interfaces[k]![k2];
            if (address.family === 'IPv4' && !address.internal) {
                addresses.push(address.address);
            }
        }
    }
    res.json({ addresses });
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
server.use('/api/cloud/master-endpoint', cloudRegistryRoutes);
server.use('/api/wallet', walletRoutes);
server.use('/v1', passKitRoutes);
server.use('/api/email', emailRoutes);
server.use('/api/suppliers', supplierRoutes);
server.use('/api/currencies', currencyRoutes);
server.use('/api/maintenance', maintenanceRoutes);
server.use('/api/dgii', dgiiRoutes);
server.use('/api/bulk', bulkRoutes);
server.use('/api/audit', auditRoutes);

// --- Mesas & Salas Endpoints ---
server.get('/api/mesas', (req, res) => {
    const { terminal_id } = req.query;
    try {
        let rooms;
        if (terminal_id) {
            // Filter by terminal visibility
            const hasVisibilityConfig = db.prepare("SELECT 1 FROM terminals_rooms_visibility WHERE terminal_id = ?").get(terminal_id);
            if (hasVisibilityConfig) {
                rooms = db.prepare(`
                    SELECT r.* FROM rooms r
                    JOIN terminals_rooms_visibility v ON r.id = v.room_id
                    WHERE v.terminal_id = ?
                    ORDER BY r.orden ASC
                `).all(terminal_id);
            } else {
                rooms = db.prepare("SELECT * FROM rooms ORDER BY orden ASC").all();
            }
        } else {
            rooms = db.prepare("SELECT * FROM rooms ORDER BY orden ASC").all();
        }

        const tables = db.prepare("SELECT * FROM tables").all();

        // Format for frontend (parse JSON 'data' field)
        const formattedRooms = rooms.map((r: any) => ({
            ...r,
            name: (typeof r.name === 'string' && r.name.trim()) || (typeof r.nombre === 'string' && r.nombre.trim()) || 'Sala',
            nombre: (typeof r.name === 'string' && r.name.trim()) || (typeof r.nombre === 'string' && r.nombre.trim()) || 'Sala',
            data: r.data ? JSON.parse(r.data) : {}
        }));

        const formattedTables = tables.map((t: any) => ({
            ...t,
            data: t.data ? JSON.parse(t.data) : {}
        }));

        res.json({ rooms: formattedRooms, tables: formattedTables });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Mover mesa
server.post('/api/mesas/mover', (req, res) => {
    const { fromTableId, toTableId } = req.body;
    try {
        const moveTransaction = db.transaction(() => {
            const fromTable = db.prepare("SELECT * FROM tables WHERE id = ?").get(fromTableId) as any;
            const toTable = db.prepare("SELECT * FROM tables WHERE id = ?").get(toTableId) as any;

            if (!fromTable || !toTable) throw new Error("Table not found");
            if (fromTable.status !== 'OCCUPIED') throw new Error("Origin table is not occupied");
            if (toTable.status !== 'FREE') throw new Error("Destination table is not free");

            // Update Destination
            db.prepare(`
                UPDATE tables 
                SET status = 'OCCUPIED', 
                    currentOrderId = ?, 
                    currentOrderTotal = ?, 
                    timeSeated = ?,
                    waiterName = ?
                WHERE id = ?
            `).run(fromTable.currentOrderId, fromTable.currentOrderTotal, fromTable.timeSeated, fromTable.waiterName, toTableId);

            // Clear Origin
            db.prepare(`
                UPDATE tables 
                SET status = 'FREE', 
                    currentOrderId = NULL, 
                    currentOrderTotal = NULL, 
                    timeSeated = NULL, 
                    waiterName = NULL 
                WHERE id = ?
            `).run(fromTableId);
        });

        moveTransaction();
        res.json({ success: true, message: 'Table moved successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Abrir mesa (Create/Open Order)
server.post('/api/mesas/abrir', (req, res) => {
    const { tableId, waiterId, waiterName } = req.body || {};
    if (!tableId) {
        return res.status(400).json({ status: 'error', message: 'tableId is required' });
    }

    try {
        const now = new Date().toISOString();
        const openTableTx = db.transaction(() => {
            const table = db.prepare("SELECT id, currentOrderId FROM tables WHERE id = ?").get(tableId) as any;
            if (!table) throw new Error("Table not found");

            // If table already has an active order, return it.
            if (table.currentOrderId) {
                return { status: 'success', orden_id: table.currentOrderId };
            }

            const orderId = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
            db.prepare(`
                INSERT INTO transactions (id, status, date, items, total, userId, userName)
                VALUES (?, 'ABIERTA', ?, '[]', 0, ?, ?)
            `).run(orderId, now, waiterId || null, waiterName || 'Mesero');

            db.prepare(`
                UPDATE tables
                SET currentOrderId = ?,
                    status = 'OCCUPIED',
                    currentOrderTotal = 0,
                    timeSeated = ?,
                    waiterName = ?,
                    waiterId = ?
                WHERE id = ?
            `).run(orderId, now, waiterName || null, waiterId || null, tableId);

            return { status: 'success', orden_id: orderId };
        });

        const result = openTableTx();
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});


// Custom GET /api/tables implementation for Dynamic Status (LEFT JOIN)
server.get('/api/tables', (req, res) => {
    try {
        // 1. Get Parked Tickets (simulated 'orders' table)
        // We use a CTE or complex query to join JSON data from settings
        // Note: In a real SQL environment, 'orders' would be a table. Here 'parkedTickets' is a JSON blob in settings.

        const allTables = db.prepare(`SELECT * FROM tables`).all() as any[];
        const parkedTicketsBlob = db.prepare(`SELECT value FROM settings WHERE key = 'parkedTickets'`).get() as any;
        const parkedTickets = parkedTicketsBlob ? JSON.parse(parkedTicketsBlob.value) : [];

        // We manually join because SQLite JSON support varies by version/compilation and simple array join is efficient enough for cache

        // Map to requested structure
        const enrichedTables = allTables.map(t => {
            // Parse internal data if it exists
            const data = t.data ? (typeof t.data === 'string' ? JSON.parse(t.data) : t.data) : {};

            // Dynamic Status Lookup
            // User Request: LEFT JOIN with orders where status='OPEN'
            const associatedOrder = parkedTickets.find((p: any) => p.id === t.currentOrderId);

            const dynamicStatus = associatedOrder ? 'OCCUPIED' : 'FREE';

            // Calculate total from order items if available, or fallback to stored total
            const total = associatedOrder
                ? (typeof associatedOrder.total === 'number'
                    ? associatedOrder.total
                    : associatedOrder.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0))
                : 0;

            return {
                ...t,
                data,
                // Derived fields overriding static ones
                status: dynamicStatus,
                currentOrderTotal: total, // Real-time calculation from ticket
                orden_activa_id: t.currentOrderId, // Alias requested
                total_actual: total, // Alias requested
                mesero_nombre: t.waiterName // Alias requested
            };
        });

        res.json(enrichedTables);
    } catch (error: any) {
        console.error("Error fetching tables:", error);
        res.status(500).json({ error: error.message });
    }
});

// Generic Table Update (for POS status updates) handled by generic /api/:collection/:id

server.post('/api/mesas/unir', (req, res) => {
    const { mainTableId, secondaryTableIds } = req.body;
    // Stub
    try {
        res.json({ success: true, message: 'Tables joined successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Liberar mesa (Clear Order)
server.post('/api/mesas/liberar', (req, res) => {
    const { tableId } = req.body;
    try {
        db.prepare(`
            UPDATE tables 
            SET status = 'FREE', 
                currentOrderId = NULL, 
                currentOrderTotal = 0, 
                timeSeated = NULL, 
                waiterName = NULL,
                waiterId = NULL
            WHERE id = ?
        `).run(tableId);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

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

    let data;
    if (collection === 'rooms' && req.query.terminal_id) {
        try {
            const terminalId = req.query.terminal_id;
            const hasVisibilityConfig = db.prepare("SELECT 1 FROM terminals_rooms_visibility WHERE terminal_id = ?").get(terminalId);

            let rooms;
            if (hasVisibilityConfig) {
                rooms = db.prepare(`
                    SELECT r.* FROM rooms r
                    JOIN terminals_rooms_visibility v ON r.id = v.room_id
                    WHERE v.terminal_id = ?
                    ORDER BY r.orden ASC
                `).all(terminalId);
            } else {
                rooms = db.prepare("SELECT * FROM rooms ORDER BY orden ASC").all();
            }

            data = rooms.map((r: any) => ({
                ...r,
                name: (typeof r.name === 'string' && r.name.trim()) || (typeof r.nombre === 'string' && r.nombre.trim()) || 'Sala',
                nombre: (typeof r.name === 'string' && r.name.trim()) || (typeof r.nombre === 'string' && r.nombre.trim()) || 'Sala',
                data: r.data ? JSON.parse(r.data) : {}
            }));
        } catch (error) {
            console.error('Error fetching filtered rooms:', error);
            data = getCollection(dbName);
        }
    } else {
        data = getCollection(dbName);
    }
    try {
        const { result, totalCount } = processQuery(data, req.query);

        if (Array.isArray(data)) {
            res.set('X-Total-Count', totalCount.toString());
            res.set('Access-Control-Expose-Headers', 'X-Total-Count');
            res.json(result);
        } else {
            // Singleton: Return directly
            res.json(data);
        }
    } catch (error: any) {
        console.error(`Error processing /api/${collection}:`, error);
        // Log to file for debugging
        import('fs').then(fs => {
            fs.appendFileSync('server/custom_error.log', `[${new Date().toISOString()}] Error in /api/${collection}: ${error.stack}\n`);
        });
        res.status(500).json({ error: error.message });
    }
});

server.get('/api/:collection/:id', (req, res) => {
    const { collection, id } = req.params;
    const dbName = mapCollectionName(collection);
    const data = getCollection(dbName);
    const item = data.find((i: any) => i.id === id);
    if (item) res.json(item);
    else res.status(404).json({ error: 'Not found' });
});

// --- Sync Helpers (Extracted) ---
const getSyncVersionKey = (collection: string) => `sync_version_${collection}`;

const getCurrentVersion = (collection: string): number => {
    const v = getSetting(getSyncVersionKey(collection));
    if (typeof v === 'number') return v;
    return 0;
};

const bumpVersion = (collection: string, itemId?: string): number => {
    const next = getCurrentVersion(collection) + 1;
    saveSetting(getSyncVersionKey(collection), next);

    // Aditive update for tables with version column
    if (itemId && (collection === 'products' || collection === 'customers')) {
        const dbName = mapCollectionName(collection);
        try {
            const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(dbName);
            if (tableExists) {
                db.prepare(`UPDATE ${dbName} SET version = version + 1 WHERE id = ?`).run(itemId);
            }
        } catch (e) {
            console.warn(`[Sync] Could not update version col for ${collection}:${itemId}`, e);
        }
    }
    return next;
};

const logChange = (collection: string, itemId: string, op: 'UPSERT' | 'DELETE', payload: any) => {
    const version = bumpVersion(collection, itemId);
    try {
        db.prepare(`
            INSERT INTO sync_changes (collection, itemId, version, op, payload, createdAt)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(collection, itemId, version, op, JSON.stringify(payload), new Date().toISOString());

        // Update Metadata
        const syncMetadata = getSetting('syncMetadata') || {};
        syncMetadata[collection] = {
            version,
            lastUpdated: new Date().toISOString(),
            itemCount: 0, // We don't recalculate count on every write for perf
            fullSyncVersion: syncMetadata[collection]?.fullSyncVersion || 0
        };
        saveSetting('syncMetadata', syncMetadata);

    } catch (e) {
        console.error(`❌ Failed to log sync change for ${collection}:${itemId}`, e);
    }
};

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
            const colNames = columns.map(c => c.name);
            const placeholders = colNames.map(() => '?').join(',');

            const values = colNames.map(col => {
                if (col === 'data') {
                    return JSON.stringify(item);
                }
                const val = item[col];
                if (typeof val === 'object' && val !== null) return JSON.stringify(val);
                if (typeof val === 'boolean') return val ? 1 : 0;
                return val !== undefined ? val : null;
            });

            db.prepare(`INSERT INTO ${dbName} (${colNames.join(',')}) VALUES (${placeholders})`).run(...values);
        } else {
            const current = getSetting(dbName);
            if (Array.isArray(current)) {
                current.push(item);
                saveSetting(dbName, current);
            } else {
                saveSetting(dbName, item);
            }
        }

        // SYNC LOGGING
        logChange(collection, item.id, 'UPSERT', item);

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

        // SYNC LOGGING (Singleton uses 'singleton' as ID)
        logChange(collection, 'singleton', 'UPSERT', data);

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
            const colNames = columns.map(c => c.name).filter(c => c !== 'id');
            const sets = colNames.map(c => `${c} = ?`).join(',');

            const values = colNames.map(col => {
                if (col === 'data') return JSON.stringify(item);
                const val = item[col];
                if (typeof val === 'object' && val !== null) return JSON.stringify(val);
                if (typeof val === 'boolean') return val ? 1 : 0;
                return val !== undefined ? val : null;
            });

            const result = db.prepare(`UPDATE ${dbName} SET ${sets} WHERE id = ?`).run(...values, id);

            if (result.changes === 0) {
                // Upsert behavior
                const allCols = db.prepare(`PRAGMA table_info(${dbName})`).all() as any[];
                const allColNames = allCols.map(c => c.name);
                const placeholders = allColNames.map(() => '?').join(',');

                const insertValues = allColNames.map(col => {
                    if (col === 'data') return JSON.stringify(item);
                    const val = item[col];
                    if (typeof val === 'object' && val !== null) return JSON.stringify(val);
                    if (typeof val === 'boolean') return val ? 1 : 0;
                    return val !== undefined ? val : null;
                });

                db.prepare(`INSERT INTO ${dbName} (${allColNames.join(',')}) VALUES (${placeholders})`).run(...insertValues);
            }
        } else {
            const current = getSetting(dbName) || [];
            const index = current.findIndex((i: any) => i.id === id);
            if (index !== -1) {
                current[index] = { ...current[index], ...item };
                saveSetting(dbName, current);
            } else {
                current.push(item);
                saveSetting(dbName, current);
            }
        }

        // SYNC LOGGING
        logChange(collection, id, 'UPSERT', item);

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

        // SYNC LOGGING
        logChange(collection, id, 'DELETE', { deletedAt: new Date().toISOString() });

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

// Server Configuration
const CLOUD_MODE = process.env.CLOUD_MODE === 'true';
const PORT = parseInt(process.env.PORT || '3001');
const HOST = process.env.HOST || '0.0.0.0';

// Start server based on mode
if (CLOUD_MODE) {
    console.log('🔒 Starting in CLOUD MODE (HTTPS)...');

    import('https').then(https => {
        import('fs').then(fs => {
            const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
            const SSL_CERT_PATH = process.env.SSL_CERT_PATH;

            if (!SSL_KEY_PATH || !SSL_CERT_PATH) {
                console.error('❌ CLOUD_MODE requires SSL_KEY_PATH and SSL_CERT_PATH in .env');
                process.exit(1);
            }

            const httpsOptions = {
                key: fs.readFileSync(SSL_KEY_PATH),
                cert: fs.readFileSync(SSL_CERT_PATH)
            };

            const appInstance = https.createServer(httpsOptions, server).listen(PORT, HOST, () => {
                console.log(`🔒 Cloud Server (HTTPS) running on https://${HOST}:${PORT}`);
            });

            appInstance.on('error', (e: any) => {
                if (e.code === 'EADDRINUSE') {
                    console.error(`❌ Port ${PORT} is already in use.`);
                } else {
                    console.error('❌ Server startup error:', e);
                }
            });
        });
    });
} else {
    console.log('🚀 Starting in LOCAL MODE (HTTP)...');

    const httpServer = createServer(server);
    initSocket(httpServer);

    httpServer.listen(PORT, '0.0.0.0', () => {
        const interfaces = os.networkInterfaces();
        let lanIp = 'UNKNOWN';

        // Detect LAN IP
        for (const k in interfaces) {
            for (const k2 in interfaces[k]!) {
                const address = interfaces[k]![k2];
                if (address.family === 'IPv4' && !address.internal) {
                    lanIp = address.address;
                    break;
                }
            }
            if (lanIp !== 'UNKNOWN') break;
        }

        console.log('\n');
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║               🚀 CLIC-POS MASTER SERVER READY              ║');
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log(`║  🔌 Port:         ${PORT}                                     ║`);
        console.log(`║  🖥️  Local Access: http://localhost:${PORT}                    ║`);
        console.log(`║  🌐 Network Access: http://${lanIp}:${PORT}                 ║`);
        console.log('╚════════════════════════════════════════════════════════════╝');
        console.log('\n');
        console.log(`💡 Slaves should connect to: http://${lanIp}:${PORT}`);
    });

    httpServer.on('error', (e: any) => {
        if (e.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} is already in use.`);
        } else {
            console.error('❌ Server startup error:', e);
        }
    });
}

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

const ensureOperationalConfigTable = () => {
    try {
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='parametros_operativos'").get();
        if (!tableExists) {
            console.log('📦 Migrating operational configuration...');
            db.prepare(`
                CREATE TABLE IF NOT EXISTS parametros_operativos (
                    id TEXT PRIMARY KEY,
                    vertical_negocio TEXT DEFAULT 'RETAIL',
                    usa_mesas INTEGER DEFAULT 0,
                    pantalla_inicio TEXT DEFAULT 'VENTA_DIRECTA',
                    bloqueo_meseros INTEGER DEFAULT 0,
                    pedir_comensales INTEGER DEFAULT 1
                );
            `).run();

            // Insert default row
            db.prepare(`
                INSERT INTO parametros_operativos (id, vertical_negocio, usa_mesas, pantalla_inicio, bloqueo_meseros, pedir_comensales)
                VALUES ('DEFAULT', 'RETAIL', 0, 'VENTA_DIRECTA', 0, 1);
            `).run();
            console.log('✅ operational configuration table created.');
        }
    } catch (error) {
        console.error('❌ Failed to ensure operational config table:', error);
    }
}

const ensureFloorPlanTables = () => {
    try {
        const roomsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rooms'").get();
        if (!roomsExists) {
            console.log('📦 Migrating rooms and tables...');
            db.prepare(`
                CREATE TABLE IF NOT EXISTS rooms (
                    id TEXT PRIMARY KEY,
                    nombre TEXT NOT NULL,
                    consumo_minimo REAL DEFAULT 0,
                    capacidad_personas INTEGER DEFAULT 0,
                    cargo_servicio_pct REAL DEFAULT 0,
                    orden INTEGER DEFAULT 0,
                    data TEXT
                );
            `).run();
            db.prepare(`
                CREATE TABLE IF NOT EXISTS tables (
                    id TEXT PRIMARY KEY,
                    roomId TEXT NOT NULL,
                    nombre TEXT NOT NULL,
                    status TEXT DEFAULT 'FREE',
                    consumo_minimo_mesa REAL DEFAULT 0,
                    comensales_minimos INTEGER DEFAULT 1,
                    data TEXT,
                    FOREIGN KEY (roomId) REFERENCES rooms(id)
                );
            `).run();
            db.prepare(`
                CREATE TABLE IF NOT EXISTS terminals_rooms_visibility (
                    terminal_id TEXT NOT NULL,
                    room_id TEXT NOT NULL,
                    PRIMARY KEY (terminal_id, room_id),
                    FOREIGN KEY (room_id) REFERENCES rooms(id)
                );
            `).run();
            console.log('✅ Rooms and Tables created.');
        } else {
            // Schema check/migration for existing tables
            const columns = db.prepare("PRAGMA table_info(rooms)").all() as any[];
            const hasNombre = columns.some(c => c.name === 'nombre');
            const hasConsumo = columns.some(c => c.name === 'consumo_minimo');


            // Check for missing layout columns in 'tables'
            const tableColumns = db.prepare("PRAGMA table_info(tables)").all() as any[];
            const hasPosX = tableColumns.some(c => c.name === 'posX');

            if (!hasPosX) {
                console.log('📦 Migrating tables: Adding layout columns...');
                try {
                    db.prepare("ALTER TABLE tables ADD COLUMN posX REAL DEFAULT 0").run();
                    db.prepare("ALTER TABLE tables ADD COLUMN posY REAL DEFAULT 0").run();
                    db.prepare("ALTER TABLE tables ADD COLUMN width REAL DEFAULT 80").run();
                    db.prepare("ALTER TABLE tables ADD COLUMN height REAL DEFAULT 80").run();
                    db.prepare("ALTER TABLE tables ADD COLUMN shape TEXT DEFAULT 'SQUARE'").run();
                    db.prepare("ALTER TABLE tables ADD COLUMN rotation REAL DEFAULT 0").run();
                    console.log('✅ Tables layout columns added.');
                } catch (e) {
                    console.error('❌ Failed to add layout columns to tables:', e);
                }
            }

            if (!hasNombre) {
                console.log('📦 Migrating rooms: Adding new columns and renaming name->nombre...');
                // SQLite doesn't support renaming and adding col in one go easily if we want to preserve data
                // but here we can just add the missing ones.
                db.prepare("ALTER TABLE rooms ADD COLUMN nombre TEXT NOT NULL DEFAULT 'Sala'").run();
                db.prepare("UPDATE rooms SET nombre = name WHERE name IS NOT NULL").run();
                // We'll keep 'name' for compatibility if needed, but 'nombre' is preferred now.
            }
            if (!hasConsumo) {
                db.prepare("ALTER TABLE rooms ADD COLUMN consumo_minimo REAL DEFAULT 0").run();
                db.prepare("ALTER TABLE rooms ADD COLUMN capacidad_personas INTEGER DEFAULT 0").run();
                db.prepare("ALTER TABLE rooms ADD COLUMN cargo_servicio_pct REAL DEFAULT 0").run();
                db.prepare("ALTER TABLE rooms ADD COLUMN orden INTEGER DEFAULT 0").run();
            }

            // Tables rename name -> nombre
            const tableCols = db.prepare("PRAGMA table_info(tables)").all() as any[];
            if (!tableCols.some(c => c.name === 'nombre')) {
                db.prepare("ALTER TABLE tables ADD COLUMN nombre TEXT").run();
                db.prepare("UPDATE tables SET nombre = name WHERE name IS NOT NULL").run();
            }
            if (!tableCols.some(c => c.name === 'currentOrderId')) {
                console.log('📦 Migrating tables: Adding runtime columns...');
                db.prepare("ALTER TABLE tables ADD COLUMN currentOrderId TEXT").run();
                db.prepare("ALTER TABLE tables ADD COLUMN currentOrderTotal REAL DEFAULT 0").run();
                db.prepare("ALTER TABLE tables ADD COLUMN timeSeated TEXT").run();
                db.prepare("ALTER TABLE tables ADD COLUMN waiterName TEXT").run();
            }
            if (!tableCols.some(c => c.name === 'consumo_minimo_mesa')) {
                console.log('📦 Migrating tables: Adding designer properties columns...');
                db.prepare("ALTER TABLE tables ADD COLUMN consumo_minimo_mesa REAL DEFAULT 0").run();
                db.prepare("ALTER TABLE tables ADD COLUMN comensales_minimos INTEGER DEFAULT 1").run();
            }

            // Ensure terminals_rooms_visibility
            db.prepare(`
                CREATE TABLE IF NOT EXISTS terminals_rooms_visibility (
                    terminal_id TEXT NOT NULL,
                    room_id TEXT NOT NULL,
                    PRIMARY KEY (terminal_id, room_id),
                    FOREIGN KEY (room_id) REFERENCES rooms(id)
                );
            `).run();
        }
    } catch (error) {
        console.error('❌ Failed to migrate Floor Plan tables:', error);
    }
}

const ensureRecipeColumns = () => {
    try {
        const columns = db.prepare("PRAGMA table_info(products)").all() as any[];
        const hasTheoreticalCost = columns.some(c => c.name === 'theoreticalCost');
        const hasRecipeDetails = columns.some(c => c.name === 'recipeDetails');

        if (!hasTheoreticalCost) {
            console.log('📦 Migrating products: Adding theoreticalCost...');
            db.prepare("ALTER TABLE products ADD COLUMN theoreticalCost REAL DEFAULT 0").run();
        }
        if (!hasRecipeDetails) {
            console.log('📦 Migrating products: Adding recipeDetails...');
            db.prepare("ALTER TABLE products ADD COLUMN recipeDetails TEXT").run();
        }
    } catch (error) {
        console.error('❌ Failed to ensure Recipe columns:', error);
    }
}

const ensureProductUomColumns = () => {
    try {
        const columns = db.prepare("PRAGMA table_info(products)").all() as any[];
        const missingCols = [
            { name: 'measurementUnit', type: 'TEXT' },
            { name: 'purchaseUnit', type: 'TEXT' },
            { name: 'conversionFactor', type: 'REAL', default: '1' },
            { name: 'batchYield', type: 'REAL', default: '1' },
            { name: 'primarySupplierId', type: 'TEXT' }
        ];

        for (const col of missingCols) {
            if (!columns.some(c => c.name === col.name)) {
                console.log(`📦 Migrating products: Adding ${col.name}...`);
                let query = `ALTER TABLE products ADD COLUMN ${col.name} ${col.type}`;
                if (col.default) query += ` DEFAULT ${col.default}`;
                db.prepare(query).run();
            }
        }
    } catch (error) {
        console.error('❌ Failed to ensure Product UOM columns:', error);
    }
}

// Run migration on startup
ensureTransactionHistoryTable();
ensureOperationalConfigTable();
ensureFloorPlanTables();
ensureRecipeColumns();
ensureProductUomColumns();
