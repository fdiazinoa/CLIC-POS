import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getErpRemainingQuantities,
  normalizeErpRefundSearchResponse,
  normalizeErpRefundPreparation,
  normalizeErpRefundSourceTransaction,
  validateErpRefundItems,
} from '../services/refunds/erpRefundSource';
import { buildErpCreditNotePayload } from '../services/sync/erpOutboundPayloads';

const sourceFixture = () => ({
  sourceId: 'source-1',
  sourceRevision: 'rev-7',
  reference: 'TCK02-000123',
  terminalId: 'terminal-original',
  eligibility: { refundable: true },
  original: {
    id: 'sale-1',
    displayId: 'TCK02-000123',
    ncf: 'B0200000123',
    date: '2026-09-08T10:00:00.000Z',
    total: 354,
    isTaxIncluded: true,
    items: [{ id: 'product-1', cartId: 'line-1', name: 'Artículo', quantity: 2, price: 177 }],
    payments: [{ id: 'payment-1', method: 'CASH', amount: 354, timestamp: '2026-09-08T10:01:00.000Z' }],
  },
  remainingQuantities: [{ cartId: 'line-1', soldQuantity: 2, refundedQuantity: 1, remainingRefundQuantity: 1 }],
});

test('normalizes a complete ERP source without changing original line identity', () => {
  const transaction = normalizeErpRefundSourceTransaction(sourceFixture());
  assert.equal(transaction.id, 'sale-1');
  assert.equal(transaction.items[0].id, 'product-1');
  assert.equal(transaction.items[0].cartId, 'line-1');
  assert.equal(transaction.terminalId, 'terminal-original');
  assert.equal(transaction.erpRefundSource?.sourceRevision, 'rev-7');
  assert.equal(transaction.payments[0].timestamp instanceof Date, true);
  assert.equal([...getErpRemainingQuantities(transaction).values()][0], 1);
});

test('rejects a remote refund that exceeds ERP remaining quantity', () => {
  const transaction = normalizeErpRefundSourceTransaction(sourceFixture());
  const result = validateErpRefundItems(transaction, [{ ...transaction.items[0], quantity: 2 }]);
  assert.equal(result.valid, false);
});

test('accepts a partial remote refund within ERP remaining quantity', () => {
  const transaction = normalizeErpRefundSourceTransaction(sourceFixture());
  const result = validateErpRefundItems(transaction, [{ ...transaction.items[0], quantity: 1 }]);
  assert.equal(result.valid, true);
});

test('rejects an incomplete source instead of reconstructing missing cartId', () => {
  const fixture = sourceFixture();
  delete (fixture.original.items[0] as any).cartId;
  assert.throws(() => normalizeErpRefundSourceTransaction(fixture), /REFUND_SOURCE_LINE_IDENTITY_MISSING/);
});

test('supports ambiguous search results without selecting one silently', () => {
  const first = sourceFixture();
  const second = { ...sourceFixture(), sourceId: 'source-2', reference: 'TCK03-000123' };
  const matches = normalizeErpRefundSearchResponse({ matches: [first, second] });
  assert.deepEqual(matches.map(match => match.sourceId), ['source-1', 'source-2']);
});

test('keeps transformed-only ERP results visible as blocked instead of calling them missing', () => {
  const [match] = normalizeErpRefundSearchResponse({
    version: 1,
    sourceId: null,
    coverage: 'TRANSFORMED_ONLY',
    eligibility: {
      refundable: false,
      missing: ['DURABLE_ORIGINAL', 'ORIGINAL_LINE_IDENTITY'],
      restrictions: ['NOT_REFUNDABLE'],
    },
  });
  assert.equal(match.sourceId, '');
  assert.equal(match.refundable, false);
  assert.match(match.eligibilityMessage || '', /NOT_REFUNDABLE/);
});

test('keeps the ERP reservation and original line identity in the outbound NC', () => {
  const original = normalizeErpRefundSourceTransaction(sourceFixture());
  const payload = buildErpCreditNotePayload({
    ...original,
    id: 'credit-note-1',
    source_transaction_id: 'credit-note-1',
    source_credit_note_id: 'credit-note-1',
    documentType: 'REFUND',
    seriesId: 'refund-series-current',
    seriesNumber: 41,
    terminalId: 'terminal-current',
    originalTransactionId: original.id,
    original_transaction_id: original.id,
    items: [{ ...original.items[0], quantity: 1 }],
    erpRefundPreparation: {
      commandId: 'command-1',
      reservationId: 'reservation-1',
      sourceId: 'source-1',
      sourceRevision: 'rev-7',
    },
  });
  assert.equal(payload.terminalId, 'terminal-current');
  assert.equal(payload.original_source_transaction_id, 'sale-1');
  assert.equal(payload.items[0].cartId, 'line-1');
  assert.equal(payload.seriesId, 'refund-series-current');
  assert.equal(payload.seriesNumber, 41);
  assert.equal(payload.erpRefundPreparation?.reservationId, 'reservation-1');
});

test('accepts only the exact document and B04 authority sealed by ERP', () => {
  const expected = { commandId: 'command-1', sourceId: 'source-1', sourceRevision: 'rev-7' };
  const result = normalizeErpRefundPreparation({
    ...expected,
    reservationId: 'reservation-1',
    expiresAt: '2026-09-08T12:20:00Z',
    documentAuthority: { seriesId: 'refund-series', seriesNumber: 7, displayId: 'NC000007' },
    fiscalAuthority: { ncfType: 'B04', ncf: 'B0400000007', reservationId: 'reservation-1' },
  }, expected);
  assert.equal(result.preparation.reservationId, 'reservation-1');
  assert.equal(result.authority.documentAuthority.seriesNumber, 7);
  assert.equal(result.authority.fiscalAuthority?.ncf, 'B0400000007');
  assert.throws(() => normalizeErpRefundPreparation({
    ...expected,
    reservationId: 'reservation-1',
    documentAuthority: { seriesId: 'refund-series', seriesNumber: 7, displayId: 'NC000007' },
    fiscalAuthority: { ncfType: 'B04', ncf: 'B0400000007', reservationId: 'different' },
  }, expected), /REFUND_FISCAL_AUTHORITY_INVALID/);
});
