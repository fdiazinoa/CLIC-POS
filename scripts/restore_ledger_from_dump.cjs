const fs = require('fs');
const path = require('path');

const recoveredSqlPath = path.join(__dirname, '../server/recovered.sql');
const outputSqlPath = path.join(__dirname, '../scripts/restore_ledger_commands.sql');

try {
    const sqlContent = fs.readFileSync(recoveredSqlPath, 'utf8');

    // Find the line with inventoryLedger
    // INSERT OR IGNORE INTO 'settings'(_rowid_, 'key', 'value') VALUES (..., 'inventoryLedger', '...');
    const match = sqlContent.match(/VALUES \(\d+, 'inventoryLedger', '(\[.*\])'\);/);

    if (!match || !match[1]) {
        console.error('Could not find inventoryLedger in recovered.sql');
        process.exit(1);
    }

    const jsonString = match[1];
    const ledgerEntries = JSON.parse(jsonString);

    console.log(`Found ${ledgerEntries.length} ledger entries.`);

    let sqlCommands = "BEGIN TRANSACTION;\n";

    ledgerEntries.forEach(entry => {
        // Generate INSERT OR IGNORE statement
        // Columns: id, createdAt, warehouseId, productId, concept, documentRef, qtyIn, qtyOut, unitCost, balanceQty, balanceAvgCost, terminalId, syncStatus, syncError

        const columns = [
            'id', 'createdAt', 'warehouseId', 'productId', 'concept',
            'documentRef', 'qtyIn', 'qtyOut', 'unitCost',
            'balanceQty', 'balanceAvgCost', 'terminalId', 'syncStatus', 'syncError'
        ];

        // Safety check for nulls and escaping quotes
        const values = columns.map(col => {
            let val = entry[col];
            if (val === undefined || val === null || val === 'null') return 'NULL';
            if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
            return val;
        });

        sqlCommands += `INSERT OR IGNORE INTO inventory_ledger (${columns.join(', ')}) VALUES (${values.join(', ')});\n`;
    });

    sqlCommands += "COMMIT;\n";

    fs.writeFileSync(outputSqlPath, sqlCommands);
    console.log(`Generated SQL commands at ${outputSqlPath}`);

} catch (err) {
    console.error('Error processing file:', err);
    process.exit(1);
}
