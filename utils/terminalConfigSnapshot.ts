import {
  BusinessConfig,
  Campaign,
  Coupon,
  CurrencyConfig,
  DeviceRole,
  DocumentSeries,
  DocumentType,
  FiscalDocumentCode,
  FiscalMode,
  FiscalAllocation,
  FiscalRangeDGII,
  LoyaltyConfig,
  NCFType,
  Promotion,
  PromotionTargetType,
  PromotionType,
  ProductGroup,
  Season,
  Tariff,
  TaxDefinition,
  TerminalConfig,
  TerminalConfigSnapshot,
  Warehouse,
} from '../types';
import { DEFAULT_DOCUMENT_SERIES, DEFAULT_TERMINAL_CONFIG, INITIAL_TARIFFS, INITIAL_TAXES } from '../constants';
import {
  DEFAULT_FISCAL_COMPLIANCE_CONFIG,
  normalizeFiscalMode,
} from './fiscal/fiscalHelpers';
import {
  canonicalizeDocumentSeries,
  isFiscalDocumentSeries,
  mergeDocumentSeriesCollection,
  resolveDocumentAssignmentId,
  resolveDocumentSeriesDisplayPrefix,
} from './documentSeriesIdentity';
import { getDefaultRoleConfig, resolveDeviceRoleValue } from './deviceRoleHelpers';
import { resolveTariffId, resolveWarehouseId } from './masterIdentity';

const asObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const asArray = <T = any>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const asCollectionArray = <T = any>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  const data = asObject(value);
  if (Object.keys(data).length === 0) return [];
  const looksLikeSingleRecord = [
    'id',
    'code',
    'prefix',
    'series_id',
    'seriesId',
    'document_series_id',
    'documentSeriesId',
    'sequence_id',
    'sequenceId',
    'document_type',
    'documentType',
    'next_number',
    'nextNumber',
  ].some((key) => Object.prototype.hasOwnProperty.call(data, key));
  if (looksLikeSingleRecord) return [data as T];
  return Object.entries(data)
    .map(([key, entry]) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        return {
          code: key,
          id: asString((entry as Record<string, unknown>).id) || key,
          ...(entry as Record<string, unknown>),
        } as T;
      }
      return {
        id: key,
        code: key,
        prefix: entry,
      } as T;
    });
};
const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const asRefString = (value: unknown): string => (
  typeof value === 'string'
    ? value.trim()
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : ''
);
const asNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const asBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    if (['1', 'yes', 'si', 'sí', 'on'].includes(value.trim().toLowerCase())) return true;
    if (['0', 'no', 'off'].includes(value.trim().toLowerCase())) return false;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  return fallback;
};

const readOptionalBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'si', 'sí', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return undefined;
};

const normalizeBusinessVertical = (value: unknown): 'RESTAURANT' | 'RETAIL' | undefined => {
  const normalized = asString(value).replace(/[\s-]+/g, '_').toUpperCase();
  if (!normalized) return undefined;
  if (normalized === 'RESTAURANT' || normalized === 'RESTAURANTE') return 'RESTAURANT';
  if (normalized === 'RETAIL') return 'RETAIL';
  return undefined;
};

const firstBusinessVertical = (sources: Array<Record<string, any>>): 'RESTAURANT' | 'RETAIL' | undefined => {
  for (const source of sources) {
    const vertical = normalizeBusinessVertical(
      source.vertical_negocio ??
      source.verticalNegocio ??
      source.businessVertical ??
      source.business_vertical ??
      source.vertical ??
      source.type
    );
    if (vertical) return vertical;
  }
  return undefined;
};

const firstTablesFlag = (sources: Array<Record<string, any>>): boolean | undefined => {
  for (const source of sources) {
    const value = readOptionalBoolean(
      source.usa_mesas ??
      source.usaMesas ??
      source.useTables ??
      source.usesTables ??
      source.tablesEnabled ??
      source.tables_enabled
    );
    if (value !== undefined) return value;
  }
  return undefined;
};

const firstStringFromSources = (sources: Array<Record<string, any>>, keys: string[]): string => {
  for (const source of sources) {
    for (const key of keys) {
      const value = asString(source[key]);
      if (value) return value;
    }
  }
  return '';
};

const firstArrayFromBusinessSources = <T = any>(sources: Array<Record<string, any>>, keys: string[]): T[] => {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
};

const normalizeStartScreen = (value: string): 'VENTA_DIRECTA' | 'MAPA_MESAS' | undefined => {
  const normalized = value.trim().replace(/[\s-]+/g, '_').toUpperCase();
  if (!normalized) return undefined;
  if (normalized === 'MAPA_MESAS' || normalized === 'TABLE_MAP' || normalized === 'MESAS') return 'MAPA_MESAS';
  if (normalized === 'VENTA_DIRECTA' || normalized === 'DIRECT_SALE' || normalized === 'POS') return 'VENTA_DIRECTA';
  return undefined;
};

const cloneDeep = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * ERP (Settings → Terminal) guarda jornada/Z en `terminal.config.session`:
 * `requireZClose`, `requireOpenSession`, `allowPartialXReport`, `autoLockMinutes`,
 * `businessStartHour`, `autoPrintZReport`, `emailZReport`, `zReportEmails`.
 * El POS usa `workflow.session` con otros nombres (`forceZChange`, `allowSalesWithOpenZ`, …).
 * Sin este mapeo, el snapshot trae los booleans del ERP pero el POS no los aplica.
 */
const readErpSessionNumber = (erpSession: Record<string, unknown>, camel: string, snake: string): number | undefined => {
  const raw = erpSession[camel] ?? erpSession[snake];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

const mergeWorkflowSessionFromErpConfig = (
  templateSession: TerminalConfig['workflow']['session'],
  erpSession: Record<string, unknown>,
  posShapeSessionPatch: Record<string, unknown>
): TerminalConfig['workflow']['session'] => {
  const merged: TerminalConfig['workflow']['session'] = {
    ...templateSession,
    ...asObject(posShapeSessionPatch),
  };

  if (typeof erpSession.requireZClose === 'boolean') {
    merged.forceZChange = erpSession.requireZClose;
  }
  if (typeof erpSession.requireOpenSession === 'boolean') {
    merged.allowSalesWithOpenZ = !erpSession.requireOpenSession;
  }

  const partialX =
    erpSession.allowPartialXReport ?? erpSession.allow_partial_x_report;
  if (typeof partialX === 'boolean') {
    merged.allowPartialXReport = partialX;
  }

  const bsh = readErpSessionNumber(erpSession, 'businessStartHour', 'business_start_hour');
  if (bsh !== undefined) {
    merged.businessStartHour = Math.max(0, Math.min(23, Math.floor(bsh)));
  }

  const autoPrint = erpSession.autoPrintZReport ?? erpSession.auto_print_z_report;
  if (typeof autoPrint === 'boolean') {
    merged.autoPrintZReport = autoPrint;
  }

  const emailZ = erpSession.emailZReport ?? erpSession.email_z_report;
  if (typeof emailZ === 'boolean') {
    merged.emailZReport = emailZ;
  }

  const zEmails = erpSession.zReportEmails ?? erpSession.z_report_emails;
  if (typeof zEmails === 'string') {
    merged.zReportEmails = zEmails;
  }

  return merged;
};

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

const normalizeOptionalDocumentType = (value: unknown): DocumentType | '' => {
  const raw = asString(value).replace(/[\s-]+/g, '_').toUpperCase();
  if (!raw) return '';
  if (KNOWN_DOCUMENT_TYPES.has(raw as DocumentType)) return raw as DocumentType;

  const aliases: Record<string, DocumentType> = {
    FACTURA_POS: 'TICKET',
    TICKET_FACTURA_POS: 'TICKET',
    TICKET_VENTA: 'TICKET',
    VENTA: 'TICKET',
    NOTA_DE_CREDITO: 'REFUND',
    NOTA_CREDITO: 'REFUND',
    DEVOLUCION: 'REFUND',
    NC: 'REFUND',
    INGRESO: 'CASH_IN',
    ENTRADA_EFECTIVO: 'CASH_IN',
    ENTRADA_DE_EFECTIVO: 'CASH_IN',
    EGRESO: 'CASH_OUT',
    SALIDA_EFECTIVO: 'CASH_OUT',
    SALIDA_DE_EFECTIVO: 'CASH_OUT',
    CIERRE_Z: 'Z_REPORT',
    CIERRE_Z_REPORTE_FISCAL: 'Z_REPORT',
    REPORTE_Z: 'Z_REPORT',
    INVENTARIO: 'ADJUSTMENT_IN',
    INVENTORY: 'ADJUSTMENT_IN',
    CUENTAS: 'RECEIVABLE',
    ACCOUNTS: 'RECEIVABLE',
    RECIBO_DE_COBRO: 'PAYMENT_IN',
    RECIBO_COBRO: 'PAYMENT_IN',
    RECIBO_DE_INGRESO: 'PAYMENT_IN',
    RECIBO_INGRESO: 'PAYMENT_IN',
  };

  return aliases[raw] || '';
};

const inferDocumentTypeFromSeriesData = (data: Record<string, any>): DocumentType => {
  const prefix = asString(
    data.prefix ||
    data.code ||
    data.series_code ||
    data.seriesCode ||
    data.document_series_code ||
    data.documentSeriesCode ||
    data.sequence_code ||
    data.sequenceCode
  ).replace(/[\s-]+/g, '_').toUpperCase();

  if (prefix.startsWith('TCK') || prefix.startsWith('TKT')) return 'TICKET';
  if (prefix.startsWith('NC')) return 'REFUND';
  if (prefix.startsWith('ENTCASH')) return 'CASH_IN';
  if (prefix.startsWith('SALCASH')) return 'CASH_OUT';
  if (prefix.startsWith('RCING') || prefix.startsWith('REC')) return 'PAYMENT_IN';
  if (prefix.startsWith('ZS')) return 'Z_REPORT';
  if (prefix.startsWith('XS')) return 'X_REPORT';
  if (prefix.startsWith('INV')) return 'ADJUSTMENT_IN';
  if (prefix.startsWith('CTAS')) return 'RECEIVABLE';

  return normalizeOptionalDocumentType(data.documentType || data.document_type || data.type || data.document_code || data.documentCode || data.usage || data.document_usage) || 'TICKET';
};

const normalizeNcfType = (value: unknown, fallback: FiscalDocumentCode = 'B02'): FiscalDocumentCode => {
  const raw = asString(value).toUpperCase();
  const allowed: FiscalDocumentCode[] = ['B01', 'B02', 'B04', 'B14', 'B15', 'E31', 'E32', 'E34', 'E44', 'E45'];
  return allowed.includes(raw as FiscalDocumentCode) ? (raw as FiscalDocumentCode) : fallback;
};

const normalizeStationNumber = (value: unknown): string | undefined => {
  const raw = asString(value);
  if (raw) return raw;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const normalizeCurrencyCode = (value: unknown): string => {
  const raw = asString(value).toUpperCase();
  return /^[A-Z]{3}$/.test(raw) ? raw : '';
};

const inferCurrencySymbol = (code: string): string => {
  const symbols: Record<string, string> = {
    DOP: 'RD$',
    USD: '$',
    EUR: '€',
  };
  return symbols[code] || code;
};

const inferCurrencyRateToBase = (code: string, baseCode: string, rawRate: number): number => {
  if (code === baseCode) return 1;
  if (rawRate > 0 && rawRate !== 1) return rawRate;
  return rawRate > 0 ? rawRate : 1;
};

const normalizeCurrencyConfig = (raw: unknown, index = 0, baseCode = ''): CurrencyConfig | null => {
  const data = asObject(raw);
  const directCode = normalizeCurrencyCode(raw);
  const code = directCode || normalizeCurrencyCode(
    data.code ||
    data.currency_code ||
    data.currencyCode ||
    data.value ||
    data.isoCode ||
    data.iso_code ||
    data.id
  );
  if (!code) return null;

  const rawRate = asNumber(data.rate ?? data.exchange_rate ?? data.exchangeRate ?? data.buyRate ?? data.buy_rate, 1);
  const rate = inferCurrencyRateToBase(code, baseCode, rawRate);
  return {
    code,
    name: asString(data.name || data.label || data.description) || code,
    symbol: asString(data.symbol || data.sign) || inferCurrencySymbol(code),
    rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
    buyRate: Number.isFinite(Number(data.buyRate ?? data.buy_rate)) ? Number(data.buyRate ?? data.buy_rate) : undefined,
    sellRate: Number.isFinite(Number(data.sellRate ?? data.sell_rate)) ? Number(data.sellRate ?? data.sell_rate) : undefined,
    useDualRates: asBoolean(data.useDualRates ?? data.use_dual_rates, Boolean(data.buyRate ?? data.buy_rate ?? data.sellRate ?? data.sell_rate)),
    isEnabled: asBoolean(data.isEnabled ?? data.is_enabled ?? data.enabled ?? data.active, true),
    isBase: asBoolean(data.isBase ?? data.is_base ?? data.base ?? data.primary, baseCode ? code === baseCode : index === 0),
  };
};

const readCurrencyCodesFromList = (value: unknown): string[] => (
  asArray(value)
    .map((item) => normalizeCurrencyConfig(item)?.code || normalizeCurrencyCode(item))
    .filter(Boolean)
);

const hasOwn = (record: Record<string, any>, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(record, key)
);

const resolveCurrencyCodeFromRecord = (record: unknown): string => {
  const data = asObject(record);
  return (
    normalizeCurrencyCode(data.currency_code)
    || normalizeCurrencyCode(data.primary_currency_code)
    || normalizeCurrencyCode(data.base_currency_code)
    || normalizeCurrencyCode(data.default_currency_code)
    || normalizeCurrencyCode(data.currencyCode)
    || normalizeCurrencyCode(data.primaryCurrencyCode)
    || normalizeCurrencyCode(data.baseCurrencyCode)
    || normalizeCurrencyCode(data.defaultCurrencyCode)
    || normalizeCurrencyCode(asObject(data.currency).code)
    || normalizeCurrencyCode(asObject(data.currency).currency_code)
    || normalizeCurrencyCode(asObject(data.currency).currencyCode)
    || normalizeCurrencyCode(asObject(data.currencies).default)
    || normalizeCurrencyCode(asObject(data.currencies).base)
    || normalizeCurrencyCode(asObject(data.currencies).primary)
    || readCurrencyCodesFromList(data.currency_codes)[0]
    || readCurrencyCodesFromList(data.currencyCodes)[0]
    || readCurrencyCodesFromList(asObject(data.currencies).list)[0]
    || ''
  );
};

const resolveCurrencyCodeFromSources = (sources: Array<Record<string, any>>): string => {
  for (const source of sources) {
    const code = resolveCurrencyCodeFromRecord(source);
    if (code) return code;
  }
  return '';
};

const resolveBaseCurrencyFromExplicitList = (sources: Array<Record<string, any>>): string => {
  for (const source of sources) {
    for (const item of asArray(asObject(source.currencies).list)) {
      const currency = normalizeCurrencyConfig(item);
      if (currency?.isBase) return currency.code;
    }
  }
  return '';
};

const resolveExplicitCurrenciesListFromSources = (
  sources: Array<Record<string, any>>,
  baseCode: string
): CurrencyConfig[] | null => {
  for (const source of sources) {
    const currencies = asObject(source.currencies);
    if (!hasOwn(currencies, 'list')) continue;

    return asArray(currencies.list)
      .map((item, index) => normalizeCurrencyConfig(item, index, baseCode))
      .filter((currency): currency is CurrencyConfig => Boolean(currency))
      .map((currency) => ({
        ...currency,
        isBase: baseCode ? currency.code === baseCode : currency.isBase,
        isEnabled: baseCode && currency.code === baseCode ? true : currency.isEnabled,
      }));
  }

  return null;
};

const hasRemoteCurrencySignal = (sources: Array<Record<string, any>>): boolean => (
  sources.some((source) => {
    const currencies = asObject(source.currencies);
    return Boolean(
      resolveCurrencyCodeFromRecord(source)
      || hasOwn(currencies, 'list')
      || asArray(source.currencies).length > 0
      || asArray(source.currency_codes).length > 0
      || asArray(source.currencyCodes).length > 0
    );
  })
);

const resolveCurrenciesFromSources = (sources: Array<Record<string, any>>, baseCode: string): CurrencyConfig[] => {
  const byCode = new Map<string, CurrencyConfig>();
  const add = (value: unknown, index = byCode.size) => {
    const currency = normalizeCurrencyConfig(value, index, baseCode);
    if (currency) byCode.set(currency.code, { ...byCode.get(currency.code), ...currency });
  };

  sources.forEach((source) => {
    asArray(source.currencies).forEach(add);
    asArray(asObject(source.currencies).list).forEach(add);
    asArray(source.currency_codes).forEach((code) => add(code));
    asArray(source.currencyCodes).forEach((code) => add(code));
    if (asObject(source.currency).code || asObject(source.currency).currency_code || asObject(source.currency).currencyCode) {
      add(source.currency);
    }
  });

  if (baseCode && !byCode.has(baseCode)) add({ code: baseCode, isBase: true, isEnabled: true });

  return Array.from(byCode.values()).map((currency) => ({
    ...currency,
    isBase: baseCode ? currency.code === baseCode : currency.isBase,
    isEnabled: currency.code === baseCode ? true : currency.isEnabled,
  }));
};

const normalizeTariff = (raw: unknown, index: number): Tariff | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.tariff_id || data.code || data.uid);
  if (!id) return null;

  return {
    id,
    code: asString(data.code || data.tariff_code || data.id || id) || id,
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
    warehouseId: asString(data.warehouseId || data.warehouse_id) || undefined,
    code: asString(data.code || id) || id,
    name: asString(data.name || data.label || id) || id,
    label: asString(data.label || data.name || id) || undefined,
    type: asString(data.type || 'GENERAL') || 'GENERAL',
    address: asString(data.address),
    allowPosSale: asBoolean(data.allowPosSale ?? data.allow_pos_sale, true),
    allowNegativeStock: asBoolean(data.allowNegativeStock ?? data.allow_negative_stock, false),
    isMain: asBoolean(data.isMain ?? data.is_main, index === 0),
    storeId: asString(data.storeId || data.store_id) || undefined,
    inventoryLocalId: asString(data.inventoryLocalId || data.inventory_local_id || data.localWarehouseId || data.local_warehouse_id) || undefined,
    erpWarehouseId:
      asString(
        data.erpWarehouseId
        || data.erp_warehouse_id
        || data.sourceWarehouseId
        || data.source_warehouse_id
        || data.warehouseId
        || data.warehouse_id
        || data.inventoryLocalId
        || data.inventory_local_id
        || data.uid
        || data.uuid
        || id
      ) || id,
    sourceWarehouseId: asString(data.sourceWarehouseId || data.source_warehouse_id || data.erpWarehouseId || data.erp_warehouse_id) || undefined,
    uid: asString(data.uid || data.uuid) || undefined,
  };
};

