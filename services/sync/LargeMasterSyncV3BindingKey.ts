import type { LargeMasterSyncV3BoundIdentity } from './LargeMasterSyncV3BoundTransport';
import { validateLargeMasterSyncV3CanaryUrl } from './LargeMasterSyncV3Canary';

export const v3BindingKey = (identity: Omit<LargeMasterSyncV3BoundIdentity, 'syncToken'>, v3BaseUrl: string): string =>
  JSON.stringify([identity.tenantId, identity.terminalId, identity.deviceId,
    identity.erpSyncBaseUrl, validateLargeMasterSyncV3CanaryUrl(v3BaseUrl)]);
