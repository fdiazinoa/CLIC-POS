import type {
  BusinessConfig,
  ZReport,
  ZReportPaymentMethodDeclaration,
  ZReportPaymentMethodLine,
} from '../../types';
import { resolveErpBaseUrl } from '../../utils/erpBaseUrl';
import { isCreditLikeMarker } from '../../utils/creditRules';
import { getZReportPaymentMethodSummary } from '../../utils/zReportPaymentSummary';
import { requestJson, type RequestJsonResult } from '../network/httpClient';
import { readTerminalCredentialsSync, type TerminalCredentials } from '../sync/TerminalCredentialStore';

export type ZReportEmailResult = {
  success: boolean;
  id?: string;
  status?: string;
  message?: string;
};

type ZReportEmailApiResponse = {
  success?: unknown;
  id?: unknown;
  status?: unknown;
  message?: unknown;
};

type ZReportEmailRequest = typeof requestJson<ZReportEmailApiResponse>;

type ZReportEmailDependencies = {
  request?: ZReportEmailRequest;
  readCredentials?: () => TerminalCredentials;
  refreshAuthorization?: () => Promise<void>;
};

export type ZReportEmailContractReport = Omit<
  ZReport,
  'stats' | 'cashExpected' | 'cashCounted' | 'cashDiscrepancy'
> & {
  stats: {
    grossSales: number;
    returnsTotal: number;
    netSales: number;
    [key: string]: unknown;
  };
  cashExpected: number;
  cashCounted: number;
  cashDiscrepancy: number;
};

const asText = (value: unknown): string | undefined => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
};

const responseContentType = (headers: Record<string, string>): string => (
  Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || ''
).toLowerCase();

