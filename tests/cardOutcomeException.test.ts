import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CARD_OUTCOME_UNKNOWN,
  CardOutcomeUnknownError,
  buildVoucherConfirmedEntry,
  cardOutcomeNoticeLine,
  isCardOutcomeUnknownError,
  isChargedCardIntentStatus,
  isUnknownCardOutcomeStatus,
  normalizeVoucherReference,
} from '../utils/cardOutcomeException';

test('only an unanswered terminal blocks the sale', () => {
  // AUTHORIZING / UNKNOWN / RECONCILIATION_REQUIRED mean "the card may have been charged".
  assert.equal(isUnknownCardOutcomeStatus('AUTHORIZING'), true);
  assert.equal(isUnknownCardOutcomeStatus('reconciliation_required'), true);
  assert.equal(isUnknownCardOutcomeStatus('UNKNOWN'), true);
  // A real answer never blocks: declined cards may be retried, approved ones are reused.
  assert.equal(isUnknownCardOutcomeStatus('DECLINED'), false);
  assert.equal(isUnknownCardOutcomeStatus('CREATED'), false);
  assert.equal(isUnknownCardOutcomeStatus(null), false);
  assert.equal(isUnknownCardOutcomeStatus(undefined), false);
  assert.equal(isChargedCardIntentStatus('AUTHORIZED'), true);
  assert.equal(isChargedCardIntentStatus('committed'), true);
  assert.equal(isChargedCardIntentStatus('AUTHORIZING'), false);
});

test('the exception is one human line naming the amount and the provider', () => {
  assert.equal(
    cardOutcomeNoticeLine('RD$', 1200, 'Verifón'),
    'Verifón no confirmó el cobro de RD$1200.00. Revisa el voucher antes de continuar.',
  );
  // Missing provider falls back to a neutral name instead of an empty subject.
  assert.equal(
    cardOutcomeNoticeLine('$', 10.5, '   '),
    'El procesador no confirmó el cobro de $10.50. Revisa el voucher antes de continuar.',
  );
});

test('voucher references are normalized and validated', () => {
  assert.equal(normalizeVoucherReference('  0012ab34 '), '0012AB34');
  assert.equal(normalizeVoucherReference('aut 9912/01'), 'AUT 9912/01');
  assert.equal(normalizeVoucherReference(''), null);
  assert.equal(normalizeVoucherReference('   '), null);
  assert.equal(normalizeVoucherReference('REF\nWITH_NEWLINE'), 'REF WITH_NEWLINE');
  assert.equal(normalizeVoucherReference('ÑANDU'), null);
  assert.equal(normalizeVoucherReference('X'.repeat(41)), null);
});

test('confirming with the voucher approves the tender without touching the amount', () => {
  const pending: Record<string, any> = {
    id: 'ns:payment:1',
    method: 'CARD',
    methodId: 'card-integrated',
    methodLabel: 'Tarjeta',
    amount: 1200,
    amountOriginal: 1200,
    exchangeRate: 1,
    currencyCode: 'DOP',
    gatewayProvider: 'AZUL',
    gatewayIntegrationId: 'azul-main',
    gatewayTransactionType: 'SALE',
    gatewayStatus: 'PENDING',
    gatewayResponseMessage: 'Pendiente de autorización al finalizar.',
  };
  const approved = buildVoucherConfirmedEntry(pending, { reference: 'a1b2c3', taxAmount: 216.81 });
  assert.equal(approved.gatewayStatus, 'APPROVED');
  assert.equal(approved.gatewayReference, 'A1B2C3');
  assert.equal(approved.gatewayAuthorizationCode, 'A1B2C3');
  assert.equal(approved.gatewayResponseCode, 'VOUCHER');
  assert.equal(approved.gatewayProcessedAmount, 1200);
  assert.equal(approved.gatewayProcessedTaxAmount, 216.81);
  assert.equal(approved.amount, pending.amount, 'the cashier-confirmed amount is never rewritten');
  assert.equal(approved.gatewayProvider, 'AZUL');
  assert.throws(() => buildVoucherConfirmedEntry(pending, { reference: '  ' }), /CARD_VOUCHER_REFERENCE_REQUIRED/);
  // The original tender stays pending: nothing is mutated in place.
  assert.equal(pending.gatewayStatus, 'PENDING');
});

test('the unknown outcome travels as a typed error the modal can recognise', () => {
  const outcome = { paymentId: 'ns:payment:1', intentId: 'intent-1', providerLabel: 'Verifón', amountBase: 99.9 };
  const error = new CardOutcomeUnknownError(outcome);
  assert.equal(error.message, CARD_OUTCOME_UNKNOWN);
  assert.deepEqual(error.outcome, outcome);
  assert.equal(isCardOutcomeUnknownError(error), true);
  // A plain gateway message must never be mistaken for the supervised exception.
  assert.equal(isCardOutcomeUnknownError(new Error('DECLINED')), false);
  assert.equal(isCardOutcomeUnknownError(null), false);
});
