import type { BusinessConfig, CartItem, PaymentEntry, Reservation, Transaction } from '../../types';
import { validateV3FrozenLineFiscalAmounts } from './LargeMasterSyncV3LineSource';
import { calculateLineFiscalValuesForTransaction, freezeAuthoritativeLineFiscalAmounts } from '../../utils/fiscalBreakdown';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';
import { v3RetainedLineFingerprint } from './LargeMasterSyncV3StockAuthority';

export const reservationClaimId = (id: string): string => `reservation:${id}`;
export const reservationInvoiceId = (id: string): string => `RSV-INVOICE-${encodeURIComponent(id)}`;
export const reservationAdvanceId = (id: string): string => `RSV-ADVANCE-${encodeURIComponent(id)}`;
const fail = (code: string): never => { throw new LargeMasterSyncV3Error(code); };
const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100);

export function assertV3ReservationSource(reservation: Reservation, binding?: string, warehouseId?: string, expiredDisposition = false): void {
  if (!reservation || reservation.sourceChannel || reservation.status !== 'ACTIVE' || reservation.invoicedTransactionId
    || !Number.isFinite(Date.parse(reservation.expiryDate)) || (!expiredDisposition && Date.parse(reservation.expiryDate) <= Date.now()) || expiredDisposition && Date.parse(reservation.expiryDate) > Date.now()) fail('SYNC_V3_RESERVATION_NOT_ACTIVE');
  if (!Number.isFinite(Date.parse(reservation.createdAt)) || !reservation.id || !reservation.customerId || !reservation.customerName || !reservation.terminalId || !reservation.warehouseId
    || !Number.isFinite(reservation.total) || reservation.total <= 0 || !Number.isFinite(reservation.balancePaid)
    || reservation.balancePaid < 0 || cents(reservation.balancePaid) > cents(reservation.total)
    || !reservation.items?.length || new Set(reservation.items.map(line => line.cartId)).size !== reservation.items.length) fail('SYNC_V3_RESERVATION_SOURCE_INVALID');
  const first = reservation.items[0].v3SaleAuthority;
  if (!first || !reservation.items.every(line => line.quantity > 0 && line.cartId && line.v3SaleAuthority
    && line.v3SaleAuthority.binding === first.binding && line.v3SaleAuthority.warehouseId === reservation.warehouseId
    && line.v3SaleAuthority.tariffId === first.tariffId && line.v3SaleAuthority.taxIncluded === first.taxIncluded)
    || binding && first.binding !== binding || warehouseId && reservation.warehouseId !== warehouseId) fail('SYNC_V3_RESERVATION_SCOPE_CHANGED');
  let identity: unknown;
  try { identity = JSON.parse(first.binding); } catch { fail('SYNC_V3_RESERVATION_SCOPE_CHANGED'); }
  if (!Array.isArray(identity) || identity[1] !== reservation.terminalId
    || reservation.tenantId && reservation.tenantId !== identity[0]
    || reservation.v3Snapshot && reservation.v3Snapshot.binding !== first.binding) fail('SYNC_V3_RESERVATION_SCOPE_CHANGED');
}

/** Reservations are immutable checkout sources, including quantities/costs/discounts, even in the current epoch. */
export function assertV3ReservationLines(source: Reservation, lines: CartItem[]): void {
  if (source.items.length !== lines.length) fail('SYNC_V3_RESERVATION_LINES_CHANGED');
  for (const line of lines) {
    const original = source.items.find(row => row.cartId === line.cartId && row.id === line.id);
    if (!original || v3RetainedLineFingerprint(original) !== v3RetainedLineFingerprint(line)
      || JSON.stringify([original.quantity, original.cost, original.originalPrice, original.discountRate, original.articleFormat])
      !== JSON.stringify([line.quantity, line.cost, line.originalPrice, line.discountRate, line.articleFormat])) fail('SYNC_V3_RESERVATION_LINES_CHANGED');
  }
}

