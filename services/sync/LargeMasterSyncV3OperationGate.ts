import { isPosSaleActive, waitForPosSaleIdle } from '../../utils/posSaleActivity';

export type LargeMasterSyncV3CriticalOperation = 'PAYMENT' | 'PRINT' | 'UI_CRITICAL';

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

export const waitForLargeMasterSyncV3OperationalWindow = async (): Promise<number> => {
  const startedAt = performance.now();
  await waitForPosSaleIdle();
  if (activeOperations.size) {
    await new Promise<void>(resolve => {
      const check = () => {
        if (activeOperations.size || isPosSaleActive()) return;
        listeners.delete(check);
        resolve();
      };
      listeners.add(check);
      check();
    });
  }
  return performance.now() - startedAt;
};

export const resetLargeMasterSyncV3OperationGateForTests = (): void => {
  activeOperations.clear();
  listeners.forEach(listener => listener());
};
