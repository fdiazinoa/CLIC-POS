import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveScannedCouponCode } from '../utils/couponScan.ts';

test('reconoce y normaliza códigos CUPON provenientes del lector', () => {
  assert.equal(resolveScannedCouponCode('  cupon-48tn-6uyc\n', []), 'CUPON-48TN-6UYC');
});

test('reconoce códigos de campañas sincronizadas aunque no usen el prefijo CUPON', () => {
  const coupons = [{ code: 'VERANO-A1B2-C3D4' }];
  assert.equal(resolveScannedCouponCode('verano-a1b2-c3d4', coupons), 'VERANO-A1B2-C3D4');
});

test('no desvía códigos normales de productos al flujo de cupones', () => {
  assert.equal(resolveScannedCouponCode('7501234567890', []), null);
  assert.equal(resolveScannedCouponCode('SKU-100', []), null);
});
