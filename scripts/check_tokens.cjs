const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../server/db.sqlite');
const db = new Database(dbPath);

const tokens = db.prepare('SELECT token, terminalId FROM sync_tokens').all();
console.log('--- Active Tokens ---');
tokens.forEach(t => {
    console.log(`Terminal: ${t.terminalId} | Token: ${t.token}`);
});
