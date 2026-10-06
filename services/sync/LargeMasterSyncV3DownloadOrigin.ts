import { validateLargeMasterSyncV3CanaryUrl } from './LargeMasterSyncV3Canary';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';
import { assertLargeMasterSyncV3IncomingConfigMasters } from './LargeMasterSyncV3ConfigPayload';

/** Download authority is explicit; it never replaces the stored authentication authority. */
export const largeMasterSyncV3DownloadOrigin = (
  value: string | undefined = import.meta.env?.VITE_LARGE_MASTER_SYNC_V3_BASE_URL,
): string => {
  if (!value?.trim()) throw new LargeMasterSyncV3Error('SYNC_V3_BASE_URL_REQUIRED');
  return validateLargeMasterSyncV3CanaryUrl(value);
};

export interface LargeMasterSyncV3SetupContract {
  bootstrapProtocol?: 'v3' | 'legacy';
  masterSync?: Record<string, unknown>;
  downloadOrigin?: string;
}

export const assertLargeMasterSyncV3SetupContract = (value: LargeMasterSyncV3SetupContract): string => {
  const descriptor = value.masterSync;
  if (value.bootstrapProtocol !== 'v3' || descriptor?.protocol !== 'v3'
    || descriptor.required !== true || descriptor.schemaVersion !== 3
    || !Number.isSafeInteger(descriptor.contractVersion) || Number(descriptor.contractVersion) < 2
    || descriptor.createUrl !== '/api/sync/v3/master-syncs') {
    throw new LargeMasterSyncV3Error('SYNC_V3_SETUP_CONTRACT_REQUIRED');
  }
  return largeMasterSyncV3DownloadOrigin(value.downloadOrigin);
};

/** Validate raw identity before the legacy normalizer can supply missing identity fields. */
export const assertLargeMasterSyncV3Bootstrap = (payload: Record<string, any>,
  identity: { tenantId: string; erpTerminalId: string; posDeviceId?: string }, downloadOrigin: string): void => {
  assertLargeMasterSyncV3SetupContract({ ...payload, downloadOrigin });
  assertLargeMasterSyncV3ConfigPayload(payload, identity, {
    fullSnapshot: true, masterScopes: ['pos_users', 'pos_roles'], resolvedScopes: ['inventory', 'documents'],
  });
};

/** Config/manifest lifecycle has no bootstrap descriptor; the raw scoped snapshot remains mandatory. */
export const assertLargeMasterSyncV3ConfigPayload = (payload: Record<string, any>,
  identity: { tenantId: string; erpTerminalId: string; posDeviceId?: string },
  scopes?: { fullSnapshot?: boolean; masterScopes?: readonly string[] | null; resolvedScopes?: readonly string[] | null }): void => {
  const snapshot = payload.terminal_config ?? payload;
  const object = (value: unknown) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  if (payload.success === false || (payload.status && payload.status !== 'success')
    || !object(snapshot) || ['config', 'masters', 'resolved'].some(key =>
      (scopes?.fullSnapshot || snapshot[key] !== undefined) && !object(snapshot[key]))) {
    throw new LargeMasterSyncV3Error('SYNC_V3_SETUP_SNAPSHOT_REQUIRED');
  }
  const arrays: Array<[boolean, unknown]> = [
    [Boolean(scopes?.masterScopes?.some(scope => ['pos_users', 'users'].includes(scope))), snapshot.masters?.pos_users],
    [Boolean(scopes?.masterScopes?.some(scope => ['pos_roles', 'roles'].includes(scope))), snapshot.masters?.pos_roles],
    [Boolean(scopes?.resolvedScopes?.includes('inventory')), snapshot.resolved?.inventory?.warehouses],
    [Boolean(scopes?.resolvedScopes?.includes('documents')), snapshot.resolved?.documents?.document_series],
    [Boolean(scopes?.resolvedScopes?.includes('documents')), snapshot.resolved?.documents?.fiscal_ranges],
  ];
  if (arrays.some(([required, value]) => (required || value !== undefined) && !Array.isArray(value))) {
    throw new LargeMasterSyncV3Error('SYNC_V3_SETUP_SNAPSHOT_REQUIRED');
  }
  if (snapshot.tenant_id !== identity.tenantId || snapshot.terminal_id !== identity.erpTerminalId
    || (identity.posDeviceId && snapshot.device_id && snapshot.device_id !== identity.posDeviceId)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_SETUP_IDENTITY_MISMATCH');
  }
  const tenantIds = [payload.tenant_id, snapshot.tenant_id].filter(value => value !== undefined);
  const terminalIds = [payload.erp_terminal_id, payload.terminal_id,
    snapshot.erp_terminal_id, snapshot.terminal_id].filter(value => value !== undefined);
  if (!tenantIds.length || !terminalIds.length
    || tenantIds.some(value => value !== identity.tenantId)
    || terminalIds.some(value => value !== identity.erpTerminalId)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_SETUP_IDENTITY_MISMATCH');
  }
  for (const record of [payload.terminal, snapshot.resolved?.identity, snapshot.resolved?.terminal]) {
    if (!record || typeof record !== 'object') continue;
    if ([record.tenant_id].some(value => value !== undefined && value !== identity.tenantId)
      || [record.id, record.terminal_id, record.erp_terminal_id]
        .some(value => value !== undefined && value !== identity.erpTerminalId)
      || (identity.posDeviceId && record.device_id && record.device_id !== identity.posDeviceId)) {
      throw new LargeMasterSyncV3Error('SYNC_V3_SETUP_IDENTITY_MISMATCH');
    }
  }
  assertLargeMasterSyncV3IncomingConfigMasters(payload, 'ERP_ACTIVE', true);
};
