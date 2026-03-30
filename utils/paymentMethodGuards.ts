import type { PaymentMethod, PaymentMethodDefinition, PaymentEntry } from '../types';

/** Nombre reservado: venta queda como crédito / CxC, no como efectivo en caja. */
export const isPendingPaymentMethodName = (name: string): boolean =>
  name.trim().toLowerCase() === 'pendiente';

export const toValidCreditDays = (days?: number): number => {
  const parsed = Number(days);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

export const normalizePaymentMethodDefinition = (
  method: PaymentMethodDefinition
): PaymentMethodDefinition => {
  const forcedType: PaymentMethod = isPendingPaymentMethodName(method.name) ? 'CREDIT' : method.type;

  const normalizedMethod: PaymentMethodDefinition = {
    ...method,
    type: forcedType,
    integration: forcedType === 'CARD' ? method.integration || 'NONE' : 'NONE',
    integrationConfig: forcedType === 'CARD' ? method.integrationConfig || {} : {},
  };

  if (forcedType === 'CREDIT') {
    return { ...normalizedMethod, paymentTermDays: toValidCreditDays(method.paymentTermDays) };
  }

  const { paymentTermDays, ...withoutCreditDays } = normalizedMethod;
  return withoutCreditDays;
};

/** En runtime (cobro), corrige configs antiguas con tipo CASH y nombre Pendiente. */
export const resolvePaymentMethodTypeForRuntime = (
  method: Pick<PaymentMethodDefinition, 'name' | 'type'>
): PaymentMethod =>
  isPendingPaymentMethodName(method.name) ? 'CREDIT' : method.type;

export const sumCreditPaymentsBase = (entries: Pick<PaymentEntry, 'method' | 'amount'>[]): number =>
  entries.filter((p) => p.method === 'CREDIT').reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