const createDeliveryId = (reportId: string): string => {
  const randomId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${reportId}:${randomId}`;
};

const roundMoney = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
};

const normalizeMarker = (value: unknown): string => String(value || '').trim().toUpperCase();

const isPendingPaymentLine = (line: Partial<ZReportPaymentMethodLine>): boolean => (
  line.isPending === true
  || isCreditLikeMarker(line.methodType)
  || isCreditLikeMarker(line.methodId)
  || isCreditLikeMarker(line.name)
);

const resolveBaseCurrencyCode = (report: ZReport, config: BusinessConfig): string => (
  String(report.baseCurrency || config.currencies?.find(currency => currency.isBase)?.code || 'DOP')
    .trim()
    .toUpperCase()
);

const currencyMapToBase = (
  value: unknown,
  baseCurrencyCode: string,
  config: BusinessConfig,
): number => {
  if (typeof value === 'number') return roundMoney(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;

  const total = Object.entries(value as Record<string, unknown>).reduce((sum, [currencyCode, amount]) => {
    const normalizedCode = normalizeMarker(currencyCode);
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return sum;
    if (!normalizedCode || normalizedCode === baseCurrencyCode) return sum + numericAmount;

    const configured = config.currencies?.find(currency => normalizeMarker(currency.code) === normalizedCode);
    const rawCurrency = configured as (typeof configured & { exchange_rate?: number }) | undefined;
    const rate = Number(configured?.buyRate || configured?.rate || rawCurrency?.exchange_rate || 0);
    return rate > 0 ? sum + (numericAmount * rate) : sum;
  }, 0);

  return roundMoney(total);
};

const resolveDeclarationIds = (report: ZReport, config: BusinessConfig): string[] => {
  const normalizedTerminalId = String(report.terminalId || '').trim().toLowerCase();
  const terminal = (config.terminals || []).find(candidate => (
    String(candidate.id || '').trim().toLowerCase() === normalizedTerminalId
    || String(candidate.config?.erpTerminalId || '').trim().toLowerCase() === normalizedTerminalId
  ));
  const rawConfig = config as BusinessConfig & {
    workflow?: { session?: Record<string, unknown> };
    session?: Record<string, unknown>;
  };
  const session = (
    terminal?.config?.workflow?.session
    || rawConfig.workflow?.session
    || rawConfig.session
    || {}
  ) as Record<string, unknown>;
  const configured = session.zReportDeclaredPaymentMethodIds
    ?? session.z_report_declared_payment_method_ids;
  if (!Array.isArray(configured)) return [];
  return configured.map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
};

const buildEmailPaymentSummary = (
  report: ZReport,
  config: BusinessConfig,
): { lines: ZReportPaymentMethodLine[]; cashSales: number } => {
  const sourceLines = getZReportPaymentMethodSummary(report, config);
  const sourceCashLines = sourceLines.filter(line => normalizeMarker(line.methodType) === 'CASH');
  const configuredCash = (config.paymentMethods || []).find(method => (
    normalizeMarker(method.type) === 'CASH' && method.isEnabled !== false
  ));
  const reportedCashSales = Number(report.cashSales);
  const cashSales = roundMoney(Number.isFinite(reportedCashSales)
    ? reportedCashSales
    : sourceCashLines.reduce((sum, line) => sum + Number(line.amount || 0), 0));

  const buckets = new Map<string, ZReportPaymentMethodLine>();
  for (const line of sourceLines) {
    const methodType = normalizeMarker(line.methodType) || 'OTHER';
    if (methodType === 'CASH') continue;
    const methodId = String(line.methodId || '').trim() || undefined;
    const pending = isPendingPaymentLine(line);
    const key = methodId
      ? `id:${methodId.toLowerCase()}:${methodType}`
      : `type:${methodType}:${String(line.name || '').trim().toLowerCase()}`;
    const current = buckets.get(key);
    buckets.set(key, {
      methodId,
      methodType,
      name: pending ? 'Pendiente' : (String(line.name || '').trim() || 'Otro'),
      amount: roundMoney((current?.amount || 0) + Number(line.amount || 0)),
      ...(pending ? { isPending: true } : {}),
    });
  }

  const lines = [...buckets.values()].filter(line => Math.abs(line.amount) > 0.0001);
  if (cashSales > 0) {
    const cashSource = sourceCashLines[0];
    lines.unshift({
      methodId: cashSource?.methodId || configuredCash?.id,
      methodType: 'CASH',
      name: configuredCash?.name || cashSource?.name || 'Efectivo',
      amount: cashSales,
    });
  }
  return { lines, cashSales };
};

const buildEmailPaymentDeclarations = (
  report: ZReport,
  summary: ZReportPaymentMethodLine[],
  configuredIds: string[],
): ZReportPaymentMethodDeclaration[] => {
  if (configuredIds.length === 0) return [];
  const selectedIds = new Set(configuredIds);
  const existing = Array.isArray(report.paymentMethodDeclarations)
    ? report.paymentMethodDeclarations
    : [];

  return summary
    .filter(line => {
      const methodId = String(line.methodId || '').trim().toLowerCase();
      return Boolean(methodId)
        && selectedIds.has(methodId)
        && normalizeMarker(line.methodType) !== 'CASH'
        && !isPendingPaymentLine(line);
    })
    .map(line => {
      const saved = existing.find(candidate => (
        String(candidate.methodId || '').trim().toLowerCase()
        === String(line.methodId || '').trim().toLowerCase()
      ));
      const expected = roundMoney(line.amount);
      const declared = roundMoney(saved?.declared);
      return {
        ...line,
        expected,
        declared,
        difference: roundMoney(declared - expected),
      };
    });
};

/**
 * Builds the ERP email contract without mutating the persisted Z report. The
 * current operational model has no opening-fund component in expected cash, so
 * it intentionally remains: cash sales + manual cash in - manual cash out.
 */
export const buildZReportEmailContractReport = (
  report: ZReport,
  config: BusinessConfig,
): ZReportEmailContractReport => {
  const baseCurrencyCode = resolveBaseCurrencyCode(report, config);
  const { lines: paymentMethodSummary, cashSales } = buildEmailPaymentSummary(report, config);
  const cashIn = roundMoney(report.cashIn);
  const cashOut = roundMoney(report.cashOut);
  const cashExpected = roundMoney(cashSales + cashIn - cashOut);
  const cashCounted = currencyMapToBase(report.cashCounted, baseCurrencyCode, config);
  const cashDiscrepancy = roundMoney(cashCounted - cashExpected);
  const paymentMethodDeclarations = buildEmailPaymentDeclarations(
    report,
    paymentMethodSummary,
    resolveDeclarationIds(report, config),
  );

  return {
    ...report,
    stats: {
      ...(report.stats || {}),
      grossSales: roundMoney(report.stats?.grossSales),
      returnsTotal: roundMoney(report.stats?.returnsTotal),
      netSales: roundMoney(report.stats?.netSales),
    },
    transactionCount: Number(report.transactionCount || 0),
    paymentMethodSummary,
    paymentMethodDeclarations,
    cashSales,
    cashIn,
    cashOut,
    cashExpected,
    cashCounted,
    cashDiscrepancy,
  };
};

export const parseZReportEmailResponse = (
  response: Pick<RequestJsonResult<ZReportEmailApiResponse>, 'ok' | 'status' | 'headers' | 'data' | 'text'>,
): ZReportEmailResult => {
  const payload = response.data && typeof response.data === 'object' && !Array.isArray(response.data)
    ? response.data
    : null;
  const contentType = responseContentType(response.headers);
  if (!payload || (!contentType.includes('application/json') && response.text.trim().startsWith('<'))) {
    return { success: false, message: 'El endpoint de correo del ERP no está disponible.' };
  }
  const message = asText(payload.message);
  if (!response.ok || payload.success !== true) {
    return { success: false, message: message || `El ERP rechazó el envío (HTTP ${response.status}).` };
  }
  const id = asText(payload.id);
  if (!id) return { success: false, message: 'Resend no confirmó el envío del cierre Z.' };
  return { success: true, id, status: asText(payload.status) || 'accepted', message };
};

export const sendZReportEmailViaErp = async ({
  recipients,
  report,
  config,
}: {
  recipients: string;
  report: ZReport;
  config: BusinessConfig;
}, dependencies: ZReportEmailDependencies = {}): Promise<ZReportEmailResult> => {
  const request = dependencies.request || requestJson;
  const readCredentials = dependencies.readCredentials || readTerminalCredentialsSync;
  const refreshAuthorization = dependencies.refreshAuthorization || (async () => {
    const { apiSyncAdapter } = await import('../sync/ApiSyncAdapter');
    await apiSyncAdapter.refreshOperationalAuthorization();
  });
  const erpBaseUrl = resolveErpBaseUrl();
  if (!erpBaseUrl) return { success: false, message: 'No hay un ERP configurado para enviar el cierre Z.' };

  let credentials = readCredentials();
  const syncToken = asText(credentials.syncToken);
  if (!syncToken) {
    return { success: false, message: 'La terminal no tiene autorización vigente para enviar correos.' };
  }

  const emails = recipients.split(/[;,]/).map((email) => email.trim()).filter(Boolean);
  if (!emails.length) return { success: false, message: 'No hay destinatarios configurados para el cierre Z.' };

  const body = {
    emails,
    deliveryId: createDeliveryId(report.id),
    reportSchemaVersion: 2,
    companyInfo: config.companyInfo,
    currencySymbol: config.currencySymbol,
    report: buildZReportEmailContractReport(report, config),
  };

  const send = (activeCredentials: TerminalCredentials) => {
    const activeSyncToken = asText(activeCredentials.syncToken);
    if (!activeSyncToken) throw new Error('TERMINAL_AUTHORIZATION_UNAVAILABLE');
    return request({
      url: `${erpBaseUrl}/api/email/z-report`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeSyncToken}`,
        'X-Sync-Token': activeSyncToken,
        'X-Terminal-Id': asText(activeCredentials.erpTerminalId || activeCredentials.terminalId),
        'X-Device-Id': asText(activeCredentials.deviceId),
        'X-Device-Token': asText(activeCredentials.deviceToken),
        'X-Tenant-Id': asText(activeCredentials.erpTenantId || activeCredentials.tenantId),
      },
      body,
      timeoutMs: 15_000,
      diagnosticContext: { operation: 'SEND_Z_REPORT_EMAIL' },
    });
  };

  try {
    let response = await send(credentials);
    if (response.status === 401) {
      try {
        await refreshAuthorization();
      } catch {
        return {
          success: false,
          message: 'La autorización de la terminal venció y no pudo renovarse automáticamente.',
        };
      }
      credentials = readCredentials();
      response = await send(credentials);
    }
    return parseZReportEmailResponse(response);
  } catch (error) {
    if (error instanceof Error && error.message === 'TERMINAL_AUTHORIZATION_UNAVAILABLE') {
      return { success: false, message: 'La terminal no tiene autorización vigente para enviar correos.' };
    }
    return {
      success: false,
      message: error instanceof Error && /timeout|timed out|abort/i.test(error.message)
        ? 'El ERP no respondió a tiempo al enviar el cierre Z.'
        : 'No fue posible conectar con el endpoint de correo del ERP.',
    };
  }
};
