import { Capacitor, CapacitorHttp } from '@capacitor/core';

import { PaymentIntegrationDefinition } from '../../types';

export type AzulAction = 'Sale' | 'SaleCancellation' | 'Refund' | 'GetLastTrx' | 'PinpadInit';

export interface AzulResponseField {
  Name: string;
  Value: string;
}

export interface AzulGatewayResponse {
  DateTime?: string;
  ResponseCode?: string;
  ResponseMessage?: string;
  IsoCode?: string;
  ErrorDescription?: string;
  ReceiptMerchant?: string;
  ReceiptClient?: string;
  SignatureData?: string;
  RequireSignature?: string | number;
  QuickPayment?: string | number;
  OrderNumber?: string;
  ResponseFields?: AzulResponseField[];
  [key: string]: any;
}

export interface AzulSaleRequest {
  amount: number;
  itbis: number;
  orderNumber: string;
  installment?: string;
  originalTerminalId?: string | null;
}

export interface AzulSaleCancellationRequest {
  amount: number;
  itbis: number;
  orderNumber: string;
  authorizationNumber: string;
}

export interface AzulRefundRequest {
  amount: number;
  itbis: number;
  orderNumber: string;
}

export interface AzulGetLastTransactionRequest {
  trxType?: string;
}

export interface AzulNormalizedResult {
  provider: 'AZUL';
  approved: boolean;
  responseCode: string;
  responseMessage: string;
  isoCode?: string;
  errorDescription?: string;
  orderNumber?: string;
  merchantId?: string;
  terminalId?: string;
  authorizationCode?: string;
  referenceNumber?: string;
  sequenceNumber?: string;
  invoiceNumber?: string;
  batchNumber?: string;
  maskedPan?: string;
  cardBrand?: string;
  entryMode?: string;
  receiptMerchant?: string;
  receiptClient?: string;
  signatureData?: string;
  requireSignature: boolean;
  quickPayment?: boolean;
  responseFields: Record<string, string>;
  rawResponse: AzulGatewayResponse;
}

export class AzulGatewayError extends Error {
  action: AzulAction;
  response?: AzulGatewayResponse;
  normalized?: AzulNormalizedResult;

