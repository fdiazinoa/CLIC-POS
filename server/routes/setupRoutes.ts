import express from 'express';
import { getCollection, getSetting, saveSetting } from '../db';

const router = express.Router();

const REQUEST_TIMEOUT_MS = 12000;

const asObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const cloneDeep = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout | null = null;
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

const stripApiSuffix = (value: string): string => {
  return value
    .replace(/\/api\/sync\/?$/i, '')
    .replace(/\/api\/?$/i, '');
};

const normalizeBaseUrl = (value?: string | null): string | null => {
  const raw = asString(value);
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    return stripTrailingSlashes(stripApiSuffix(url.toString()));
  } catch {
    return null;
  }
};

const resolveStoredErpContext = (): Record<string, any> => {
  return asObject(getSetting('erp_setup_context'));
};

const resolveTenantId = (req: express.Request): string | null => {
  const body = asObject(req.body);
  const queryTenantId = asString(req.query.tenant_id);
  const bodyTenantId = asString(body.tenant_id);
  const headerTenantId = asString(req.headers['x-tenant-id']);
  const storedTenantId =
    asString(resolveStoredErpContext().tenantId) ||
    asString(getSetting('active_tenant_id')) ||
    asString(getSetting('tenant_id'));

  return queryTenantId || bodyTenantId || headerTenantId || storedTenantId || null;
};

const resolveErpBaseUrl = (req: express.Request): string | null => {
  const body = asObject(req.body);
  const queryBase = normalizeBaseUrl(asString(req.query.erp_base_url));
  const bodyBase = normalizeBaseUrl(asString(body.erp_base_url));
  const storedContextBase = normalizeBaseUrl(asString(resolveStoredErpContext().erpBaseUrl));
  const syncMetadata = asObject(getSetting('syncMetadata'));
  const storedMetadataBase =
    normalizeBaseUrl(asString(syncMetadata.erpBaseUrl)) ||
    normalizeBaseUrl(asString(syncMetadata.syncApiUrl)) ||
    normalizeBaseUrl(asString(syncMetadata.masterSyncUrl));

  return queryBase || bodyBase || storedContextBase || storedMetadataBase || null;
};

const buildErpHeaders = (req: express.Request, tenantId: string | null, includeJson = false): HeadersInit => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (includeJson) headers['Content-Type'] = 'application/json';

  const authorization = asString(req.headers.authorization);
  const cookie = asString(req.headers.cookie);

  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;

  return headers;
};

