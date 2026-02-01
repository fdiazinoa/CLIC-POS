import express from 'express';
import { db, getCollection } from '../db.js';
import { Supplier } from '../../types';
import crypto from 'crypto';

const router = express.Router();

// GET /suppliers: Listado (con búsqueda por nombre/RNC)
router.get('/', (req, res) => {
    const { q } = req.query;
    let suppliers = getCollection('suppliers').filter((s: any) => s.isActive !== false);

    if (q) {
        const query = (q as string).toLowerCase();
        suppliers = suppliers.filter((s: Supplier) =>
            s.name.toLowerCase().includes(query) ||
            s.taxId.toLowerCase().includes(query)
        );
    }

    res.json(suppliers);
});

// POST /suppliers: Crear
router.post('/', (req, res) => {
    const { name, taxId, email, phone, contactPerson, paymentTermDays } = req.body;

    if (!name || !taxId) {
        return res.status(400).json({ success: false, message: 'Nombre y RNC son requeridos' });
    }

    // Check uniqueness
    const suppliers = getCollection('suppliers');
    const existing = suppliers.find((s: any) => s.taxId === taxId);
    if (existing) {
        return res.status(400).json({ success: false, message: 'El RNC ya está registrado' });
    }

    const newSupplier: Supplier = {
        id: crypto.randomUUID(),
        name,
        taxId,
        email: email || '',
        phone: phone || '',
        contactPerson: contactPerson || '',
        paymentTermDays: paymentTermDays || 0,
        isActive: true
    };

    db.prepare("INSERT INTO suppliers (id, data) VALUES (?, ?)").run(newSupplier.id, JSON.stringify(newSupplier));
    res.status(201).json(newSupplier);
});

// PUT /suppliers/:id: Editar
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const suppliers = getCollection('suppliers');
    const supplier = suppliers.find((s: any) => s.id === id);
    if (!supplier) {
        return res.status(404).json({ success: false, message: 'Proveedor no encontrado' });
    }

    // Check uniqueness if taxId is being updated
    if (updates.taxId && updates.taxId !== supplier.taxId) {
        const existing = suppliers.find((s: any) => s.taxId === updates.taxId);
        if (existing) {
            return res.status(400).json({ success: false, message: 'El RNC ya está registrado' });
        }
    }

    const updatedSupplier = { ...supplier, ...updates };
    db.prepare("UPDATE suppliers SET data = ? WHERE id = ?").run(JSON.stringify(updatedSupplier), id);
    res.json(updatedSupplier);
});

// DELETE /suppliers/:id: Soft delete (isActive = false)
router.delete('/:id', (req, res) => {
    const { id } = req.params;

    const suppliers = getCollection('suppliers');
    const supplier = suppliers.find((s: any) => s.id === id);
    if (!supplier) {
        return res.status(404).json({ success: false, message: 'Proveedor no encontrado' });
    }

    const updatedSupplier = { ...supplier, isActive: false };
    db.prepare("UPDATE suppliers SET data = ? WHERE id = ?").run(JSON.stringify(updatedSupplier), id);
    res.json({ success: true, message: 'Proveedor eliminado (soft delete)' });
});

export default router;

