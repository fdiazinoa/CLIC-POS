import { Capacitor } from '@capacitor/core';
import { dbAdapter } from '../db';
import { requestJson } from '../network/httpClient';
import type { fetchInitialConfigFromErp, RuntimeInitialConfigResponse } from '../setup/erpTerminalSetup';
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
  tenantId: string;
  erpTerminalId: string;
  posDeviceId: string;
  syncToken: string;
}

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

export const createLargeMasterSyncV3CanaryTransport = (input: LargeMasterSyncV3CanaryInput): LargeMasterSyncV3Transport => ({
  async request(path, init): Promise<LargeMasterSyncV3HttpResponse> {
    const response = await requestJson({
      url: `${input.erpBaseUrl.replace(/\/+$/, '')}${path}`,
      method: init.method,
      headers: buildLargeMasterSyncV3CanaryHeaders(input),
      signal: init.signal,
      timeoutMs: 30_000,
      diagnosticContext: { scope: 'SYNC_V3_CANARY', path },
    });
    return {
      status: response.status,
      headers: response.headers,
      text: response.text || JSON.stringify(response.data ?? {}),
    };
  },
});

type CanaryDependencies = {
  enabled?: boolean;
  fetchInitialConfig: typeof fetchInitialConfigFromErp;
  getStore: () => Promise<LargeMasterSyncV3Store | undefined>;
  createClient: (store: LargeMasterSyncV3Store, input: LargeMasterSyncV3CanaryInput,
    onMetric?: (metric: LargeMasterSyncV3Metric) => void) => Pick<LargeMasterSyncV3Client, 'requestSync' | 'resumeSync'>;
};

const defaultDependencies: CanaryDependencies = {
  fetchInitialConfig: async input => {
    const { fetchInitialConfigFromErp } = await import('../setup/erpTerminalSetup');
    return fetchInitialConfigFromErp(input);
  },
  async getStore() {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      throw new Error('El canario V3 requiere Android nativo. No se iniciaron ventas.');
    }
    await dbAdapter.connect();
    return dbAdapter.masterSyncV3Store;
  },
  createClient(store, input, onMetric) {
    return new LargeMasterSyncV3Client({
      store,
      transport: createLargeMasterSyncV3CanaryTransport(input),
      metric: onMetric,
    });
  },
};

export const runLargeMasterSyncV3Canary = async (
  input: LargeMasterSyncV3CanaryInput,
  onMetric?: (metric: LargeMasterSyncV3Metric) => void,
  dependencies: CanaryDependencies = defaultDependencies,
): Promise<LargeMasterSyncV3CanaryResult> => {
  if (!(dependencies.enabled ?? LARGE_MASTER_SYNC_V3_CANARY)) throw new Error('SYNC_V3_CANARY_DISABLED');
  if (!input.erpBaseUrl || !input.tenantId || !input.erpTerminalId || !input.posDeviceId || !input.syncToken.trim()) {
    throw new Error('Faltan URL ERP, tenant, terminal, device o syncToken para el canario V3.');
  }
  const bootstrap: RuntimeInitialConfigResponse = await dependencies.fetchInitialConfig({
    erpBaseUrl: input.erpBaseUrl,
    tenantId: input.tenantId,
    erpTerminalId: input.erpTerminalId,
    posDeviceId: input.posDeviceId,
    canaryV3: true,
  });
  if (!bootstrap.success) throw new Error('El ERP rechazó la configuración inicial del canario.');
  if (bootstrap.bootstrapProtocol !== 'v3' || bootstrap.masterSync?.protocol !== 'v3') {
    return { status: 'legacy-fallback' };
  }
  const store = await dependencies.getStore();
  if (!store) throw new Error('SYNC_V3_NATIVE_STORE_UNAVAILABLE');
  const client = dependencies.createClient(store, input, onMetric);
  const requested = await client.requestSync();
  if ('fallback' in requested) return { status: 'legacy-fallback' };
  const activated = await client.resumeSync(requested.syncId);
  return { status: 'complete', syncId: activated.syncId, syncVersion: activated.syncVersion };
};
