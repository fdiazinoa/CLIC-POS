import express from 'express';
import { db, getCollection, getSetting, saveSetting } from '../db.js';

const router = express.Router();

// In-memory terminal tracking
interface ConnectedTerminal {
    terminalId: string;
    lastSeen: string;
    ip: string;
    deviceToken?: string;
    status: 'ONLINE' | 'OFFLINE';
}

const getTerminalTokens = () => {
    const rows = db.prepare("SELECT token, terminalId FROM sync_tokens").all() as any[];
    const tokens: Record<string, string> = {};
    rows.forEach(r => tokens[r.token] = r.terminalId);
    return tokens;
};

const getConnectedTerminals = () => {
    const rows = db.prepare("SELECT * FROM connected_terminals").all() as any[];
    const terminals: Record<string, any> = {};
    rows.forEach(r => terminals[r.terminalId] = r);
    return terminals;
};

/**
 * GET /api/sync/ping
 */
router.get('/ping', (req, res) => {
    res.json({ success: true, message: 'pong', serverTime: new Date().toISOString() });
});

/**
 * POST /api/sync/auth
 */
router.post('/auth', (req, res) => {
    const { terminalId, deviceToken } = req.body;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    if (!terminalId) {
        return res.status(400).json({ success: false, message: 'terminalId required' });
    }

    console.log(`[Sync] Terminal authentication: ${terminalId} from ${ip}`);

    const token = `sync_${terminalId}_${Date.now()}`;

    db.prepare("INSERT OR REPLACE INTO sync_tokens (token, terminalId) VALUES (?, ?)").run(token, terminalId);
    db.prepare("INSERT OR REPLACE INTO connected_terminals (terminalId, lastSeen, ip, deviceToken, status) VALUES (?, ?, ?, ?, ?)").run(
        terminalId,
        new Date().toISOString(),
        ip,
        deviceToken,
        'ONLINE'
    );

    res.json({
        success: true,
        token,
        terminalId,
        expiresIn: 86400000
    });
});

/**
 * GET /api/sync/terminals
 */
router.get('/terminals', (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    const terminalsMap = getConnectedTerminals();
    const terminals = Object.values(terminalsMap).map((t: any) => {
        const isOnline = (new Date().getTime() - new Date(t.lastSeen).getTime()) < 120000;
        return {
            ...t,
            status: isOnline ? 'ONLINE' : 'OFFLINE'
        };
    });

    res.json({ success: true, terminals });
});

/**
 * GET /api/sync/collections/:collection/metadata
 */
