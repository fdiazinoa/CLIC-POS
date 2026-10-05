import { POS_SALE_ACTIVITY_EVENT, isPosSaleActive } from '../../utils/posSaleActivity';

export type LargeMasterSyncV3CriticalOperation = 'PAYMENT' | 'PRINT';

const activeOperations = new Map<LargeMasterSyncV3CriticalOperation, number>();
const listeners = new Set<() => void>();

export const setLargeMasterSyncV3CriticalOperation = (
  operation: LargeMasterSyncV3CriticalOperation,
  active: boolean,
): void => {
  const count = activeOperations.get(operation) || 0;
  if (active) activeOperations.set(operation, count + 1);
  else if (count <= 1) activeOperations.delete(operation);
  else activeOperations.set(operation, count - 1);
  listeners.forEach(listener => listener());
};

export const runWithLargeMasterSyncV3CriticalOperation = async <T>(
  operation: LargeMasterSyncV3CriticalOperation,
  task: () => Promise<T>,
): Promise<T> => {
  setLargeMasterSyncV3CriticalOperation(operation, true);
  try {
    return await task();
  } finally {
    setLargeMasterSyncV3CriticalOperation(operation, false);
  }
};

export const waitForLargeMasterSyncV3OperationalWindow = async (signal?: AbortSignal): Promise<number> => {
  const startedAt = performance.now();
  const abortError = () => new DOMException('Request aborted', 'AbortError');
  while (isPosSaleActive() || activeOperations.size) {
    if (signal?.aborted) throw abortError();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        listeners.delete(check);
        if (typeof window !== 'undefined') window.removeEventListener(POS_SALE_ACTIVITY_EVENT, check);
        signal?.removeEventListener('abort', abort);
      };
      const check = () => {
        if (activeOperations.size || isPosSaleActive()) return;
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(abortError());
      };
      listeners.add(check);
      if (typeof window !== 'undefined') {
        window.addEventListener(POS_SALE_ACTIVITY_EVENT, check);
      }
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      check();
    });
  }
  if (signal?.aborted) throw abortError();
  return performance.now() - startedAt;
};

export const resetLargeMasterSyncV3OperationGateForTests = (): void => {
  activeOperations.clear();
  listeners.forEach(listener => listener());
};
