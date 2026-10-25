import { createUuid } from '../../utils/uuid';

/** Reserve a refund fiscal number, preferring the atomic E34 allocation checkout when available.
 * Falls back to the legacy `reserveFiscalNumber` path for non-E34 (B04) or when no allocation client exists. */
export async function reserveRefundFiscalReservation(options: {
  refundFiscalType: string;
  originalTransactionId?: string;
  items: Array<{ id: string; cartId: string; quantity: number; price: number } & Record<string, unknown>>;
  client?: { reserveOfflineCheckout: (cartIdentity: string, operationId: string) => Promise<any> };
  db: { reserveFiscalNumber: (type: string, terminalId: string, count: number, config: any) => Promise<any> };
  terminalId: string;
  activeTerminalConfig: any;
}): Promise<{ ncf?: string; fiscalIssuance?: any; checkout?: any }> {
  if (options.refundFiscalType === 'E34' && options.client && options.originalTransactionId) {
    try {
      const cartIdentity = JSON.stringify({
        items: options.items.map(item => ({ ...item, quantity: Math.abs(Number(item.quantity || 0)) })),
        customerId: null,
        fiscalType: 'E34',
        originalTransactionId: options.originalTransactionId,
      });
      const checkout = await options.client.reserveOfflineCheckout(cartIdentity, createUuid());
      if (checkout?.allocation) {
        return { ncf: checkout.allocation.ncf, fiscalIssuance: checkout.allocationIssuance, checkout };
      }
    } catch {
      // No offline allocation authority (online ECF, no downloaded allocation, etc.):
      // fall back to the legacy number reservation rather than blocking the refund.
    }
  }
  const reservation = await options.db.reserveFiscalNumber(options.refundFiscalType, options.terminalId, 1, options.activeTerminalConfig);
  return { ncf: reservation?.ncf, fiscalIssuance: reservation?.fiscalIssuance };
}
