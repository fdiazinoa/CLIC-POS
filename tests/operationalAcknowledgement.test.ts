import assert from 'node:assert/strict';
import test from 'node:test';

import { assertOperationalAcknowledgement } from '../services/sync/operationalAcknowledgement';
import { normalizeInventoryLedgerForSync } from '../services/sync/sourceIdentity';

test('acepta confirmación explícita del documento operacional', () => {
  assert.doesNotThrow(() => assertOperationalAcknowledgement({ success: true, processedIds: ['LEG-1'] }, 'LEG-1', 'INVENTORY'));
});

test('rechaza HTTP 200 con fallo de aplicación', () => {
  assert.throws(
    () => assertOperationalAcknowledgement({ success: true, applyFailedCount: 1, errors: [{ message: 'mapping missing' }] }, 'LEG-1', 'INVENTORY'),
    /INVENTORY_ACK_FAILED/,
  );
});

test('rechaza una confirmación que no incluye el documento enviado', () => {
  assert.throws(
    () => assertOperationalAcknowledgement({ success: true, processedIds: ['LEG-2'] }, 'LEG-1', 'INVENTORY'),
    /INVENTORY_ACK_MISSING/,
  );
});

test('normaliza inventario con aliases ERP e identidad idempotente', () => {
  const payload = normalizeInventoryLedgerForSync({
    id: 'LEG-1',
    createdAt: '2026-08-19T12:00:00.000Z',
    warehouseId: 'WH-1',
    productId: 'P-1',
    concept: 'AJUSTE_ENTRADA',
    documentRef: 'AJ-1',
    qtyIn: 2,
    qtyOut: 0,
    unitCost: 5,
    balanceQty: 2,
    balanceAvgCost: 5,
    terminalId: 'T1',
  }) as any;
  assert.equal(payload.source_inventory_movement_id, 'LEG-1');
  assert.equal(payload.product_id, 'P-1');
  assert.equal(payload.warehouse_id, 'WH-1');
  assert.equal(payload.qty_in, 2);
});
