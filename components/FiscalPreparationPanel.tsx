import React,{useEffect,useState} from 'react';
import type {FiscalPreparationController} from '../services/fiscal/FiscalSinglePreparation';
export default function FiscalPreparationPanel({controller}:{controller:FiscalPreparationController}) {
 const [status,setStatus]=useState(()=>controller.status());
 useEffect(()=>{setStatus(controller.status());return controller.subscribe(()=>setStatus(controller.status()));},[controller]);
 const act=(command:()=>Promise<void>)=>{void command().catch(()=>setStatus(controller.status()));};
 return <section aria-label="Preparación fiscal de una operación" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-3">
  <h2 className="font-bold text-slate-900">Preparar una operación de prueba</h2>
  <p className="text-sm text-slate-700">Sólo Caja 6. Primero marca la próxima venta nueva; después regresa aquí para consultar su preparación en ERP. Esta acción no crea una venta, no emite comprobantes ni reenvía pendientes.</p>
  <p role="status" className="text-sm font-semibold">{status.message}</p>
  {status.summary&&<dl className="text-sm grid grid-cols-2 gap-2"><dt>Ticket</dt><dd>{status.summary.ticket}</dd><dt>Comprobante original</dt><dd>{status.summary.ncf}</dd><dt>Fecha original</dt><dd>{status.summary.date}</dd><dt>Total</dt><dd>RD${status.summary.amount.toFixed(2)}</dd><dt>Líneas</dt><dd>{status.summary.lines}</dd></dl>}
  {status.state==='EMPTY'&&<button type="button" className="rounded-xl bg-slate-900 text-white px-4 py-3" onClick={()=>act(controller.arm)}>Marcar la próxima venta nueva</button>}
  {status.state==='SELECTED'&&<button type="button" className="rounded-xl bg-slate-900 text-white px-4 py-3" onClick={()=>act(controller.prepare)}>Consultar preparación en ERP</button>}
  {['ARMING','ARMED','CAPTURING','SELECTED','PREPARING','PREPARED'].includes(status.state)&&<button type="button" className="rounded-xl border border-slate-300 px-4 py-3 ml-2" onClick={controller.cancel}>Cancelar preparación</button>}
  <p className="text-xs text-slate-600">La consulta no confirma aceptación DGII. La emisión requiere otra autorización y una conexión posterior revisada. No realices una venta de prueba sin acordar antes su importe y artículos.</p>
 </section>;
}
