import express, { type Request } from 'express';
import { db, getCollection, getSetting, saveSetting } from '../db.js';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { emitSyncEvent } from '../socket.js';
import { coerceTransactionItemsForErp } from '../../services/sync/erpOutboundPayloads.js';
import { normalizeTransactionForSync } from '../../services/sync/sourceIdentity.js';
import { forwardTransactionsToErpInbox } from '../services/erpInboxForward.js';

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
    const data = getCollection(resolved);

    if (!Array.isArray(data)) {
        return data;
    }

    const activeItems = data.filter((item: any) => {
        if (!item || typeof item !== 'object') return true;

        const deletedAt = normalizeIdentityString(item.deleted_at) || normalizeIdentityString(item.deletedAt);
        if (deletedAt) return false;
        if (item.isActive === false) return false;
        return true;
    });

    if (collection !== 'transactions') {
        return activeItems;
    }

    // Do not sync table-open placeholder rows (ORD-*) as sales tickets.
    // These rows are operational state for restaurant tables, not fiscal documents.
    return activeItems.filter((txn: any) => {
        const id = typeof txn?.id === 'string' ? txn.id.trim() : '';
        const displayId = typeof txn?.displayId === 'string' ? txn.displayId.trim() : '';
        const documentType = typeof txn?.documentType === 'string' ? txn.documentType.trim().toUpperCase() : '';

        if (id.startsWith('ORD-') && !displayId && !documentType) return false;
        return true;
    });
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

const bumpVersion = (collection: string, itemId?: string): number => {
    const next = getCurrentVersion(collection) + 1;
    saveSetting(getSyncVersionKey(collection), next);

    // Aditive: Update 'version' column for master data if itemId provided
    if (itemId && (collection === 'products' || collection === 'customers')) {
        const table = resolveCollectionName(collection);
        try {
            db.prepare(`UPDATE ${table} SET version = version + 1 WHERE id = ?`).run(itemId);
        } catch (e) {
            console.warn(`[Sync] Could not update version for ${collection}:${itemId}`, e);
        }
    }

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

const updateMetadata = (collection: string, version: number, fullSyncVersion?: number, requestOriginTerminalId?: string) => {
    const syncMetadata = getSetting('syncMetadata') || {};
    syncMetadata[collection] = {
        version,
        lastUpdated: new Date().toISOString(),
        itemCount: getItemCount(collection),
        fullSyncVersion: fullSyncVersion ?? syncMetadata[collection]?.fullSyncVersion ?? 0
    };
    saveSetting('syncMetadata', syncMetadata);

    // Aditive: Emit WebSocket event to notify clients for reactive sync
    const timestamp = new Date().toISOString();
    console.log(`[SERVER_WS_EMIT] ${timestamp} Notificando clientes: ${collection} (Origin: ${requestOriginTerminalId || 'Unknown'})`);

    if (collection === 'products') {
        emitSyncEvent('PRICE_CHANGED', { collection }, requestOriginTerminalId);
    } else {
        emitSyncEvent('CATALOG_UPDATED', { collection }, requestOriginTerminalId);
    }
};

const normalizeProductImages = (product: any): { image: string | null; images: string[] } => {
    const image = typeof product?.image === 'string' && product.image.trim().length > 0
        ? product.image
        : null;
    const images = Array.isArray(product?.images)
        ? product.images.filter((img: any) => typeof img === 'string' && img.trim().length > 0)
        : [];

    return { image, images };
};

const buildProductImageHash = (product: any): string => {
    const { image, images } = normalizeProductImages(product);
    return createHash('sha1')
        .update(JSON.stringify({ image, images }))
        .digest('hex');
};

const toFiniteNumber = (value: any, fallback = 0): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const toNullableFiniteNumber = (value: any): number | null => {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const toNumericMap = (value: any): Record<string, number> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value)) {
        out[key] = toFiniteNumber(raw, 0);
    }
    return out;
};

const safeJsonStringify = (value: any, fallback = '{}'): string => {
    if (value === undefined || value === null) return fallback;
    try {
        return JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? Number(v) : v);
    } catch {
        return fallback;
    }
};

const normalizeIdentityString = (value: any): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const firstDefinedImageValue = (values: any[]): string | null => {
    for (const value of values) {
        const normalized = normalizeIdentityString(value);
        if (normalized && (/^file:\/\//i.test(normalized) || /^content:\/\//i.test(normalized) || normalized.includes('/_capacitor_file_'))) {
            continue;
        }
        if (normalized) return normalized;
    }
    return null;
};

const normalizeMasterDataImageFields = (collection: string, item: any) => {
    if (!item || typeof item !== 'object') return item;
    if (collection !== 'customers' && collection !== 'suppliers') return item;

    const next = { ...item };
    const imageUrl = firstDefinedImageValue([
        item.imageUrl,
        item.image_url,
        item.photoUrl,
        item.photo_url,
        item.avatarUrl,
        item.avatar_url,
        item.logoUrl,
        item.logo_url,
        item.metadata?.imageUrl,
        item.metadata?.image_url,
        item.image,
        item.photo,
        item.avatar,
        item.logo,
    ]);
    const imageVersion = firstDefinedImageValue([
        item.imageVersion,
        item.image_version,
        item.photoVersion,
        item.photo_version,
        item.avatarVersion,
        item.avatar_version,
        item.logoVersion,
        item.logo_version,
        item.metadata?.imageVersion,
        item.metadata?.image_version,
        item.updatedAt,
        item.updated_at,
    ]);

    if (imageUrl) {
        next.image = normalizeIdentityString(item.image) || imageUrl;
        next.imageUrl = normalizeIdentityString(item.imageUrl) || imageUrl;
    }

    if (imageVersion) {
        next.imageVersion = normalizeIdentityString(item.imageVersion) || imageVersion;
    }

    return next;
};

type PullScope = {
    tenantId: string | null;
    companyId: string | null;
    storeId: string | null;
    warehouseId: string | null;
    allowedCategories: string[];
};

const parseCsvList = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.map(entry => String(entry).trim().toLowerCase()).filter(Boolean);
    }

    if (typeof value === 'string') {
        return value.split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean);
    }

    return [];
};

const resolvePullScope = (req: Request): PullScope => ({
    tenantId: normalizeIdentityString(req.query.tenant_id) || normalizeIdentityString(req.body?.tenant_id),
    companyId: normalizeIdentityString(req.query.company_id) || normalizeIdentityString(req.body?.company_id),
    storeId: normalizeIdentityString(req.query.store_id) || normalizeIdentityString(req.body?.store_id),
    warehouseId: normalizeIdentityString(req.query.warehouse_id) || normalizeIdentityString(req.body?.warehouse_id),
    allowedCategories: parseCsvList(req.query.allowedCategories ?? req.body?.allowedCategories),
});

const buildPlaceholders = (size: number) => Array.from({ length: size }, () => '?').join(', ');

const hydrateScopedRows = (collection: string, rows: any[]): any[] => {
    const jsonFields: Record<string, string[]> = {
        products: ['images', 'attributes', 'variants', 'tariffs', 'stockBalances', 'activeInWarehouses', 'appliedTaxIds', 'warehouseSettings', 'availableModifiers', 'operationalFlags', 'recipeDetails'],
        customers: ['tags', 'addresses'],
        transactions: ['items', 'payments', 'customerSnapshot', 'relatedTransactions'],
    };

    const booleanFields: Record<string, string[]> = {
        warehouses: ['allowPosSale', 'allowNegativeStock', 'isMain'],
        customers: ['requiresFiscalInvoice', 'prefersEmail', 'isTaxExempt', 'applyChainedTax'],
        transactions: ['isTaxIncluded'],
        products: ['hasActivePromotion', 'is_sellable'],
    };

    return rows.map(row => {
        const next = { ...row };

        for (const field of jsonFields[collection] || []) {
            if (typeof next[field] === 'string' && next[field] !== null) {
                try {
                    next[field] = JSON.parse(next[field]);
                } catch {
                    next[field] = null;
                }
            }
        }

        for (const field of booleanFields[collection] || []) {
            if (!(field in next)) continue;

            if (field === 'is_sellable' && (next[field] === null || next[field] === undefined)) {
                next[field] = true;
            } else {
                next[field] = next[field] === 1;
            }
        }

        return next;
    });
};

