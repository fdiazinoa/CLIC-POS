export type TenantIdentity = {
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantEmail?: string | null;
};

type TenantIdentityStorage = Pick<Storage, 'getItem'>;

const normalizeOptional = (value?: string | null) => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

export const resolveStoredTenantIdentity = (storage: TenantIdentityStorage): TenantIdentity => {
    const explicitCloudTenantId =
        normalizeOptional(storage.getItem('cloud_admin_tenant_id'))
        || normalizeOptional(storage.getItem('clic_cloud_admin_tenant_id'))
        || normalizeOptional(storage.getItem('clic_cloud_tenant_id'));
    const hasErpTenantIdentity = Boolean(
        normalizeOptional(storage.getItem('clic_erp_sync_tenant_id'))
        || normalizeOptional(storage.getItem('clic_erp_tenant_id'))
    );

    return {
        // clic_tenant_id is the local ERP tenant after POS_ERP pairing. Only use it
        // as a legacy cloud fallback when this installation has no ERP identity.
        tenantId:
            explicitCloudTenantId
            || (!hasErpTenantIdentity
                ? normalizeOptional(storage.getItem('clic_tenant_id'))
                    || normalizeOptional(storage.getItem('active_tenant_id'))
                : '')
            || null,
        tenantSlug: normalizeOptional(storage.getItem('clic_tenant_slug')) || null,
        tenantEmail: normalizeOptional(storage.getItem('clic_tenant_email')).toLowerCase() || null,
    };
};

export const resolveStoredErpTenantIdentity = (storage: TenantIdentityStorage): TenantIdentity => ({
    tenantId:
        normalizeOptional(storage.getItem('clic_erp_sync_tenant_id'))
        || normalizeOptional(storage.getItem('clic_erp_tenant_id'))
        || normalizeOptional(storage.getItem('clic_tenant_id'))
        || normalizeOptional(storage.getItem('active_tenant_id'))
        || null,
    tenantSlug: normalizeOptional(storage.getItem('clic_tenant_slug')) || null,
    tenantEmail: normalizeOptional(storage.getItem('clic_tenant_email')).toLowerCase() || null,
});