export function v3ReservationPricing(source: Reservation, config: BusinessConfig): NonNullable<Reservation['v3Snapshot']> {
  assertV3ReservationSource(source);
  if (source.v3Snapshot) {
    const snapshot = source.v3Snapshot;
    if (cents(snapshot.total) !== cents(source.total) || cents(snapshot.netAmount + snapshot.taxAmount) !== cents(source.total)) fail('SYNC_V3_RESERVATION_TOTAL_CHANGED');
    return snapshot;
  }
  // Earlier compatible reserves stored commercial lines, not a header. Only exact zero-header-adjustment reconstruction is admitted.
  const stamp = source.items[0].v3SaleAuthority!;
  const terminal = config.terminals?.find(row => row.id === source.terminalId)?.config;
  const rows = calculateLineFiscalValuesForTransaction(source.items, config, { discountAmount: 0, isTaxIncluded: stamp.taxIncluded, terminalConfig: terminal });
  const netAmount = cents(rows.reduce((sum, row) => sum + row.netAmount, 0)) / 100;
  const taxAmount = cents(rows.reduce((sum, row) => sum + row.taxAmount, 0)) / 100;
  if (cents(netAmount + taxAmount) !== cents(source.total)) fail('SYNC_V3_RESERVATION_FISCAL_SNAPSHOT_REQUIRED');
  return { binding: stamp.binding, total: source.total, netAmount, taxAmount, discountAmount: 0,
    discountType: 'FIXED', discountValue: 0, isTaxIncluded: stamp.taxIncluded, serviceChargeAmount: 0, serviceType: 'DINE_IN' };
}

export function validateV3ReservationPricing(source: Reservation, config: BusinessConfig): NonNullable<Reservation['v3Snapshot']> {
  const pricing = v3ReservationPricing(source,config);
  const items = freezeAuthoritativeLineFiscalAmounts(source.items,config,{discountAmount:pricing.discountAmount,isTaxIncluded:pricing.isTaxIncluded,
    terminalConfig:config.terminals?.find(row=>row.id===source.terminalId)?.config,transactionNetAmount:pricing.netAmount,
    transactionTaxAmount:pricing.taxAmount,transactionTotal:pricing.total,taxExempt:pricing.customerSnapshot?.isTaxExempt===true});
  validateV3FrozenLineFiscalAmounts({...pricing,id:source.id,date:source.createdAt,payments:[],userId:source.createdById || '',userName:source.createdByName || '',
    status:'COMPLETED',documentType:'TICKET',items,terminalId:source.terminalId} as Transaction,config);
  return pricing;
}

export function reservationAdvancePayment(source: Reservation): PaymentEntry | null {
  assertV3ReservationSource(source);
  return source.balancePaid > 0 ? { id: reservationAdvanceId(source.id), method: 'ADVANCE', amount: source.balancePaid,
    timestamp: new Date(source.createdAt), source_transaction_id: source.id } : null;
}

export function assertV3ReservationInvoice(source: Reservation, transaction: Transaction): void {
  assertV3ReservationSource(source, transaction.v3Binding || transaction.items[0]?.v3SaleAuthority?.binding, transaction.v3WarehouseId);
  assertV3ReservationLines(source, transaction.items);
  if (transaction.id !== reservationInvoiceId(source.id) || transaction.v3ReservationClaimId !== reservationClaimId(source.id)
    || transaction.reservationId !== source.id || transaction.reservationCode !== source.code || transaction.customerId !== source.customerId
    || cents(transaction.total) !== cents(source.total) || cents(transaction.priorAdvancePaid || 0) !== cents(source.balancePaid)) fail('SYNC_V3_RESERVATION_INVOICE_CHANGED');
  if (source.v3Snapshot && ['netAmount','taxAmount','discountAmount','discountType','discountValue','isTaxIncluded','serviceChargeAmount','serviceType'].some(key => (transaction as any)[key] !== (source.v3Snapshot as any)[key])) fail('SYNC_V3_RESERVATION_FISCAL_SNAPSHOT_CHANGED');
  const advance = (transaction.payments || []).filter(payment => payment.method === 'ADVANCE');
  if (source.balancePaid > 0 ? advance.length !== 1 || advance[0].id !== reservationAdvanceId(source.id)
    || cents(advance[0].amount) !== cents(source.balancePaid) : advance.length !== 0) fail('SYNC_V3_RESERVATION_ADVANCE_CHANGED');
  const paid = transaction.payments.reduce((sum, payment) => sum + Number(payment.amountApplied ?? payment.appliedAmount ?? payment.amount), 0);
  if (cents(paid) !== cents(source.total + Number(transaction.voluntaryTipAmount || 0))) fail('SYNC_V3_RESERVATION_PAYMENT_CHANGED');
}