  constructor(input: {
    action: AzulAction;
    message: string;
    response?: AzulGatewayResponse;
    normalized?: AzulNormalizedResult;
  }) {
    super(input.message);
    this.name = 'AzulGatewayError';
    this.action = input.action;
    this.response = input.response;
    this.normalized = input.normalized;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const DEFAULT_AZUL_TEST_BASE_URL = 'https://pruebas.azul.com.do/POSWebServices/JSON/default.aspx';
const DEFAULT_TIMEOUT_MS = 160000;

const roundToTwo = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const formatAmount = (value: number): string => roundToTwo(Math.max(0, value)).toFixed(2);

const normalizeBaseUrl = (rawUrl?: string): string => {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return DEFAULT_AZUL_TEST_BASE_URL;
  const [withoutQuery] = trimmed.split('?');
  return withoutQuery || DEFAULT_AZUL_TEST_BASE_URL;
};

const buildActionUrl = (integration: PaymentIntegrationDefinition, action: AzulAction): string => {
  return `${normalizeBaseUrl(integration.baseUrl)}?${action}`;
};

const isNativeCapacitorRuntime = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const readResponseFields = (fields?: AzulResponseField[]): Record<string, string> => {
  return (fields || []).reduce<Record<string, string>>((acc, field) => {
    if (field?.Name) {
      acc[field.Name] = field.Value ?? '';
    }
    return acc;
  }, {});
};

const isApprovedResponse = (response?: AzulGatewayResponse): boolean => {
  return String(response?.ResponseCode || '').startsWith('1[');
};

const toBooleanFlag = (value?: string | number): boolean => {
  return String(value ?? '').trim() === '1';
};

const extractErrorMessage = (response: AzulGatewayResponse): string => {
  return (
    response.ErrorDescription ||
    response.ResponseMessage ||
    readResponseFields(response.ResponseFields).ERR ||
    'AZUL no devolvió un mensaje de error.'
  );
};

const ensureAzulIntegration = (integration: PaymentIntegrationDefinition): void => {
  if (integration.provider !== 'AZUL') {
    throw new Error('La integración seleccionada no corresponde a AZUL.');
  }

  if (!integration.baseUrl?.trim()) {
    throw new Error('AZUL requiere una URL base configurada.');
  }

  if (!integration.merchantId?.trim()) {
    throw new Error('AZUL requiere Merchant ID.');
  }

  if (!integration.terminalId?.trim()) {
    throw new Error('AZUL requiere Terminal ID.');
  }

  if (!integration.auth1?.trim() || !integration.auth2?.trim()) {
    throw new Error('AZUL requiere Auth1 y Auth2.');
  }
};

const postJson = async (
  integration: PaymentIntegrationDefinition,
  action: AzulAction,
  payload: Record<string, any>
): Promise<AzulGatewayResponse> => {
  ensureAzulIntegration(integration);

  const timeoutMs = integration.timeoutMs || DEFAULT_TIMEOUT_MS;
  const url = buildActionUrl(integration, action);
  const headers = {
    'Content-Type': 'application/json',
    Auth1: integration.auth1!.trim(),
    Auth2: integration.auth2!.trim(),
  };

  const parseResponseBody = (rawBody: unknown): AzulGatewayResponse => {
    if (typeof rawBody === 'string') {
      try {
        return JSON.parse(rawBody) as AzulGatewayResponse;
      } catch {
        throw new Error(`AZUL devolvió una respuesta inválida para ${action}.`);
      }
    }

    if (rawBody && typeof rawBody === 'object') {
      return rawBody as AzulGatewayResponse;
    }

    throw new Error(`AZUL devolvió una respuesta vacía para ${action}.`);
  };

  try {
    if (isNativeCapacitorRuntime()) {
      const response = await CapacitorHttp.post({
        url,
        headers,
        data: payload,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        responseType: 'json',
      });

      const parsed = parseResponseBody(response.data);

      if (response.status < 200 || response.status >= 300) {
        throw new AzulGatewayError({
          action,
          message: extractErrorMessage(parsed),
          response: parsed,
        });
      }

      return parsed;
    }

    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const rawBody = await response.text();
      const parsed = parseResponseBody(rawBody);

      if (!response.ok) {
        throw new AzulGatewayError({
          action,
          message: extractErrorMessage(parsed),
          response: parsed,
        });
      }

      return parsed;
    } finally {
      window.clearTimeout(timeoutHandle);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`AZUL agotó el tiempo de espera (${Math.round(timeoutMs / 1000)}s).`);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('No se pudo completar la comunicación con AZUL.');
  }
};

const normalizeResult = (integration: PaymentIntegrationDefinition, response: AzulGatewayResponse): AzulNormalizedResult => {
  const fields = readResponseFields(response.ResponseFields);

  return {
    provider: 'AZUL',
    approved: isApprovedResponse(response),
    responseCode: response.ResponseCode || fields.RES || '',
    responseMessage: response.ResponseMessage || fields.DSP || '',
    isoCode: response.IsoCode || fields.ISO || '',
    errorDescription: response.ErrorDescription || fields.ERR || '',
    orderNumber: response.OrderNumber || fields.INV || '',
    merchantId: fields.MRC || integration.merchantId,
    terminalId: fields.TRM || integration.terminalId,
    authorizationCode: fields.AUT || '',
    referenceNumber: fields.REF || '',
    sequenceNumber: fields.SEQ || fields.SNX || '',
    invoiceNumber: fields.INV || response.OrderNumber || '',
    batchNumber: fields.BTC || '',
    maskedPan: fields.CRN || '',
    cardBrand: fields.CRT || '',
    entryMode: fields.SWP || '',
    receiptMerchant: response.ReceiptMerchant || fields.RCM || '',
    receiptClient: response.ReceiptClient || fields.RCC || '',
    signatureData: response.SignatureData || fields.SGN || '',
    requireSignature: toBooleanFlag(response.RequireSignature) || toBooleanFlag(fields.SIG),
    quickPayment: toBooleanFlag(response.QuickPayment) || toBooleanFlag(fields.QPS),
    responseFields: fields,
    rawResponse: response,
  };
};

export const azulMcmService = {
  async testConnection(integration: PaymentIntegrationDefinition): Promise<{
    success: boolean;
    message: string;
    responseCode?: string;
    responseMessage?: string;
    merchantId?: string;
    terminalId?: string;
  }> {
    const response = await postJson(integration, 'GetLastTrx', {
      MerchantId: integration.merchantId?.trim(),
      TerminalId: integration.terminalId?.trim(),
      TrxType: 'Sale',
    });

    const normalized = normalizeResult(integration, response);
    if (normalized.approved) {
      const message = normalized.responseMessage === 'TRX_NOT_FOUND'
        ? 'Conectado a AZUL. Credenciales válidas y terminal accesible.'
        : `Conectado a AZUL. Último estado: ${normalized.responseMessage || normalized.responseCode}.`;
      return {
        success: true,
        message,
        responseCode: normalized.responseCode,
        responseMessage: normalized.responseMessage,
        merchantId: normalized.merchantId,
        terminalId: normalized.terminalId,
      };
    }

    return {
      success: false,
      message: extractErrorMessage(response),
      responseCode: normalized.responseCode,
      responseMessage: normalized.responseMessage,
      merchantId: normalized.merchantId,
      terminalId: normalized.terminalId,
    };
  },

  async sale(integration: PaymentIntegrationDefinition, request: AzulSaleRequest): Promise<AzulNormalizedResult> {
    const response = await postJson(integration, 'Sale', {
      MerchantId: integration.merchantId?.trim(),
      TerminalId: integration.terminalId?.trim(),
      Amount: formatAmount(request.amount),
      Itbis: formatAmount(request.itbis),
      OrderNumber: request.orderNumber,
      Installment: request.installment || '0',
      OriginalTerminalId: request.originalTerminalId ?? null,
    });

    const normalized = normalizeResult(integration, response);
    if (!normalized.approved) {
      throw new AzulGatewayError({
        action: 'Sale',
        message: extractErrorMessage(response),
        response,
        normalized,
      });
    }

    return normalized;
  },

  async saleCancellation(
    integration: PaymentIntegrationDefinition,
    request: AzulSaleCancellationRequest
  ): Promise<AzulNormalizedResult> {
    const response = await postJson(integration, 'SaleCancellation', {
      MerchantId: integration.merchantId?.trim(),
      TerminalId: integration.terminalId?.trim(),
      Amount: formatAmount(request.amount),
      Itbis: formatAmount(request.itbis),
      OrderNumber: request.orderNumber,
      AuthorizationNumber: request.authorizationNumber,
    });

    const normalized = normalizeResult(integration, response);
    if (!normalized.approved) {
      throw new AzulGatewayError({
        action: 'SaleCancellation',
        message: extractErrorMessage(response),
        response,
        normalized,
      });
    }

    return normalized;
  },

  async refund(
    integration: PaymentIntegrationDefinition,
    request: AzulRefundRequest
  ): Promise<AzulNormalizedResult> {
    const response = await postJson(integration, 'Refund', {
      MerchantId: integration.merchantId?.trim(),
      TerminalId: integration.terminalId?.trim(),
      Amount: formatAmount(request.amount),
      Itbis: formatAmount(request.itbis),
      OrderNumber: request.orderNumber,
    });

    const normalized = normalizeResult(integration, response);
    if (!normalized.approved) {
      throw new AzulGatewayError({
        action: 'Refund',
        message: extractErrorMessage(response),
        response,
        normalized,
      });
    }

    return normalized;
  },

  async getLastTransaction(
    integration: PaymentIntegrationDefinition,
    request: AzulGetLastTransactionRequest = {}
  ): Promise<AzulNormalizedResult> {
    const response = await postJson(integration, 'GetLastTrx', {
      MerchantId: integration.merchantId?.trim(),
      TerminalId: integration.terminalId?.trim(),
      TrxType: request.trxType || 'Sale',
    });

    return normalizeResult(integration, response);
  },
};

export type AzulMcmService = typeof azulMcmService;
