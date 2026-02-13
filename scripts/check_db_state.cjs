const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../server/db.sqlite');
console.log('Opening DB:', dbPath);

const db = new Database(dbPath);

// Check Ledger
console.log('--- Checking Ledger for TCK01000046 ---');
const ledgerEntry = db.prepare("SELECT * FROM inventory_ledger WHERE documentRef LIKE '%TCK01000046%'").all();
console.log('Ledger Entries:', ledgerEntry);

// Check Products
console.log('--- Checking Products with Cost 90 or Stock 100 ---');
const productsCost90 = db.prepare("SELECT id, name, cost, stock, stockBalances FROM products WHERE cost = 90").all();
console.log('Products Cost 90:', productsCost90);

const productsStock100 = db.prepare("SELECT id, name, cost, stock, stockBalances FROM products WHERE stock = 100").all();
console.log('Products Stock 100:', productsStock100);

// Check JSON stockBalances for 100
console.log('--- Checking Products with stockBalances containing 100 ---');
// Use a rough like query for JSON
const productsJson100 = db.prepare("SELECT id, name, cost, stock, stockBalances FROM products WHERE stockBalances LIKE '%:100%'").all();
console.log('Products JSON 100:', productsJson100.length);
productsJson100.forEach(p => console.log(`${p.id} | ${p.name} | Stock: ${p.stock} | Balances: ${p.stockBalances}`));

console.log('--- DB Check Complete ---');
