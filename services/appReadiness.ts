import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { BusinessConfig, Product, TerminalConfig } from '../types';
import { db } from '../utils/db';

export type AppReadinessCode =
  | 'OK'
  | 'ERP_ENDPOINT_MISSING'
  | 'ERP_CONTEXT_MISSING'
  | 'TERMINAL_PROFILE_DRAFT'
  | 'TERMINAL_PROFILE_MISSING'
  | 'CATALOG_MISSING'
  | 'SEQUENCE_MISSING'
  | 'PAYMENT_METHODS_MISSING'
  | 'TAXES_MISSING'
  | 'BACKEND_UNAVAILABLE'
  | 'LOCAL_CONTEXT_MISSING';

export type AppReadinessNextAction = 'none' | 'download_bootstrap' | 'retry' | 'contact_support';

export interface AppReadinessRequest {
  cloudAdminTenantId: string;
  deviceId: string;
  terminalId: string;
  terminalName: string;
}

export interface AppReadinessCheckResult {
  ok: boolean;
  code: AppReadinessCode;
  message: string;
  nextAction: AppReadinessNextAction;
  detail?: string | null;
  raw?: any;
}

export interface LocalReadinessInput {
  config: BusinessConfig;
  deviceId: string;
  terminal?: { id: string; config: TerminalConfig } | null;
}

const REQUEST_TIMEOUT_MS = 5000;

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const asObject = (value: unknown): Record<string, any> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
);

const normalizeBaseUrl = (value?: string | null): string | null => {
  const raw = trim(value);
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return url
      .toString()
      .replace(/\/api\/sync\/?$/i, '')
      .replace(/\/api\/?$/i, '')
      .replace(/\/+$/, '');
  } catch {
    return null;
  }
};

export const resolveReadinessErpBaseUrl = (): string | null => {
  return normalizeBaseUrl(localStorage.getItem('CLIC_ERP_BASE_URL'))
    || normalizeBaseUrl(localStorage.getItem('erp_base_url'))
    || normalizeBaseUrl(localStorage.getItem('CLIC_ERP_SYNC_URL'));
};

const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const normalizeBackendCode = (value: unknown): AppReadinessCode => {
  const code = trim(value).toUpperCase();
  if (
    code === 'ERP_CONTEXT_MISSING' ||
    code === 'TERMINAL_PROFILE_DRAFT' ||
    code === 'TERMINAL_PROFILE_MISSING' ||
    code === 'CATALOG_MISSING' ||
    code === 'SEQUENCE_MISSING' ||
    code === 'PAYMENT_METHODS_MISSING' ||
    code === 'TAXES_MISSING'
  ) {
    return code as AppReadinessCode;
  }
  return code === 'OK' ? 'OK' : 'BACKEND_UNAVAILABLE';
};

const normalizeNextAction = (value: unknown): AppReadinessNextAction => {
  const action = trim(value).toLowerCase();
  if (action === 'download_bootstrap' || action === 'retry' || action === 'contact_support') {
    return action as AppReadinessNextAction;
  }
  return 'none';
};

export const checkBackendReadiness = async (
  input: AppReadinessRequest
): Promise<AppReadinessCheckResult> => {
  const baseUrl = resolveReadinessErpBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      code: 'ERP_ENDPOINT_MISSING',
      nextAction: 'retry',
      message: 'No hay endpoint ERP configurado para validar el entorno operativo.',
    };
  }

  const url = `${baseUrl}/api/pos/provisioning/readiness`;
  const body = {
    cloudAdminTenantId: input.cloudAdminTenantId,
    deviceId: input.deviceId,
    terminalId: input.terminalId,
    terminalName: input.terminalName,
  };

  try {
    let payload: any = null;
    if (Capacitor.isNativePlatform()) {
      const response = await withTimeout(
        CapacitorHttp.post({
          url,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Device-Id': input.deviceId,
            'X-POS-Device-Id': input.deviceId,
          },
          data: body,
        }),
        'ERP readiness'
      );
      payload = typeof response.data === 'string' ? JSON.parse(response.data || '{}') : response.data;
      if (response.status < 200 || response.status >= 300) {
        throw Object.assign(new Error(trim(asObject(payload).message) || `HTTP ${response.status}`), { payload });
      }
    } else {
      const response = await withTimeout(fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Device-Id': input.deviceId,
          'X-POS-Device-Id': input.deviceId,
        },
        body: JSON.stringify(body),
      }), 'ERP readiness');
      const text = await response.text();
      payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw Object.assign(new Error(trim(asObject(payload).message) || `${response.status} ${response.statusText}`), { payload });
      }
    }

    const code = normalizeBackendCode(payload?.code || payload?.reason || (payload?.ready === true ? 'OK' : payload?.status));
    const ready = payload?.ready === true || payload?.status === 'ready' || payload?.status === 'success' || code === 'OK';

    return {
      ok: ready,
      code: ready ? 'OK' : code,
      nextAction: ready ? 'none' : normalizeNextAction(payload?.nextAction || payload?.next_action),
      message: ready
        ? 'Entorno ERP listo.'
        : trim(payload?.message) || 'ERP aún no tiene el contexto operativo completo para esta terminal.',
      detail: trim(payload?.detail) || null,
      raw: payload,
    };
  } catch (error: any) {
    const payload = asObject(error?.payload);
    return {
      ok: false,
      code: normalizeBackendCode(payload.code || payload.reason),
      nextAction: normalizeNextAction(payload.nextAction || payload.next_action) || 'retry',
      message: trim(payload.message) || error?.message || 'No se pudo validar readiness contra ERP.',
      detail: trim(payload.detail) || null,
      raw: payload,
    };
  }
};

