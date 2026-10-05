import { BusinessConfig, CartItem, Transaction } from '../types';
import { isV3FinancialDocument, persistV3FinancialTransaction } from './sync/LargeMasterSyncV3FinancialCommit';
import { db } from '../utils/db';
import { getRemainingRefundQuantities, hasRefundableItems } from '../utils/refundAvailability';

type RefundCondition = 'SELLABLE' | 'DAMAGED';

interface PersistRefundOptions {
  warehouseId: string;
  terminalId?: string;
  originalTransaction?: Transaction | null;
  conditions?: Map<string, RefundCondition>;
  persistOriginal?: boolean;
  adjustCustomerBalance?: boolean;
  skipWalletDeposit?: boolean;
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

  if (isV3FinancialDocument(persistedRefund)) {
    const config = await db.getDocument('config', 'current') as BusinessConfig | null;
    if (!config) throw new Error('SYNC_V3_CONFIG_REQUIRED');
    const updatedOriginal = originalTransaction && options.persistOriginal !== false ? {
      ...originalTransaction, status: originalTransaction.status,
      relatedTransactions: Array.from(new Set([...(originalTransaction.relatedTransactions || []), persistedRefund.id])),
      syncStatus: 'PENDING' as const,
    } : undefined;
    const expectedOriginal = updatedOriginal
      ? await db.getDocument('transactions', updatedOriginal.id) as Transaction | null : null;
    const expectedOriginalHistory = updatedOriginal
      ? await db.getDocument('transactionHistory', updatedOriginal.id) as Transaction | null : null;
    if (updatedOriginal && !expectedOriginal) throw new Error('SYNC_V3_REFUND_ORIGINAL_CHANGED');
    const result = await persistV3FinancialTransaction(persistedRefund, config, options.warehouseId,
      { refund: true, conditions: options.conditions, original: updatedOriginal,
        expectedOriginal: expectedOriginal || undefined, expectedOriginalHistory,
        adjustCustomerBalance: options.adjustCustomerBalance, skipWalletDeposit: options.skipWalletDeposit });
    if (result.created) {
      emitCollectionUpdate('transactions');
      import('./sync/BackgroundSyncManager').then(module => { void module.backgroundSyncManager.triggerSync().catch(console.error); });
    }
    return { refund: result.transaction, updatedOriginal };
  }

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
  if (originalTransaction && options.persistOriginal !== false) {
    const persistedTransactions = await db.get('transactions') as Transaction[];
    const remaining = getRemainingRefundQuantities(
      originalTransaction,
      Array.isArray(persistedTransactions) ? persistedTransactions : [persistedRefund]
    );
    const nextStatus = hasRefundableItems(remaining) ? 'PARTIAL_REFUND' : 'REFUNDED';

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
