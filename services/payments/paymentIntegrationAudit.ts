import {
  BusinessConfig,
  PaymentIntegrationAuditAction,
  PaymentIntegrationAuditEvent,
  PaymentIntegrationAuditStatus,
  PaymentIntegrationDefinition,
} from '../../types';

const MAX_AUDIT_EVENTS_PER_INTEGRATION = 200;

type PrimitiveAuditValue = string | number | boolean | null | undefined;
type AuditDetailInput = Record<string, PrimitiveAuditValue>;

interface CreatePaymentIntegrationAuditEventInput {
  action: PaymentIntegrationAuditAction;
  status: PaymentIntegrationAuditStatus;
  message: string;
  requestDetails?: AuditDetailInput;
  responseDetails?: AuditDetailInput;
  responseCode?: string;
  responseMessage?: string;
  authorizationCode?: string;
  referenceNumber?: string;
  invoiceNumber?: string;
  sequenceNumber?: string;
  maskedPan?: string;
  entryMode?: string;
  merchantId?: string;
  terminalId?: string;
}

const createAuditEventId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeAuditDetails = (details?: AuditDetailInput): Record<string, string> | undefined => {
  if (!details) return undefined;

  const normalized = Object.entries(details).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value === undefined || value === null || value === '') return acc;
    acc[key] = String(value);
    return acc;
  }, {});

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

export const createPaymentIntegrationAuditEvent = (
  integration: PaymentIntegrationDefinition,
  input: CreatePaymentIntegrationAuditEventInput
): PaymentIntegrationAuditEvent => ({
  id: createAuditEventId(),
  timestamp: new Date().toISOString(),
  integrationId: integration.id,
  integrationName: integration.name,
  provider: integration.provider,
  environment: integration.environment,
  action: input.action,
  status: input.status,
  message: input.message,
  requestDetails: normalizeAuditDetails(input.requestDetails),
  responseDetails: normalizeAuditDetails(input.responseDetails),
  responseCode: input.responseCode,
  responseMessage: input.responseMessage,
  authorizationCode: input.authorizationCode,
  referenceNumber: input.referenceNumber,
  invoiceNumber: input.invoiceNumber,
  sequenceNumber: input.sequenceNumber,
  maskedPan: input.maskedPan,
  entryMode: input.entryMode,
  merchantId: input.merchantId || integration.merchantId,
  terminalId: input.terminalId || integration.terminalId,
});

export const appendAuditEventToIntegration = (
  integration: PaymentIntegrationDefinition,
  event: PaymentIntegrationAuditEvent
): PaymentIntegrationDefinition => ({
  ...integration,
  auditEvents: [event, ...(integration.auditEvents || [])].slice(0, MAX_AUDIT_EVENTS_PER_INTEGRATION),
});

export const appendAuditEventToIntegrations = (
  integrations: PaymentIntegrationDefinition[],
  integrationId: string,
  event: PaymentIntegrationAuditEvent
): PaymentIntegrationDefinition[] => integrations.map((integration) => (
  integration.id === integrationId
    ? appendAuditEventToIntegration(integration, event)
    : integration
));

export const appendAuditEventToConfig = (
  config: BusinessConfig,
  integrationId: string,
  event: PaymentIntegrationAuditEvent
): BusinessConfig => {
  const integrations = config.integrations || [];
  const hasMatch = integrations.some((integration) => integration.id === integrationId);
  if (!hasMatch) return config;

  return {
    ...config,
    integrations: appendAuditEventToIntegrations(integrations, integrationId, event),
  };
};

export const dispatchAuditEventConfigUpdate = (
  config: BusinessConfig | undefined,
  integrationId: string,
  event: PaymentIntegrationAuditEvent
): BusinessConfig | null => {
  if (!config) return null;

  const nextConfig = appendAuditEventToConfig(config, integrationId, event);
  if (nextConfig === config) return null;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('configUpdated', { detail: nextConfig }));
  }

  return nextConfig;
};
