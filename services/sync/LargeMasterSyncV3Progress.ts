import type { LargeMasterSyncV3Metric } from './LargeMasterSyncV3Client';

export interface V3ProgressSnapshot {
  phase: string;
  syncId?: string;
  syncVersion?: number;
  dataset?: string;
  appliedChunks?: number;
  totalChunks?: number;
  percent?: number;
  failed?: boolean;
}

/** One bounded snapshot, no polling, persistence, or observer-controlled work. */
export const createV3Progress = () => {
  let snapshot: V3ProgressSnapshot = { phase: 'negotiation' };
  let latest = snapshot;
  let generation = 0;
  const listeners = new Set<() => void>();
  const notify = (listener: () => void) => { try { listener(); } catch { /* Observation cannot fail setup. */ } };
  const publish = (next: V3ProgressSnapshot) => {
    latest = next;
    if (next.phase === snapshot.phase && next.dataset === snapshot.dataset && next.percent === snapshot.percent
      && next.syncId === snapshot.syncId && next.syncVersion === snapshot.syncVersion
      && next.failed === snapshot.failed) return;
    snapshot = next;
    for (const listener of [...listeners]) notify(listener);
  };
  return {
    getSnapshot: () => latest,
    getLatest: () => latest,
    subscribe: (listener: () => void) => { listeners.add(listener); notify(listener);
      return () => { listeners.delete(listener); }; },
    begin: () => {
      const current = ++generation;
      publish({ phase: 'negotiation' });
      return {
        update: (next: V3ProgressSnapshot) => { if (current === generation) publish(next); },
        metric: (metric: LargeMasterSyncV3Metric) => {
          if (current !== generation) return;
          if ((metric.syncId && latest.syncId && metric.syncId !== latest.syncId)
            || (metric.syncVersion !== undefined && latest.syncVersion !== undefined
              && metric.syncVersion !== latest.syncVersion)) return;
          if (metric.event === 'chunk_progress') publish({ phase: 'catalog', syncId: metric.syncId,
            syncVersion: metric.syncVersion, dataset: metric.dataset, appliedChunks: metric.appliedChunks,
            totalChunks: metric.totalChunks, percent: Number.isSafeInteger(metric.totalChunks) && metric.totalChunks! > 0
              && Number.isSafeInteger(metric.appliedChunks) && metric.appliedChunks! >= 0
              ? Math.min(100, Math.floor(100 * metric.appliedChunks / metric.totalChunks)) : undefined });
          else if (metric.event === 'setup_phase') publish({ phase: metric.phase || 'negotiation',
            dataset: metric.dataset, syncId: metric.syncId ?? latest.syncId, syncVersion: metric.syncVersion ?? latest.syncVersion });
        },
        phase: (phase: string) => { if (current === generation) publish({ ...latest, phase, percent: undefined }); },
        fail: () => { if (current === generation) publish({ ...latest, failed: true }); },
        close: () => { if (current === generation) generation++; },
      };
    },
  };
};
export type V3Progress = ReturnType<typeof createV3Progress>;
