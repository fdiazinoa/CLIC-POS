import { POS_SALE_ACTIVITY_EVENT, isPosSaleActive } from '../../utils/posSaleActivity';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

export type LargeMasterSyncV3CriticalOperation = 'PAYMENT' | 'PRINT';

const activeOperations = new Map<LargeMasterSyncV3CriticalOperation, number>();
const listeners = new Set<() => void>();
let baselineMutationReserved = false;
export const isLargeMasterSyncV3OperationalWindowHeld = (): boolean => isPosSaleActive() || activeOperations.size > 0;

// Acquire synchronously before the first native await, and retain through COMMIT/ROLLBACK.
// Critical operations and baseline mutations cannot both enter the operational window.
export const reserveLargeMasterSyncV3BaselineMutation = (): (() => void) => {
  if (baselineMutationReserved || isLargeMasterSyncV3OperationalWindowHeld()) {
    throw new LargeMasterSyncV3Error('SYNC_V3_OPERATIONAL_WINDOW_HELD');
  }
  baselineMutationReserved = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    baselineMutationReserved = false;
    listeners.forEach(listener => listener());
  };
};

export const setLargeMasterSyncV3CriticalOperation = (
  operation: LargeMasterSyncV3CriticalOperation,
  active: boolean,
): void => {
  if (active && baselineMutationReserved) throw new LargeMasterSyncV3Error('SYNC_V3_OPERATIONAL_WINDOW_HELD');
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
  while (isPosSaleActive() || activeOperations.size || baselineMutationReserved) {
    if (signal?.aborted) throw abortError();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        listeners.delete(check);
        if (typeof window !== 'undefined') window.removeEventListener(POS_SALE_ACTIVITY_EVENT, check);
        signal?.removeEventListener('abort', abort);
      };
      const check = () => {
        if (activeOperations.size || isPosSaleActive() || baselineMutationReserved) return;
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
  baselineMutationReserved = false;
  listeners.forEach(listener => listener());
};
