const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../server/db.sqlite');
const db = new Database(dbPath);

async function runTest() {
    console.log('--- TEST: Simulating Product Persistence ---');
    const productId = 'prod-143';
    const TOKEN = 'sync_t1_1770948802051'; // Copied from previous step

    // 1. Get Initial State
    const initialProduct = db.prepare('SELECT activeInWarehouses FROM products WHERE id = ?').get(productId);
    let currentActive = initialProduct.activeInWarehouses ? JSON.parse(initialProduct.activeInWarehouses) : [];

    console.log(`INITIAL activeInWarehouses: ${JSON.stringify(currentActive)}`);

    // Toggle logic
    const targetWh = 'wh_norte';
    if (currentActive.includes(targetWh)) {
        currentActive = currentActive.filter(id => id !== targetWh);
    } else {
        currentActive.push(targetWh);
    }

    console.log(`TARGET activeInWarehouses: ${JSON.stringify(currentActive)}`);

    // 2. Send Update via API
    // Must send FULL object to pass NOT NULL constraints on UPSERT
    // Retrieve full object first
    const fullProduct = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);

    // Parse JSON fields that are strings in DB but should be objects in JSON payload
    // Actually, the sync endpoint expects the raw values for non-JSON columns, but JSON columns...
    // The sync logic at line 316 defines jsonFields. The endpoint might expect objects and stringify them itself, OR expect strings.
    // Let's check sync.ts processing logic. 
    // It seems it takes `items` and inserts them. 
    // If I look at sync.ts:
    // It calls `insertChangeStmt.run` with `JSON.stringify(move)`.
    // And `db.prepare("INSERT OR REPLACE INTO ...").run(values)`.
    // The values are prepared from `items`.
    // If the DB column is TEXT (JSON), `sync.ts` likely expects the input `item` to have the OBJECT, and it stringifies it before inserting?
    // Let's assume input should have objects for JSON fields.

    const productToSend = { ...fullProduct };

    // Parse known JSON fields
    ['stockBalances', 'activeInWarehouses', 'images', 'attributes', 'variants', 'tariffs', 'warehouseSettings', 'operationalFlags'].forEach(field => {
        if (productToSend[field] && typeof productToSend[field] === 'string') {
            try {
                productToSend[field] = JSON.parse(productToSend[field]);
            } catch (e) { }
        }
    });

    productToSend.activeInWarehouses = currentActive;
    productToSend.updatedAt = new Date().toISOString();

    console.log(`\nSENDING UPDATE...`);

    try {
        const response = await fetch('http://localhost:3001/api/sync/collections/products/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-sync-token': TOKEN
            },
            body: JSON.stringify({
                collection: 'products',
                items: [productToSend],
                mode: 'UPSERT'
            })
        });

        const result = await response.json();
        console.log('API Response:', result);

        if (!result.success) {
            console.error('API Error:', result.message);
            // return; // Continue to check DB anyway
        }

    } catch (e) {
        console.error('Fetch Error:', e);
        return;
    }

    // 3. Verify Final State
    const finalProduct = db.prepare('SELECT activeInWarehouses FROM products WHERE id = ?').get(productId);
    const finalActive = finalProduct.activeInWarehouses ? JSON.parse(finalProduct.activeInWarehouses) : [];

    console.log(`\nFINAL activeInWarehouses: ${JSON.stringify(finalActive)}`);

    const isMatch = JSON.stringify(finalActive.sort()) === JSON.stringify(currentActive.sort());

    if (isMatch) {
        console.log('\n✅ TEST PASSED: activeInWarehouses updated correctly.');
    } else {
        console.log('\n❌ TEST FAILED: activeInWarehouses did not update.');
    }
}

runTest();
