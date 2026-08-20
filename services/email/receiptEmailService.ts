import { readTerminalCredentialsSync } from '../sync/TerminalCredentialStore';
import { resolveErpBaseUrl } from '../../utils/erpBaseUrl';

export type ReceiptEmailPayload = {
  email: string;
  cart: unknown[];
  [key: string]: unknown;
};

export type ReceiptEmailResult = {
  success: boolean;
  id?: string;
  status?: string;
  message?: string;
};

const RECEIPT_EMAIL_TIMEOUT_MS = 15_000;

const asNonEmptyString = (value: unknown): string | undefined => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
};

export const parseReceiptEmailResponse = async (response: Response): Promise<ReceiptEmailResult> => {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return {
      success: false,
      message: 'El ERP no devolvio JSON. El endpoint de correo no esta disponible.',
    };
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = await response.json();
    payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {
      success: false,
      message: 'El ERP devolvio una respuesta JSON invalida.',
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
  fetchImpl: typeof fetch = fetch,
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

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), RECEIPT_EMAIL_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${erpBaseUrl}/api/email/receipt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Token': syncToken,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    return await parseReceiptEmailResponse(response);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error && error.name === 'AbortError'
        ? 'El ERP no respondio a tiempo al intentar enviar el ticket.'
        : 'No fue posible conectar con el endpoint de correo del ERP.',
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};
