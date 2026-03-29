import {
  BusinessConfig,
  DeviceRole,
  DocumentSeries,
  DocumentType,
  FiscalRangeDGII,
  NCFType,
  Tariff,
  TerminalConfig,
  TerminalConfigSnapshot,
  Warehouse,
} from '../types';
import { DEFAULT_DOCUMENT_SERIES, DEFAULT_TERMINAL_CONFIG, INITIAL_TARIFFS } from '../constants';
import {
  canonicalizeDocumentSeries,
  mergeDocumentSeriesCollection,
  resolveDocumentAssignmentId,
  resolveDocumentSeriesDisplayPrefix,
} from './documentSeriesIdentity';

const asObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const asArray = <T = any>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const asNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const asBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
};

const cloneDeep = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const KNOWN_DOCUMENT_TYPES = new Set<DocumentType>([
  'TICKET',
  'REFUND',
  'VOID',
  'TRANSFER',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'PURCHASE',
  'PRODUCTION',
  'CASH_IN',
  'CASH_OUT',
  'CASH_DEPOSIT',
  'CASH_WITHDRAWAL',
  'Z_REPORT',
  'X_REPORT',
  'RECEIVABLE',
  'PAYABLE',
  'PAYMENT_IN',
  'PAYMENT_OUT',
]);

const normalizeDocumentType = (value: unknown, fallback: DocumentType = 'TICKET'): DocumentType => {
  const raw = asString(value).replace(/[\s-]+/g, '_').toUpperCase();
  if (KNOWN_DOCUMENT_TYPES.has(raw as DocumentType)) return raw as DocumentType;
  return fallback;
};

const normalizeNcfType = (value: unknown, fallback: NCFType = 'B02'): NCFType => {
  const raw = asString(value).toUpperCase();
  const allowed: NCFType[] = ['B01', 'B02', 'B04', 'B14', 'B15'];
  return allowed.includes(raw as NCFType) ? (raw as NCFType) : fallback;
};

const normalizeStationNumber = (value: unknown): string | undefined => {
  const raw = asString(value);
  if (raw) return raw;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const normalizeTariff = (raw: unknown, index: number): Tariff | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.tariff_id || data.code || data.uid);
  if (!id) return null;

  return {
    id,
    name: asString(data.name || data.label || id) || id,
    active: asBoolean(data.active, true),
    currency: asString(data.currency || data.currency_code || 'DOP') || 'DOP',
    taxIncluded: asBoolean(data.taxIncluded ?? data.tax_included, true),
    strategy: {
      type: asString(data.strategy?.type || data.strategy_type || 'MANUAL') as Tariff['strategy']['type'],
      rounding: asString(data.strategy?.rounding || data.rounding || 'NONE') as Tariff['strategy']['rounding'],
      factor: typeof data.strategy?.factor === 'number' ? data.strategy.factor : undefined,
      baseTariffId: asString(data.strategy?.baseTariffId || data.strategy?.base_tariff_id || data.base_tariff_id) || undefined,
    },
    scope: {
      storeIds: asArray<string>(data.scope?.storeIds || data.scope?.store_ids || data.store_ids || ['ALL']).filter(Boolean),
      priority: asNumber(data.scope?.priority ?? data.priority, index),
    },
    schedule: {
      daysOfWeek: asArray<number>(data.schedule?.daysOfWeek || data.schedule?.days_of_week || [0, 1, 2, 3, 4, 5, 6]),
      timeStart: asString(data.schedule?.timeStart || data.schedule?.time_start || '00:00') || '00:00',
      timeEnd: asString(data.schedule?.timeEnd || data.schedule?.time_end || '23:59') || '23:59',
    },
    items: asObject(data.items),
  };
};

