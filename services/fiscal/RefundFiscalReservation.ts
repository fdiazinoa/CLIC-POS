/** B04 compatibility only. New E34 must use the durable RETURN consumer; no fallback can issue it. */
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
  if(options.refundFiscalType==='E34') throw Error('FISCAL_RETURN_PREPARATION_REQUIRED');
  if(options.retryKey && options.db.getReservedRefundFiscalNumber){
    const saved=await options.db.getReservedRefundFiscalNumber(options.retryKey,options.refundFiscalType,options.retryFingerprint);
    if(saved) return saved;
  }
  const reservation = await options.db.reserveFiscalNumber(options.refundFiscalType, options.terminalId, 1, options.activeTerminalConfig, options.retryKey,options.retryFingerprint);
  return { ncf: reservation?.ncf, fiscalIssuance: reservation?.fiscalIssuance };
}
