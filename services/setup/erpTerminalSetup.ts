import { BusinessConfig, Product, TerminalConfig } from '../../types';
import { getDefaultRoleConfig, resolveDeviceRoleValue } from '../../utils/deviceRoleHelpers';

export interface RuntimeTerminalCard {
  id: string;
  erpTerminalId: string;
  name: string;
  location: string;
  occupied: boolean;
  currentDeviceId?: string;
  config: TerminalConfig;
}

export interface RuntimeTerminalListResponse {
  tenant_id: string;
  erp_base_url?: string | null;
  terminals: RuntimeTerminalCard[];
}

export interface RuntimeBindTerminalResponse {
  success: boolean;
  tenant_id: string;
  terminal_id: string;
  erp_terminal_id: string;
  terminal_name?: string | null;
  company_id?: string | null;
  store_id?: string | null;
  transferred?: boolean;
  previous_device_id?: string | null;
  config: BusinessConfig;
  deviceToken?: string;
  device_token?: string;
  terminalToken?: string;
  terminal_token?: string;
  activationToken?: string;
  activation_token?: string;
  syncToken?: string;
  sync_token?: string;
  syncAuthToken?: string;
  sync_auth_token?: string;
  tokenExpiresAt?: string;
  token_expires_at?: string;
}

export interface RuntimeInitialConfigResponse {
  success: boolean;
  tenant_id?: string;
  terminal_id?: string;
  erp_terminal_id?: string;
  config?: BusinessConfig;
  terminal_config?: Record<string, any>;
  snapshot_meta?: Record<string, any>;
  items?: Product[];
  deviceToken?: string;
  device_token?: string;
  terminalToken?: string;
  terminal_token?: string;
  activationToken?: string;
  activation_token?: string;
  syncToken?: string;
  sync_token?: string;
  syncAuthToken?: string;
  sync_auth_token?: string;
  tokenExpiresAt?: string;
  token_expires_at?: string;
}

type BindingMode = 'MASTER' | 'SLAVE';

type ErpIdentity = {
  tenantId?: string | null;
  tenantSlug?: string | null;
  tenantEmail?: string | null;
  deviceId?: string | null;
  erpBaseUrl: string;
};

class TerminalOccupiedError extends Error {
  currentDeviceId?: string;

  constructor(message: string, currentDeviceId?: string) {
    super(message);
    this.name = 'TerminalOccupiedError';
    this.currentDeviceId = currentDeviceId;
  }
}

const REQUEST_TIMEOUT_MS = 12000;

const asObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const pickAuthString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const normalized = asString(value).replace(/[\r\n\t]/g, '').trim();
    if (!normalized) continue;
    if (['undefined', 'null', 'nan', '[object object]'].includes(normalized.toLowerCase())) continue;
    return normalized;
  }
  return undefined;
};

const extractRuntimeAuthPayload = (...sources: unknown[]) => {
  const records = sources.map(asObject).filter((record) => Object.keys(record).length > 0);
  const deviceToken = pickAuthString(...records.flatMap((record) => [
    record.deviceToken,
    record.device_token,
    record.terminalToken,
    record.terminal_token,
    record.activationToken,
    record.activation_token,
    asObject(record.security).deviceToken,
    asObject(record.security).device_token,
    asObject(record.metadata).deviceToken,
    asObject(record.metadata).device_token,
  ]));
  const terminalToken = pickAuthString(...records.flatMap((record) => [
    record.terminalToken,
    record.terminal_token,
    asObject(record.security).terminalToken,
    asObject(record.security).terminal_token,
  ]));
  const activationToken = pickAuthString(...records.flatMap((record) => [
    record.activationToken,
    record.activation_token,
    asObject(record.security).activationToken,
    asObject(record.security).activation_token,
  ]));
  const syncToken = pickAuthString(...records.flatMap((record) => [
    record.syncToken,
    record.sync_token,
    record.syncAuthToken,
    record.sync_auth_token,
    asObject(record.security).syncToken,
    asObject(record.security).sync_token,
    asObject(record.runtime).syncAuthToken,
    asObject(record.runtime).sync_auth_token,
  ]));
  const tokenExpiresAt = pickAuthString(...records.flatMap((record) => [
    record.tokenExpiresAt,
    record.token_expires_at,
    record.expiresAt,
    record.expires_at,
    asObject(record.security).tokenExpiresAt,
    asObject(record.security).token_expires_at,
  ]));

  return { deviceToken, terminalToken, activationToken, syncToken, tokenExpiresAt };
};

