import type { BusinessConfig } from '../../types';
import { readOperationalTerminalBinding } from './OperationalTerminalConfig';
import { resolveSyncTarget } from './SyncProfile';
import { largeMasterSyncV3DownloadOrigin } from './LargeMasterSyncV3DownloadOrigin';
import { validatedLargeMasterSyncV3ErpSyncBase } from './LargeMasterSyncV3BoundTransport';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

const brand: unique symbol = Symbol('V3ConfigRefreshAuthority');
export type V3ConfigRefreshAuthority = Readonly<{
  [brand]: true;
  localTerminalId: string;
  assertCurrent(config: BusinessConfig): void;
}>;
const changed = (): never => { throw new LargeMasterSyncV3Error('SYNC_V3_REFRESH_AUTHORITY_CHANGED'); };
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** Pure canonical reads only: never normalize/migrate credentials, repair profiles or renew tokens.
 * The credential fingerprint remains private in this closure; never serialize/log it. */
export function captureLargeMasterSyncV3ConfigRefreshAuthority(config: BusinessConfig): V3ConfigRefreshAuthority {
  const read = () => {
    try {
      const credentials = JSON.parse(localStorage.getItem('clic_terminal_credentials_v1') || 'null');
      const profile = JSON.parse(localStorage.getItem('clic_sync_profile') || 'null');
      if (!credentials || !profile || credentials.identityMigrationRequired
        || /DEVICE_NOT_AUTHORIZED|NEEDS_REAUTH|BOUND_AUTH_MISMATCH|AUTH_ERROR|REVOKED/i.test(
          `${credentials.authStatus || ''} ${localStorage.getItem('clic_sync_auth_status') || ''}`)) return changed();
      const identity = [credentials.erpTenantId || credentials.tenantId, credentials.companyId, credentials.storeId,
        credentials.erpTerminalId || credentials.terminalId, credentials.deviceId].map(text);
      if (identity.some(value => !value) || !text(credentials.syncToken) || /[\r\n]/.test(credentials.syncToken)) return changed();
      const keys = ['clic_erp_sync_tenant_id', 'clic_erp_sync_company_id', 'clic_erp_sync_store_id',
        'clic_erp_sync_terminal_id', 'CLIC_POS_DEVICE_ID'];
      if (keys.some((key, index) => {
        const mirror = localStorage.getItem(key);
        return mirror && mirror !== identity[index];
      }) || localStorage.getItem('CLIC_POS_DEVICE_ID') !== identity[4]) return changed();
      const target = resolveSyncTarget(profile);
      if (target.kind !== 'ERP_ACTIVE' || target.useLocalTarget || !target.canPullMasters
        || target.terminalId !== identity[3] || !target.baseUrl) return changed();
      return { identity, fingerprint: JSON.stringify([identity, readOperationalTerminalBinding(),
        validatedLargeMasterSyncV3ErpSyncBase(target.baseUrl), largeMasterSyncV3DownloadOrigin()]) };
    } catch { return changed(); }
  };
  const captured = read();
  const select = (value: BusinessConfig) => {
    const [tenantId, companyId, storeId, terminalId, deviceId] = captured.identity;
    const matches = value?.terminals?.filter(row => row.config?.erpBinding?.tenantId === tenantId
      && row.config.erpBinding.companyId === companyId && row.config.erpBinding.storeId === storeId
      && (row.config.erpTerminalId || row.id) === terminalId && row.config.currentDeviceId === deviceId);
    if (matches?.length !== 1 || !matches[0].id) return changed();
    return matches[0].id;
  };
  const localTerminalId = select(config);
  return Object.freeze({ [brand]: true as const, localTerminalId,
    assertCurrent(current: BusinessConfig) {
      if (read().fingerprint !== captured.fingerprint || select(current) !== localTerminalId) changed();
    } });
}
