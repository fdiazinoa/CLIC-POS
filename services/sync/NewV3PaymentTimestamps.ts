import type { PaymentEntry, Transaction } from '../../types';

/** Only called while creating a new V3 source, never while reading/replaying history. */
export function freezeNewV3PaymentTimestamps(transaction: Transaction, original: readonly PaymentEntry[]): Transaction {
  if (transaction.payments.length !== original.length) throw Error('SYNC_V3_PAYMENT_TIMESTAMP_INVALID');
  return { ...transaction, payments: transaction.payments.map((payment, index) => {
    const raw = original[index]?.timestamp;
    let timestamp: string;
    if (raw instanceof Date) {
      if (!Number.isFinite(raw.getTime())) throw Error('SYNC_V3_PAYMENT_TIMESTAMP_INVALID');
      timestamp = raw.toISOString();
    } else if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) && Number.isFinite(Date.parse(raw))) {
      timestamp = raw;
    } else throw Error('SYNC_V3_PAYMENT_TIMESTAMP_INVALID');
    const normalizedTime = payment.timestamp instanceof Date ? payment.timestamp.getTime() : Date.parse(payment.timestamp);
    if (!Number.isFinite(normalizedTime) || normalizedTime !== Date.parse(timestamp)) throw Error('SYNC_V3_PAYMENT_TIMESTAMP_INVALID');
    return { ...payment, timestamp };
  }) };
}
