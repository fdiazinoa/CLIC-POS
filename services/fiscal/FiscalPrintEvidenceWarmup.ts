import type { Transaction } from '../../types';

/**
 * First-impression fiscal evidence warm-up.
 *
 * After a sale is committed, the ERP signs the e-CF a few seconds later (intake -> worker fence).
 * Historically the POS only consulted the status once from `syncFiscalDocument` and then waited
 * for the periodic fiscal lifecycle/sync round, so the signed evidence reached `pos_fiscal_state_v2`
 * too late for the first ticket print (generic fallback) even though a reprint later was signed.
 *
 * This helper keeps consulting `fiscalWorkflowV2Client.consult` (which validates and persists the
 * verified state through the existing client contract) for a bounded window starting at sale
 * finalization. It never emits, retries emission, or mutates the sale: it only reads the ERP status
 * and lets the existing, already-validated persistence path store the signed evidence sooner.
 */
export interface FiscalEvidenceWarmupClient {
  enabled(): boolean;
  consult(id: string, signal?: AbortSignal): Promise<{ signature?: unknown } | null>;
}

export interface FiscalEvidenceWarmupOptions {
  client?: FiscalEvidenceWarmupClient;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export const FISCAL_PRINT_WARMUP_TIMEOUT_MS = 20000;
export const FISCAL_PRINT_WARMUP_INTERVAL_MS = 1500;
/** Older transactions are handled by the periodic lifecycle, not by a sale-time warmer. */
export const FISCAL_PRINT_WARMUP_RECENT_MS = 5 * 60 * 1000;

const running = new Map<string, Promise<boolean>>();
const defaultDelay = (ms: number) => new Promise<void>(resolve => { if (typeof window !== 'undefined') window.setTimeout(resolve, ms); else setTimeout(resolve, ms); });

/** Only fiscal sales finalized moments ago need a first-print warm-up. */
export const needsFiscalPrintWarmup = (transaction: Transaction, now = Date.now()): boolean => {
  if (transaction.fiscalProvider !== 'MSELLER') return false;
  if (transaction.documentType === 'REFUND' || transaction.ncfType === 'B04' || transaction.ncfType === 'E34') return false;
  const signedAt = Date.parse(String(transaction.date || ''));
  return Number.isFinite(signedAt) && now - signedAt <= FISCAL_PRINT_WARMUP_RECENT_MS;
};

/**
 * Deduplicated, bounded and never-throwing warner. Resolves true when signed evidence was observed
 * (and therefore persisted by the client), false on timeout/abort/disabled fiscal workflow.
 */
export async function warmFiscalPrintEvidence(transaction: Transaction, options: FiscalEvidenceWarmupOptions = {}): Promise<boolean> {
  const { client, timeoutMs = FISCAL_PRINT_WARMUP_TIMEOUT_MS, intervalMs = FISCAL_PRINT_WARMUP_INTERVAL_MS,
    now = Date.now, delay = defaultDelay, signal } = options;
  if (!transaction?.id || !needsFiscalPrintWarmup(transaction, now())) return false;
  const existing = running.get(transaction.id);
  if (existing) return existing;
  const promise = (async () => {
    const resolved = client || (await import('./FiscalWorkflowV2Client')).fiscalWorkflowV2Client;
    const deadline = now() + Math.max(0, timeoutMs);
    while (!signal?.aborted) {
      try {
        if (!resolved.enabled()) return false;
        const state = await resolved.consult(transaction.id, signal);
        if (state?.signature) return true;
      } catch { /* ERP intake/signature may not exist yet or the network may blip: keep waiting. */ }
      if (signal?.aborted) return false;
      const left = deadline - now();
      if (left <= 0) return false;
      await delay(Math.max(0, Math.min(intervalMs, left)));
    }
    return false;
  })().finally(() => { running.delete(transaction.id); });
  running.set(transaction.id, promise);
  return promise;
}

/** Test-only: clears the per-transaction dedupe registry. */
export const resetFiscalPrintWarmupForTests = () => { running.clear(); };
