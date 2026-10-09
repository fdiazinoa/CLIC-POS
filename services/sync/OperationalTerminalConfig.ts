type Identity = { tenantId: string; terminalId: string; posDeviceId?: string | null };
const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0
  && value.every(id => typeof id === 'string' && id.trim().length > 0);

/** Pure race fingerprint. Credential/profile loaders may migrate and must not run here. Never log this value. */
export const readOperationalTerminalBinding = (): string => JSON.stringify([
  'clic_erp_sync_company_id', 'clic_erp_sync_terminal_id', 'clic_erp_sync_tenant_id', 'CLIC_POS_DEVICE_ID',
  'clic_sync_profile', 'clic_terminal_credentials_v1', 'clic_erp_sync_token', 'clic_erp_sync_auth_token',
  'CLIC_ERP_SYNC_TOKEN', 'syncAuthToken', 'sync_auth_token', 'erp_sync_token', 'CLIC_POS_DEVICE_TOKEN',
  'POS_DEVICE_TOKEN', 'pos_device_token', 'clic_erp_device_token', 'terminalToken', 'activationToken',
].map(key => localStorage.getItem(key)));

/** Validate fresh raw terminal authority, before any normalization or persistence. */
export const assertOperationalTerminalConfig = (payload: unknown, identity: Identity): void => {
  if (!object(payload)) throw new Error('ERP_OPERATIONAL_TERMINAL_CONFIG_REQUIRED');
  const snapshot = payload.terminal_config ?? payload;
  if (!object(snapshot) || payload.success === false || (payload.status && payload.status !== 'success')
    || payload.resolution_error != null || snapshot.resolution_error != null || !object(snapshot.resolved)) {
    throw new Error('ERP_OPERATIONAL_TERMINAL_CONFIG_REQUIRED');
  }
  if (snapshot.tenant_id !== identity.tenantId || snapshot.terminal_id !== identity.terminalId) {
    throw new Error('ERP_OPERATIONAL_TERMINAL_IDENTITY_MISMATCH');
  }
  for (const record of [payload, snapshot, payload.terminal, snapshot.resolved.identity, snapshot.resolved.terminal]) {
    if (!object(record)) continue;
    if (record.tenant_id !== undefined && record.tenant_id !== identity.tenantId
      || [record.terminal_id, record.erp_terminal_id].some(id => id !== undefined && id !== identity.terminalId)
      || (record === payload.terminal || record === snapshot.resolved.terminal || record === snapshot.resolved.identity)
        && record.id !== undefined && record.id !== identity.terminalId
      || identity.posDeviceId && record.device_id !== undefined && record.device_id !== identity.posDeviceId) {
      throw new Error('ERP_OPERATIONAL_TERMINAL_IDENTITY_MISMATCH');
    }
  }
  const pricing = snapshot.resolved.pricing;
  if (!object(pricing) || !ids(pricing.allowed_tariff_ids) || typeof pricing.default_tariff_id !== 'string'
    || !pricing.allowed_tariff_ids.includes(pricing.default_tariff_id)) {
    throw new Error('ERP_OPERATIONAL_TERMINAL_PRICING_REQUIRED');
  }
  const inventory = snapshot.resolved.inventory;
  if (!object(inventory) || !ids(inventory.allowed_warehouse_ids) || typeof inventory.default_warehouse_id !== 'string'
    || !inventory.allowed_warehouse_ids.includes(inventory.default_warehouse_id)
    || !Array.isArray(inventory.warehouses)
    || !inventory.warehouses.some((row: unknown) => object(row) && row.id === inventory.default_warehouse_id)
    || inventory.default_warehouse != null && (!object(inventory.default_warehouse)
      || inventory.default_warehouse.id !== inventory.default_warehouse_id)) {
    throw new Error('ERP_OPERATIONAL_TERMINAL_INVENTORY_REQUIRED');
  }
  const documents = snapshot.resolved.documents;
  if (!object(documents) || !Array.isArray(documents.document_series) || !Array.isArray(documents.fiscal_ranges)) {
    throw new Error('ERP_OPERATIONAL_TERMINAL_DOCUMENTS_REQUIRED');
  }
};

/** Read persisted credentials without migration or writes. Unknown identity cannot authorize preservation. */
export const readOperationalCatalogBindingProof = (): { terminalId: string; tenantId: string; companyId: string; deviceId: string } | undefined => {
  try {
    const credentials = JSON.parse(localStorage.getItem('clic_terminal_credentials_v1') || '{}');
    if (!object(credentials)) return undefined;
    const proof = {
      terminalId: credentials.erpTerminalId || localStorage.getItem('clic_erp_sync_terminal_id'),
      tenantId: credentials.erpTenantId || localStorage.getItem('clic_erp_sync_tenant_id'),
      companyId: credentials.companyId || localStorage.getItem('clic_erp_sync_company_id'),
      deviceId: credentials.deviceId || localStorage.getItem('CLIC_POS_DEVICE_ID'),
    };
    const mirrors = ['clic_erp_sync_terminal_id', 'clic_erp_sync_tenant_id', 'clic_erp_sync_company_id', 'CLIC_POS_DEVICE_ID']
      .map(key => localStorage.getItem(key));
    if (mirrors.some((value, index) => value && value !== Object.values(proof)[index])) return undefined;
    return Object.values(proof).every(value => typeof value === 'string' && value.trim().length > 0) ? proof : undefined;
  } catch { return undefined; }
};
