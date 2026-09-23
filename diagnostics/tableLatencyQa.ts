/** Temporary diagnostic controls. The Vite flag is unset in normal APK builds. */
export const tableLatencyQaEnabled = import.meta.env.VITE_TABLE_LATENCY_QA === 'true';

export type TableLatencyQaMode = 'real' | 'mock-lock' | 'preloaded' | 'pure-switch' | 'minimal-sales' | 'minimal-tables';
export type TableLatencyQaState = {
  mode: TableLatencyQaMode;
  productLimit: number | null;
  cardLimit: number | null;
};

let state: TableLatencyQaState = { mode: 'real', productLimit: null, cardLimit: null };
const listeners = new Set<() => void>();

export const getTableLatencyQaState = () => state;
export const subscribeTableLatencyQa = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const updateTableLatencyQaState = (next: Partial<TableLatencyQaState>) => {
  if (!tableLatencyQaEnabled) return;
  state = { ...state, ...next };
  listeners.forEach(listener => listener());
};

export const tableLatencyQaMark = (name: string, detail?: Record<string, unknown>) => {
  if (!tableLatencyQaEnabled) return;
  performance.mark(`CLIC_TABLE_QA_${name}`, detail ? { detail } : undefined);
};

declare global {
  interface Window {
    __CLIC_TABLE_LATENCY_QA__?: {
      get: () => TableLatencyQaState;
      set: (next: Partial<TableLatencyQaState>) => void;
      showTables?: () => void;
      showSales?: () => void;
    };
  }
}

if (tableLatencyQaEnabled && typeof window !== 'undefined') {
  window.__CLIC_TABLE_LATENCY_QA__ = {
    get: getTableLatencyQaState,
    set: updateTableLatencyQaState,
  };
}