const normalizeWarehouse = (raw: unknown, index: number): Warehouse | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.warehouse_id || data.code || data.uid);
  if (!id) return null;

  return {
    id,
    code: asString(data.code || id) || id,
    name: asString(data.name || data.label || id) || id,
    type: asString(data.type || 'GENERAL') || 'GENERAL',
    address: asString(data.address),
    allowPosSale: asBoolean(data.allowPosSale ?? data.allow_pos_sale, true),
    allowNegativeStock: asBoolean(data.allowNegativeStock ?? data.allow_negative_stock, false),
    isMain: asBoolean(data.isMain ?? data.is_main, index === 0),
    storeId: asString(data.storeId || data.store_id) || undefined,
  };
};

const normalizeDocumentSeries = (raw: unknown, index: number): DocumentSeries | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.series_id || data.code || data.prefix || `SERIES-${index + 1}`);
  if (!id) return null;

  const displayPrefix = resolveDocumentSeriesDisplayPrefix(data);

  return canonicalizeDocumentSeries({
    id,
    documentType: normalizeDocumentType(data.documentType || data.document_type || data.type, 'TICKET'),
    name: asString(data.name || data.label || id) || id,
    description: asString(data.description || data.notes || ''),
    prefix: displayPrefix,
    nextNumber: asNumber(data.nextNumber ?? data.next_number ?? data.current_number, 1),
    padding: asNumber(data.padding ?? data.number_padding, 6),
    icon: asString(data.icon || 'Receipt') || 'Receipt',
    color: asString(data.color || 'blue') || 'blue',
    businessUnit: asString(data.businessUnit || data.business_unit) || undefined,
  });
};

const normalizeFiscalRange = (raw: unknown, index: number): FiscalRangeDGII | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.range_id || data.uid || `fiscal-range-${index + 1}`);
  if (!id) return null;

  return {
    id,
    type: normalizeNcfType(data.type || data.ncf_type || 'B02'),
    prefix: asString(data.prefix || data.series_prefix || '') || '',
    startNumber: asNumber(data.startNumber ?? data.start_number, 0),
    endNumber: asNumber(data.endNumber ?? data.end_number, 0),
    currentGlobal: asNumber(data.currentGlobal ?? data.current_global ?? data.current_number, 0),
    expiryDate: asString(data.expiryDate || data.expiry_date || '') || '',
    isActive: asBoolean(data.isActive ?? data.is_active, true),
  };
};

const normalizeAssignments = (raw: unknown): Record<string, string> => {
  if (Array.isArray(raw)) {
    return raw.reduce<Record<string, string>>((acc, item) => {
      const data = asObject(item);
      const key = normalizeDocumentType(
        data.documentType || data.document_type || data.key || data.assignment_key || data.role,
        'TICKET'
      );
      const value =
        asString(data.seriesId || data.series_id || data.documentSeriesId || data.document_series_id || data.value || data.id);
      if (key && value) acc[key] = value;
      return acc;
    }, {});
  }

  const data = asObject(raw);
  return Object.entries(data).reduce<Record<string, string>>((acc, [key, value]) => {
    const normalizedKey = normalizeDocumentType(key, 'TICKET');
    const rawValue = asObject(value);
    const normalizedValue =
      asString(rawValue.seriesId || rawValue.series_id || rawValue.documentSeriesId || rawValue.document_series_id || rawValue.id) ||
      asString(value);
    if (normalizedKey && normalizedValue) acc[normalizedKey] = normalizedValue;
    return acc;
  }, {});
};

export const extractTerminalConfigSnapshot = (payload: unknown): TerminalConfigSnapshot | null => {
  const data = asObject(payload);
  const candidates = [
    data.terminal_config,
    asObject(data.data).terminal_config,
    asObject(data.result).terminal_config,
    asObject(data.payload).terminal_config,
    data,
  ];

  for (const candidate of candidates) {
    const snapshot = asObject(candidate);
    if (
      asString(snapshot.terminal_id) ||
      Object.keys(asObject(snapshot.resolved)).length > 0 ||
      Object.keys(asObject(snapshot.config)).length > 0 ||
      snapshot.resolution_error != null
    ) {
      return snapshot as TerminalConfigSnapshot;
    }
  }

  return null;
};

