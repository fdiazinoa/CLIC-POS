import express from 'express';
import { db } from '../db';
import type { CurrencyAuditLog, CurrencyConfig } from '../../types';

const router = express.Router();

const readBusinessConfig = (): any => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('config') as any;
    return row ? JSON.parse(row.value) : null;
};

const writeBusinessConfig = (config: any) => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run('config', JSON.stringify(config));
};

const auditCurrencies = (
    previous: CurrencyConfig[],
    next: CurrencyConfig[],
    actor: { userId: string; userName: string; terminalId?: string },
) => {
    const previousByCode = new Map(previous.map(currency => [currency.code, currency]));
    const fields = ['rate', 'buyRate', 'sellRate'];
    const now = new Date().toISOString();
    const entries: CurrencyAuditLog[] = [];
    next.forEach(currency => fields.forEach(field => {
        const oldValue = (previousByCode.get(currency.code) as any)?.[field] ?? null;
        const newValue = (currency as any)[field] ?? null;
        if (oldValue === newValue) return;
        const entry: CurrencyAuditLog = {
            id: `AUDIT-${currency.code}-${field}-${Date.now()}-${entries.length}`,
            currencyCode: currency.code,
            field,
            oldValue,
            newValue,
            changedAt: now,
            changedBy: actor.userId,
            changedByName: actor.userName,
            terminalId: actor.terminalId,
            source: 'MANUAL',
        };
        db.prepare(`INSERT INTO currency_audit_logs
            (id, currencyCode, field, oldValue, newValue, changedAt, changedBy, changedByName, terminalId, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(entry.id, entry.currencyCode, entry.field, String(entry.oldValue), String(entry.newValue), entry.changedAt, entry.changedBy, entry.changedByName, entry.terminalId || null, entry.source);
        entries.push(entry);
    }));
    return entries;
};

router.post('/upsert', (req, res) => {
    const { currencies, actor, mutationId } = req.body || {};
    if (!Array.isArray(currencies) || !actor?.userId || !actor?.userName) {
        return res.status(400).json({ success: false, error: 'currencies y actor son requeridos' });
    }
    try {
        const config = readBusinessConfig();
        if (!config) return res.status(404).json({ success: false, error: 'Business config not found' });
        const previous = Array.isArray(config.currencies) ? config.currencies : [];
        const auditEntries = auditCurrencies(previous, currencies, actor);
        writeBusinessConfig({ ...config, currencies });
        return res.json({ success: true, processedIds: mutationId ? [mutationId] : [], auditEntries, currencies });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/schedules', (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) return res.status(400).json({ success: false, error: 'items es requerido' });
    try {
        const insert = db.prepare(`INSERT OR REPLACE INTO currency_rate_schedules
            (id, currencyCode, rate, buyRate, sellRate, executeAt, status, createdAt, createdBy, createdByName, terminalId)
            VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`);
        items.forEach((item: any) => insert.run(
            item.id, item.currencyCode, item.rate, item.buyRate || null, item.sellRate || null,
            item.executeAt, item.createdAt || new Date().toISOString(), item.createdBy,
            item.createdByName, item.terminalId || null,
        ));
        return res.json({ success: true, processedIds: items.map((item: any) => item.id) });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/currencies/audit/:currencyCode
 * Obtiene el histórico de cambios de una moneda específica
 */
router.get('/audit/:currencyCode', (req, res) => {
    const { currencyCode } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    try {
        const logs = db.prepare(
            `SELECT * FROM currency_audit_logs 
       WHERE currencyCode = ? 
       ORDER BY changedAt DESC 
       LIMIT ?`
        ).all(currencyCode, limit) as any[];

        // Parse JSON fields if needed
        const parsedLogs: CurrencyAuditLog[] = logs.map(log => ({
            ...log,
            oldValue: log.oldValue,
            newValue: log.newValue
        }));

        res.json(parsedLogs);
    } catch (error: any) {
        console.error('Error fetching currency audit logs:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/currencies/update
 * Actualiza una moneda y registra en auditoría
 */
router.post('/update', (req, res) => {
    const { currencyCode, updates, userId, userName, terminalId } = req.body;

    if (!currencyCode || !updates || !userId || !userName) {
        return res.status(400).json({
            error: 'Missing required fields: currencyCode, updates, userId, userName'
        });
    }

    try {
        // 1. Obtener configuración actual desde settings
        const config = readBusinessConfig();

        if (!config) {
            return res.status(404).json({ error: 'Currency configuration not found' });
        }

        const currentConfig: CurrencyConfig[] = Array.isArray(config.currencies) ? config.currencies : [];
        const currentCurrency = currentConfig.find(c => c.code === currencyCode);

        if (!currentCurrency) {
            return res.status(404).json({ error: `Currency ${currencyCode} not found` });
        }

        // 2. Registrar auditoría para cada campo modificado
        const fieldsToAudit = ['rate', 'buyRate', 'sellRate'];
        const auditEntries: CurrencyAuditLog[] = [];
        const now = new Date().toISOString();

        for (const field of fieldsToAudit) {
            if (updates[field] !== undefined && updates[field] !== (currentCurrency as any)[field]) {
                const oldValue = (currentCurrency as any)[field];
                const newValue = updates[field];

                const auditLog: CurrencyAuditLog = {
                    id: `AUDIT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    currencyCode,
                    field,
                    oldValue: oldValue?.toString() || 'null',
                    newValue: newValue.toString(),
                    changedAt: now,
                    changedBy: userId,
                    changedByName: userName,
                    terminalId: terminalId || null
                };

                // Insertar en BD
                db.prepare(
                    `INSERT INTO currency_audit_logs 
           (id, currencyCode, field, oldValue, newValue, changedAt, changedBy, changedByName, terminalId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(
                    auditLog.id,
                    auditLog.currencyCode,
                    auditLog.field,
                    auditLog.oldValue,
                    auditLog.newValue,
                    auditLog.changedAt,
                    auditLog.changedBy,
                    auditLog.changedByName,
                    auditLog.terminalId
                );

                auditEntries.push(auditLog);
            }
        }

        // 3. Actualizar configuración
        const updatedConfig = currentConfig.map(c =>
            c.code === currencyCode
                ? {
                    ...c,
                    ...updates,
                    lastModified: now,
                    lastModifiedBy: userName
                }
                : c
        );

        // Guardar en settings
        writeBusinessConfig({ ...config, currencies: updatedConfig });

        res.json({
            success: true,
            auditEntries,
            updatedCurrency: updatedConfig.find(c => c.code === currencyCode)
        });
    } catch (error: any) {
        console.error('Error updating currency:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/currencies/fetch-rate/:currencyCode
 * Obtiene la tasa de mercado desde una API externa
 */
router.get('/fetch-rate/:currencyCode', async (req, res) => {
    const { currencyCode } = req.params;
    const baseCurrency = (req.query.baseCurrency as string) || 'DOP';

    try {
        // Usar exchangerate-api.com (free tier: 1,500 requests/month)
        const response = await fetch(
            `https://api.exchangerate-api.com/v4/latest/${baseCurrency}`
        );

        if (!response.ok) {
            throw new Error(`API responded with status ${response.status}`);
        }

        const data = await response.json();

        if (!data.rates || !data.rates[currencyCode]) {
            return res.status(404).json({
                error: `Exchange rate for ${currencyCode} not found`
            });
        }

        // Invertir la tasa para obtener cuánto de base currency equivale a 1 de foreign currency
        // Ej: Si 1 DOP = 0.017 USD, entonces 1 USD = 1/0.017 = 58.82 DOP
        const marketRate = 1 / data.rates[currencyCode];

        res.json({
            success: true,
            currencyCode,
            baseCurrency,
            marketRate: parseFloat(marketRate.toFixed(4)),
            timestamp: new Date().toISOString(),
            source: 'exchangerate-api.com'
        });
    } catch (error: any) {
        console.error('Error fetching exchange rate:', error);
        res.status(500).json({
            error: 'Failed to fetch exchange rate',
            details: error.message
        });
    }
});

export default router;
