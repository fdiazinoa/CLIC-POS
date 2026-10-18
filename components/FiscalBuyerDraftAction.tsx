import React,{useEffect,useState} from 'react';
import type {Transaction,User} from '../types';
import type {FiscalWorkflowStateV2} from '../services/fiscal/FiscalWorkflowV2Types';
import {fiscalWorkflowV2Client,fiscalWorkflowMessage,fiscalWorkflowReason} from '../services/fiscal/FiscalWorkflowV2Client';
/** Shared buyer-only fiscal draft. Never edits the sale/customer master, reserves NCF, or calls ISSUE. */
export function FiscalBuyerDraftAction({transaction,users}:{transaction:Transaction;users:User[]}){
 const [state,setState]=useState<FiscalWorkflowStateV2|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[buyer,setBuyer]=useState<Record<string,string>>({}),[reason,setReason]=useState(''),[actorId,setActorId]=useState(''),[pin,setPin]=useState('');
 useEffect(()=>{let disposed=false;void fiscalWorkflowV2Client.cached(transaction.id).then(value=>{if(!disposed)setState(value);});const update=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.id===transaction.id)setState(detail.state);};window.addEventListener('fiscalWorkflowUpdated',update);return()=>{disposed=true;window.removeEventListener('fiscalWorkflowUpdated',update);};},[transaction.id]);
 if(transaction.fiscalProvider!=='MSELLER')return null;
 const inspect=async()=>{setBusy(true);setMessage('');try{const current=await fiscalWorkflowV2Client.consult(transaction.id);setState(current);if(!current.canCorrect){setMessage(current.mode==='STATUS_ONLY'?'Documento histórico: sólo consulta. Una corrección requiere el procedimiento fiscal correspondiente.':fiscalWorkflowReason(current.reason));return;}setBuyer({...current.buyer});setOpen(true);}catch{setMessage('No se pudo validar la autorización vigente. El original se conserva.');}finally{setBusy(false);}};
 const close=()=>{setPin('');setOpen(false);};
 const save=async(event:React.FormEvent)=>{event.preventDefault();if(!state||busy)return;setBusy(true);try{const current=await fiscalWorkflowV2Client.correct(transaction.id,{expectedRevision:state.draftRevision,reason,buyer,actorId,pin});setState(current);setMessage('Comprador fiscal actualizado y auditado. La venta original se conserva.');close();}catch(error){setMessage(fiscalWorkflowReason(error instanceof Error?error.message:null));setPin('');}finally{setBusy(false);}};
 return <div className="mt-3 space-y-2 text-xs">
  {state&&<p role="status" className="font-semibold">{fiscalWorkflowMessage(state)}</p>}
  <button type="button" disabled={busy} onClick={()=>void inspect()} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 font-bold text-amber-800 disabled:opacity-50">{busy?'Validando…':state?.canCorrect?'Corregir comprador fiscal':'Consultar estado fiscal'}</button>
  {message&&<p role="status">{message}</p>}
  {open&&<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"><form onSubmit={save} className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-auto rounded-2xl bg-white p-6 text-slate-900">
   <h3 className="text-lg font-bold">Comprador del borrador fiscal</h3><p>Se conserva la venta original, sus importes y su NCF.</p>
   {(['taxId','name','address','phone','email'] as const).map(field=><label key={field} className="block">{{taxId:'RNC o cédula',name:'Nombre fiscal',address:'Dirección',phone:'Teléfono',email:'Correo'}[field]}<input autoComplete="off" required={field==='taxId'||field==='name'} maxLength={field==='taxId'?11:field==='address'?500:field==='email'?254:field==='phone'?40:200} value={buyer[field]||''} onChange={event=>setBuyer({...buyer,[field]:event.target.value})} className="block w-full rounded border p-2"/></label>)}
   <label className="block">Motivo<textarea required minLength={8} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)} className="block w-full rounded border p-2"/></label>
   <label className="block">Operador autorizado<select required value={actorId} onChange={event=>setActorId(event.target.value)} className="block w-full rounded border p-2"><option value="">Seleccionar</option>{users.filter(user=>user.isActive!==false).map(user=><option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
   <label className="block">Reingresa tu PIN<input required autoComplete="new-password" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={event=>setPin(event.target.value)} className="block w-full rounded border p-2"/></label>
   <div className="flex gap-3"><button type="submit" disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Guardar borrador</button><button type="button" disabled={busy} onClick={close}>Cancelar</button></div>
  </form></div>}
 </div>;
}
