import type { BusinessConfig } from '../../types';

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
  open: (refresh: boolean) => Promise<T>,
): ((refresh?: boolean) => Promise<T>) => {
  let opening: Promise<T> | undefined;
  let refreshing: Promise<T> | undefined;
  return async (refresh = false) => {
    if (refresh && !refreshing) {
      refreshing = (async () => {
        if (opening) await (await opening).assertCurrent();
        return open(true);
      })();
      opening = refreshing;
      void refreshing.finally(() => { refreshing = undefined; }).catch(() => undefined);
    }
    if (!opening) opening = open(false);
    const pending = opening;
    try {
      const session = await pending;
      await session.assertCurrent();
      return session;
    } catch (error) {
      if (opening === pending) opening = undefined;
      throw error;
    }
  };
};
