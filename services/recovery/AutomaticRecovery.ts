import type { DatabaseAdapter } from '../db/DatabaseAdapter';
import { CAPTURE_COLLECTIONS, RECOVERY_STATE } from './OriginalCapture';

export type AutomaticRecoveryState = {
  phase: 'idle' | 'downloading' | 'restoring' | 'ready' | 'error';
  error?: string;
};

/** Orchestration only. Original verification and atomic import remain in the recovery service. */
export class AutomaticRecovery {
  private state: AutomaticRecoveryState = { phase: 'idle' };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  constructor(private db: DatabaseAdapter, private operations: {
    context: () => string;
    download: () => Promise<{ totalRecords: number }>;
    restore: () => Promise<number>;
    published: () => void;
  }) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(state: AutomaticRecoveryState) {
    this.state = state;
    this.listeners.forEach(listener => listener());
  }
  start = (): Promise<void> => {
    if (this.running) return this.running;
    this.running = this.run().catch(error => {
      this.update({ phase: 'error', error: error instanceof Error ? error.message : 'RECOVERY_FAILED' });
    }).finally(() => { this.running = null; });
    return this.running;
  };
  private async run() {
    const context = this.operations.context();
    if (!context) return;
    const id = JSON.stringify(['automaticRestore', context]);
    const previous = await this.db.getDocument<any>(RECOVERY_STATE, id);
    if (previous?.status === 'COMPLETE') return;
    if (!previous) {
      // An APK update or an ordinary restart must not import over an operational database.
      for (const collection of Object.keys(CAPTURE_COLLECTIONS)) {
        if ((await this.db.getCollection(collection)).length) return;
      }
      const capture = await this.db.getDocument<any>(RECOVERY_STATE, 'capture');
      if (capture && capture.sequence !== '0') return;
    }
    const checkScope = () => {
      if (this.operations.context() !== context) throw Error('RECOVERY_SCOPE_CHANGED');
    };
    checkScope();
    await this.db.saveDocument(RECOVERY_STATE, { id, context, status: 'PENDING' });
    this.update({ phase: 'downloading' });
    const snapshot = await this.operations.download();
    checkScope();
    if (snapshot.totalRecords > 0) {
      this.update({ phase: 'restoring' });
      // Retained-only: never approximate a jornada from commercial documents or legacy dates.
      await this.operations.restore();
      checkScope();
    }
    await this.db.saveDocument(RECOVERY_STATE, { id, context, status: 'COMPLETE' });
    this.update({ phase: snapshot.totalRecords ? 'ready' : 'idle' });
    if (snapshot.totalRecords) this.operations.published();
  }
}
