import type { CartItem, ErpRefundAuthority, ErpRefundPreparation, ErpRefundSourceBinding, Transaction } from '../../types';
import { getRefundItemKey } from '../../utils/refundAvailability';

type JsonRecord = Record<string, any>;

export interface ErpRefundSourceMatch {
  sourceId: string;
  sourceRevision: string;
  reference: string;
  displayId: string;
  ncf?: string;
  date: string;
  total: number;
  terminalName?: string;
  refundable: boolean;
  eligibilityCode?: string;
  eligibilityMessage?: string;
  transaction?: Transaction;
}

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonRecord
  : {};

const first = (source: JsonRecord, ...keys: string[]) => {
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key];
  return undefined;
};

const text = (value: unknown): string => String(value ?? '').trim();
const finite = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizePayment = (value: unknown, index: number) => {
  const payment = record(value);
  const timestamp = first(payment, 'timestamp', 'createdAt', 'created_at');
  return {
    ...payment,
    id: text(first(payment, 'id', 'paymentId', 'payment_id')) || `erp-payment-${index}`,
    method: text(first(payment, 'method', 'paymentMethod', 'payment_method')) || 'OTHER',
    amount: finite(first(payment, 'amount', 'appliedAmount', 'applied_amount')),
    timestamp: timestamp ? new Date(timestamp) : new Date(0),
  };
};

const normalizeLine = (value: unknown, index: number): CartItem => {
  const line = record(value);
  const cartId = text(first(line, 'cartId', 'cart_id', 'lineId', 'line_id'));
  const productId = text(first(line, 'id', 'productId', 'product_id'));
  if (!cartId || !productId) throw new Error('REFUND_SOURCE_LINE_IDENTITY_MISSING');
  return {
    ...line,
    id: productId,
    cartId,
    name: text(first(line, 'name', 'productName', 'product_name', 'description')) || `Artículo ${index + 1}`,
    quantity: Math.abs(finite(first(line, 'quantity', 'soldQuantity', 'sold_quantity'))),
    price: finite(first(line, 'price', 'unitPrice', 'unit_price')),
  } as CartItem;
};

const normalizeEligibility = (source: JsonRecord) => {
  const eligibility = record(first(source, 'eligibility', 'refundEligibility', 'refund_eligibility'));
  const refundableValue = first(eligibility, 'refundable', 'eligible') ?? first(source, 'refundable', 'eligible');
  const restrictions = Array.isArray(eligibility.restrictions) ? eligibility.restrictions.map(text).filter(Boolean) : [];
  const missing = Array.isArray(eligibility.missing) ? eligibility.missing.map(text).filter(Boolean) : [];
  return {
    refundable: refundableValue === true,
    code: text(first(eligibility, 'code', 'reasonCode', 'reason_code') ?? first(source, 'eligibilityCode', 'eligibility_code')) || undefined,
    message: text(first(eligibility, 'message', 'reason') ?? first(source, 'eligibilityMessage', 'eligibility_message'))
      || (restrictions.length > 0 ? `ERP bloqueó esta devolución: ${restrictions.join(', ')}.` : undefined)
      || (missing.length > 0 ? `El respaldo no contiene: ${missing.join(', ')}.` : undefined),
  };
};

const unwrapSource = (value: unknown): JsonRecord => {
  const wrapper = record(value);
  const nested = first(wrapper, 'source', 'refundSource', 'refund_source', 'document');
  return nested ? record(nested) : wrapper;
};

