import type { ParkedTicket } from '../types';

type FetchLike = typeof fetch;

/** Bounded Master read; the returned fence must also be checked before any side effect. */
export const fetchAuthoritativeTableSnapshot = async (options: {
  resolveUrl: () => Promise<string>;
  captureAuthority?: () => () => boolean;
  fetcher?: FetchLike;
  timeoutMs?: number;
}): Promise<{ parkedTickets: ParkedTicket[]; revision: number; assertCurrentAuthority: () => void }> => {
  const url = await options.resolveUrl();
  const isCurrent = options.captureAuthority?.() || (() => true);
  const assertCurrentAuthority = () => {
    if (!isCurrent()) throw new Error('MASTER_CONTRACT_CHANGED: cambió el vínculo con la Master; verifique antes de reintentar.');
  };
  assertCurrentAuthority();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  try {
    const response = await (options.fetcher || fetch)(url, { signal: controller.signal });
    assertCurrentAuthority();
    if (!response.ok) throw new Error(`MASTER_TABLES_HTTP_${response.status}`);
    const snapshot = await response.json();
    assertCurrentAuthority();
    if (!Array.isArray(snapshot?.parkedTickets)) throw new Error('MASTER_TABLES_MISSING_TICKETS');
    return { parkedTickets: snapshot.parkedTickets, revision: Number(snapshot.revision || 0), assertCurrentAuthority };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('MASTER_TABLES_TIMEOUT: la Master no respondió en 5 segundos; verifique antes de reintentar.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
