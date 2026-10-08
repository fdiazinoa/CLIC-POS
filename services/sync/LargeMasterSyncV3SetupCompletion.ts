import type { BusinessConfig } from '../../types';
import type { LargeMasterSyncV3Metric } from './LargeMasterSyncV3Client';
import { createV3Progress, type V3Progress } from './LargeMasterSyncV3Progress';

export interface V3SetupSession {
  assertCurrent(): Promise<void>;
  projectConfig(config: BusinessConfig): Promise<BusinessConfig>;
}

/** Completion is possible only after the catalog/inventory session and persisted projection agree. */
export const completeLargeMasterSyncV3Setup = async (
  config: BusinessConfig,
  getSession: () => Promise<V3SetupSession>,
  persist: (config: BusinessConfig) => Promise<void>,
): Promise<BusinessConfig> => {
  const session = await getSession();
  await session.assertCurrent();
  const projected = await session.projectConfig(config);
  await persist(projected);
  await session.assertCurrent();
  return projected;
};

/** Shared setup/startup preparation; cached sessions are verified on every use. */
export const createLargeMasterSyncV3SessionCoordinator = <T extends V3SetupSession>(
  open: (refresh: boolean, metric?: (metric: LargeMasterSyncV3Metric) => void) => Promise<T>,
  scope?: () => string,
): ((refresh?: boolean) => Promise<T>) & { progress: V3Progress } => {
  let opening: Promise<T> | undefined;
  let refreshing: Promise<T> | undefined;
  const progress = createV3Progress();
  let reporter = progress.begin();
  let observedScope: string | undefined;
  const prepare = (refresh: boolean) => {
    // Reserve the flight before publishing: even a reentrant observer must share it.
    let attempt: ReturnType<V3Progress['begin']>;
    const pending = Promise.resolve().then(() => open(refresh, attempt.metric))
      .catch(error => { attempt.fail(); throw error; });
    // A refresh already owns its outer shared flight while it verifies the cache.
    if (!refresh) opening = pending;
    reporter = progress.begin();
    attempt = reporter;
    return pending;
  };
  const get = async (refresh = false) => {
    const currentScope = scope?.();
    if (currentScope !== observedScope) {
      observedScope = currentScope;
      // Observation identity changes do not create/refresh a session or bypass assertCurrent.
      reporter = progress.begin();
    }
    if (refresh && !refreshing) {
      const previous = opening;
      refreshing = Promise.resolve().then(async () => {
        if (previous) {
          const prior = await previous;
          try { await prior.assertCurrent(); }
          catch (error) {
            if ((error as { code?: string })?.code !== 'SYNC_V3_RUNTIME_VERSION_CHANGED') throw error;
            if (scope?.() !== currentScope) throw error;
            // A prior refresh may have activated SQLite before projection persistence failed.
            const persisted = await open(false);
            await persisted.assertCurrent();
            if (scope?.() !== currentScope) throw error;
          }
        }
        return prepare(true);
      });
      opening = refreshing;
      void refreshing.finally(() => { refreshing = undefined; }).catch(() => undefined);
    }
    if (!opening) opening = prepare(false);
    const pending = opening;
    let pendingReporter = reporter;
    try {
      const session = await pending;
      // Deferred refresh preparation creates its generation only after cache verification.
      // Resolve that owner after the shared flight, never borrow a newer unrelated flight.
      if (opening === pending && observedScope === currentScope) pendingReporter = reporter;
      pendingReporter.phase('owner');
      await session.assertCurrent();
      pendingReporter.phase('verified');
      return session;
    } catch (error) {
      if (opening === pending && observedScope === currentScope) pendingReporter = reporter;
      pendingReporter.fail();
      if (opening === pending) opening = undefined;
      throw error;
    }
  };
  return Object.assign(get, { progress });
};
