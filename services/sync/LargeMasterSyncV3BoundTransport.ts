import { resolveLocalDeviceId } from '../../utils/deviceRevocation';
import { isTerminalAuthorizationSuperseded } from '../../utils/terminalAuthorizationGuard';
import { readTerminalCredentialsSync } from './TerminalCredentialStore';
import { resolveSyncTarget } from './SyncProfile';
import { LargeMasterSyncV3Client, type LargeMasterSyncV3ClientOptions,
  type LargeMasterSyncV3Transport } from './LargeMasterSyncV3Client';
import { LargeMasterSyncV3Error, type LargeMasterSyncV3Store } from './LargeMasterSyncV3Types';

export interface LargeMasterSyncV3BoundIdentity {
  erpSyncBaseUrl: string;
  tenantId: string;
  terminalId: string;
  deviceId: string;
  syncToken: string;
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const V3_ROOT = '/api/sync/v3/master-syncs';
const V3_READ_PATH = new RegExp(`^${V3_ROOT}/${UUID}/(?:manifest|datasets/(?:taxes|tariffs|articles|variants|barcodes|prices)/chunks/(?:0|[1-9][0-9]*))$`);
const validPath = (path: string, method: 'GET' | 'POST'): boolean =>
  method === 'POST' ? path === V3_ROOT : V3_READ_PATH.test(path);
const normalized = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const origin = (value: string): string => {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new LargeMasterSyncV3Error('SYNC_V3_ORIGIN_INVALID'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || parsed.pathname !== '/') {
    throw new LargeMasterSyncV3Error('SYNC_V3_ORIGIN_INVALID');
  }
  return parsed.origin;
};

export const validatedLargeMasterSyncV3ErpSyncBase = (value: string): string => {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new LargeMasterSyncV3Error('SYNC_V3_ERP_ORIGIN_INVALID'); }
  if (parsed.pathname.replace(/\/+$/, '') !== '/api/sync' || parsed.search || parsed.hash) {
    throw new LargeMasterSyncV3Error('SYNC_V3_ERP_ORIGIN_INVALID');
  }
  try { origin(`${parsed.origin}/`); } catch { throw new LargeMasterSyncV3Error('SYNC_V3_ERP_ORIGIN_INVALID'); }
  return `${parsed.origin}/api/sync`;
};

/** Read only: this path never calls register/reauth or changes pairing. */
export const readLargeMasterSyncV3BoundIdentity = (): LargeMasterSyncV3BoundIdentity => {
  const target = resolveSyncTarget();
  if (target.kind !== 'ERP_ACTIVE' || target.useLocalTarget || !target.canPullMasters
    || !target.baseUrl || !target.terminalId || isTerminalAuthorizationSuperseded()) {
    throw new LargeMasterSyncV3Error('SYNC_V3_ERP_BINDING_REQUIRED');
  }
  const credentials = readTerminalCredentialsSync();
  const terminalId = normalized(credentials.erpTerminalId || credentials.terminalId);
  const tenantId = normalized(credentials.erpTenantId || credentials.tenantId);
  const deviceId = normalized(credentials.deviceId);
  const localDeviceId = normalized(resolveLocalDeviceId());
  const syncToken = normalized(credentials.syncToken);
  if (credentials.identityMigrationRequired || terminalId !== target.terminalId
    || !tenantId || !deviceId || deviceId !== localDeviceId || !syncToken
    || ['DEVICE_NOT_AUTHORIZED', 'NEEDS_REAUTH', 'BOUND_AUTH_MISMATCH', 'AUTH_ERROR'].includes(
      normalized(credentials.authStatus).toUpperCase())) {
    throw new LargeMasterSyncV3Error('SYNC_V3_ERP_BINDING_REQUIRED');
  }
  return { erpSyncBaseUrl: target.baseUrl, tenantId, terminalId, deviceId, syncToken };
};

/** Exact-byte direct transport; no proxy, redirect, legacy fallback or token refresh. */
export const createLargeMasterSyncV3BoundTransport = (
  v3BaseUrl: string,
  readIdentity: () => LargeMasterSyncV3BoundIdentity = readLargeMasterSyncV3BoundIdentity,
  fetchImpl: typeof fetch = fetch,
): LargeMasterSyncV3Transport => {
  const v3Origin = origin(v3BaseUrl);
  const bound = readIdentity();
  const erpBase = validatedLargeMasterSyncV3ErpSyncBase(bound.erpSyncBaseUrl);
  if (!bound.tenantId || !bound.terminalId || !bound.deviceId || !bound.syncToken
    || /[\r\n]/.test(bound.syncToken)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_ERP_BINDING_REQUIRED');
  }
  const fingerprint = [erpBase, bound.tenantId, bound.terminalId, bound.deviceId, bound.syncToken].join('\u0000');
  const assertStillBound = (): void => {
    const current = readIdentity();
    const currentErpBase = validatedLargeMasterSyncV3ErpSyncBase(current.erpSyncBaseUrl);
    if ([currentErpBase, current.tenantId, current.terminalId, current.deviceId, current.syncToken].join('\u0000') !== fingerprint) {
      throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
    }
  };
  return {
    async request(path, init) {
      if (!validPath(path, init.method)) throw new LargeMasterSyncV3Error('SYNC_V3_PATH_INVALID');
      assertStillBound();
      const response = await fetchImpl(`${v3Origin}${path}`, {
        method: init.method,
        headers: {
          Accept: 'application/json',
          'X-Sync-Token': bound.syncToken,
          'X-POS-Capabilities': 'largeMasterSyncV3',
          'X-Tenant-Id': bound.tenantId,
          'X-Terminal-Id': bound.terminalId,
          'X-Device-Id': bound.deviceId,
          'X-POS-Device-Id': bound.deviceId,
        },
        signal: init.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
      const rawText = await response.text();
      assertStillBound();
      return { status: response.status,
        headers: Object.fromEntries(response.headers.entries()), text: rawText };
    },
  };
};

/** Future lifecycle entry point: strict V2 contract is inseparable from the bound transport. */
export const createLargeMasterSyncV3BoundClient = (
  store: LargeMasterSyncV3Store,
  v3BaseUrl: string,
  options: Pick<LargeMasterSyncV3ClientOptions, 'metric' | 'storageStats'> = {},
  readIdentity: () => LargeMasterSyncV3BoundIdentity = readLargeMasterSyncV3BoundIdentity,
  fetchImpl: typeof fetch = fetch,
): LargeMasterSyncV3Client => new LargeMasterSyncV3Client({
  ...options,
  store,
  transport: createLargeMasterSyncV3BoundTransport(v3BaseUrl, readIdentity, fetchImpl),
  requireOperationalContract: true,
  downloadConcurrency: 2,
});
