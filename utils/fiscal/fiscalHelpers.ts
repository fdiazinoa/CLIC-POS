import {
  BusinessConfig,
  ElectronicNCFType,
  FiscalComplianceConfig,
  FiscalDocumentCode,
  FiscalMode,
  FiscalProviderConfig,
  FiscalProviderDeliveryMode,
  FiscalProviderEnvironment,
  FiscalProviderId,
  FiscalReserveAlertConfig,
  NCFType,
  TerminalConfig,
  Transaction
} from '../../types';

export const LEGACY_FISCAL_CODES: NCFType[] = ['B01', 'B02', 'B04', 'B14', 'B15'];
export const ELECTRONIC_FISCAL_CODES: ElectronicNCFType[] = ['E31', 'E32', 'E34', 'E44', 'E45'];
export const SUPPORTED_FISCAL_CODES: FiscalDocumentCode[] = [
  ...LEGACY_FISCAL_CODES,
  ...ELECTRONIC_FISCAL_CODES
];

export const DEFAULT_FISCAL_PROVIDERS: FiscalProviderConfig[] = [
  { id: 'NONE', enabled: true, environment: 0, displayName: 'Sin proveedor' },
  {
    id: 'POLARIS',
    enabled: true,
    environment: 0,
    displayName: 'Polaris EDI',
    deliveryMode: 'LOCAL_DIRECT',
    tipoIngreso: 1,
    modificationCode: 2,
    unitCodeGoods: 47,
    unitCodeServices: 43
  },
  {
    id: 'DIGIFACT',
    enabled: true,
    environment: 0,
    displayName: 'DigiFact',
    deliveryMode: 'LOCAL_DIRECT',
    tipoIngreso: 1,
    modificationCode: 2,
    unitCodeGoods: 47,
    unitCodeServices: 43
  }
];

export const DEFAULT_FISCAL_COMPLIANCE_CONFIG: FiscalComplianceConfig = {
  mode: 'LEGACY_B',
  defaultProvider: 'NONE',
  allowLegacyFallback: true,
  providers: DEFAULT_FISCAL_PROVIDERS,
  reserveAlert: {
    quantity: 200,
    percent: 10
  }
};

export type FiscalReserveAlert = {
  tone: 'critical' | 'warning';
  message: string;
  remaining: number;
  total: number;
  percentRemaining: number;
};

export const normalizeFiscalCode = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';

export const normalizeFiscalCredentialKey = (value: unknown): string =>
  typeof value === 'string'
    ? value.trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    : '';

export const normalizeFiscalProviderId = (value: unknown): FiscalProviderId => {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (normalized === 'POLARIS' || normalized === 'DIGIFACT' || normalized === 'NONE') {
    return normalized;
  }
  return 'NONE';
};

const normalizeFiscalEnvironment = (value: unknown): FiscalProviderEnvironment => {
  const parsed = Number(value);
  return parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3 ? parsed : 0;
};

const normalizeOptionalNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const normalizeOptionalBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'si', 'sí'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return undefined;
};

export const normalizeFiscalProviderDeliveryMode = (value: unknown): FiscalProviderDeliveryMode | undefined => {
  const normalized = typeof value === 'string'
    ? value.trim().toUpperCase().replace(/[\s-]+/g, '_')
    : '';
  if (normalized === 'LOCAL_DIRECT' || normalized === 'LOCAL') return 'LOCAL_DIRECT';
  if (normalized === 'DELEGATED_ERP' || normalized === 'ERP' || normalized === 'DELEGATED') return 'DELEGATED_ERP';
  return undefined;
};

