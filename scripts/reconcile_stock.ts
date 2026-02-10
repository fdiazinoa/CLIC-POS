import Database from 'better-sqlite3';
import { join } from 'path';

const DB_PATH = join(process.cwd(), 'server', 'db.sqlite');

const jsonFields: Record<string, string[]> = {
    products: ['images', 'attributes', 'variants', 'tariffs', 'stockBalances', 'activeInWarehouses', 'appliedTaxIds', 'warehouseSettings', 'availableModifiers', 'operationalFlags', 'recipeDetails'],
    roles: ['permissions', 'zReportConfig'],
    customers: ['tags', 'addresses'],
    transactions: ['items', 'payments', 'customerSnapshot', 'relatedTransactions'],
    receptions: ['items'],
    z_reports: ['totalsByMethod', 'cashExpected', 'cashCounted', 'cashDiscrepancy', 'stats'],
    transaction_history: ['items', 'payments', 'customerSnapshot', 'relatedTransactions'],
    rooms: ['data'],
    tables: ['data']
};

function parseRow(name: string, row: any) {
    if (!row) return row;
    const fields = jsonFields[name] || [];
    const newRow = { ...row };
    fields.forEach(field => {
        if (field in newRow && typeof newRow[field] === 'string' && newRow[field] !== null) {
            try {
                newRow[field] = JSON.parse(newRow[field]);
            } catch (e) {
                newRow[field] = null;
            }
        }
    });
    return newRow;
}

function stringifyRow(name: string, row: any) {
    const fields = jsonFields[name] || [];
    const newRow = { ...row };
    fields.forEach(field => {
        if (field in newRow && typeof newRow[field] === 'object' && newRow[field] !== null) {
            newRow[field] = JSON.stringify(newRow[field]);
        }
    });
    // Handle booleans
    Object.keys(newRow).forEach(key => {
        if (typeof newRow[key] === 'boolean') {
            newRow[key] = newRow[key] ? 1 : 0;
        }
    });
    return newRow;
}

async function reconcile() {
    console.log('🚀 Starting stock reconciliation (SQLite tables mode)...');

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    const productsRaw = db.prepare("SELECT * FROM products").all();
    const products = productsRaw.map(r => parseRow('products', r));

    const ledgerRaw = db.prepare("SELECT * FROM inventory_ledger").all();
    const ledger = ledgerRaw.map((r: any) => ({ ...r }));

    let entriesAddedCount = 0;
    const affectedProducts = new Set<string>();

    for (const product of products) {
        const stockBalances = product.stockBalances || {};

        for (const warehouseId of Object.keys(stockBalances)) {
            const targetStock = stockBalances[warehouseId];

            // Calculate current ledger balance for this product/warehouse
            const productLedger = ledger.filter((e: any) => e.productId === product.id && e.warehouseId === warehouseId);
            const ledgerSum = productLedger.reduce((sum: number, e: any) => sum + (e.qtyIn || 0) - (e.qtyOut || 0), 0);

            const diff = targetStock - ledgerSum;

            if (Math.abs(diff) > 0.001) {
                console.log(`📦 [${product.id}] ${product.name} @ ${warehouseId}: Ledger=${ledgerSum}, Target=${targetStock}, Diff=${diff}`);

                const isInitial = productLedger.length === 0 || !productLedger.some((e: any) => e.concept === 'CARGA_INICIAL');
                const newEntry = {
                    id: `LEG-REC-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                    createdAt: new Date().toISOString(),
                    warehouseId,
                    productId: product.id,
                    concept: isInitial ? 'CARGA_INICIAL' : 'AJUSTE_RECONCILIACION',
                    documentRef: 'RECONCILE_SCRIPT',
                    qtyIn: diff > 0 ? diff : 0,
                    qtyOut: diff < 0 ? -diff : 0,
                    unitCost: product.cost || 0,
                    balanceQty: targetStock,
                    balanceAvgCost: product.cost || 0,
                    terminalId: 'server',
                    syncStatus: 'SYNCED'
                };

                ledger.push(newEntry);

                // Save to DB
                const columns = Object.keys(newEntry).join(', ');
                const placeholders = Object.keys(newEntry).map(() => '?').join(', ');
                db.prepare(`INSERT INTO inventory_ledger (${columns}) VALUES (${placeholders})`).run(...Object.values(newEntry));

                entriesAddedCount++;
                affectedProducts.add(product.id);
            }
        }
    }

    if (entriesAddedCount > 0) {
        console.log(`\n✅ Added ${entriesAddedCount} reconciliation entries for ${affectedProducts.size} products.`);

        // Recalculate and update
        console.log('🔄 Updating balances across tables...');
        for (const productId of affectedProducts) {
            const product = products.find((p: any) => p.id === productId);
            if (!product) continue;

            for (const warehouseId of Object.keys(product.stockBalances || {})) {
                const sortedEntries = ledger
                    .filter((e: any) => e.productId === productId && e.warehouseId === warehouseId)
                    .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

                let currentBalance = 0;
                for (const entry of sortedEntries) {
                    currentBalance += (entry.qtyIn || 0) - (entry.qtyOut || 0);
                    if (entry.balanceQty !== currentBalance) {
                        entry.balanceQty = currentBalance;
                        db.prepare("UPDATE inventory_ledger SET balanceQty = ? WHERE id = ?").run(currentBalance, entry.id);
                    }
                }

                // Update product_stocks table
                const stockId = `${productId}_${warehouseId}`;
                db.prepare(`
          INSERT INTO product_stocks (id, productId, warehouseId, quantity, updatedAt)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET quantity=excluded.quantity, updatedAt=excluded.updatedAt
        `).run(stockId, productId, warehouseId, currentBalance, new Date().toISOString());

                product.stockBalances[warehouseId] = currentBalance;
            }

            product.stock = Object.values(product.stockBalances).reduce((a: any, b: any) => a + (b as number), 0);
            product.updatedAt = new Date().toISOString();

            // Save product
            const stringified = stringifyRow('products', product);
            const keys = Object.keys(stringified);
            const columns = keys.join(', ');
            const placeholders = keys.map(() => '?').join(', ');
            db.prepare(`REPLACE INTO products (${columns}) VALUES (${placeholders})`).run(...Object.values(stringified));
        }

        console.log('✨ Data successfully reconciled in all tables.');
    } else {
        console.log('✨ No discrepancies found.');
    }

    db.close();
    console.log('🏁 Reconciliation finished.');
}

reconcile().catch(error => {
    console.error('❌ Reconciliation failed:', error);
    process.exit(1);
});
