export type ActivationUser = {
  id?: string | null;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

export type ActivationTenantIdentity = {
  email: string;
  erpTenantId: string | null;
  cloudAdminTenantId: string | null;
  tenantName: string | null;
  slug: string | null;
  source: string;
};

const asString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) return normalized;
  }
  return null;
};

export const resolveActivationTenantIdentity = (
  user: ActivationUser,
  fallbackEmail?: string | null,
): ActivationTenantIdentity => {
  const userMetadata = user.user_metadata || {};
  const appMetadata = user.app_metadata || {};
  const erpTenantId = firstString(
    userMetadata.erp_tenant_id,
    appMetadata.erp_tenant_id,
    userMetadata.tenant_id,
    appMetadata.tenant_id,
  );
  const cloudAdminTenantId = firstString(
    appMetadata.cloud_admin_tenant_id,
    appMetadata.cloudAdminTenantId,
    appMetadata.tenant_id,
    userMetadata.cloud_admin_tenant_id,
    userMetadata.cloudAdminTenantId,
  );
  const source = userMetadata.erp_tenant_id || appMetadata.erp_tenant_id
    ? 'AUTH_ERP_TENANT_METADATA'
    : userMetadata.tenant_id
      ? 'AUTH_USER_TENANT_METADATA'
      : appMetadata.tenant_id
        ? 'AUTH_APP_TENANT_METADATA'
        : 'AUTH_EMAIL_ONLY';

  return {
    email: asString(user.email || fallbackEmail).toLowerCase(),
    erpTenantId,
    cloudAdminTenantId,
    tenantName: firstString(
      userMetadata.tenant_name,
      userMetadata.tenantName,
      userMetadata.name,
      appMetadata.tenant_name,
      appMetadata.tenantName,
    ),
    slug: firstString(userMetadata.slug, appMetadata.slug),
    source,
  };
};

export const clearPersistedActivationIdentity = (storage: Pick<Storage, 'removeItem'>) => {
  [
    'active_tenant_id',
    'clic_tenant_id',
    'clic_tenant_name',
    'clic_erp_tenant_id',
    'clic_erp_sync_tenant_id',
    'clic_cloud_tenant_id',
    'cloud_admin_tenant_id',
    'clic_cloud_admin_tenant_id',
    'active_terminal_id',
    'CLIC_POS_TERMINAL_ID',
    'clic_last_authorized_erp_terminal_id',
    'clic_erp_sync_terminal_id',
    'clic_erp_sync_company_id',
    'clic_erp_sync_store_id',
    'clic_erp_sync_local_terminal_id',
    'clic_erp_sync_terminal_name',
  ].forEach((key) => storage.removeItem(key));
};
