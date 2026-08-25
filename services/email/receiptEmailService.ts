import { readTerminalCredentialsSync } from '../sync/TerminalCredentialStore';
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
  request: ReceiptEmailRequest = requestJson,
): Promise<ReceiptEmailResult> => {
  const erpBaseUrl = resolveErpBaseUrl();
  if (!erpBaseUrl) {
    return {
      success: false,
      message: 'No hay un ERP configurado para enviar el ticket.',
    };
  }

  const credentials = readTerminalCredentialsSync();
  const syncToken = asNonEmptyString(credentials.syncToken);
  if (!syncToken) {
    return {
      success: false,
      message: 'La terminal no tiene autorizacion vigente para enviar correos.',
    };
  }

  try {
    const deliveryPayload = withReceiptDeliveryRequestId(payload);
    const response = await request({
      url: `${erpBaseUrl}/api/email/receipt`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${syncToken}`,
        'X-Sync-Token': syncToken,
        'X-Terminal-Id': asNonEmptyString(credentials.erpTerminalId || credentials.terminalId),
        'X-Device-Id': asNonEmptyString(credentials.deviceId),
        'X-Device-Token': asNonEmptyString(credentials.deviceToken),
        'X-Tenant-Id': asNonEmptyString(credentials.erpTenantId || credentials.tenantId),
      },
      body: deliveryPayload,
      timeoutMs: RECEIPT_EMAIL_TIMEOUT_MS,
      diagnosticContext: { operation: 'SEND_RECEIPT_EMAIL' },
    });

    return parseReceiptEmailResponse(response);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error && /timeout|timed out|abort/i.test(error.message)
        ? 'El ERP no respondio a tiempo al intentar enviar el ticket.'
        : 'No fue posible conectar con el endpoint de correo del ERP.',
    };
  }
};
