import type {Transaction} from '../../types';
type SQL={query(query:string,values?:any[]):Promise<{values?:any[]}>};
/** Fiscal scope never grants a gateway authorization. Called under the existing native writer. */
export async function assertOfflineFiscalPaymentReceipts(sql:SQL,source:Transaction):Promise<void>{
 const money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Math.round(v*100):NaN;
 // Final-installment close: gateway payments from earlier PAID parts carry the part.receiptId
 // as their intent transaction_id (never the final source id). Resolve those receipts from the
 // parked ticket so each prior payment is authenticated against exactly one PAID part proof.
 const priorPartReceipts=new Map<string,string>();
 const accountId=source.restaurantOrderId||(source as unknown as {fiscalSaleContext?:{accountId?:string}}).fiscalSaleContext?.accountId;
 if(accountId){
  const ticketRows=(await sql.query("SELECT data FROM documents WHERE collection_name='parkedTickets' AND doc_id=?",[accountId])).values||[];
  const ticket=ticketRows[0]&&(ticketRows[0] as {data?:unknown}).data?JSON.parse(String((ticketRows[0] as {data:unknown}).data)):null;
  for(const part of ticket?.paymentFraction?.parts||[]){
   if(part.status==='PAID'&&part.receiptId)for(const paymentId of part.paymentIDs||[])priorPartReceipts.set(String(paymentId),part.receiptId);
  }
 }
 for(const payment of source.payments){
  if(payment.gatewayProvider||payment.paymentIntentId||payment.gatewayIntegrationId||payment.gatewayStatus){
   const rows=payment.paymentIntentId?(await sql.query('SELECT * FROM payment_intents_v2 WHERE intent_id=?',[payment.paymentIntentId])).values:[];
   const intent=rows?.[0];
   const expectedTransactionId=priorPartReceipts.get(payment.id)||source.id;
   if(rows?.length!==1||!intent||intent.status!=='AUTHORIZED'||intent.transaction_id!==expectedTransactionId||intent.payment_id!==payment.id||intent.provider!==payment.gatewayProvider||intent.integration_id!==payment.gatewayIntegrationId||payment.gatewayStatus!=='APPROVED'||payment.gatewayTransactionType!=='SALE'||money(Number(intent.amount))!==money(payment.amountApplied??payment.appliedAmount??payment.amount)||String(intent.provider_reference||'')!==String(payment.gatewayReference||''))throw Error('PAYMENT_INTENT_RECONCILIATION_REQUIRED');
  }
 }
}
