import type { BusinessConfig } from '../types';
import { loadSyncProfile, restoreClientMasterUrl, updateClientMasterUrl } from '../services/sync/SyncProfile';
import { awaitTerminalCredentialWrites, readTerminalCredentialsSync, saveTerminalCredentialsSync } from '../services/sync/TerminalCredentialStore';

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
let asyncMasterTargetSequence = 0;
let asyncMasterTargetReservation = 0;
let asyncMasterTargetOwner = 0;

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
    restoreProfile?: (url: string | null) => boolean;
  } = {},
): (() => void) => {
  const storage = dependencies.storage || localStorage;
  const persistProfile = dependencies.persistProfile || updateClientMasterUrl;
  const restoreProfile = dependencies.restoreProfile
    || (dependencies.persistProfile
      ? (url: string | null) => url ? dependencies.persistProfile!(url) : true
      : restoreClientMasterUrl);
  const normalizedUrl = new URL(baseUrl).origin;
  const nextHost = new URL(normalizedUrl).hostname;
  const previousUrl = storage.getItem('CLIC_POS_MASTER_URL');
  const previousHost = storage.getItem('pos_master_ip');
  const rollback = () => {
    restore(storage, 'CLIC_POS_MASTER_URL', previousUrl);
    restore(storage, 'pos_master_ip', previousHost);
    if (!dependencies.storage) saveTerminalCredentialsSync({ masterUrl: previousUrl, masterIp: previousHost });
    restoreProfile(previousUrl);
  };

  try {
    storage.setItem('CLIC_POS_MASTER_URL', normalizedUrl);
    storage.setItem('pos_master_ip', nextHost);
    if (!dependencies.storage) saveTerminalCredentialsSync({ masterUrl: normalizedUrl, masterIp: nextHost });
    if (!persistProfile(normalizedUrl)) throw new Error('MASTER_SYNC_PROFILE_PERSIST_FAILED');
    return rollback;
  } catch (error) {
    let mirrorsRestored = false;
    try {
      restore(storage, 'CLIC_POS_MASTER_URL', previousUrl);
      restore(storage, 'pos_master_ip', previousHost);
      if (!dependencies.storage) saveTerminalCredentialsSync({ masterUrl: previousUrl, masterIp: previousHost });
      mirrorsRestored = true;
    } catch {
      // The fail-closed cleanup below removes any partially changed mirrors.
    }
    const profileRestored = restoreProfile(previousUrl);
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

export const persistValidatedClientMasterTargetAsync = async (
  baseUrl: string,
): Promise<() => Promise<void>> => {
  const previousReservation = asyncMasterTargetReservation;
  const previousOwner = asyncMasterTargetOwner;
  const generation = ++asyncMasterTargetSequence;
  asyncMasterTargetReservation = generation;
  const normalizedUrl = new URL(baseUrl).origin;
  const nextHost = new URL(normalizedUrl).hostname;
  let rollback: (() => void) | null = null;
  try {
    rollback = persistValidatedClientMasterTarget(normalizedUrl);
    await awaitTerminalCredentialWrites();
  } catch (error) {
    if (asyncMasterTargetReservation === generation) {
      asyncMasterTargetReservation = previousReservation;
      asyncMasterTargetOwner = previousOwner;
    }
    throw error;
  }
  if (asyncMasterTargetReservation === generation) asyncMasterTargetOwner = generation;
  return async () => {
    const credentials = readTerminalCredentialsSync();
    const ownsMirrors = generation === asyncMasterTargetReservation
      && generation === asyncMasterTargetOwner
      && localStorage.getItem('CLIC_POS_MASTER_URL') === normalizedUrl
      && localStorage.getItem('pos_master_ip') === nextHost
      && loadSyncProfile().masterUrl === normalizedUrl
      && credentials.masterUrl === normalizedUrl
      && credentials.masterIp === nextHost;
    if (!ownsMirrors) return;
    asyncMasterTargetReservation = ++asyncMasterTargetSequence;
    asyncMasterTargetOwner = 0;
    rollback();
    await awaitTerminalCredentialWrites();
  };
};
