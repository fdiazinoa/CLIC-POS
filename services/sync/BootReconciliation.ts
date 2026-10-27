import { needsTerminalReauthorization, reauthorizeTerminal, reconcileStaleFiscalCheckout } from './TerminalReauthorizationService';

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
    const state = needsTerminalReauthorization();
    if (state.required) {
      const result = await reauthorizeTerminal();
      reauthorized = result.ok;
      notes.push(`Reautorización: ${result.ok ? 'ok' : 'falló'}${result.ok ? '' : ` (${result.message})`}`);
    }
  } catch (error) {
    notes.push(`Reautorización: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { notes, reauthorized };
};
