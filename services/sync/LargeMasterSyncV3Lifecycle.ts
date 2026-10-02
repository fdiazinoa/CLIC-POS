import type { LargeMasterSyncV3Store } from './LargeMasterSyncV3Types';
import { LargeMasterSyncV3Runtime } from './LargeMasterSyncV3Runtime';

/**
 * Deliberately compile-time dark. Enabling the receiver later requires a
 * separate reviewed change after device/performance gates and capability work.
 */
export const LARGE_MASTER_SYNC_V3_RECEIVER_ENABLED = false as boolean;

let store: LargeMasterSyncV3Store | null = null;
let runtime: LargeMasterSyncV3Runtime | null = null;
let installed = false;

const refreshRuntime = async (): Promise<LargeMasterSyncV3Runtime | null> => {
  if (!LARGE_MASTER_SYNC_V3_RECEIVER_ENABLED || !store) return null;
  const prepared = await LargeMasterSyncV3Runtime.open(store);
  runtime = prepared;
  return runtime;
};

const handleResume = (): void => {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  void refreshRuntime().catch(error => {
    console.warn('[SYNC_V3_DARK_RUNTIME_RESUME_FAILED]', { code: (error as { code?: string })?.code || 'UNKNOWN' });
  });
};

export const bootstrapLargeMasterSyncV3Lifecycle = async (
  candidateStore?: LargeMasterSyncV3Store,
): Promise<{ enabled: boolean; runtime: LargeMasterSyncV3Runtime | null }> => {
  if (!LARGE_MASTER_SYNC_V3_RECEIVER_ENABLED) return { enabled: false, runtime: null };
  if (!candidateStore) throw new Error('SYNC_V3_NATIVE_STORE_UNAVAILABLE');
  store = candidateStore;
  await refreshRuntime();
  if (!installed && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleResume);
    installed = true;
  }
  return { enabled: true, runtime };
};

export const getLargeMasterSyncV3Runtime = (): LargeMasterSyncV3Runtime | null => runtime;

export const refreshLargeMasterSyncV3RuntimeAfterActivation = async (): Promise<LargeMasterSyncV3Runtime | null> => {
  if (!LARGE_MASTER_SYNC_V3_RECEIVER_ENABLED) return null;
  return refreshRuntime();
};

export const resetLargeMasterSyncV3LifecycleForTests = (): void => {
  if (installed && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleResume);
  }
  installed = false;
  store = null;
  runtime = null;
};
