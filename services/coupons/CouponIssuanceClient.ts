import type { Transaction } from '../../types';

export interface IssuedCouponSlip {
  id: string;
  code: string;
  promotionId: string;
  campaignName: string;
  benefitType: 'PERCENT';
  benefitValue: number;
  validFrom: string;
  expiresAt: string;
}
export interface CouponIssuanceEnvelope {
  contractVersion: 1;
  tenantId: string;
  terminalId: string;
  transactionId: string;
  receiptReference: string;
  status: 'ISSUED' | 'NOT_ELIGIBLE';
  coupons: IssuedCouponSlip[];
}
export interface CouponPrintIdentity {
  erpSyncBaseUrl: string;
  tenantId: string;
  terminalId: string;
  deviceId: string;
  syncToken: string;
}
export class CouponIssuancePending extends Error {
  constructor(readonly code = 'COUPON_SOURCE_PENDING') {
    super(['COUPON_SOURCE_UNSUPPORTED', 'COUPON_PROMOTION_UNSUPPORTED', 'COUPON_TIMEZONE_UNAVAILABLE'].includes(code)
      ? 'El ERP no pudo emitir el cupón con esta venta o configuración de promoción. La venta no se repetirá. Revise la promoción antes de usar «Imprimir cupón» en el historial.'
      : code === 'COUPON_SOURCE_REFUNDED'
        ? 'Esta venta tiene una devolución y no admite emitir un cupón nuevo.'
        : 'No se pudo confirmar el cupón en el ERP. La venta no se repetirá. Revise la conexión y la sincronización; puede reintentar con «Imprimir cupón» en el historial.');
  }
}
const safeText = (value: unknown, max = 160): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);

export function validateCouponIssuance(value: unknown, identity: CouponPrintIdentity, transactionId: string): CouponIssuanceEnvelope {
  const row = value as CouponIssuanceEnvelope | undefined;
  if (!row || row.contractVersion !== 1 || row.tenantId !== identity.tenantId || row.terminalId !== identity.terminalId
    || row.transactionId !== transactionId || !safeText(row.receiptReference, 256)
    || !['ISSUED', 'NOT_ELIGIBLE'].includes(row.status) || !Array.isArray(row.coupons) || row.coupons.length > 25
    || (row.status === 'ISSUED') !== (row.coupons.length > 0)) throw new CouponIssuancePending();
  const codes = new Set<string>(), ids = new Set<string>(), promotions = new Set<string>();
  for (const coupon of row.coupons) {
    if (!coupon || !safeText(coupon.id) || !safeText(coupon.promotionId) || !safeText(coupon.campaignName, 256)
      || !/^[A-Z0-9][A-Z0-9-]{3,119}$/.test(coupon.code) || coupon.benefitType !== 'PERCENT'
      || !Number.isFinite(coupon.benefitValue) || coupon.benefitValue <= 0 || coupon.benefitValue > 100
      || !Number.isFinite(Date.parse(coupon.validFrom)) || !Number.isFinite(Date.parse(coupon.expiresAt))
      || Date.parse(coupon.expiresAt) <= Date.parse(coupon.validFrom)
      || codes.has(coupon.code) || ids.has(coupon.id) || promotions.has(coupon.promotionId)) throw new CouponIssuancePending();
    codes.add(coupon.code); ids.add(coupon.id); promotions.add(coupon.promotionId);
  }
  return row;
}

export function createCouponIssuanceClient(deps: {
  readIdentity(): CouponPrintIdentity;
  request(identity: CouponPrintIdentity, transactionId: string): Promise<unknown>;
}) {
  const flights = new Map<string, Promise<CouponIssuanceEnvelope>>();
  return async (transaction: Transaction): Promise<CouponIssuanceEnvelope> => {
    // Issuance is separate from checkout and only ever sees a durable sale.
    if (transaction.documentType !== 'TICKET' || transaction.status !== 'COMPLETED'
      || transaction.originalTransactionId || !safeText(transaction.id, 256)) throw new CouponIssuancePending();
    const identity = deps.readIdentity();
    const fingerprint = JSON.stringify(identity);
    const key = JSON.stringify([identity.erpSyncBaseUrl, identity.tenantId, identity.terminalId, identity.deviceId, transaction.id]);
    const assertIdentity = () => { if (JSON.stringify(deps.readIdentity()) !== fingerprint) throw new CouponIssuancePending(); };
    const flightKey = JSON.stringify([key, fingerprint]);
    let flight = flights.get(flightKey);
    if (!flight) {
      flight = (async () => {
        // Reprints also verify the central ledger and linked catalogs. A local
        // cache must not print a coupon removed by an authorized ERP reset.
        const issued = validateCouponIssuance(await deps.request(identity, transaction.id), identity, transaction.id);
        assertIdentity();
        return issued;
      })();
      flights.set(flightKey, flight);
      void flight.finally(() => { if (flights.get(flightKey) === flight) flights.delete(flightKey); }).catch(() => undefined);
    }
    return flight;
  };
}
