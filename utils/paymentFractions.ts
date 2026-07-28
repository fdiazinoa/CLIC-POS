import type { PaymentFractionPlan } from '../types';

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
