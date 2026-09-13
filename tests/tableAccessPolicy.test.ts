import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessOtherSellerTables, isTableLockedForUser } from '../utils/tableAccessPolicy';

test('el permiso de perfil permite acceder a una mesa de otro vendedor', () => {
  const canAccess = canAccessOtherSellerTables(['POS_ACCESS_OTHER_SELLER_TABLES']);
  assert.equal(isTableLockedForUser({
    isBeingEdited: false,
    isOccupiedLike: true,
    waiterLockEnabled: true,
    waiterId: 'seller-2',
    currentUserId: 'supervisor-1',
    canAccessOtherSeller: canAccess,
  }), false);
});

test('el permiso no elimina el lock de edición activa de otra terminal', () => {
  assert.equal(isTableLockedForUser({
    isBeingEdited: true,
    isOccupiedLike: true,
    waiterLockEnabled: true,
    waiterId: 'seller-2',
    currentUserId: 'supervisor-1',
    canAccessOtherSeller: true,
  }), true);
});
