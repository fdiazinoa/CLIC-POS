import type { BusinessConfig } from '../types';
import { updateClientMasterUrl } from '../services/sync/SyncProfile';

const value = (input: unknown): string => String(input || '').trim();

export const resolveClientMasterTerminalId = (
  config: BusinessConfig,
  localTerminalIds: Array<string | null | undefined>,
  candidates: Array<string | null | undefined> = [],
): string | undefined => {
  const localIds = new Set(localTerminalIds.map(value).filter(Boolean));
  const primary = (config.terminals || []).find(terminal => terminal?.config?.isPrimaryNode === true);
  if (!primary) return undefined;
  const primaryIds = new Set([
    primary.config?.erpTerminalId,
    primary.id,
  ].map(value).filter(Boolean));
  const corroboratedCandidate = candidates.map(value).find(candidate => primaryIds.has(candidate));

  return [corroboratedCandidate, primary.config?.erpTerminalId, primary.id]
    .map(value)
    .find(candidate => candidate && primaryIds.has(candidate) && !localIds.has(candidate));
};

type MasterTargetStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const restore = (storage: MasterTargetStorage, key: string, previous: string | null) => {
  if (previous === null) storage.removeItem(key);
  else storage.setItem(key, previous);
};

/** Mirrors a validated Master as one logical operation. Any profile/storage
 * failure restores the previous mirrors and profile target before failing. */
export const persistValidatedClientMasterTarget = (
  baseUrl: string,
  dependencies: {
    storage?: MasterTargetStorage;
    persistProfile?: (url: string) => boolean;
  } = {},
): void => {
  const storage = dependencies.storage || localStorage;
  const persistProfile = dependencies.persistProfile || updateClientMasterUrl;
  const normalizedUrl = new URL(baseUrl).origin;
  const nextHost = new URL(normalizedUrl).hostname;
  const previousUrl = storage.getItem('CLIC_POS_MASTER_URL');
  const previousHost = storage.getItem('pos_master_ip');

  try {
    storage.setItem('CLIC_POS_MASTER_URL', normalizedUrl);
    storage.setItem('pos_master_ip', nextHost);
    if (!persistProfile(normalizedUrl)) throw new Error('MASTER_SYNC_PROFILE_PERSIST_FAILED');
  } catch (error) {
    let mirrorsRestored = false;
    try {
      restore(storage, 'CLIC_POS_MASTER_URL', previousUrl);
      restore(storage, 'pos_master_ip', previousHost);
      mirrorsRestored = true;
    } catch {
      // The fail-closed cleanup below removes any partially changed mirrors.
    }
    const profileRestored = previousUrl ? persistProfile(previousUrl) : true;
    if (!mirrorsRestored || !profileRestored) {
      try {
        storage.removeItem('CLIC_POS_MASTER_URL');
        storage.removeItem('pos_master_ip');
      } catch {
        // Storage is unavailable; the caller still fails and cannot publish the target.
      }
    }
    throw error;
  }
};
