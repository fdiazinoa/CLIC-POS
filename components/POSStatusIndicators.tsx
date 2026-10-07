import React from 'react';
import { Cloud, CloudOff, Landmark } from 'lucide-react';

// Presentation only: callers retain the existing fiscal and sync state sources.
export function FiscalStatusBadge({ visible, allowed, status, compact = false }: {
  visible: boolean; allowed: boolean; compact?: boolean;
  status: { type: string; hasNCF: boolean; isTerminalBlock?: boolean; isUsingPool?: boolean };
}) {
  if (!visible) return null;
  return <div role="status" className={`${compact ? 'supermarket-fiscal-status' : 'mt-1'} flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase ${allowed ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
    <Landmark size={12} className="shrink-0" />
    <span>Status Fiscal: {`${status.type} ${status.hasNCF ? (status.isTerminalBlock ? 'Bloque Terminal' : (status.isUsingPool ? 'Reservado en Pool' : 'Lote Global Activo')) : 'Agotado'}`}</span>
  </div>;
}

export function SyncStatusBadge({ online, state, className = '' }: {
  online: boolean; state: { hasError: boolean; pendingCount: number; blockedCount: number }; className?: string;
}) {
  const attention = state.hasError || state.pendingCount > 0 || state.blockedCount > 0;
  return <div role="status" className={`${className} flex items-center gap-2 px-2.5 md:px-4 py-1.5 md:py-2 rounded-xl md:rounded-2xl bg-gray-50 border border-gray-100 shadow-inner`}>
    {!online ? <CloudOff size={18} className="shrink-0 text-red-500" /> : <Cloud size={18} className={`shrink-0 ${attention ? 'text-amber-500' : 'text-emerald-500'}`} />}
    <div className="flex flex-col leading-none">
      <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest hidden md:block">Sincronización</span>
      <span className={`text-[10px] font-bold ${!online ? 'text-red-600' : attention ? 'text-amber-600' : 'text-emerald-600'}`}>
        {!online ? 'Offline' : state.blockedCount > 0 ? `Bloqueado · ${state.blockedCount}` : state.pendingCount > 0 ? `Online · ${state.pendingCount}` : 'Online'}
      </span>
    </div>
  </div>;
}

export function TicketStatusControls({ status, children, className = '', ...attributes }: React.HTMLAttributes<HTMLDivElement> & { status?: React.ReactNode }) {
  return <div {...attributes} className={`${className} ${status ? 'supermarket-status-controls' : ''}`}>{status}{children}</div>;
}

export function TicketTotalStatusRow({ status, children, className = '' }: { status?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <div className={`${className} ${status ? 'supermarket-total-status-row' : ''}`}>{children}{status}</div>;
}