const getTerminalFiscalProviderConfig = (
  terminalConfig?: TerminalConfig | null
): FiscalProviderConfig | null => {
  const fiscal = terminalConfig?.fiscal as (TerminalConfig['fiscal'] & Record<string, unknown>) | undefined;
  if (!fiscal) return null;

  const hasProviderField =
    fiscal.providerId !== undefined ||
    fiscal.provider_id !== undefined ||
    fiscal.provider !== undefined;
  const providerId = normalizeFiscalProviderId(
    fiscal.providerId ?? fiscal.provider_id ?? fiscal.provider
  );
  const enabled = normalizeOptionalBoolean(fiscal.enabled);

  if (enabled === false || (hasProviderField && providerId === 'NONE')) {
    return { id: 'NONE', enabled: true, environment: 0, displayName: 'Sin proveedor' };
  }

  if (!hasProviderField || providerId === 'NONE') return null;

  return {
    id: providerId,
    enabled: enabled ?? true,
    environment: normalizeFiscalEnvironment(fiscal.environment),
    deliveryMode: normalizeFiscalProviderDeliveryMode(
      fiscal.deliveryMode
      ?? fiscal.delivery_mode
      ?? fiscal.fiscalDeliveryMode
      ?? fiscal.fiscal_delivery_mode
      ?? fiscal.providerMode
      ?? fiscal.provider_mode
    ),
    apiBaseUrl: normalizeOptionalString(fiscal.apiBaseUrl ?? fiscal.api_base_url ?? fiscal.baseUrl ?? fiscal.base_url),
    testUrl: normalizeOptionalString(fiscal.testUrl ?? fiscal.test_url),
    issueUrl: normalizeOptionalString(fiscal.issueUrl ?? fiscal.issue_url),
    statusUrl: normalizeOptionalString(fiscal.statusUrl ?? fiscal.status_url),
    credentialKey: normalizeFiscalCredentialKey(fiscal.credentialKey ?? fiscal.credential_key) || undefined,
    tipoIngreso: normalizeOptionalNumber(fiscal.tipoIngreso ?? fiscal.tipo_ingreso),
    modificationCode: normalizeOptionalNumber(fiscal.modificationCode ?? fiscal.modification_code),
    unitCodeGoods: normalizeOptionalNumber(fiscal.unitCodeGoods ?? fiscal.unit_code_goods),
    unitCodeServices: normalizeOptionalNumber(fiscal.unitCodeServices ?? fiscal.unit_code_services)
  };
};

export const FISCAL_DOCUMENT_LABELS: Record<FiscalDocumentCode, string> = {
  B01: 'Credito Fiscal',
  B02: 'Consumo',
  B04: 'Nota de Credito',
  B14: 'Regimenes Especiales',
  B15: 'Gubernamental',
  E31: 'e-CF Credito Fiscal',
  E32: 'e-CF Consumo',
  E34: 'e-CF Nota de Credito',
  E44: 'e-CF Regimenes Especiales',
  E45: 'e-CF Gubernamental'
};

export const isLegacyFiscalCode = (value: unknown): value is NCFType =>
  LEGACY_FISCAL_CODES.includes(normalizeFiscalCode(value) as NCFType);

export const isElectronicFiscalCode = (value: unknown): value is ElectronicNCFType =>
  ELECTRONIC_FISCAL_CODES.includes(normalizeFiscalCode(value) as ElectronicNCFType);

export const getFiscalCodeFromNcf = (value: unknown): FiscalDocumentCode | null => {
  const normalized = normalizeFiscalCode(value);
  return SUPPORTED_FISCAL_CODES.find(code => normalized.startsWith(code)) || null;
};

export const getExpectedFiscalNcfLength = (value: unknown): number | null => {
  const normalized = normalizeFiscalCode(value);
  if (!normalized) return null;
  if (normalized.startsWith('B')) return 11;
  if (normalized.startsWith('E')) return 13;
  return null;
};

export const isCreditNoteFiscalCode = (value: unknown): boolean => {
  const code = normalizeFiscalCode(value);
  return code === 'B04' || code === 'E34';
};

export const isCreditNoteNcf = (value: unknown): boolean => {
  const normalized = normalizeFiscalCode(value);
  return normalized.startsWith('B04') || normalized.startsWith('E34');
};

export const isSaleFiscalCode = (value: unknown): boolean => {
  const code = normalizeFiscalCode(value);
  return ['B01', 'B02', 'B14', 'B15', 'E31', 'E32', 'E44', 'E45'].includes(code);
};

export const isReportableFiscalNcf = (value: unknown): boolean =>
  getFiscalCodeFromNcf(value) !== null;

export const isRefundLikeTransaction = (tx?: Partial<Transaction> | null): boolean => {
  if (!tx) return false;
  const documentType = normalizeFiscalCode(tx.documentType);
  const displayId = normalizeFiscalCode(tx.displayId);
  return documentType === 'REFUND'
    || isCreditNoteFiscalCode(tx.ncfType)
    || isCreditNoteNcf(tx.ncf)
    || displayId.startsWith('NC');
};

export const isElectronicFiscalTransaction = (tx?: Partial<Transaction> | null): boolean => {
  if (!tx) return false;
  const fiscalCode = getFiscalDisplayCode(tx);

  return isElectronicFiscalCode(fiscalCode);
};

export const getFiscalDisplayNcf = (tx?: Partial<Transaction> | null): string => {
  if (!tx) return '';
  return normalizeFiscalCode(tx.electronicNcf || tx.ncf || tx.legacyNcf);
};

export const getFiscalDisplayCode = (
  tx?: Partial<Transaction> | null
): FiscalDocumentCode | null => {
  if (!tx) return null;

  return getFiscalCodeFromNcf(tx.electronicNcf)
    || (isElectronicFiscalCode(tx.ncfType) ? tx.ncfType : null)
    || getFiscalCodeFromNcf(tx.ncf)
    || (tx.ncfType || null)
    || getFiscalCodeFromNcf(tx.legacyNcf);
};

