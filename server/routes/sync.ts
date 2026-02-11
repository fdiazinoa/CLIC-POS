import express from 'express';
import { db, getCollection, getSetting, saveSetting } from '../db.js';
import fs from 'fs';
import path from 'path';

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

// --- Sync Versioning & Change Log Helpers ---
const collectionAliasMap: Record<string, string> = {
    inventoryLedger: 'inventory_ledger',
    cashMovements: 'cash_movements',
    zReports: 'z_reports',
    productStocks: 'product_stocks',
    purchaseOrders: 'purchase_orders',
    supplierProductPrices: 'supplier_product_prices'
};

const resolveCollectionName = (collection: string) => collectionAliasMap[collection] || collection;

const getCollectionForSync = (collection: string): any[] => {
    const resolved = resolveCollectionName(collection);
    return getCollection(resolved);
};

const getItemCount = (collection: string): number => {
    const data = getCollectionForSync(collection);
    return Array.isArray(data) ? data.length : 0;
};

const getSyncVersionKey = (collection: string) => `sync_version_${collection}`;

const getCurrentVersion = (collection: string): number => {
    const v = getSetting(getSyncVersionKey(collection));
    if (typeof v === 'number') return v;
    const syncMetadata = getSetting('syncMetadata') || {};
    const metaVersion = syncMetadata[collection]?.version;
    return typeof metaVersion === 'number' ? metaVersion : 0;
};

const bumpVersion = (collection: string): number => {
    const next = getCurrentVersion(collection) + 1;
    saveSetting(getSyncVersionKey(collection), next);
    return next;
};

const ensureMetadata = (collection: string) => {
    const syncMetadata = getSetting('syncMetadata') || {};
    if (!syncMetadata[collection]) {
        syncMetadata[collection] = {
            version: getCurrentVersion(collection),
            lastUpdated: new Date().toISOString(),
            itemCount: getItemCount(collection),
            fullSyncVersion: 0
        };
        saveSetting('syncMetadata', syncMetadata);
    }
    return syncMetadata[collection];
};

const updateMetadata = (collection: string, version: number, fullSyncVersion?: number) => {
    const syncMetadata = getSetting('syncMetadata') || {};
    syncMetadata[collection] = {
        version,
        lastUpdated: new Date().toISOString(),
        itemCount: getItemCount(collection),
        fullSyncVersion: fullSyncVersion ?? syncMetadata[collection]?.fullSyncVersion ?? 0
    };
    saveSetting('syncMetadata', syncMetadata);
};

const insertChangeStmt = db.prepare(`
    INSERT INTO sync_changes (collection, itemId, version, op, payload, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
`);

