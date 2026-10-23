import type { BusinessConfig } from '../../types';
import { persistProductionAreaSnapshot } from '../restaurant/ProductionAreaSnapshot';
import type { LargeMasterSyncV3Metric } from './LargeMasterSyncV3Client';
import { createV3Progress, type V3Progress } from './LargeMasterSyncV3Progress';

export interface V3SetupSession {
  assertCurrent(): Promise<void>;
  projectConfig(config: BusinessConfig): Promise<BusinessConfig>;
}

export interface V3SetupCommitSession extends V3SetupSession {
  /** Synchronous, local-only guard; safe while the native writer lane is owned. */
  assertSetupIdentity(): void;
}

/** Completion is possible only after the catalog/inventory session and persisted projection agree. */
export const completeLargeMasterSyncV3Setup = async (
  readCurrent: () => Promise<BusinessConfig>,
  getSession: () => Promise<V3SetupCommitSession>,
  persist: (expected: BusinessConfig, projected: BusinessConfig, assertIdentity: () => void) => Promise<void>,
  options?: { productionAreas?: unknown[] },
): Promise<BusinessConfig> => {
  const session = await getSession();
  await session.assertCurrent();
  // Lifecycle/config synchronization may have persisted a newer scope since pairing began.
  // Runtime projection and async guards may reenter SQLite, so keep them outside the CAS lane.
  const current = await readCurrent();
  const projected = await session.projectConfig(current);
  await session.assertCurrent();
  await persist(current, projected, () => session.assertSetupIdentity());
  await session.assertCurrent();
  if (options?.productionAreas !== undefined) {
    await persistProductionAreaSnapshot({ resolved: { catalog: { production_areas: options.productionAreas } } }, () => session.assertCurrent());
  }
  return projected;
};

export interface V3SessionContextGeneration {
  readonly generation: number;
  readonly scope: string | undefined;
}

export type V3SessionCoordinator<T extends V3SetupSession> = ((refresh?: boolean) => Promise<T>) & {
  progress: V3Progress;
  captureConfigContext(): V3SessionContextGeneration;
  publishConfigContext(session: T, expected: V3SessionContextGeneration, assertAuthority: () => Promise<void>): Promise<void>;
};

/** Shared setup/startup preparation; cached sessions are verified on every use. */
export const createLargeMasterSyncV3SessionCoordinator = <T extends V3SetupSession>(
  open: (refresh: boolean, metric?: (metric: LargeMasterSyncV3Metric) => void) => Promise<T>,
  scope?: () => string,
): V3SessionCoordinator<T> => {
  let opening: Promise<T> | undefined;
  let refreshing: Promise<T> | undefined;
  let generation = 0;
  const progress = createV3Progress();
  let reporter = progress.begin();
  let observedScope: string | undefined;
  const prepare = (refresh: boolean) => {
    // Reserve the flight before publishing: even a reentrant observer must share it.
    let attempt: ReturnType<V3Progress['begin']>;
    const pending = Promise.resolve().then(() => open(refresh, attempt.metric))
      .catch(error => { attempt.fail(); throw error; });
    // A refresh already owns its outer shared flight while it verifies the cache.
    if (!refresh) { opening = pending; generation++; }
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
      generation++;
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
      if (opening === pending) { opening = undefined; generation++; }
      throw error;
    }
  };
  const captureConfigContext = (): V3SessionContextGeneration => ({ generation, scope: scope?.() });
  const publishConfigContext = async (session: T, expected: V3SessionContextGeneration,
    assertAuthority: () => Promise<void>): Promise<void> => {
    const changed = () => Object.assign(new Error('SYNC_V3_UI_CONTEXT_CHANGED'), { code: 'SYNC_V3_UI_CONTEXT_CHANGED' });
    if (refreshing || generation !== expected.generation || scope?.() !== expected.scope) throw changed();
    const ownedGeneration = ++generation;
    const assertGeneration = () => {
      if (generation !== ownedGeneration || scope?.() !== expected.scope) throw changed();
    };
    // Reserve the verification flight synchronously. Ordinary financial callers must await it;
    // none can observe the new session before authority and generation are verified.
    const pending = Promise.resolve().then(async () => {
      assertGeneration();
      await assertAuthority();
      assertGeneration();
      await session.assertCurrent();
      await assertAuthority();
      assertGeneration();
      return session;
    });
    opening = pending;
    try { await pending; }
    catch (error) {
      // An older publisher cannot erase a newer refresh/cache generation.
      if (opening === pending) { opening = undefined; generation++; }
      throw error;
    }
  };
  return Object.assign(get, { progress, captureConfigContext, publishConfigContext });
};
