import type { TerminalReauthorizationResult } from './TerminalReauthorizationService';

export interface ReauthorizationStateHint { required: boolean; reason: string }

/**
 * Card hint after a reauthorization attempt. A deferred/failed run must keep its actionable message:
 * replacing it in the same tick with the generic "tokens vigentes" line hides why authority was not
 * rotated (e.g. pending offline sales). The successful path keeps the previous behavior.
 */
export const reauthorizationHintText = (
  result: Pick<TerminalReauthorizationResult, 'ok' | 'message'>,
  state: ReauthorizationStateHint,
): string => !result.ok
  ? result.message
  : state.required
    ? `Requerido: ${state.reason}`
    : 'Tokens vigentes · renovar solo si el cobro fiscal falla';
