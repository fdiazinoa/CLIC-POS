const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../server/db.sqlite');
const db = new Database(dbPath);

console.log('--- FIX: Reconciling Product Stocks ---');

// 1. Get all products
const products = db.prepare('SELECT id, name, stock FROM products').all();

let updatedCount = 0;

db.transaction(() => {
    for (const p of products) {
        // 2. Get detailed stocks
        const stocks = db.prepare('SELECT warehouseId, quantity FROM product_stocks WHERE productId = ?').all(p.id);

        const balances = {};
        let totalStock = 0;

        stocks.forEach(s => {
            balances[s.warehouseId] = s.quantity;
            totalStock += s.quantity;
        });

        // 3. Compare and Update if needed
        const currentBalancesJson = JSON.stringify(balances);

        // We update if total stock mismatches OR if we just want to ensure consistency of balances
        // Let's force update to ensure balances JSON is correct too

        db.prepare('UPDATE products SET stock = ?, stockBalances = ? WHERE id = ?').run(totalStock, currentBalancesJson, p.id);

        if (p.stock !== totalStock) {
            console.log(`FIXED: ${p.name} (${p.id}) | Old: ${p.stock} -> New: ${totalStock}`);
            updatedCount++;
        }
    }
})();

console.log(`\nReconciliation Complete. Updated ${updatedCount} products.`);
