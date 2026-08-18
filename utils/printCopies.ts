import { BusinessConfig, Transaction } from '../types';

export type PrintDocumentKind =
  | 'invoice'
  | 'creditNote'
  | 'kitchenOrder'
  | 'xReport'
  | 'zReport'
  | 'other';

export const DEFAULT_PRINT_COPIES = 1;
export const MAX_PRINT_COPIES = 10;

export const normalizePrintCopies = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PRINT_COPIES;
  return Math.min(MAX_PRINT_COPIES, Math.max(DEFAULT_PRINT_COPIES, Math.trunc(parsed)));
};

export const resolveConfiguredPrintCopies = (
  config: Pick<BusinessConfig, 'receiptConfig'> | undefined,
  documentKind: PrintDocumentKind,
): number => normalizePrintCopies(config?.receiptConfig?.documentCopies?.[documentKind]);

export const resolveTransactionPrintKind = (
  transaction: Pick<Transaction, 'ncfType' | 'documentType'>,
): PrintDocumentKind => (
  transaction.ncfType === 'B04' || transaction.documentType === 'REFUND'
    ? 'creditNote'
    : 'invoice'
);
