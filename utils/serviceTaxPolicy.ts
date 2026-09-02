import {
  AppliedServiceTaxPolicySnapshot,
  BusinessConfig,
  OrderServiceType,
  ServiceTaxPolicy,
  ServiceTaxPolicyMap,
  TerminalConfig,
} from '../types';

const SERVICE_TYPES: OrderServiceType[] = ['DINE_IN', 'TAKEOUT', 'DELIVERY'];

const isRecord = (value: unknown): value is Record<string, any> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const normalizeTaxIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return Array.from(new Set(value.map((id) => String(id || '').trim()).filter(Boolean)));
};

const normalizePercentage = (value: unknown): number | undefined => {
  if (value === '' || value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const percentage = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, percentage));
};

const normalizePolicy = (value: unknown): ServiceTaxPolicy | undefined => {
  if (!isRecord(value)) return undefined;
  const legalTipSource = isRecord(value.legalTip)
    ? value.legalTip
    : isRecord(value.legal_tip)
      ? value.legal_tip
      : isRecord(value.serviceCharge)
        ? value.serviceCharge
        : isRecord(value.service_charge)
          ? value.service_charge
          : {};
  const hasTaxIds = Object.prototype.hasOwnProperty.call(value, 'taxIds')
    || Object.prototype.hasOwnProperty.call(value, 'tax_ids')
    || Object.prototype.hasOwnProperty.call(value, 'applicableTaxIds')
    || Object.prototype.hasOwnProperty.call(value, 'applicable_tax_ids');
  const taxIds = normalizeTaxIds(
    value.taxIds ?? value.tax_ids ?? value.applicableTaxIds ?? value.applicable_tax_ids,
  );
  const enabledValue = legalTipSource.enabled
    ?? value.legalTipEnabled
    ?? value.legal_tip_enabled
    ?? value.applyLegalTip
    ?? value.apply_legal_tip;
  const percentage = normalizePercentage(
    legalTipSource.percentage
    ?? legalTipSource.rate
    ?? value.legalTipPercentage
    ?? value.legal_tip_percentage,
  );
  const hasLegalTip = enabledValue !== undefined || percentage !== undefined;

  return {
    ...(hasTaxIds ? { taxIds: taxIds || [] } : {}),
    ...(hasLegalTip ? {
      legalTip: {
        enabled: enabledValue === undefined ? (percentage || 0) > 0 : Boolean(enabledValue),
        ...(percentage !== undefined ? { percentage } : {}),
      },
    } : {}),
    ...(value.updatedAt || value.updated_at
      ? { updatedAt: String(value.updatedAt || value.updated_at) }
      : {}),
  };
};

export const normalizeServiceTaxPolicies = (value: unknown): ServiceTaxPolicyMap | undefined => {
  if (!isRecord(value)) return undefined;
  const normalized: ServiceTaxPolicyMap = {};

  SERVICE_TYPES.forEach((serviceType) => {
    const source = value[serviceType]
      ?? value[serviceType.toLowerCase()]
      ?? (serviceType === 'DINE_IN' ? value.dineIn ?? value.dine_in ?? value.local : undefined)
      ?? (serviceType === 'TAKEOUT' ? value.takeOut ?? value.take_out ?? value.para_llevar : undefined);
    const policy = normalizePolicy(source);
    if (policy) normalized[serviceType] = policy;
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const mergePolicies = (
  base: ServiceTaxPolicy | undefined,
  override: ServiceTaxPolicy | undefined,
): ServiceTaxPolicy => ({
  ...(base || {}),
  ...(override || {}),
  ...(override?.legalTip || base?.legalTip
    ? { legalTip: { ...(base?.legalTip || { enabled: false }), ...(override?.legalTip || {}) } }
    : {}),
});

export const resolveAppliedServiceTaxPolicy = (
  config: Pick<BusinessConfig, 'serviceTaxPolicies' | 'service_tax_policies' | 'tipsConfig'>,
  terminalConfig: Pick<TerminalConfig, 'financial'> | null | undefined,
  serviceType: OrderServiceType,
): AppliedServiceTaxPolicySnapshot => {
  const posPolicies = normalizeServiceTaxPolicies(
    config.serviceTaxPolicies ?? config.service_tax_policies,
  );
  const terminalPolicies = normalizeServiceTaxPolicies(
    terminalConfig?.financial?.serviceTaxPolicies
    ?? terminalConfig?.financial?.service_tax_policies,
  );
  const posPolicy = posPolicies?.[serviceType];
  const terminalPolicy = terminalPolicies?.[serviceType];
  const legacyServiceCharge = config.tipsConfig?.serviceCharge;
  const legacyPolicy: ServiceTaxPolicy = {
    legalTip: {
      enabled: serviceType === 'DINE_IN' && Boolean(legacyServiceCharge?.enabled),
      percentage: serviceType === 'DINE_IN' ? Number(legacyServiceCharge?.percentage || 0) : 0,
    },
  };
  const policy = mergePolicies(mergePolicies(legacyPolicy, posPolicy), terminalPolicy);

  return {
    ...policy,
    serviceType,
    source: terminalPolicy ? 'TERMINAL' : posPolicy ? 'POS' : 'LEGACY',
  };
};

export const serviceTaxPolicyEquals = (
  left: ServiceTaxPolicyMap | undefined,
  right: ServiceTaxPolicyMap | undefined,
): boolean => JSON.stringify(normalizeServiceTaxPolicies(left) || {})
  === JSON.stringify(normalizeServiceTaxPolicies(right) || {});

