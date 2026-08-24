import type { BusinessConfig, ZReport } from '../../types';
import { resolveErpBaseUrl } from '../../utils/erpBaseUrl';
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
    companyInfo: config.companyInfo,
    currencySymbol: config.currencySymbol,
    report,
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
