import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPersistedActivationIdentity,
  resolveActivationTenantIdentity,
} from '../services/setup/activationTenantIdentity';

test('resolves the ERP tenant separately from the Cloud-Admin tenant', () => {
  const identity = resolveActivationTenantIdentity({
    email: 'fdiaz@mercasend.com',
    user_metadata: {
      tenant_id: '9eda7d73-76e4-4432-ad13-4934fefe8f69',
      erp_tenant_id: '9eda7d73-76e4-4432-ad13-4934fefe8f69',
      tenant_name: 'MercaSend-Pruebas',
    },
    app_metadata: {
      tenant_id: 'afb62bd5-a822-4238-b523-655ce4b901b8',
      erp_tenant_id: '9eda7d73-76e4-4432-ad13-4934fefe8f69',
    },
  });

  assert.equal(identity.erpTenantId, '9eda7d73-76e4-4432-ad13-4934fefe8f69');
  assert.equal(identity.cloudAdminTenantId, 'afb62bd5-a822-4238-b523-655ce4b901b8');
  assert.equal(identity.email, 'fdiaz@mercasend.com');
  assert.equal(identity.source, 'AUTH_ERP_TENANT_METADATA');
});

test('clears a previous tenant and terminal identity before activation', () => {
  const removed: string[] = [];
  clearPersistedActivationIdentity({ removeItem: (key) => removed.push(key) });

  assert.ok(removed.includes('active_tenant_id'));
  assert.ok(removed.includes('clic_tenant_id'));
  assert.ok(removed.includes('clic_erp_sync_tenant_id'));
  assert.ok(removed.includes('cloud_admin_tenant_id'));
  assert.ok(removed.includes('clic_cloud_admin_tenant_id'));
  assert.ok(removed.includes('active_terminal_id'));
  assert.ok(removed.includes('clic_erp_sync_terminal_id'));
  assert.ok(!removed.includes('clic_tenant_email'));
});
