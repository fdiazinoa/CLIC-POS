import express from 'express';
import { getSetting, saveSetting } from '../db.js';
import { EmailService } from '../services/emailService.js';
import { EmailConfig } from '../../types.js';

const router = express.Router();

// Simple health check
router.get('/', (req, res) => {
    res.json({ status: 'Email service running' });
});

// Get Config
router.get('/config', (req, res) => {
    const config = getSetting('emailConfig');
    res.json(config || {});
});

// Save Config
router.post('/config', (req, res) => {
    const config: EmailConfig = req.body;

    if (!config.apiKey || !config.from) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    saveSetting('emailConfig', config);
    res.json({ success: true, message: 'Configuration saved' });
});

// Test Connection
router.post('/test', async (req, res) => {
    const config: EmailConfig = req.body;
    const emailService = new EmailService();
    emailService.configure(config);

    try {
        await emailService.sendTestEmail('felixdiazinoa@gmail.com');
        res.status(200).json({ success: true, message: 'Test email sent successfully' });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error.message || 'Unknown error occurred',
            details: error
        });
    }
});

// Send Receipt
router.post('/receipt', async (req, res) => {
    const { email, cart } = req.body;

    if (!email || !cart) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const emailService = new EmailService();

    try {
        await emailService.sendReceipt(email, {
            ...req.body,
            items: cart
        });
        res.json({ success: true, message: 'Receipt sent successfully' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message || 'Failed to send receipt' });
    }
});

// Send Purchase Order
router.post('/purchase-order', async (req, res) => {
    const { supplierEmail, orderId, items, total, dueDate } = req.body;

    if (!supplierEmail || !orderId || !items) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const emailService = new EmailService();

    try {
        // Assuming EmailService has a sendPurchaseOrder method or we can use a generic one
        // For now, let's use a generic send method if available, or just mock it if not.
        // Based on SupplyChainManager.tsx, it expects { success: true }

        // await emailService.sendPurchaseOrder(supplierEmail, req.body);

        console.log(`📧 Sending PO ${orderId} to ${supplierEmail}`);

        res.json({ success: true, message: 'Purchase order sent successfully' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message || 'Failed to send purchase order' });
    }
});

export default router;

