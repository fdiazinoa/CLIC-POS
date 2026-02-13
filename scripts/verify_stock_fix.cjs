
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../server/db.sqlite');
const db = new Database(dbPath);

async function runTest() {
    console.log('--- TEST: Simulating Inventory Movement ---');
    const productId = 'prod-143'; // Cerveza Presidente
    const warehouseId = 'wh_central';
    const TEST_QTY = 5;

    // 1. Get Initial State
    const initialProduct = db.prepare('SELECT stock, stockBalances FROM products WHERE id = ?').get(productId);
    const initialStock = db.prepare('SELECT quantity FROM product_stocks WHERE productId = ? AND warehouseId = ?').get(productId, warehouseId);

    console.log('INITIAL STATE:');
    console.log(`- Product Stock (Catalog): ${initialProduct.stock}`);
    console.log(`- Product Balance (JSON): ${JSON.parse(initialProduct.stockBalances)[warehouseId]}`);
    console.log(`- Product Stock (Detailed): ${initialStock?.quantity}`);

    // 2. Send Movement via API
    const movement = {
        id: `M_${Date.now()}`,
        productId,
        warehouseId,
        qtyIn: 0,
        qtyOut: TEST_QTY,
        createdAt: new Date().toISOString(),
        concept: 'VENTA',
        documentRef: 'TEST_SCRIPT',
        terminalId: 'TEST_SCRIPT'
    };

    console.log(`\nSENDING MOVEMENT (Out: ${TEST_QTY})...`);

    try {
        const response = await fetch('http://localhost:3001/api/sync/inventory/movements', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-sync-token': 'sync_t1_1770948802051'
            },
            body: JSON.stringify({ items: [movement] })
        });

        const result = await response.json();
        console.log('API Response:', result);

        if (!result.success) {
            console.error('API Error:', result.message);
            return;
        }

    } catch (e) {
        console.error('Fetch Error:', e);
        return;
    }

    // 3. Verify Final State
    const finalProduct = db.prepare('SELECT stock, stockBalances FROM products WHERE id = ?').get(productId);
    const finalStock = db.prepare('SELECT quantity FROM product_stocks WHERE productId = ? AND warehouseId = ?').get(productId, warehouseId);

    console.log('\nFINAL STATE:');
    console.log(`- Product Stock (Catalog): ${finalProduct.stock} (Expected: ${initialProduct.stock - TEST_QTY})`);
    console.log(`- Product Balance (JSON): ${JSON.parse(finalProduct.stockBalances)[warehouseId]} (Expected: ${JSON.parse(initialProduct.stockBalances)[warehouseId] - TEST_QTY})`);
    console.log(`- Product Stock (Detailed): ${finalStock?.quantity} (Expected: ${(initialStock?.quantity || 0) - TEST_QTY})`);

    if (finalProduct.stock === initialProduct.stock - TEST_QTY) {
        console.log('\n✅ TEST PASSED: Product stock updated correctly.');
    } else {
        console.log('\n❌ TEST FAILED: Product stock did not update.');
    }
}

runTest();
