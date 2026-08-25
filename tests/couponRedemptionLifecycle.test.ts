import assert from 'node:assert/strict';
import test from 'node:test';

import type { BusinessConfig } from '../types.ts';
import { couponService } from '../utils/couponService.ts';

const buildConfig = (): BusinessConfig => ({
  campaigns: [{
    id: 'campaign-10',
    name: 'Diez por ciento',
    description: 'Descuento 10%',
    startDate: '2020-01-01T00:00:00.000Z',
    endDate: '2099-12-31T23:59:59.999Z',
    benefitType: 'PERCENT',
    benefitValue: 10,
    totalGenerated: 1,
    createdAt: '2026-08-25T00:00:00.000Z',
  }],
  coupons: [{
    id: 'coupon-10',
    campaignId: 'campaign-10',
    code: 'CUPON-48TN-6UYC',
    status: 'GENERATED',
    createdAt: '2026-08-25T00:00:00.000Z',
  }],
} as BusinessConfig);

test('bloquea el cupón cuando el ticket no tiene artículos', () => {
  const config = buildConfig();
  const result = couponService.validateCoupon('CUPON-48TN-6UYC', config, 0);

  assert.equal(result.success, false);
  assert.equal(result.error, 'Agregue al menos un artículo antes de aplicar el cupón.');
  assert.equal(config.coupons?.[0].status, 'GENERATED');
});

test('validar un cupón con artículos no lo marca como utilizado', () => {
  const config = buildConfig();
  const result = couponService.validateCoupon('CUPON-48TN-6UYC', config, 375);

  assert.equal(result.success, true);
  assert.equal(result.benefit?.value, 10);
  assert.equal(result.coupon?.status, 'GENERATED');
  assert.equal(config.coupons?.[0].status, 'GENERATED');
});

test('confirma el consumo únicamente con la referencia final de la venta', () => {
  const updated = couponService.commitCouponRedemption(
    'coupon-10',
    'TCK-000123',
    'POS-001',
    buildConfig(),
    '2026-08-25T16:00:00.000Z',
  );

  assert.equal(updated.coupons?.[0].status, 'REDEEMED');
  assert.equal(updated.coupons?.[0].ticketRef, 'TCK-000123');
  assert.equal(updated.coupons?.[0].terminalId, 'POS-001');
  assert.equal(updated.coupons?.[0].redeemedAt, '2026-08-25T16:00:00.000Z');
});
