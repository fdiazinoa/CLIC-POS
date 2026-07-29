import { CartItem, Transaction } from '../types';

const normalizeReference = (value: unknown): string => String(value || '').trim().toLowerCase();

export const getRefundItemKey = (item: CartItem): string => {
  const cartId = normalizeReference(item.cartId);
  if (cartId) return `cart:${cartId}`;

  return [
    'product',
    normalizeReference(item.id),
    normalizeReference(item.variantSku),
    normalizeReference(item.trackingId),
  ].join(':');
};

export const isRefundForTransaction = (candidate: Transaction, original: Transaction): boolean => {
  if (candidate.id === original.id) return false;

  const isRefundDocument =
    candidate.documentType === 'REFUND'
    || candidate.ncfType === 'B04'
    || candidate.status === 'REFUNDED' && Boolean(candidate.originalTransactionId || candidate.affectedInvoiceNumber);
  if (!isRefundDocument) return false;

  const originalReferences = new Set(
    [original.id, original.displayId, original.ncf]
      .map(normalizeReference)
      .filter(Boolean)
  );

  return originalReferences.has(normalizeReference(candidate.originalTransactionId))
    || originalReferences.has(normalizeReference(candidate.affectedInvoiceNumber))
    || originalReferences.has(normalizeReference(candidate.affectedNCF))
    || (original.relatedTransactions || []).some(id => normalizeReference(id) === normalizeReference(candidate.id));
};

export const getRemainingRefundQuantities = (
  original: Transaction,
  transactions: Transaction[]
): Map<string, number> => {
  const purchased = new Map<string, number>();
  (original.items || []).forEach(item => {
    const key = getRefundItemKey(item);
    purchased.set(key, (purchased.get(key) || 0) + Math.abs(Number(item.quantity || 0)));
  });

  const refunded = new Map<string, number>();
  Array.from(new Map(transactions.map(transaction => [transaction.id, transaction])).values())
    .filter(candidate => isRefundForTransaction(candidate, original))
    .forEach(refund => {
      (refund.items || []).forEach(item => {
        const key = getRefundItemKey(item);
        refunded.set(key, (refunded.get(key) || 0) + Math.abs(Number(item.quantity || 0)));
      });
    });

  const remaining = new Map<string, number>();
  (original.items || []).forEach(item => {
    const key = getRefundItemKey(item);
    remaining.set(key, Math.max(0, (purchased.get(key) || 0) - (refunded.get(key) || 0)));
  });
  return remaining;
};

export const validateRefundItems = (
  original: Transaction,
  requestedItems: CartItem[],
  transactions: Transaction[]
): { valid: true; remaining: Map<string, number> } | { valid: false; message: string; remaining: Map<string, number> } => {
  const remaining = getRemainingRefundQuantities(original, transactions);
  const requestedByKey = new Map<string, number>();

  requestedItems.forEach(item => {
    const key = getRefundItemKey(item);
    requestedByKey.set(key, (requestedByKey.get(key) || 0) + Math.abs(Number(item.quantity || 0)));
  });

  for (const [key, requested] of requestedByKey) {
    const available = remaining.get(key) || 0;
    if (requested > available) {
      return {
        valid: false,
        message: available > 0
          ? `La cantidad solicitada excede el saldo pendiente de devolución (${available}).`
          : 'Uno o más artículos ya fueron abonados completamente.',
        remaining,
      };
    }
  }

  if (requestedByKey.size === 0) {
    return { valid: false, message: 'Seleccione al menos un artículo para devolver.', remaining };
  }

  return { valid: true, remaining };
};

export const hasRefundableItems = (remaining: Map<string, number>): boolean =>
  Array.from(remaining.values()).some(quantity => quantity > 0);