const normalizeTax = (raw: unknown, index: number): TaxDefinition | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.code || data.tax_id || data.taxCode || `tax-${index + 1}`);
  if (!id) return null;

  const rawType = asString(data.type || data.tax_type || 'OTHER').toUpperCase();
  const type: TaxDefinition['type'] =
    rawType === 'VAT' || rawType === 'SERVICE_CHARGE' || rawType === 'EXEMPT'
      ? rawType
      : 'OTHER';

  return {
    id,
    code: asString(data.code || data.tax_code) || undefined,
    name: asString(data.name || data.label || id) || id,
    rate: asNumber(data.rate),
    type,
  };
};

const normalizeDocumentSeries = (raw: unknown, index: number): DocumentSeries | null => {
  if (typeof raw === 'string' && raw.trim()) {
    const prefix = raw.trim().toUpperCase();
    return canonicalizeDocumentSeries({
      id: prefix,
      documentType: index === 1 ? 'REFUND' : 'TICKET',
      name: `Serie ${prefix}`,
      description: 'Serie documental definida en ERP.',
      prefix,
      nextNumber: 1,
      padding: 6,
      icon: 'Receipt',
      color: 'blue',
    });
  }

  const row = asObject(raw);
  const nestedSeries = asObject(
    row.documentSeries
    || row.document_series
    || row.internalSequence
    || row.internal_sequence
    || row.sequence
    || row.series
  );
  const data = Object.keys(nestedSeries).length > 0
    ? { ...nestedSeries, ...row }
    : row;
  const id = asString(
    data.id
    || data.series_id
    || data.seriesId
    || data.document_series_id
    || data.documentSeriesId
    || data.sequence_id
    || data.sequenceId
    || data.code
    || data.series_code
    || data.seriesCode
    || data.document_series_code
    || data.documentSeriesCode
    || data.sequence_code
    || data.sequenceCode
    || data.prefix
    || `SERIES-${index + 1}`
  );
  if (!id) return null;

  const displayPrefix = resolveDocumentSeriesDisplayPrefix(data);
  const lastNumber = data.last_number ?? data.lastNumber;
  const nextNumber = data.nextNumber ?? data.next_number ?? data.nextValue ?? data.next_value ?? data.nextSequence ?? data.next_sequence ?? data.current_number ?? data.currentNumber;
  const enabled = data.status != null
    ? asString(data.status).toUpperCase() !== 'INACTIVE'
    : asBoolean(data.enabled ?? data.is_active ?? data.active, true);

  return canonicalizeDocumentSeries({
    id,
    code: asString(data.code || data.series_code || data.seriesCode || data.document_series_code || data.documentSeriesCode || data.sequence_code || data.sequenceCode) || id,
    documentType: inferDocumentTypeFromSeriesData(data),
    name: asString(data.name || data.label || id) || id,
    description: asString(data.description || data.notes || ''),
    prefix: displayPrefix,
    nextNumber: nextNumber != null ? asNumber(nextNumber, 1) : asNumber(lastNumber, 0) + 1,
    padding: asNumber(data.padding ?? data.number_padding ?? data.padding_length ?? data.paddingLength, 6),
    enabled,
    source: asString(data.source) || 'ERP_TERMINAL_CONFIG',
    icon: asString(data.icon || 'Receipt') || 'Receipt',
    color: asString(data.color || 'blue') || 'blue',
    businessUnit: asString(data.businessUnit || data.business_unit) || undefined,
  });
};

const normalizeFiscalRange = (raw: unknown, index: number): FiscalRangeDGII | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.range_id || data.uid || `fiscal-range-${index + 1}`);
  if (!id) return null;
  const type = normalizeNcfType(data.type || data.ncfType || data.ncf_type || data.documentType || data.document_type || data.code || data.fiscal_type || data.receipt_type || 'B02');
  const prefix = asString(data.prefix || data.seriesPrefix || data.series_prefix || data.ncfPrefix || data.ncf_prefix || type) || type;
  const isDemoFiscalValue = (value: unknown) => {
    const text = asString(value).toUpperCase();
    return Boolean(text && (text.includes('DEMO') || text.includes('XXXX') || text.startsWith('FR-RECOVERED')));
  };
  const parseFiscalNumber = (...values: unknown[]) => {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
      const text = asString(value).toUpperCase();
      if (!text) continue;
      const numericText = text.startsWith(prefix.toUpperCase())
        ? text.slice(prefix.length)
        : text.replace(/\D/g, '');
      const parsed = Number(numericText);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  };
  const startNumber = parseFiscalNumber(
    data.startNumber, data.start_number, data.rangeStart, data.range_start, data.fromNumber, data.from_number,
    data.numberFrom, data.number_from, data.ncfStart, data.ncf_start, data.initialNumber, data.initial_number,
    data.desde, data.secuencia_desde, data.range_from
  );
  const endNumber = parseFiscalNumber(
    data.endNumber, data.end_number, data.rangeEnd, data.range_end, data.toNumber, data.to_number,
    data.numberTo, data.number_to, data.ncfEnd, data.ncf_end, data.finalNumber, data.final_number,
    data.hasta, data.secuencia_hasta, data.range_to
  );
  if (
    !prefix ||
    isDemoFiscalValue(prefix) ||
    isDemoFiscalValue(id) ||
    isDemoFiscalValue(data.name) ||
    isDemoFiscalValue(data.description) ||
    startNumber <= 0 ||
    endNumber < startNumber
  ) return null;

  return {
    id,
    type,
    prefix,
    startNumber,
    endNumber,
    currentGlobal: Math.max(0, parseFiscalNumber(
      data.currentGlobal, data.current_global, data.currentNumber, data.current_number,
      data.lastNumber, data.last_number, data.lastUsedNumber, data.last_used_number,
      data.usedUntil, data.used_until, data.consumedUntil, data.consumed_until
    )),
    expiryDate: asString(
      data.expiryDate || data.expiry_date || data.expirationDate || data.expiration_date ||
      data.validUntil || data.valid_until || data.validTo || data.valid_to ||
      data.expiresAt || data.expires_at || data.fecha_vencimiento
    ) || '2030-12-31',
    isActive: asBoolean(data.isActive ?? data.is_active, true),
  };
};

const normalizeFiscalAllocation = (raw: unknown, index: number, terminalId: string): FiscalAllocation | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.allocation_id || data.uid || `fiscal-alloc-${index + 1}`);
  if (!id) return null;
  const sourceTerminalId = asString(data.terminalId ?? data.terminal_id);
  const metadata = asObject(data.metadata);

  return {
    id,
    terminalId: terminalId || sourceTerminalId,
    fiscalRangeId: asString(data.fiscalRangeId ?? data.fiscal_range_id),
    ncfType: normalizeNcfType(data.ncfType || data.ncf_type || 'B02'),
    reservedStart: asNumber(data.reservedStart ?? data.reserved_start, 0),
    reservedEnd: asNumber(data.reservedEnd ?? data.reserved_end, 0),
    nextNumber: asNumber(data.nextNumber ?? data.next_number, 0),
    status: (asString(data.status) || 'ACTIVE') as FiscalAllocation['status'],
    releasedAt: asString(data.releasedAt ?? data.released_at) || null,
    metadata: {
      ...metadata,
      sourceTerminalId: sourceTerminalId || metadata.sourceTerminalId || null,
    },
  };
};

