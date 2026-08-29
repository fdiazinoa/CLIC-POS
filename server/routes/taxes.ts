import express from 'express';
import { db } from '../db';

const router = express.Router();

router.post('/upsert', (req, res) => {
    const { taxes, actor, mutationId } = req.body || {};
    if (!Array.isArray(taxes) || !actor?.userId || !actor?.userName || !mutationId) {
        return res.status(400).json({ success: false, error: 'mutationId, taxes y actor son requeridos' });
    }

    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('config') as any;
        if (!row) return res.status(404).json({ success: false, error: 'Business config not found' });
        const config = JSON.parse(row.value);
        const normalizedTaxes = taxes.map((tax: any) => ({
            ...tax,
            id: String(tax?.id || '').trim(),
            name: String(tax?.name || '').trim(),
            rate: Math.max(0, Number(tax?.rate || 0)),
        }));
        if (normalizedTaxes.some((tax: any) => !tax.id || !tax.name || !Number.isFinite(tax.rate))) {
            return res.status(400).json({ success: false, error: 'Cada impuesto requiere id, nombre y tasa válida' });
        }

        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
            .run('config', JSON.stringify({ ...config, taxes: normalizedTaxes }));
        return res.json({ success: true, processedIds: [mutationId], failed: 0, errors: [], taxes: normalizedTaxes });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
