import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_CONFLICT_PERMISSIONS, canResolveCatalogEdit, hasCatalogConflictPermission } from '../services/sync/catalogEdits';
import type { RoleDefinition, User } from '../types';

const user = { id: 'user-1', name: 'Operador', pin: '1234', role: 'LIMITED', roleId: 'LIMITED' } satisfies User;

test('catalog conflict permissions are resolved from the current user role', () => {
    const roles = [{ id: 'LIMITED', name: 'Limitado', permissions: [CATALOG_CONFLICT_PERMISSIONS.view] }] as RoleDefinition[];
    assert.equal(hasCatalogConflictPermission(user, roles, CATALOG_CONFLICT_PERMISSIONS.view), true);
    assert.equal(hasCatalogConflictPermission(user, roles, CATALOG_CONFLICT_PERMISSIONS.force), false);
    assert.equal(hasCatalogConflictPermission(null, roles, CATALOG_CONFLICT_PERMISSIONS.view), false);
});

test('ALL grants every catalog conflict action', () => {
    const roles = [{ id: 'LIMITED', name: 'Administrador', permissions: ['ALL'] }] as RoleDefinition[];
    for (const permission of Object.values(CATALOG_CONFLICT_PERMISSIONS)) {
        assert.equal(hasCatalogConflictPermission(user, roles, permission), true);
    }
});

test('a failed pending catalog edit can be discarded but not retried as a conflict', () => {
    const failedPending = { status: 'PENDING' as const, syncError: 'Operation sync failed: 403' };
    assert.equal(canResolveCatalogEdit(failedPending, 'DISCARD'), true);
    assert.equal(canResolveCatalogEdit(failedPending, 'RETRY'), false);
    assert.equal(canResolveCatalogEdit({ status: 'PENDING', syncError: undefined }, 'DISCARD'), false);
});
