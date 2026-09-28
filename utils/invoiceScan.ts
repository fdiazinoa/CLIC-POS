import type { Transaction } from '../types';

const normalize = (value: unknown): string => {
  const text = String(value || '').trim();
  if (!text) return '';
  try { return decodeURIComponent(text).toUpperCase(); } catch { return text.toUpperCase(); }
};

const add = (target: Set<string>, value: unknown) => {
  const normalized = normalize(value);
  if (normalized) target.add(normalized);
};

export const isRecognizedInvoiceScan = (rawValue: string): boolean => {
  const raw = rawValue.trim();
  if (/^(TCK|INV|B0[1-4]|E3[1245]|NC|TXN-)/i.test(raw)) return true;
  if (/dgii\.gov\.do/i.test(raw)) {
    try {
      const url = new URL(raw);
      if (/dgii\.gov\.do$/i.test(url.hostname) || /\.dgii\.gov\.do$/i.test(url.hostname)) return true;
    } catch { return false; }
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(raw)) return true;
  if (!raw.startsWith('{') || !raw.endsWith('}')) return false;
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    return ['INVOICE', 'INVOICE_RETURN', 'FISCAL_INVOICE', 'TICKET'].includes(normalize(payload.type));
  } catch {
    return false;
  }
};

export const shouldRouteInvoiceScan = (
  rawValue: string,
  matches: { coupon?: boolean; scale?: boolean; product?: boolean } = {},
): boolean => !matches.coupon && !matches.scale && !matches.product && isRecognizedInvoiceScan(rawValue);

export const extractInvoiceScanReferences = (rawValue: string): string[] => {
  const raw = rawValue.trim();
  const references = new Set<string>();
  if (!raw) return [];

  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      const type = normalize(payload.type);
      if (!type || ['INVOICE', 'INVOICE_RETURN', 'FISCAL_INVOICE', 'TICKET'].includes(type)) {
        ['id', 'invoiceId', 'invoice_id', 'transactionId', 'transaction_id', 'displayId', 'display_id',
          'ncf', 'electronicNcf', 'electronic_ncf', 'fiscalReferenceId', 'fiscal_reference_id',
          'sourceId', 'source_id', 'reference', 'trackId'].forEach(key => add(references, payload[key]));
      }
      return [...references];
    } catch {
      return [];
    }
  }

  try {
    const url = new URL(raw);
    if (/dgii\.gov\.do$/i.test(url.hostname) || /\.dgii\.gov\.do$/i.test(url.hostname)) {
      ['ncf', 'e_ncf', 'encf', 'trackId', 'track_id', 'fiscalReferenceId', 'fiscal_reference_id', 'id']
        .forEach(key => add(references, url.searchParams.get(key)));
      add(references, url.pathname.split('/').filter(Boolean).at(-1));
      return [...references];
    }
  } catch {
    // Plain receipt payloads are expected and handled below.
  }

  add(references, raw);
  return [...references];
};

export const resolveInvoiceSearchReference = (rawValue: string): string =>
  extractInvoiceScanReferences(rawValue)[0] || rawValue.trim();

export const transactionInvoiceScanAliases = (transaction: Transaction): string[] => {
  const aliases = new Set<string>();
  [
    transaction.id,
    transaction.displayId,
    transaction.ncf,
    transaction.electronicNcf,
    transaction.fiscalCertifiedNcf,
    transaction.fiscalReferenceId,
    transaction.fiscalQrUrl,
    transaction.source_transaction_id,
    transaction.source_display_id,
    transaction.erpRefundSource?.sourceId,
    transaction.erpRefundSource?.reference,
  ].forEach(alias => add(aliases, alias));
  if (transaction.fiscalQrUrl) {
    extractInvoiceScanReferences(transaction.fiscalQrUrl).forEach(reference => add(aliases, reference));
  }
  return [...aliases];
};

export type InvoiceScanResolution =
  | { status: 'MATCH'; transactionId: string; transaction: Transaction }
  | { status: 'AMBIGUOUS'; transactionIds: string[] }
  | { status: 'NOT_FOUND' | 'INVALID' };

export const resolveInvoiceScan = (rawValue: string, transactions: Transaction[]): InvoiceScanResolution => {
  const references = new Set(extractInvoiceScanReferences(rawValue));
  if (references.size === 0) return { status: 'INVALID' };

  const matches = new Map<string, Transaction>();
  transactions.forEach((transaction) => {
    if (transactionInvoiceScanAliases(transaction).some(alias => references.has(alias))) matches.set(transaction.id, transaction);
  });

  if (matches.size === 1) {
    const transaction = [...matches.values()][0];
    return { status: 'MATCH', transactionId: transaction.id, transaction };
  }
  if (matches.size > 1) return { status: 'AMBIGUOUS', transactionIds: [...matches.keys()] };
  return { status: 'NOT_FOUND' };
};
