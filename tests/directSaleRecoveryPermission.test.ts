import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoleDefinition, User } from '../types';
import { DEFAULT_ROLES } from '../constants';
import {
  RECOVER_OTHER_SELLER_PARKED_SALES,
  canRecoverDirectSale,
  isDirectSaleParkedTicket,
} from '../utils/directSaleParkedTickets';

const cashier = (id: string, roleId = 'CASHIER'): User => ({ id, name: id, pin: '', role: 'ADMIN', roleId });

test('direct sale recovery uses the authoritative local role and requires an explicit cross-seller grant', () => {
  const roles: RoleDefinition[] = [
    { id: 'CASHIER', name: 'Cajero', permissions: ['POS_CHECKOUT'] },
    { id: 'ALL_ROLE', name: 'General', permissions: ['ALL'] },
    { id: 'AUTHORIZED', name: 'Autorizado', permissions: ['ALL', RECOVER_OTHER_SELLER_PARKED_SALES] },
    { id: 'INACTIVE', name: 'Inactivo', permissions: [RECOVER_OTHER_SELLER_PARKED_SALES], isActive: false },
  ];
  const a = cashier('a');
  const b = cashier('b');
  assert.equal(canRecoverDirectSale('a', a, roles), true);
  assert.equal(canRecoverDirectSale('a', b, roles), false);
  assert.equal(canRecoverDirectSale(null, b, roles), false);
  assert.equal(canRecoverDirectSale('a', cashier('b', 'ALL_ROLE'), roles), false);
  assert.equal(canRecoverDirectSale('a', cashier('b', 'AUTHORIZED'), roles), true);
  assert.equal(canRecoverDirectSale(undefined, cashier('b', 'AUTHORIZED'), roles), true);
  assert.equal(canRecoverDirectSale('a', cashier('b', 'INACTIVE'), roles), false);
  assert.equal(canRecoverDirectSale('a', { ...a, isActive: false }, roles), false);
  assert.equal(canRecoverDirectSale('a', null, roles), false);
  assert.ok(DEFAULT_ROLES.every(role => !role.permissions.includes(RECOVER_OTHER_SELLER_PARKED_SALES)));
});

test('direct-sale classification leaves table, shared table, legacy table, and bar tickets out', () => {
  const sale = { id: 'P-1', name: 'Venta directa', items: [], timestamp: '2026-11-19', directSaleOwnerId: 'a' };
  assert.equal(isDirectSaleParkedTicket(sale), true);
  for (const table of [{ tableId: 5 }, { joinedTableIds: ['5'] }, { name: 'Mesa: Patio 5' }, { barTabId: 'bar' }]) {
    assert.equal(isDirectSaleParkedTicket({ ...sale, ...table }), false);
  }
});