export const canRetryFiscalTransaction = (tx?: Partial<Transaction> | null): boolean => {
  if (!tx) return false;
  if (!isElectronicFiscalTransaction(tx)) return false;
  if (!tx.fiscalProvider || tx.fiscalProvider === 'NONE') return false;
  return tx.fiscalSyncStatus === 'ERROR' || tx.fiscalSyncStatus === 'PENDING';
};

export const getFiscalRetryActionLabel = (tx?: Partial<Transaction> | null): string => {
  if (!canRetryFiscalTransaction(tx)) return '';
  return tx?.fiscalReferenceId && tx.fiscalSyncStatus === 'PENDING'
    ? 'Consultar estado'
    : 'Reintentar envío';
};

export const mapLegacyFiscalCodeToElectronic = (code: NCFType): FiscalDocumentCode => {
  switch (code) {
    case 'B01':
      return 'E31';
    case 'B02':
      return 'E32';
    case 'B04':
      return 'E34';
    case 'B14':
      return 'E44';
    case 'B15':
      return 'E45';
    default:
      return code;
  }
};

export const mapElectronicFiscalCodeToLegacy = (code: ElectronicNCFType): FiscalDocumentCode => {
  switch (code) {
    case 'E31':
      return 'B01';
    case 'E32':
      return 'B02';
    case 'E34':
      return 'B04';
    case 'E44':
      return 'B14';
    case 'E45':
      return 'B15';
    default:
      return code;
  }
};

export const resolveSaleFiscalCode = (
  mode: FiscalMode,
  baseLegacyCode: NCFType
): FiscalDocumentCode => {
  if (mode !== 'ECF') return baseLegacyCode;
  return mapLegacyFiscalCodeToElectronic(baseLegacyCode);
};

export const resolveCreditNoteFiscalCode = (mode: FiscalMode): FiscalDocumentCode =>
  mode === 'ECF' ? 'E34' : 'B04';

export const getFiscalComplianceConfig = (
  config?: BusinessConfig | null
): FiscalComplianceConfig => {
  const incoming = config?.fiscalCompliance;
  if (!incoming) return DEFAULT_FISCAL_COMPLIANCE_CONFIG;

  const defaultProviderIds = new Set(DEFAULT_FISCAL_PROVIDERS.map(provider => provider.id));
  const mergedProviders = DEFAULT_FISCAL_PROVIDERS.map(defaultProvider => {
    const custom = (incoming.providers || []).find(provider => provider.id === defaultProvider.id);
    return custom ? { ...defaultProvider, ...custom } : defaultProvider;
  }).concat(
    (incoming.providers || [])
      .filter(provider => provider?.id && !defaultProviderIds.has(provider.id))
      .map(provider => ({
        ...provider,
        id: normalizeFiscalProviderId(provider.id),
        enabled: provider.enabled ?? true
      }))
      .filter(provider => provider.id !== 'NONE')
  );

  return {
    mode: incoming.mode || DEFAULT_FISCAL_COMPLIANCE_CONFIG.mode,
    defaultProvider: normalizeFiscalProviderId(incoming.defaultProvider) || DEFAULT_FISCAL_COMPLIANCE_CONFIG.defaultProvider,
    allowLegacyFallback: incoming.allowLegacyFallback ?? DEFAULT_FISCAL_COMPLIANCE_CONFIG.allowLegacyFallback,
    providers: mergedProviders,
    reserveAlert: normalizeFiscalReserveAlertConfig(incoming.reserveAlert)
  };
};

export const getEffectiveFiscalComplianceConfig = (
  config?: BusinessConfig | null,
  terminalConfig?: TerminalConfig | null
): FiscalComplianceConfig => {
  const base = getFiscalComplianceConfig(config);
  const terminalProvider = getTerminalFiscalProviderConfig(terminalConfig);

  if (!terminalProvider) return base;

  if (terminalProvider.id === 'NONE' || terminalProvider.enabled === false) {
    return {
      ...base,
      mode: 'LEGACY_B',
      defaultProvider: 'NONE'
    };
  }

  const fallbackProvider = getFiscalProviderConfig(base, terminalProvider.id);
  const effectiveProvider: FiscalProviderConfig = {
    ...fallbackProvider,
    ...terminalProvider,
    enabled: terminalProvider.enabled ?? fallbackProvider.enabled ?? true
  };
  const providers = base.providers.some(provider => provider.id === effectiveProvider.id)
    ? base.providers.map(provider => provider.id === effectiveProvider.id ? effectiveProvider : provider)
    : [...base.providers, effectiveProvider];

  return {
    ...base,
    mode: 'ECF',
    defaultProvider: effectiveProvider.id,
    providers
  };
};

