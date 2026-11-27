import type { Transaction } from '../../types';

/**
 * Anulación segura de la venta original en una devolución fiscal (E34 / NC electrónica).
 *
 * El commit local de la NC es atómico con la preparación durable, pero el ERP puede rechazar el
 * evento después (p. ej. `FISCAL_RETURN_PREPARATION_REQUIRED`). Hasta que el outbox reciba
 * APPLIED_ERP el ticket original no debe quedar ANULADO definitivo: se conserva su estado y se
 * registra la intención, que sólo se aplica con el ACK del ERP. Así una devolución rechazada es
 * reintentable y no deja la venta anulada sin nota de crédito aceptada.
 */
export const RETURN_PENDING_ACK_FIELD = 'refundPendingErp';
export const RETURN_PENDING_STATUS_FIELD = 'pendingRefundStatus';
export type ReturnOriginalStatus = 'REFUNDED' | 'PARTIAL_REFUND';

export interface ReturnPendingOriginal extends Transaction {
  refundPendingErp?: boolean;
  pendingRefundStatus?: ReturnOriginalStatus;
}

/** Keeps the original commercial status and records the annulment intention until ERP ACK. */
export const markOriginalReturnPending = <T extends Transaction>(original: T, intendedStatus: ReturnOriginalStatus): T => ({
  ...original,
  [RETURN_PENDING_ACK_FIELD]: true,
  [RETURN_PENDING_STATUS_FIELD]: intendedStatus,
} as T);

/** Called only after the NC/payment events are APPLIED_ERP; returns the same object when nothing is pending. */
export const settleOriginalReturnAnnulment = <T extends Transaction>(original: T): T => {
  const pending = (original as ReturnPendingOriginal).pendingRefundStatus;
  if (!(original as ReturnPendingOriginal).refundPendingErp) return original;
  const { [RETURN_PENDING_ACK_FIELD]: _pending, [RETURN_PENDING_STATUS_FIELD]: _status, ...rest } = original as ReturnPendingOriginal;
  return { ...rest, status: pending || 'REFUNDED' } as unknown as T;
};

export interface ReturnPrintDecision { allowed: boolean; code?: 'FISCAL_RETURN_SIGNED_QR_REQUIRED' }

export const isFiscalReturnDocument = (
  transaction: Pick<Transaction, 'documentType' | 'ncfType' | 'ncf'>,
): boolean => transaction.ncfType === 'E34'
  || (transaction.documentType === 'REFUND' && /^E\d{2}/.test(String(transaction.ncf || transaction.ncfType || '')));

/**
 * A credit note / return ticket may only be printed as fiscal when its signed evidence is validated.
 * The generic internal QR is never allowed to stand in for a missing fiscal stamp.
 */
export const decideFiscalReturnPrint = (
  transaction: Pick<Transaction, 'documentType' | 'ncfType'>,
  hasVerifiedSignedEvidence: boolean,
): ReturnPrintDecision => isFiscalReturnDocument(transaction) && !hasVerifiedSignedEvidence
  ? { allowed: false, code: 'FISCAL_RETURN_SIGNED_QR_REQUIRED' }
  : { allowed: true };