const normalizeLoyaltyConfig = (raw: unknown): LoyaltyConfig | null => {
  const data = asObject(raw);
  if (Object.keys(data).length === 0) return null;

  return {
    isEnabled: asBoolean(data.isEnabled ?? data.is_enabled, false),
    earnRate: asNumber(data.earnRate ?? data.earn_rate, 0),
    redeemRate: asNumber(data.redeemRate ?? data.redeem_rate, 1),
    minRedemptionPoints: asNumber(data.minRedemptionPoints ?? data.min_redemption_points, 0),
    expirationMonths: asNumber(data.expirationMonths ?? data.expiration_months, 0),
    excludedCategories: asArray<string>(data.excludedCategories ?? data.excluded_categories)
      .map((entry) => asString(entry))
      .filter(Boolean),
    tiers: asArray(data.tiers).map((tier, index) => {
      const record = asObject(tier);
      return {
        id: asString(record.id) || `tier-${index + 1}`,
        name: asString(record.name) || `Tier ${index + 1}`,
        minPoints: asNumber(record.minPoints ?? record.min_points, 0),
        color: asString(record.color) || 'blue',
        icon: asString(record.icon) || undefined,
      };
    }),
  };
};

const normalizeCampaign = (raw: unknown, index: number): Campaign | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.campaignId || data.campaign_id || `campaign-${index + 1}`);
  if (!id) return null;

  const activeHours = asObject(data.activeHours ?? data.active_hours);

  return {
    id,
    name: asString(data.name || data.label || id) || id,
    description: asString(data.description) || undefined,
    benefitType: (asString(data.benefitType ?? data.benefit_type).toUpperCase() || 'PERCENT') as Campaign['benefitType'],
    benefitValue: asNumber(data.benefitValue ?? data.benefit_value, 0),
    minPurchaseAmount: data.minPurchaseAmount ?? data.min_purchase_amount ?? undefined,
    maxDiscountAmount: data.maxDiscountAmount ?? data.max_discount_amount ?? undefined,
    activeDays: asArray<string>(data.activeDays ?? data.active_days).map((entry) => asString(entry)).filter(Boolean),
    activeHours: Object.keys(activeHours).length > 0
      ? {
          start: asString(activeHours.start),
          end: asString(activeHours.end),
        }
      : undefined,
    startDate: asString(data.startDate ?? data.start_date) || new Date().toISOString(),
    endDate: asString(data.endDate ?? data.end_date) || new Date().toISOString(),
    totalGenerated: asNumber(data.totalGenerated ?? data.total_generated, 0),
    createdAt: asString(data.createdAt ?? data.created_at) || new Date().toISOString(),
  };
};

const normalizeCoupon = (raw: unknown, index: number): Coupon | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.couponId || data.coupon_id || `coupon-${index + 1}`);
  const code = asString(data.code || data.couponCode || data.coupon_code);
  if (!id || !code) return null;

  return {
    id,
    campaignId: asString(data.campaignId ?? data.campaign_id),
    code,
    status: (asString(data.status).toUpperCase() || 'GENERATED') as Coupon['status'],
    assignedTo: asString(data.assignedTo ?? data.assigned_to) || undefined,
    redeemedAt: asString(data.redeemedAt ?? data.redeemed_at) || undefined,
    ticketRef: asString(data.ticketRef ?? data.ticket_ref) || undefined,
    terminalId: asString(data.terminalId ?? data.terminal_id) || undefined,
    createdAt: asString(data.createdAt ?? data.created_at) || new Date().toISOString(),
  };
};

const POS_PROMO_TYPES: PromotionType[] = [
  'DISCOUNT',
  'BOGO',
  'HAPPY_HOUR',
  'CONDITIONAL_TARGET',
  'BUNDLE',
  'TIERED_QUANTITY',
  'MIX_AND_MATCH',
  'GIFT_WITH_PURCHASE',
  'PAYMENT_METHOD_DISCOUNT',
  'PREPAID_PACKAGE',
  'NEXT_PURCHASE_COUPON',
];

const collectPromotionRefs = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPromotionRefs(entry));
  }

  if (value && typeof value === 'object') {
    const obj = asObject(value);
    return [
      obj.id,
      obj.value,
      obj.code,
      obj.sku,
      obj.barcode,
      obj.itemId,
      obj.item_id,
      obj.productId,
      obj.product_id,
      obj.sourceProductId,
      obj.source_product_id,
      obj.erpProductId,
      obj.erp_product_id,
      obj.sourceItemId,
      obj.source_item_id,
      obj.categoryId,
      obj.category_id,
      obj.name,
      obj.label,
    ].flatMap((entry) => collectPromotionRefs(entry));
  }

  const ref = asRefString(value);
  return ref ? [ref] : [];
};

const uniquePromotionRefs = (values: string[]): string[] => {
  const seen = new Set<string>();
  const refs: string[] = [];
  values.forEach((value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    refs.push(value.trim());
  });
  return refs;
};

const normalizePromotionTargetType = (raw: unknown): PromotionTargetType => {
  const t = asString(raw).toUpperCase();
  const allowed: PromotionTargetType[] = ['ALL', 'PRODUCT', 'CATEGORY', 'GROUP', 'SEASON'];
  return (allowed.includes(t as PromotionTargetType) ? t : 'PRODUCT') as PromotionTargetType;
};

/** Payload ya en forma POS (camelCase) desde ERP `resolved.promotions`. */
const normalizePromotionFromErpPayload = (raw: unknown): Promotion | null => {
  const data = asObject(raw);
  const id = asString(data.id);
  if (!id) return null;

  const typeRaw = asString(data.type ?? data.promotionType ?? data.promotion_type).toUpperCase();
  const type = (POS_PROMO_TYPES.includes(typeRaw as PromotionType) ? typeRaw : 'DISCOUNT') as PromotionType;

  const sched = asObject(data.schedule);
  const days = asArray<string>(
    sched.days ??
    sched.weekDays ??
    sched.week_days ??
    data.days ??
    data.weekDays ??
    data.week_days
  ).map((d) => asString(d)).filter(Boolean);
  const defaultDays = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  const triggerRaw = asObject(data.trigger);
  const triggerConfigRaw = asObject(data.trigger_config ?? data.triggerConfig);
  const triggerType = asString(triggerRaw.type);
  const allowedTrigger = new Set(['TOTAL_SPEND', 'ITEM_QTY', 'MIN_TICKET_AMOUNT']);
  const trigger: Promotion['trigger'] | undefined =
    triggerType && allowedTrigger.has(triggerType)
      ? {
          type: triggerType as NonNullable<Promotion['trigger']>['type'],
          value: asNumber(triggerRaw.value, 0),
          excludeCategories: asArray<string>(triggerRaw.excludeCategories).map((c) => asString(c)).filter(Boolean),
          isRecursive: asBoolean(triggerRaw.isRecursive, false),
        }
      : undefined;

  const stratRaw = asObject(data.targetStrategy ?? data.target_strategy);
  const targetStrategy =
    stratRaw && (stratRaw.mode != null || stratRaw.filterValue != null || stratRaw.filter_value != null)
      ? {
          mode: (asString(stratRaw.mode) || 'CHEAPEST_ITEM') as NonNullable<Promotion['targetStrategy']>['mode'],
          filterValue: (stratRaw.filterValue ?? stratRaw.filter_value) as string | number | undefined,
          tieBreaker: (stratRaw.tieBreaker ?? stratRaw.tie_breaker) as NonNullable<Promotion['targetStrategy']>['tieBreaker'],
          allowSelfTrigger: (stratRaw.allowSelfTrigger ?? stratRaw.allow_self_trigger) as boolean | undefined,
      }
      : undefined;

  const targetTypeRaw =
    data.targetType ??
    data.target_type ??
    (data.categoryId != null || data.category_id != null || data.categoryName != null || data.category_name != null || data.categoryIds != null || data.category_ids != null
      ? 'CATEGORY'
      : data.groupId != null || data.group_id != null
        ? 'GROUP'
        : data.seasonId != null || data.season_id != null
          ? 'SEASON'
          : undefined);
  const targetValueRaw =
    data.targetValue ??
    data.target_value ??
    data.targetId ??
    data.target_id ??
    data.categoryId ??
    data.category_id ??
    data.categoryName ??
    data.category_name ??
    data.groupId ??
    data.group_id ??
    data.seasonId ??
    data.season_id;
  const targetRefs = [
    data.targetRefs ?? data.target_refs,
    data.productIds ?? data.product_ids,
    data.itemIds ?? data.item_ids,
    data.categoryIds ?? data.category_ids,
    data.categoryNames ?? data.category_names,
    data.targetIds ?? data.target_ids,
    data.targetValues ?? data.target_values,
    data.targets,
  ].flatMap((entry) => collectPromotionRefs(entry));

  return {
    id,
    name: asString(data.name) || id,
    type,
    priority: asNumber(data.priority, 1),
    trigger_config: triggerConfigRaw,
    triggerConfig: triggerConfigRaw,
    trigger,
    targetType: normalizePromotionTargetType(targetTypeRaw),
    targetValue: targetValueRaw != null ? asRefString(targetValueRaw) : undefined,
    targetLabel: asString(data.targetLabel || data.target_label) || undefined,
    targetRefs: uniquePromotionRefs(targetRefs),
    targetStrategy,
    benefitType: (asString(data.benefitType ?? data.benefit_type) || undefined) as Promotion['benefitType'],
    benefitValue: asNumber(
      data.benefitValue ??
      data.benefit_value ??
      data.discountPercent ??
      data.discount_percent ??
      data.discountValue ??
      data.discount_value ??
      data.value,
      0
    ),
    schedule: {
      days: days.length > 0 ? days : defaultDays,
      startTime: asString(sched.startTime ?? sched.start_time ?? data.startTime ?? data.start_time) || '00:00',
      endTime: asString(sched.endTime ?? sched.end_time ?? data.endTime ?? data.end_time) || '23:59',
      startDate: sched.startDate || sched.start_date || data.startDate || data.start_date ? asString(sched.startDate ?? sched.start_date ?? data.startDate ?? data.start_date) : undefined,
      endDate: sched.endDate || sched.end_date || data.endDate || data.end_date ? asString(sched.endDate ?? sched.end_date ?? data.endDate ?? data.end_date) : undefined,
      isActive: asBoolean(sched.isActive ?? sched.is_active ?? data.isActive ?? data.is_active ?? data.active ?? data.enabled, true),
    },
    terminalIds: uniquePromotionRefs(collectPromotionRefs(data.terminalIds ?? data.terminal_ids)),
  };
};

const normalizeProductGroupFromErpPayload = (raw: unknown, index: number): ProductGroup | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.groupId || data.group_id || `group-${index + 1}`);
  if (!id) return null;

  const productIds = uniquePromotionRefs(asArray<any>(data.productIds ?? data.product_ids ?? data.items ?? data.products)
    .flatMap((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const obj = asObject(entry);
        return collectPromotionRefs([
          obj.id,
          obj.productId,
          obj.product_id,
          obj.itemId,
          obj.item_id,
          obj.sourceProductId,
          obj.source_product_id,
          obj.erpProductId,
          obj.erp_product_id,
          obj.sourceItemId,
          obj.source_item_id,
          obj.sku,
          obj.code,
          obj.item_code,
          obj.barcode,
        ]);
      }
      return collectPromotionRefs(entry);
    })
    .filter(Boolean));

  return {
    id,
    name: asString(data.name) || id,
    code: asString(data.code) || id,
    color: asString(data.color) || undefined,
    description: asString(data.description) || undefined,
    productIds,
  };
};

const normalizeSeasonFromErpPayload = (raw: unknown, index: number): Season | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.seasonId || data.season_id || `season-${index + 1}`);
  if (!id) return null;

  const productIds = uniquePromotionRefs(asArray<any>(data.productIds ?? data.product_ids ?? data.items ?? data.products)
    .flatMap((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const obj = asObject(entry);
        return collectPromotionRefs([
          obj.id,
          obj.productId,
          obj.product_id,
          obj.itemId,
          obj.item_id,
          obj.sourceProductId,
          obj.source_product_id,
          obj.erpProductId,
          obj.erp_product_id,
          obj.sourceItemId,
          obj.source_item_id,
          obj.sku,
          obj.code,
          obj.item_code,
          obj.barcode,
        ]);
      }
      return collectPromotionRefs(entry);
    })
    .filter(Boolean));

  const affectedCategories = asArray<any>(data.affectedCategories ?? data.affected_categories ?? data.categories)
    .map((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const obj = asObject(entry);
        return asString(obj.id || obj.code || obj.name);
      }
      return asString(entry);
    })
    .filter(Boolean);

  return {
    id,
    name: asString(data.name) || id,
    code: asString(data.code) || id,
    startDate: asString(data.startDate ?? data.start_date) || new Date().toISOString().split('T')[0],
    endDate: asString(data.endDate ?? data.end_date) || new Date().toISOString().split('T')[0],
    isActive: asBoolean(data.isActive ?? data.is_active, true),
    productIds,
    multiplier: asNumber(data.multiplier, 1),
    affectedCategories,
  };
};

