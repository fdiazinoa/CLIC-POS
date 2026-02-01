import express from 'express';
import { db, saveSetting } from '../db.js';

const router = express.Router();

/**
 * POST /api/maintenance/reset
 * Performs a secure factory reset for selected entities.
 */
router.post('/reset', (req, res) => {
    const { entities } = req.body;

    if (!Array.isArray(entities)) {
        return res.status(400).json({ success: false, message: 'entities must be an array' });
    }

    console.log(`🚨 FACTORY RESET INITIATED for: ${entities.join(', ')}`);

    try {
        db.transaction(() => {
            // 1. Products (Artículos)
            if (entities.includes('products')) {
                console.log('🧹 Clearing Products Catalog...');
                // Cascading deletes
                db.prepare("DELETE FROM product_stocks").run();
                db.prepare("DELETE FROM inventory_ledger").run();

                // Note: transaction_items are stored as JSON in 'transactions' table.
                // Since there is no foreign key constraint on the JSON content, 
                // deleting the product effectively "unlinks" the historical data.

                db.prepare("DELETE FROM products").run();
            }

            // 2. Customers (Clientes)
            if (entities.includes('customers')) {
                console.log('🧹 Clearing Customers Catalog...');
                // Delete transactions linked to customers
                // Requirement: "Borrar transactions (Ventas asociadas al cliente)"
                db.prepare("DELETE FROM transactions WHERE customerId IS NOT NULL").run();

                // Accounts receivable / Loyalty points are columns in 'customers' or related tables
                // If 'accounts_receivable' table existed, we would delete it here.
                // Currently, debt is tracked in 'customers.currentDebt'.

                db.prepare("DELETE FROM customers").run();
            }

            // 3. Suppliers (Proveedores)
            if (entities.includes('suppliers')) {
                console.log('🧹 Clearing Suppliers Catalog...');
                // Delete purchase orders (and receptions?)
                db.prepare("DELETE FROM purchase_orders").run();
                db.prepare("DELETE FROM receptions").run(); // Assuming receptions are linked to suppliers
                db.prepare("DELETE FROM suppliers").run();
            }

            // 4. Stock/Existencias (Inventory only)
            if (entities.includes('stock')) {
                console.log('🧹 Clearing Inventory...');
                db.prepare("DELETE FROM product_stocks").run();
                db.prepare("DELETE FROM inventory_ledger").run();
                db.prepare("DELETE FROM receptions").run();
                db.prepare("DELETE FROM transfers").run();

                // Reset stock in products table
                // Check if 'stock' column exists first (it does based on schema check)
                db.prepare("UPDATE products SET stock = 0").run();
            }

            // 5. Tariffs (Tarifas)
            if (entities.includes('tariffs')) {
                console.log('🧹 Clearing Tariffs...');
                // Tariffs are stored in settings
                db.prepare("DELETE FROM settings WHERE key = 'tariffs'").run();

                // Also clear tariffs from products (JSON column)
                // We set it to empty array '[]'
                db.prepare("UPDATE products SET tariffs = '[]'").run();
            }

        })();

        console.log('✅ Factory reset completed successfully.');
        res.json({ success: true, message: 'Factory reset completed successfully' });
    } catch (error: any) {
        console.error('❌ Factory reset failed:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
