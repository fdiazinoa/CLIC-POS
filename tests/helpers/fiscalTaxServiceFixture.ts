import {readFileSync} from 'node:fs';
import {appliedFixture} from './fiscalAppliedReceiptFixture';
export const taxServiceFixture=(name:string)=>JSON.parse(readFileSync(new URL('../fixtures/fiscal-tax-service-v1/'+name+'.json',import.meta.url),'utf8'));
/** Exact ERP reference bytes forwarded to loopback HTTP; host SQLite, synthetic identity only. */
export async function taxServiceLab(){
 const source=taxServiceFixture('e32-352-original'),response=taxServiceFixture('applied-receipt-e32-352-local');
 return appliedFixture('E32-cash1',async wire=>{
  wire.originalSource.transaction=source.transaction;wire.expectedResponse=response.response.body;
  wire.materializedSnapshot.sources=[{event_id:source.sourceSaleEventId,event_type:'SALE_POSTED',payload:source.salePayload},{event_id:source.sourcePaymentEventId,event_type:'PAYMENT_POSTED',payload:source.paymentPayload}];
 });
}
