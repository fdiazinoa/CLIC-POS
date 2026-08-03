import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStoredTenantIdentity } from '../utils/tenantIdentityStorage';

const storageFrom = (values: Record<string, string>) => ({
  getItem: (key: string) => values[key] ?? null,
});

test('uses the canonical Cloud Admin tenant for registry calls', () => {
  const identity = resolveStoredTenantIdentity(storageFrom({
    clic_tenant_id: '11111111-1111-4111-8111-111111111111',
    clic_erp_sync_tenant_id: '11111111-1111-4111-8111-111111111111',
    clic_cloud_tenant_id: '22222222-2222-4222-8222-222222222222',
    clic_tenant_email: 'CLIENTE@EXAMPLE.COM',
  }));

  assert.equal(identity.tenantId, '22222222-2222-4222-8222-222222222222');
  assert.equal(identity.tenantEmail, 'cliente@example.com');
});

test('does not send a local ERP tenant as the Cloud Admin tenant', () => {
  const identity = resolveStoredTenantIdentity(storageFrom({
    clic_tenant_id: '11111111-1111-4111-8111-111111111111',
    clic_erp_sync_tenant_id: '11111111-1111-4111-8111-111111111111',
    clic_tenant_slug: 'cliente-pruebas',
    clic_tenant_email: 'cliente@example.com',
  }));

  assert.equal(identity.tenantId, null);
  assert.equal(identity.tenantSlug, 'cliente-pruebas');
  assert.equal(identity.tenantEmail, 'cliente@example.com');
});

test('keeps the legacy POS_ONLY tenant fallback', () => {
  const identity = resolveStoredTenantIdentity(storageFrom({
    clic_tenant_id: '33333333-3333-4333-8333-333333333333',
  }));

  assert.equal(identity.tenantId, '33333333-3333-4333-8333-333333333333');
});
