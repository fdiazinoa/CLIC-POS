import { Capacitor } from '@capacitor/core';
import { dbAdapter } from '../db';
import {
  LargeMasterSyncV3Client,
  type LargeMasterSyncV3HttpResponse,
  type LargeMasterSyncV3Metric,
  type LargeMasterSyncV3Transport,
} from './LargeMasterSyncV3Client';
import type { LargeMasterSyncV3Store } from './LargeMasterSyncV3Types';

/** This build is non-operational: AppContent is never mounted while this flag is on. */
export const LARGE_MASTER_SYNC_V3_CANARY = import.meta.env?.VITE_LARGE_MASTER_SYNC_V3_CANARY === 'true';

export interface LargeMasterSyncV3CanaryInput {
  erpBaseUrl: string;
  v3BaseUrl: string;
  tenantId: string;
  erpTerminalId: string;
  posDeviceId: string;
  syncToken: string;
}

export const assertLargeMasterSyncV3CanaryEmulator = (): void => {
  const bridge = (globalThis as typeof globalThis & {
    ClicPOSAppBridge?: { isEmulator?: () => boolean };
  }).ClicPOSAppBridge;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android' || bridge?.isEmulator?.() !== true) {
    throw new Error('SYNC_V3_CANARY_EMULATOR_REQUIRED');
  }
};

export const validateLargeMasterSyncV3CanaryUrl = (value: string): string => {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('SYNC_V3_CANARY_HTTPS_REQUIRED'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('SYNC_V3_CANARY_HTTPS_REQUIRED');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('SYNC_V3_CANARY_BASE_URL_INVALID');
  }
  return url.origin;
};

export type LargeMasterSyncV3CanaryResult =
  | { status: 'legacy-fallback' }
  | { status: 'complete'; syncId: string; syncVersion: number };

export const buildLargeMasterSyncV3CanaryHeaders = (input: LargeMasterSyncV3CanaryInput): Record<string, string> => ({
  Accept: 'application/json',
  'X-Sync-Token': input.syncToken.trim(),
  'X-POS-Capabilities': 'largeMasterSyncV3',
  'X-Device-Id': input.posDeviceId.trim(),
  'X-POS-Device-Id': input.posDeviceId.trim(),
  'X-Terminal-Id': input.erpTerminalId.trim(),
});

export const createLargeMasterSyncV3CanaryTransport = (
  input: LargeMasterSyncV3CanaryInput,
  fetchImpl: typeof fetch = fetch,
): LargeMasterSyncV3Transport => ({
  async request(path, init): Promise<LargeMasterSyncV3HttpResponse> {
    if (!/^\/api\/sync\/v3\/master-syncs(?:\/[A-Za-z0-9_-]+)*$/.test(path)) {
      throw new Error('SYNC_V3_CANARY_PATH_INVALID');
    }
    // V3 chunk checksums cover the exact JSON text; native HTTP may reserialize JSON data.
    const response = await fetchImpl(`${validateLargeMasterSyncV3CanaryUrl(input.v3BaseUrl)}${path}`, {
      method: init.method,
      headers: buildLargeMasterSyncV3CanaryHeaders(input),
      signal: init.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      text: await response.text(),
    };
  },
});

type CanaryDependencies = {
  enabled?: boolean;
  assertEmulator?: () => void;
  getStore: () => Promise<LargeMasterSyncV3Store | undefined>;
  createNegotiator: (input: LargeMasterSyncV3CanaryInput,
    onMetric?: (metric: LargeMasterSyncV3Metric) => void) => Pick<LargeMasterSyncV3Client, 'requestSync'>;
  createClient: (store: LargeMasterSyncV3Store, input: LargeMasterSyncV3CanaryInput,
    onMetric?: (metric: LargeMasterSyncV3Metric) => void) => Pick<LargeMasterSyncV3Client, 'requestSync' | 'resumeSync'>;
};

const defaultDependencies: CanaryDependencies = {
  assertEmulator: assertLargeMasterSyncV3CanaryEmulator,
  async getStore() {
    await dbAdapter.connect();
    return dbAdapter.masterSyncV3Store;
  },
  createNegotiator(input, onMetric) {
    return new LargeMasterSyncV3Client({
      transport: createLargeMasterSyncV3CanaryTransport(input),
      metric: onMetric,
    });
  },
  createClient(store, input, onMetric) {
    return new LargeMasterSyncV3Client({
      store,
      transport: createLargeMasterSyncV3CanaryTransport(input),
      metric: onMetric,
      downloadConcurrency: 2,
    });
  },
};

export const runLargeMasterSyncV3Canary = async (
  input: LargeMasterSyncV3CanaryInput,
  onMetric?: (metric: LargeMasterSyncV3Metric) => void,
  dependencies: CanaryDependencies = defaultDependencies,
): Promise<LargeMasterSyncV3CanaryResult> => {
  if (!(dependencies.enabled ?? LARGE_MASTER_SYNC_V3_CANARY)) throw new Error('SYNC_V3_CANARY_DISABLED');
  (dependencies.assertEmulator ?? assertLargeMasterSyncV3CanaryEmulator)();
  if (!input.erpBaseUrl || !input.v3BaseUrl || !input.tenantId || !input.erpTerminalId || !input.posDeviceId || !input.syncToken.trim()) {
    throw new Error('Faltan URL ERP, URL Sync V3, tenant, terminal, device o syncToken para el canario V3.');
  }
  const erpBaseUrl = validateLargeMasterSyncV3CanaryUrl(input.erpBaseUrl);
  const v3BaseUrl = validateLargeMasterSyncV3CanaryUrl(input.v3BaseUrl);
  // Negotiate before opening SQLite. Calling initial-config first can legally
  // fall back to the legacy full catalog, which defeats this no-sales canary.
  const normalizedInput = { ...input, erpBaseUrl, v3BaseUrl };
  const requested = await dependencies.createNegotiator(normalizedInput, onMetric).requestSync();
  if ('fallback' in requested) return { status: 'legacy-fallback' };
  const store = await dependencies.getStore();
  if (!store) throw new Error('SYNC_V3_NATIVE_STORE_UNAVAILABLE');
  const client = dependencies.createClient(store, normalizedInput, onMetric);
  const incomplete = await store.findIncomplete();
  if (incomplete && (incomplete.syncId !== requested.syncId
    || incomplete.syncVersion !== requested.syncVersion)) {
    throw new Error('SYNC_V3_STAGING_CONFLICT: la descarga pendiente no coincide con la sesión vigente del ERP; no se borró ni reemplazó.');
  }
  const syncId = requested.syncId;
  let activated;
  try {
    activated = await client.resumeSync(syncId);
  } catch (error) {
    if ((error as { code?: string })?.code === 'SYNC_V3_STAGING_CONFLICT') {
      throw new Error('SYNC_V3_STAGING_CONFLICT: existe otra descarga en SQLite; no se borró ni reemplazó.');
    }
    throw error;
  }
  return { status: 'complete', syncId: activated.syncId, syncVersion: activated.syncVersion };
};
