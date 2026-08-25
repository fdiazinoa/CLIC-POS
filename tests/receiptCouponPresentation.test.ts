import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveReceiptCouponCodes } from '../utils/receiptCouponPresentation';

test('resuelve y deduplica códigos de cupón persistidos por formatos actuales y legacy', () => {
  assert.deepEqual(resolveReceiptCouponCodes({
    couponCode: 'PROMO-2026',
    coupon_code: 'promo-2026',
    coupons: [
      { id: 'coupon-1', code: 'PROMO-2026' },
      { id: 'coupon-2', code: 'VIP-25' },
    ],
  }), ['PROMO-2026', 'VIP-25']);
});

test('omite códigos vacíos cuando la venta no tuvo redención', () => {
  assert.deepEqual(resolveReceiptCouponCodes({
    couponCode: ' ',
    coupons: [],
  }), []);
});
