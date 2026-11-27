import type { BusinessConfig } from '../../types';
import { v3OperationalConfigContext } from './LargeMasterSyncV3OperationalConfigScope';

export const V3_SALES_CONFIG_PUBLISHED = 'v3SalesConfigPublished';

type Publication = { pending: number; committedKey?: string };
const publications = new Map<string, Publication>();
const listeners = new Set<() => void>();

export function subscribeV3SalesConfigPublication(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isV3SalesConfigPending(terminalId: string, renderedKey: string): boolean {
  const state = publications.get(terminalId);
  return Boolean(state && (state.pending > 0 || (state.committedKey && state.committedKey !== renderedKey)));
}

export function acknowledgeV3SalesConfig(terminalId: string, renderedKey: string): void {
  const state = publications.get(terminalId);
  if (state?.pending === 0 && state.committedKey === renderedKey) publications.delete(terminalId);
}

export async function publishV3SalesConfig(
  terminalId: string, previous: BusinessConfig, committed: BusinessConfig, save: () => Promise<void>,
): Promise<void> {
  const selector = { localTerminalId: terminalId };
  const key = (config: BusinessConfig) => {
    try { return v3OperationalConfigContext(config, selector).key; }
    catch { return undefined; }
  };
  const previousKey = key(previous);
  const nextKey = key(committed);
  if (!nextKey || previousKey === nextKey) return save();

  const state = publications.get(terminalId) ?? { pending: 0 };
  publications.set(terminalId, state);
  state.pending++;
  listeners.forEach(listener => listener());
  try {
    await save();
    state.committedKey = nextKey;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(V3_SALES_CONFIG_PUBLISHED, { detail: committed }));
    }
  } finally {
    state.pending--;
    if (state.pending === 0 && !state.committedKey) publications.delete(terminalId);
    listeners.forEach(listener => listener());
  }
}
