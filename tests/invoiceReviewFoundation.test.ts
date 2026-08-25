import assert from 'node:assert/strict';
import test from 'node:test';
import { validate as isUuid } from 'uuid';

import { buildInvoiceAuditEvent } from '../services/invoices/InvoiceReviewService';

test('builds an idempotent append-only invoice audit event', () => {
  const event = buildInvoiceAuditEvent({
    transaction: {
      id: 'TXN-001',
      displayId: 'TCK-0001',
      terminalId: 'POS-01',
    },
    eventType: 'REVIEW_FLAGGED',
    reason: 'Medio de pago registrado incorrectamente',
    newData: {
      category: 'PAYMENT_METHOD_ERROR',
      priority: 'HIGH',
    },
    actor: {
      id: 'USR-01',
      name: 'Cajero Uno',
    } as any,
  });

  assert.equal(event.transactionId, 'TXN-001');
  assert.equal(event.transactionDisplayId, 'TCK-0001');
  assert.equal(event.terminalId, 'POS-01');
  assert.equal(event.actorId, 'USR-01');
  assert.equal(event.eventType, 'REVIEW_FLAGGED');
  assert.equal(event.syncStatus, 'PENDING');
  assert.equal(event.id, event.idempotencyKey);
  assert.equal(isUuid(event.id), true);
});

test('rejects an audit event without a transaction id', () => {
  assert.throws(() => buildInvoiceAuditEvent({
    transaction: { id: '', terminalId: 'POS-01' },
    eventType: 'EMAIL_RESENT',
    actor: { id: 'USR-01', name: 'Cajero Uno' } as any,
  }), /factura.*obligatorio/i);
});
