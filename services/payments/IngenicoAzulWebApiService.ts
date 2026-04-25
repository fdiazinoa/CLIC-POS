import { Capacitor, CapacitorHttp } from '@capacitor/core';

import { PaymentIntegrationDefinition } from '../../types';

export type IngenicoAzulWebApiAction =
  | 'SALE'
  | 'VOID'
  | 'REFUND'
  | 'CLOSE_TOTALS';

export interface IngenicoAzulWebApiSaleRequest {
  amount: number;
}

export interface IngenicoAzulWebApiVoidRequest {
  invoiceNumber: string;
}

export interface IngenicoAzulWebApiRefundRequest {
  amount: number;
}

export interface IngenicoAzulWebApiGatewayResponse {
  [key: string]: any;
}

export interface IngenicoAzulWebApiNormalizedResult {
  provider: 'INGENICO_AZUL_WEBAPI';
  approved: boolean;
  responseCode: string;
  responseMessage: string;
  errorDescription?: string;
  transactionReference?: string;
  invoiceNumber?: string;
  authorizationCode?: string;
  batchNumber?: string;
  merchantId?: string;
  terminalId?: string;
  maskedPan?: string;
  cardBrand?: string;
  entryMode?: string;
  receiptMerchant?: string;
  receiptClient?: string;
  responseFields: Record<string, string>;
  rawResponse: IngenicoAzulWebApiGatewayResponse;
}

export class IngenicoAzulWebApiError extends Error {
  action: IngenicoAzulWebApiAction;
  response?: IngenicoAzulWebApiGatewayResponse;
  normalized?: IngenicoAzulWebApiNormalizedResult;

