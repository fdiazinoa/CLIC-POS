import type { CloudChannel } from './SyncProfile';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

/** Deliberately dark until the complete POS sale-read boundary is wired. */
export const LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED = false as boolean;

/** Legacy collection endpoints replaced by contract-v2 V3 datasets. */
const V3_REPLACED_ERP_MASTERS = new Set([
  'products', 'items', 'priceLists', 'productPrices', 'taxes',
]);

export const usesLargeMasterSyncV3Authority = (
  channel: CloudChannel,
  candidateEnabled = LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,
): boolean => candidateEnabled && channel === 'ERP_ACTIVE';

export const isLargeMasterSyncV3ReplacedCollection = (collection: string): boolean =>
  V3_REPLACED_ERP_MASTERS.has(collection);

export const assertLegacyMasterPullAllowed = (
  collection: string,
  channel: CloudChannel,
  candidateEnabled = LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,
): void => {
  if (usesLargeMasterSyncV3Authority(channel, candidateEnabled)
    && isLargeMasterSyncV3ReplacedCollection(collection)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_LEGACY_MASTER_FORBIDDEN',
      `V3 no permite descargar el maestro legacy ${collection}`);
  }
};