const filterSyncItemsForCollection = (collection: string, items: any[]): any[] => {
    if (collection !== 'transactions') return items;

    return items.filter((txn: any) => {
        const id = typeof txn?.id === 'string' ? txn.id.trim() : '';
        const displayId = typeof txn?.displayId === 'string' ? txn.displayId.trim() : '';
        const documentType = typeof txn?.documentType === 'string' ? txn.documentType.trim().toUpperCase() : '';

        if (id.startsWith('ORD-') && !displayId && !documentType) return false;
        return true;
    });
};

const queryScopedCollection = (collection: string, scope: PullScope): any[] => {
    const params: any[] = [];

    switch (collection) {
        case 'products': {
            const where = [`COALESCE(p.deleted_at, '') = ''`];

            if (scope.tenantId) {
                where.push(`COALESCE(p.tenant_id, ps.tenant_id, w.tenant_id) = ?`);
                params.push(scope.tenantId);
            }
            if (scope.companyId) {
                where.push(`COALESCE(p.company_id, ps.company_id, w.company_id) = ?`);
                params.push(scope.companyId);
            }
            if (scope.storeId) {
                where.push(`COALESCE(ps.store_id, w.store_id, w.storeId, p.store_id) = ?`);
                params.push(scope.storeId);
            }
            if (scope.warehouseId) {
                where.push(`COALESCE(ps.warehouse_id, ps.warehouseId, w.id) = ?`);
                params.push(scope.warehouseId);
            }
            if (scope.allowedCategories.length > 0) {
                where.push(`LOWER(COALESCE(p.category, '')) IN (${buildPlaceholders(scope.allowedCategories.length)})`);
                params.push(...scope.allowedCategories);
            }

            const rows = db.prepare(`
                SELECT DISTINCT p.*
                FROM products p
                LEFT JOIN product_stocks ps
                    ON ps.productId = p.id
                   AND COALESCE(ps.deleted_at, '') = ''
                LEFT JOIN warehouses w
                    ON w.id = ps.warehouseId
                   AND COALESCE(w.deleted_at, '') = ''
                WHERE ${where.join(' AND ')}
            `).all(...params) as any[];

            return hydrateScopedRows('products', rows);
        }

        case 'customers': {
            const where = [`COALESCE(deleted_at, '') = ''`];

            if (scope.tenantId) {
                where.push(`tenant_id = ?`);
                params.push(scope.tenantId);
            }
            if (scope.companyId) {
                where.push(`company_id = ?`);
                params.push(scope.companyId);
            }
            if (scope.storeId) {
                where.push(`(COALESCE(store_id, '') = '' OR store_id = ?)`);
                params.push(scope.storeId);
            }

            const rows = db.prepare(`
                SELECT *
                FROM customers
                WHERE ${where.join(' AND ')}
            `).all(...params) as any[];

            return hydrateScopedRows('customers', rows);
        }

        case 'warehouses': {
            const where = [`COALESCE(deleted_at, '') = ''`];

            if (scope.tenantId) {
                where.push(`tenant_id = ?`);
                params.push(scope.tenantId);
            }
            if (scope.companyId) {
                where.push(`company_id = ?`);
                params.push(scope.companyId);
            }
            if (scope.storeId) {
                where.push(`COALESCE(store_id, storeId) = ?`);
                params.push(scope.storeId);
            }
            if (scope.warehouseId) {
                where.push(`id = ?`);
                params.push(scope.warehouseId);
            }

            const rows = db.prepare(`
                SELECT *
                FROM warehouses
                WHERE ${where.join(' AND ')}
            `).all(...params) as any[];

            return hydrateScopedRows('warehouses', rows);
        }

        case 'productStocks': {
            const where = [
                `COALESCE(ps.deleted_at, '') = ''`,
                `COALESCE(p.deleted_at, '') = ''`,
                `COALESCE(w.deleted_at, '') = ''`,
            ];

            if (scope.tenantId) {
                where.push(`COALESCE(ps.tenant_id, p.tenant_id, w.tenant_id) = ?`);
                params.push(scope.tenantId);
            }
            if (scope.companyId) {
                where.push(`COALESCE(ps.company_id, p.company_id, w.company_id) = ?`);
                params.push(scope.companyId);
            }
            if (scope.storeId) {
                where.push(`COALESCE(ps.store_id, w.store_id, w.storeId) = ?`);
                params.push(scope.storeId);
            }
            if (scope.warehouseId) {
                where.push(`COALESCE(ps.warehouse_id, ps.warehouseId, w.id) = ?`);
                params.push(scope.warehouseId);
            }
            if (scope.allowedCategories.length > 0) {
                where.push(`LOWER(COALESCE(p.category, '')) IN (${buildPlaceholders(scope.allowedCategories.length)})`);
                params.push(...scope.allowedCategories);
            }

            const rows = db.prepare(`
                SELECT ps.*
                FROM product_stocks ps
                INNER JOIN products p ON p.id = ps.productId
                INNER JOIN warehouses w ON w.id = ps.warehouseId
                WHERE ${where.join(' AND ')}
            `).all(...params) as any[];

            return hydrateScopedRows('productStocks', rows);
        }

        case 'inventoryLedger': {
            const where = [
                `COALESCE(il.deleted_at, '') = ''`,
                `COALESCE(p.deleted_at, '') = ''`,
                `COALESCE(w.deleted_at, '') = ''`,
            ];

            if (scope.tenantId) {
                where.push(`COALESCE(il.tenant_id, p.tenant_id, w.tenant_id) = ?`);
                params.push(scope.tenantId);
            }
            if (scope.companyId) {
                where.push(`COALESCE(il.company_id, p.company_id, w.company_id) = ?`);
                params.push(scope.companyId);
            }
            if (scope.storeId) {
                where.push(`COALESCE(il.store_id, w.store_id, w.storeId) = ?`);
                params.push(scope.storeId);
            }
            if (scope.warehouseId) {
                where.push(`COALESCE(il.warehouse_id, il.warehouseId, w.id) = ?`);
                params.push(scope.warehouseId);
            }
            if (scope.allowedCategories.length > 0) {
                where.push(`LOWER(COALESCE(p.category, '')) IN (${buildPlaceholders(scope.allowedCategories.length)})`);
                params.push(...scope.allowedCategories);
            }

            const rows = db.prepare(`
                SELECT il.*
                FROM inventory_ledger il
                LEFT JOIN products p ON p.id = il.productId
                LEFT JOIN warehouses w ON w.id = COALESCE(il.warehouse_id, il.warehouseId)
                WHERE ${where.join(' AND ')}
            `).all(...params) as any[];

            return hydrateScopedRows('inventoryLedger', rows);
        }

        case 'transactions': {
            const where = [`COALESCE(deleted_at, '') = ''`];

            if (scope.tenantId) {
                where.push(`tenant_id = ?`);
                params.push(scope.tenantId);
            }
            if (scope.companyId) {
                where.push(`company_id = ?`);
                params.push(scope.companyId);
            }
            if (scope.storeId) {
                where.push(`store_id = ?`);
                params.push(scope.storeId);
            }
            if (scope.warehouseId) {
                where.push(`warehouse_id = ?`);
                params.push(scope.warehouseId);
            }

            const rows = db.prepare(`
                SELECT *
                FROM transactions
                WHERE ${where.join(' AND ')}
            `).all(...params) as any[];

            return filterSyncItemsForCollection('transactions', hydrateScopedRows('transactions', rows));
        }

        default:
            return getCollectionForSync(collection);
    }
};

const SCOPED_COLLECTIONS = new Set([
    'products',
    'customers',
    'warehouses',
    'productStocks',
    'inventoryLedger',
    'transactions',
]);

const mustUseScopedPull = (collection: string, scope: PullScope): boolean =>
    SCOPED_COLLECTIONS.has(collection) &&
    Boolean(scope.tenantId || scope.companyId || scope.storeId || scope.warehouseId || scope.allowedCategories.length > 0);

const quoteSqlIdentifier = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

const getTableColumns = (table: string) =>
    db.prepare(`PRAGMA table_info(${quoteSqlIdentifier(table)})`).all() as Array<{ name: string }>;

const hasColumn = (columns: Array<{ name: string }>, column: string) =>
    columns.some(col => col.name === column);

const resolveIncomingUpdatedAt = (item: any, fallback: string): string =>
    normalizeIdentityString(item?.updated_at) ||
    normalizeIdentityString(item?.updatedAt) ||
    normalizeIdentityString(item?.date) ||
    normalizeIdentityString(item?.createdAt) ||
    fallback;

const normalizeAuditEnvelope = (rawItem: any, now: string) => ({
    ...rawItem,
    updated_at: resolveIncomingUpdatedAt(rawItem, now),
    deleted_at:
        normalizeIdentityString(rawItem?.deleted_at) ||
        normalizeIdentityString(rawItem?.deletedAt) ||
        (rawItem?._op === 'DELETE' || rawItem?.isActive === false ? now : null),
});

