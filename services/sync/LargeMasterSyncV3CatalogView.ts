import type { V3CatalogPage } from './LargeMasterSyncV3Types';
export type V3CatalogViewState = { status: 'loading' | 'error' | 'ready'; page?: V3CatalogPage; error?: string };

/** One page only; generation fences slow responses, context resets and unmount. */
export const createV3CatalogView = () => {
  let generation = 0;
  let state: V3CatalogViewState = { status: 'loading' };
  const listeners = new Set<{ active: boolean; callback: () => void }>();
  const publish = (next: V3CatalogViewState) => { state = next;
    for (const listener of [...listeners]) if (listener.active) {
      try { listener.callback(); } catch { /* A view observer cannot alter the native read. */ }
    } };
  const cancel = () => { generation++; publish({ status: 'loading' }); };
  return {
    getSnapshot: () => state,
    subscribe: (callback: () => void) => { const listener = { active: true, callback }; listeners.add(listener);
      return () => { listener.active = false; listeners.delete(listener); }; },
    cancel,
    load: async (operation: () => Promise<V3CatalogPage>) => {
      const current = ++generation; publish({ status: 'loading' });
      try { const page = await operation(); if (current === generation) publish({ status: 'ready', page }); }
      catch (error) { if (current === generation) publish({ status: 'error',
        error: error instanceof Error ? error.message : 'No se pudo leer el catálogo V3.' }); }
    },
  };
};
