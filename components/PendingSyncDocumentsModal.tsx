import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { canRetryPendingSyncQueue, pendingSyncDiagnostic, readPendingSyncDocuments, retryPendingSyncQueue, type PendingSyncDocument, type PendingSyncPage } from '../services/sync/PendingSyncDocuments';

const labels: Record<string,string>={transactions:'Venta / devolución',inventoryLedger:'Movimiento de inventario',zReports:'Cierre Z',cashMovements:'Movimiento de caja',customerMutations:'Cliente',posUserMutations:'Usuario',catalogEdits:'Cambio de catálogo',sync_outbox_v2:'Evento durable',transfer_receipt_queue:'Recepción de traspaso',master_number_ranges:'Progreso de serie',posAuditEvents:'Auditoría POS',invoiceAuditEvents:'Auditoría fiscal'};
export default function PendingSyncDocumentsModal({onClose}:{onClose:()=>void}) {
  const dialog=useRef<HTMLDivElement>(null), closeButton=useRef<HTMLButtonElement>(null), retryBusy=useRef(false);
  const [page,setPage]=useState(1),[search,setSearch]=useState(''),[draft,setDraft]=useState(''),[status,setStatus]=useState<'ALL'|'PENDING'|'BLOCKED'>('ALL');
  const [result,setResult]=useState<PendingSyncPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [selected,setSelected]=useState<PendingSyncDocument|null>(null),[json,setJson]=useState(''),[message,setMessage]=useState(''),[confirmRetry,setConfirmRetry]=useState(false),[retrying,setRetrying]=useState(false);
  const mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;
    const previous=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const handleKey=(event:KeyboardEvent)=>{
      // Keep POS/scanner shortcuts behind the dialog from receiving its keys.
      event.stopImmediatePropagation();
      if (/^F\d+$/.test(event.key)||event.altKey||event.metaKey||(event.ctrlKey&&!['a','c','v','x'].includes(event.key.toLowerCase()))) event.preventDefault();
      if(event.key==='Escape'){event.preventDefault();onClose();}
      if(event.key==='Tab'){
        const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,[tabindex="0"]')||[]).filter(node=>!node.hidden);
        const first=controls[0],last=controls.at(-1);
        if(!dialog.current?.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first)?.focus();}
        else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    const blockScan=(event:Event)=>event.stopImmediatePropagation();
    window.addEventListener('keydown',handleKey,true);
    window.addEventListener('barcodeScanned',blockScan,true);
    return ()=>{mounted.current=false;window.removeEventListener('keydown',handleKey,true);window.removeEventListener('barcodeScanned',blockScan,true);previous?.focus();};
  },[onClose]);
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');setSelected(null);setJson('');setConfirmRetry(false);
    void (async()=>{
      try{
        const [{dbAdapter},{permissionService},{isSyncFeatureEnabled}]=await Promise.all([import('../services/db'),import('../services/sync/PermissionService'),import('../services/sync/SyncFeatureFlags')]);
        const next=await readPendingSyncDocuments(dbAdapter,{page,search,status,master:permissionService.isMasterTerminal(),terminalId:permissionService.getTerminalId()||'',durableEnabled:isSyncFeatureEnabled('sqlite_outbox_v2')});
        if(active){setResult(next);setSelected(next.rows[0]||null);}
      }catch{if(active)setError('No se pudo consultar la cola local. Esta vista requiere SQLite y no carga documentos completos como alternativa.');}
      finally{if(active)setLoading(false);}
    })();
    return ()=>{active=false;};
  },[page,search,status,revision]);
  const canRetry=canRetryPendingSyncQueue(selected);
  const retry=async()=>{
    if(retryBusy.current||!canRetry)return;
    retryBusy.current=true;setRetrying(true);setMessage('Solicitando reintento de la cola elegible…');
    try{
      const {backgroundSyncManager}=await import('../services/sync/BackgroundSyncManager');
      await retryPendingSyncQueue(backgroundSyncManager,navigator.onLine);
      if(mounted.current)setMessage('Reintento de la cola finalizado. Revisa el estado actualizado; esto no confirma recepción por el ERP.');
    }catch{if(mounted.current)setMessage('No se pudo completar el reintento. Se conservan los documentos y sus estados.');}
    finally{retryBusy.current=false;if(mounted.current){setRetrying(false);setConfirmRetry(false);setRevision(value=>value+1);}}
  };
  return createPortal(<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-3" onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="pending-sync-title" data-pos-scanner-enabled="false" className="flex max-h-[94dvh] w-full max-w-6xl flex-col rounded-2xl bg-white p-4 text-slate-800 shadow-xl">
      <div className="flex items-center justify-between gap-3"><h2 id="pending-sync-title" className="text-lg font-bold">Documentos pendientes de sincronización</h2><button ref={closeButton} type="button" onClick={onClose} aria-label="Cerrar documentos pendientes" className="rounded border px-3 py-2">Cerrar</button></div>
      <p className="mt-2 text-sm">Consulta de documentos, eventos durables, recepciones y progreso de series locales. Un documento puede tener varios eventos: este listado no equivale al contador del indicador. El diagnóstico contiene solo el resumen seleccionado.</p>
      <form className="my-3 flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();setPage(1);setSearch(draft);}}>
        <input aria-label="Buscar número o identificador" placeholder="Número o identificador" value={draft} maxLength={120} onChange={event=>setDraft(event.target.value)} className="min-w-0 rounded border p-2" />
        <button type="submit" className="rounded border px-3">Buscar</button>
        <select aria-label="Estado de sincronización" value={status} onChange={event=>{setPage(1);setStatus(event.target.value as typeof status);}} className="rounded border p-2"><option value="ALL">Todos los pendientes</option><option value="PENDING">En espera / enviando</option><option value="BLOCKED">Bloqueados / rechazados</option></select>
        <button type="button" disabled={loading||retrying} onClick={()=>setRevision(value=>value+1)} className="rounded border px-3 disabled:opacity-50">Actualizar</button>
      </form>
      {error&&<p role="alert" className="mb-2 text-red-700">{error}</p>}
      {loading?<p role="status">Leyendo resúmenes locales…</p>:!error&&<>
        <div className="min-h-0 overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{['Seleccionar','Tipo / cola','Número / ID','Fecha / terminal','Importe','Estado / intentos','Motivo'].map(label=><th key={label} className="border-b p-2">{label}</th>)}</tr></thead><tbody>
          {result?.rows.map((row,index)=><tr key={`${row.source}:${row.id}:${index}`} className={selected===row?'bg-blue-50':''}>
            <td className="p-2"><input type="radio" name="pending-document" aria-label={`Seleccionar ${row.reference}`} checked={selected===row} onChange={()=>{setSelected(row);setJson('');setConfirmRetry(false);}} /></td>
            <td className="p-2">{labels[row.source]||row.source}<br/><span className="text-xs">{row.kind}</span></td><td className="max-w-64 break-all p-2">{row.reference}<br/><span className="text-xs text-slate-500">{row.id}</span></td><td className="p-2">{row.date||'—'}<br/>{row.terminal||'—'}</td><td className="p-2">{row.amount==null?'—':row.amount.toFixed(2)}</td><td className="p-2">{row.status}<br/>{row.attempts} intentos</td><td className="max-w-64 break-words p-2">{row.reason||'Sin motivo registrado'}</td>
          </tr>)}
        </tbody></table>{!result?.rows.length&&<p className="p-4">No hay registros que coincidan con este filtro.</p>}</div>
        <div className="mt-3 flex items-center gap-3"><button type="button" disabled={!result||result.page<=1} onClick={()=>setPage(Math.max(1,(result?.page||1)-1))} className="rounded border px-3 py-2 disabled:opacity-50">Anterior</button><span>{result?.total||0} registros · Página {result?.page||1} de {Math.max(1,Math.ceil((result?.total||0)/20))}</span><button type="button" disabled={!result||result.page*20>=result.total} onClick={()=>setPage((result?.page||1)+1)} className="rounded border px-3 py-2 disabled:opacity-50">Siguiente</button></div>
      </>}
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!selected||loading} onClick={()=>{if(selected)setJson(pendingSyncDiagnostic(selected));}} className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50">JSON diagnóstico</button><button type="button" disabled={!canRetry||loading||retrying||!navigator.onLine} onClick={()=>setConfirmRetry(true)} className="rounded border px-3 py-2 disabled:opacity-50">Reenviar cola elegible</button><button type="button" disabled title="No hay descarte seguro disponible para estos documentos y eventos" className="rounded border px-3 py-2 opacity-50">Descartar (protegido)</button></div>
      <p className="mt-2 text-xs">No se borran ventas, pagos, documentos fiscales, inventario ni eventos. Los bloqueados requieren resolver su motivo; reenviar no elimina su protección.</p>
      {confirmRetry&&<div className="mt-3 rounded border border-amber-300 p-3"><p>Se reintentará la cola pendiente elegible completa con sus identificadores originales, no solo la fila seleccionada. No se desbloquearán documentos rechazados. ¿Continuar?</p><button type="button" disabled={retrying} onClick={()=>void retry()} className="mt-2 rounded bg-amber-100 px-3 py-2">Confirmar reintento de cola</button><button type="button" disabled={retrying} onClick={()=>setConfirmRetry(false)} className="ml-2 rounded border px-3 py-2">Cancelar</button></div>}
      {message&&<p role="status" className="mt-2 text-sm">{message}</p>}
      {json&&<div className="mt-3"><button type="button" onClick={()=>void (async()=>{try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(json);setMessage('Resumen copiado.');}catch{setMessage('Selecciona y copia el resumen manualmente.');}})()} className="rounded border px-3 py-2">Copiar JSON</button><textarea aria-label="JSON de diagnóstico del resumen seleccionado" value={json} readOnly onFocus={event=>event.currentTarget.select()} className="mt-2 h-32 w-full rounded border p-2 font-mono text-xs" /></div>}
    </div>
  </div>,document.body);
}
