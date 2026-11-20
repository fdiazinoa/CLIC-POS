import { Capacitor } from '@capacitor/core';
import type { BusinessConfig, Transaction } from '../../types';
import { resolveErpBaseUrl } from '../../utils/erpBaseUrl';
import { readTerminalCredentialsSync } from '../sync/TerminalCredentialStore';
import { FiscalTicketPrintQueue } from './FiscalTicketPrintQueue';
import { resolveFiscalPrintReadiness } from './FiscalPrintEvidence';

const collection = 'fiscalTicketPrintRequests';
const database = async () => (await import('../db')).dbAdapter;

const supportsDeferredTicket = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const isSignedFiscalSaleTicket = (tx: Transaction): boolean =>
  supportsDeferredTicket() && tx.fiscalProvider === 'MSELLER' && /^E(?:31|32|44|45)$/.test(String(tx.ncfType || ''));

function scope(): string {
  const terminal = readTerminalCredentialsSync();
  const parts = [resolveErpBaseUrl(), terminal.erpTenantId || terminal.tenantId, terminal.companyId,
    terminal.storeId, terminal.erpTerminalId || terminal.terminalId, terminal.deviceId];
  return parts.every(Boolean) ? JSON.stringify(parts) : '';
}

export const fiscalTicketPrintQueue = new FiscalTicketPrintQueue({
  scope,
  get: async id => (await database()).getDocument(collection, id),
  list: async () => (await database()).getCollection(collection),
  save: async job => (await database()).saveDocument(collection, job),
});

let wakeWorker: (() => void) | undefined;
export async function queueSignedFiscalTicket(transaction: Transaction): Promise<void> {
  const terminal = readTerminalCredentialsSync();
  if (![terminal.terminalId, terminal.erpTerminalId].includes(transaction.terminalId)) {
    throw Error('La venta pertenece a otra terminal.');
  }
  await fiscalTicketPrintQueue.enqueue(transaction.id);
  wakeWorker?.();
}

export function attachFiscalTicketPrinter(currentConfig: () => BusinessConfig): () => void {
  if (!supportsDeferredTicket()) return () => {};
  let disposed = false;
  let running = false;
  let rerun = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delayMs = 1_500;
  const abort = new AbortController();
  const run = () => {
    if (disposed || !navigator.onLine) return;
    if (running) { rerun = true; return; }
    clearTimeout(timer);
    running = true;
    let waiting = false;
    void fiscalTicketPrintQueue.drain(async job => {
      const db = await database();
      const transaction = await db.getDocument<Transaction>('transactions', job.transactionId)
        || await db.getDocument<Transaction>('transactionHistory', job.transactionId);
      if (!transaction || !isSignedFiscalSaleTicket(transaction)) return;
      const { fiscalWorkflowV2Client } = await import('./FiscalWorkflowV2Client');
      if ((await fiscalWorkflowV2Client.cached(transaction.id))?.decision === 'REJECTED') return 'REVIEW';
      const evidence = await resolveFiscalPrintReadiness(transaction, { timeoutMs: 2_000, signal: abort.signal });
      if ((await fiscalWorkflowV2Client.cached(transaction.id))?.decision === 'REJECTED') return 'REVIEW';
      if (!evidence) return;
      const { printQueuedSignedFiscalTicket } = await import('../../utils/printer');
      return isCurrent => printQueuedSignedFiscalTicket(transaction, currentConfig(), evidence, isCurrent);
    }, () => !disposed).then(value => { waiting = value; }, () => { waiting = true; }).finally(() => {
      running = false;
      if (disposed) return;
      if (rerun) { rerun = false; run(); return; }
      if (waiting) {
        timer = setTimeout(run, delayMs);
        delayMs = Math.min(delayMs * 2, 15_000);
      } else delayMs = 1_500;
    });
  };
  const signatureUpdated = (event: Event) => {
    const state = (event as CustomEvent<{ state?: { signature?: unknown } }>).detail?.state;
    if (state?.signature) run();
  };
  wakeWorker = run;
  window.addEventListener('fiscalWorkflowUpdated', signatureUpdated);
  window.addEventListener('online', run);
  run();
  return () => {
    disposed = true;
    abort.abort();
    clearTimeout(timer);
    window.removeEventListener('online', run);
    window.removeEventListener('fiscalWorkflowUpdated', signatureUpdated);
    if (wakeWorker === run) wakeWorker = undefined;
  };
}