export const evaluateLocalReadiness = async (input: LocalReadinessInput): Promise<AppReadinessCheckResult> => {
  const terminal = input.terminal;
  if (!terminal?.id || !terminal.config) {
    return {
      ok: false,
      code: 'LOCAL_CONTEXT_MISSING',
      nextAction: 'retry',
      message: 'La terminal local no está configurada.',
    };
  }

  const terminalConfig = terminal.config;
  const erpBinding = terminalConfig.erpBinding || {};
  const erpTerminalId = trim(terminalConfig.erpTerminalId) || trim(erpBinding.terminalId);
  const erpTenantId = trim(erpBinding.tenantId) || trim(localStorage.getItem('clic_erp_sync_tenant_id'));
  const deviceMatches = !trim(terminalConfig.currentDeviceId) || terminalConfig.currentDeviceId === input.deviceId;

  if (!deviceMatches || !erpTerminalId || !erpTenantId) {
    return {
      ok: false,
      code: 'ERP_CONTEXT_MISSING',
      nextAction: 'retry',
      message: 'Falta mapping ERP completo para esta terminal.',
      detail: 'Se requiere terminal ERP, tenant ERP y device_id autorizado antes de vender.',
    };
  }

  const [productsRaw, sequencesRaw, paymentsRaw, fiscalRangesRaw] = await Promise.all([
    db.get('products' as any),
    db.get('internalSequences' as any),
    db.get('paymentMethods' as any),
    db.get('fiscalRanges' as any),
  ]);

  const products = Array.isArray(productsRaw) ? productsRaw as Product[] : [];
  const sequences = Array.isArray(sequencesRaw) ? sequencesRaw : [];
  const persistedPayments = Array.isArray(paymentsRaw) ? paymentsRaw : [];
  const configPayments = Array.isArray(input.config.paymentMethods) ? input.config.paymentMethods : [];
  const payments = persistedPayments.length > 0 ? persistedPayments : configPayments;
  const taxes = Array.isArray(input.config.taxes) ? input.config.taxes : [];
  const fiscalRanges = Array.isArray(fiscalRangesRaw) ? fiscalRangesRaw : [];

  if (products.length === 0) {
    return {
      ok: false,
      code: 'CATALOG_MISSING',
      nextAction: 'download_bootstrap',
      message: 'El catálogo local está vacío.',
    };
  }

  if (sequences.length === 0) {
    return {
      ok: false,
      code: 'SEQUENCE_MISSING',
      nextAction: 'download_bootstrap',
      message: 'No hay secuencias/document series locales.',
    };
  }

  if (payments.length === 0) {
    return {
      ok: false,
      code: 'PAYMENT_METHODS_MISSING',
      nextAction: 'download_bootstrap',
      message: 'No hay métodos de pago configurados localmente.',
    };
  }

  if (Number(input.config.taxRate || 0) > 0 && taxes.length === 0) {
    return {
      ok: false,
      code: 'TAXES_MISSING',
      nextAction: 'download_bootstrap',
      message: 'No hay impuestos configurados localmente.',
    };
  }

  if (terminalConfig.fiscal?.enabled && fiscalRanges.length === 0) {
    return {
      ok: false,
      code: 'SEQUENCE_MISSING',
      nextAction: 'download_bootstrap',
      message: 'No hay rangos fiscales locales para esta terminal.',
    };
  }

  return {
    ok: true,
    code: 'OK',
    nextAction: 'none',
    message: 'Readiness local completo.',
  };
};
