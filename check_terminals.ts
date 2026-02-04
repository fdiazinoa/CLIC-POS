import Database from 'better-sqlite3';
const db = new Database('server/db.sqlite');
const rows = db.prepare('SELECT * FROM connected_terminals').all();
console.log('Connected Terminals:', rows);
