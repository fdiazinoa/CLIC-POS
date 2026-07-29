const readFiniteNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
};

export const resolveReducedSyncAfterMinutes = (terminal: any): number => {
  const config = terminal?.config || terminal || {};
  const security = config.security || {};
  const session = config.session || {};
  const workflowSession = config.workflow?.session || {};

  return Math.max(0, readFiniteNumber(
    security.reduceSyncAfterMinutes,
    security.reduce_sync_after_minutes,
    session.reduceSyncAfterMinutes,
    session.reduce_sync_after_minutes,
    workflowSession.reduceSyncAfterMinutes,
    workflowSession.reduce_sync_after_minutes,
    config.reduceSyncAfterMinutes,
    config.reduce_sync_after_minutes
  ) ?? 0);
};

export interface ReducedSyncEligibility {
  idleMs: number;
  thresholdMs: number;
  saleActive: boolean;
  pendingCriticalCount: number;
  criticalSyncInProgress: boolean;
}

export const canEnterReducedSyncMode = ({
  idleMs,
  thresholdMs,
  saleActive,
  pendingCriticalCount,
  criticalSyncInProgress,
}: ReducedSyncEligibility): boolean => (
  thresholdMs > 0
  && idleMs >= thresholdMs
  && !saleActive
  && pendingCriticalCount <= 0
  && !criticalSyncInProgress
);
