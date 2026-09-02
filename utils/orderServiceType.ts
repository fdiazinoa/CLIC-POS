import {
  OrderServiceType,
  ServiceTypeSummaryLine,
  ServiceTypeTransactionLine,
  Transaction,
  TipConfiguration,
  ServiceTaxPolicy,
} from '../types';

const SERVICE_TYPES: OrderServiceType[] = ['DINE_IN', 'TAKEOUT', 'DELIVERY'];

export const normalizeOrderServiceType = (value: unknown): OrderServiceType | undefined => {
  const normalized = String(value || '').trim().toUpperCase();
  return SERVICE_TYPES.includes(normalized as OrderServiceType)
    ? normalized as OrderServiceType
    : undefined;
};

export const resolveTransactionServiceType = (transaction: Partial<Transaction> & Record<string, any>): OrderServiceType | undefined => {
  const explicit = normalizeOrderServiceType(transaction.serviceType ?? transaction.service_type);
  if (explicit) return explicit;

  const marketplace = String(transaction.marketplaceSourceChannel || transaction.marketplace_source_channel || '')
    .trim()
    .toUpperCase();
  if (marketplace) return 'DELIVERY';

  return undefined;
};

const isSale = (transaction: Transaction) => (
  transaction.documentType !== 'REFUND'
  && transaction.documentType !== 'VOID'
  && transaction.ncfType !== 'B04'
);

export const buildServiceTypeReport = (transactions: Transaction[]): {
  summary: ServiceTypeSummaryLine[];
  transactions: ServiceTypeTransactionLine[];
} => {
  const sales = (transactions || []).filter(isSale);
  const buckets = new Map<OrderServiceType, ServiceTypeSummaryLine>(SERVICE_TYPES.map(serviceType => [
    serviceType,
    { serviceType, transactionCount: 0, total: 0, taxAmount: 0, serviceChargeAmount: 0 },
  ]));
  const details: ServiceTypeTransactionLine[] = [];

  sales.forEach(transaction => {
    const serviceType = resolveTransactionServiceType(transaction);
    if (!serviceType) return;

    const bucket = buckets.get(serviceType)!;
    bucket.transactionCount += 1;
    bucket.total += Number(transaction.total || 0);
    bucket.taxAmount += Number(transaction.taxAmount || 0);
    bucket.serviceChargeAmount += Number(transaction.serviceChargeAmount || 0);

    if (serviceType === 'TAKEOUT' || serviceType === 'DELIVERY') {
      details.push({
        transactionId: transaction.id,
        displayId: transaction.displayId || transaction.id,
        date: transaction.date,
        serviceType,
        total: Number(transaction.total || 0),
      });
    }
  });

  return {
    summary: SERVICE_TYPES.map(serviceType => {
      const bucket = buckets.get(serviceType)!;
      return {
        ...bucket,
        total: Math.round((bucket.total + Number.EPSILON) * 100) / 100,
        taxAmount: Math.round((bucket.taxAmount + Number.EPSILON) * 100) / 100,
        serviceChargeAmount: Math.round((bucket.serviceChargeAmount + Number.EPSILON) * 100) / 100,
      };
    }),
    transactions: details.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
  };
};

export const getOrderServiceTypeLabel = (serviceType: OrderServiceType): string => {
  switch (serviceType) {
    case 'TAKEOUT': return 'Para llevar';
    case 'DELIVERY': return 'Delivery';
    default: return 'Consumo en mesa';
  }
};

export const shouldApplyRestaurantServiceCharge = (input: {
  isRestaurantMode: boolean;
  serviceType: OrderServiceType;
  serviceCharge?: TipConfiguration['serviceCharge'];
  grossAfterDiscount: number;
  guests: number;
  legalTipPolicy?: ServiceTaxPolicy['legalTip'];
}): boolean => {
  const { isRestaurantMode, serviceType, serviceCharge, legalTipPolicy, grossAfterDiscount, guests } = input;
  const hasExplicitPolicy = legalTipPolicy !== undefined;
  const enabled = hasExplicitPolicy ? legalTipPolicy.enabled : serviceCharge?.enabled;
  if (!enabled) return false;
  if (!hasExplicitPolicy && (!isRestaurantMode || serviceType !== 'DINE_IN')) return false;

  const totalOver = Number(serviceCharge?.applyIfTotalOver || 0);
  const guestsOver = Number(serviceCharge?.applyIfGuestsOver || 0);
  if (totalOver === 0 && guestsOver === 0) return true;

  return (totalOver > 0 && grossAfterDiscount >= totalOver)
    || (guestsOver > 0 && guests >= guestsOver);
};