const normalizeAssignments = (raw: unknown): Record<string, string> => {
  if (Array.isArray(raw)) {
    return raw.reduce<Record<string, string>>((acc, item) => {
      const data = asObject(item);
      const key = normalizeOptionalDocumentType(
        data.documentType || data.document_type || data.key || data.assignment_key || data.role
      );
      const value =
        asString(data.seriesId || data.series_id || data.documentSeriesId || data.document_series_id || data.value || data.id);
      if (key && value) acc[key] = value;
      return acc;
    }, {});
  }

  const data = asObject(raw);
  return Object.entries(data).reduce<Record<string, string>>((acc, [key, value]) => {
    const normalizedKey = normalizeOptionalDocumentType(key);
    const rawValue = asObject(value);
    const normalizedValue =
      asString(rawValue.seriesId || rawValue.series_id || rawValue.documentSeriesId || rawValue.document_series_id || rawValue.id) ||
      asString(value);
    if (normalizedKey && normalizedValue) acc[normalizedKey] = normalizedValue;
    return acc;
  }, {});
};

const collectAssignmentValues = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        const data = asObject(item);
        return asString(data.seriesId || data.series_id || data.documentSeriesId || data.document_series_id || data.value || data.id);
      })
      .filter(Boolean);
  }

  return Object.values(asObject(raw))
    .map((value) => {
      const data = asObject(value);
      return (
        asString(data.seriesId || data.series_id || data.documentSeriesId || data.document_series_id || data.id) ||
        asString(value)
      );
    })
    .filter(Boolean);
};

const firstResolvedArray = (container: Record<string, any>, keys: string[]): any[] => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(container, key)) {
      return asCollectionArray(container[key]);
    }
  }
  return [];
};

const firstArrayFromSources = (sources: Array<Record<string, any>>, keys: string[]): any[] => {
  for (const source of sources) {
    const found = firstResolvedArray(source, keys);
    if (found.length > 0) return found;
  }
  return [];
};

const normalizeFiscalText = (value: unknown): string => {
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return asString(value).toUpperCase().replace(/[\s-]+/g, '_');
};

const isNoFiscalMarker = (value: unknown): boolean => {
  const normalized = normalizeFiscalText(value);
  return [
    'NONE',
    'NO_FISCAL',
    'NON_FISCAL',
    'SIN_COMPROBANTES',
    'SIN_COMPROBANTE',
    'NO_COMPROBANTES',
    'NO_COMPROBANTE',
    'SIN_NCF',
    'NO_NCF',
    'SIN_COMPROBANTE_FISCAL',
    'SIN_COMPROBANTES_FISCALES',
    'NO_COMPROBANTE_FISCAL',
    'NO_COMPROBANTES_FISCALES',
    'COMPROBANTE_NO_FISCAL',
    'COMPROBANTES_NO_FISCALES',
    'NO_TAX_RECEIPTS',
    'NON_FISCAL_RECEIPT',
    'NON_FISCAL_RECEIPTS',
    'DISABLED',
    'OFF',
    'NO',
    'FALSE',
  ].includes(normalized);
};

const isNoFiscalDisabledFlag = (value: unknown): boolean => (
  value !== undefined && value !== null && value !== '' && isNoFiscalMarker(value)
);

const resolveFiscalModeFromSnapshot = (
  resolvedDocuments: Record<string, any>,
  fallbackConfig: Record<string, any>,
  rawFiscalRangeRows: any[],
  extraSources: Array<Record<string, any>> = []
): FiscalMode | null => {
  const fallbackFiscal = asObject(fallbackConfig.fiscal);
  const fallbackFiscalCompliance = asObject(fallbackConfig.fiscalCompliance || fallbackConfig.fiscal_compliance);
  const fallbackDocuments = asObject(fallbackConfig.documents);
  const extraCandidates = extraSources.flatMap((source) => {
    const fiscal = asObject(source.fiscal);
    const fiscalCompliance = asObject(source.fiscalCompliance || source.fiscal_compliance);
    const documents = asObject(source.documents);
    const config = asObject(source.config);
    const configFiscal = asObject(config.fiscal);
    const configFiscalCompliance = asObject(config.fiscalCompliance || config.fiscal_compliance);
    const metadata = asObject(source.metadata);
    return [
      source.fiscalMode,
      source.fiscal_mode,
      source.fiscalComplianceMode,
      source.fiscal_compliance_mode,
      source.complianceMode,
      source.compliance_mode,
      source.receiptMode,
      source.receipt_mode,
      source.mode,
      source.requiresFiscalInvoice === false ? 'NONE' : undefined,
      source.requires_fiscal_invoice === false ? 'NONE' : undefined,
      source.requiresFiscalReceipt === false ? 'NONE' : undefined,
      source.requires_fiscal_receipt === false ? 'NONE' : undefined,
      source.usesFiscalReceipts === false ? 'NONE' : undefined,
      source.uses_fiscal_receipts === false ? 'NONE' : undefined,
      source.usesFiscalDocuments === false ? 'NONE' : undefined,
      source.uses_fiscal_documents === false ? 'NONE' : undefined,
      source.usesReceipts === false ? 'NONE' : undefined,
      source.uses_receipts === false ? 'NONE' : undefined,
      source.fiscalReceiptsEnabled === false ? 'NONE' : undefined,
      source.fiscal_receipts_enabled === false ? 'NONE' : undefined,
      source.comprobantesEnabled === false ? 'NONE' : undefined,
      source.comprobantes_enabled === false ? 'NONE' : undefined,
      source.usaComprobantes === false ? 'NONE' : undefined,
      source.usa_comprobantes === false ? 'NONE' : undefined,
      source.utilizaComprobantes === false ? 'NONE' : undefined,
      source.utiliza_comprobantes === false ? 'NONE' : undefined,
      source.usaNcf === false ? 'NONE' : undefined,
      source.usa_ncf === false ? 'NONE' : undefined,
      source.fiscalEnabled === false ? 'NONE' : undefined,
      source.fiscal_enabled === false ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.usesFiscalReceipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.uses_fiscal_receipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.usesFiscalDocuments) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.uses_fiscal_documents) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.usesReceipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.uses_receipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.comprobantesEnabled) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.comprobantes_enabled) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.usaComprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.usa_comprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.utilizaComprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.utiliza_comprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.usaNcf) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(source.usa_ncf) ? 'NONE' : undefined,
      fiscal.mode,
      fiscal.fiscalMode,
      fiscal.fiscal_mode,
      fiscal.enabled === false ? 'NONE' : fiscal.enabled,
      fiscal.noFiscal === true ? 'NONE' : fiscal.noFiscal,
      fiscal.no_fiscal === true ? 'NONE' : fiscal.no_fiscal,
      fiscal.requiresFiscalInvoice === false ? 'NONE' : undefined,
      fiscal.requires_fiscal_invoice === false ? 'NONE' : undefined,
      fiscal.requiresFiscalReceipt === false ? 'NONE' : undefined,
      fiscal.requires_fiscal_receipt === false ? 'NONE' : undefined,
      fiscal.usesFiscalReceipts === false ? 'NONE' : undefined,
      fiscal.uses_fiscal_receipts === false ? 'NONE' : undefined,
      fiscal.usesFiscalDocuments === false ? 'NONE' : undefined,
      fiscal.uses_fiscal_documents === false ? 'NONE' : undefined,
      fiscal.usesReceipts === false ? 'NONE' : undefined,
      fiscal.uses_receipts === false ? 'NONE' : undefined,
      fiscal.fiscalReceiptsEnabled === false ? 'NONE' : undefined,
      fiscal.fiscal_receipts_enabled === false ? 'NONE' : undefined,
      fiscal.comprobantesEnabled === false ? 'NONE' : undefined,
      fiscal.comprobantes_enabled === false ? 'NONE' : undefined,
      fiscal.usaComprobantes === false ? 'NONE' : undefined,
      fiscal.usa_comprobantes === false ? 'NONE' : undefined,
      fiscal.utilizaComprobantes === false ? 'NONE' : undefined,
      fiscal.utiliza_comprobantes === false ? 'NONE' : undefined,
      fiscal.usaNcf === false ? 'NONE' : undefined,
      fiscal.usa_ncf === false ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.usesFiscalReceipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.uses_fiscal_receipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.usesFiscalDocuments) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.uses_fiscal_documents) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.usesReceipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.uses_receipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.comprobantesEnabled) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.comprobantes_enabled) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.usaComprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.usa_comprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.utilizaComprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.utiliza_comprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.usaNcf) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(fiscal.usa_ncf) ? 'NONE' : undefined,
      fiscalCompliance.mode,
      fiscalCompliance.fiscalMode,
      fiscalCompliance.fiscal_mode,
      fiscalCompliance.enabled === false ? 'NONE' : fiscalCompliance.enabled,
      fiscalCompliance.allowLegacyFallback === false && isNoFiscalMarker(fiscalCompliance.mode) ? 'NONE' : undefined,
      fiscalCompliance.allow_legacy_fallback === false && isNoFiscalMarker(fiscalCompliance.mode) ? 'NONE' : undefined,
      documents.fiscalMode,
      documents.fiscal_mode,
      documents.receiptMode,
      documents.receipt_mode,
      documents.requiresFiscalInvoice === false ? 'NONE' : undefined,
      documents.requires_fiscal_invoice === false ? 'NONE' : undefined,
      documents.requiresFiscalReceipt === false ? 'NONE' : undefined,
      documents.requires_fiscal_receipt === false ? 'NONE' : undefined,
      documents.usesFiscalReceipts === false ? 'NONE' : undefined,
      documents.uses_fiscal_receipts === false ? 'NONE' : undefined,
      documents.usesFiscalDocuments === false ? 'NONE' : undefined,
      documents.uses_fiscal_documents === false ? 'NONE' : undefined,
      documents.usesReceipts === false ? 'NONE' : undefined,
      documents.uses_receipts === false ? 'NONE' : undefined,
      documents.fiscalReceiptsEnabled === false ? 'NONE' : undefined,
      documents.fiscal_receipts_enabled === false ? 'NONE' : undefined,
      documents.comprobantesEnabled === false ? 'NONE' : undefined,
      documents.comprobantes_enabled === false ? 'NONE' : undefined,
      documents.usaComprobantes === false ? 'NONE' : undefined,
      documents.usa_comprobantes === false ? 'NONE' : undefined,
      documents.utilizaComprobantes === false ? 'NONE' : undefined,
      documents.utiliza_comprobantes === false ? 'NONE' : undefined,
      documents.usaNcf === false ? 'NONE' : undefined,
      documents.usa_ncf === false ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.usesFiscalReceipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.uses_fiscal_receipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.usesFiscalDocuments) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.uses_fiscal_documents) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.usesReceipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.uses_receipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.comprobantesEnabled) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.comprobantes_enabled) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.usaComprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.usa_comprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.utilizaComprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.utiliza_comprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.usaNcf) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(documents.usa_ncf) ? 'NONE' : undefined,
      config.fiscalMode,
      config.fiscal_mode,
      config.receiptMode,
      config.receipt_mode,
      config.requiresFiscalInvoice === false ? 'NONE' : undefined,
      config.requires_fiscal_invoice === false ? 'NONE' : undefined,
      config.requiresFiscalReceipt === false ? 'NONE' : undefined,
      config.requires_fiscal_receipt === false ? 'NONE' : undefined,
      config.usesFiscalReceipts === false ? 'NONE' : undefined,
      config.uses_fiscal_receipts === false ? 'NONE' : undefined,
      config.usesFiscalDocuments === false ? 'NONE' : undefined,
      config.uses_fiscal_documents === false ? 'NONE' : undefined,
      config.usesReceipts === false ? 'NONE' : undefined,
      config.uses_receipts === false ? 'NONE' : undefined,
      config.fiscalReceiptsEnabled === false ? 'NONE' : undefined,
      config.fiscal_receipts_enabled === false ? 'NONE' : undefined,
      config.comprobantesEnabled === false ? 'NONE' : undefined,
      config.comprobantes_enabled === false ? 'NONE' : undefined,
      config.usaComprobantes === false ? 'NONE' : undefined,
      config.usa_comprobantes === false ? 'NONE' : undefined,
      config.utilizaComprobantes === false ? 'NONE' : undefined,
      config.utiliza_comprobantes === false ? 'NONE' : undefined,
      config.usaNcf === false ? 'NONE' : undefined,
      config.usa_ncf === false ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.usesFiscalReceipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.uses_fiscal_receipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.usesFiscalDocuments) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.uses_fiscal_documents) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.usesReceipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.uses_receipts) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.comprobantesEnabled) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.comprobantes_enabled) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.usaComprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.usa_comprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.utilizaComprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.utiliza_comprobantes) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.usaNcf) ? 'NONE' : undefined,
      isNoFiscalDisabledFlag(config.usa_ncf) ? 'NONE' : undefined,
      configFiscal.mode,
      configFiscal.fiscalMode,
      configFiscal.fiscal_mode,
      configFiscal.enabled === false ? 'NONE' : configFiscal.enabled,
      configFiscal.noFiscal === true ? 'NONE' : configFiscal.noFiscal,
      configFiscal.no_fiscal === true ? 'NONE' : configFiscal.no_fiscal,
      configFiscal.requiresFiscalInvoice === false ? 'NONE' : undefined,
      configFiscal.requires_fiscal_invoice === false ? 'NONE' : undefined,
      configFiscal.requiresFiscalReceipt === false ? 'NONE' : undefined,
      configFiscal.requires_fiscal_receipt === false ? 'NONE' : undefined,
      configFiscal.usesFiscalReceipts === false ? 'NONE' : undefined,
      configFiscal.uses_fiscal_receipts === false ? 'NONE' : undefined,
      configFiscal.fiscalReceiptsEnabled === false ? 'NONE' : undefined,
      configFiscal.fiscal_receipts_enabled === false ? 'NONE' : undefined,
      configFiscal.comprobantesEnabled === false ? 'NONE' : undefined,
      configFiscal.comprobantes_enabled === false ? 'NONE' : undefined,
      configFiscal.usaComprobantes === false ? 'NONE' : undefined,
      configFiscal.usa_comprobantes === false ? 'NONE' : undefined,
      configFiscalCompliance.mode,
      configFiscalCompliance.fiscalMode,
      configFiscalCompliance.fiscal_mode,
      configFiscalCompliance.enabled === false ? 'NONE' : configFiscalCompliance.enabled,
      metadata.fiscalMode,
      metadata.fiscal_mode,
      metadata.receiptMode,
      metadata.receipt_mode,
      metadata.noFiscal === true ? 'NONE' : metadata.noFiscal,
      metadata.no_fiscal === true ? 'NONE' : metadata.no_fiscal,
      metadata.requiresFiscalInvoice === false ? 'NONE' : undefined,
      metadata.requires_fiscal_invoice === false ? 'NONE' : undefined,
      metadata.requiresFiscalReceipt === false ? 'NONE' : undefined,
      metadata.requires_fiscal_receipt === false ? 'NONE' : undefined,
      metadata.usesFiscalReceipts === false ? 'NONE' : undefined,
      metadata.uses_fiscal_receipts === false ? 'NONE' : undefined,
      metadata.fiscalReceiptsEnabled === false ? 'NONE' : undefined,
      metadata.fiscal_receipts_enabled === false ? 'NONE' : undefined,
      metadata.comprobantesEnabled === false ? 'NONE' : undefined,
      metadata.comprobantes_enabled === false ? 'NONE' : undefined,
      metadata.usaComprobantes === false ? 'NONE' : undefined,
      metadata.usa_comprobantes === false ? 'NONE' : undefined,
    ];
  });
  const candidates = [
    ...extraCandidates,
    resolvedDocuments.fiscalMode,
    resolvedDocuments.fiscal_mode,
    resolvedDocuments.fiscalComplianceMode,
    resolvedDocuments.fiscal_compliance_mode,
    resolvedDocuments.complianceMode,
    resolvedDocuments.compliance_mode,
    resolvedDocuments.receiptMode,
    resolvedDocuments.receipt_mode,
    resolvedDocuments.mode,
    fallbackFiscalCompliance.mode,
    fallbackFiscalCompliance.fiscalMode,
    fallbackFiscalCompliance.fiscal_mode,
    fallbackFiscal.mode,
    fallbackFiscal.fiscalMode,
    fallbackFiscal.fiscal_mode,
    fallbackFiscal.enabled,
    fallbackDocuments.fiscalMode,
    fallbackDocuments.fiscal_mode,
    fallbackDocuments.mode,
    fallbackConfig.fiscalMode,
    fallbackConfig.fiscal_mode,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    if (isNoFiscalMarker(candidate)) return 'NONE';
    const normalized = normalizeFiscalMode(candidate);
    if (normalized !== DEFAULT_FISCAL_COMPLIANCE_CONFIG.mode || normalizeFiscalText(candidate) === DEFAULT_FISCAL_COMPLIANCE_CONFIG.mode) {
      return normalized;
    }
  }

  const hasNoFiscalLot = rawFiscalRangeRows.some((row) => {
    const data = asObject(row);
    return [
      data.type,
      data.ncfType,
      data.ncf_type,
      data.documentType,
      data.document_type,
      data.code,
      data.prefix,
      data.name,
      data.label,
      data.mode,
      data.fiscalMode,
      data.fiscal_mode,
      data.receipt_type,
    ].some(isNoFiscalMarker);
  });

  return hasNoFiscalLot ? 'NONE' : null;
};