const cloneDeep = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

const fetchErpJson = async (
  baseUrl: string,
  path: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: Record<string, any>;
    headers?: Record<string, string>;
  }
) => {
  const response = await withTimeout(
    fetch(`${stripTrailingSlashes(baseUrl)}${path}`, {
      method: options?.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.headers || {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    }),
    `ERP request ${path}`
  );

  const text = await response.text();
  let payload: any = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message =
      asString(asObject(payload).message) ||
      asString(asObject(payload).error) ||
      `${response.status} ${response.statusText}`.trim();
    throw new Error(`ERP ${path}: ${message}`);
  }

  return payload;
};

const fetchErpTerminals = async (
  baseUrl: string,
  filters: {
    tenantId?: string | null;
    companyId?: string | null;
    storeId?: string | null;
  }
) => {
  const params = new URLSearchParams();
  if (filters.tenantId) params.set('tenant_id', filters.tenantId);
  if (filters.companyId) params.set('company_id', filters.companyId);
  if (filters.storeId) params.set('store_id', filters.storeId);

  const payload = await fetchErpJson(
    baseUrl,
    `/api/sync/terminals${params.toString() ? `?${params.toString()}` : ''}`
  );

  return Array.isArray(payload?.terminals) ? payload.terminals : [];
};

const fetchErpTenants = async (baseUrl: string) => {
  const payload = await fetchErpJson(baseUrl, '/api/sync/tenants');
  return Array.isArray(payload?.tenants) ? payload.tenants : [];
};

const fetchTerminalProfile = async (baseUrl: string, tenantId: string, terminalId: string) => {
  return fetchErpJson(
    baseUrl,
    `/api/sync/bootstrap/terminal-profile?tenant_id=${encodeURIComponent(tenantId)}&terminal_id=${encodeURIComponent(terminalId)}`
  );
};

const fetchTerminalProfileSafe = async (baseUrl: string, tenantId: string, terminalId: string) => {
  try {
    return await fetchTerminalProfile(baseUrl, tenantId, terminalId);
  } catch (error) {
    console.warn(`⚠️ Terminal profile fallback for ${terminalId}:`, error);
    return { profile: {} };
  }
};

const bootstrapErpTenantOnce = async (identity: ErpIdentity) => {
  return fetchErpJson(identity.erpBaseUrl, '/api/sync/bootstrap/check', {
    method: 'POST',
    body: {
      tenant_id: identity.tenantId || null,
      company_ref: identity.tenantSlug || null,
      email: identity.tenantEmail || null,
      device_id: identity.deviceId || null,
    },
  });
};

