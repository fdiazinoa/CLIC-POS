import type {Transaction} from '../../types';

export const hasAtomicLegacySaleNumbering=(transaction:Partial<Transaction>):boolean=>transaction.legacySaleNumbering===1;
/** Explicit opt-in for ordinary native V3 B01/B02 checkout; never inferred from absent numbers. */
export function assertAtomicLegacySaleNumbering(transaction:Partial<Transaction>):void {
 if(transaction.legacySaleNumbering===undefined)return;
 if(transaction.legacySaleNumbering!==1||transaction.documentType!=='TICKET'||!['B01','B02'].includes(transaction.ncfType||'')
  ||!transaction.seriesId||!transaction.terminalId||!transaction.items?.length||transaction.items.some(line=>!line.v3SaleAuthority||line.quantity<=0||line.trackingData?.length)
  ||!transaction.fiscalIssuance||transaction.fiscalIssuance.ncf!==transaction.ncf||transaction.fiscalIssuance.ncfType!==transaction.ncfType
  ||transaction.fiscalWorkflowCheckoutId||transaction.fiscalAllocationAuthorizationId||transaction.fiscalOfflineLeaseId
  ||transaction.inventoryEffectsContract||transaction.companyDispatchSource||transaction.trackingCheckoutId
  ||transaction.v3ReservationClaimId||transaction.v3RestoredTicketId||transaction.reservationId
  ||transaction.restaurantOrderId||transaction.restaurantTableId||transaction.originalTransactionId)
  throw Error('LEGACY_ATOMIC_NUMBERING_SOURCE_INVALID');
}
export const withoutAtomicSaleNumbers=(transaction:Transaction):Transaction=>({...transaction,globalSequence:undefined,displayId:undefined,seriesNumber:undefined});
