import type { Customer } from '../types';

export type CustomerCommercialPreferenceTrace = {
  customer_invoice_by_email?: boolean;
  customer_commercial_discount_rate?: number;
  customer_allowed_tariff_ids?: string[];
  customer_default_tariff_id?: string | null;
};

export type CustomerCommercialPreferences = {
  invoiceByEmail: boolean;
  commercialDiscountRate: number;
  allowedTariffIds: string[];
  defaultTariffId: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(new Set(values.map(asString).filter(Boolean)));

const parseBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'si', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return undefined;
};

const parseRate = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(100, Math.max(0, parsed));
};

const readFirst = (sources: Record<string, unknown>[], keys: string[]): unknown => {
  for (const source of sources) {
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) {
        return source[key];
      }
    }
  }
  return undefined;
};

const parseStringArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value === undefined || value === null ? [] : [value];

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to comma split.
    }
  }

  return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
};

const tariffIdFromEntry = (entry: unknown): string => {
  if (entry === undefined || entry === null) return '';
  if (typeof entry === 'string' || typeof entry === 'number') return asString(entry);

  const record = asRecord(entry);
  return asString(
    record.tariff_id ||
    record.tariffId ||
    record.id ||
    record.tariff
  );
};

const normalizeTariffIds = (value: unknown): string[] =>
  uniqueStrings(parseStringArray(value).map(tariffIdFromEntry));

const findDefaultTariffFromEntries = (value: unknown): string | null => {
  const entries = parseStringArray(value);
  for (const entry of entries) {
    const record = asRecord(entry);
    const isDefault = parseBoolean(record.is_default ?? record.isDefault ?? record.default);
    if (isDefault) {
      const tariffId = tariffIdFromEntry(record);
      if (tariffId) return tariffId;
    }
  }
  return null;
};

export const resolveCustomerCommercialPreferences = (
  customer: Customer | null | undefined
): CustomerCommercialPreferences => {
  if (!customer) {
    return {
      invoiceByEmail: false,
      commercialDiscountRate: 0,
      allowedTariffIds: [],
      defaultTariffId: null,
    };
  }

  const direct = asRecord(customer);
  const metadata = asRecord(direct.metadata);
  const preferences = asRecord(direct.preferences);
  const commercial = asRecord(direct.commercialPreferences);
  const sources = [direct, metadata, preferences, commercial];

  const invoiceByEmail =
    parseBoolean(readFirst(sources, ['invoice_by_email', 'invoiceByEmail'])) ??
    parseBoolean(direct.prefersEmail) ??
    false;

  const commercialDiscountRate =
    parseRate(readFirst(sources, ['commercial_discount_rate', 'commercialDiscountRate'])) ?? 0;

  const allowedTariffRaw = readFirst(sources, [
    'allowed_tariff_ids',
    'allowedTariffIds',
    'tariff_ids',
    'tariffIds',
    'erp_business_partner_tariffs',
    'businessPartnerTariffs',
    'tariffs',
  ]);
  const allowedTariffIds = normalizeTariffIds(allowedTariffRaw);

  const explicitDefaultTariffId = asString(readFirst(sources, [
    'default_tariff_id',
    'defaultTariffId',
  ]));
  const defaultFromEntries = findDefaultTariffFromEntries(allowedTariffRaw);

  return {
    invoiceByEmail,
    commercialDiscountRate,
    allowedTariffIds,
    defaultTariffId: explicitDefaultTariffId || defaultFromEntries,
  };
};

export const buildCustomerCommercialPreferenceTrace = (
  customer: Customer | null | undefined
): CustomerCommercialPreferenceTrace => {
  if (!customer) return {};
  const preferences = resolveCustomerCommercialPreferences(customer);
  return {
    customer_invoice_by_email: preferences.invoiceByEmail,
    customer_commercial_discount_rate: preferences.commercialDiscountRate,
    customer_allowed_tariff_ids: preferences.allowedTariffIds,
    customer_default_tariff_id: preferences.defaultTariffId,
  };
};
