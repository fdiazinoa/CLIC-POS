import { Customer, PaymentEntry, PaymentMethod } from '../types';

const CREDIT_METHOD_MARKERS = new Set(['CREDIT', 'PENDIENTE', 'PENDING']);

const normalizeMarker = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
};

export const isCreditLikeMarker = (value: unknown): boolean =>
  CREDIT_METHOD_MARKERS.has(normalizeMarker(value));

export const resolvePaymentMethodTypeForRuntime = (
  method: PaymentMethod | string | undefined,
  label?: string,
  methodId?: string
): PaymentMethod => {
  if (isCreditLikeMarker(method) || isCreditLikeMarker(label) || isCreditLikeMarker(methodId)) {
    return 'CREDIT';
  }
  return (method as PaymentMethod) || 'OTHER';
};

export const paymentEntryIsCxCCredit = (payment: PaymentEntry): boolean =>
  resolvePaymentMethodTypeForRuntime(payment.method, payment.methodLabel, payment.methodId) === 'CREDIT';

export const sumCreditPaymentsBase = (entries: PaymentEntry[]): number =>
  entries.reduce((sum, payment) => (paymentEntryIsCxCCredit(payment) ? sum + Number(payment.amount || 0) : sum), 0);

export type CreditGateReason = 'NO_CUSTOMER' | 'NO_LIMIT' | 'OVER_LIMIT';

export interface CreditGateResult {
  required: boolean;
  reason: CreditGateReason;
  projected: number;
  limit: number;
  currentDebt: number;
  creditOnTicket: number;
}

export const evaluateCreditSupervisorGate = (
  customer: Customer | null | undefined,
  creditAlreadyOnTicket: number,
  additionalCredit: number
): CreditGateResult | null => {
  const creditOnTicket = parseFloat((Math.max(0, creditAlreadyOnTicket) + Math.max(0, additionalCredit)).toFixed(2));
  if (creditOnTicket <= 0.005) return null;

  if (!customer?.id) {
    return {
      required: true,
      reason: 'NO_CUSTOMER',
      projected: creditOnTicket,
      limit: 0,
      currentDebt: 0,
      creditOnTicket
    };
  }

  const limit = Number(customer.creditLimit || 0);
  const currentDebt = Number(customer.currentDebt || 0);
  const projected = parseFloat((currentDebt + creditOnTicket).toFixed(2));

  if (limit <= 0) {
    return {
      required: true,
      reason: 'NO_LIMIT',
      projected,
      limit,
      currentDebt,
      creditOnTicket
    };
  }

  if (projected > limit) {
    return {
      required: true,
      reason: 'OVER_LIMIT',
      projected,
      limit,
      currentDebt,
      creditOnTicket
    };
  }

  return null;
};
