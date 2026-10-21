import React,{useEffect,useRef,useState} from 'react';
import type {User} from '../types';
import type {FiscalRetirementRecord} from '../services/fiscal/FiscalWorkflowV2Types';
import {fiscalWorkflowV2Client} from '../services/fiscal/FiscalWorkflowV2Client';

/** Manual retirement only. Unmounting the old payment modal discards its unconfirmed entries. */
export function FiscalExpiredCheckoutAction({users,operationIds,onClosed}:{users:User[];operationIds:string[];onClosed:(record:FiscalRetirementRecord)=>void}){
 const [candidate,setCandidate]=useState<FiscalRetirementRecord|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[actorId,setActorId]=useState(''),[pin,setPin]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(true),pending=useRef(false);
 useEffect(()=>{mounted.current=true;void fiscalWorkflowV2Client.retirementCandidate().then(value=>{if(mounted.current)setCandidate(value);}).catch(()=>{if(mounted.current)setMessage('No se pudo comprobar el intento fiscal. Se requiere conciliación.');});return()=>{mounted.current=false;};},[]);
 if(!candidate||candidate.phase==='CLOSED'&&!operationIds.includes(candidate.originalOperationId))return null;
 const close=()=>{setPin('');setOpen(false);};
 const submit=async(event:React.FormEvent)=>{
  event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setMessage('');const supplied=pin;setPin('');
  try{const result=await fiscalWorkflowV2Client.retireExpiredCheckout(candidate,actorId&&supplied?{actorId,pin:supplied}:undefined);if(mounted.current)onClosed(result);}
  catch{if(mounted.current)setMessage('No se pudo confirmar el cierre. El intento sigue bloqueado; revisa conexión y autorización del operador o solicita conciliación.');}
  finally{pending.current=false;if(mounted.current)setBusy(false);}
 };
 return <section className="mt-3 rounded-xl border border-amber-300 p-3 text-sm text-slate-900">
  <button type="button" disabled={busy} onClick={()=>setOpen(true)} className="rounded border border-amber-600 px-3 py-2 font-bold">Cerrar intento fiscal vencido</button>
  {open&&<form onSubmit={submit} className="mt-3 space-y-3" aria-label="Confirmar cierre del intento fiscal vencido">
   <p>Se conservará el registro del intento fiscal anterior y las líneas actuales. Esta acción no cobra ni confirma una venta. Si hubo un pago real, requiere conciliación.</p>
   {candidate.phase!=='CLOSED'&&<>
    <label className="block">Operador autorizado<select value={actorId} onChange={event=>setActorId(event.target.value)} className="block w-full rounded border p-2"><option value="">Reintentar cierre ya confirmado</option>{users.filter(user=>user.isActive!==false).map(user=><option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
    <label className="block">PIN del operador<input autoComplete="new-password" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={event=>setPin(event.target.value)} className="block w-full rounded border p-2"/></label>
    <p>Un cierre pendiente requiere un operador autorizado y su PIN. Si el servidor ya confirmó este mismo cierre, puedes reintentar sin PIN.</p>
   </>}
   <div className="flex gap-3"><button type="submit" disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-white">{busy?'Verificando cierre…':'Confirmar cierre'}</button><button type="button" disabled={busy} onClick={close}>Cancelar</button></div>
  </form>}
  {message&&<p role="alert">{message}</p>}
 </section>;
}