const buildBinding = (source: JsonRecord, items: CartItem[]): ErpRefundSourceBinding => {
  const availabilityRows = first(source, 'remainingQuantities', 'remaining_quantities', 'lines') as unknown;
  const remainingQuantities: Record<string, number> = {};
  if (Array.isArray(availabilityRows)) {
    availabilityRows.forEach((raw, index) => {
      const row = record(raw);
      const item = items[index];
      const cartId = text(first(row, 'cartId', 'cart_id', 'lineId', 'line_id')) || item?.cartId;
      if (!cartId) return;
      const key = getRefundItemKey({ ...(item || {}), cartId } as CartItem);
      remainingQuantities[key] = Math.max(0, finite(first(row, 'remainingRefundQuantity', 'remaining_refund_quantity', 'remainingQuantity', 'remaining_quantity')));
    });
  } else {
    const byKey = record(availabilityRows);
    items.forEach(item => {
      const raw = byKey[item.cartId] ?? byKey[getRefundItemKey(item)];
      if (raw !== undefined) remainingQuantities[getRefundItemKey(item)] = Math.max(0, finite(raw));
    });
  }
  const eligibility = normalizeEligibility(source);
  const sourceId = text(first(source, 'sourceId', 'source_id', 'id'));
  const sourceRevision = text(first(source, 'sourceRevision', 'source_revision', 'revision'));
  if (!sourceId || !sourceRevision) throw new Error('REFUND_SOURCE_IDENTITY_MISSING');
  if (items.some(item => remainingQuantities[getRefundItemKey(item)] === undefined)) {
    throw new Error('REFUND_SOURCE_AVAILABILITY_MISSING');
  }
  return {
    sourceId,
    sourceRevision,
    reference: text(first(source, 'reference', 'displayId', 'display_id', 'ncf', 'id')),
    originalTerminalId: text(first(source, 'originalTerminalId', 'original_terminal_id', 'terminalId', 'terminal_id', 'sourceTerminalId', 'source_terminal_id')) || undefined,
    remainingQuantities,
    refundable: eligibility.refundable,
    eligibilityCode: eligibility.code,
    eligibilityMessage: eligibility.message,
  };
};

export const normalizeErpRefundSourceTransaction = (value: unknown): Transaction => {
  const source = unwrapSource(value);
  const original = record(first(source, 'original', 'transaction', 'sale', 'invoice'));
  const document = Object.keys(original).length > 0 ? original : source;
  const rawItems = first(document, 'items', 'lines');
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new Error('REFUND_SOURCE_ITEMS_MISSING');
  const items = rawItems.map(normalizeLine);
  const binding = buildBinding({ ...source, ...document }, items);
  const id = text(first(document, 'id', 'sourceTransactionId', 'source_transaction_id'));
  const date = text(first(document, 'date', 'transactionDate', 'transaction_date'));
  if (!id || !date) throw new Error('REFUND_SOURCE_DOCUMENT_IDENTITY_MISSING');
  const payments = first(document, 'payments');
  return {
    ...document,
    id,
    displayId: text(first(document, 'displayId', 'display_id', 'invoiceNumber', 'invoice_number')) || id,
    date,
    items,
    total: finite(first(document, 'total', 'grandTotal', 'grand_total')),
    payments: Array.isArray(payments) ? payments.map(normalizePayment) : [],
    userId: text(first(document, 'userId', 'user_id')) || 'ERP',
    userName: text(first(document, 'userName', 'user_name', 'cashierName', 'cashier_name')) || 'ERP',
    terminalId: binding.originalTerminalId,
    status: (text(first(document, 'status')) || 'COMPLETED') as Transaction['status'],
    ncf: text(first(document, 'ncf')) || undefined,
    customerId: text(first(document, 'customerId', 'customer_id')) || undefined,
    customerName: text(first(document, 'customerName', 'customer_name')) || undefined,
    isTaxIncluded: Boolean(first(document, 'isTaxIncluded', 'is_tax_included')),
    erpRefundSource: binding,
  };
};

export const normalizeErpRefundSearchResponse = (payload: unknown): ErpRefundSourceMatch[] => {
  const envelope = record(payload);
  const rawMatches = first(envelope, 'matches', 'items', 'results');
  const rows = Array.isArray(rawMatches) ? rawMatches : (Object.keys(envelope).length > 0 ? [envelope] : []);
  return rows.map(raw => {
    const source = unwrapSource(raw);
    let transaction: Transaction | undefined;
    try { transaction = normalizeErpRefundSourceTransaction(raw); } catch { /* summaries do not contain line detail */ }
    const eligibility = normalizeEligibility(source);
    return {
      sourceId: text(first(source, 'sourceId', 'source_id', 'id')),
      sourceRevision: text(first(source, 'sourceRevision', 'source_revision', 'revision')),
      reference: text(first(source, 'reference', 'displayId', 'display_id', 'ncf', 'id')),
      displayId: text(first(source, 'displayId', 'display_id', 'invoiceNumber', 'invoice_number', 'reference')),
      ncf: text(first(source, 'ncf')) || undefined,
      date: text(first(source, 'date', 'transactionDate', 'transaction_date')),
      total: finite(first(source, 'total', 'grandTotal', 'grand_total')),
      terminalName: text(first(source, 'terminalName', 'terminal_name')) || undefined,
      refundable: transaction?.erpRefundSource?.refundable ?? eligibility.refundable,
      eligibilityCode: transaction?.erpRefundSource?.eligibilityCode ?? eligibility.code,
      eligibilityMessage: transaction?.erpRefundSource?.eligibilityMessage ?? eligibility.message,
      transaction,
    };
  });
};

