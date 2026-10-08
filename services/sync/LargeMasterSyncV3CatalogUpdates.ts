import { waitForLargeMasterSyncV3OperationalWindow } from './LargeMasterSyncV3OperationGate';

/** Invalidate mounted readers only when their operational boundary can safely change. */
export const subscribeLargeMasterSyncV3CatalogUpdates = (
  refresh: () => void, deferForOperations = false, target: EventTarget = window,
): (() => void) => {
  const controller = new AbortController();
  const receive = () => {
    if (!deferForOperations) { refresh(); return; }
    void waitForLargeMasterSyncV3OperationalWindow(controller.signal).then(() => {
      if (!controller.signal.aborted) refresh();
    }).catch(() => { /* Unmount cancels deferred notification. */ });
  };
  target.addEventListener('v3CatalogUpdated', receive);
  return () => { controller.abort(); target.removeEventListener('v3CatalogUpdated', receive); };
};
