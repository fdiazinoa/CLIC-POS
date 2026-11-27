import { needsTerminalReauthorization, reauthorizeTerminal, reconcileStaleFiscalCheckout } from './TerminalReauthorizationService';
import { recordCheckoutTrace } from '../audit/CheckoutTrace';

export type BootReconciliationResult = { notes: string[]; reauthorized: boolean };

/**
 * Single entry point for everything the POS repairs when it starts: a fiscal attempt left without
 * effects and the terminal pairing. Keeping it in one place avoids two boot paths drifting apart.
 */
export const runBootReconciliation = async (): Promise<BootReconciliationResult> => {
  const notes: string[] = [];
  let reauthorized = false;
  try {
    const fiscal = await reconcileStaleFiscalCheckout();
    if (fiscal.trim()) notes.push(fiscal.trim());
  } catch { /* best effort */ }
  try {
    // Idempotent ACK replay: a return committed before the app was closed may have missed the
    // settlement/projection step even though its events are already APPLIED_ERP.
    const { dbAdapter } = await import('../db');
    const store = dbAdapter.fiscalReturnStore;
    const committed = await (store as any)?.committed?.() as Array<{ financialEventId: string }> | undefined;
    for (const attempt of committed || []) {
      try { await store!.acknowledgeApplied(attempt.financialEventId); } catch { /* fail-closed per attempt */ }
    }
  } catch { /* native return store is optional */ }
  try {
    const state = needsTerminalReauthorization();
    if (state.required) {
      const result = await reauthorizeTerminal();
      reauthorized = result.ok;
      notes.push(result.deferred
        ? `Reautorización diferida: ${result.message}`
        : `Reautorización: ${result.ok ? 'ok' : 'falló'}${result.ok ? '' : ` (${result.message})`}`);
    }
  } catch (error) {
    notes.push(`Reautorización: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (notes.length) recordCheckoutTrace('BOOT_RECONCILED', notes.join(' · '));
  return { notes, reauthorized };
};
