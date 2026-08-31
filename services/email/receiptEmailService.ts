import { readTerminalCredentialsSync, type TerminalCredentials } from '../sync/TerminalCredentialStore';
import { requestJson, type RequestJsonResult } from '../network/httpClient';
import { resolveErpBaseUrl } from '../../utils/erpBaseUrl';
import { v4 as uuidv4 } from 'uuid';

export type ReceiptEmailPayload = {
  email: string;
  cart: unknown[];
  deliveryRequestId?: string;
  [key: string]: unknown;
};

export type ReceiptEmailResult = {
  success: boolean;
  id?: string;
  status?: string;
  message?: string;
};

const RECEIPT_EMAIL_TIMEOUT_MS = 15_000;

type ReceiptEmailApiResponse = {
  success?: unknown;
  id?: unknown;
  status?: unknown;
  message?: unknown;
};

type ReceiptEmailRequest = typeof requestJson<ReceiptEmailApiResponse>;

type ReceiptEmailDependencies = {
  request?: ReceiptEmailRequest;
  readCredentials?: () => TerminalCredentials;
  refreshAuthorization?: () => Promise<void>;
};

export const withReceiptDeliveryRequestId = (payload: ReceiptEmailPayload): ReceiptEmailPayload => ({
  ...payload,
  deliveryRequestId: uuidv4(),
});

const asNonEmptyString = (value: unknown): string | undefined => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
};

const getResponseContentType = (headers: Record<string, string>): string => {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type');
  return String(entry?.[1] || '').toLowerCase();
};

export const parseReceiptEmailResponse = (
  response: Pick<RequestJsonResult<ReceiptEmailApiResponse>, 'ok' | 'status' | 'headers' | 'data' | 'text'>,
): ReceiptEmailResult => {
  const contentType = getResponseContentType(response.headers);
  const payload = response.data && typeof response.data === 'object' && !Array.isArray(response.data)
    ? response.data
    : null;

  if (!payload || (!contentType.includes('application/json') && response.text.trim().startsWith('<'))) {
    return {
      success: false,
      message: 'El ERP no devolvio JSON. El endpoint de correo no esta disponible.',
    };
  }

  const id = asNonEmptyString(payload.id);
  const status = asNonEmptyString(payload.status);
  const message = asNonEmptyString(payload.message);

  if (!response.ok || payload.success !== true) {
    return {
      success: false,
      message: message || `El ERP rechazo el envio (HTTP ${response.status}).`,
    };
  }

  if (!id) {
    return {
      success: false,
      message: 'Resend no confirmo el envio con un identificador.',
    };
  }

  return {
    success: true,
    id,
    status: status || 'accepted',
    message,
  };
};

export const sendReceiptEmailViaErp = async (
  payload: ReceiptEmailPayload,
  dependencies: ReceiptEmailDependencies | ReceiptEmailRequest = {},
): Promise<ReceiptEmailResult> => {
  const normalizedDependencies: ReceiptEmailDependencies = typeof dependencies === 'function'
    ? { request: dependencies }
    : dependencies;
  const request = normalizedDependencies.request || requestJson;
  const readCredentials = normalizedDependencies.readCredentials || readTerminalCredentialsSync;
  const refreshAuthorization = normalizedDependencies.refreshAuthorization || (async () => {
    const { apiSyncAdapter } = await import('../sync/ApiSyncAdapter');
    await apiSyncAdapter.refreshOperationalAuthorization();
  });
  const erpBaseUrl = resolveErpBaseUrl();
  if (!erpBaseUrl) {
    return {
      success: false,
      message: 'No hay un ERP configurado para enviar el ticket.',
    };
  }

  let credentials = readCredentials();
  const syncToken = asNonEmptyString(credentials.syncToken);
  if (!syncToken) {
    return {
      success: false,
      message: 'La terminal no tiene autorizacion vigente para enviar correos.',
    };
  }

  try {
    const deliveryPayload = withReceiptDeliveryRequestId(payload);
    const send = (activeCredentials: TerminalCredentials) => {
      const activeSyncToken = asNonEmptyString(activeCredentials.syncToken);
      if (!activeSyncToken) throw new Error('TERMINAL_AUTHORIZATION_UNAVAILABLE');
      return request({
        url: `${erpBaseUrl}/api/email/receipt`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeSyncToken}`,
          'X-Sync-Token': activeSyncToken,
          'X-Terminal-Id': asNonEmptyString(activeCredentials.erpTerminalId || activeCredentials.terminalId),
          'X-Device-Id': asNonEmptyString(activeCredentials.deviceId),
          'X-Device-Token': asNonEmptyString(activeCredentials.deviceToken),
          'X-Tenant-Id': asNonEmptyString(activeCredentials.erpTenantId || activeCredentials.tenantId),
        },
        body: deliveryPayload,
        timeoutMs: RECEIPT_EMAIL_TIMEOUT_MS,
        diagnosticContext: { operation: 'SEND_RECEIPT_EMAIL' },
      });
    };

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

    return parseReceiptEmailResponse(response);
  } catch (error) {
    if (error instanceof Error && error.message === 'TERMINAL_AUTHORIZATION_UNAVAILABLE') {
      return { success: false, message: 'La terminal no tiene autorización vigente para enviar correos.' };
    }
    return {
      success: false,
      message: error instanceof Error && /timeout|timed out|abort/i.test(error.message)
        ? 'El ERP no respondio a tiempo al intentar enviar el ticket.'
        : 'No fue posible conectar con el endpoint de correo del ERP.',
    };
  }
};