const clearChangesForCollection = (collection: string) => {
    db.prepare("DELETE FROM sync_changes WHERE collection = ?").run(collection);
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
        const metadata = ensureMetadata(collection);

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
        const items = getCollectionForSync(collection);
        const metadata = ensureMetadata(collection);

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
    const { since, sinceVersion } = req.query;
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
        const items = getCollectionForSync(collection);
        const metadata = ensureMetadata(collection);
        const latestVersion = metadata.version || 0;
        const fullSyncVersion = metadata.fullSyncVersion || 0;

        const requestedVersion = sinceVersion ? parseInt(sinceVersion as string) : 0;

        // SPECIAL CASE: 'config' is a singleton object, not an array
        if (collection === 'config') {
            if (requestedVersion >= latestVersion && latestVersion > 0) {
                return res.json({ success: true, items: [], serverTime: new Date().toISOString(), isFullDownload: false, latestVersion });
            }
            return res.json({ success: true, items: items ? [items] : [], serverTime: new Date().toISOString(), isFullDownload: true, latestVersion });
        }

        // If no version provided, or a full sync is required, return full download
        if (!requestedVersion || requestedVersion < fullSyncVersion) {
            return res.json({ success: true, items, serverTime: new Date().toISOString(), isFullDownload: true, latestVersion });
        }

        // Versioned delta using change log
        const rows = db.prepare(`
            SELECT itemId, op, payload, version
            FROM sync_changes
            WHERE collection = ? AND version > ?
            ORDER BY version ASC
        `).all(collection, requestedVersion) as any[];

        const deltaItems = rows.map(r => {
            if (r.op === 'DELETE') {
                let payload: any = {};
                try { payload = r.payload ? JSON.parse(r.payload) : {}; } catch { }
                return { id: r.itemId, deletedAt: payload.deletedAt || new Date().toISOString(), _op: 'DELETE' };
            }
            let payload: any = {};
            try { payload = r.payload ? JSON.parse(r.payload) : {}; } catch { }
            return { ...payload, _op: r.op || 'UPSERT' };
        });

        res.json({ success: true, items: deltaItems, serverTime: new Date().toISOString(), isFullDownload: false, latestVersion });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/collections/:collection/push
 */
router.post('/collections/:collection/push', async (req, res) => {
    const { collection } = req.params;
    const { items, mode } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items must be an array' });
        }

        const pushMode = mode === 'FULL_REPLACE' ? 'FULL_REPLACE' : 'UPSERT';

        // Define JSON fields (must match db.ts)
        const jsonFields: Record<string, string[]> = {
            products: ['images', 'attributes', 'variants', 'tariffs', 'stockBalances', 'activeInWarehouses', 'appliedTaxIds', 'warehouseSettings', 'availableModifiers', 'operationalFlags', 'recipeDetails'],
            roles: ['permissions', 'zReportConfig'],
            customers: ['tags', 'addresses'],
            transactions: ['items', 'payments', 'customerSnapshot', 'relatedTransactions'],
            receptions: ['items'],
            users: []
        };

        db.transaction(() => {
            const resolvedCollection = resolveCollectionName(collection);
            const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(resolvedCollection);
            const now = new Date().toISOString();

            if (tableExists) {
                const columns = db.prepare(`PRAGMA table_info(${resolvedCollection})`).all() as any[];
                const hasDataColumn = columns.some(c => c.name === 'data');

                // FORCE UPSERT for products to avoid FK violations from DELETE
                if (collection === 'products' && pushMode === 'FULL_REPLACE') {
                    console.warn('[Sync] Forcing UPSERT mode for products to preserve Foreign Keys');
                }

                if (pushMode === 'FULL_REPLACE' && collection !== 'products') {
                    // Full replace (force push) - Only for non-critical collections
                    db.prepare(`DELETE FROM ${resolvedCollection}`).run();

                    if (hasDataColumn) {
                        const stmt = db.prepare(`INSERT INTO ${resolvedCollection} (id, data) VALUES (?, ?)`);
                        for (const item of items) stmt.run(item.id, JSON.stringify(item));
                    } else {
                        const colNames = columns.map(c => c.name);
                        const placeholders = colNames.map(() => '?').join(',');
                        const updateSet = colNames.map(c => `${c}=excluded.${c}`).join(',');
                        const stmt = db.prepare(`INSERT INTO ${resolvedCollection} (${colNames.join(',')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`);
                        const fieldsToStringify = jsonFields[collection] || [];

                        for (const item of items) {
                            const values = colNames.map(col => {
                                let val = item[col];
                                if (fieldsToStringify.includes(col)) {
                                    return typeof val === 'object' ? JSON.stringify(val) : (val || '[]');
                                }
                                if (typeof val === 'boolean') return val ? 1 : 0;
                                if (val === undefined) return null;
                                return val;
                            });
                            stmt.run(...values);
                        }
                    }

                    // Full replace resets change log and forces full download for slaves
                    clearChangesForCollection(collection);
                    const newVersion = bumpVersion(collection);
                    updateMetadata(collection, newVersion, newVersion);
                } else {
                    // UPSERT / DELETE items (delta-friendly)
                    let dataStmt: any = null;
                    let structuredStmt: any = null;
                    let colNames: string[] = [];
                    let fieldsToStringify: string[] = [];

                    if (hasDataColumn) {
                        dataStmt = db.prepare(`INSERT INTO ${resolvedCollection} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`);
                    } else {
                        colNames = columns.map(c => c.name);
                        const placeholders = colNames.map(() => '?').join(',');
                        const updateSet = colNames.map(c => `${c}=excluded.${c}`).join(',');
                        structuredStmt = db.prepare(`INSERT INTO ${resolvedCollection} (${colNames.join(',')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`);
                        fieldsToStringify = jsonFields[collection] || [];
                    }

                    for (const rawItem of items) {
                        if (!rawItem || !rawItem.id) {
                            console.warn(`[Sync] Skipping ${collection} item without id`, rawItem);
                            continue;
                        }
                        const item = { ...rawItem };
                        const op = item._op === 'DELETE' || item.deletedAt || item.isActive === false ? 'DELETE' : 'UPSERT';

                        if (op === 'DELETE') {
                            if (item.id) {
                                db.prepare(`DELETE FROM ${resolvedCollection} WHERE id = ?`).run(item.id);
                            }
                        } else {
                            if (hasDataColumn && dataStmt) {
                                dataStmt.run(item.id, JSON.stringify(item));
                            } else if (structuredStmt) {
                                const values = colNames.map(col => {
                                    let val = item[col];
                                    if (fieldsToStringify.includes(col)) {
                                        return typeof val === 'object' ? JSON.stringify(val) : (val || '[]');
                                    }
                                    if (typeof val === 'boolean') return val ? 1 : 0;
                                    if (val === undefined) return null;
                                    return val;
                                });
                                structuredStmt.run(...values);
                            }
                        }

                        const version = bumpVersion(collection);
                        const payload = op === 'DELETE'
                            ? JSON.stringify({ id: item.id, deletedAt: item.deletedAt || now })
                            : JSON.stringify(item);
                        insertChangeStmt.run(collection, item.id, version, op, payload, now);
                    }

                    updateMetadata(collection, getCurrentVersion(collection));
                }
            } else {
                // Settings-based collection (array)
                if (pushMode === 'FULL_REPLACE') {
                    saveSetting(collection, items);
                    clearChangesForCollection(collection);
                    const newVersion = bumpVersion(collection);
                    updateMetadata(collection, newVersion, newVersion);
                } else {
                    const existing = (getSetting(collection) || []) as any[];
                    const map = new Map(existing.map((i: any) => [i.id, i]));

                    for (const rawItem of items) {
                        const item = { ...rawItem };
                        const op = item._op === 'DELETE' || item.deletedAt || item.isActive === false ? 'DELETE' : 'UPSERT';
                        if (op === 'DELETE') {
                            map.delete(item.id);
                        } else {
                            map.set(item.id, item);
                        }

                        const version = bumpVersion(collection);
                        const payload = op === 'DELETE'
                            ? JSON.stringify({ id: item.id, deletedAt: item.deletedAt || now })
                            : JSON.stringify(item);
                        insertChangeStmt.run(collection, item.id, version, op, payload, now);
                    }

                    saveSetting(collection, Array.from(map.values()));
                    updateMetadata(collection, getCurrentVersion(collection));
                }
            }
        })();

        res.json({ success: true, version: getCurrentVersion(collection), itemCount: (getCollection(collection) || []).length });
    } catch (error: any) {
        console.error(`❌ Error pushing to ${collection}:`, error);
        console.error(`❌ Error stack:`, error.stack);
        console.error(`❌ Sample item causing error:`, items && items[0]);

        // Emergency log to file for debugging
        try {
            const logPath = path.join(process.cwd(), 'server_error.log');
            const logEntry = `\n[${new Date().toISOString()}] Error pushing to ${collection}:\n${error.message}\n${error.stack}\nSample Item: ${JSON.stringify(items && items[0])}\n`;
            fs.appendFileSync(logPath, logEntry);
        } catch (e) {
            console.error('Failed to write to error log', e);
        }

        res.status(500).json({ success: false, message: error.message, details: error.stack });
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
        const now = new Date().toISOString();
        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO transactions (id, globalSequence, displayId, documentType, seriesId, seriesNumber, date, items, total, payments, userId, userName, terminalId, status, customerId, customerName, customerSnapshot, taxAmount, netAmount, discountAmount, isTaxIncluded, ncf, ncfType, relatedTransactions, originalTransactionId, refundReason, affectedInvoiceNumber, affectedNCF, syncStatus, syncError) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const txn of items) {
                const result = stmt.run(txn.id, txn.globalSequence, txn.displayId, txn.documentType, txn.seriesId, txn.seriesNumber, txn.date, JSON.stringify(txn.items), txn.total, JSON.stringify(txn.payments), txn.userId, txn.userName, txn.terminalId, txn.status, txn.customerId, txn.customerName, JSON.stringify(txn.customerSnapshot), txn.taxAmount, txn.netAmount, txn.discountAmount, txn.isTaxIncluded ? 1 : 0, txn.ncf, txn.ncfType, JSON.stringify(txn.relatedTransactions), txn.originalTransactionId, txn.refundReason, txn.affectedInvoiceNumber, txn.affectedNCF, txn.syncStatus, txn.syncError);
                if (result.changes > 0) {
                    addedCount++;
                    const version = bumpVersion('transactions');
                    insertChangeStmt.run('transactions', txn.id, version, 'UPSERT', JSON.stringify(txn), now);
                }
            }

            const pending = getSetting('pending_transactions') || [];
            const pendingMap = new Map(pending.map((p: any) => [p.id, p]));
            items.forEach((it: any) => pendingMap.set(it.id, it));
            saveSetting('pending_transactions', Array.from(pendingMap.values()));

            updateMetadata('transactions', getCurrentVersion('transactions'));
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
        res.json({ success: true, items: pending });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/transactions/pending/ack
 */
router.post('/transactions/pending/ack', async (req, res) => {
    const { ids } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(ids)) {
            return res.status(400).json({ success: false, message: 'ids must be an array' });
        }
        const pending = getSetting('pending_transactions') || [];
        const remaining = pending.filter((p: any) => !ids.includes(p.id));
        saveSetting('pending_transactions', remaining);
        res.json({ success: true, remaining: remaining.length });
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
        const cashMovements = getCollection('cash_movements').filter((c: any) => c.terminalId === terminalId);

        res.json({
            success: true,
            terminalId,
            data: { transactions, inventoryLedger, zReports, cashMovements }
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

        const collectionKey = 'cashMovements';
        let addedCount = 0;
        const now = new Date().toISOString();
        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO cash_movements (id, createdAt, type, amount, concept, userId, userName, terminalId, zReportId, syncStatus, syncError) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const move of items) {
                const result = stmt.run(move.id, move.createdAt, move.type, move.amount, move.concept, move.userId, move.userName, move.terminalId, move.zReportId, move.syncStatus, move.syncError);
                if (result.changes > 0) {
                    addedCount++;
                    const version = bumpVersion(collectionKey);
                    insertChangeStmt.run(collectionKey, move.id, version, 'UPSERT', JSON.stringify(move), now);
                }
            }

            updateMetadata(collectionKey, getCurrentVersion(collectionKey));
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

        const collectionKey = 'zReports';
        let addedCount = 0;
        const now = new Date().toISOString();
        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO z_reports (id, openedAt, closedAt, terminalId, userId, userName, openingBalance, closingBalance, totalSales, totalTaxes, totalDiscounts, totalCash, totalCard, totalTransfer, totalOther, status, syncStatus, syncError, sequenceNumber, totalsByMethod, cashExpected, cashCounted, cashDiscrepancy, stats, transactionCount, notes, baseCurrency, cashSales, cashIn, cashOut) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const report of items) {
                // Determine total sales from totalsByMethod if possible
                const totalSales = typeof report.totalsByMethod === 'object' ?
                    Object.values(report.totalsByMethod).reduce((sum: any, val: any) => sum + (val || 0), 0) :
                    (report.totalSales || 0);

                const result = stmt.run(
                    report.id, report.openedAt, report.closedAt, report.terminalId, report.userId, report.userName,
                    report.openingBalance, report.closingBalance, totalSales, report.totalTaxes, report.totalDiscounts,
                    report.totalCash, report.totalCard, report.totalTransfer, report.totalOther, report.status,
                    report.syncStatus, report.syncError,
                    report.sequenceNumber,
                    typeof report.totalsByMethod === 'object' ? JSON.stringify(report.totalsByMethod) : (report.totalsByMethod || '{}'),
                    typeof report.cashExpected === 'object' ? JSON.stringify(report.cashExpected) : (report.cashExpected || '{}'),
                    typeof report.cashCounted === 'object' ? JSON.stringify(report.cashCounted) : (report.cashCounted || '{}'),
                    typeof report.cashDiscrepancy === 'object' ? JSON.stringify(report.cashDiscrepancy) : (report.cashDiscrepancy || '{}'),
                    typeof report.stats === 'object' ? JSON.stringify(report.stats) : (report.stats || '{}'),
                    report.transactionCount || 0,
                    report.notes || '',
                    report.baseCurrency || '',
                    report.cashSales || 0,
                    report.cashIn || 0,
                    report.cashOut || 0
                );
                if (result.changes > 0) {
                    addedCount++;
                    const version = bumpVersion(collectionKey);
                    insertChangeStmt.run(collectionKey, report.id, version, 'UPSERT', JSON.stringify(report), now);
                }
            }

            updateMetadata(collectionKey, getCurrentVersion(collectionKey));
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
                try {
                    if (isFullReset) {
                        db.prepare(`DELETE FROM ${table}`).run();
                    } else {
                        // Check if terminalId column exists before deleting
                        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
                        if (columns.some(c => c.name === 'terminalId')) {
                            db.prepare(`DELETE FROM ${table} WHERE terminalId = ?`).run(terminalId);
                        } else {
                            console.warn(`[Reset] Table ${table} does not have terminalId column. Skipping.`);
                        }
                    }
                } catch (e: any) {
                    console.error(`[Reset] Error clearing table ${table}:`, e.message);
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
        res.json({ success: true, items: pending });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/inventory/movements/pending/ack
 */
router.post('/inventory/movements/pending/ack', async (req, res) => {
    const { ids } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(ids)) {
            return res.status(400).json({ success: false, message: 'ids must be an array' });
        }
        const pending = getSetting('pending_inventory_movements') || [];
        const remaining = pending.filter((p: any) => !ids.includes(p.id));
        saveSetting('pending_inventory_movements', remaining);
        res.json({ success: true, remaining: remaining.length });
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

        const collectionKey = 'inventoryLedger';
        let addedCount = 0;
        const processedIds: string[] = [];
        const now = new Date().toISOString();

        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO inventory_ledger (id, createdAt, warehouseId, productId, concept, documentRef, qtyIn, qtyOut, unitCost, balanceQty, balanceAvgCost, terminalId, syncStatus, syncError) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const move of items) {
                const result = stmt.run(move.id, move.createdAt, move.warehouseId, move.productId, move.concept, move.documentRef, move.qtyIn, move.qtyOut, move.unitCost, move.balanceQty, move.balanceAvgCost, move.terminalId, move.syncStatus, move.syncError);
                if (result.changes > 0) {
                    addedCount++;
                    const version = bumpVersion(collectionKey);
                    insertChangeStmt.run(collectionKey, move.id, version, 'UPSERT', JSON.stringify(move), now);
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
            const pendingMap = new Map(pending.map((p: any) => [p.id, p]));
            items.forEach((it: any) => pendingMap.set(it.id, it));
            saveSetting('pending_inventory_movements', Array.from(pendingMap.values()));

            updateMetadata(collectionKey, getCurrentVersion(collectionKey));
        })();

        res.json({ success: true, processedIds, addedCount, totalCount: (getCollection('inventory_ledger')).length });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