  constructor(input: {
    action: IngenicoAzulWebApiAction;
    message: string;
    response?: IngenicoAzulWebApiGatewayResponse;
    normalized?: IngenicoAzulWebApiNormalizedResult;
  }) {
    super(input.message);
    this.name = 'IngenicoAzulWebApiError';
    this.action = input.action;
    this.response = input.response;
    this.normalized = input.normalized;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const DEFAULT_LOCAL_BASE_URL = 'http://localhost:9000';
const DEFAULT_TIMEOUT_MS = 65000;

const isNativeCapacitorRuntime = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const roundToTwo = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const formatAmount = (value: number): string => roundToTwo(Math.max(0, value)).toFixed(2);

const normalizeBaseUrl = (rawUrl?: string): string => {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return DEFAULT_LOCAL_BASE_URL;
  return trimmed.replace(/\/+$/, '');
};

const ensureIngenicoIntegration = (integration: PaymentIntegrationDefinition): void => {
  if (integration.provider !== 'INGENICO_AZUL_WEBAPI') {
    throw new Error('La integración seleccionada no corresponde a Ingenico Azul WebAPI.');
  }
};

const getTimeoutMs = (integration: PaymentIntegrationDefinition): number => {
  const candidate = Number(integration.timeoutMs || 0);
  return Number.isFinite(candidate) && candidate >= 1000 ? candidate : DEFAULT_TIMEOUT_MS;
};

const buildRequestUrl = (integration: PaymentIntegrationDefinition, path: string): string => (
  `${normalizeBaseUrl(integration.baseUrl)}${path}`
);

const getDeepValue = (source: any, path: string): unknown => {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, source);
};

const withClientTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  action: IngenicoAzulWebApiAction | 'TEST'
): Promise<T> => {
  let timeoutHandle: number | undefined;

  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = window.setTimeout(() => {
          reject(new Error(`Ingenico agotó el tiempo de espera (${Math.round(timeoutMs / 1000)}s) durante ${action}.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      window.clearTimeout(timeoutHandle);
    }
  }
};

const pickFirstString = (source: IngenicoAzulWebApiGatewayResponse, paths: string[]): string => {
  for (const path of paths) {
    const value = getDeepValue(source, path);
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return '';
};

const isApprovedResponse = (response: IngenicoAzulWebApiGatewayResponse): boolean => {
  const status = pickFirstString(response, [
    'TransactionOverallStatus',
    'transactionOverallStatus',
    'OverallStatus',
    'overallStatus',
    'Status',
    'status',
  ]);

  if (status === '00' || status === '0') return true;

  const responseCode = pickFirstString(response, [
    'ResponseCode',
    'responseCode',
    'ResultCode',
    'resultCode',
  ]);

  if (responseCode === '00' || responseCode === '0') return true;

  return false;
};

const extractMessage = (response: IngenicoAzulWebApiGatewayResponse): string => (
  pickFirstString(response, [
    'HostResponse',
    'hostResponse',
    'ResponseMessage',
    'responseMessage',
    'Message',
    'message',
    'ErrorDescription',
    'errorDescription',
    'ApplicationResponseMessage',
    'applicationResponseMessage',
  ]) || 'Ingenico no devolvió un mensaje.'
);

const extractReceiptValue = (
  response: IngenicoAzulWebApiGatewayResponse,
  preferredPaths: string[],
  fallbackPaths: string[] = []
): string => {
  const preferred = pickFirstString(response, preferredPaths);
  if (preferred) return preferred;

  return pickFirstString(response, [
    ...fallbackPaths,
    'Receipt',
    'receipt',
    'Receipts.Client',
    'receipts.client',
    'Receipts.Customer',
    'receipts.customer',
    'Receipts.Merchant',
    'receipts.merchant',
  ]);
};

const parseJsonBody = (
  rawBody: unknown,
  action: IngenicoAzulWebApiAction
): IngenicoAzulWebApiGatewayResponse => {
  if (rawBody && typeof rawBody === 'object') {
    return rawBody as IngenicoAzulWebApiGatewayResponse;
  }

  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody) as IngenicoAzulWebApiGatewayResponse;
    } catch {
      throw new Error(`Ingenico devolvió una respuesta inválida para ${action}.`);
    }
  }

  throw new Error(`Ingenico devolvió una respuesta vacía para ${action}.`);
};

const getJson = async (
  integration: PaymentIntegrationDefinition,
  action: IngenicoAzulWebApiAction,
  path: string
): Promise<IngenicoAzulWebApiGatewayResponse> => {
  ensureIngenicoIntegration(integration);

  const timeoutMs = getTimeoutMs(integration);
  const url = buildRequestUrl(integration, path);

  try {
    if (isNativeCapacitorRuntime()) {
      const response = await withClientTimeout(
        CapacitorHttp.get({
          url,
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
          responseType: 'text',
        }),
        timeoutMs,
        action
      );

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Ingenico respondió HTTP ${response.status}.`);
      }

      return parseJsonBody(response.data, action);
    }

    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await withClientTimeout(
        fetch(url, {
          method: 'GET',
          signal: controller.signal,
        }),
        timeoutMs,
        action
      );

      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`Ingenico respondió HTTP ${response.status}.`);
      }

      return parseJsonBody(bodyText, action);
    } finally {
      window.clearTimeout(timeoutHandle);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Ingenico agotó el tiempo de espera (${Math.round(timeoutMs / 1000)}s).`);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('No se pudo completar la comunicación con Ingenico.');
  }
};

const getText = async (integration: PaymentIntegrationDefinition, path: string): Promise<string> => {
  ensureIngenicoIntegration(integration);

  const timeoutMs = getTimeoutMs(integration);
  const url = buildRequestUrl(integration, path);

  try {
    if (isNativeCapacitorRuntime()) {
      const response = await withClientTimeout(
        CapacitorHttp.get({
          url,
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
          responseType: 'text',
        }),
        timeoutMs,
        'TEST'
      );

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Ingenico respondió HTTP ${response.status}.`);
      }

      return String(response.data || '');
    }

    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await withClientTimeout(
        fetch(url, {
          method: 'GET',
          signal: controller.signal,
        }),
        timeoutMs,
        'TEST'
      );

      if (!response.ok) {
        throw new Error(`Ingenico respondió HTTP ${response.status}.`);
      }

      return await response.text();
    } finally {
      window.clearTimeout(timeoutHandle);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Ingenico agotó el tiempo de espera (${Math.round(timeoutMs / 1000)}s).`);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('No se pudo verificar la disponibilidad de Ingenico.');
  }
};

const normalizeResult = (
  response: IngenicoAzulWebApiGatewayResponse
): IngenicoAzulWebApiNormalizedResult => ({
  provider: 'INGENICO_AZUL_WEBAPI',
  approved: isApprovedResponse(response),
  responseCode: pickFirstString(response, [
    'TransactionOverallStatus',
    'transactionOverallStatus',
    'ResponseCode',
    'responseCode',
    'ResultCode',
    'resultCode',
    'ApplicationResponse',
    'applicationResponse',
  ]),
  responseMessage: extractMessage(response),
  errorDescription: pickFirstString(response, ['ErrorDescription', 'errorDescription']),
  transactionReference: pickFirstString(response, ['TransactionReference', 'transactionReference']),
  invoiceNumber: pickFirstString(response, ['InvoiceNumber', 'invoiceNumber']),
  authorizationCode: pickFirstString(response, ['HostAuthorizationCode', 'hostAuthorizationCode', 'AuthorizationCode']),
  batchNumber: pickFirstString(response, ['BatchNumber', 'batchNumber']),
  merchantId: pickFirstString(response, ['MerchantId', 'merchantId']),
  terminalId: pickFirstString(response, ['TerminalId', 'terminalId']),
  maskedPan: pickFirstString(response, ['MaskedPAN', 'maskedPan', 'MaskedPan']),
  cardBrand: pickFirstString(response, ['RangeName', 'rangeName', 'CardBrand', 'cardBrand']),
  entryMode: pickFirstString(response, ['EntryMode', 'entryMode']),
  receiptMerchant: extractReceiptValue(response, [
    'ReceiptMerchant',
    'receiptMerchant',
    'MerchantReceipt',
    'merchantReceipt',
    'Receipts.Merchant',
    'receipts.merchant',
  ], [
    'MerchantVoucher',
    'merchantVoucher',
  ]),
  receiptClient: extractReceiptValue(response, [
    'ReceiptClient',
    'receiptClient',
    'CustomerReceipt',
    'customerReceipt',
    'Receipts.Customer',
    'receipts.customer',
    'Receipts.Client',
    'receipts.client',
    'Voucher',
    'voucher',
    'ClientVoucher',
    'clientVoucher',
  ]),
  responseFields: Object.entries(response || {}).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value === undefined || value === null) return acc;
    if (typeof value === 'object') return acc;
    const normalized = String(value).trim();
    if (!normalized) return acc;
    acc[key] = normalized;
    return acc;
  }, {}),
  rawResponse: response,
});

export const ingenicoAzulWebApiService = {
  async testConnection(integration: PaymentIntegrationDefinition): Promise<{
    success: boolean;
    message: string;
    responseCode?: string;
    responseMessage?: string;
    merchantId?: string;
    terminalId?: string;
  }> {
    const html = await getText(integration, '/config');
    const looksValid = html.toLowerCase().includes('ingenico webapi') || html.toLowerCase().includes('configuration');

    return {
      success: looksValid,
      message: looksValid
        ? 'Ingenico WebAPI está disponible en el dispositivo.'
        : 'El servicio respondió, pero no devolvió la pantalla esperada de Ingenico WebAPI.',
      responseCode: looksValid ? 'HTTP_200' : 'UNEXPECTED_BODY',
      responseMessage: looksValid ? 'OK' : 'UNEXPECTED_BODY',
      terminalId: integration.terminalId || undefined,
    };
  },

  async sale(
    integration: PaymentIntegrationDefinition,
    request: IngenicoAzulWebApiSaleRequest
  ): Promise<IngenicoAzulWebApiNormalizedResult> {
    const response = await getJson(
      integration,
      'SALE',
      `/api/transaction/lane/sale/${encodeURIComponent(formatAmount(request.amount))}`
    );

    const normalized = normalizeResult(response);
    if (!normalized.approved) {
      throw new IngenicoAzulWebApiError({
        action: 'SALE',
        message: extractMessage(response),
        response,
        normalized,
      });
    }

    return normalized;
  },

  async refund(
    integration: PaymentIntegrationDefinition,
    request: IngenicoAzulWebApiRefundRequest
  ): Promise<IngenicoAzulWebApiNormalizedResult> {
    const response = await getJson(
      integration,
      'REFUND',
      `/api/transaction/lane/refund/${encodeURIComponent(formatAmount(request.amount))}`
    );

    const normalized = normalizeResult(response);
    if (!normalized.approved) {
      throw new IngenicoAzulWebApiError({
        action: 'REFUND',
        message: extractMessage(response),
        response,
        normalized,
      });
    }

    return normalized;
  },

  async void(
    integration: PaymentIntegrationDefinition,
    request: IngenicoAzulWebApiVoidRequest
  ): Promise<IngenicoAzulWebApiNormalizedResult> {
    const response = await getJson(
      integration,
      'VOID',
      `/api/transaction/lane/void/${encodeURIComponent(request.invoiceNumber)}`
    );

    const normalized = normalizeResult(response);
    if (!normalized.approved) {
      throw new IngenicoAzulWebApiError({
        action: 'VOID',
        message: extractMessage(response),
        response,
        normalized,
      });
    }

    return normalized;
  },

  async closeTotals(integration: PaymentIntegrationDefinition): Promise<IngenicoAzulWebApiNormalizedResult> {
    const response = await getJson(
      integration,
      'CLOSE_TOTALS',
      '/api/transaction/lane/closetotals'
    );

    const normalized = normalizeResult(response);
    if (!normalized.approved) {
      throw new IngenicoAzulWebApiError({
        action: 'CLOSE_TOTALS',
        message: extractMessage(response),
        response,
        normalized,
      });
    }

    return normalized;
  },
};

export type IngenicoAzulWebApiService = typeof ingenicoAzulWebApiService;
