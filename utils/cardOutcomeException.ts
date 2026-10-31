/**
 * Card charge with an unknown outcome (Verifón/Azul did not answer).
 *
 * A pending card intent that ends without an explicit approval or decline means the
 * box cannot know whether the card was charged. Re-sending the sale would risk a
 * double charge, so the cashier gets a single exception line plus two supervised
 * exits: confirm with the printed voucher, or state that nothing was charged.
 */

export const CARD_OUTCOME_UNKNOWN = 'CARD_OUTCOME_UNKNOWN';

/** Intent states that mean "the terminal may have charged the card". */
const AMBIGUOUS_INTENT_STATUSES = new Set(['AUTHORIZING', 'UNKNOWN', 'RECONCILIATION_REQUIRED']);
/** Intent states that mean "the terminal already charged the card". */
const CHARGED_INTENT_STATUSES = new Set(['AUTHORIZED', 'COMMITTED']);

export const isUnknownCardOutcomeStatus = (status?: string | null): boolean =>
  AMBIGUOUS_INTENT_STATUSES.has(String(status || '').trim().toUpperCase());

export const isChargedCardIntentStatus = (status?: string | null): boolean =>
  CHARGED_INTENT_STATUSES.has(String(status || '').trim().toUpperCase());

export interface CardOutcomeNotice {
  paymentId: string;
  intentId?: string;
  providerLabel: string;
  amountBase: number;
}

export class CardOutcomeUnknownError extends Error {
  readonly outcome: CardOutcomeNotice;

  constructor(outcome: CardOutcomeNotice) {
    super(CARD_OUTCOME_UNKNOWN);
    this.name = 'CardOutcomeUnknownError';
    this.outcome = outcome;
  }
}

export const isCardOutcomeUnknownError = (error: unknown): error is CardOutcomeUnknownError =>
  error instanceof CardOutcomeUnknownError
  || (error instanceof Error && error.message === CARD_OUTCOME_UNKNOWN && Boolean((error as CardOutcomeUnknownError).outcome));

export const cardOutcomeNoticeLine = (
  currencySymbol: string,
  amountBase: number,
  providerLabel: string,
): string => {
  const provider = String(providerLabel || 'El procesador').trim() || 'El procesador';
  const amount = Number(amountBase || 0);
  return `${provider} no confirmó el cobro de ${currencySymbol}${amount.toFixed(2)}. Revisa el voucher antes de continuar.`;
};

/** Voucher references are short, human-typed tokens; anything else is a typo. */
export const normalizeVoucherReference = (raw: unknown): string | null => {
  const value = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!value || value.length > 40) return null;
  if (!/^[A-Z0-9][A-Z0-9 .\-_/]*$/.test(value)) return null;
  return value;
};

const roundToTwo = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Turn a pending card tender into an approved manual tender backed by the printed
 * voucher. Only the reference and the authorization code came from outside: the
 * amount and the integration stay the ones the cashier already confirmed.
 */
export const buildVoucherConfirmedEntry = <T extends Record<string, any>>(
  payment: T,
  input: { reference: string; taxAmount?: number; amountBase?: number },
): T => {
  const reference = normalizeVoucherReference(input.reference);
  if (!reference) throw new Error('CARD_VOUCHER_REFERENCE_REQUIRED');
  return {
    ...payment,
    gatewayStatus: 'APPROVED',
    gatewayTransactionType: 'SALE',
    gatewayResponseCode: 'VOUCHER',
    gatewayResponseMessage: `Confirmado con voucher ${reference}`,
    gatewayAuthorizationCode: reference,
    gatewayReference: reference,
    gatewayProcessedAmount: roundToTwo(input.amountBase ?? Number(payment?.amount || 0)),
    gatewayProcessedTaxAmount: roundToTwo(input.taxAmount ?? 0),
  } as T;
};
