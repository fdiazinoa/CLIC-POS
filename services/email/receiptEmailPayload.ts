import type { BusinessConfig, CartItem, Transaction, User } from '../../types';
import { FISCAL_DOCUMENT_LABELS, getFiscalCodeFromNcf } from '../../utils/fiscal/fiscalHelpers';
import { resolveLineDiscountPresentation } from '../../utils/lineDiscountPresentation';
import { resolveTerminalSellerName } from '../../utils/terminalSnapshotSellers';
import type { ReceiptEmailPayload } from './receiptEmailService';

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const entry = value as Record<string, unknown>;
  return [entry.name, entry.label, entry.value, entry.description]
    .map(candidate => typeof candidate === 'string' ? candidate.trim() : '')
    .find(Boolean) || '';
};

export const resolveReceiptItemOptions = (item: CartItem): string[] => {
  const candidates: unknown[] = [
    ...(item.modifiers || []),
    ...(item.selected_modifiers || []),
    ...(item.restaurantConfig?.selected_modifiers || []),
    item.variantInfo,
    item.note || item.restaurantConfig?.note,
  ];

  return [...new Set(candidates.map(asText).filter(Boolean))];
};

export const buildReceiptEmailPayload = (
  transaction: Transaction,
  email: string,
  config: BusinessConfig | undefined,
  currencySymbol: string,
  users: User[] = [],
): ReceiptEmailPayload => {
  const fiscalCode = transaction.ncfType || getFiscalCodeFromNcf(transaction.ncf);
  const fiscalDocumentLabel = fiscalCode ? FISCAL_DOCUMENT_LABELS[fiscalCode] : undefined;
  const cart = (transaction.items || []).map(item => {
    const discount = resolveLineDiscountPresentation(item);
    const explicitDiscount = Math.max(0, Number(item.discountAmount || 0));
    const itemDiscountAmount = Math.max(discount.discountAmount, explicitDiscount);
    const sellerName = config
      ? resolveTerminalSellerName(item.salespersonId, config, transaction.terminalId, users)
      : null;

    return {
      ...item,
      unitPrice: Number(item.price || 0),
      originalUnitPrice: discount.originalUnitPrice,
      lineTotal: Number(item.totalAmount ?? discount.finalLineTotal),
      itemDiscountAmount,
      itemDiscountRate: Number(item.discountRate ?? discount.discountPercentage),
      itemTaxAmount: Number(item.taxAmount || 0),
      options: resolveReceiptItemOptions(item),
      sellerName: sellerName || undefined,
    };
  });

  return {
    email,
    cart,
    total: Number(transaction.total || 0),
    paymentMethod: transaction.payments?.[0]?.method || 'CASH',
    transactionId: transaction.displayId || transaction.id || 'PENDING-ID',
    ncf: transaction.ncf,
    ncfType: fiscalCode || undefined,
    fiscalDocumentLabel,
    fiscalMode: transaction.fiscalMode,
    fiscalStatus: transaction.fiscalSyncStatus,
    fiscalReferenceId: transaction.fiscalReferenceId,
    fiscalValidated: fiscalCode?.startsWith('E') && transaction.fiscalSyncStatus === 'SYNCED',
    date: transaction.date,
    cashierName: transaction.userName,
    customerName: transaction.customerSnapshot?.name || transaction.customerName,
    customerTaxId: transaction.customerSnapshot?.taxId,
    companyInfo: config?.companyInfo,
    currencySymbol,
    subtotal: Number(transaction.netAmount || 0) + Number(transaction.discountAmount || 0),
    tax: Number(transaction.taxAmount || 0),
    discount: Number(transaction.discountAmount || 0),
    discountType: transaction.discountType,
    discountValue: transaction.discountValue,
    totalSavings: cart.reduce((sum, item) => sum + Number(item.itemDiscountAmount || 0), 0)
      + Number(transaction.discountAmount || 0),
    showSavings: config?.receiptConfig?.showSavings || false,
    footerMessage: config?.receiptConfig?.footerMessage,
    showQr: config?.receiptConfig?.showQr !== false,
    terminalName: transaction.terminalName,
    tableLabel: transaction.tableDisplayLabel,
  };
};
