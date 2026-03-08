import { CartItem, Transaction } from '../types';
import { db } from '../utils/db';

type RefundCondition = 'SELLABLE' | 'DAMAGED';

interface PersistRefundOptions {
  warehouseId: string;
  terminalId?: string;
  originalTransaction?: Transaction | null;
  conditions?: Map<string, RefundCondition>;
}

const emitCollectionUpdate = (collection: 'transactions' | 'products' | 'productStocks') => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(`${collection}Updated`));
};

const normalizeRefundItems = (items: CartItem[]): CartItem[] => {
  return (items || [])
    .map(item => ({
      ...item,
      quantity: Math.abs(Number(item.quantity || 0))
    }))
    .filter(item => item.quantity > 0);
};

export async function persistStandaloneRefundTransaction(
  refundTransaction: Transaction,
  options: PersistRefundOptions
): Promise<{ refund: Transaction; updatedOriginal?: Transaction }> {
  const normalizedItems = normalizeRefundItems(refundTransaction.items || []);
  const refundTotal = Math.abs(
    Number(refundTransaction.total || normalizedItems.reduce((acc, item) => acc + ((item.price || 0) * item.quantity), 0))
  );
  const originalTransaction = options.originalTransaction || null;
  const effectiveTerminalId = refundTransaction.terminalId || options.terminalId || originalTransaction?.terminalId || 'T1';
  const refundDocumentRef = originalTransaction?.displayId || refundTransaction.affectedInvoiceNumber || refundTransaction.displayId || refundTransaction.id;

  const persistedRefund: Transaction = {
    ...refundTransaction,
    terminalId: effectiveTerminalId,
    items: normalizedItems,
    total: refundTotal,
    status: 'REFUNDED',
    customerId: refundTransaction.customerId || originalTransaction?.customerId,
    customerName: refundTransaction.customerName || originalTransaction?.customerName,
    originalTransactionId: refundTransaction.originalTransactionId || originalTransaction?.id,
    affectedInvoiceNumber: refundTransaction.affectedInvoiceNumber || originalTransaction?.displayId || originalTransaction?.id,
    affectedNCF: refundTransaction.affectedNCF || originalTransaction?.ncf,
    syncStatus: 'PENDING'
  };

  await db.saveDocument('transactions', persistedRefund);
  await db.saveDocument('transactionHistory', persistedRefund as any);

  for (const item of normalizedItems) {
    const qty = Math.abs(Number(item.quantity || 0));
    if (qty <= 0) continue;

    const condition = options.conditions?.get(item.cartId) || 'SELLABLE';
    await db.recordInventoryMovement(
      options.warehouseId,
      item.id,
      'DEVOLUCIÓN_VENTA',
      `Devolución Ticket #${refundDocumentRef}`,
      qty,
      undefined,
      effectiveTerminalId,
      item.variantSku,
      item.variantInfo,
      item.trackingId,
      item.trackingCode
    );

    if (condition === 'DAMAGED') {
      await db.recordInventoryMovement(
        options.warehouseId,
        item.id,
        'AJUSTE_SALIDA',
        'MERMA_POR_DEVOLUCION',
        qty,
        undefined,
        effectiveTerminalId,
        item.variantSku,
        item.variantInfo,
        item.trackingId,
        item.trackingCode
      );
    }
  }

  let updatedOriginal: Transaction | undefined;
  if (originalTransaction) {
    const totalOriginalQty = (originalTransaction.items || []).reduce((acc, item) => acc + Math.abs(Number(item.quantity || 0)), 0);
    const refundedQty = normalizedItems.reduce((acc, item) => acc + Math.abs(Number(item.quantity || 0)), 0);
    const nextStatus = refundedQty >= totalOriginalQty ? 'REFUNDED' : 'PARTIAL_REFUND';

    updatedOriginal = {
      ...originalTransaction,
      status: nextStatus,
      relatedTransactions: Array.from(new Set([...(originalTransaction.relatedTransactions || []), persistedRefund.id])),
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING'
    } as Transaction;

    await db.saveDocument('transactions', updatedOriginal);
    await db.saveDocument('transactionHistory', updatedOriginal as any);
  }

  emitCollectionUpdate('transactions');
  emitCollectionUpdate('products');
  emitCollectionUpdate('productStocks');

  import('./sync/BackgroundSyncManager').then(m => {
    m.backgroundSyncManager.triggerSync().catch(console.error);
  });

  return {
    refund: persistedRefund,
    updatedOriginal
  };
}

export async function persistStandaloneSaleHistory(transaction: Transaction): Promise<void> {
  await db.saveDocument('transactionHistory', {
    ...transaction,
    syncStatus: transaction.syncStatus || 'PENDING'
  } as any);
  emitCollectionUpdate('transactions');
}
