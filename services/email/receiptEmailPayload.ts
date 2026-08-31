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

const normalizeOptionKey = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLocaleLowerCase();

const resolveVariantValueKeys = (variantInfo: string): Set<string> => {
  const values = variantInfo
    .split(/[\/|·]/)
    .map(part => part.includes(':') ? part.slice(part.indexOf(':') + 1) : part)
    .map(part => normalizeOptionKey(part))
    .filter(Boolean);

  return new Set(values);
};

const normalizeDiscountPercentage = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
};

const roundMoney = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
};

const buildReceiptEmailPayment = (
  payment: NonNullable<Transaction['payments']>[number],
  baseCurrencyCode: string,
): Record<string, unknown> => {
  const method = payment.method || payment.payment_method;
  const normalizedMethod = String(method || '').trim().toUpperCase();
  const amount = roundMoney(payment.amount);
  const settledAmount = roundMoney(
    payment.appliedAmount ?? payment.applied_amount ?? payment.amountApplied ?? payment.amount,
  );
  const changeAmount = roundMoney(
    payment.changeAmount ?? payment.change_amount ?? Math.max(0, amount - settledAmount),
  );
  const currencyCode = String(payment.currencyCode || payment.currency_code || baseCurrencyCode)
    .trim()
    .toUpperCase();
  const isBaseCurrencyCashWithChange = ['CASH', 'EFECTIVO'].includes(normalizedMethod)
    && currencyCode === baseCurrencyCode
    && changeAmount > 0;

  return {
    method,
    methodLabel: isBaseCurrencyCashWithChange
      ? 'Efectivo recibido'
      : payment.methodLabel,
    amount,
    amountOriginal: payment.amountOriginal == null ? undefined : Number(payment.amountOriginal),
    // El renderer legado usa appliedAmount como monto visible. Cuando hay cambio lo
    // omitimos para que muestre amount (efectivo entregado) y conservamos el valor
    // contable aplicado en settledAmount.
    ...(isBaseCurrencyCashWithChange ? {} : { appliedAmount: settledAmount }),
    receivedAmount: amount,
    settledAmount,
    displayAmount: amount,
    displayLabel: isBaseCurrencyCashWithChange
      ? 'Efectivo recibido'
      : payment.methodLabel,
    currencyCode,
    exchangeRate: payment.exchangeRate == null && payment.exchange_rate == null
      ? undefined
      : Number(payment.exchangeRate ?? payment.exchange_rate),
    changeAmount: payment.changeAmount == null && payment.change_amount == null && changeAmount <= 0
      ? undefined
      : changeAmount,
    changeCurrencyCode: payment.changeCurrencyCode || payment.change_currency_code,
  };
};

export const resolveReceiptItemOptions = (item: CartItem): string[] => {
  const variantInfo = asText(item.variantInfo);
  const variantValueKeys = resolveVariantValueKeys(variantInfo);
  const modifierCandidates: unknown[] = [
    ...(item.modifiers || []),
    ...(item.selected_modifiers || []),
    ...(item.restaurantConfig?.selected_modifiers || []),
  ];
  const candidates: unknown[] = [
    ...modifierCandidates
      .map(asText)
      .filter(value => value && !variantValueKeys.has(normalizeOptionKey(value))),
    variantInfo,
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
  const baseCurrencyCode = String(
    config?.currencies?.find(currency => currency.isBase)?.code || 'DOP',
  ).trim().toUpperCase();
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
      itemDiscountRate: normalizeDiscountPercentage(item.discountRate, discount.discountPercentage),
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
    payments: (transaction.payments || []).map(payment => buildReceiptEmailPayment(payment, baseCurrencyCode)),
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
    showForeignCurrencyTotals: config?.receiptConfig?.showForeignCurrencyTotals || false,
    showOrderNumber: config?.receiptConfig?.showOrderNumber || false,
    orderNumber: transaction.orderNumber,
    currencies: (config?.currencies || [])
      .filter(currency => currency.isBase || currency.isEnabled)
      .map(currency => ({
        code: currency.code,
        name: currency.name,
        symbol: currency.symbol,
        rate: Number(currency.rate || 0),
        isBase: Boolean(currency.isBase),
        isEnabled: Boolean(currency.isEnabled),
      })),
    receiptDesign: {
      showCustomerInfo: config?.receiptConfig?.showCustomerInfo || false,
      showSavings: config?.receiptConfig?.showSavings || false,
      showQr: config?.receiptConfig?.showQr !== false,
      showForeignCurrencyTotals: config?.receiptConfig?.showForeignCurrencyTotals || false,
      showSerialNumbers: config?.receiptConfig?.showSerialNumbers || false,
      showLotNumbers: config?.receiptConfig?.showLotNumbers || false,
      showOrderNumber: config?.receiptConfig?.showOrderNumber || false,
      footerMessage: config?.receiptConfig?.footerMessage,
    },
    terminalName: transaction.terminalName,
    tableLabel: transaction.tableDisplayLabel,
  };
};
