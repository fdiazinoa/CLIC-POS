import type { PaymentMethod, PaymentMethodDefinition, PaymentEntry, Customer } from '../types';

/** Resultado de si hace falta supervisor para líneas a crédito (incluye cupo = 0). */
export type CreditSupervisorGate = {
   required: true;
   reason: 'NO_LIMIT' | 'OVER_LIMIT';
   projected: number;
   /** Suma de montos CREDIT en el ticket tras la operación. */
   creditOnTicket: number;
};

/**
 * Cupo &gt; 0 y dentro del límite: no requiere supervisor.
 * Cupo &gt; 0 y proyectado &gt; límite: requiere supervisor.
 * Cupo &lt;= 0 (sin configurar): cualquier monto a crédito requiere supervisor.
 */
export const evaluateCreditSupervisorGate = (
   customer: Customer,
   creditAlreadyOnTicket: number,
   additionalCredit: number
): CreditSupervisorGate | null => {
   if (additionalCredit <= 0) return null;
   const limit = customer.creditLimit || 0;
   const debt = customer.currentDebt || 0;
   const creditOnTicket = creditAlreadyOnTicket + additionalCredit;
   const projected = debt + creditOnTicket;
   if (limit > 0) {
      if (projected > limit) {
         return { required: true, reason: 'OVER_LIMIT', projected, creditOnTicket };
      }
      return null;
   }
   return { required: true, reason: 'NO_LIMIT', projected, creditOnTicket };
};

/** Nombre reservado: venta queda como crédito / CxC, no como efectivo en caja. */
export const isPendingPaymentMethodName = (name: string): boolean => {
  const t = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (t === 'pendiente') return true;
  // "PENDIENTE DE COBRO", "pendiente pago", variantes en catálogo
  if (t.startsWith('pendiente')) return true;
  return false;
};

/** Línea que aumenta CxC: tipo CREDIT o etiqueta tipo Pendiente (corrige configs con type CASH). */
export const paymentEntryIsCxCCredit = (
  p: Pick<PaymentEntry, 'method' | 'methodLabel'>
): boolean => {
  if (p.method === 'CREDIT') return true;
  return isPendingPaymentMethodName(p.methodLabel || '');
};

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

export const sumCreditPaymentsBase = (
  entries: Pick<PaymentEntry, 'method' | 'methodLabel' | 'amount'>[]
): number =>
  entries
    .filter((p) => paymentEntryIsCxCCredit(p))
    .reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