export const normalizeFiscalReserveAlertConfig = (
  value?: Partial<FiscalReserveAlertConfig> | null
): Required<FiscalReserveAlertConfig> => {
  const defaults = DEFAULT_FISCAL_COMPLIANCE_CONFIG.reserveAlert || { quantity: 200, percent: 10 };
  const quantity = Number(value?.quantity);
  const percent = Number(value?.percent);
  const fallbackQuantity = Number(defaults.quantity || 0);
  const fallbackPercent = Number(defaults.percent || 0);

  return {
    quantity: Number.isFinite(quantity) && quantity >= 0 ? Math.floor(quantity) : fallbackQuantity,
    percent: Number.isFinite(percent) && percent >= 0 ? Math.min(100, percent) : fallbackPercent
  };
};

const resolveFiscalReserveAlertConfig = (
  source?: BusinessConfig | FiscalComplianceConfig | null
): Required<FiscalReserveAlertConfig> => {
  const maybeBusinessConfig = source as BusinessConfig | null | undefined;
  if (maybeBusinessConfig?.fiscalCompliance) {
    return normalizeFiscalReserveAlertConfig(getFiscalComplianceConfig(maybeBusinessConfig).reserveAlert);
  }

  return normalizeFiscalReserveAlertConfig((source as FiscalComplianceConfig | null | undefined)?.reserveAlert);
};

export const getFiscalReserveAlert = (
  remaining: number,
  total: number,
  source?: BusinessConfig | FiscalComplianceConfig | null
): FiscalReserveAlert | null => {
  const safeRemaining = Math.max(0, Number(remaining) || 0);
  const safeTotal = Math.max(0, Number(total) || 0);
  if (safeTotal <= 0) return null;

  const percentRemaining = (safeRemaining / safeTotal) * 100;
  if (safeRemaining <= 0) {
    return {
      tone: 'critical',
      message: 'Sin comprobantes disponibles en este bloque. Solicita una nueva reserva al supervisor.',
      remaining: safeRemaining,
      total: safeTotal,
      percentRemaining
    };
  }

  const alertConfig = resolveFiscalReserveAlertConfig(source);
  const quantityLimit = Number(alertConfig.quantity || 0);
  const percentLimit = Number(alertConfig.percent || 0);
  const reachedQuantityLimit = quantityLimit > 0 && safeRemaining <= quantityLimit;
  const reachedPercentLimit = percentLimit > 0 && percentRemaining <= percentLimit;

  if (!reachedQuantityLimit && !reachedPercentLimit) return null;

  return {
    tone: 'warning',
    message: `Quedan ${safeRemaining.toLocaleString()} comprobantes (${percentRemaining.toFixed(1)}%). Avisa al supervisor para reservar otro bloque.`,
    remaining: safeRemaining,
    total: safeTotal,
    percentRemaining
  };
};

export const getProviderEnvironment = (
  config: FiscalComplianceConfig,
  providerId: FiscalProviderId
): FiscalProviderEnvironment => {
  const match = (config.providers || []).find(provider => provider.id === providerId);
  return match?.environment ?? 0;
};

export const getFiscalProviderConfig = (
  config: FiscalComplianceConfig,
  providerId: FiscalProviderId
): FiscalProviderConfig => {
  const fallback = DEFAULT_FISCAL_PROVIDERS.find(provider => provider.id === providerId)
    || DEFAULT_FISCAL_PROVIDERS[0];
  const match = (config.providers || []).find(provider => provider.id === providerId);
  return match ? { ...fallback, ...match } : { ...fallback };
};

export const getFiscalProviderCredentialKey = (
  config?: BusinessConfig | null,
  providerId?: FiscalProviderId,
  terminalConfig?: TerminalConfig | null
): string | undefined => {
  if (!providerId || providerId === 'NONE') return undefined;
  const fiscalCompliance = getEffectiveFiscalComplianceConfig(config, terminalConfig);
  const providerConfig = getFiscalProviderConfig(fiscalCompliance, providerId);
  const explicitKey = normalizeFiscalCredentialKey(providerConfig.credentialKey);
  if (explicitKey) return explicitKey;

  const companyKey = normalizeFiscalCredentialKey(config?.companyInfo?.rnc);
  return companyKey || undefined;
};

export const shouldUseElectronicFiscalFlow = (config?: BusinessConfig | null): boolean =>
  getFiscalComplianceConfig(config).mode === 'ECF';

export const getDefaultFiscalProvider = (
  config?: BusinessConfig | null,
  terminalConfig?: TerminalConfig | null
): FiscalProviderId =>
  getEffectiveFiscalComplianceConfig(config, terminalConfig).defaultProvider;