export const extractTerminalConfigSnapshot = (payload: unknown): TerminalConfigSnapshot | null => {
  const data = asObject(payload);
  const candidates = [
    data.terminal_config,
    data.terminalConfig,
    asObject(data.data).terminal_config,
    asObject(data.data).terminalConfig,
    asObject(data.result).terminal_config,
    asObject(data.result).terminalConfig,
    asObject(data.payload).terminal_config,
    asObject(data.payload).terminalConfig,
    data,
  ];

  for (const candidate of candidates) {
    const snapshot = asObject(candidate);
    if (
      asString(snapshot.terminal_id) ||
      Object.keys(asObject(snapshot.masters)).length > 0 ||
      Object.keys(asObject(snapshot.resolved)).length > 0 ||
      Object.keys(asObject(snapshot.config)).length > 0 ||
      Object.keys(asObject(snapshot.business_config || snapshot.businessConfig)).length > 0 ||
      Object.keys(asObject(snapshot.operational)).length > 0 ||
      snapshot.vertical_negocio != null ||
      snapshot.verticalNegocio != null ||
      snapshot.usa_mesas != null ||
      snapshot.usaMesas != null ||
      snapshot.useTables != null ||
      snapshot.usesTables != null ||
      snapshot.fiscalMode != null ||
      snapshot.fiscal_mode != null ||
      snapshot.resolution_error != null
    ) {
      return snapshot as TerminalConfigSnapshot;
    }
  }

  return null;
};

export const mergeTerminalConfigSnapshots = (
  cachedSnapshot?: TerminalConfigSnapshot | null,
  incomingSnapshot?: TerminalConfigSnapshot | null
): TerminalConfigSnapshot | null => {
  const cached = asObject(cachedSnapshot);
  const incoming = asObject(incomingSnapshot);
  const hasCached = Object.keys(cached).length > 0;
  const hasIncoming = Object.keys(incoming).length > 0;

  if (!hasCached && !hasIncoming) {
    return null;
  }

  const merged = cloneDeep({
    ...cached,
    ...incoming,
  }) as TerminalConfigSnapshot;

  const cachedMasters = asObject(cached.masters);
  const incomingMasters = asObject(incoming.masters);
  if (Object.keys(cachedMasters).length > 0 || Object.keys(incomingMasters).length > 0) {
    merged.masters = {
      ...cachedMasters,
      ...incomingMasters,
    };
  }

  const cachedResolved = asObject(cached.resolved);
  const incomingResolved = asObject(incoming.resolved);
  if (Object.keys(cachedResolved).length > 0 || Object.keys(incomingResolved).length > 0) {
    const resolved = {
      ...cachedResolved,
      ...incomingResolved,
    } as Record<string, any>;

    ['pricing', 'inventory', 'documents', 'catalog', 'loyalty', 'identity', 'terminal', 'deviceRole', 'device_role'].forEach((key) => {
      const cachedSection = asObject(cachedResolved[key]);
      const incomingSection = asObject(incomingResolved[key]);
      if (Object.keys(cachedSection).length > 0 || Object.keys(incomingSection).length > 0) {
        resolved[key] = {
          ...cachedSection,
          ...incomingSection,
        };
      }
    });

    merged.resolved = resolved as TerminalConfigSnapshot['resolved'];
  }

  const cachedConfig = asObject(cached.config);
  const incomingConfig = asObject(incoming.config);
  if (Object.keys(cachedConfig).length > 0 || Object.keys(incomingConfig).length > 0) {
    merged.config = {
      ...cachedConfig,
      ...incomingConfig,
    };
  }

  return merged;
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
  fiscalAllocations: FiscalAllocation[];
}