const fetchErpJson = async (
  req: express.Request,
  baseUrl: string,
  path: string,
  options?: {
    method?: 'GET' | 'POST';
    tenantId?: string | null;
    body?: Record<string, any>;
  }
) => {
  const url = `${stripTrailingSlashes(baseUrl)}${path}`;
  const response = await withTimeout(
    fetch(url, {
      method: options?.method || 'GET',
      headers: buildErpHeaders(req, options?.tenantId || null, Boolean(options?.body)),
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

const isDeviceAlreadyLocallyBound = (config: any, deviceId: string): boolean => {
  if (!deviceId) return false;
  return Array.isArray(config?.terminals)
    && config.terminals.some((terminal: any) => asString(terminal?.config?.currentDeviceId) === deviceId);
};

const hasLocalTerminalCatalog = (config: any): boolean =>
  Array.isArray(config?.terminals) && config.terminals.length > 0;

const buildLocalFallback = (config: any, deviceId: string, tenantId: string | null, erpBaseUrl: string | null) => {
  const terminals = Array.isArray(config?.terminals) ? config.terminals : [];
  return {
    tenant_id: tenantId || 'default-tenant',
    erp_base_url: erpBaseUrl,
    source: 'LOCAL_BOUND_FALLBACK',
    terminals: terminals.map((terminal: any) => {
      const terminalConfig = asObject(terminal?.config);
      const currentDeviceId = asString(terminalConfig.currentDeviceId) || undefined;
      return {
        id: asString(terminal?.id),
        name: asString(terminal?.id).toUpperCase(),
        location: 'Configuración local',
        occupied: Boolean(currentDeviceId && currentDeviceId !== deviceId),
        currentDeviceId,
        config: terminalConfig,
      };
    }),
  };
};

const buildLocalBoundConfig = (input: {
  currentConfig: any;
  selectedTerminalId: string;
  posDeviceId: string;
  bindingMode: 'MASTER' | 'SLAVE';
}) => {
  const { currentConfig, selectedTerminalId, posDeviceId, bindingMode } = input;
  const now = new Date().toISOString();

  return {
    ...cloneDeep(currentConfig),
    terminals: (Array.isArray(currentConfig?.terminals) ? currentConfig.terminals : []).map((terminal: any) => {
      const terminalId = asString(terminal?.id);
      const nextConfig = cloneDeep(asObject(terminal?.config));
      const deviceBindingToken = asString(nextConfig.deviceBindingToken) || `token-${terminalId}`;
      const currentDeviceId = asString(nextConfig.currentDeviceId);

      nextConfig.deviceBindingToken = deviceBindingToken;
      nextConfig.security = {
        ...asObject(nextConfig.security),
        deviceBindingToken,
      };
      nextConfig.currentDeviceId =
        terminalId === selectedTerminalId
          ? posDeviceId
          : currentDeviceId === posDeviceId
            ? undefined
            : currentDeviceId || undefined;
      nextConfig.lastPairingDate = terminalId === selectedTerminalId ? now : nextConfig.lastPairingDate;
      nextConfig.isPrimaryNode = terminalId === selectedTerminalId ? bindingMode === 'MASTER' : Boolean(nextConfig.isPrimaryNode);
      nextConfig.governedByMaster = terminalId === selectedTerminalId ? bindingMode === 'SLAVE' : Boolean(nextConfig.governedByMaster);
      nextConfig.syncConfig = {
        ...asObject(nextConfig.syncConfig),
        mode: terminalId === selectedTerminalId ? bindingMode : asString(nextConfig?.syncConfig?.mode) || 'MASTER',
        isEnabled: true,
      };

      return {
        ...cloneDeep(terminal),
        config: nextConfig,
      };
    }),
  };
};

const fetchErpOverview = async (req: express.Request, baseUrl: string, tenantId: string) => {
  const overview = await fetchErpJson(
    req,
    baseUrl,
    `/api/settings/overview?tenant_id=${encodeURIComponent(tenantId)}`,
    { tenantId }
  );

  const branches = Array.isArray(overview?.branches) ? overview.branches : [];
  const terminals = Array.isArray(overview?.terminals) ? overview.terminals : [];

  return {
    tenantId: asString(overview?.tenant?.id) || tenantId,
    tenantName: asString(overview?.tenant?.name),
    branches,
    terminals,
  };
};

const fetchTerminalProfile = async (req: express.Request, baseUrl: string, tenantId: string, terminalId: string) => {
  return fetchErpJson(
    req,
    baseUrl,
    `/api/sync/bootstrap/terminal-profile?tenant_id=${encodeURIComponent(tenantId)}&terminal_id=${encodeURIComponent(terminalId)}`,
    { tenantId }
  );
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

const createTerminalTemplate = (currentConfig: any, terminalId: string) => {
  const terminals = Array.isArray(currentConfig?.terminals) ? currentConfig.terminals : [];
  const existing = terminals.find((terminal: any) => asString(terminal?.id) === terminalId);
  const template = existing?.config || terminals[0]?.config;
  if (!template) {
    throw new Error('No hay configuración base de terminal disponible en POS para materializar la terminal del ERP.');
  }

  const nextTemplate = cloneDeep(template);
  const deviceBindingToken = asString(nextTemplate.deviceBindingToken) || `token-${terminalId}`;

  nextTemplate.deviceBindingToken = deviceBindingToken;
  nextTemplate.security = {
    ...asObject(nextTemplate.security),
    deviceBindingToken,
  };

  return nextTemplate;
};

const buildBoundConfig = (input: {
  currentConfig: any;
  overview: { branches: any[]; terminals: any[] };
  profilesByTerminalId: Map<string, any>;
  selectedTerminalId: string;
  posDeviceId: string;
  bindingMode: 'MASTER' | 'SLAVE';
}) => {
  const { currentConfig, overview, profilesByTerminalId, selectedTerminalId, posDeviceId, bindingMode } = input;
  const now = new Date().toISOString();
  const nextTerminals = overview.terminals.map((terminal: any) => {
    const terminalId = asString(terminal.id);
    const existingTerminal = Array.isArray(currentConfig?.terminals)
      ? currentConfig.terminals.find((item: any) => asString(item?.id) === terminalId)
      : null;

    const baseConfig = createTerminalTemplate(currentConfig, terminalId);
    const occupiedDeviceId = resolveOccupiedDeviceId(terminal, profilesByTerminalId.get(terminalId));
    const nextCurrentDeviceId =
      terminalId === selectedTerminalId
        ? posDeviceId
        : occupiedDeviceId === posDeviceId
          ? undefined
          : occupiedDeviceId;

    const nextConfig = {
      ...baseConfig,
      currentDeviceId: nextCurrentDeviceId || undefined,
      lastPairingDate: terminalId === selectedTerminalId ? now : existingTerminal?.config?.lastPairingDate,
      isPrimaryNode: terminalId === selectedTerminalId ? bindingMode === 'MASTER' : Boolean(baseConfig.isPrimaryNode),
      governedByMaster: terminalId === selectedTerminalId ? bindingMode === 'SLAVE' : Boolean(baseConfig.governedByMaster),
      syncConfig: {
        ...asObject(baseConfig.syncConfig),
        mode: terminalId === selectedTerminalId ? bindingMode : asString(baseConfig?.syncConfig?.mode) || 'MASTER',
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

router.get('/terminals', async (req, res) => {
  const config = getSetting('config');
  const tenantId = resolveTenantId(req);
  const erpBaseUrl = resolveErpBaseUrl(req);
  const posDeviceId = asString(req.query.pos_device_id);

  try {
    if (tenantId && erpBaseUrl) {
      const overview = await fetchErpOverview(req, erpBaseUrl, tenantId);
      const branchMap = new Map<string, any>(
        overview.branches.map((branch: any) => [asString(branch.id), branch])
      );

      const profiles = await Promise.all(
        overview.terminals.map(async (terminal: any) => {
          const terminalId = asString(terminal.id);
          const profile = await fetchTerminalProfile(req, erpBaseUrl, overview.tenantId, terminalId);
          return [terminalId, profile] as const;
        })
      );

      const profilesByTerminalId = new Map<string, any>(profiles);
      const terminals = overview.terminals.map((terminal: any) => {
        const terminalId = asString(terminal.id);
        const branch = branchMap.get(asString(terminal.store_id));
        const location =
          asString(branch?.nombre) ||
          asString(branch?.name) ||
          asString(branch?.address) ||
          'ERP';
        const currentDeviceId = resolveOccupiedDeviceId(terminal, profilesByTerminalId.get(terminalId));

        return {
          id: terminalId,
          name: asString(terminal.name) || `Caja ${asString(terminal.station_number) || terminalId}`,
          location,
          occupied: Boolean(currentDeviceId && currentDeviceId !== posDeviceId),
          currentDeviceId: currentDeviceId || undefined,
          config:
            Array.isArray(config?.terminals) && config.terminals.length > 0
              ? createTerminalTemplate(config, terminalId)
              : {},
        };
      });

      saveSetting('erp_setup_context', {
        tenantId: overview.tenantId,
        tenantName: overview.tenantName,
        erpBaseUrl,
        lastResolvedAt: new Date().toISOString(),
      });

      return res.json({
        tenant_id: overview.tenantId,
        erp_base_url: erpBaseUrl,
        source: 'ERP',
        terminals,
      });
    }

    if (config && (hasLocalTerminalCatalog(config) || isDeviceAlreadyLocallyBound(config, posDeviceId))) {
      return res.json(buildLocalFallback(config, posDeviceId, tenantId, erpBaseUrl));
    }

    return res.status(503).json({
      status: 'error',
      message: 'No se pudo resolver el catálogo de terminales desde ERP. Verifica tenant y base del ERP antes de continuar.',
    });
  } catch (error: any) {
    console.error('❌ Setup terminals error:', error?.message || error);

    if (config && (hasLocalTerminalCatalog(config) || isDeviceAlreadyLocallyBound(config, posDeviceId))) {
      return res.json(buildLocalFallback(config, posDeviceId, tenantId, erpBaseUrl));
    }

    return res.status(500).json({
      status: 'error',
      message: error?.message || 'No se pudieron cargar las terminales del ERP.',
    });
  }
});

router.post('/bind-terminal', async (req, res) => {
  const config = getSetting('config');
  const users = getCollection('users');
  const body = asObject(req.body);
  const tenantId = resolveTenantId(req);
  const erpBaseUrl = resolveErpBaseUrl(req);
  const terminalId = asString(body.terminal_id);
  const posDeviceId = asString(body.pos_device_id);
  const bindingMode = asString(body.binding_mode).toUpperCase() === 'SLAVE' ? 'SLAVE' : 'MASTER';
  const forceTransfer = Boolean(body.force_transfer);

  if ((!tenantId || !erpBaseUrl) && hasLocalTerminalCatalog(config)) {
    const targetTerminal = (config.terminals || []).find((terminal: any) => asString(terminal?.id) === terminalId);

    if (!targetTerminal) {
      return res.status(404).json({
        status: 'error',
        message: 'La terminal no existe en la configuración local de POS.',
      });
    }

    const occupiedDeviceId = asString(targetTerminal?.config?.currentDeviceId);
    if (occupiedDeviceId && occupiedDeviceId !== posDeviceId && !forceTransfer) {
      return res.status(409).json({
        status: 'error',
        code: 'TERMINAL_OCCUPIED',
        message: 'La terminal ya está ocupada por otro equipo.',
        current_device_id: occupiedDeviceId,
      });
    }

    const nextConfig = buildLocalBoundConfig({
      currentConfig: config,
      selectedTerminalId: terminalId,
      posDeviceId,
      bindingMode,
    });

    saveSetting('config', nextConfig);

    return res.json({
      success: true,
      tenant_id: tenantId || 'default-tenant',
      terminal_id: terminalId,
      source: 'LOCAL',
      config: nextConfig,
      users,
    });
  }

  if (!tenantId || !erpBaseUrl) {
    return res.status(400).json({
      status: 'error',
      message: 'tenant_id y erp_base_url son obligatorios para vincular terminales desde ERP.',
    });
  }

  if (!terminalId || !posDeviceId) {
    return res.status(400).json({
      status: 'error',
      message: 'terminal_id y pos_device_id son obligatorios.',
    });
  }

  try {
    const overview = await fetchErpOverview(req, erpBaseUrl, tenantId);
    const targetTerminal = overview.terminals.find((terminal: any) => asString(terminal.id) === terminalId);

    if (!targetTerminal) {
      return res.status(404).json({
        status: 'error',
        message: 'La terminal no existe en el ERP para este tenant.',
      });
    }

    const branch = overview.branches.find((item: any) => asString(item.id) === asString(targetTerminal.store_id));
    const currentProfilePayload = await fetchTerminalProfile(req, erpBaseUrl, overview.tenantId, terminalId);
    const currentProfile = asObject(currentProfilePayload?.profile);
    const currentMetadata = asObject(currentProfile.metadata);
    const occupiedDeviceId = resolveOccupiedDeviceId(targetTerminal, currentProfilePayload);

    if (occupiedDeviceId && occupiedDeviceId !== posDeviceId && !forceTransfer) {
      return res.status(409).json({
        status: 'error',
        code: 'TERMINAL_OCCUPIED',
        message: 'La terminal ya está ocupada por otro equipo.',
        current_device_id: occupiedDeviceId,
      });
    }

    const mergedMetadata = {
      ...currentMetadata,
      bound_device_id: posDeviceId,
      bound_at: new Date().toISOString(),
      binding_mode: bindingMode,
      transferred_from_device_id:
        occupiedDeviceId && occupiedDeviceId !== posDeviceId ? occupiedDeviceId : currentMetadata.transferred_from_device_id || null,
      binding_source: 'CLIC_POS_SETUP',
    };

    const persistedProfilePayload = await fetchErpJson(req, erpBaseUrl, '/api/sync/bootstrap/terminal-profile', {
      method: 'POST',
      tenantId: overview.tenantId,
      body: {
        tenant_id: overview.tenantId,
        company_id: asString(branch?.company_id) || null,
        store_id: asString(targetTerminal.store_id) || null,
        terminal_id: terminalId,
        device_id: posDeviceId,
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
      overview.terminals.map(async (terminal: any) => {
        const id = asString(terminal.id);
        if (id === terminalId) {
          return [id, selectedProfilePayload] as const;
        }
        const profile = await fetchTerminalProfile(req, erpBaseUrl, overview.tenantId, id);
        return [id, profile] as const;
      })
    );

    const profilesByTerminalId = new Map<string, any>(profiles);
    const boundConfig = buildBoundConfig({
      currentConfig: config,
      overview,
      profilesByTerminalId,
      selectedTerminalId: terminalId,
      posDeviceId,
      bindingMode,
    });

    saveSetting('config', boundConfig);
    saveSetting('active_tenant_id', overview.tenantId);
    saveSetting('erp_setup_context', {
      tenantId: overview.tenantId,
      tenantName: overview.tenantName,
      erpBaseUrl,
      lastResolvedAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      source: 'ERP',
      transferred: Boolean(occupiedDeviceId && occupiedDeviceId !== posDeviceId),
      tenant_id: overview.tenantId,
      terminal_id: terminalId,
      current_device_id: posDeviceId,
      previous_device_id: occupiedDeviceId && occupiedDeviceId !== posDeviceId ? occupiedDeviceId : null,
      config: boundConfig,
      users: Array.isArray(users) ? users : [],
    });
  } catch (error: any) {
    console.error('❌ Bind terminal error:', error?.message || error);
    return res.status(500).json({
      status: 'error',
      message: error?.message || 'No se pudo vincular la terminal contra ERP.',
    });
  }
});

export default router;