router.get('/collections/:collection/metadata', async (req, res) => {
    const { collection } = req.params;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    const terminalId = tokens[authToken];
    if (terminalId) {
        db.prepare("UPDATE connected_terminals SET lastSeen = ? WHERE terminalId = ?").run(new Date().toISOString(), terminalId);
    }

    try {
        const syncMetadata = getSetting('syncMetadata') || {};
        let metadata = syncMetadata[collection];

        if (!metadata) {
            const data = getCollection(collection);
            const itemCount = Array.isArray(data) ? data.length : 0;
            metadata = {
                version: Date.now(),
                lastUpdated: new Date().toISOString(),
                itemCount
            };
            syncMetadata[collection] = metadata;
            saveSetting('syncMetadata', syncMetadata);
        }

        res.json({ success: true, metadata });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/collections/:collection/data
 */
router.get('/collections/:collection/data', async (req, res) => {
    const { collection } = req.params;
    const { sinceVersion } = req.query;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    const terminalId = tokens[authToken];
    if (terminalId) {
        db.prepare("UPDATE connected_terminals SET lastSeen = ? WHERE terminalId = ?").run(new Date().toISOString(), terminalId);
    }

    try {
        const items = getCollection(collection);
        const syncMetadata = getSetting('syncMetadata') || {};
        let metadata = syncMetadata[collection];

        if (!metadata) {
            metadata = {
                version: Date.now(),
                lastUpdated: new Date().toISOString(),
                itemCount: items.length
            };
            syncMetadata[collection] = metadata;
            saveSetting('syncMetadata', syncMetadata);
        }

        const requestedVersion = sinceVersion ? parseInt(sinceVersion as string) : 0;
        if (requestedVersion >= metadata.version) {
            return res.json({ success: true, items: [], version: metadata.version, upToDate: true });
        }

        res.json({
            success: true,
            items,
            version: metadata.version,
            lastUpdated: metadata.lastUpdated,
            itemCount: items.length,
            upToDate: false
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/delta/:collection
 */
router.get('/delta/:collection', async (req, res) => {
    const { collection } = req.params;
    const { since } = req.query;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    const terminalId = tokens[authToken];
    if (terminalId) {
        db.prepare("UPDATE connected_terminals SET lastSeen = ? WHERE terminalId = ?").run(new Date().toISOString(), terminalId);
    }

    try {
        const items = getCollection(collection);
        if (!since) {
            return res.json({ success: true, items, serverTime: new Date().toISOString(), isFullDownload: true });
        }

        const sinceDate = new Date(since as string);
        const deltaItems = items.filter((item: any) => {
            const updatedAt = new Date(item.updatedAt || item.createdAt || 0);
            const deletedAt = item.deletedAt ? new Date(item.deletedAt) : null;
            return updatedAt > sinceDate || (deletedAt && deletedAt > sinceDate);
        });

        res.json({ success: true, items: deltaItems, serverTime: new Date().toISOString(), isFullDownload: false });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/collections/:collection/push
 */
router.post('/collections/:collection/push', async (req, res) => {
    const { collection } = req.params;
    const { items } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items must be an array' });
        }

        // Define JSON fields (must match db.ts)
        const jsonFields: Record<string, string[]> = {
            products: ['images', 'attributes', 'variants', 'tariffs', 'stockBalances', 'activeInWarehouses', 'appliedTaxIds', 'warehouseSettings', 'availableModifiers', 'operationalFlags'],
            roles: ['permissions', 'zReportConfig'],
            customers: ['tags', 'addresses'],
            transactions: ['items', 'payments', 'customerSnapshot', 'relatedTransactions'],
            receptions: ['items'],
            users: []
        };

        db.transaction(() => {
            const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(collection);
            if (tableExists) {
                const columns = db.prepare(`PRAGMA table_info(${collection})`).all() as any[];
                const hasDataColumn = columns.some(c => c.name === 'data');

                if (hasDataColumn) {
                    // For data-bag tables, we can wipe and replace (or upsert if we prefer)
                    // Legacy behavior was delete all. Let's keep it for data-bag tables but maybe upsert is safer?
                    // Let's stick to delete for data-bag to ensure clean slate, assuming no FKs to data-bag tables.
                    db.prepare(`DELETE FROM ${collection}`).run();
                    const stmt = db.prepare(`INSERT INTO ${collection} (id, data) VALUES (?, ?)`);
                    for (const item of items) stmt.run(item.id, JSON.stringify(item));
                } else {
                    // Structured table - UPSERT to avoid FK violations
                    const colNames = columns.map(c => c.name);
                    const placeholders = colNames.map(() => '?').join(',');
                    const stmt = db.prepare(`INSERT OR REPLACE INTO ${collection} (${colNames.join(',')}) VALUES (${placeholders})`);

                    const fieldsToStringify = jsonFields[collection] || [];

                    for (const item of items) {
                        const values = colNames.map(col => {
                            let val = item[col];
                            // Handle JSON fields
                            if (fieldsToStringify.includes(col)) {
                                return typeof val === 'object' ? JSON.stringify(val) : (val || '[]');
                            }
                            // Handle Booleans (SQLite uses 0/1)
                            if (typeof val === 'boolean') return val ? 1 : 0;

                            // Handle missing values for columns that might have defaults or be nullable
                            if (val === undefined) return null;

                            return val;
                        });
                        stmt.run(...values);
                    }
                }
            } else {
                saveSetting(collection, items);
            }

            const syncMetadata = getSetting('syncMetadata') || {};
            syncMetadata[collection] = {
                version: Date.now(),
                lastUpdated: new Date().toISOString(),
                itemCount: items.length // This might be inaccurate if we upserted, but close enough for versioning
            };
            saveSetting('syncMetadata', syncMetadata);
        })();

        res.json({ success: true, version: Date.now(), itemCount: items.length });
    } catch (error: any) {
        console.error(`❌ Error pushing to ${collection}:`, error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/status
 */
router.get('/status', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    const terminalId = tokens[authToken];
    if (terminalId) {
        db.prepare("UPDATE connected_terminals SET lastSeen = ? WHERE terminalId = ?").run(new Date().toISOString(), terminalId);
    }

    try {
        const collections = ['products', 'customers', 'suppliers', 'internalSequences'];
        const syncMetadata = getSetting('syncMetadata') || {};
        const status = collections.map(collection => {
            const items = getCollection(collection);
            const metadata = syncMetadata[collection];
            return {
                collection,
                version: metadata?.version || 0,
                lastUpdated: metadata?.lastUpdated || null,
                itemCount: items.length
            };
        });

        res.json({ success: true, status, serverTime: new Date().toISOString() });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/transactions
 */
router.post('/transactions', async (req, res) => {
    const { items } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items must be an array' });
        }

        let addedCount = 0;
        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO transactions (id, globalSequence, displayId, documentType, seriesId, seriesNumber, date, items, total, payments, userId, userName, terminalId, status, customerId, customerName, customerSnapshot, taxAmount, netAmount, discountAmount, isTaxIncluded, ncf, ncfType, relatedTransactions, originalTransactionId, refundReason, syncStatus, syncError) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const txn of items) {
                const result = stmt.run(txn.id, txn.globalSequence, txn.displayId, txn.documentType, txn.seriesId, txn.seriesNumber, txn.date, JSON.stringify(txn.items), txn.total, JSON.stringify(txn.payments), txn.userId, txn.userName, txn.terminalId, txn.status, txn.customerId, txn.customerName, JSON.stringify(txn.customerSnapshot), txn.taxAmount, txn.netAmount, txn.discountAmount, txn.isTaxIncluded ? 1 : 0, txn.ncf, txn.ncfType, JSON.stringify(txn.relatedTransactions), txn.originalTransactionId, txn.refundReason, txn.syncStatus, txn.syncError);
                if (result.changes > 0) addedCount++;
            }

            const pending = getSetting('pending_transactions') || [];
            saveSetting('pending_transactions', [...pending, ...items]);

            const syncMetadata = getSetting('syncMetadata') || {};
            syncMetadata['transactions'] = {
                version: Date.now(),
                lastUpdated: new Date().toISOString(),
                itemCount: (getCollection('transactions')).length
            };
            saveSetting('syncMetadata', syncMetadata);
        })();

        res.json({
            success: true,
            addedCount,
            totalCount: (getCollection('transactions')).length,
            inventoryUpdates: 0
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/transactions/pending
 */
router.get('/transactions/pending', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const pending = getSetting('pending_transactions') || [];
        saveSetting('pending_transactions', []);
        res.json({ success: true, items: pending });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/operational-status
 */
router.get('/operational-status', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const transactions = getCollection('transactions');
        const inventoryLedger = getCollection('inventory_ledger');
        const zReports = getCollection('z_reports');
        const pendingTxns = getSetting('pending_transactions') || [];
        const pendingMovements = getSetting('pending_inventory_movements') || [];
        const syncErrors = getSetting('sync_errors') || [];

        const terminalStats: { [key: string]: any } = {};
        const getStat = (tid: string) => {
            if (!terminalStats[tid]) {
                terminalStats[tid] = {
                    terminalId: tid,
                    transactions: 0,
                    movements: 0,
                    zReports: 0,
                    pending: 0,
                    errors: 0,
                    lastActivity: null
                };
            }
            return terminalStats[tid];
        };

        transactions.forEach((txn: any) => {
            const stat = getStat(txn.terminalId || 'Unknown');
            stat.transactions++;
            if (!stat.lastActivity || new Date(txn.date) > new Date(stat.lastActivity)) {
                stat.lastActivity = txn.date;
            }
        });

        inventoryLedger.forEach((move: any) => {
            const stat = getStat(move.terminalId || 'Unknown');
            stat.movements++;
            if (!stat.lastActivity || new Date(move.createdAt) > new Date(stat.lastActivity)) {
                stat.lastActivity = move.createdAt;
            }
        });

        zReports.forEach((report: any) => {
            const stat = getStat(report.terminalId || 'Unknown');
            stat.zReports++;
            if (!stat.lastActivity || new Date(report.closedAt) > new Date(stat.lastActivity)) {
                stat.lastActivity = report.closedAt;
            }
        });

        pendingTxns.forEach((txn: any) => { getStat(txn.terminalId || 'Unknown').pending++; });
        pendingMovements.forEach((move: any) => { getStat(move.terminalId || 'Unknown').pending++; });
        syncErrors.forEach((err: any) => { getStat(err.terminalId || 'Unknown').errors++; });

        res.json({
            success: true,
            terminals: Object.values(terminalStats),
            globalPending: {
                transactions: pendingTxns.length,
                movements: pendingMovements.length
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/errors
 */
router.post('/errors', async (req, res) => {
    const { terminalId, error, itemType, itemId } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const errors = getSetting('sync_errors') || [];
        errors.push({ terminalId, error, itemType, itemId, timestamp: new Date().toISOString() });
        if (errors.length > 500) errors.shift();
        saveSetting('sync_errors', errors);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/sync/history/:terminalId
 */
router.get('/history/:terminalId', async (req, res) => {
    const { terminalId } = req.params;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const transactions = getCollection('transactions').filter((t: any) => t.terminalId === terminalId);
        const inventoryLedger = getCollection('inventory_ledger').filter((m: any) => m.terminalId === terminalId);
        const zReports = getCollection('z_reports').filter((r: any) => r.terminalId === terminalId);

        res.json({
            success: true,
            terminalId,
            data: { transactions, inventoryLedger, zReports }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/cash/movements
 */
router.post('/cash/movements', async (req, res) => {
    const { items } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items must be an array' });
        }

        let addedCount = 0;
        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO cash_movements (id, createdAt, type, amount, concept, userId, userName, terminalId, zReportId, syncStatus, syncError) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const move of items) {
                const result = stmt.run(move.id, move.createdAt, move.type, move.amount, move.concept, move.userId, move.userName, move.terminalId, move.zReportId, move.syncStatus, move.syncError);
                if (result.changes > 0) addedCount++;
            }

            const syncMetadata = getSetting('syncMetadata') || {};
            syncMetadata['cashMovements'] = {
                version: Date.now(),
                lastUpdated: new Date().toISOString(),
                itemCount: (getCollection('cash_movements')).length
            };
            saveSetting('syncMetadata', syncMetadata);
        })();

        res.json({ success: true, addedCount });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/z-reports
 */
router.post('/z-reports', async (req, res) => {
    const { items } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items must be an array' });
        }

        let addedCount = 0;
        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO z_reports (id, openedAt, closedAt, terminalId, userId, userName, openingBalance, closingBalance, totalSales, totalTaxes, totalDiscounts, totalCash, totalCard, totalTransfer, totalOther, status, syncStatus, syncError) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const report of items) {
                const result = stmt.run(report.id, report.openedAt, report.closedAt, report.terminalId, report.userId, report.userName, report.openingBalance, report.closingBalance, report.totalSales, report.totalTaxes, report.totalDiscounts, report.totalCash, report.totalCard, report.totalTransfer, report.totalOther, report.status, report.syncStatus, report.syncError);
                if (result.changes > 0) addedCount++;
            }

            const syncMetadata = getSetting('syncMetadata') || {};
            syncMetadata['zReports'] = {
                version: Date.now(),
                lastUpdated: new Date().toISOString(),
                itemCount: (getCollection('z_reports')).length
            };
            saveSetting('syncMetadata', syncMetadata);
        })();

        res.json({ success: true, addedCount });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/config
 */
router.get('/config', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const config = getSetting('config');
        res.json({ success: true, config });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/inventory/stock-balances
 */
router.get('/inventory/stock-balances', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const products = getCollection('products');
        const balances = products.map((p: any) => ({
            id: p.id,
            stock: p.stock || 0,
            stockBalances: p.stockBalances || {}
        }));

        res.json({ success: true, balances, serverTime: new Date().toISOString() });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/inventory/kardex/:productId
 */
router.get('/inventory/kardex/:productId', async (req, res) => {
    const { productId } = req.params;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const ledger = getCollection('inventory_ledger');
        const productLedger = ledger.filter((entry: any) => entry.productId === productId);
        res.json({ success: true, items: productLedger, serverTime: new Date().toISOString() });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/reset/:terminalId
 */
router.post('/reset/:terminalId', async (req, res) => {
    const { terminalId } = req.params;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const isFullReset = terminalId === 'ALL';
        db.transaction(() => {
            const tables = ['transactions', 'inventory_ledger', 'z_reports', 'cash_movements', 'receptions'];
            for (const table of tables) {
                if (isFullReset) {
                    db.prepare(`DELETE FROM ${table}`).run();
                } else {
                    db.prepare(`DELETE FROM ${table} WHERE terminalId = ?`).run(terminalId);
                }
            }

            // Clear settings-based buffers
            if (isFullReset) {
                saveSetting('pending_transactions', []);
                saveSetting('pending_inventory_movements', []);
                saveSetting('sync_errors', []);
            } else {
                const pendingTx = (getSetting('pending_transactions') || []).filter((t: any) => t.terminalId !== terminalId);
                saveSetting('pending_transactions', pendingTx);
                const pendingMov = (getSetting('pending_inventory_movements') || []).filter((m: any) => m.terminalId !== terminalId);
                saveSetting('pending_inventory_movements', pendingMov);
                const errors = (getSetting('sync_errors') || []).filter((e: any) => e.terminalId !== terminalId);
                saveSetting('sync_errors', errors);
            }

            const syncMetadata = getSetting('syncMetadata') || {};
            const now = new Date().toISOString();
            const newVersion = Date.now();

            tables.forEach(col => {
                if (syncMetadata[col]) {
                    syncMetadata[col].version = newVersion;
                    syncMetadata[col].lastUpdated = now;
                    syncMetadata[col].itemCount = (getCollection(col)).length;
                }
            });
            saveSetting('syncMetadata', syncMetadata);
        })();

        res.json({ success: true, message: `Data for terminal ${terminalId} reset successfully` });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/inventory/movements/pending
 */
router.get('/inventory/movements/pending', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const pending = getSetting('pending_inventory_movements') || [];
        saveSetting('pending_inventory_movements', []);
        res.json({ success: true, items: pending });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/inventory/movements
 */
router.post('/inventory/movements', async (req, res) => {
    const { items } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items must be an array' });
        }

        let addedCount = 0;
        const processedIds: string[] = [];

        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO inventory_ledger (id, createdAt, warehouseId, productId, concept, documentRef, qtyIn, qtyOut, unitCost, balanceQty, balanceAvgCost, terminalId, syncStatus, syncError) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const move of items) {
                const result = stmt.run(move.id, move.createdAt, move.warehouseId, move.productId, move.concept, move.documentRef, move.qtyIn, move.qtyOut, move.unitCost, move.balanceQty, move.balanceAvgCost, move.terminalId, move.syncStatus, move.syncError);
                if (result.changes > 0) {
                    addedCount++;
                    db.prepare(`
                        INSERT INTO product_stocks (id, productId, warehouseId, quantity, updatedAt)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(productId, warehouseId) DO UPDATE SET
                        quantity = quantity + ?,
                        updatedAt = ?
                    `).run(
                        `${move.productId}_${move.warehouseId}`,
                        move.productId,
                        move.warehouseId,
                        (move.qtyIn || 0) - (move.qtyOut || 0),
                        new Date().toISOString(),
                        (move.qtyIn || 0) - (move.qtyOut || 0),
                        new Date().toISOString()
                    );
                }
                processedIds.push(move.id);
            }

            const pending = getSetting('pending_inventory_movements') || [];
            saveSetting('pending_inventory_movements', [...pending, ...items]);

            const syncMetadata = getSetting('syncMetadata') || {};
            syncMetadata['inventory_ledger'] = {
                version: Date.now(),
                lastUpdated: new Date().toISOString(),
                itemCount: (getCollection('inventory_ledger')).length
            };
            saveSetting('syncMetadata', syncMetadata);
        })();

        res.json({ success: true, processedIds, addedCount, totalCount: (getCollection('inventory_ledger')).length });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
