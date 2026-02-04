import express from 'express';
import { db } from '../db';
import type { CurrencyAuditLog, CurrencyConfig } from '../../types';

const router = express.Router();

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
        const settingsRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('currencies') as any;

        if (!settingsRow) {
            return res.status(404).json({ error: 'Currency configuration not found' });
        }

        const currentConfig: CurrencyConfig[] = JSON.parse(settingsRow.value);
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
        db.prepare('UPDATE settings SET value = ? WHERE key = ?')
            .run(JSON.stringify(updatedConfig), 'currencies');

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
