import type { ParkedTicket, PaymentFractionPlan } from '../types';
import { createUuid } from './uuid';

export const splitAmountIntoEqualParts = (total: number, count: number): number[] => {
  const safeCount = Math.max(2, Math.min(20, Math.trunc(count)));
  const totalCents = Math.round(Math.max(0, Number(total) || 0) * 100);
  const baseCents = Math.floor(totalCents / safeCount);
  const remainder = totalCents % safeCount;

  return Array.from({ length: safeCount }, (_, index) => (
    (baseCents + (index < remainder ? 1 : 0)) / 100
  ));
};

export const createPaymentFractionPlan = (
  total: number,
  count: number,
  createdAt = new Date().toISOString()
): PaymentFractionPlan => ({
  originalTotal: Math.round((Math.max(0, Number(total) || 0) + Number.EPSILON) * 100) / 100,
  count: Math.max(2, Math.min(20, Math.trunc(count))),
  createdAt,
  parts: splitAmountIntoEqualParts(total, count).map((amount, index) => ({
    index: index + 1,
    amount,
    status: 'PENDING'
  }))
});

export const isPaymentFractionPlanCurrent = (
  plan: PaymentFractionPlan | undefined,
  currentTotal: number
): boolean => Boolean(plan && Math.abs(plan.originalTotal - currentTotal) < 0.01);

export const isFullyPaidParkedTicket = (ticket: ParkedTicket): boolean => {
  const plan = ticket.paymentFraction;
  return Boolean(
    plan
    && plan.parts.length > 1
    && plan.parts.every(part => part.status === 'PAID'),
  );
};

/**
 * Keeps an existing installment plan only while it still describes the current
 * ticket total. This is used by every table autosave path so reopening a table
 * does not collapse valid installments, without reviving a stale plan after an
 * item, discount or tax change.
 */
export const retainCurrentPaymentFractionPlan = (
  plan: PaymentFractionPlan | undefined,
  currentTotal: number
): PaymentFractionPlan | undefined => (
  isPaymentFractionPlanCurrent(plan, currentTotal) ? plan : undefined
);

/**
 * Deterministic fingerprint of the installment plan. Used as the `planFingerprint`
 * of a part proof so a later plan edit (item/discount/tax change) cannot resurrect
 * a stale part payment.
 */
export const paymentFractionPlanFingerprint = (plan: PaymentFractionPlan): string => {
  const canonical = JSON.stringify({
    originalTotal: plan.originalTotal,
    count: plan.count,
    parts: plan.parts.map(part => ({ index: part.index, amount: part.amount })),
  });
  // Simple stable digest without pulling in node:crypto in the web bundle.
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

/** Stable identity for a part proof, generated before any provider is engaged. */
export const createPaymentFractionPartProof = (): { receiptId: string; operationId: string } => ({
  receiptId: createUuid(),
  operationId: createUuid(),
});