const bootstrapErpTenant = async (identity: ErpIdentity) => {
  const attempts = [
    {
      tenantId: identity.tenantId || null,
      tenantSlug: identity.tenantSlug || null,
      tenantEmail: identity.tenantEmail || null,
      deviceId: identity.deviceId || null,
      erpBaseUrl: identity.erpBaseUrl,
    },
    {
      tenantId: null,
      tenantSlug: identity.tenantSlug || null,
      tenantEmail: identity.tenantEmail || null,
      deviceId: identity.deviceId || null,
      erpBaseUrl: identity.erpBaseUrl,
    },
  ];

  let lastError: Error | null = null;

  for (const attempt of attempts) {
    if (!attempt.tenantId && !attempt.tenantSlug && !attempt.tenantEmail && !attempt.deviceId) {
      continue;
    }

    try {
      return await bootstrapErpTenantOnce(attempt);
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('No se pudo resolver un tenant operativo del ERP.');
};

const normalizeTenantKey = (value: unknown): string => {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
};

const findMappedErpTenant = (
  tenants: any[],
  identity: {
    tenantId?: string | null;
    tenantSlug?: string | null;
  }
) => {
  const cloudTenantId = asString(identity.tenantId);
  const tenantSlug = normalizeTenantKey(identity.tenantSlug);

  return (
    tenants.find((tenant) => asString(asObject(tenant?.activation).cloud_admin_tenant_id) === cloudTenantId)
    || (tenantSlug
      ? tenants.find((tenant) => normalizeTenantKey(tenant?.company_ref) === tenantSlug)
        || tenants.find((tenant) => normalizeTenantKey(tenant?.name) === tenantSlug)
      : null)
    || null
  );
};

const resolveBootstrapContext = (
  bootstrap: any,
  fallbackTenantId?: string | null
) => {
  return {
    tenantId:
      asString(bootstrap?.tenant?.id)
      || asString(bootstrap?.activation?.tenant_id)
      || asString(fallbackTenantId)
      || null,
    tenantName: asString(bootstrap?.tenant?.name) || null,
    companyId: asString(bootstrap?.company?.id) || null,
    storeId: asString(bootstrap?.store?.id) || null,
  };
};

const resolveTenantDirectoryContext = async (
  identity: {
    tenantId?: string | null;
    tenantSlug?: string | null;
    erpBaseUrl: string;
  }
) => {
  const tenants = await fetchErpTenants(identity.erpBaseUrl);
  const matchedTenant = findMappedErpTenant(tenants, identity);

  if (!matchedTenant) return null;

  return {
    tenantId: asString(matchedTenant?.id) || null,
    tenantName: asString(matchedTenant?.name) || null,
    companyId: asString(asObject(matchedTenant?.primary_company).id) || null,
    storeId: asString(asObject(matchedTenant?.primary_store).id) || null,
    source: 'ERP_TENANT_DIRECTORY',
  };
};

const resolveErpTerminalContext = async (identity: ErpIdentity) => {
  const candidates: Array<{
    tenantId: string | null;
    tenantName: string | null;
    companyId: string | null;
    storeId: string | null;
    source: string;
  }> = [];
  let lastBootstrapError: Error | null = null;

  try {
    const bootstrap = await bootstrapErpTenant(identity);
    const candidate = resolveBootstrapContext(bootstrap, identity.tenantId);
    if (candidate.tenantId) {
      candidates.push({
        ...candidate,
        source: 'ERP_BOOTSTRAP',
      });
    }
  } catch (error: any) {
    lastBootstrapError = error instanceof Error ? error : new Error(String(error));
  }

  try {
    const mappedTenant = await resolveTenantDirectoryContext(identity);
    if (mappedTenant && !candidates.some((candidate) => candidate.tenantId === mappedTenant.tenantId)) {
      candidates.push(mappedTenant);
    }
  } catch (error) {
    console.warn('⚠️ ERP tenant directory lookup failed:', error);
  }

  let fallbackContext: any = null;

  for (const candidate of candidates) {
    const terminals = await fetchErpTerminals(identity.erpBaseUrl, {
      tenantId: candidate.tenantId,
      companyId: candidate.companyId,
      storeId: candidate.storeId,
    });

    const contextWithTerminals = {
      ...candidate,
      terminals,
    };

    if (terminals.length > 0) {
      return contextWithTerminals;
    }

    fallbackContext = fallbackContext || contextWithTerminals;
  }

  if (fallbackContext) return fallbackContext;

  throw lastBootstrapError || new Error('No se pudo resolver un tenant operativo del ERP.');
};

const resolveOccupiedDeviceId = (terminal: any, terminalProfilePayload: any): string | undefined => {
  const profile = asObject(terminalProfilePayload?.profile);
  const metadata = asObject(profile.metadata);
  const terminalMetadata = asObject(terminal?.metadata);

  return (
    asString(metadata.bound_device_id) ||
    asString(metadata.currentDeviceId) ||
    asString(metadata.device_id) ||
    asString(metadata.terminal_device_id) ||
    asString(terminal?.device_id) ||
    asString(terminalMetadata.bound_device_id) ||
    undefined
  );
};

const resolveOperationalTerminalId = (terminal: any): string => {
  const config = asObject(terminal?.config);
  return (
    asString(terminal?.station_number) ||
    asString(terminal?.code) ||
    asString(terminal?.terminal_code) ||
    asString(terminal?.pos_code) ||
    asString(config.station_number) ||
    asString(terminal?.name) ||
    asString(terminal?.id)
  );
};

const resolveTerminalName = (terminal: any, fallbackId: string): string => {
  return asString(terminal?.name) || fallbackId;
};

const resolveErpTerminalDeviceRole = (terminal: any) => {
  const config = asObject(terminal?.config);
  const metadata = asObject(terminal?.metadata);
  const terminalConfig = asObject(terminal?.terminal_config);
  const resolved = asObject(terminalConfig.resolved);
  const identity = asObject(resolved.identity);
  const resolvedTerminal = asObject(resolved.terminal);
  const deviceRole = asObject(config.deviceRole ?? config.device_role);

  return resolveDeviceRoleValue([
    terminal?.deviceRole,
    terminal?.device_role,
    terminal?.deviceRoleCode,
    terminal?.device_role_code,
    terminal?.roleCode,
    terminal?.role_code,
    terminal?.role,
    config.deviceRole,
    config.device_role,
    config.deviceRoleCode,
    config.device_role_code,
    config.roleCode,
    config.role_code,
    config.role,
    deviceRole.role,
    deviceRole.deviceRole,
    deviceRole.device_role,
    deviceRole.role_code,
    deviceRole.device_role_code,
    metadata.deviceRole,
    metadata.device_role,
    metadata.role_code,
    metadata.device_role_code,
    identity.deviceRole,
    identity.device_role,
    identity.role_code,
    identity.device_role_code,
    resolvedTerminal.deviceRole,
    resolvedTerminal.device_role,
    resolvedTerminal.role_code,
    resolvedTerminal.device_role_code,
    resolved.deviceRole,
    resolved.device_role,
    resolved.role_code,
    resolved.device_role_code,
  ]);
};

const applyErpTerminalDeviceRole = (terminalConfig: TerminalConfig, erpTerminal: any): TerminalConfig => {
  const role = resolveErpTerminalDeviceRole(erpTerminal);
  if (!role) return terminalConfig;

  const defaults = getDefaultRoleConfig(role);
  const currentDeviceRole = terminalConfig.deviceRole || defaults;

  return {
    ...terminalConfig,
    deviceRole: {
      ...defaults,
      ...currentDeviceRole,
      role,
      authLevel: role === currentDeviceRole.role
        ? currentDeviceRole.authLevel || defaults.authLevel
        : defaults.authLevel,
      allowedModules: role === currentDeviceRole.role
        ? currentDeviceRole.allowedModules || defaults.allowedModules
        : defaults.allowedModules,
      defaultRoute: role === currentDeviceRole.role
        ? currentDeviceRole.defaultRoute || defaults.defaultRoute
        : defaults.defaultRoute,
      uiSettings: {
        ...defaults.uiSettings,
        ...(role === currentDeviceRole.role ? currentDeviceRole.uiSettings || {} : {}),
      },
      hardwareConfig: {
        ...defaults.hardwareConfig,
        ...(role === currentDeviceRole.role ? currentDeviceRole.hardwareConfig || {} : {}),
      },
    },
    erpBinding: {
      ...(terminalConfig.erpBinding || {}),
      role,
    },
  };
};

const createTerminalTemplate = (currentConfig: BusinessConfig, terminalId: string, erpTerminalId?: string) => {
  const terminals = Array.isArray(currentConfig?.terminals) ? currentConfig.terminals : [];
  const existing = terminals.find((terminal: any) =>
    asString(terminal?.id) === terminalId
    || (erpTerminalId && asString(terminal?.config?.erpTerminalId) === erpTerminalId)
  );
  const template = existing?.config || terminals[0]?.config;
  if (!template) {
    throw new Error('No hay configuración base de terminal disponible en POS para materializar la terminal del ERP.');
  }

  const nextTemplate = cloneDeep(template);
  const deviceBindingToken = asString(nextTemplate.deviceBindingToken) || `token-${terminalId}`;

  nextTemplate.deviceBindingToken = deviceBindingToken;
  nextTemplate.security = {
    requirePinForVoid: Boolean(nextTemplate.security?.requirePinForVoid),
    requirePinForDiscount: Boolean(nextTemplate.security?.requirePinForDiscount),
    requireManagerForRefunds: Boolean(nextTemplate.security?.requireManagerForRefunds),
    autoLogoutMinutes: Number(nextTemplate.security?.autoLogoutMinutes) || 15,
    ...asObject(nextTemplate.security),
    deviceBindingToken,
  };
  nextTemplate.syncConfig = {
    autoSyncIntervalMs: Number(nextTemplate.syncConfig?.autoSyncIntervalMs) || 30000,
    isEnabled: nextTemplate.syncConfig?.isEnabled ?? true,
    mode: nextTemplate.syncConfig?.mode || 'MASTER',
    ...asObject(nextTemplate.syncConfig),
  };

  return nextTemplate;
};

const buildBoundConfig = (input: {
  currentConfig: BusinessConfig;
  terminals: any[];
  profilesByTerminalId: Map<string, any>;
  selectedTerminalErpId: string;
  selectedTerminalId: string;
  posDeviceId: string;
  bindingMode: BindingMode;
}) => {
  const { currentConfig, terminals, profilesByTerminalId, selectedTerminalErpId, selectedTerminalId, posDeviceId, bindingMode } = input;
  const now = new Date().toISOString();
  const nextTerminals = terminals.map((terminal: any) => {
    const erpTerminalId = asString(terminal.id);
    const terminalId = resolveOperationalTerminalId(terminal) || erpTerminalId;
    const terminalName = resolveTerminalName(terminal, terminalId);
    const existingTerminal = Array.isArray(currentConfig?.terminals)
      ? currentConfig.terminals.find((item: any) => asString(item?.id) === terminalId)
        || currentConfig.terminals.find((item: any) => asString(item?.config?.erpTerminalId) === erpTerminalId)
      : null;

    const baseConfig = applyErpTerminalDeviceRole(
      createTerminalTemplate(currentConfig, terminalId, erpTerminalId),
      terminal
    );
    const occupiedDeviceId = resolveOccupiedDeviceId(terminal, profilesByTerminalId.get(erpTerminalId));
    const nextCurrentDeviceId =
      erpTerminalId === selectedTerminalErpId
        ? posDeviceId
        : occupiedDeviceId === posDeviceId
          ? undefined
          : occupiedDeviceId;

    const nextConfig = {
      ...baseConfig,
      erpTerminalId,
      terminalName,
      stationNumber: terminalId,
      currentDeviceId: nextCurrentDeviceId || undefined,
      lastPairingDate: erpTerminalId === selectedTerminalErpId ? now : existingTerminal?.config?.lastPairingDate,
      isPrimaryNode: erpTerminalId === selectedTerminalErpId ? bindingMode === 'MASTER' : Boolean(baseConfig.isPrimaryNode),
      governedByMaster: erpTerminalId === selectedTerminalErpId ? bindingMode === 'SLAVE' : Boolean(baseConfig.governedByMaster),
      syncConfig: {
        ...asObject(baseConfig.syncConfig),
        mode: erpTerminalId === selectedTerminalErpId ? bindingMode : baseConfig?.syncConfig?.mode || 'MASTER',
        autoSyncIntervalMs: Number(baseConfig?.syncConfig?.autoSyncIntervalMs) || 30000,
        isEnabled: true,
      },
    };

    return {
      id: terminalId,
      config: nextConfig,
    };
  });

  return {
    ...cloneDeep(currentConfig),
    terminals: nextTerminals,
  };
};

export const listTerminalsFromErp = async (input: {
  currentConfig: BusinessConfig;
  posDeviceId: string;
  tenantId?: string | null;
  tenantSlug?: string | null;
  tenantEmail?: string | null;
  erpBaseUrl: string;
}): Promise<RuntimeTerminalListResponse> => {
  const resolvedContext = await resolveErpTerminalContext({
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    tenantEmail: input.tenantEmail,
    deviceId: input.posDeviceId,
    erpBaseUrl: input.erpBaseUrl,
  });

  const rawTerminals = Array.isArray(resolvedContext.terminals) ? resolvedContext.terminals : [];
  const knownIds = new Set(rawTerminals.map((terminal: any) => resolveOperationalTerminalId(terminal) || asString(terminal.id)).filter(Boolean));
  const terminals = rawTerminals.filter((terminal: any) => {
    const terminalId = resolveOperationalTerminalId(terminal) || asString(terminal.id);
    const terminalName = resolveTerminalName(terminal, terminalId);
    const isShadowTerminal =
      terminalName &&
      terminalName !== terminalId &&
      knownIds.has(terminalName);

    return !isShadowTerminal;
  }).map((terminal: any) => {
    const erpTerminalId = asString(terminal.id);
    const terminalId = resolveOperationalTerminalId(terminal) || erpTerminalId;
    const location =
      asString(terminal.store_name) ||
      asString(terminal.company_name) ||
      'ERP';
    const currentDeviceId = asString(terminal.device_id) || undefined;

    return {
      id: terminalId,
      erpTerminalId,
      name: resolveTerminalName(terminal, terminalId),
      location,
      occupied: Boolean(currentDeviceId && currentDeviceId !== input.posDeviceId),
      currentDeviceId: currentDeviceId || undefined,
      config:
        Array.isArray(input.currentConfig?.terminals) && input.currentConfig.terminals.length > 0
          ? applyErpTerminalDeviceRole(createTerminalTemplate(input.currentConfig, terminalId, erpTerminalId), terminal)
          : ({} as TerminalConfig),
    };
  });

  return {
    tenant_id: resolvedContext.tenantId,
    erp_base_url: input.erpBaseUrl,
    terminals,
  };
};

export const bindTerminalFromErp = async (input: {
  currentConfig: BusinessConfig;
  posDeviceId: string;
  terminalId: string;
  erpTerminalId?: string | null;
  bindingMode: BindingMode;
  forceTransfer?: boolean;
  tenantId?: string | null;
  tenantSlug?: string | null;
  tenantEmail?: string | null;
  erpBaseUrl: string;
}): Promise<RuntimeBindTerminalResponse> => {
  const resolvedContext = await resolveErpTerminalContext({
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    tenantEmail: input.tenantEmail,
    deviceId: input.posDeviceId,
    erpBaseUrl: input.erpBaseUrl,
  });

  const erpTerminals = Array.isArray(resolvedContext.terminals) ? resolvedContext.terminals : [];
  const targetTerminal = erpTerminals.find((terminal: any) => {
    const erpTerminalId = asString(terminal.id);
    const operationalId = resolveOperationalTerminalId(terminal) || erpTerminalId;
    return erpTerminalId === asString(input.erpTerminalId) || operationalId === input.terminalId;
  });

  if (!targetTerminal) {
    throw new Error('La terminal no existe en el ERP para este tenant.');
  }

  const targetErpTerminalId = asString(targetTerminal.id);
  const targetTerminalId = resolveOperationalTerminalId(targetTerminal) || targetErpTerminalId;
  const targetTerminalName = resolveTerminalName(targetTerminal, targetTerminalId);

  const currentProfilePayload = await fetchTerminalProfileSafe(
    input.erpBaseUrl,
    resolvedContext.tenantId,
    targetErpTerminalId
  );
  const currentProfile = asObject(currentProfilePayload?.profile);
  const currentMetadata = asObject(currentProfile.metadata);
  const occupiedDeviceId =
    asString(targetTerminal.device_id) || resolveOccupiedDeviceId(targetTerminal, currentProfilePayload);

  if (occupiedDeviceId && occupiedDeviceId !== input.posDeviceId && !input.forceTransfer) {
    throw new TerminalOccupiedError('La terminal ya está ocupada por otro equipo.', occupiedDeviceId);
  }

  const mergedMetadata = {
    ...currentMetadata,
    bound_device_id: input.posDeviceId,
    bound_at: new Date().toISOString(),
    binding_mode: input.bindingMode,
    transferred_from_device_id:
      occupiedDeviceId && occupiedDeviceId !== input.posDeviceId ? occupiedDeviceId : currentMetadata.transferred_from_device_id || null,
    binding_source: 'CLIC_POS_SETUP',
  };

  const persistedProfilePayload = await fetchErpJson(input.erpBaseUrl, '/api/sync/bootstrap/terminal-profile', {
    method: 'POST',
    body: {
      tenant_id: resolvedContext.tenantId,
      company_id: asString(targetTerminal.company_id) || resolvedContext.companyId,
      store_id: asString(targetTerminal.store_id) || resolvedContext.storeId,
        terminal_id: targetErpTerminalId,
        device_id: input.posDeviceId,
      profile_status: currentProfile.profile_status || 'ACTIVE',
      document_types: Array.isArray(currentProfile.document_types) ? currentProfile.document_types : [],
      series_codes: Array.isArray(currentProfile.series_codes) ? currentProfile.series_codes : [],
      warehouse_codes: Array.isArray(currentProfile.warehouse_codes) ? currentProfile.warehouse_codes : [],
      currency_codes: Array.isArray(currentProfile.currency_codes) ? currentProfile.currency_codes : [],
      tax_codes: Array.isArray(currentProfile.tax_codes) ? currentProfile.tax_codes : [],
      customer_codes: Array.isArray(currentProfile.customer_codes) ? currentProfile.customer_codes : [],
      supplier_codes: Array.isArray(currentProfile.supplier_codes) ? currentProfile.supplier_codes : [],
      item_codes: Array.isArray(currentProfile.item_codes) ? currentProfile.item_codes : [],
      payment_method_codes: Array.isArray(currentProfile.payment_method_codes) ? currentProfile.payment_method_codes : [],
      metadata: mergedMetadata,
    },
  });

  const selectedProfilePayload = {
    ...currentProfilePayload,
    profile: persistedProfilePayload?.profile || persistedProfilePayload,
  };

  const profiles = await Promise.all(
    erpTerminals.map(async (terminal: any) => {
      const id = asString(terminal.id);
      if (id === targetErpTerminalId) {
        return [id, selectedProfilePayload] as const;
      }
      const profile = await fetchTerminalProfileSafe(input.erpBaseUrl, resolvedContext.tenantId, id);
      return [id, profile] as const;
    })
  );

  const profilesByTerminalId = new Map<string, any>(profiles);
  const boundConfig = buildBoundConfig({
    currentConfig: input.currentConfig,
    terminals: erpTerminals,
    profilesByTerminalId,
    selectedTerminalErpId: targetErpTerminalId,
    selectedTerminalId: targetTerminalId,
    posDeviceId: input.posDeviceId,
    bindingMode: input.bindingMode,
  });
  const runtimeAuth = extractRuntimeAuthPayload(
    persistedProfilePayload,
    persistedProfilePayload?.profile,
    selectedProfilePayload,
    selectedProfilePayload?.profile,
    currentProfilePayload,
    currentProfilePayload?.profile,
    targetTerminal
  );

  return {
    success: true,
    tenant_id: resolvedContext.tenantId,
    terminal_id: targetTerminalId,
    erp_terminal_id: targetErpTerminalId,
    terminal_name: targetTerminalName,
    company_id: asString(targetTerminal.company_id) || resolvedContext.companyId || null,
    store_id: asString(targetTerminal.store_id) || resolvedContext.storeId || null,
    transferred: Boolean(occupiedDeviceId && occupiedDeviceId !== input.posDeviceId),
    previous_device_id: occupiedDeviceId && occupiedDeviceId !== input.posDeviceId ? occupiedDeviceId : null,
    config: boundConfig,
    deviceToken: runtimeAuth.deviceToken,
    terminalToken: runtimeAuth.terminalToken,
    activationToken: runtimeAuth.activationToken,
    syncToken: runtimeAuth.syncToken,
    tokenExpiresAt: runtimeAuth.tokenExpiresAt,
  };
};

export const fetchInitialConfigFromErp = async (input: {
  erpBaseUrl: string;
  tenantId: string;
  erpTerminalId: string;
  posDeviceId: string;
}): Promise<RuntimeInitialConfigResponse> => {
  const payload = await fetchErpJson(
    input.erpBaseUrl,
    `/api/sync/terminals/${encodeURIComponent(input.erpTerminalId)}/config`
  );

  const terminalConfig = asObject(payload?.terminal_config);
  const runtimeAuth = extractRuntimeAuthPayload(payload, terminalConfig);

  return {
    success: asString(payload?.status).toLowerCase() === 'success',
    tenant_id: asString(terminalConfig.tenant_id) || input.tenantId,
    terminal_id: asString(terminalConfig.terminal_id) || input.erpTerminalId,
    erp_terminal_id: input.erpTerminalId,
    terminal_config: terminalConfig,
    items: Array.isArray(payload?.items)
      ? payload.items
      : (Array.isArray(terminalConfig?.masters?.items) ? terminalConfig.masters.items : []),
    deviceToken: runtimeAuth.deviceToken,
    terminalToken: runtimeAuth.terminalToken,
    activationToken: runtimeAuth.activationToken,
    syncToken: runtimeAuth.syncToken,
    tokenExpiresAt: runtimeAuth.tokenExpiresAt,
  };
};

export const isTerminalOccupiedError = (error: unknown): error is TerminalOccupiedError => {
  return error instanceof TerminalOccupiedError;
};
