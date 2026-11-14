import type {Transaction} from '../../types';
import {dbAdapter} from '../db';
import {assertReturnPreparation,returnNeed,returnJSON,sameReturn} from './FiscalReturnV1';
import {financialIdentity} from '../db/LargeMasterSyncV3FinancialRetention';
const verified=new Map<string,true>();
const key=(t:Transaction)=>financialIdentity(t);
/** Re-read durable authorization on every print/email/reprint, including after restart. */
export async function verifyReturnSettlementPresentation(t:Transaction,store=dbAdapter.fiscalReturnStore){
 if(!t.returnSettlementV1)return;
 const a=await store?.byTransaction(t.id);
 returnNeed(a?.phase==='COMMITTED'&&a.committedSource&&a.preparation,'FISCAL_RETURN_COMMIT_RECEIPT_REQUIRED');
 await assertReturnPreparation(a!.preparation!,a!);
 returnNeed(sameReturn(t.returnSettlementV1,a!.preparation!.returnSnapshot.settlement)&&financialIdentity(t)===financialIdentity(a!.committedSource),'FISCAL_RETURN_SOURCE_MISMATCH');
 verified.set(key(t),true);if(verified.size>64)verified.delete(verified.keys().next().value!);
}
export function returnSettlementLines(t:Transaction):string[]{
 const s=t.returnSettlementV1;if(!s)return[];
 returnNeed(verified.has(key(t)),'FISCAL_RETURN_COMMIT_RECEIPT_REQUIRED');
 const amount=(n:number)=>`DOP ${n.toFixed(2)}`,lines:string[]=[];
 if(s.debtReduction>0)lines.push(`Aplicado a deuda factura original: ${amount(s.debtReduction)}`);
 if(s.destination==='ORIGINAL_PAYMENT'){
  lines.push(`Reembolso: ${amount(s.refundAmount)}`);
  for(const p of t.payments){const label=({CASH:'Efectivo',CARD:'Tarjeta',TRANSFER:'Transferencia',BANK_TRANSFER:'Transferencia',OTHER:'Otros'} as Record<string,string>)[p.method]||p.method;
   const methodId=p.methodId&&p.methodId.toUpperCase()!==p.method.toUpperCase()&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.methodId)?` (${p.methodId})`:'';lines.push(`${label}${methodId}: ${amount(p.amount)}`);}
 }else{
  lines.push(`Saldo a favor del cliente: ${amount(s.customerCreditAmount)}`,`Cliente: ${t.customerName||s.customerId}`,`NC: ${t.ncf||t.displayId||t.id}`,'Sin entrega de efectivo/banco');
 }
 return lines;
}