const resolveTerminalTemplate = (config: BusinessConfig, terminalId: string): TerminalConfig => {
  const existing = (config.terminals || []).find((terminal) => terminal.id === terminalId)?.config;
  const first = (config.terminals || [])[0]?.config;
  return cloneDeep(existing || first || DEFAULT_TERMINAL_CONFIG);
};

type SnapshotSource = 'resolved' | 'fallback_config' | 'cached_snapshot' | 'existing_config';

export interface ApplyTerminalConfigSnapshotOptions {
  terminalId: string;
  posDeviceId?: string;
  bindingMode?: 'MASTER' | 'SLAVE';
  incomingSnapshot?: TerminalConfigSnapshot | null;
  cachedSnapshot?: TerminalConfigSnapshot | null;
}

export interface ApplyTerminalConfigSnapshotResult {
  config: BusinessConfig;
  terminalId: string;
  snapshot: TerminalConfigSnapshot | null;
  snapshotSource: SnapshotSource;
  usedResolved: boolean;
  usedFallbackConfig: boolean;
  usedCachedSnapshot: boolean;
  hasResolutionError: boolean;
  fullPullOnPairing?: boolean;
}

export interface TerminalOperationalDocumentState {
  terminalId: string;
  documentSeries: DocumentSeries[];
  fiscalRanges: FiscalRangeDGII[];
}

