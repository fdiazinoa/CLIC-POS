import type {Transaction} from '../../types';
import {tableFiscalSourceDigest,validateTableFiscalSaleContext,type TableFiscalSaleContext} from './OfflineFiscalLease';
import {v3RetainedLineFingerprint} from '../sync/LargeMasterSyncV3StockAuthority';

export function isOfflineTableFiscalTransaction(source:Partial<Transaction>):boolean {
 return Boolean(source.fiscalWorkflowCheckoutId&&source.fiscalSaleContext?.kind==='TABLE_ACCOUNT');
}
export async function readTableFiscalSaleContext(accountId:string,tableId:string):Promise<TableFiscalSaleContext>{
 const {readV3RetainedCheckout}=await import('../sync/LargeMasterSyncV3RetainedCheckout');
 const retained=await readV3RetainedCheckout({ticketId:accountId,tableId});
 if(!retained||retained.collection!=='parkedTickets'||!retained.items.length)throw Error('OFFLINE_FISCAL_TABLE_SOURCE_REQUIRED');
 return {schemaVersion:1,kind:'TABLE_ACCOUNT',accountId,tableId,sourceSha256:await tableFiscalSourceDigest(retained.expected)};
}
export async function assertTableFiscalSaleContext(source:Partial<Transaction>,retained?:{collection:string;id:string;expected:string}):Promise<void>{
 const context=source.fiscalSaleContext;validateTableFiscalSaleContext(context!);
 if(!retained||retained.collection!=='parkedTickets'||retained.id!==context!.accountId
  ||source.restaurantOrderId!==context!.accountId||source.restaurantTableId!==context!.tableId
  ||await tableFiscalSourceDigest(retained.expected)!==context!.sourceSha256
  ||!source.items?.length||source.items.some(line=>line.quantity<=0||line.articleFormat)
  ||source.originalTransactionId||source.v3RestoredTicketId||source.v3ReservationClaimId||source.reservationId)throw Error('OFFLINE_FISCAL_TABLE_SOURCE_CHANGED');
 const account=JSON.parse(retained.expected);
 if(![account.tableId,account.primaryTableId,...(account.joinedTableIds||[])].map(String).includes(context!.tableId)
  ||account.paymentFraction||account.paymentFractions?.length||Number(account.paidAmount||0)>0)throw Error('OFFLINE_FISCAL_TABLE_PARTIAL_UNSUPPORTED');
 if(!Array.isArray(account.items)||account.items.length!==source.items.length||Math.abs(Number(account.total)-Number(source.total))>.01
  ||source.items.some(line=>{const originals=account.items.filter((item:any)=>item.id===line.id&&item.cartId===line.cartId);return originals.length!==1
    ||Number(originals[0].quantity)!==Number(line.quantity)||v3RetainedLineFingerprint(originals[0])!==v3RetainedLineFingerprint(line);}))throw Error('OFFLINE_FISCAL_TABLE_PARTIAL_UNSUPPORTED');
}
