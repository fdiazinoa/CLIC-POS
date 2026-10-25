import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveRefundFiscalReservation } from '../services/fiscal/RefundFiscalReservation';

const items = [{ id: 'item', cartId: 'line', quantity: 1, price: 100 }];

test('E34 refund prefers the atomic allocation checkout', async () => {
  let reserved = 0;
  const checkout = { allocation: { ncf: 'E340000000001', authorizationId: 'auth', authorityHash: 'hash', checkoutId: 'co', transactionId: 'tx' }, allocationIssuance: { ncf: 'E340000000001' } };
  const result = await reserveRefundFiscalReservation({
    refundFiscalType: 'E34', originalTransactionId: 'orig', items,
    client: { reserveOfflineCheckout: async (cartIdentity, operationId) => { reserved++; assert.ok(cartIdentity.includes('"fiscalType":"E34"')); assert.ok(cartIdentity.includes('"originalTransactionId":"orig"')); return checkout; } },
    db: { reserveFiscalNumber: async () => { throw new Error('should not fall back'); } },
    terminalId: 'T', activeTerminalConfig: {},
  });
  assert.equal(reserved, 1);
  assert.equal(result.ncf, 'E340000000001');
  assert.equal(result.checkout, checkout);
});

test('non-E34 or missing original falls back to reserveFiscalNumber', async () => {
  for (const opts of [
    { refundFiscalType: 'B04', originalTransactionId: 'orig' },
    { refundFiscalType: 'E34', originalTransactionId: undefined },
    { refundFiscalType: 'E34', originalTransactionId: 'orig', noClient: true },
  ]) {
    let fellBack = 0;
    const result = await reserveRefundFiscalReservation({
      refundFiscalType: opts.refundFiscalType,
      originalTransactionId: opts.originalTransactionId,
      items,
      client: (opts as any).noClient ? undefined : { reserveOfflineCheckout: async () => ({}) },
      db: { reserveFiscalNumber: async () => { fellBack++; return { ncf: 'B040000000001', fiscalIssuance: { ncf: 'B040000000001' } }; } },
      terminalId: 'T', activeTerminalConfig: {},
    });
    assert.equal(fellBack, 1);
    assert.equal(result.ncf, 'B040000000001');
    assert.equal(result.checkout, undefined);
  }
});