export const getErpRemainingQuantities = (transaction: Transaction): Map<string, number> =>
  new Map(Object.entries(transaction.erpRefundSource?.remainingQuantities || {}));

export const validateErpRefundItems = (
  transaction: Transaction,
  requestedItems: CartItem[],
): { valid: true; remaining: Map<string, number> } | { valid: false; message: string; remaining: Map<string, number> } => {
  const remaining = getErpRemainingQuantities(transaction);
  const requested = new Map<string, number>();
  requestedItems.forEach(item => {
    const key = getRefundItemKey(item);
    requested.set(key, (requested.get(key) || 0) + Math.abs(Number(item.quantity || 0)));
  });
  if (requested.size === 0) return { valid: false, message: 'Seleccione al menos un artículo para devolver.', remaining };
  for (const [key, quantity] of requested) {
    const available = remaining.get(key) || 0;
    if (quantity > available) {
      return {
        valid: false,
        message: available > 0
          ? `La cantidad solicitada excede el saldo confirmado por ERP (${available}).`
          : 'Uno o más artículos ya fueron abonados completamente.',
        remaining,
      };
    }
  }
  return { valid: true, remaining };
};

export const normalizeErpRefundPreparation = (
  payload: unknown,
  expected: { commandId: string; sourceId: string; sourceRevision: string },
): { preparation: ErpRefundPreparation; authority: ErpRefundAuthority } => {
  const root = record(payload);
  const prepared = record(first(root, 'preparation') || root);
  const commandId = text(first(prepared, 'commandId', 'command_id'));
  const reservationId = text(first(prepared, 'reservationId', 'reservation_id'));
  const sourceId = text(first(prepared, 'sourceId', 'source_id'));
  const sourceRevision = text(first(prepared, 'sourceRevision', 'source_revision'));
  if (commandId !== expected.commandId || sourceId !== expected.sourceId || sourceRevision !== expected.sourceRevision || !reservationId) {
    throw new Error('REFUND_PREPARATION_IDENTITY_MISMATCH');
  }
  const document = record(first(root, 'documentAuthority', 'document_authority') || first(prepared, 'documentAuthority', 'document_authority'));
  const seriesId = text(first(document, 'seriesId', 'series_id'));
  const seriesNumber = Number(first(document, 'seriesNumber', 'series_number'));
  const displayId = text(first(document, 'displayId', 'display_id'));
  if (!seriesId || !Number.isSafeInteger(seriesNumber) || seriesNumber < 1 || !displayId) {
    throw new Error('REFUND_DOCUMENT_AUTHORITY_INVALID');
  }
  const rawFiscal = first(root, 'fiscalAuthority', 'fiscal_authority') ?? first(prepared, 'fiscalAuthority', 'fiscal_authority');
  let fiscalAuthority: ErpRefundAuthority['fiscalAuthority'] = null;
  if (rawFiscal !== null && rawFiscal !== undefined) {
    const fiscal = record(rawFiscal);
    const ncfType = text(first(fiscal, 'ncfType', 'ncf_type'));
    const ncf = text(first(fiscal, 'ncf'));
    const fiscalReservationId = text(first(fiscal, 'reservationId', 'reservation_id'));
    if (ncfType !== 'B04' || !/^B04\d{8}$/.test(ncf) || fiscalReservationId !== reservationId) {
      throw new Error('REFUND_FISCAL_AUTHORITY_INVALID');
    }
    fiscalAuthority = { ncfType: 'B04', ncf, reservationId: fiscalReservationId };
  }
  return {
    preparation: {
      commandId,
      reservationId,
      sourceId,
      sourceRevision,
      expiresAt: text(first(prepared, 'expiresAt', 'expires_at')) || undefined,
    },
    authority: {
      documentAuthority: { seriesId, seriesNumber, displayId },
      fiscalAuthority,
    },
  };
};
