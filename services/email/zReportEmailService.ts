import type { BusinessConfig, ZReport } from '../../types';
import { resolveErpBaseUrl } from '../../utils/erpBaseUrl';
import { requestJson, type RequestJsonResult } from '../network/httpClient';
import { readTerminalCredentialsSync } from '../sync/TerminalCredentialStore';

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
}, request: ZReportEmailRequest = requestJson): Promise<ZReportEmailResult> => {
  const erpBaseUrl = resolveErpBaseUrl();
  if (!erpBaseUrl) return { success: false, message: 'No hay un ERP configurado para enviar el cierre Z.' };

  const credentials = readTerminalCredentialsSync();
  const syncToken = asText(credentials.syncToken);
  if (!syncToken) {
    return { success: false, message: 'La terminal no tiene autorización vigente para enviar correos.' };
  }

  const emails = recipients.split(/[;,]/).map((email) => email.trim()).filter(Boolean);
  if (!emails.length) return { success: false, message: 'No hay destinatarios configurados para el cierre Z.' };

  try {
    const response = await request({
      url: `${erpBaseUrl}/api/email/z-report`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${syncToken}`,
        'X-Sync-Token': syncToken,
        'X-Terminal-Id': asText(credentials.erpTerminalId || credentials.terminalId),
        'X-Device-Id': asText(credentials.deviceId),
        'X-Device-Token': asText(credentials.deviceToken),
        'X-Tenant-Id': asText(credentials.erpTenantId || credentials.tenantId),
      },
      body: {
        emails,
        deliveryId: createDeliveryId(report.id),
        companyInfo: config.companyInfo,
        currencySymbol: config.currencySymbol,
        report,
      },
      timeoutMs: 15_000,
      diagnosticContext: { operation: 'SEND_Z_REPORT_EMAIL' },
    });
    return parseZReportEmailResponse(response);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error && /timeout|timed out|abort/i.test(error.message)
        ? 'El ERP no respondió a tiempo al enviar el cierre Z.'
        : 'No fue posible conectar con el endpoint de correo del ERP.',
    };
  }
};
