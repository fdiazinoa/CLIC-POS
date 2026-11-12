import { createUuid } from '../../utils/uuid';

/** Reserve a refund fiscal number, preferring the atomic E34 allocation checkout when available.
 * Falls back to the legacy `reserveFiscalNumber` path for non-E34 (B04) or when no allocation client exists. */
export async function reserveRefundFiscalReservation(options: {
  retryKey?: string;
  retryFingerprint?:string;
  operationId?: string;
  refundFiscalType: string;
  originalTransactionId?: string;
  items: Array<{ id: string; cartId: string; quantity: number; price: number } & Record<string, unknown>>;
  client?: { allocationReady?: (type?: string) => Promise<boolean>; localCheckout?: () => Promise<any>; reserveOfflineCheckout: (cartIdentity: string, operationId: string) => Promise<any> };
  db: { reserveFiscalNumber: (type: string, terminalId: string, count: number, config: any, retryKey?: string,retryFingerprint?:string) => Promise<any>; getReservedRefundFiscalNumber?: (retryKey: string, type: string,retryFingerprint?:string) => Promise<any> };
  terminalId: string;
  activeTerminalConfig: any;
}): Promise<{ ncf?: string; fiscalIssuance?: any; checkout?: any }> {
  if(options.retryKey && options.db.getReservedRefundFiscalNumber){
    const saved=await options.db.getReservedRefundFiscalNumber(options.retryKey,options.refundFiscalType,options.retryFingerprint);
    if(saved) return saved;
  }
  let allocationAvailable=!options.retryKey;
  if(options.retryKey && options.client){
    const current=await options.client.localCheckout?.().catch(()=>null);
    allocationAvailable=Boolean(current?.allocation) || Boolean(await options.client.allocationReady?.('E34'));
  }
  if (allocationAvailable && options.refundFiscalType === 'E34' && options.client && options.originalTransactionId) {
    try {
      const cartIdentity = JSON.stringify({
        items: options.items.map(item => ({ ...item, quantity: Math.abs(Number(item.quantity || 0)) })),
        customerId: null,
        fiscalType: 'E34',
        originalTransactionId: options.originalTransactionId,
      });
      const checkout = await options.client.reserveOfflineCheckout(cartIdentity, options.operationId || createUuid());
      if(options.retryKey && !checkout?.allocation) throw Error('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
      if (checkout?.allocation) {
        return { ncf: checkout.allocation.ncf, fiscalIssuance: checkout.allocationIssuance, checkout };
      }
    } catch (error) {
      // An uncertain/reconciliation failure may already own a number. Never switch issuance routes.
      if(options.retryKey) throw error;
      // No offline allocation authority (online ECF, no downloaded allocation, etc.):
      // fall back to the legacy number reservation rather than blocking the refund.
    }
  }
  const reservation = await options.db.reserveFiscalNumber(options.refundFiscalType, options.terminalId, 1, options.activeTerminalConfig, options.retryKey,options.retryFingerprint);
  return { ncf: reservation?.ncf, fiscalIssuance: reservation?.fiscalIssuance };
}