export const applyTerminalConfigSnapshot = (
  baseConfig: BusinessConfig,
  options: ApplyTerminalConfigSnapshotOptions
): ApplyTerminalConfigSnapshotResult => {
  const { terminalId, posDeviceId, bindingMode, incomingSnapshot, cachedSnapshot } = options;
  const nextConfig = cloneDeep(baseConfig);
  const incoming = incomingSnapshot || null;
  const incomingResolved = asObject(incoming?.resolved);
  const incomingFallbackConfig = asObject(incoming?.config);
  const cached = cachedSnapshot || null;
  const cachedResolved = asObject(cached?.resolved);
  const hasResolutionError = Boolean(incoming?.resolution_error != null);
  const hasIncomingResolved = Object.keys(incomingResolved).length > 0;
  const hasIncomingFallbackConfig = Object.keys(incomingFallbackConfig).length > 0;
  const hasCachedResolved = Object.keys(cachedResolved).length > 0;

  let snapshotSource: SnapshotSource = 'existing_config';
  let effectiveSnapshot: TerminalConfigSnapshot | null = incoming;
  let effectiveResolved = incomingResolved;
  let effectiveFallbackConfig = incomingFallbackConfig;

  if (hasIncomingResolved && !hasResolutionError) {
    snapshotSource = 'resolved';
  } else if (hasIncomingFallbackConfig) {
    snapshotSource = 'fallback_config';
  } else if (hasCachedResolved) {
    snapshotSource = 'cached_snapshot';
    effectiveSnapshot = cached;
    effectiveResolved = cachedResolved;
    effectiveFallbackConfig = asObject(cached?.config);
  }

  const resolvedIdentity = asObject(effectiveSnapshot);
  const resolvedPricing = asObject(effectiveResolved.pricing);
  const resolvedInventory = asObject(effectiveResolved.inventory);
  const resolvedDocuments = asObject(effectiveResolved.documents);
  const resolvedCatalog = asObject(effectiveResolved.catalog);

  const fallbackOperational = asObject(effectiveFallbackConfig.operational);
  const fallbackDeviceRole = asObject(effectiveFallbackConfig.deviceRole);
  const fallbackSecurity = asObject(effectiveFallbackConfig.security);
  const fallbackSession = asObject(effectiveFallbackConfig.session);
  const fallbackOffline = asObject(effectiveFallbackConfig.offline);
  const fallbackLan = asObject(effectiveFallbackConfig.lan);
  const fallbackMetadata = asObject(effectiveFallbackConfig.metadata);

  const tariffs = asArray(resolvedPricing.tariffs)
    .map((item, index) => normalizeTariff(item, index))
    .filter(Boolean) as Tariff[];
  const warehouses = asArray(resolvedInventory.warehouses)
    .map((item, index) => normalizeWarehouse(item, index))
    .filter(Boolean) as Warehouse[];
  const documentSeries = asArray(resolvedDocuments.document_series)
    .map((item, index) => normalizeDocumentSeries(item, index))
    .filter(Boolean) as DocumentSeries[];
  const fiscalRanges = asArray(resolvedDocuments.fiscal_ranges)
    .map((item, index) => normalizeFiscalRange(item, index))
    .filter(Boolean) as FiscalRangeDGII[];
  const documentAssignments = normalizeAssignments(resolvedDocuments.assignments);

  const terminalTemplate = resolveTerminalTemplate(nextConfig, terminalId);
  const terminalTerminalId = asString(resolvedIdentity.terminal_id) || terminalId;
  const allowedTariffIds = asArray<string>(resolvedPricing.allowed_tariff_ids).filter(Boolean);
  const allowedWarehouseIds = asArray<string>(resolvedInventory.allowed_warehouse_ids).filter(Boolean);
  const allowedCategories = asArray<any>(resolvedCatalog.allowed_categories)
    .map((item) => {
      const data = asObject(item);
      return asString(data.id || data.code || item);
    })
    .filter(Boolean);

  const effectiveTariffs = tariffs.length > 0 ? tariffs : nextConfig.tariffs || INITIAL_TARIFFS;
  const effectiveAllowedTariffIds =
    allowedTariffIds.length > 0
      ? allowedTariffIds
      : terminalTemplate.pricing?.allowedTariffIds?.length
        ? terminalTemplate.pricing.allowedTariffIds
        : effectiveTariffs.map((tariff) => tariff.id);
  const effectiveDefaultTariffId =
    asString(resolvedPricing.default_tariff_id) ||
    terminalTemplate.pricing?.defaultTariffId ||
    effectiveAllowedTariffIds[0] ||
    effectiveTariffs[0]?.id ||
    '';

  const effectiveWarehouses = warehouses.length > 0 ? warehouses : terminalTemplate.inventoryScope?.warehouses || [];
  const effectiveAllowedWarehouseIds =
    allowedWarehouseIds.length > 0
      ? allowedWarehouseIds
      : terminalTemplate.inventoryScope?.visibleWarehouseIds?.length
        ? terminalTemplate.inventoryScope.visibleWarehouseIds
        : effectiveWarehouses.map((warehouse) => warehouse.id);
  const effectiveDefaultWarehouseId =
    asString(resolvedInventory.default_warehouse_id) ||
    terminalTemplate.inventoryScope?.defaultSalesWarehouseId ||
    effectiveAllowedWarehouseIds[0] ||
    '';

  const effectiveDocumentSeries = mergeDocumentSeriesCollection(
    documentSeries.length > 0 ? documentSeries : terminalTemplate.documentSeries || DEFAULT_DOCUMENT_SERIES
  );
  const effectiveFiscalRanges = fiscalRanges.length > 0 ? fiscalRanges : terminalTemplate.fiscal.fiscalRanges || [];
  const fallbackAssignments = terminalTemplate.documentAssignments || {};
  const requestedAssignments =
    Object.keys(documentAssignments).length > 0
      ? { ...fallbackAssignments, ...documentAssignments }
      : fallbackAssignments;
  const effectiveDocumentAssignments = Object.keys(requestedAssignments).reduce<Record<string, string>>((acc, key) => {
    const resolvedId = resolveDocumentAssignmentId(
      key,
      effectiveDocumentSeries,
      requestedAssignments[key]
    );
    if (resolvedId) {
      acc[key] = resolvedId;
    }
    return acc;
  }, {});

  const nextTerminalConfig: TerminalConfig = {
    ...terminalTemplate,
    currentDeviceId: posDeviceId || terminalTemplate.currentDeviceId,
    isPrimaryNode: bindingMode ? bindingMode === 'MASTER' : terminalTemplate.isPrimaryNode,
    governedByMaster: bindingMode ? bindingMode === 'SLAVE' : terminalTemplate.governedByMaster,
    terminalName:
      asString(resolvedIdentity.terminal_name) ||
      terminalTemplate.terminalName ||
      terminalTerminalId,
    stationNumber:
      normalizeStationNumber(resolvedIdentity.station_number) ||
      terminalTemplate.stationNumber ||
      null,
    deviceRole: {
      ...(terminalTemplate.deviceRole || {}),
      role:
        (asString(resolvedIdentity.role) as DeviceRole) ||
        (asString(fallbackDeviceRole.role) as DeviceRole) ||
        terminalTemplate.deviceRole?.role ||
        DeviceRole.STANDARD_POS,
      authLevel:
        fallbackDeviceRole.authLevel ||
        terminalTemplate.deviceRole?.authLevel ||
        'USER_REQUIRED',
      uiSettings: {
        ...(terminalTemplate.deviceRole?.uiSettings || {}),
        ...asObject(fallbackDeviceRole.uiSettings),
      },
      hardwareConfig: {
        ...(terminalTemplate.deviceRole?.hardwareConfig || {}),
        ...asObject(fallbackDeviceRole.hardwareConfig),
      },
      allowedModules:
        asArray<string>(fallbackDeviceRole.allowedModules).length > 0
          ? asArray<string>(fallbackDeviceRole.allowedModules)
          : terminalTemplate.deviceRole?.allowedModules || [],
      apiToken:
        asString(fallbackDeviceRole.apiToken) ||
        terminalTemplate.deviceRole?.apiToken,
      defaultRoute:
        asString(fallbackDeviceRole.defaultRoute) ||
        terminalTemplate.deviceRole?.defaultRoute,
    },
    fiscal: {
      ...terminalTemplate.fiscal,
      defaultFiscalRangeId:
        asString(resolvedDocuments.default_fiscal_range_id) ||
        terminalTemplate.fiscal.defaultFiscalRangeId,
      fiscalRanges: effectiveFiscalRanges,
    },
    pricing: {
      ...terminalTemplate.pricing,
      defaultTariffId: effectiveDefaultTariffId,
      allowedTariffIds: effectiveAllowedTariffIds,
      tariffs: effectiveTariffs,
    },
    documentSeries: effectiveDocumentSeries,
    documentAssignments:
      Object.keys(effectiveDocumentAssignments).length > 0
        ? effectiveDocumentAssignments
        : terminalTemplate.documentAssignments,
    inventoryScope: {
      ...terminalTemplate.inventoryScope,
      defaultSalesWarehouseId: effectiveDefaultWarehouseId,
      visibleWarehouseIds: effectiveAllowedWarehouseIds,
      transferWarehouseId:
        asString(resolvedInventory.transfer_warehouse_id) ||
        terminalTemplate.inventoryScope?.transferWarehouseId,
      defaultWarehouse:
        Object.keys(asObject(resolvedInventory.default_warehouse)).length > 0
          ? (normalizeWarehouse(resolvedInventory.default_warehouse, 0) || terminalTemplate.inventoryScope?.defaultWarehouse)
          : terminalTemplate.inventoryScope?.defaultWarehouse,
      warehouses: effectiveWarehouses,
    },
    catalog: {
      ...(terminalTemplate.catalog || { allowedCategories: [] }),
      allowedCategories:
        allowedCategories.length > 0
          ? allowedCategories
          : terminalTemplate.catalog?.allowedCategories || [],
      fullPullOnPairing:
        typeof resolvedCatalog.full_pull_on_pairing === 'boolean'
          ? Boolean(resolvedCatalog.full_pull_on_pairing)
          : terminalTemplate.catalog?.fullPullOnPairing,
    },
    operational: {
      ...terminalTemplate.operational,
      ...fallbackOperational,
    },
    security: {
      ...terminalTemplate.security,
      ...fallbackSecurity,
    },
    workflow: {
      ...terminalTemplate.workflow,
      session: {
        ...terminalTemplate.workflow.session,
        ...fallbackSession,
      },
      offline: {
        ...terminalTemplate.workflow.offline,
        ...fallbackOffline,
      },
    },
    erpBinding: {
      ...(terminalTemplate.erpBinding || {}),
      terminalId: terminalTerminalId,
      tenantId: asString(resolvedIdentity.tenant_id) || terminalTemplate.erpBinding?.tenantId,
      companyId: asString(resolvedIdentity.company_id) || terminalTemplate.erpBinding?.companyId,
      storeId: asString(resolvedIdentity.store_id) || terminalTemplate.erpBinding?.storeId,
      deviceId: asString(resolvedIdentity.device_id) || posDeviceId || terminalTemplate.erpBinding?.deviceId,
      terminalName:
        asString(resolvedIdentity.terminal_name) ||
        terminalTemplate.erpBinding?.terminalName ||
        terminalTerminalId,
      stationNumber:
        normalizeStationNumber(resolvedIdentity.station_number) ||
        terminalTemplate.erpBinding?.stationNumber,
      role:
        asString(resolvedIdentity.role) ||
        terminalTemplate.erpBinding?.role,
    },
    erpSnapshot: effectiveSnapshot || undefined,
    metadata: {
      ...(terminalTemplate.metadata || {}),
      ...fallbackMetadata,
    },
    lan: {
      ...(terminalTemplate.lan || {}),
      ...fallbackLan,
    },
  };

  nextConfig.terminals = (nextConfig.terminals || []).map((terminal) => {
    if (terminal.id !== terminalId) return terminal;
    return {
      ...terminal,
      id: terminalId,
      config: nextTerminalConfig,
    };
  });

  if (!nextConfig.terminals.some((terminal) => terminal.id === terminalId)) {
    nextConfig.terminals = [
      ...(nextConfig.terminals || []),
      {
        id: terminalId,
        config: nextTerminalConfig,
      },
    ];
  }

  nextConfig.tariffs = effectiveTariffs;
  nextConfig.inventoryScope = {
    ...(nextConfig.inventoryScope || {}),
    defaultSalesWarehouseId: effectiveDefaultWarehouseId,
    visibleWarehouseIds: effectiveAllowedWarehouseIds,
  };
  nextConfig.terminalSnapshots = {
    ...(nextConfig.terminalSnapshots || {}),
    ...(effectiveSnapshot ? { [terminalId]: effectiveSnapshot } : {}),
  };

  return {
    config: nextConfig,
    terminalId,
    snapshot: effectiveSnapshot,
    snapshotSource,
    usedResolved: snapshotSource === 'resolved' || snapshotSource === 'cached_snapshot',
    usedFallbackConfig: snapshotSource === 'fallback_config',
    usedCachedSnapshot: snapshotSource === 'cached_snapshot',
    hasResolutionError,
    fullPullOnPairing:
      typeof resolvedCatalog.full_pull_on_pairing === 'boolean'
        ? Boolean(resolvedCatalog.full_pull_on_pairing)
        : nextTerminalConfig.catalog?.fullPullOnPairing,
  };
};

export const extractTerminalOperationalDocumentState = (
  config: BusinessConfig,
  terminalId: string
): TerminalOperationalDocumentState => {
  const terminalTemplate = resolveTerminalTemplate(config, terminalId);

  return {
    terminalId,
    documentSeries: cloneDeep(terminalTemplate.documentSeries || []),
    fiscalRanges: cloneDeep(terminalTemplate.fiscal?.fiscalRanges || []),
  };
};
