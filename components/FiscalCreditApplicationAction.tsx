import {createCreditActionBoundary} from '../utils/creditActionBoundary';
import React,{useEffect,useRef,useState} from 'react';
import type {Transaction} from '../types';
import {fiscalCreditApplicationService,type CreditTarget} from '../services/fiscal/FiscalReturnCreditApplication';
import {captureFiscalStatusBoundContext} from '../services/fiscal/FiscalBoundContext';
import {returnOperatorMessage} from '../services/fiscal/FiscalReturnV1';
export const FiscalCreditApplicationAction=({transaction}:{transaction:Transaction})=>{
 const [target,setTarget]=useState<CreditTarget|null>(null),[targetContext,setTargetContext]=useState(''),[amount,setAmount]=useState(''),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState(''),[newConsumption,setNewConsumption]=useState(false),guard=useRef<string|null>(null),boundary=useRef(createCreditActionBoundary());
 let context='';try{context=captureFiscalStatusBoundContext().fingerprint;}catch{/* No new online operation without a bound terminal. */}
 const boundKey=JSON.stringify([transaction.id,context]);boundary.current.bind(boundKey);
 useEffect(()=>{let cancelled=false;boundary.current.open(boundKey);const current=boundary.current.capture();guard.current=null;setBusy(false);setTarget(null);setFeedback('');setNewConsumption(false);
  if(transaction.documentType!=='REFUND'&&Number(transaction.pendingBalance)>0&&transaction.customerId&&context){
   void fiscalCreditApplicationService.inspect(transaction).then(value=>{if(!cancelled&&current()){setTargetContext(boundKey);setTarget(value);setAmount(String(value.attempt?JSON.parse(value.attempt.commandBytes).amount:Math.min(Number(value.customer.wallet?.balance||0),Number(transaction.pendingBalance),Number(value.customer.currentDebt||0))));}}).catch(()=>{if(!cancelled&&current())setFeedback('El saldo online requiere una factura ERP y un cliente original identificados.');});
  }return()=>{cancelled=true;boundary.current.close(boundKey);};
 },[transaction.id,context]);
 if(target&&(target.sourceTransactionId!==transaction.id||targetContext!==boundKey))return null;
 if(!target)return feedback?<p className="text-xs text-slate-500">{feedback}</p>:null;
 if(!target.enabled&&!target.attempt)return null;
 const receipt=target.attempt?.receipt;
 const run=async()=>{if(guard.current||target.sourceTransactionId!==transaction.id)return;const requestKey=boundKey,current=boundary.current.capture();guard.current=requestKey;setBusy(true);try{
  const result=await fiscalCreditApplicationService.apply(target,Number(amount),newConsumption);
  if(!current())return;
  setTarget({...target,attempt:result.attempt});setNewConsumption(false);
  setFeedback(result.projectionPending?'Aplicación registrada. Saldo pendiente de actualizar; reintenta la consulta, sin generar otro consumo.':`Saldo aplicado a esta factura: DOP ${result.attempt.receipt!.amount.toFixed(2)}. Recibo ${result.attempt.receipt!.receiptEntryId}.`);
  if(!result.projectionPending){const fresh=await fiscalCreditApplicationService.inspect(transaction);if(current())setTarget(fresh);}
 }catch(error){if(current())setFeedback(returnOperatorMessage(error));}finally{if(guard.current===requestKey){guard.current=null;if(current())setBusy(false);}}};
 return <section className="my-3 rounded-xl border border-purple-200 bg-purple-50 p-3 text-sm">
  <p className="font-bold">Aplicar saldo a esta factura</p><p className="text-xs">Cliente original: {target.customer.name}. Requiere conexión; conserva la factura emitida.</p>
  {receipt&&!newConsumption?<p>Aplicación registrada: DOP {receipt.amount.toFixed(2)} · Recibo {receipt.receiptEntryId}</p>:<label>Importe DOP <input aria-label="Importe de saldo a aplicar" type="number" min="0.01" step="0.01" value={amount} disabled={busy||Boolean(target.attempt&&!newConsumption)} onChange={e=>setAmount(e.target.value)} className="m-2 w-28 rounded border p-1"/></label>}
  <button type="button" onClick={()=>void run()} disabled={busy||(!target.attempt&&!target.enabled)} className="rounded bg-purple-700 px-3 py-2 text-white disabled:opacity-50">{busy?'Consultando…':target.attempt&&!newConsumption?'Recuperar recibo / actualizar saldo':'Aplicar saldo online'}</button>
  {receipt&&target.attempt?.projectionRefreshedAt&&target.enabled&&!newConsumption&&<button type="button" disabled={busy} onClick={()=>{setNewConsumption(true);setAmount('');setFeedback('Nuevo consumo: indica un importe y confirma.');}} className="ml-2 rounded border px-3 py-2">Nuevo consumo</button>}
  {feedback&&<p role="status" className="mt-2 text-xs">{feedback}</p>}
 </section>;
};