const softDeleteStructuredRow = (table: string, id: string, deletedAt: string) => {
    const columns = getTableColumns(table);
    if (!columns.length) return;

    const hasDataColumn = hasColumn(columns, 'data');
    if (hasDataColumn) {
        const existing = db.prepare(`SELECT data FROM ${quoteSqlIdentifier(table)} WHERE id = ?`).get(id) as any;
        const currentData = existing?.data ? JSON.parse(existing.data) : {};
        const nextPayload = {
            ...currentData,
            deleted_at: deletedAt,
            updated_at: deletedAt,
            isActive: false,
        };

        const assignments: string[] = ['data = ?'];
        const values: any[] = [JSON.stringify(nextPayload)];

        if (hasColumn(columns, 'updated_at')) {
            assignments.push('updated_at = ?');
            values.push(deletedAt);
        }
        if (hasColumn(columns, 'deleted_at')) {
            assignments.push('deleted_at = ?');
            values.push(deletedAt);
        }

        values.push(id);
        db.prepare(`UPDATE ${quoteSqlIdentifier(table)} SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
        return;
    }

    const assignments: string[] = [];
    const values: any[] = [];

    if (hasColumn(columns, 'updated_at')) {
        assignments.push('updated_at = ?');
        values.push(deletedAt);
    }
    if (hasColumn(columns, 'deleted_at')) {
        assignments.push('deleted_at = ?');
        values.push(deletedAt);
    }
    if (hasColumn(columns, 'updatedAt')) {
        assignments.push('updatedAt = ?');
        values.push(deletedAt);
    }
    if (hasColumn(columns, 'deletedAt')) {
        assignments.push('deletedAt = ?');
        values.push(deletedAt);
    }
    if (hasColumn(columns, 'isActive')) {
        assignments.push('isActive = 0');
    }

    if (assignments.length === 0) return;

    values.push(id);
    db.prepare(`UPDATE ${quoteSqlIdentifier(table)} SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
};

const softDeleteMissingRows = (table: string, incomingIds: string[], deletedAt: string) => {
    const columns = getTableColumns(table);
    if (!columns.length || !hasColumn(columns, 'deleted_at')) return;

    const rows = db.prepare(
        `SELECT id FROM ${quoteSqlIdentifier(table)} WHERE COALESCE(deleted_at, '') = ''`
    ).all() as Array<{ id: string }>;

    const incoming = new Set(incomingIds.map(id => String(id)));
    for (const row of rows) {
        if (!incoming.has(String(row.id))) {
            softDeleteStructuredRow(table, String(row.id), deletedAt);
        }
    }
};

const APPEND_ONLY_COLLECTIONS = new Set([
    'transactions',
    'inventoryLedger',
    'cashMovements',
    'zReports',
    'wallet_transactions',
    'loyalty_events',
]);

const LWW_COLLECTIONS = new Set([
    'products',
    'customers',
    'suppliers',
    'users',
    'roles',
    'warehouses',
    'paymentMethods',
    'internalSequences',
    'fiscalRanges',
]);

const toMillis = (value: any): number => {
    const raw = normalizeIdentityString(value);
    if (!raw) return 0;
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

const incomingWinsLww = (incoming: any, current: any): boolean => {
    const incomingTs = Math.max(
        toMillis(incoming?.updated_at),
        toMillis(incoming?.updatedAt),
        toMillis(incoming?.date),
        toMillis(incoming?.createdAt)
    );

    const currentTs = Math.max(
        toMillis(current?.updated_at),
        toMillis(current?.updatedAt),
        toMillis(current?.date),
        toMillis(current?.createdAt)
    );

    return incomingTs >= currentTs;
};

const readExistingStructuredItem = (
    table: string,
    id: string,
    columns: Array<{ name: string }>,
    hasDataColumn: boolean
) => {
    const row = db.prepare(`SELECT ${columns.map(column => quoteSqlIdentifier(column.name)).join(', ')} FROM ${quoteSqlIdentifier(table)} WHERE id = ?`).get(id) as any;
    if (!row) return null;

    if (hasDataColumn && row.data) {
        try {
            return { ...row, ...JSON.parse(row.data) };
        } catch {
            return row;
        }
    }

    return row;
};

const normalizeTransactionIdentity = (txn: any) => {
    const sourceChannel = normalizeIdentityString(txn?.source_channel) || 'POS';
    const sourceTransactionId = normalizeIdentityString(txn?.source_transaction_id) || normalizeIdentityString(txn?.id);

    if (!sourceTransactionId) {
        throw new Error('Transaction payload missing source_transaction_id/id');
    }

    const sourceDisplayId = normalizeIdentityString(txn?.source_display_id) || normalizeIdentityString(txn?.displayId);
    const sourceTerminalId = normalizeIdentityString(txn?.source_terminal_id) || normalizeIdentityString(txn?.terminalId);
    const deviceId = normalizeIdentityString(txn?.device_id);
    const originalTransactionId =
        normalizeIdentityString(txn?.original_transaction_id) ||
        normalizeIdentityString(txn?.originalTransactionId);
    const originalDisplayId =
        normalizeIdentityString(txn?.original_display_id) ||
        normalizeIdentityString(txn?.affectedInvoiceNumber);

    const isCreditNote = txn?.documentType === 'REFUND' || txn?.ncfType === 'B04';
    const sourceCreditNoteId = isCreditNote
        ? normalizeIdentityString(txn?.source_credit_note_id) || sourceTransactionId
        : normalizeIdentityString(txn?.source_credit_note_id);

    return {
        ...txn,
        source_channel: sourceChannel,
        source_transaction_id: sourceTransactionId,
        source_display_id: sourceDisplayId || undefined,
        source_terminal_id: sourceTerminalId || undefined,
        device_id: deviceId || undefined,
        source_credit_note_id: sourceCreditNoteId || undefined,
        original_transaction_id: originalTransactionId || undefined,
        original_display_id: originalDisplayId || undefined,
        displayId: normalizeIdentityString(txn?.displayId) || sourceDisplayId || undefined,
        terminalId: normalizeIdentityString(txn?.terminalId) || sourceTerminalId || undefined,
        originalTransactionId: normalizeIdentityString(txn?.originalTransactionId) || originalTransactionId || undefined,
        affectedInvoiceNumber: normalizeIdentityString(txn?.affectedInvoiceNumber) || originalDisplayId || undefined
    };
};

const canonicalizeTransactionForLocalPersistence = (txn: any) => {
    const normalizedTxn = normalizeTransactionForSync(normalizeTransactionIdentity(txn));
    const technicalId = normalizedTxn.source_transaction_id || normalizedTxn.id;

    return {
        ...normalizedTxn,
        id: technicalId,
    };
};

const appendSyncWarning = (existingMessage: any, warning: string): string => {
    const current = typeof existingMessage === 'string' ? existingMessage.trim() : '';
    if (!current) return warning;
    if (current.includes(warning)) return current;
    return `${current} | ${warning}`;
};

const buildVisualCollisionWarning = (
    kind: 'displayId' | 'ncf',
    value: string,
    existingId: string,
    incomingId: string
): string => `VISUAL_SEQUENCE_COLLISION(${kind}=${value}, existingId=${existingId}, incomingId=${incomingId})`;

const insertChangeStmt = db.prepare(`
    INSERT INTO sync_changes (collection, itemId, version, op, payload, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
`);

const ERP_FORWARD_QUEUE_SETTING = 'pending_erp_transactions';
let erpForwardTimer: ReturnType<typeof setTimeout> | null = null;
let erpForwardInFlight = false;

type PendingErpForward = {
    id: string;
    txn: any;
    erpBaseUrlOverride?: string | null;
    authTerminalId?: string | null;
    attempts: number;
    createdAt: string;
    updatedAt: string;
    nextAttemptAt?: string | null;
    lastError?: string | null;
};

const asPendingErpForwardArray = (): PendingErpForward[] => {
    const value = getSetting(ERP_FORWARD_QUEUE_SETTING);
    return Array.isArray(value) ? value.filter((entry: any) => entry?.id && entry?.txn) : [];
};

const savePendingErpForwardArray = (items: PendingErpForward[]) => {
    saveSetting(ERP_FORWARD_QUEUE_SETTING, items);
};

const resolveErpForwardId = (txn: any): string =>
    normalizeIdentityString(txn?.source_transaction_id) ||
    normalizeIdentityString(txn?.id) ||
    normalizeIdentityString(txn?.displayId) ||
    `ERP-FWD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const resolveErpForwardAuthTerminalId = (txn: any, fallback?: string | null): string | null =>
    normalizeIdentityString(fallback) ||
    normalizeIdentityString(txn?.source_terminal_id) ||
    normalizeIdentityString(txn?.terminalId) ||
    normalizeIdentityString(txn?.terminal_id);

const summarizeErpForwardEntry = (entry: PendingErpForward) => ({
    id: entry.id,
    displayId:
        normalizeIdentityString(entry.txn?.displayId) ||
        normalizeIdentityString(entry.txn?.source_display_id) ||
        normalizeIdentityString(entry.txn?.sourceDisplayId) ||
        null,
    ncf: normalizeIdentityString(entry.txn?.ncf) || normalizeIdentityString(entry.txn?.electronicNcf) || null,
    terminalId:
        normalizeIdentityString(entry.txn?.terminalId) ||
        normalizeIdentityString(entry.txn?.source_terminal_id) ||
        normalizeIdentityString(entry.authTerminalId) ||
        null,
    attempts: entry.attempts || 0,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    nextAttemptAt: entry.nextAttemptAt || null,
    lastError: entry.lastError || null
});

const scheduleErpForwardFlush = (delayMs = 0) => {
    if (erpForwardTimer) return;
    erpForwardTimer = setTimeout(() => {
        erpForwardTimer = null;
        void flushPendingErpForwards();
    }, delayMs);
    (erpForwardTimer as any).unref?.();
};

const enqueueErpForward = (
    transactions: any[],
    options: { erpBaseUrlOverride?: string | null; authTerminalId?: string | null }
): number => {
    const forwardableTransactions = transactions.filter((txn: any) => !shouldSkipErpForward(txn));
    if (!forwardableTransactions.length) return 0;

    const now = new Date().toISOString();
    const queue = asPendingErpForwardArray();
    const queueById = new Map(queue.map((entry) => [entry.id, entry]));

    forwardableTransactions.forEach((txn: any) => {
        const id = resolveErpForwardId(txn);
        const existing = queueById.get(id);

        queueById.set(id, {
            id,
            txn,
            erpBaseUrlOverride: options.erpBaseUrlOverride ?? existing?.erpBaseUrlOverride ?? null,
            authTerminalId: resolveErpForwardAuthTerminalId(txn, options.authTerminalId ?? existing?.authTerminalId ?? null),
            attempts: existing?.attempts ?? 0,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            nextAttemptAt: null,
            lastError: existing?.lastError ?? null
        });
    });

    savePendingErpForwardArray(Array.from(queueById.values()));
    scheduleErpForwardFlush(0);
    return forwardableTransactions.length;
};

const shouldSkipErpForward = (txn: any): boolean =>
    Boolean(
        txn?.skipErpSaleSync
        || txn?.skip_erp_sale_sync
        || txn?.marketplaceSourceChannel === 'UBER_EATS'
        || txn?.marketplace_source_channel === 'UBER_EATS'
    );

const isForwardableSaleTransaction = (txn: any): boolean => {
    if (!txn || typeof txn !== 'object') return false;
    const documentType = (normalizeIdentityString(txn.documentType) || '').toUpperCase();
    if (documentType && !['TICKET', 'INVOICE', 'REFUND', 'CREDIT_NOTE'].includes(documentType)) return false;

    const id = normalizeIdentityString(txn.id);
    if (id?.startsWith('ORD-')) return false;

    const dateRaw = normalizeIdentityString(txn.date) || normalizeIdentityString(txn.createdAt) || normalizeIdentityString(txn.updatedAt);
    const dateMs = dateRaw ? Date.parse(dateRaw) : Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (Number.isFinite(dateMs) && dateMs < Date.now() - sevenDaysMs) return false;

    const syncStatus = (normalizeIdentityString(txn.syncStatus) || '').toUpperCase();
    const fiscalSyncStatus = (normalizeIdentityString(txn.fiscalSyncStatus) || '').toUpperCase();
    return (
        ['PENDING', 'ERROR', 'SYNCING', ''].includes(syncStatus) ||
        ['PENDING', 'ERROR'].includes(fiscalSyncStatus)
    );
};

const requeueLegacyErpForwardTransactions = (): number => {
    const existingIds = new Set(asPendingErpForwardArray().map((entry) => entry.id));
    const candidates = new Map<string, any>();

    const addCandidate = (txn: any) => {
        if (!isForwardableSaleTransaction(txn)) return;
        if (shouldSkipErpForward(txn)) return;
        const id = resolveErpForwardId(txn);
        if (existingIds.has(id) || candidates.has(id)) return;
        candidates.set(id, coerceTransactionItemsForErp(txn));
    };

    const pendingTransactions = getSetting('pending_transactions') || [];
    if (Array.isArray(pendingTransactions)) {
        pendingTransactions.forEach(addCandidate);
    }

    const storedTransactions = getCollection('transactions');
    if (Array.isArray(storedTransactions)) {
        storedTransactions.forEach(addCandidate);
    }

    if (!candidates.size) return 0;
    return enqueueErpForward(Array.from(candidates.values()), {
        erpBaseUrlOverride: null,
        authTerminalId: null
    });
};

const markErpForwardDelivered = (entry: PendingErpForward) => {
    const candidateIds = Array.from(new Set([
        normalizeIdentityString(entry.id),
        normalizeIdentityString(entry.txn?.id),
        normalizeIdentityString(entry.txn?.source_transaction_id)
    ].filter(Boolean) as string[]));

    if (candidateIds.length > 0) {
        const placeholders = candidateIds.map(() => '?').join(', ');
        try {
            db.prepare(`UPDATE transactions SET syncStatus = 'COMPLETED', syncError = NULL WHERE id IN (${placeholders})`).run(...candidateIds);
        } catch (error) {
            console.warn(`[ERP_FORWARD_QUEUE] Could not mark local transaction as COMPLETED for ${entry.id}`, error);
        }

        const pendingTransactions = getSetting('pending_transactions') || [];
        if (Array.isArray(pendingTransactions)) {
            saveSetting(
                'pending_transactions',
                pendingTransactions.filter((txn: any) => !candidateIds.includes(resolveErpForwardId(txn)))
            );
        }
    }
};

async function flushPendingErpForwards() {
    if (erpForwardInFlight) return;
    erpForwardInFlight = true;

    try {
        let queue = asPendingErpForwardArray();
        if (!queue.length) {
            requeueLegacyErpForwardTransactions();
            queue = asPendingErpForwardArray();
        }
        if (!queue.length) return;

        const nowMs = Date.now();
        let changed = false;

        for (const entry of [...queue]) {
            const nextAttemptMs = entry.nextAttemptAt ? Date.parse(entry.nextAttemptAt) : 0;
            if (Number.isFinite(nextAttemptMs) && nextAttemptMs > nowMs) continue;

            try {
                const summary = await forwardTransactionsToErpInbox([entry.txn], {
                    erpBaseUrlOverride: entry.erpBaseUrlOverride || null,
                    authTerminalId: entry.authTerminalId || null
                });

                if (!summary.skipped && !summary.failed) {
                    queue = queue.filter((queued) => queued.id !== entry.id);
                    changed = true;
                    markErpForwardDelivered(entry);
                    console.log(`[ERP_FORWARD_QUEUE] forwarded tx=${entry.id}`);
                    savePendingErpForwardArray(queue);
                    continue;
                }

                const error = summary.skipped
                    ? `SKIPPED:${summary.reason || 'UNKNOWN'}`
                    : JSON.stringify(summary.results || []).slice(0, 1000);
                throw new Error(error);
            } catch (error: any) {
                const attempts = (entry.attempts || 0) + 1;
                const backoffMs = Math.min(5 * 60_000, 15_000 * Math.max(1, attempts));
                const updated: PendingErpForward = {
                    ...entry,
                    attempts,
                    updatedAt: new Date().toISOString(),
                    nextAttemptAt: new Date(Date.now() + backoffMs).toISOString(),
                    lastError: error?.message || String(error)
                };
                queue = queue.map((queued) => queued.id === entry.id ? updated : queued);
                changed = true;
                console.warn(`[ERP_FORWARD_QUEUE] retry scheduled tx=${entry.id} attempts=${attempts} error=${updated.lastError}`);
                savePendingErpForwardArray(queue);
            }
        }

        if (changed) {
            savePendingErpForwardArray(queue);
        }

        if (queue.length) {
            scheduleErpForwardFlush(30_000);
        }
    } finally {
        erpForwardInFlight = false;
    }
}

(setInterval(() => void flushPendingErpForwards(), 30_000) as any).unref?.();

const clearChangesForCollection = (collection: string) => {
    db.prepare("DELETE FROM sync_changes WHERE collection = ?").run(collection);
};

const pruneOrphanOpenOrdersFromTransactions = () => {
    try {
        const txTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'").get();
        const tablesTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tables'").get();
        if (!txTableExists || !tablesTableExists) return;

        const countRow = db.prepare(`
            SELECT COUNT(*) AS count
            FROM transactions t
            WHERE t.id LIKE 'ORD-%'
              AND COALESCE(t.status, '') = 'ABIERTA'
              AND COALESCE(t.total, 0) = 0
              AND COALESCE(t.displayId, '') = ''
              AND COALESCE(t.documentType, '') = ''
              AND NOT EXISTS (
                  SELECT 1
                  FROM tables tb
                  WHERE tb.currentOrderId = t.id
              )
        `).get() as any;

        const toDelete = Number(countRow?.count || 0);
        if (toDelete <= 0) return;

        db.prepare(`
            DELETE FROM transactions
            WHERE id IN (
                SELECT t.id
                FROM transactions t
                WHERE t.id LIKE 'ORD-%'
                  AND COALESCE(t.status, '') = 'ABIERTA'
                  AND COALESCE(t.total, 0) = 0
                  AND COALESCE(t.displayId, '') = ''
                  AND COALESCE(t.documentType, '') = ''
                  AND NOT EXISTS (
                      SELECT 1
                      FROM tables tb
                      WHERE tb.currentOrderId = t.id
                  )
            )
        `).run();

        // Force clients to refresh transactions snapshot after cleanup.
        clearChangesForCollection('transactions');
        const newVersion = bumpVersion('transactions');
        updateMetadata('transactions', newVersion, newVersion);

        console.warn(`[Sync] Pruned ${toDelete} orphan ORD-* rows from transactions.`);
    } catch (error) {
        console.warn('[Sync] Failed to prune orphan ORD-* transactions:', error);
    }
};

pruneOrphanOpenOrdersFromTransactions();

/**
 * GET /api/sync/ping
 */
router.get('/ping', (req, res) => {
    res.json({ success: true, message: 'pong', serverTime: new Date().toISOString() });
});

router.get('/identify', (req, res) => {
    try {
        const businessConfig = getSetting('businessConfig') || {};

        res.json({
            status: 'online',
            app: 'CLIC-POS',
            role: 'MASTER',
            storeId: businessConfig.storeId || 'UNKNOWN',
            serverTime: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('Error in /identify:', error);
        res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
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

    // Security: Validate Device Token (Prevent Hijacking)
    if (!deviceToken) {
        return res.status(403).json({ success: false, message: 'Device token required', code: 'MISSING_TOKEN' });
    }

    const existing = db.prepare("SELECT deviceToken FROM connected_terminals WHERE terminalId = ?").get(terminalId) as any;
    if (existing && existing.deviceToken && existing.deviceToken !== deviceToken) {
        console.warn(`⚠️ [Sync] Token mismatch for ${terminalId}. Overwriting old token (Trust-on-First-Use)`);
        // We allow re-registration to support browser data clearing/re-installs
    }

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
        const scope = resolvePullScope(req);
        const items = mustUseScopedPull(collection, scope)
            ? queryScopedCollection(collection, scope)
            : getCollectionForSync(collection);
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
        const scope = resolvePullScope(req);

        const requestedVersion = sinceVersion ? parseInt(sinceVersion as string) : 0;

        // SPECIAL CASE: 'config' is a singleton object, not an array
        if (collection === 'config') {
            if (requestedVersion >= latestVersion && latestVersion > 0) {
                return res.json({ success: true, items: [], serverTime: new Date().toISOString(), isFullDownload: false, latestVersion });
            }
            return res.json({ success: true, items: items ? [items] : [], serverTime: new Date().toISOString(), isFullDownload: true, latestVersion });
        }

        if (mustUseScopedPull(collection, scope)) {
            const scopedItems = queryScopedCollection(collection, scope);
            return res.json({
                success: true,
                items: scopedItems,
                serverTime: new Date().toISOString(),
                isFullDownload: true,
                latestVersion
            });
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
                return {
                    id: r.itemId,
                    deletedAt: payload.deletedAt || payload.deleted_at || new Date().toISOString(),
                    deleted_at: payload.deleted_at || payload.deletedAt || new Date().toISOString(),
                    _op: 'DELETE'
                };
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
 * GET /api/sync/products/images/manifest
 * Lightweight image channel: returns only image fingerprints to detect drift.
 */
router.get('/products/images/manifest', async (req, res) => {
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
        const metadata = ensureMetadata('products');
        const sinceVersion = req.query.sinceVersion ? parseInt(req.query.sinceVersion as string, 10) : 0;

        if (sinceVersion >= metadata.version) {
            return res.json({
                success: true,
                items: [],
                version: metadata.version,
                upToDate: true,
                serverTime: new Date().toISOString()
            });
        }

        const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
        const requestedIds = new Set(
            idsParam.split(',').map(id => id.trim()).filter(Boolean)
        );

        const products = getCollectionForSync('products');
        const scopedProducts = requestedIds.size > 0
            ? products.filter((product: any) => requestedIds.has(product.id))
            : products;

        const items = scopedProducts
            .filter((product: any) => product?.id)
            .map((product: any) => {
                const { image, images } = normalizeProductImages(product);
                return {
                    id: product.id,
                    hash: buildProductImageHash(product),
                    hasImage: !!image || images.length > 0,
                    updatedAt: product.updatedAt || product.createdAt || null
                };
            });

        res.json({
            success: true,
            items,
            version: metadata.version,
            upToDate: false,
            serverTime: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/products/images/pull
 * Fetch images only for a subset of products.
 */
router.post('/products/images/pull', async (req, res) => {
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
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'ids must be a non-empty array' });
        }

        const MAX_BATCH = 300;
        if (ids.length > MAX_BATCH) {
            return res.status(400).json({ success: false, message: `Maximum ${MAX_BATCH} ids per request` });
        }

        const requestedIds = new Set(ids.map((id: any) => String(id)));
        const products = getCollectionForSync('products');

        const items = products
            .filter((product: any) => requestedIds.has(String(product?.id)))
            .map((product: any) => {
                const { image, images } = normalizeProductImages(product);
                return {
                    id: product.id,
                    image,
                    images,
                    hash: buildProductImageHash(product),
                    updatedAt: product.updatedAt || product.createdAt || null
                };
            });

        res.json({
            success: true,
            items,
            itemCount: items.length,
            serverTime: new Date().toISOString()
        });
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
        let ignoredCount = 0;

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
                    // Full replace (force push) without physical deletes:
                    // upsert incoming active rows, apply tombstones from incoming when present,
                    // then soft-delete active rows that are missing from the incoming snapshot.
                    const activeIncomingIds: string[] = [];

                    if (hasDataColumn) {
                        const stmt = db.prepare(`INSERT INTO ${resolvedCollection} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`);
                        for (const rawItem of items) {
                            if (!rawItem?.id) continue;
                            const item = normalizeAuditEnvelope(normalizeMasterDataImageFields(collection, rawItem), now);
                            const existingRow = readExistingStructuredItem(resolvedCollection, item.id, columns, hasDataColumn);

                            if (item.deleted_at) {
                                if (existingRow) {
                                    softDeleteStructuredRow(resolvedCollection, String(item.id), item.deleted_at);
                                } else {
                                    ignoredCount++;
                                }
                                continue;
                            }

                            stmt.run(item.id, JSON.stringify({ ...item, deleted_at: null }));
                            activeIncomingIds.push(String(item.id));
                        }
                    } else {
                        const colNames = columns.map(c => c.name);
                        const placeholders = colNames.map(() => '?').join(',');
                        const updateSet = colNames.map(c => `${c}=excluded.${c}`).join(',');
                        const stmt = db.prepare(`INSERT INTO ${resolvedCollection} (${colNames.join(',')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`);
                        const fieldsToStringify = jsonFields[collection] || [];

                        for (const rawItem of items) {
                            if (!rawItem?.id) continue;
                            const item = normalizeAuditEnvelope(normalizeMasterDataImageFields(collection, rawItem), now);
                            const existingRow = readExistingStructuredItem(resolvedCollection, item.id, columns, hasDataColumn);

                            if (item.deleted_at) {
                                if (existingRow) {
                                    softDeleteStructuredRow(resolvedCollection, String(item.id), item.deleted_at);
                                } else {
                                    ignoredCount++;
                                }
                                continue;
                            }

                            const values = colNames.map(col => {
                                if (col === 'updated_at') return item.updated_at;
                                if (col === 'deleted_at') return null;

                                let val = item[col];
                                if (fieldsToStringify.includes(col)) {
                                    return typeof val === 'object' ? JSON.stringify(val) : (val || '[]');
                                }
                                if (typeof val === 'boolean') return val ? 1 : 0;
                                if (val === undefined) return null;
                                return val;
                            });
                            stmt.run(...values);
                            activeIncomingIds.push(String(item.id));
                        }
                    }

                    softDeleteMissingRows(resolvedCollection, activeIncomingIds, now);

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

                        const item = normalizeAuditEnvelope(normalizeMasterDataImageFields(collection, rawItem), now);
                        const op = item.deleted_at ? 'DELETE' : 'UPSERT';
                        const existingRow = readExistingStructuredItem(resolvedCollection, item.id, columns, hasDataColumn);

                        if (APPEND_ONLY_COLLECTIONS.has(collection)) {
                            if (existingRow) {
                                ignoredCount++;
                                continue;
                            }

                            if (hasDataColumn && dataStmt) {
                                dataStmt.run(item.id, JSON.stringify({ ...item, deleted_at: null }));
                            } else if (structuredStmt) {
                                const values = colNames.map(col => {
                                    if (col === 'updated_at') return item.updated_at;
                                    if (col === 'deleted_at') return null;

                                    const val = item[col];
                                    if (fieldsToStringify.includes(col)) {
                                        return typeof val === 'object' ? JSON.stringify(val) : (val || '[]');
                                    }
                                    if (typeof val === 'boolean') return val ? 1 : 0;
                                    return val === undefined ? null : val;
                                });
                                structuredStmt.run(...values);
                            }

                            const version = bumpVersion(collection, item.id);
                            insertChangeStmt.run(collection, item.id, version, 'UPSERT', JSON.stringify({ ...item, deleted_at: null }), now);
                            continue;
                        }

                        if (op === 'DELETE') {
                            if (!existingRow) {
                                ignoredCount++;
                                continue;
                            }

                            softDeleteStructuredRow(resolvedCollection, String(item.id), item.deleted_at!);
                            const version = bumpVersion(collection, item.id);
                            insertChangeStmt.run(
                                collection,
                                item.id,
                                version,
                                'DELETE',
                                JSON.stringify({ id: item.id, deleted_at: item.deleted_at, deletedAt: item.deleted_at }),
                                now
                            );
                            continue;
                        }

                        if (LWW_COLLECTIONS.has(collection) && existingRow && !incomingWinsLww(item, existingRow)) {
                            ignoredCount++;
                            continue;
                        }

                        if (hasDataColumn && dataStmt) {
                            const { data: _data, ...currentPayload } = existingRow || {};
                            dataStmt.run(item.id, JSON.stringify({ ...currentPayload, ...item, deleted_at: null }));
                        } else if (structuredStmt) {
                            const values = colNames.map(col => {
                                if (col === 'updated_at') return item.updated_at;
                                if (col === 'deleted_at') return null;

                                let val = item[col];
                                if (val === undefined && existingRow && Object.prototype.hasOwnProperty.call(existingRow, col)) {
                                    val = existingRow[col];
                                }
                                if (fieldsToStringify.includes(col)) {
                                    return typeof val === 'object' ? JSON.stringify(val) : (val || '[]');
                                }
                                if (typeof val === 'boolean') return val ? 1 : 0;
                                return val === undefined ? null : val;
                            });
                            structuredStmt.run(...values);
                        }

                        const version = bumpVersion(collection, item.id);
                        const payload = JSON.stringify({ ...item, deleted_at: null });
                        insertChangeStmt.run(collection, item.id, version, op, payload, now);
                    }

                    updateMetadata(collection, getCurrentVersion(collection), undefined, tokens[authToken]);
                }
            } else {
                // Settings-based collection (array)
                if (pushMode === 'FULL_REPLACE') {
                    saveSetting(collection, items.map((item: any) => item?.id ? normalizeAuditEnvelope(normalizeMasterDataImageFields(collection, item), now) : item));
                    clearChangesForCollection(collection);
                    const newVersion = bumpVersion(collection);
                    updateMetadata(collection, newVersion, newVersion, tokens[authToken]);
                } else {
                    const existing = (getSetting(collection) || []) as any[];
                    const map = new Map(existing.map((i: any) => [i.id, i]));

                    for (const rawItem of items) {
                        if (!rawItem?.id) continue;

                        const item = normalizeAuditEnvelope(normalizeMasterDataImageFields(collection, rawItem), now);
                        const current = map.get(item.id);

                        if (APPEND_ONLY_COLLECTIONS.has(collection)) {
                            if (current) {
                                ignoredCount++;
                                continue;
                            }

                            map.set(item.id, { ...item, deleted_at: null });
                        } else if (item.deleted_at) {
                            if (!current) {
                                ignoredCount++;
                                continue;
                            }

                            map.set(item.id, {
                                ...current,
                                deleted_at: item.deleted_at,
                                updated_at: item.updated_at,
                                isActive: false
                            });
                        } else if (!current || !LWW_COLLECTIONS.has(collection) || incomingWinsLww(item, current)) {
                            map.set(item.id, {
                                ...current,
                                ...item,
                                deleted_at: null
                            });
                        } else {
                            ignoredCount++;
                            continue;
                        }

                        const version = bumpVersion(collection, item.id);
                        const payload = item.deleted_at
                            ? JSON.stringify({ id: item.id, deleted_at: item.deleted_at, deletedAt: item.deleted_at })
                            : JSON.stringify({ ...item, deleted_at: null });
                        insertChangeStmt.run(collection, item.id, version, item.deleted_at ? 'DELETE' : 'UPSERT', payload, now);
                    }

                    saveSetting(collection, Array.from(map.values()));
                    updateMetadata(collection, getCurrentVersion(collection), undefined, tokens[authToken]);
                }
            }
        })();

        res.json({
            success: true,
            version: getCurrentVersion(collection),
            itemCount: getItemCount(collection),
            ignoredCount
        });
    } catch (error: any) {
        console.error(`❌ Error pushing to ${collection}:`, error);
        res.status(500).json({
            success: false,
            message: error.message || 'Sync push failed',
            details: error.stack
        });
    }
});

/**
 * GET /api/sync/wallet/verify/:customerId
 * Real-time balance verification for sensitive payments (Strict Online Mode)
 */
router.get('/wallet/verify/:customerId', async (req, res) => {
    const { customerId } = req.params;
    try {
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'").get();

        let data: any = null;
        if (tableExists) {
            const columns = db.prepare("PRAGMA table_info(customers)").all() as any[];
            const hasDataColumn = columns.some(c => c.name === 'data');
            const raw = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as any;
            if (raw) {
                data = hasDataColumn ? JSON.parse(raw.data) : raw;
            }
        } else {
            const customers = getSetting('customers') || [];
            data = customers.find((c: any) => c.id === customerId);
        }

        if (!data) return res.status(404).json({ success: false, message: 'Customer not found' });

        res.json({
            success: true,
            balance: data.wallet?.balance || 0,
            creditLimit: data.creditLimit || 0
        });
    } catch (error: any) {
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

        const normalizedItems = items.map((txn: any) => canonicalizeTransactionForLocalPersistence(txn));
        let addedCount = 0;
        let conflictResolvedCount = 0;
        let visualCollisionCount = 0;
        const persistedPendingItems: any[] = [];
        const now = new Date().toISOString();
        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO transactions (id, globalSequence, displayId, documentType, seriesId, seriesNumber, date, items, total, payments, userId, userName, terminalId, status, customerId, customerName, customerSnapshot, taxAmount, netAmount, discountAmount, isTaxIncluded, ncf, ncfType, relatedTransactions, originalTransactionId, refundReason, affectedInvoiceNumber, affectedNCF, settlement_currency_code, settlement_exchange_rate, settlement_received_original, settlement_received_base, settlement_applied_base, settlement_change_base, settlement_change_currency_code, syncStatus, syncError) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            const updateStmt = db.prepare(`UPDATE transactions SET globalSequence = ?, displayId = ?, documentType = ?, seriesId = ?, seriesNumber = ?, date = ?, items = ?, total = ?, payments = ?, userId = ?, userName = ?, terminalId = ?, status = ?, customerId = ?, customerName = ?, customerSnapshot = ?, taxAmount = ?, netAmount = ?, discountAmount = ?, isTaxIncluded = ?, ncf = ?, ncfType = ?, relatedTransactions = ?, originalTransactionId = ?, refundReason = ?, affectedInvoiceNumber = ?, affectedNCF = ?, settlement_currency_code = ?, settlement_exchange_rate = ?, settlement_received_original = ?, settlement_received_base = ?, settlement_applied_base = ?, settlement_change_base = ?, settlement_change_currency_code = ?, syncStatus = ?, syncError = ? WHERE id = ?`);
            const byIdStmt = db.prepare(`SELECT id, displayId, terminalId FROM transactions WHERE id = ?`);
            const byDisplayIdStmt = db.prepare(`SELECT id, displayId, terminalId FROM transactions WHERE displayId = ?`);
            const byNcfStmt = db.prepare(`SELECT id, displayId, terminalId, ncf FROM transactions WHERE ncf = ?`);

            const insertTxn = (txn: any) =>
                stmt.run(
                    txn.id,
                    txn.globalSequence,
                    txn.displayId,
                    txn.documentType,
                    txn.seriesId,
                    txn.seriesNumber,
                    txn.date,
                    JSON.stringify(txn.items),
                    txn.total,
                    JSON.stringify(txn.payments),
                    txn.userId,
                    txn.userName,
                    txn.terminalId,
                    txn.status,
                    txn.customerId,
                    txn.customerName,
                    JSON.stringify(txn.customerSnapshot),
                    txn.taxAmount,
                    txn.netAmount,
                    txn.discountAmount,
                    txn.isTaxIncluded ? 1 : 0,
                    txn.ncf,
                    txn.ncfType,
                    JSON.stringify(txn.relatedTransactions),
                    txn.originalTransactionId,
                    txn.refundReason,
                    txn.affectedInvoiceNumber,
                    txn.affectedNCF,
                    normalizeIdentityString(txn.settlement_currency_code) || normalizeIdentityString(txn.settlementCurrencyCode),
                    toNullableFiniteNumber(txn.settlement_exchange_rate ?? txn.settlementExchangeRate),
                    toNullableFiniteNumber(txn.settlement_received_original ?? txn.settlementReceivedOriginal),
                    toNullableFiniteNumber(txn.settlement_received_base ?? txn.settlementReceivedBase),
                    toNullableFiniteNumber(txn.settlement_applied_base ?? txn.settlementAppliedBase),
                    toNullableFiniteNumber(txn.settlement_change_base ?? txn.settlementChangeBase),
                    normalizeIdentityString(txn.settlement_change_currency_code) || normalizeIdentityString(txn.settlementChangeCurrencyCode),
                    txn.syncStatus,
                    txn.syncError
                );

            const updateTxn = (targetId: string, txn: any) =>
                updateStmt.run(
                    txn.globalSequence,
                    txn.displayId,
                    txn.documentType,
                    txn.seriesId,
                    txn.seriesNumber,
                    txn.date,
                    JSON.stringify(txn.items),
                    txn.total,
                    JSON.stringify(txn.payments),
                    txn.userId,
                    txn.userName,
                    txn.terminalId,
                    txn.status,
                    txn.customerId,
                    txn.customerName,
                    JSON.stringify(txn.customerSnapshot),
                    txn.taxAmount,
                    txn.netAmount,
                    txn.discountAmount,
                    txn.isTaxIncluded ? 1 : 0,
                    txn.ncf,
                    txn.ncfType,
                    JSON.stringify(txn.relatedTransactions),
                    txn.originalTransactionId,
                    txn.refundReason,
                    txn.affectedInvoiceNumber,
                    txn.affectedNCF,
                    normalizeIdentityString(txn.settlement_currency_code) || normalizeIdentityString(txn.settlementCurrencyCode),
                    toNullableFiniteNumber(txn.settlement_exchange_rate ?? txn.settlementExchangeRate),
                    toNullableFiniteNumber(txn.settlement_received_original ?? txn.settlementReceivedOriginal),
                    toNullableFiniteNumber(txn.settlement_received_base ?? txn.settlementReceivedBase),
                    toNullableFiniteNumber(txn.settlement_applied_base ?? txn.settlementAppliedBase),
                    toNullableFiniteNumber(txn.settlement_change_base ?? txn.settlementChangeBase),
                    normalizeIdentityString(txn.settlement_change_currency_code) || normalizeIdentityString(txn.settlementChangeCurrencyCode),
                    txn.syncStatus,
                    txn.syncError,
                    targetId
                );

            for (const txn of normalizedItems) {
                let txnForPersistence = { ...txn };
                const technicalId = txnForPersistence.id;

                const existingByDisplayId = txnForPersistence.displayId ? (byDisplayIdStmt.get(txnForPersistence.displayId) as any) : null;
                if (existingByDisplayId?.id && existingByDisplayId.id !== technicalId) {
                    const warning = buildVisualCollisionWarning('displayId', txnForPersistence.displayId, existingByDisplayId.id, technicalId);
                    txnForPersistence = {
                        ...txnForPersistence,
                        syncError: appendSyncWarning(txnForPersistence.syncError, warning),
                    };
                    visualCollisionCount++;
                    console.warn(`[Sync] ${warning}`);
                }

                const existingByNcf = txnForPersistence.ncf ? (byNcfStmt.get(txnForPersistence.ncf) as any) : null;
                if (existingByNcf?.id && existingByNcf.id !== technicalId) {
                    const warning = buildVisualCollisionWarning('ncf', txnForPersistence.ncf, existingByNcf.id, technicalId);
                    txnForPersistence = {
                        ...txnForPersistence,
                        syncError: appendSyncWarning(txnForPersistence.syncError, warning),
                    };
                    visualCollisionCount++;
                    console.warn(`[Sync] ${warning}`);
                }

                const result = insertTxn(txnForPersistence);
                if (result.changes > 0) {
                    addedCount++;
                    const version = bumpVersion('transactions');
                    insertChangeStmt.run('transactions', txnForPersistence.id, version, 'UPSERT', JSON.stringify(txnForPersistence), now);
                    persistedPendingItems.push(txnForPersistence);
                    continue;
                }

                // Conflict handling path:
                // 1) If the technical id already exists, update that same transaction.
                // 2) Visual sequence collisions are flagged, never merged into another UUID row.
                // 3) Any residual technical-id conflict gets a fallback id so we never overwrite by displayId/ncf.
                const existingById = byIdStmt.get(txnForPersistence.id) as any;
                if (existingById?.id) {
                    const updatedTxn = { ...txnForPersistence, id: existingById.id };
                    const updateResult = updateTxn(existingById.id, updatedTxn);
                    if (updateResult.changes > 0) {
                        conflictResolvedCount++;
                        const version = bumpVersion('transactions');
                        insertChangeStmt.run('transactions', updatedTxn.id, version, 'UPSERT', JSON.stringify(updatedTxn), now);
                    }
                    persistedPendingItems.push(updatedTxn);
                    continue;
                }

                const baseId = typeof txnForPersistence.id === 'string' && txnForPersistence.id.trim().length > 0
                    ? txnForPersistence.id
                    : 'TXN-CONFLICT';
                const fallbackId = `${baseId}__PK_COLLISION__${Date.now()}__${Math.random().toString(36).slice(2, 8)}`;
                const fallbackWarning = `TECHNICAL_ID_COLLISION(originalId=${txnForPersistence.id}, fallbackId=${fallbackId})`;
                const fallbackTxn = {
                    ...txnForPersistence,
                    id: fallbackId,
                    syncError: appendSyncWarning(txnForPersistence.syncError, fallbackWarning),
                };
                const fallbackResult = insertTxn(fallbackTxn);

                if (fallbackResult.changes > 0) {
                    conflictResolvedCount++;
                    const version = bumpVersion('transactions');
                    insertChangeStmt.run('transactions', fallbackTxn.id, version, 'UPSERT', JSON.stringify(fallbackTxn), now);
                    console.warn(`[Sync] ${fallbackWarning}`);
                    persistedPendingItems.push(fallbackTxn);
                } else {
                    console.warn(`[Sync] Transaction ignored after technical-id conflict handling: id=${txnForPersistence.id}, displayId=${txnForPersistence.displayId}, terminalId=${txnForPersistence.terminalId}`);
                }
            }

            const pending = getSetting('pending_transactions') || [];
            const pendingMap = new Map(pending.map((p: any) => [p.id, p]));
            persistedPendingItems.forEach((it: any) => pendingMap.set(it.id, it));
            saveSetting('pending_transactions', Array.from(pendingMap.values()));

            updateMetadata('transactions', getCurrentVersion('transactions'));
        })();

        const authenticatedTerminalId = tokens[authToken];
        const erpBaseFromBody =
            typeof req.body?.erp_base_url === 'string' && req.body.erp_base_url.trim()
                ? String(req.body.erp_base_url).trim()
                : '';
        const skipErpForward = req.body?.skip_erp_forward === true;
        console.log(
            `[SYNC_TX_POST] persisted_local items=${items.length} erp_base_url_from_client=${erpBaseFromBody ? 'yes' : 'no'} auth_terminal=${authenticatedTerminalId || 'none'} skip_erp_forward=${skipErpForward ? 'yes' : 'no'}`
        );

        const normalizedForErp = normalizedItems.map((txn: any) =>
            coerceTransactionItemsForErp(txn)
        );
        const erpQueuedCount = skipErpForward
            ? 0
            : enqueueErpForward(normalizedForErp, {
                erpBaseUrlOverride: erpBaseFromBody || null,
                authTerminalId: authenticatedTerminalId || null
            });
        console.log(`[SYNC_TX_POST] returning 200 after local persist; queued ERP forward count=${erpQueuedCount}`);

        res.json({
            success: true,
            savedLocally: true,
            addedCount,
            conflictResolvedCount,
            visualCollisionCount,
            totalCount: (getCollection('transactions')).length,
            inventoryUpdates: 0,
            erpInbox: {
                deferred: true,
                queued: erpQueuedCount,
                erpBaseUrlProvided: Boolean(erpBaseFromBody)
            }
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
 * POST /api/sync/erp-forward/retry
 */
router.post('/erp-forward/retry', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const requestedIds = Array.isArray(req.body?.ids)
            ? new Set(req.body.ids.map((id: any) => normalizeIdentityString(id)).filter(Boolean))
            : null;
        const legacyQueued = requeueLegacyErpForwardTransactions();
        const now = new Date().toISOString();
        const queue = asPendingErpForwardArray().map((entry) => {
            if (requestedIds && !requestedIds.has(entry.id)) return entry;
            return {
                ...entry,
                updatedAt: now,
                nextAttemptAt: null,
                lastError: entry.lastError || null
            };
        });
        savePendingErpForwardArray(queue);
        scheduleErpForwardFlush(0);

        res.json({
            success: true,
            legacyQueued,
            pending: queue.length,
            items: queue.slice(0, 25).map(summarizeErpForwardEntry)
        });
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
        const erpForwardQueue = asPendingErpForwardArray();
        const erpForwardItems = erpForwardQueue
            .map(summarizeErpForwardEntry)
            .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());

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
                movements: pendingMovements.length,
                erpForward: erpForwardQueue.length
            },
            erpForward: {
                pending: erpForwardQueue.length,
                due: erpForwardQueue.filter((entry) => !entry.nextAttemptAt || Date.parse(entry.nextAttemptAt) <= Date.now()).length,
                items: erpForwardItems.slice(0, 25),
                lastError: erpForwardItems.find((entry) => entry.lastError)?.lastError || null
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
        let skippedCount = 0;
        const now = new Date().toISOString();
        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO z_reports (id, openedAt, closedAt, terminalId, userId, userName, openingBalance, closingBalance, totalSales, totalTaxes, totalDiscounts, totalCash, totalCard, totalTransfer, totalOther, status, syncStatus, syncError, sequenceNumber, totalsByMethod, cashExpected, cashCounted, cashDiscrepancy, stats, transactionCount, notes, baseCurrency, cashSales, cashIn, cashOut) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const report of items) {
                try {
                    if (!report?.id) {
                        skippedCount++;
                        continue;
                    }

                    const totalsByMethod = toNumericMap(report.totalsByMethod);
                    const cashExpected = toNumericMap(report.cashExpected);
                    const cashCounted = toNumericMap(report.cashCounted);
                    const cashDiscrepancy = toNumericMap(report.cashDiscrepancy);
                    const totalSales = report.totalSales !== undefined
                        ? toFiniteNumber(report.totalSales, 0)
                        : Object.values(totalsByMethod).reduce((sum, val) => sum + val, 0);

                    const result = stmt.run(
                        report.id,
                        report.openedAt || null,
                        report.closedAt || null,
                        report.terminalId || null,
                        report.userId || report.closedByUserId || null,
                        report.userName || report.closedByUserName || null,
                        toFiniteNumber(report.openingBalance, 0),
                        toFiniteNumber(report.closingBalance, 0),
                        totalSales,
                        toFiniteNumber(report.totalTaxes, 0),
                        toFiniteNumber(report.totalDiscounts, 0),
                        toFiniteNumber(report.totalCash, 0),
                        toFiniteNumber(report.totalCard, 0),
                        toFiniteNumber(report.totalTransfer, 0),
                        toFiniteNumber(report.totalOther, 0),
                        report.status || 'CLOSED',
                        report.syncStatus || 'PENDING',
                        report.syncError || null,
                        report.sequenceNumber || '',
                        safeJsonStringify(totalsByMethod),
                        safeJsonStringify(cashExpected),
                        safeJsonStringify(cashCounted),
                        safeJsonStringify(cashDiscrepancy),
                        safeJsonStringify(report.stats, '{}'),
                        toFiniteNumber(report.transactionCount, 0),
                        report.notes || '',
                        report.baseCurrency || '',
                        toFiniteNumber(report.cashSales, 0),
                        toFiniteNumber(report.cashIn, 0),
                        toFiniteNumber(report.cashOut, 0)
                    );
                    if (result.changes > 0) {
                        addedCount++;
                        const version = bumpVersion(collectionKey);
                        insertChangeStmt.run(collectionKey, report.id, version, 'UPSERT', JSON.stringify(report), now);
                    }
                } catch (itemError: any) {
                    skippedCount++;
                    console.warn(`[Sync] Skipping malformed z-report ${report?.id || '(no-id)'}: ${itemError?.message || itemError}`);
                }
            }

            updateMetadata(collectionKey, getCurrentVersion(collectionKey));
        })();

        res.json({ success: true, addedCount, skippedCount });
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

                    // 1. Update product_stocks table (Detailed Stock)
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

                    // 2. Update products table (Catalog View)
                    // We need to update both the scalar 'stock' (total) and the 'stockBalances' JSON
                    const productState = db.prepare("SELECT stock, stockBalances FROM products WHERE id = ?").get(move.productId) as any;

                    if (productState) {
                        const currentBalances = productState.stockBalances ? JSON.parse(productState.stockBalances) : {};
                        const movementQty = (move.qtyIn || 0) - (move.qtyOut || 0);

                        // Update specific warehouse balance
                        currentBalances[move.warehouseId] = (currentBalances[move.warehouseId] || 0) + movementQty;

                        // Calculate new total stock
                        const newTotalStock = (productState.stock || 0) + movementQty;

                        db.prepare(`
                            UPDATE products 
                            SET stock = ?, 
                                stockBalances = ?, 
                                updatedAt = ? 
                            WHERE id = ?
                        `).run(
                            newTotalStock,
                            JSON.stringify(currentBalances),
                            new Date().toISOString(),
                            move.productId
                        );

                        // audit: Record discrepancy if stock goes negative in Master
                        if (newTotalStock < 0) {
                            db.prepare(`
                                INSERT INTO inventory_discrepancies (id, productId, warehouseId, terminalId, negativeAmount, timestamp)
                                VALUES (?, ?, ?, ?, ?, ?)
                            `).run(
                                `DISC_${move.id}`,
                                move.productId,
                                move.warehouseId,
                                move.terminalId || 'UNKNOWN',
                                newTotalStock,
                                new Date().toISOString()
                            );
                            console.warn(`[Audit] Negative stock detected: Product ${move.productId} at ${move.warehouseId} is ${newTotalStock}`);
                        }
                    }


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

/**
 * POST /api/sync/operational/events
 * Wallet & loyalty outbound queue for ERP ingestion (deduped by source_event_id).
 */
router.post('/operational/events', async (req, res) => {
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

        const pending = getSetting('pending_operational_events') || [];
        const pendingMap = new Map((pending as any[]).map((p: any) => [p.source_event_id || p.id, p]));
        const processedIds: string[] = [];

        for (const it of items) {
            const id = it?.source_event_id || it?.id;
            if (!id) continue;
            pendingMap.set(id, { ...it, receivedAt: new Date().toISOString() });
            processedIds.push(id);
        }

        saveSetting('pending_operational_events', Array.from(pendingMap.values()));

        res.json({ success: true, processedIds });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
