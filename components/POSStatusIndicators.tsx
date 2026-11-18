import React, { lazy, Suspense, useCallback, useState } from 'react';
import { Cloud, CloudOff, Landmark } from 'lucide-react';
const PendingSyncDocumentsModal = lazy(()=>import('./PendingSyncDocumentsModal'));

// Presentation only: callers retain the existing fiscal and sync state sources.
export function FiscalStatusBadge({ visible, allowed, status, compact = false, short = false, inline = false }: {
  visible: boolean; allowed: boolean; compact?: boolean; short?: boolean; inline?: boolean;
  status: { type: string; hasNCF: boolean; isTerminalBlock?: boolean; isUsingPool?: boolean };
}) {
  if (!visible) return null;
  const detail = `${status.type} ${status.hasNCF ? (status.isTerminalBlock ? 'Bloque Terminal' : (status.isUsingPool ? 'Reservado en Pool' : 'Lote Global Activo')) : 'Agotado'}`;
  if (inline) {
    return <details className={`handheld-fiscal ${allowed ? 'handheld-fiscal-ready' : 'handheld-fiscal-blocked'}`}>
      <summary aria-label={`Estado fiscal: ${detail}`}><Landmark size={11} aria-hidden="true" />Fiscal · {status.type}{!status.hasNCF ? ' · Agotado' : ''}</summary>
      <div role="status">{detail}</div>
    </details>;
  }
  if (short) {
    return <div role="status" aria-label={`Status Fiscal: ${detail}`} title={`Status Fiscal: ${detail}`}
      className={`flex h-12 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border px-1 text-[9px] font-black uppercase leading-tight ${allowed ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
      <Landmark size={18} className="shrink-0" />
      <span className="max-w-full truncate">{status.type}</span>
    </div>;
  }
  const label = short ? status.type : `Status Fiscal: ${detail}`;
  return <div role="status" aria-label={`Status Fiscal: ${detail}`} title={`Status Fiscal: ${detail}`}
    className={`${compact ? 'supermarket-fiscal-status' : 'mt-1'} flex items-center gap-1.5 ${short ? 'px-2' : 'px-3'} py-1.5 rounded-lg border text-[10px] font-bold uppercase whitespace-nowrap ${allowed ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
    <Landmark size={12} className="shrink-0" />
    <span>{label}</span>
  </div>;
}

export function SyncStatusBadge({ online, state, className = '' }: {
  online: boolean; state: { hasError: boolean; pendingCount: number; blockedCount: number }; className?: string;
}) {
  const attention = state.hasError || state.pendingCount > 0 || state.blockedCount > 0;
  const [showPending,setShowPending]=useState(false);
  const closePending=useCallback(()=>setShowPending(false),[]);
  return <><button type="button" aria-label="Ver documentos pendientes de sincronización" aria-haspopup="dialog" onClick={()=>setShowPending(true)} className={`${className} flex items-center gap-2 px-2.5 md:px-4 py-1.5 md:py-2 rounded-xl md:rounded-2xl bg-gray-50 border border-gray-100 shadow-inner`}>
    {!online ? <CloudOff size={18} className="shrink-0 text-red-500" /> : <Cloud size={18} className={`shrink-0 ${attention ? 'text-amber-500' : 'text-emerald-500'}`} />}
    <div role="status" className="flex flex-col leading-none">
      <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest hidden md:block">Sincronización</span>
      <span className={`text-[10px] font-bold ${!online ? 'text-red-600' : attention ? 'text-amber-600' : 'text-emerald-600'}`}>
        {!online ? 'Offline' : state.blockedCount > 0 ? `Bloqueado · ${state.blockedCount}` : state.pendingCount > 0 ? `Online · ${state.pendingCount}` : 'Online'}
      </span>
    </div>
  </button>{showPending&&<Suspense fallback={<div role="status">Abriendo documentos pendientes…</div>}><PendingSyncDocumentsModal onClose={closePending}/></Suspense>}</>;
}

export function TicketStatusControls({ status, children, className = '', ...attributes }: React.HTMLAttributes<HTMLDivElement> & { status?: React.ReactNode }) {
  return <div {...attributes} className={`${className} ${status ? 'supermarket-status-controls' : ''}`}>{status}{children}</div>;
}

export function TicketTotalStatusRow({ status, children, className = '' }: { status?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <div className={`${className} ${status ? 'supermarket-total-status-row' : ''}`}>{children}{status}</div>;
}