export const applyTerminalConfigSnapshot = (
  baseConfig: BusinessConfig,
  options: ApplyTerminalConfigSnapshotOptions
): ApplyTerminalConfigSnapshotResult => {
  const { terminalId, posDeviceId, bindingMode, incomingSnapshot, cachedSnapshot } = options;
  const nextConfig = cloneDeep(baseConfig);
  const incoming = incomingSnapshot || null;
  const cached = cachedSnapshot || null;
  const mergedSnapshot = mergeTerminalConfigSnapshots(cached, incoming);
  const incomingResolved = asObject(incoming?.resolved);
  const incomingFallbackConfig = asObject(incoming?.config);
  const cachedResolved = asObject(cached?.resolved);
  const hasResolutionError = Boolean(incoming?.resolution_error != null);
  const hasIncomingResolved = Object.keys(incomingResolved).length > 0;
  const hasIncomingFallbackConfig = Object.keys(incomingFallbackConfig).length > 0;
  const hasCachedResolved = Object.keys(cachedResolved).length > 0;

  let snapshotSource: SnapshotSource = 'existing_config';
  let effectiveSnapshot: TerminalConfigSnapshot | null = mergedSnapshot || incoming;
  let effectiveResolved = incomingResolved;
  let effectiveFallbackConfig = incomingFallbackConfig;
  const incomingRaw = asObject(incoming);
  const incomingTerminalConfigSnake = asObject(incomingRaw.terminal_config);
  const incomingTerminalConfigCamel = asObject(incomingRaw.terminalConfig);
  const incomingTerminalConfig = Object.keys(incomingTerminalConfigSnake).length > 0
    ? incomingTerminalConfigSnake
    : incomingTerminalConfigCamel;
  const incomingTerminalConfigResolved = asObject(incomingTerminalConfig.resolved);
  const incomingTerminalConfigResolvedDocuments = asObject(incomingTerminalConfigResolved.documents);

  if (hasIncomingResolved && !hasResolutionError) {
    snapshotSource = 'resolved';
  } else if (hasIncomingFallbackConfig) {
    snapshotSource = 'fallback_config';
  } else if (hasCachedResolved) {
    snapshotSource = 'cached_snapshot';
    effectiveSnapshot = mergedSnapshot || cached;
    effectiveResolved = cachedResolved;
    effectiveFallbackConfig = asObject(cached?.config);
  }

  const resolvedIdentity = {
    ...asObject(effectiveSnapshot),
    ...asObject(effectiveResolved.identity),
    ...asObject(effectiveResolved.terminal),
  } as Record<string, any>;
  const resolvedPricing = asObject(effectiveResolved.pricing);
  const resolvedInventory = asObject(effectiveResolved.inventory);
  const resolvedDocuments = asObject(effectiveResolved.documents);
  const resolvedCatalog = asObject(effectiveResolved.catalog);
  const resolvedTaxes = asArray(effectiveResolved.taxes);
  const resolvedLoyalty = asObject(effectiveResolved.loyalty);
  const hasIncomingFiscalAllocations =
    Object.prototype.hasOwnProperty.call(resolvedDocuments, 'fiscal_allocations') ||
    Object.prototype.hasOwnProperty.call(resolvedDocuments, 'fiscalAllocations') ||
    Object.prototype.hasOwnProperty.call(resolvedDocuments, 'fiscalAllocationsByTenant');

  const fallbackOperational = asObject(effectiveFallbackConfig.operational);
  const fallbackDeviceRole = asObject(effectiveFallbackConfig.deviceRole);
  const fallbackDeviceRoleSnake = asObject(effectiveFallbackConfig.device_role);
  const fallbackSecurity = asObject(effectiveFallbackConfig.security);
  const fallbackSession = asObject(effectiveFallbackConfig.session);
  const fallbackWorkflowSessionPatch = asObject(asObject(effectiveFallbackConfig.workflow).session);
  const fallbackOffline = asObject(effectiveFallbackConfig.offline);
  const fallbackLan = asObject(effectiveFallbackConfig.lan);
  const fallbackMetadata = asObject(effectiveFallbackConfig.metadata);
  const fallbackLoyalty = asObject(effectiveFallbackConfig.loyalty);
  const fallbackDocuments = asObject(effectiveFallbackConfig.documents);
  const fallbackFiscal = asObject(effectiveFallbackConfig.fiscal);
  const resolvedTerminal = asObject(effectiveResolved.terminal);
  const resolvedProfile = asObject(effectiveResolved.profile);
  const resolvedConfigBlock = asObject(effectiveResolved.config);
  const fallbackTerminal = asObject(effectiveFallbackConfig.terminal);
  const fallbackProfile = asObject(effectiveFallbackConfig.profile);
  const fallbackConfigBlock = asObject(effectiveFallbackConfig.config);
  const resolvedTerminalConfig = asObject(resolvedTerminal.config);
  const resolvedProfileConfig = asObject(resolvedProfile.config);
  const fallbackTerminalConfig = asObject(fallbackTerminal.config);
  const fallbackProfileConfig = asObject(fallbackProfile.config);

  const incomingBusinessConfig = asObject(incomingRaw.business_config || incomingRaw.businessConfig);
  const incomingOperational = asObject(incomingRaw.operational);
  const terminalBusinessConfig = asObject(incomingTerminalConfig.business_config || incomingTerminalConfig.businessConfig);
  const terminalOperational = asObject(incomingTerminalConfig.operational);
  const resolvedBusinessConfig = asObject(effectiveResolved.business_config || effectiveResolved.businessConfig);
  const resolvedOperational = asObject(effectiveResolved.operational);
  const resolvedTerminalBusinessConfig = asObject(resolvedTerminal.business_config || resolvedTerminal.businessConfig);
  const resolvedTerminalOperational = asObject(resolvedTerminal.operational);
  const resolvedTerminalConfigBusinessConfig = asObject(resolvedTerminalConfig.business_config || resolvedTerminalConfig.businessConfig);
  const resolvedTerminalConfigOperational = asObject(resolvedTerminalConfig.operational);
  const resolvedProfileBusinessConfig = asObject(resolvedProfile.business_config || resolvedProfile.businessConfig);
  const resolvedProfileOperational = asObject(resolvedProfile.operational);
  const resolvedProfileConfigBusinessConfig = asObject(resolvedProfileConfig.business_config || resolvedProfileConfig.businessConfig);
  const resolvedProfileConfigOperational = asObject(resolvedProfileConfig.operational);
  const fallbackBusinessConfig = asObject(effectiveFallbackConfig.business_config || effectiveFallbackConfig.businessConfig);
  const fallbackTerminalBusinessConfig = asObject(fallbackTerminal.business_config || fallbackTerminal.businessConfig);
  const fallbackTerminalOperational = asObject(fallbackTerminal.operational);
  const fallbackTerminalConfigBusinessConfig = asObject(fallbackTerminalConfig.business_config || fallbackTerminalConfig.businessConfig);
  const fallbackTerminalConfigOperational = asObject(fallbackTerminalConfig.operational);
  const businessConfigSources = [
    incomingBusinessConfig,
    terminalBusinessConfig,
    resolvedBusinessConfig,
    resolvedTerminalBusinessConfig,
    resolvedTerminalConfigBusinessConfig,
    resolvedProfileBusinessConfig,
    resolvedProfileConfigBusinessConfig,
    incomingOperational,
    terminalOperational,
    resolvedOperational,
    resolvedTerminalOperational,
    resolvedTerminalConfigOperational,
    resolvedProfileOperational,
    resolvedProfileConfigOperational,
    incomingRaw,
    incomingTerminalConfig,
    effectiveResolved,
    resolvedTerminal,
    resolvedTerminalConfig,
    resolvedProfile,
    resolvedProfileConfig,
    fallbackBusinessConfig,
    fallbackTerminalBusinessConfig,
    fallbackTerminalConfigBusinessConfig,
    fallbackOperational,
    fallbackTerminalOperational,
    fallbackTerminalConfigOperational,
    effectiveFallbackConfig,
    fallbackTerminal,
    fallbackTerminalConfig,
  ].filter((source) => Object.keys(source).length > 0);
  const erpBusinessVertical = firstBusinessVertical(businessConfigSources);
  const erpUsesTables = firstTablesFlag(businessConfigSources);
  const erpStartScreen = firstStringFromSources(businessConfigSources, [
    'pantalla_inicio',
    'pantallaInicio',
    'startScreen',
    'start_screen',
    'homeScreen',
    'home_screen',
    'defaultView',
    'default_view',
  ]);
  const effectiveErpStartScreen = normalizeStartScreen(erpStartScreen)
    || (erpBusinessVertical === 'RESTAURANT' && erpUsesTables === true ? 'MAPA_MESAS' : undefined);
  const erpRooms = firstArrayFromBusinessSources(businessConfigSources, ['rooms', 'salas']);
  const erpTables = firstArrayFromBusinessSources(businessConfigSources, ['tables', 'mesas']);

  const tariffs = asArray(resolvedPricing.tariffs)
    .map((item, index) => normalizeTariff(item, index))
    .filter(Boolean) as Tariff[];
  const warehouses = asArray(resolvedInventory.warehouses)
    .map((item, index) => normalizeWarehouse(item, index))
    .filter(Boolean) as Warehouse[];
  const taxes = resolvedTaxes
    .map((item, index) => normalizeTax(item, index))
    .filter(Boolean) as TaxDefinition[];
  const snapshotTerminalConfig = asObject(asObject(effectiveSnapshot).terminal).config;
  const remoteCurrencySources = [
    asObject(snapshotTerminalConfig),
    resolvedTerminalConfig,
    resolvedIdentity,
    asObject(effectiveResolved),
    resolvedTerminal,
    resolvedProfile,
    resolvedConfigBlock,
  ];
  const fallbackCurrencySources = [
    effectiveFallbackConfig,
    fallbackTerminal,
    fallbackProfile,
    fallbackConfigBlock,
  ];
  const currencySources = [
    ...remoteCurrencySources,
    ...fallbackCurrencySources,
  ];
  const remoteBaseCurrencyCode =
    resolveCurrencyCodeFromSources(remoteCurrencySources)
    || resolveBaseCurrencyFromExplicitList(remoteCurrencySources);
  const fallbackBaseCurrencyCode =
    resolveCurrencyCodeFromSources(fallbackCurrencySources)
    || resolveBaseCurrencyFromExplicitList(fallbackCurrencySources);
  const shouldReplaceLocalCurrencies = Boolean(remoteBaseCurrencyCode || hasRemoteCurrencySignal(remoteCurrencySources));
  const incomingBaseCurrencyCode =
    remoteBaseCurrencyCode
    || fallbackBaseCurrencyCode
    || (nextConfig.currencies || []).find((currency) => currency.isBase)?.code
    || (nextConfig.currencies || []).find((currency) => currency.isEnabled)?.code
    || nextConfig.currencies?.[0]?.code
    || '';
  const explicitCurrencies = resolveExplicitCurrenciesListFromSources(
    shouldReplaceLocalCurrencies ? remoteCurrencySources : currencySources,
    incomingBaseCurrencyCode
  );
  const incomingCurrencies = explicitCurrencies || resolveCurrenciesFromSources(
    shouldReplaceLocalCurrencies ? remoteCurrencySources : currencySources,
    incomingBaseCurrencyCode
  );
  const existingCurrencies = asArray<CurrencyConfig>(nextConfig.currencies)
    .map((currency, index) => normalizeCurrencyConfig(currency, index, incomingBaseCurrencyCode))
    .filter(Boolean) as CurrencyConfig[];
  const effectiveCurrenciesByCode = new Map<string, CurrencyConfig>();
  if (!explicitCurrencies && !shouldReplaceLocalCurrencies) {
    existingCurrencies.forEach((currency) => effectiveCurrenciesByCode.set(currency.code, currency));
  }
  incomingCurrencies.forEach((currency) => effectiveCurrenciesByCode.set(currency.code, {
    ...effectiveCurrenciesByCode.get(currency.code),
    ...currency,
  }));
  const effectiveCurrencies = Array.from(effectiveCurrenciesByCode.values()).map((currency) => ({
    ...currency,
    isBase: incomingBaseCurrencyCode ? currency.code === incomingBaseCurrencyCode : currency.isBase,
    isEnabled: incomingBaseCurrencyCode && currency.code === incomingBaseCurrencyCode ? true : currency.isEnabled,
  }));
  const effectiveBaseCurrency = effectiveCurrencies.find((currency) => currency.isBase) || effectiveCurrencies[0];
  const enabledCurrencyCodes = effectiveCurrencies
    .filter((currency) => currency.isEnabled)
    .map((currency) => currency.code);
  const terminalCurrencies = {
    default: effectiveBaseCurrency?.code,
    base: effectiveBaseCurrency?.code,
    list: effectiveCurrencies.map((currency) => ({
      ...currency,
      exchange_rate: currency.rate,
      is_base: Boolean(currency.isBase),
      enabled: currency.isEnabled,
    })),
  };
  if (effectiveCurrencies.length > 0) {
    nextConfig.currencies = effectiveCurrencies;
    nextConfig.currencySymbol = effectiveBaseCurrency?.symbol || nextConfig.currencySymbol;
  } else if (explicitCurrencies !== null) {
    nextConfig.currencies = [];
  }
  const terminalConfigResolvedDocumentSeries = firstArrayFromSources([
    incomingTerminalConfigResolvedDocuments,
    resolvedDocuments,
  ], [
    'document_series',
    'documentSeries',
    'internal_sequences',
    'internalSequences',
    'series',
    'sequences',
  ]);
  if (terminalConfigResolvedDocumentSeries.length > 0) {
    console.info('POS_DOCUMENT_SERIES_RESOLVED_FROM_TERMINAL_CONFIG', {
      count: terminalConfigResolvedDocumentSeries.length,
      source: 'terminal_config.resolved.documents.document_series',
      codes: terminalConfigResolvedDocumentSeries.map((item) => {
        const data = asObject(item);
        return asString(data.code || data.series_code || data.seriesCode || data.document_series_code || data.documentSeriesCode || data.sequence_code || data.sequenceCode || data.prefix || data.id);
      }).filter(Boolean),
    });
  }
  const documentSeriesSources = [
    incomingTerminalConfigResolvedDocuments,
    resolvedDocuments,
    asObject(resolvedTerminal.documents),
    asObject(resolvedTerminalConfig.documents),
    resolvedTerminalConfig,
    asObject(resolvedProfile.documents),
    asObject(resolvedProfileConfig.documents),
    resolvedProfileConfig,
    asObject(resolvedConfigBlock.documents),
    resolvedTerminal,
    resolvedProfile,
    resolvedConfigBlock,
    fallbackDocuments,
    fallbackFiscal,
    asObject(fallbackTerminal.documents),
    asObject(fallbackTerminalConfig.documents),
    fallbackTerminalConfig,
    asObject(fallbackProfile.documents),
    asObject(fallbackProfileConfig.documents),
    fallbackProfileConfig,
    asObject(fallbackConfigBlock.documents),
    fallbackTerminal,
    fallbackProfile,
    fallbackConfigBlock,
    effectiveFallbackConfig,
  ];
  const documentAssignments = normalizeAssignments(resolvedDocuments.assignments);
  const rawDocumentAssignmentValues = collectAssignmentValues(resolvedDocuments.assignments);
  const normalizedDocumentSeries = firstArrayFromSources([
    ...documentSeriesSources,
  ], [
    'document_series',
    'documentSeries',
    'document_series_list',
    'documentSeriesList',
    'documentSeriesByTenant',
    'document_series_by_tenant',
    'terminal_document_series',
    'terminalDocumentSeries',
    'internal_sequences',
    'internalSequences',
    'series',
    'sequences',
    'document_sequences',
    'documentSequences',
    'sequence_codes',
    'sequenceCodes',
  ])
    .map((item, index) => normalizeDocumentSeries(item, index))
    .filter((series): series is DocumentSeries => Boolean(series) && !isFiscalDocumentSeries(series));
  const assignedDocumentSeriesKeys = new Set(
    rawDocumentAssignmentValues
      .map((value) => asString(value).toUpperCase())
      .filter(Boolean)
  );
  const documentSeries = assignedDocumentSeriesKeys.size > 0
    ? normalizedDocumentSeries.filter((series) => {
        const keys = [
          series.id,
          series.code,
          series.prefix,
          (series as any).series_code,
          (series as any).seriesCode,
          (series as any).document_series_id,
          (series as any).documentSeriesId,
          (series as any).document_series_code,
          (series as any).documentSeriesCode,
        ].map((value) => asString(value).toUpperCase()).filter(Boolean);
        return keys.some((key) => assignedDocumentSeriesKeys.has(key));
      })
    : normalizedDocumentSeries;
  if (assignedDocumentSeriesKeys.size > 0 && normalizedDocumentSeries.length !== documentSeries.length) {
    console.info('POS_DOCUMENT_SERIES_FILTERED_BY_ASSIGNMENTS', {
      terminalId,
      assignments: Array.from(assignedDocumentSeriesKeys),
      beforeCount: normalizedDocumentSeries.length,
      afterCount: documentSeries.length,
      keptCodes: documentSeries.map((series) => series.code || series.prefix || series.id),
    });
  }
  if (terminalConfigResolvedDocumentSeries.length === 0) {
    const bootstrapSeriesCodes = firstArrayFromSources([
      asObject(effectiveResolved.profile),
      asObject(asObject(effectiveSnapshot).profile),
      asObject(effectiveSnapshot),
    ], ['series_codes', 'seriesCodes']);
    if (bootstrapSeriesCodes.length > 0) {
      console.warn('POS_DOCUMENT_SERIES_EMPTY_IN_BOOTSTRAP', {
        seriesCodes: bootstrapSeriesCodes,
        message: 'ERP bootstrap solo envió códigos de serie; se requiere terminal config para series completas.',
      });
      console.warn('POS_DOCUMENT_SERIES_CONFIG_FETCH_REQUIRED', {
        terminalId,
        seriesCodes: bootstrapSeriesCodes,
      });
    }
  }
  if (documentSeries.length > 0) {
    console.info('POS_DOCUMENT_SERIES_NORMALIZED', {
      count: documentSeries.length,
      source: terminalConfigResolvedDocumentSeries.length > 0
        ? 'terminal_config.resolved.documents.document_series'
        : 'legacy',
      codes: documentSeries.map((series) => series.code || series.prefix || series.id),
    });
  } else {
    console.warn('POS_DOCUMENT_SERIES_MISSING_AFTER_CONFIG', {
      terminalId,
      checkedSource: 'terminal_config.resolved.documents.document_series',
    });
  }
  const rawFiscalRangeRows = firstArrayFromSources([
    resolvedDocuments,
    fallbackDocuments,
    fallbackFiscal,
    effectiveFallbackConfig,
  ], [
    'fiscal_ranges',
    'fiscalRanges',
    'fiscalRangesByTenant',
    'fiscal_ranges_by_tenant',
    'ncf_ranges',
    'ncfRanges',
    'fiscal_lots',
    'fiscalLots',
    'receipt_lots',
    'receiptLots',
  ]);
  const fiscalModeFromSnapshot = resolveFiscalModeFromSnapshot(
    resolvedDocuments,
    effectiveFallbackConfig,
    rawFiscalRangeRows,
    [
      resolvedIdentity,
      asObject(effectiveResolved),
      resolvedTerminal,
      resolvedProfile,
      resolvedConfigBlock,
      ...businessConfigSources,
      effectiveFallbackConfig,
      fallbackTerminal,
      fallbackProfile,
      fallbackConfigBlock,
    ]
  );
  const isNoFiscalMode = fiscalModeFromSnapshot === 'NONE';
  const fiscalRanges = (isNoFiscalMode ? [] : rawFiscalRangeRows)
    .map((item, index) => normalizeFiscalRange(item, index))
    .filter(Boolean) as FiscalRangeDGII[];
  const fiscalAllocations = firstResolvedArray(resolvedDocuments, [
    'fiscal_allocations',
    'fiscalAllocations',
    'fiscalAllocationsByTenant',
    'fiscal_allocations_by_tenant'
  ])
    .map((item, index) => normalizeFiscalAllocation(item, index, terminalId))
    .filter(Boolean) as FiscalAllocation[];
  const hasIncomingLoyaltyConfig =
    Object.prototype.hasOwnProperty.call(resolvedLoyalty, 'config') ||
    Object.keys(fallbackLoyalty).length > 0;
  const loyaltyConfig = normalizeLoyaltyConfig(
    Object.prototype.hasOwnProperty.call(resolvedLoyalty, 'config')
      ? resolvedLoyalty.config
      : fallbackLoyalty
  );
  const hasIncomingCampaigns =
    Object.prototype.hasOwnProperty.call(resolvedLoyalty, 'campaigns') ||
    Object.prototype.hasOwnProperty.call(effectiveFallbackConfig, 'campaigns');
  const campaignsSource = Object.prototype.hasOwnProperty.call(resolvedLoyalty, 'campaigns')
    ? resolvedLoyalty.campaigns
    : effectiveFallbackConfig.campaigns;
  const campaigns = asArray(campaignsSource)
    .map((item, index) => normalizeCampaign(item, index))
    .filter(Boolean) as Campaign[];
  const hasIncomingCoupons =
    Object.prototype.hasOwnProperty.call(resolvedLoyalty, 'coupons') ||
    Object.prototype.hasOwnProperty.call(effectiveFallbackConfig, 'coupons');
  const couponsSource = Object.prototype.hasOwnProperty.call(resolvedLoyalty, 'coupons')
    ? resolvedLoyalty.coupons
    : effectiveFallbackConfig.coupons;
  const coupons = asArray(couponsSource)
    .map((item, index) => normalizeCoupon(item, index))
    .filter(Boolean) as Coupon[];
  const hasIncomingProductGroups =
    Object.prototype.hasOwnProperty.call(resolvedCatalog, 'product_groups') ||
    Object.prototype.hasOwnProperty.call(resolvedCatalog, 'productGroups') ||
    Object.prototype.hasOwnProperty.call(resolvedCatalog, 'groups') ||
    Object.prototype.hasOwnProperty.call(effectiveFallbackConfig, 'productGroups');
  const productGroupsSource = Object.prototype.hasOwnProperty.call(resolvedCatalog, 'product_groups')
    ? resolvedCatalog.product_groups
    : Object.prototype.hasOwnProperty.call(resolvedCatalog, 'productGroups')
      ? resolvedCatalog.productGroups
    : Object.prototype.hasOwnProperty.call(resolvedCatalog, 'groups')
      ? resolvedCatalog.groups
      : effectiveFallbackConfig.productGroups;
  const productGroups = asArray(productGroupsSource)
    .map((item, index) => normalizeProductGroupFromErpPayload(item, index))
    .filter(Boolean) as ProductGroup[];
  const hasIncomingSeasons =
    Object.prototype.hasOwnProperty.call(resolvedCatalog, 'seasons') ||
    Object.prototype.hasOwnProperty.call(resolvedCatalog, 'seasonality') ||
    Object.prototype.hasOwnProperty.call(effectiveFallbackConfig, 'seasons');
  const seasonsSource = Object.prototype.hasOwnProperty.call(resolvedCatalog, 'seasons')
    ? resolvedCatalog.seasons
    : Object.prototype.hasOwnProperty.call(resolvedCatalog, 'seasonality')
      ? resolvedCatalog.seasonality
      : effectiveFallbackConfig.seasons;
  const seasons = asArray(seasonsSource)
    .map((item, index) => normalizeSeasonFromErpPayload(item, index))
    .filter(Boolean) as Season[];

  const terminalTemplate = resolveTerminalTemplate(nextConfig, terminalId);
  const terminalTerminalId =
    asString(resolvedIdentity.terminal_id) ||
    asString(resolvedIdentity.id) ||
    terminalId;
  const rawAllowedTariffIds = asArray<string>(resolvedPricing.allowed_tariff_ids).filter(Boolean);
  const rawAllowedWarehouseIds = asArray<string>(resolvedInventory.allowed_warehouse_ids).filter(Boolean);
  const allowedCategories = asArray<any>(
    Object.prototype.hasOwnProperty.call(resolvedCatalog, 'allowed_categories')
      ? resolvedCatalog.allowed_categories
      : Object.prototype.hasOwnProperty.call(resolvedCatalog, 'allowedCategories')
        ? resolvedCatalog.allowedCategories
        : Object.prototype.hasOwnProperty.call(resolvedCatalog, 'categories')
          ? resolvedCatalog.categories
          : Object.prototype.hasOwnProperty.call(resolvedCatalog, 'product_categories')
            ? resolvedCatalog.product_categories
            : resolvedCatalog.productCategories
  )
    .map((item) => {
      const data = asObject(item);
      return asString(data.name || data.nombre || data.label || data.id || data.code || item);
    })
    .filter(Boolean);
  const effectiveAllowedCategories =
    allowedCategories.length > 0
      ? allowedCategories
      : productGroups
        .map((group) => asString(group.name || group.code || group.id))
        .filter(Boolean);
  const effectivePosCategories = effectiveAllowedCategories
    .map((name, index) => ({
      id: name,
      name,
      code: name || `POS-CAT-${index + 1}`,
    }));

  const effectiveTariffs = tariffs.length > 0 ? tariffs : nextConfig.tariffs || INITIAL_TARIFFS;
  const effectiveTaxes = taxes.length > 0 ? taxes : nextConfig.taxes || INITIAL_TAXES;
  const allowedTariffIds = rawAllowedTariffIds
    .map((value) => resolveTariffId(value, effectiveTariffs))
    .filter(Boolean);
  const effectiveAllowedTariffIds =
    allowedTariffIds.length > 0
      ? allowedTariffIds
      : effectiveTariffs.map((tariff) => tariff.id);
  const effectiveDefaultTariffId =
    resolveTariffId(asString(resolvedPricing.default_tariff_id), effectiveTariffs) ||
    effectiveAllowedTariffIds[0] ||
    effectiveTariffs[0]?.id ||
    '';

  const effectiveWarehouses = warehouses.length > 0 ? warehouses : terminalTemplate.inventoryScope?.warehouses || [];
  const allowedWarehouseIds = rawAllowedWarehouseIds
    .map((value) => resolveWarehouseId(value, effectiveWarehouses))
    .filter(Boolean);
  const effectiveAllowedWarehouseIds =
    allowedWarehouseIds.length > 0
      ? allowedWarehouseIds
      : effectiveWarehouses.map((warehouse) => warehouse.id);
  const effectiveDefaultWarehouseId =
    resolveWarehouseId(asString(resolvedInventory.default_warehouse_id), effectiveWarehouses) ||
    effectiveAllowedWarehouseIds[0] ||
    '';
  const effectiveDeviceRole = resolveDeviceRoleValue([
    fallbackDeviceRole.role,
    fallbackDeviceRole.device_role,
    fallbackDeviceRole.deviceRole,
    fallbackDeviceRole.role_code,
    fallbackDeviceRole.device_role_code,
    fallbackDeviceRoleSnake.role,
    fallbackDeviceRoleSnake.device_role,
    fallbackDeviceRoleSnake.deviceRole,
    fallbackDeviceRoleSnake.role_code,
    fallbackDeviceRoleSnake.device_role_code,
    effectiveFallbackConfig.deviceRole,
    effectiveFallbackConfig.device_role,
    effectiveFallbackConfig.terminalType,
    effectiveFallbackConfig.terminal_type,
    effectiveFallbackConfig.deviceType,
    effectiveFallbackConfig.device_type,
    effectiveResolved.deviceRole,
    effectiveResolved.device_role,
    effectiveResolved.terminalType,
    effectiveResolved.terminal_type,
    effectiveResolved.deviceType,
    effectiveResolved.device_type,
    resolvedIdentity.deviceRole,
    resolvedIdentity.device_role,
    resolvedIdentity.terminalType,
    resolvedIdentity.terminal_type,
    resolvedIdentity.deviceType,
    resolvedIdentity.device_type,
    resolvedIdentity.role_code,
    resolvedIdentity.device_role_code,
    effectiveResolved.role_code,
    effectiveResolved.device_role_code,
    effectiveFallbackConfig.role_code,
    effectiveFallbackConfig.device_role_code,
    resolvedIdentity.role,
    effectiveResolved.role,
    effectiveFallbackConfig.role,
    terminalTemplate.deviceRole?.role,
  ], terminalTemplate.deviceRole?.role || DeviceRole.STANDARD_POS);
  const deviceRoleDefaults = getDefaultRoleConfig(effectiveDeviceRole);
  const templateDeviceRole = terminalTemplate.deviceRole;
  const deviceRoleChanged = Boolean(templateDeviceRole?.role) && templateDeviceRole.role !== effectiveDeviceRole;
  const templateDeviceRoleUi = !deviceRoleChanged ? asObject(templateDeviceRole?.uiSettings) : {};
  const templateDeviceRoleHardware = !deviceRoleChanged ? asObject(templateDeviceRole?.hardwareConfig) : {};
  const fallbackAllowedModules = asArray<string>(fallbackDeviceRole.allowedModules);
  const fallbackAllowedModulesSnake = asArray<string>(fallbackDeviceRoleSnake.allowedModules);
  const fallbackAuthLevel = fallbackDeviceRole.authLevel || fallbackDeviceRoleSnake.authLevel;
  const effectiveAuthLevel =
    deviceRoleChanged && deviceRoleDefaults.authLevel === 'HEADLESS' && fallbackAuthLevel === 'USER_REQUIRED'
      ? deviceRoleDefaults.authLevel
      : fallbackAuthLevel ||
        (!deviceRoleChanged ? terminalTemplate.deviceRole?.authLevel : undefined) ||
        deviceRoleDefaults.authLevel;

  const effectiveDocumentSeries = mergeDocumentSeriesCollection(
    (
      assignedDocumentSeriesKeys.size > 0
        ? documentSeries
        : documentSeries.length > 0
          ? documentSeries
          : terminalTemplate.documentSeries || DEFAULT_DOCUMENT_SERIES
    )
      .filter((series) => !isFiscalDocumentSeries(series))
  );
  const effectiveFiscalRanges = isNoFiscalMode
    ? []
    : fiscalRanges.length > 0 ? fiscalRanges : terminalTemplate.fiscal.fiscalRanges || [];
  const effectiveFiscalAllocations = hasIncomingFiscalAllocations
    ? (isNoFiscalMode ? [] : fiscalAllocations)
    : isNoFiscalMode ? [] : terminalTemplate.fiscal.fiscalAllocations || [];
  const fallbackAssignments = terminalTemplate.documentAssignments || {};
  const requestedAssignments =
    isNoFiscalMode
      ? documentAssignments
      :
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
    ...(effectiveCurrencies.length > 0 ? {
      currencyCode: effectiveBaseCurrency?.code,
      primaryCurrencyCode: effectiveBaseCurrency?.code,
      currency: effectiveBaseCurrency?.code,
      allowedCurrencyCodes: enabledCurrencyCodes,
      allowed_currency_codes: enabledCurrencyCodes,
      currencyCodes: enabledCurrencyCodes,
      currency_codes: enabledCurrencyCodes,
      currencies: terminalCurrencies,
    } : {}),
    deviceRole: {
      ...deviceRoleDefaults,
      ...(deviceRoleChanged ? {} : terminalTemplate.deviceRole || {}),
      role: effectiveDeviceRole,
      authLevel: effectiveAuthLevel,
      uiSettings: {
        ...deviceRoleDefaults.uiSettings,
        ...templateDeviceRoleUi,
        ...asObject(fallbackDeviceRole.uiSettings),
        ...asObject(fallbackDeviceRoleSnake.uiSettings),
      },
      hardwareConfig: {
        ...deviceRoleDefaults.hardwareConfig,
        ...templateDeviceRoleHardware,
        ...asObject(fallbackDeviceRole.hardwareConfig),
        ...asObject(fallbackDeviceRoleSnake.hardwareConfig),
      },
      allowedModules:
        fallbackAllowedModules.length > 0
          ? fallbackAllowedModules
          : fallbackAllowedModulesSnake.length > 0
            ? fallbackAllowedModulesSnake
            : (!deviceRoleChanged ? terminalTemplate.deviceRole?.allowedModules : undefined) || deviceRoleDefaults.allowedModules,
      apiToken:
        asString(fallbackDeviceRole.apiToken) ||
        asString(fallbackDeviceRoleSnake.apiToken) ||
        terminalTemplate.deviceRole?.apiToken,
      defaultRoute:
        asString(fallbackDeviceRole.defaultRoute) ||
        asString(fallbackDeviceRoleSnake.defaultRoute) ||
        (!deviceRoleChanged ? terminalTemplate.deviceRole?.defaultRoute : undefined) ||
        deviceRoleDefaults.defaultRoute,
    },
    fiscal: {
      ...terminalTemplate.fiscal,
      enabled: isNoFiscalMode ? false : terminalTemplate.fiscal.enabled,
      providerId: isNoFiscalMode ? 'NONE' : terminalTemplate.fiscal.providerId,
      defaultFiscalRangeId:
        isNoFiscalMode
          ? undefined
          :
        asString(resolvedDocuments.default_fiscal_range_id) ||
        terminalTemplate.fiscal.defaultFiscalRangeId,
      fiscalRanges: effectiveFiscalRanges,
      fiscalAllocations: effectiveFiscalAllocations,
    },
    pricing: {
      ...terminalTemplate.pricing,
      defaultTariffId: effectiveDefaultTariffId,
      allowedTariffIds: effectiveAllowedTariffIds,
      tariffs: effectiveTariffs,
    },
    financial: {
      ...terminalTemplate.financial,
      ...(effectiveCurrencies.length > 0 ? { acceptedCurrencies: enabledCurrencyCodes } : {}),
    },
    documentSeries: effectiveDocumentSeries,
    documentAssignments:
      isNoFiscalMode
        ? effectiveDocumentAssignments
        :
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
          ? normalizeWarehouse(resolvedInventory.default_warehouse, 0)
          : effectiveWarehouses.find((warehouse) => warehouse.id === effectiveDefaultWarehouseId),
      warehouses: effectiveWarehouses,
    },
    catalog: {
      ...(terminalTemplate.catalog || { allowedCategories: [] }),
      // If ERP does not send category restrictions, treat it as unrestricted
      // instead of inheriting stale local categories from a prior binding.
      allowedCategories: effectiveAllowedCategories,
      fullPullOnPairing:
        typeof resolvedCatalog.full_pull_on_pairing === 'boolean'
          ? Boolean(resolvedCatalog.full_pull_on_pairing)
          : terminalTemplate.catalog?.fullPullOnPairing,
    },
    operational: {
      ...terminalTemplate.operational,
      ...fallbackOperational,
      ...(erpBusinessVertical ? { vertical_negocio: erpBusinessVertical } : {}),
      ...(erpUsesTables !== undefined ? { usa_mesas: erpUsesTables } : {}),
      ...(effectiveErpStartScreen ? { pantalla_inicio: effectiveErpStartScreen } : {}),
    },
    security: (() => {
      const erpAutoLock =
        readErpSessionNumber(fallbackSession, 'autoLockMinutes', 'auto_lock_minutes') ??
        readErpSessionNumber(fallbackSession, 'autoLogoutMinutes', 'auto_logout_minutes') ??
        readErpSessionNumber(fallbackSecurity, 'autoLockMinutes', 'auto_lock_minutes') ??
        readErpSessionNumber(fallbackSecurity, 'autoLogoutMinutes', 'auto_logout_minutes');
      const erpReducedSync =
        readErpSessionNumber(fallbackSession, 'reduceSyncAfterMinutes', 'reduce_sync_after_minutes') ??
        readErpSessionNumber(fallbackSecurity, 'reduceSyncAfterMinutes', 'reduce_sync_after_minutes');
      const fromErpLock =
        erpAutoLock !== undefined && Number.isFinite(erpAutoLock) && erpAutoLock >= 0 ? { autoLogoutMinutes: erpAutoLock } : {};
      const fromErpReducedSync =
        erpReducedSync !== undefined && Number.isFinite(erpReducedSync) && erpReducedSync >= 0
          ? { reduceSyncAfterMinutes: erpReducedSync }
          : {};
      return {
        ...terminalTemplate.security,
        ...fallbackSecurity,
        ...fromErpLock,
        ...fromErpReducedSync,
      };
    })(),
    workflow: {
      ...terminalTemplate.workflow,
      session: mergeWorkflowSessionFromErpConfig(
        terminalTemplate.workflow?.session || DEFAULT_TERMINAL_CONFIG.workflow.session,
        fallbackSession,
        fallbackWorkflowSessionPatch
      ),
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
        asString(
          resolvedIdentity.role ??
          resolvedIdentity.device_role ??
          resolvedIdentity.deviceRole ??
          resolvedIdentity.role_code ??
          resolvedIdentity.device_role_code ??
          effectiveResolved.role ??
          effectiveResolved.device_role ??
          effectiveResolved.deviceRole ??
          effectiveResolved.role_code ??
          effectiveResolved.device_role_code
        ) ||
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

  if (nextTerminalConfig.workflow?.session?.allowPartialXReport === false && nextTerminalConfig.documentAssignments) {
    const prunedAssignments = { ...nextTerminalConfig.documentAssignments };
    delete prunedAssignments.X_REPORT;
    nextTerminalConfig.documentAssignments = prunedAssignments;
  }

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
  nextConfig.taxes = effectiveTaxes;
  if (erpBusinessVertical) {
    nextConfig.vertical = erpBusinessVertical;
    (nextConfig as any).vertical_negocio = erpBusinessVertical;
  }
  if (erpUsesTables !== undefined) {
    (nextConfig as any).usesTables = erpUsesTables;
    (nextConfig as any).usa_mesas = erpUsesTables;
  }
  if (effectiveErpStartScreen) {
    (nextConfig as any).pantalla_inicio = effectiveErpStartScreen;
    (nextConfig as any).startScreen = effectiveErpStartScreen;
  }
  if (erpBusinessVertical || erpUsesTables !== undefined || effectiveErpStartScreen) {
    const currentBusinessConfig = asObject(
      (nextConfig as any).business_config || (nextConfig as any).businessConfig
    );
    const nextBusinessConfig = {
      ...currentBusinessConfig,
      ...(erpBusinessVertical ? {
        vertical_negocio: erpBusinessVertical,
        businessVertical: erpBusinessVertical,
      } : {}),
      ...(erpUsesTables !== undefined ? {
        usa_mesas: erpUsesTables,
        useTables: erpUsesTables,
      } : {}),
      ...(effectiveErpStartScreen ? { pantalla_inicio: effectiveErpStartScreen } : {}),
    };
    (nextConfig as any).business_config = nextBusinessConfig;
    (nextConfig as any).businessConfig = nextBusinessConfig;
    nextConfig.operational = {
      ...(nextConfig.operational || {}),
      ...(erpBusinessVertical ? { vertical_negocio: erpBusinessVertical } : {}),
      ...(erpUsesTables !== undefined ? { usa_mesas: erpUsesTables } : {}),
      ...(effectiveErpStartScreen ? { pantalla_inicio: effectiveErpStartScreen } : {}),
    } as BusinessConfig['operational'];
  }
  if (erpRooms.length > 0) {
    const nestedBusinessConfig = {
      ...asObject((nextConfig as any).business_config),
      rooms: cloneDeep(erpRooms),
    };
    (nextConfig as any).rooms = cloneDeep(erpRooms);
    (nextConfig as any).initialRooms = cloneDeep(erpRooms);
    (nextConfig as any).business_config = nestedBusinessConfig;
    (nextConfig as any).businessConfig = nestedBusinessConfig;
  }
  if (erpTables.length > 0) {
    const nestedBusinessConfig = {
      ...asObject((nextConfig as any).business_config),
      tables: cloneDeep(erpTables),
    };
    (nextConfig as any).tables = cloneDeep(erpTables);
    (nextConfig as any).initialTables = cloneDeep(erpTables);
    (nextConfig as any).business_config = nestedBusinessConfig;
    (nextConfig as any).businessConfig = nestedBusinessConfig;
  }
  if (fiscalModeFromSnapshot) {
    const previousFiscalCompliance = nextConfig.fiscalCompliance || DEFAULT_FISCAL_COMPLIANCE_CONFIG;
    nextConfig.fiscalCompliance = {
      ...DEFAULT_FISCAL_COMPLIANCE_CONFIG,
      ...previousFiscalCompliance,
      mode: fiscalModeFromSnapshot,
      allowLegacyFallback: isNoFiscalMode
        ? false
        : previousFiscalCompliance.allowLegacyFallback ?? DEFAULT_FISCAL_COMPLIANCE_CONFIG.allowLegacyFallback,
      defaultProvider: fiscalModeFromSnapshot === 'NONE'
        ? 'NONE'
        : previousFiscalCompliance.defaultProvider || DEFAULT_FISCAL_COMPLIANCE_CONFIG.defaultProvider,
    };
    try {
      if (typeof window !== 'undefined') {
        if (isNoFiscalMode) {
          window.localStorage.setItem('canIssueNonFiscalSales', 'true');
          window.localStorage.setItem('clic_can_issue_non_fiscal_sales', 'true');
        } else {
          window.localStorage.removeItem('canIssueNonFiscalSales');
          window.localStorage.removeItem('clic_can_issue_non_fiscal_sales');
        }
      }
    } catch {
      // Storage is best-effort in Android WebView.
    }
  }
  nextConfig.inventoryScope = {
    ...(nextConfig.inventoryScope || {}),
    defaultSalesWarehouseId: effectiveDefaultWarehouseId,
    visibleWarehouseIds: effectiveAllowedWarehouseIds,
  };

  if (hasIncomingLoyaltyConfig) {
    nextConfig.loyalty = loyaltyConfig || nextConfig.loyalty;
  }

  if (hasIncomingCampaigns) {
    nextConfig.campaigns = campaigns;
  }

  if (hasIncomingCoupons) {
    nextConfig.coupons = coupons;
  }

  if (hasIncomingProductGroups) {
    nextConfig.productGroups = productGroups;
  }

  if (effectivePosCategories.length > 0) {
    const existingByName = new Map(
      (nextConfig.posCategories || [])
        .filter(Boolean)
        .map((item) => [asString(item.name).toLowerCase(), item])
    );
    nextConfig.posCategories = effectivePosCategories.map((item) => {
      const existing = existingByName.get(item.name.toLowerCase());
      return existing ? { ...existing, ...item } : item;
    });
  }

  if (hasIncomingSeasons) {
    nextConfig.seasons = seasons;
  }

  if (!hasResolutionError && Object.prototype.hasOwnProperty.call(effectiveResolved, 'promotions')) {
    nextConfig.promotions = asArray(effectiveResolved.promotions)
      .map((item) => normalizePromotionFromErpPayload(item))
      .filter((p): p is Promotion => Boolean(p));
  }

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
    fiscalAllocations: cloneDeep(terminalTemplate.fiscal?.fiscalAllocations || []),
  };
};
