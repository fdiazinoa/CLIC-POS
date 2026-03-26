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

  return {
    id,
    documentType: normalizeDocumentType(data.documentType || data.document_type || data.type, 'TICKET'),
    name: asString(data.name || data.label || id) || id,
    description: asString(data.description || data.notes || ''),
    prefix: asString(data.prefix || data.codigo || id) || id,
    nextNumber: asNumber(data.nextNumber ?? data.next_number ?? data.current_number, 1),
    padding: asNumber(data.padding ?? data.number_padding, 6),
    icon: asString(data.icon || 'Receipt') || 'Receipt',
    color: asString(data.color || 'blue') || 'blue',
    businessUnit: asString(data.businessUnit || data.business_unit) || undefined,
  };
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

  const normalizedTerminalId = asString(effectiveSnapshot?.terminal_id) || terminalId;
  const terminalIndex = Math.max(
    nextConfig.terminals.findIndex((terminal) => terminal.id === normalizedTerminalId),
    0
  );
  if (!nextConfig.terminals[terminalIndex]) {
    nextConfig.terminals.push({
      id: normalizedTerminalId,
      config: resolveTerminalTemplate(nextConfig, normalizedTerminalId),
    });
  }

  const terminalConfig = resolveTerminalTemplate(nextConfig, normalizedTerminalId);
  const fallbackOperational = asObject(effectiveFallbackConfig.operational);
  const fallbackSecurity = asObject(effectiveFallbackConfig.security);
  const fallbackSession = asObject(effectiveFallbackConfig.session);
  const fallbackOffline = asObject(effectiveFallbackConfig.offline);
  const fallbackDeviceRole = asObject(effectiveFallbackConfig.deviceRole);
  const fallbackMetadata = asObject(effectiveFallbackConfig.metadata);
  const fallbackLan = asObject(effectiveFallbackConfig.lan);
  const resolvedPricing = asObject(effectiveResolved.pricing);
  const resolvedInventory = asObject(effectiveResolved.inventory);
  const resolvedDocuments = asObject(effectiveResolved.documents);
  const resolvedCatalog = asObject(effectiveResolved.catalog);

  const nextTariffs = (
    asArray(resolvedPricing.tariffs)
      .map((item, index) => normalizeTariff(item, index))
      .filter(Boolean) as Tariff[]
  );
  const allowedTariffIds = (
    asArray<string>(resolvedPricing.allowed_tariff_ids).filter(Boolean).length > 0
      ? asArray<string>(resolvedPricing.allowed_tariff_ids).filter(Boolean)
      : nextTariffs.map((tariff) => tariff.id)
  );
  const defaultTariffId =
    asString(resolvedPricing.default_tariff_id) ||
    allowedTariffIds[0] ||
    terminalConfig.pricing.defaultTariffId ||
    INITIAL_TARIFFS[0]?.id ||
    'trf-gen';

  const resolvedWarehouses = (
    asArray(resolvedInventory.warehouses)
      .map((item, index) => normalizeWarehouse(item, index))
      .filter(Boolean) as Warehouse[]
  );
  const allowedWarehouseIds = (
    asArray<string>(resolvedInventory.allowed_warehouse_ids).filter(Boolean).length > 0
      ? asArray<string>(resolvedInventory.allowed_warehouse_ids).filter(Boolean)
      : resolvedWarehouses.map((warehouse) => warehouse.id)
  );
  const defaultWarehouse = normalizeWarehouse(resolvedInventory.default_warehouse, 0) || undefined;
  const defaultWarehouseId =
    asString(resolvedInventory.default_warehouse_id) ||
    defaultWarehouse?.id ||
    allowedWarehouseIds[0] ||
    terminalConfig.inventoryScope?.defaultSalesWarehouseId ||
    baseConfig.inventoryScope?.defaultSalesWarehouseId ||
    'wh_central';

  const resolvedSeries = (
    asArray(resolvedDocuments.document_series)
      .map((item, index) => normalizeDocumentSeries(item, index))
      .filter(Boolean) as DocumentSeries[]
  );
  const documentAssignments = {
    ...(terminalConfig.documentAssignments || {}),
    ...normalizeAssignments(resolvedDocuments.assignments),
  };
  const fiscalRanges = (
    asArray(resolvedDocuments.fiscal_ranges)
      .map((item, index) => normalizeFiscalRange(item, index))
      .filter(Boolean) as FiscalRangeDGII[]
  );
  const allowedCategories = asArray<any>(resolvedCatalog.allowed_categories)
    .map((item) => (typeof item === 'string' ? item.trim() : asString(asObject(item).id || asObject(item).code || asObject(item).name)))
    .filter(Boolean);
  const fullPullOnPairing =
    typeof resolvedCatalog.full_pull_on_pairing === 'boolean'
      ? resolvedCatalog.full_pull_on_pairing
      : undefined;

  terminalConfig.currentDeviceId = posDeviceId || terminalConfig.currentDeviceId;
  if (bindingMode) {
    terminalConfig.isPrimaryNode = bindingMode === 'MASTER';
    terminalConfig.governedByMaster = bindingMode === 'SLAVE';
    terminalConfig.syncConfig = {
      ...terminalConfig.syncConfig,
      mode: bindingMode,
      isEnabled: true,
    };
  }

  terminalConfig.erpBinding = {
    terminalId: asString(effectiveSnapshot?.terminal_id) || normalizedTerminalId,
    tenantId: asString(effectiveSnapshot?.tenant_id) || terminalConfig.erpBinding?.tenantId,
    companyId: asString(effectiveSnapshot?.company_id) || terminalConfig.erpBinding?.companyId,
    storeId: asString(effectiveSnapshot?.store_id) || terminalConfig.erpBinding?.storeId,
    deviceId: asString(effectiveSnapshot?.device_id) || posDeviceId || terminalConfig.erpBinding?.deviceId,
    terminalName: asString(effectiveSnapshot?.terminal_name) || terminalConfig.erpBinding?.terminalName,
    stationNumber: normalizeStationNumber(effectiveSnapshot?.station_number) || terminalConfig.erpBinding?.stationNumber,
    role: asString(effectiveSnapshot?.role) || terminalConfig.erpBinding?.role,
  };

  terminalConfig.erpSnapshot = effectiveSnapshot || terminalConfig.erpSnapshot;
  terminalConfig.metadata = {
    ...(terminalConfig.metadata || {}),
    ...fallbackMetadata,
  };
  terminalConfig.lan = {
    ...(terminalConfig.lan || {}),
    ...fallbackLan,
  };

  terminalConfig.operational = {
    ...terminalConfig.operational,
    ...fallbackOperational,
  };
  terminalConfig.security = {
    ...terminalConfig.security,
    ...fallbackSecurity,
  };
  terminalConfig.workflow = {
    ...terminalConfig.workflow,
    session: {
      ...terminalConfig.workflow.session,
      ...fallbackSession,
    },
    offline: {
      ...terminalConfig.workflow.offline,
      ...fallbackOffline,
    },
  };

  if (Object.keys(fallbackDeviceRole).length > 0) {
    terminalConfig.deviceRole = {
      ...(terminalConfig.deviceRole || DEFAULT_TERMINAL_CONFIG.deviceRole),
      ...fallbackDeviceRole,
      role: (asString(fallbackDeviceRole.role) as DeviceRole) || terminalConfig.deviceRole?.role || DEFAULT_TERMINAL_CONFIG.deviceRole.role,
      allowedModules: asArray<string>(fallbackDeviceRole.allowedModules).length > 0
        ? asArray<string>(fallbackDeviceRole.allowedModules)
        : terminalConfig.deviceRole?.allowedModules || DEFAULT_TERMINAL_CONFIG.deviceRole.allowedModules,
      uiSettings: {
        ...(terminalConfig.deviceRole?.uiSettings || DEFAULT_TERMINAL_CONFIG.deviceRole.uiSettings),
        ...asObject(fallbackDeviceRole.uiSettings),
      },
      hardwareConfig: {
        ...(terminalConfig.deviceRole?.hardwareConfig || {}),
        ...asObject(fallbackDeviceRole.hardwareConfig),
      },
    };
  }

  if (nextTariffs.length > 0) {
    nextConfig.tariffs = nextTariffs;
  }

  terminalConfig.pricing = {
    ...terminalConfig.pricing,
    allowedTariffIds: allowedTariffIds.length > 0 ? allowedTariffIds : terminalConfig.pricing.allowedTariffIds,
    defaultTariffId,
    tariffs: nextTariffs.length > 0 ? nextTariffs : terminalConfig.pricing.tariffs,
  };

  terminalConfig.inventoryScope = {
    defaultSalesWarehouseId: defaultWarehouseId,
    visibleWarehouseIds: allowedWarehouseIds.length > 0 ? allowedWarehouseIds : terminalConfig.inventoryScope?.visibleWarehouseIds || [defaultWarehouseId],
    transferWarehouseId: asString(resolvedInventory.transfer_warehouse_id) || terminalConfig.inventoryScope?.transferWarehouseId,
    defaultWarehouse,
    warehouses: resolvedWarehouses.length > 0 ? resolvedWarehouses : terminalConfig.inventoryScope?.warehouses,
  };

  terminalConfig.fiscal = {
    ...terminalConfig.fiscal,
    defaultFiscalRangeId: asString(resolvedDocuments.default_fiscal_range_id) || terminalConfig.fiscal.defaultFiscalRangeId,
    fiscalRanges: fiscalRanges.length > 0 ? fiscalRanges : terminalConfig.fiscal.fiscalRanges,
  };

  if (resolvedSeries.length > 0) {
    terminalConfig.documentSeries = resolvedSeries;
  } else if (!Array.isArray(terminalConfig.documentSeries) || terminalConfig.documentSeries.length === 0) {
    terminalConfig.documentSeries = cloneDeep(DEFAULT_DOCUMENT_SERIES);
  }

  if (Object.keys(documentAssignments).length > 0) {
    terminalConfig.documentAssignments = documentAssignments;
  }

  terminalConfig.catalog = {
    allowedCategories: allowedCategories.length > 0 ? allowedCategories : terminalConfig.catalog?.allowedCategories || [],
    fullPullOnPairing: fullPullOnPairing ?? terminalConfig.catalog?.fullPullOnPairing,
  };

  nextConfig.terminals[terminalIndex] = {
    id: normalizedTerminalId,
    config: terminalConfig,
  };
  nextConfig.terminalSnapshots = {
    ...(nextConfig.terminalSnapshots || {}),
    ...(effectiveSnapshot ? { [normalizedTerminalId]: effectiveSnapshot } : {}),
  };

  return {
    config: nextConfig,
    terminalId: normalizedTerminalId,
    snapshot: effectiveSnapshot,
    snapshotSource,
    usedResolved: snapshotSource === 'resolved' || snapshotSource === 'cached_snapshot',
    usedFallbackConfig: snapshotSource === 'fallback_config',
    usedCachedSnapshot: snapshotSource === 'cached_snapshot',
    hasResolutionError,
    fullPullOnPairing,
  };
};
