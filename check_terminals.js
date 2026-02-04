const Database = require('better-sqlite3');
const fs = require('fs');
try {
  const db = new Database('server/db.sqlite');
  const rows = db.prepare('SELECT * FROM connected_terminals').all();
  console.log('Connected Terminals:', JSON.stringify(rows, null, 2));
  fs.writeFileSync('terminals_dump.json', JSON.stringify(rows, null, 2));
} catch (e) {
  console.error(e);
}
