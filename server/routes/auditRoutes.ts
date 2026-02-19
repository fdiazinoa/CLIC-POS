import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.js';

const router = express.Router();

interface AuditSession {
    id: string;
    warehouseId: string;
    startedAt: string;
    status: string;
    method?: string;
    closedAt?: string;
}

interface AuditItem {
    id: string;
    sessionId: string;
    productId: string;
    countedQty: number;
    systemQtyAtStart: number;
    updatedAt: string;
}

/**
 * GET /api/audit/active/:warehouseId
 * Checks if there is an open audit session for the warehouse.
 */
router.get('/active/:warehouseId', (req, res) => {
    try {
        const { warehouseId } = req.params;
        const session = db.prepare(`
            SELECT * FROM audit_sessions 
            WHERE warehouseId = ? AND status = 'OPEN' 
            ORDER BY startedAt DESC LIMIT 1
        `).get(warehouseId) as AuditSession | undefined;

        if (session) {
            // Get items draft
            const items = db.prepare(`
                SELECT * FROM audit_items WHERE sessionId = ?
            `).all(session.id);
            res.json({ session, items });
        } else {
            res.json({ session: null, items: [] });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/audit/start
 * Starts a new audit session.
 */
router.post('/start', (req, res) => {
    try {
        const { warehouseId } = req.body;

        // Check if one exists
        const existing = db.prepare(`
            SELECT id FROM audit_sessions WHERE warehouseId = ? AND status = 'OPEN'
        `).get(warehouseId) as { id: string } | undefined;

        if (existing) {
            return res.status(400).json({ error: 'Ya existe una auditoría abierta para este almacén.' });
        }

        const id = uuidv4();
        const startedAt = new Date().toISOString();

        db.prepare(`
            INSERT INTO audit_sessions (id, warehouseId, startedAt, status)
            VALUES (?, ?, ?, 'OPEN')
        `).run(id, warehouseId, startedAt);

        res.json({ success: true, sessionId: id, startedAt });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/audit/:sessionId/items
 * Saves draft items (Upsert).
 */
router.put('/:sessionId/items', (req, res) => {
    try {
        const { sessionId } = req.params;
        const { items } = req.body; // Array of { productId, countedQty, systemQtyAtStart }

        const upsertStmt = db.prepare(`
            INSERT INTO audit_items (id, sessionId, productId, countedQty, systemQtyAtStart, updatedAt)
            VALUES (@id, @sessionId, @productId, @countedQty, @systemQtyAtStart, @updatedAt)
            ON CONFLICT(id) DO UPDATE SET
            countedQty = @countedQty,
            updatedAt = @updatedAt
        `);

        const insertMany = db.transaction((items) => {
            for (const item of items) {
                // Check if item exists for this session/product combo to get ID, or generate new
                let itemId = item.id;
                if (!itemId) {
                    const existing = db.prepare('SELECT id FROM audit_items WHERE sessionId = ? AND productId = ?').get(sessionId, item.productId) as { id: string } | undefined;
                    itemId = existing ? existing.id : uuidv4();
                }

                upsertStmt.run({
                    id: itemId,
                    sessionId,
                    productId: item.productId,
                    countedQty: item.countedQty,
                    systemQtyAtStart: item.systemQtyAtStart || 0,
                    updatedAt: new Date().toISOString()
                });
            }
        });

        insertMany(items);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/audit/:sessionId/commit
 * Finalizes the audit and adjusts inventory.
 */
router.post('/:sessionId/commit', (req, res) => {
    try {
        const { sessionId } = req.params;
        const { method, userId } = req.body; // method: 'ABSOLUTE' | 'RECONCILED'

        const session = db.prepare('SELECT * FROM audit_sessions WHERE id = ?').get(sessionId) as AuditSession | undefined;
        if (!session || session.status !== 'OPEN') {
            return res.status(400).json({ error: 'Sesión inválida o cerrada.' });
        }

        const items = db.prepare('SELECT * FROM audit_items WHERE sessionId = ?').all(sessionId) as AuditItem[];
        const warehouseId = session.warehouseId;
        const closedAt = new Date().toISOString();

        const commitTransaction = db.transaction(() => {
            for (const item of items) {
                // 1. Get Current System Stock
                const stockEntry = db.prepare('SELECT quantity FROM product_stocks WHERE productId = ? AND warehouseId = ?').get(item.productId, warehouseId) as { quantity: number } | undefined;
                const currentSystemStock = stockEntry ? stockEntry.quantity : 0;

                let quantityToAdjust = 0;
                let finalStock = 0;
                let logConcept = '';
                let formulaLog = '';

                if (method === 'ABSOLUTE') {
                    // Logic: Replacement. New Stock = Counted.
                    // Adjustment = Counted - Current
                    finalStock = item.countedQty;
                    quantityToAdjust = finalStock - currentSystemStock;
                    logConcept = 'AJUSTE POR AUDITORÍA (ABSOLUTO)';
                    formulaLog = `Conteo: ${item.countedQty} | Sistema: ${currentSystemStock} | Reemplazo Directo`;

                } else if (method === 'RECONCILED') {
                    // Logic: Reconciled.
                    // New Stock = Counted + (Inputs - Outputs during session)
                    // We need to fetch ledger movements since startedAt

                    const movements = db.prepare(`
                        SELECT concept, qtyIn, qtyOut FROM inventory_ledger 
                        WHERE productId = ? AND warehouseId = ? AND createdAt >= ?
                    `).all(item.productId, warehouseId, session.startedAt) as { concept: string; qtyIn: number; qtyOut: number }[];

                    const totalIn = movements.reduce((acc, m) => acc + (m.qtyIn || 0), 0);
                    const totalOut = movements.reduce((acc, m) => acc + (m.qtyOut || 0), 0);
                    const netMovement = totalIn - totalOut;

                    const expectedReal = item.countedQty + netMovement;

                    // Adjustment needed to reach ExpectedReal from CurrentSystemStock
                    // Wait. If system is correct, CurrentSystemStock SHOULD BE == ExpectedReal IF the count was perfect at start.
                    // The difference is the "Audit Error".

                    finalStock = expectedReal;
                    quantityToAdjust = finalStock - currentSystemStock;

                    logConcept = 'AJUSTE POR AUDITORÍA (RECONCILIADA)';
                    formulaLog = `Conteo Inicial: ${item.countedQty} | Movimientos: +${totalIn}/-${totalOut} (Neto: ${netMovement}) | Calculado: ${expectedReal} | Sistema Actual: ${currentSystemStock}`;
                }

                if (Math.abs(quantityToAdjust) > 0.0001) {
                    // Update Stock
                    db.prepare(`
                        INSERT INTO product_stocks (id, productId, warehouseId, quantity, updatedAt)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(productId, warehouseId) DO UPDATE SET
                        quantity = quantity + ?,
                        updatedAt = ?
                    `).run(
                        uuidv4(), item.productId, warehouseId, quantityToAdjust, closedAt, // Insert vals
                        quantityToAdjust, closedAt // Update vals
                    );

                    // Insert Ledger
                    db.prepare(`
                        INSERT INTO inventory_ledger (
                            id, createdAt, warehouseId, productId, concept, 
                            documentRef, qtyIn, qtyOut, balanceQty, terminalId
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        uuidv4(),
                        closedAt,
                        warehouseId,
                        item.productId,
                        logConcept,
                        `AUDIT-${session.id}`,
                        quantityToAdjust > 0 ? quantityToAdjust : 0,
                        quantityToAdjust < 0 ? Math.abs(quantityToAdjust) : 0,
                        finalStock,
                        'SYSTEM' // Or userId if available
                    );
                }
            }

            // Close Session
            db.prepare(`
                UPDATE audit_sessions 
                SET status = 'CLOSED', closedAt = ?, method = ? 
                WHERE id = ?
            `).run(closedAt, method, sessionId);
        });

        commitTransaction();
        res.json({ success: true, closedAt });
    } catch (error: any) {
        console.error('Audit Commit Error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/audit/:sessionId/cancel
 */
router.post('/:sessionId/cancel', (req, res) => {
    try {
        const { sessionId } = req.params;
        db.prepare("UPDATE audit_sessions SET status = 'CANCELLED', closedAt = ? WHERE id = ?").run(new Date().toISOString(), sessionId);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});


/**
 * GET /api/audit/history/:warehouseId
 * Returns completed audit sessions for history view.
 */
router.get('/history/:warehouseId', (req, res) => {
    try {
        const { warehouseId } = req.params;
        const sessions = db.prepare(`
            SELECT * FROM audit_sessions 
            WHERE warehouseId = ? AND status != 'OPEN'
            ORDER BY closedAt DESC
        `).all(warehouseId) as AuditSession[];

        const historyPromises = sessions.map(session => {
            const items = db.prepare('SELECT * FROM audit_items WHERE sessionId = ?').all(session.id) as AuditItem[];
            return {
                ...session,
                items
            };
        });

        const history = historyPromises; // already resolved as it's synchronous in better-sqlite3

        res.json(history);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
