import type { BusinessConfig, PaymentEntry, Transaction, ZReport, ZReportPaymentMethodLine } from '../types';
import { paymentEntryIsCxCCredit, resolvePaymentMethodTypeForRuntime } from './creditRules';
import { getPaymentAppliedBaseAmount } from './paymentSettlement';

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const DEFAULT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  CREDIT: 'Pendiente',
  PENDING: 'Pendiente',
  PENDIENTE: 'Pendiente',
  QR: 'Digital',
  TRANSFER: 'Transferencia',
  CHECK: 'Cheque',
  WALLET: 'Wallet',
  ADVANCE: 'Anticipo',
  STORE_CREDIT: 'Nota de crédito',
  OTHER: 'Otro',
};

const normalize = (value: unknown): string => String(value || '').trim();

const resolveConfiguredMethod = (payment: Partial<PaymentEntry>, config?: BusinessConfig) => {
  const methods = config?.paymentMethods || [];
  const methodId = normalize(payment.methodId);
  if (methodId) {
    const byId = methods.find(method => normalize(method.id).toLowerCase() === methodId.toLowerCase());
    if (byId) return byId;
  }
  const label = normalize(payment.methodLabel);
  if (label) {
    const byName = methods.find(method => normalize(method.name).toLowerCase() === label.toLowerCase());
    if (byName) return byName;
  }
  const runtimeType = resolvePaymentMethodTypeForRuntime(payment.method, payment.methodLabel, payment.methodId);
  const sameType = methods.filter(method => method.type === runtimeType && method.isEnabled !== false);
  return sameType.length === 1 ? sameType[0] : undefined;
};

export const resolveZReportPaymentMethodName = (
  payment: Partial<PaymentEntry>,
  config?: BusinessConfig,
): string => {
  const configured = resolveConfiguredMethod(payment, config);
  if (configured?.name) return configured.name;
  const explicitLabel = normalize(payment.methodLabel);
  if (explicitLabel && explicitLabel.toUpperCase() !== normalize(payment.method).toUpperCase()) return explicitLabel;
  const runtimeType = resolvePaymentMethodTypeForRuntime(payment.method, payment.methodLabel, payment.methodId);
  return DEFAULT_METHOD_LABELS[runtimeType] || DEFAULT_METHOD_LABELS[normalize(payment.method).toUpperCase()] || explicitLabel || 'Otro';
};

/**
 * Builds the settlement breakdown for a close. Cash is represented by the amount
 * applied to the ticket, not the amount tendered before change. Deferred credit is
 * still included because it is a valid way in which the ticket was settled.
 */
export const buildZReportPaymentMethodSummary = (
  transactions: Transaction[],
  config?: BusinessConfig,
): ZReportPaymentMethodLine[] => {
  const buckets = new Map<string, ZReportPaymentMethodLine>();

  for (const transaction of transactions || []) {
    if (transaction.documentType === 'VOID') continue;
    const isRefund = transaction.documentType === 'REFUND' || transaction.ncfType === 'B04';
    for (const payment of transaction.payments || []) {
      if (!payment) continue;
      const configured = resolveConfiguredMethod(payment, config);
      const methodType = resolvePaymentMethodTypeForRuntime(payment.method, payment.methodLabel, payment.methodId);
      const methodId = normalize(payment.methodId || configured?.id) || undefined;
      const name = resolveZReportPaymentMethodName(payment, config);
      const isPending = paymentEntryIsCxCCredit(payment);
      const baseAmount = isPending ? Number(payment.amount || 0) : getPaymentAppliedBaseAmount(payment);
      const amount = isRefund ? -Math.abs(baseAmount) : baseAmount;
      const key = methodId ? `id:${methodId.toLowerCase()}` : `label:${name.toLowerCase()}:${methodType}`;
      const current = buckets.get(key);
      buckets.set(key, {
        methodId,
        methodType,
        name,
        amount: roundMoney((current?.amount || 0) + amount),
        isPending,
      });
    }
  }

  return [...buckets.values()].filter(line => Math.abs(line.amount) > 0.0001);
};

export const getZReportPaymentMethodSummary = (
  report: Pick<ZReport, 'paymentMethodSummary' | 'totalsByMethod'>,
  config?: BusinessConfig,
): ZReportPaymentMethodLine[] => {
  if (Array.isArray(report.paymentMethodSummary) && report.paymentMethodSummary.length > 0) {
    return report.paymentMethodSummary;
  }
  return Object.entries(report.totalsByMethod || {}).map(([method, amount]) => {
    const runtimeType = resolvePaymentMethodTypeForRuntime(method, method, method);
    return {
      methodId: method,
      methodType: runtimeType,
      name: resolveZReportPaymentMethodName({ method: runtimeType, methodId: method, methodLabel: method }, config),
      amount: roundMoney(Number(amount || 0)),
      isPending: runtimeType === 'CREDIT',
    };
  });
};

export const paymentMethodSummaryTotal = (lines: ZReportPaymentMethodLine[]): number => (
  roundMoney(lines.reduce((total, line) => total + Number(line.amount || 0), 0))
);
