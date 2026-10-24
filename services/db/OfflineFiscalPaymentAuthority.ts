import type {Transaction} from '../../types';
type SQL={query(query:string,values?:any[]):Promise<{values?:any[]}>};
/** Fiscal scope never grants a gateway authorization. Called under the existing native writer. */
export async function assertOfflineFiscalPaymentReceipts(sql:SQL,source:Transaction):Promise<void>{
 const money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Math.round(v*100):NaN;
 for(const payment of source.payments){
  if(payment.gatewayProvider||payment.paymentIntentId||payment.gatewayIntegrationId||payment.gatewayStatus){
   const rows=payment.paymentIntentId?(await sql.query('SELECT * FROM payment_intents_v2 WHERE intent_id=?',[payment.paymentIntentId])).values:[];
   const intent=rows?.[0];
   if(rows?.length!==1||!intent||intent.status!=='AUTHORIZED'||intent.transaction_id!==source.id||intent.payment_id!==payment.id||intent.provider!==payment.gatewayProvider||intent.integration_id!==payment.gatewayIntegrationId||payment.gatewayStatus!=='APPROVED'||payment.gatewayTransactionType!=='SALE'||money(Number(intent.amount))!==money(payment.amountApplied??payment.appliedAmount??payment.amount)||String(intent.provider_reference||'')!==String(payment.gatewayReference||''))throw Error('PAYMENT_INTENT_RECONCILIATION_REQUIRED');
  }
 }
}
