import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoleDefinition, User } from '../types';
import {
  calculateSalesCommission,
  canGrantDiscountPercent,
  resolveUserMaxDiscountPercent,
} from '../utils/userSalesPolicy';

const roles: RoleDefinition[] = [{
  id: 'SELLER',
  name: 'Vendedor',
  permissions: ['POS_DISCOUNT'],
  maxDiscountPercent: 20,
}];
const user: User = { id: 'u1', name: 'Ana', pin: '1234', role: 'SELLER', roleId: 'SELLER' };

test('el límite individual del usuario prevalece sobre el límite del rol', () => {
  assert.equal(resolveUserMaxDiscountPercent({ ...user, maxDiscountPercent: 8 }, roles), 8);
  assert.equal(canGrantDiscountPercent({ ...user, maxDiscountPercent: 8 }, roles, 8), true);
  assert.equal(canGrantDiscountPercent({ ...user, maxDiscountPercent: 8 }, roles, 8.01), false);
});

test('sin límite individual el usuario hereda el límite de su rol', () => {
  assert.equal(resolveUserMaxDiscountPercent(user, roles), 20);
  assert.equal(canGrantDiscountPercent(user, roles, 20), true);
  assert.equal(canGrantDiscountPercent(user, roles, 25), false);
});

test('la comisión queda redondeada y congelada en la venta', () => {
  assert.deepEqual(calculateSalesCommission(1234.56, { ...user, commissionPercent: 2.5 }), {
    salesCommissionPercent: 2.5,
    salesCommissionAmount: 30.86,
  });
  assert.deepEqual(calculateSalesCommission(1234.56, user), {});
});
