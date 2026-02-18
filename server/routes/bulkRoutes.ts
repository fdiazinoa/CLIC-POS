import { Router } from 'express';
import { db } from '../db.js';
import { emitSyncEvent } from '../socket.js';

const router = Router();

/**
 * Bulk Product Update Endpoint
 * Handles atomic updates for multiple products, including warehouse associations (UPSERT)
 * and operational flags/classification. village.
 */
router.post('/products', (req, res) => {
    const { productIds, updates, userId, userName } = req.body;

    if (!Array.isArray(productIds) || !updates) {
        return res.status(400).json({ error: 'Missing productIds or updates' });
    }

    try {
        const transaction = db.transaction(() => {
            const now = new Date().toISOString();

            for (const productId of productIds) {
                // 1. Fetch current product state
                const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId) as any;
                if (!product) continue;

                // Parse operational flags if they exist
                let operationalFlags = {};
                try {
                    operationalFlags = product.operationalFlags ? JSON.parse(product.operationalFlags) : {};
                } catch (e) {
                    operationalFlags = {};
                }

                let category = product.category;
                let measurementUnit = product.measurementUnit;
                let purchaseUnit = product.purchaseUnit;

                // Apply Flags
                if (updates.flags) {
                    Object.entries(updates.flags).forEach(([key, cfg]: [string, any]) => {
                        if (cfg.apply) {
                            (operationalFlags as any)[key] = cfg.value;
                        }
                    });
                }

                // Apply Classification
                if (updates.classification) {
                    if (updates.classification.categoryId) category = updates.classification.categoryId;
                    if (updates.classification.measurementUnit) measurementUnit = updates.classification.measurementUnit;
                    if (updates.classification.purchaseUnit) purchaseUnit = updates.classification.purchaseUnit;
                }

                // Update products table
                db.prepare(`
                    UPDATE products 
                    SET operationalFlags = ?, 
                        category = ?, 
                        measurementUnit = ?, 
                        purchaseUnit = ?,
                        updatedAt = ?
                    WHERE id = ?
                `).run(
                    JSON.stringify(operationalFlags),
                    category,
                    measurementUnit,
                    purchaseUnit,
                    now,
                    productId
                );

                // 2. Warehouse Actions (Inventory Stock Mappings)
                if (updates.warehouseActions) {
                    Object.entries(updates.warehouseActions).forEach(([warehouseId, action]) => {
                        const stockId = `${productId}_${warehouseId}`;

                        if (action === 'ENABLE') {
                            // UPSERT into product_stocks
                            db.prepare(`
                                INSERT INTO product_stocks (id, productId, warehouseId, updatedAt)
                                VALUES (?, ?, ?, ?)
                                ON CONFLICT(id) DO UPDATE SET updatedAt = excluded.updatedAt
                            `).run(stockId, productId, warehouseId, now);
                        } else if (action === 'DISABLE') {
                            // Deactivate association
                            db.prepare(`
                                DELETE FROM product_stocks 
                                WHERE productId = ? AND warehouseId = ?
                            `).run(productId, warehouseId);
                        }
                    });
                }
            }

            // 3. Register Audit Log entry
            const auditId = `BULK-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
            db.prepare(`
                INSERT INTO audit_logs (
                    id, sessionId, warehouseId, action, reason, createdAt, createdBy, createdByName
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                auditId,
                'BULK_CATALOG_UPDATE',
                'SYSTEM',
                'APPLY',
                `Edición masiva aplicada a ${productIds.length} artículos`,
                now,
                userId || 'SYSTEM',
                userName || 'Sistema'
            );
        });

        // Execute Transaction
        transaction();

        // 4. Emit Catalog Refresh Signal via WebSocket
        emitSyncEvent('CATALOG_UPDATED', {
            type: 'BULK_UPDATE',
            count: productIds.length,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: `Successfully processed bulk update for ${productIds.length} products.`
        });

    } catch (error: any) {
        console.error('❌ Error executing bulk product update:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
