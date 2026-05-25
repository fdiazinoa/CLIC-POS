const ERP_BINDING_KEYS_FOR_LOCAL_MODE = [
    'clic_erp_sync_terminal_id',
    'clic_erp_sync_tenant_id',
    'CLIC_ERP_SYNC_URL',
    'CLIC_ERP_BASE_URL',
    'erp_base_url'
] as const;

export function clearErpBindingForLocalMode(): { cleared: string[] } {
    if (localStorage.getItem('clic_sync_mode') !== 'POS_LOCAL') {
        return { cleared: [] };
    }

    const cleared: string[] = [];

    for (const key of ERP_BINDING_KEYS_FOR_LOCAL_MODE) {
        localStorage.removeItem(key);
        console.log(`[clearErpBindingForLocalMode] removed ${key}`);
        cleared.push(key);
    }

    return { cleared };
}
