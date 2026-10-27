import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Loader2, ClipboardCopy, Stethoscope } from 'lucide-react';
import type { BusinessConfig, CartItem, RoleDefinition, User } from '../types';
import { runPresentationDiagnostics, type PresentationCheck } from '../services/inventoryPresentations/diagnostics';
import { describePresentationError } from '../utils/presentationErrorMessages';

const tone = (status: PresentationCheck['status']) => status === 'OK'
   ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
   : status === 'WARN'
      ? 'text-amber-700 bg-amber-50 border-amber-200'
      : 'text-rose-700 bg-rose-50 border-rose-200';

/**
 * Step-by-step sweep of the presentations chain: session, sale scope, ERP negotiation,
 * cache and the cart lines. Read-only; it exists so a divergence between the box and the
 * ERP is visible field by field instead of as a single protocol code.
 */
export default function PresentationDiagnostics({ onClose, config, terminalId, cart = [], onUpdateConfig }: {
   onClose: () => void;
   config: BusinessConfig;
   terminalId: string;
   cart?: CartItem[];
   onUpdateConfig?: (next: BusinessConfig, restart?: boolean) => void;
   users?: User[];
   roles?: RoleDefinition[];
   currentUser?: User | null;
}) {
   const [rows, setRows] = useState<PresentationCheck[]>([]);
   const [busy, setBusy] = useState(false);
   const [note, setNote] = useState('');
   const [erpScope, setErpScope] = useState<{ warehouseId: string | null; localId: string | null }>({ warehouseId: null, localId: null });

   const run = useCallback(async () => {
      setBusy(true);
      try {
         const { dbAdapter } = await import('../services/db');
         await dbAdapter.connect().catch(() => undefined);
         const sql = dbAdapter.inventoryPresentationsSQL?.();
         const names = Object.fromEntries(((config.terminals.find(t => t.id === terminalId)?.config.inventoryScope?.warehouses) || [])
            .flatMap(warehouse => [[warehouse.id, warehouse.name || warehouse.code || warehouse.id], [warehouse.inventoryLocalId, warehouse.name || warehouse.code || warehouse.id]]));
         const result = await runPresentationDiagnostics({ config, terminalId, cartLines: cart, warehouseNames: names, ...(sql ? { sql } : {}) });
         setRows(result.checks);
         setErpScope({ warehouseId: result.erpWarehouseId, localId: result.erpLocalId });
      } catch (error) {
         setNote(describePresentationError(error));
      } finally {
         setBusy(false);
      }
   }, [config, terminalId, cart]);

   useEffect(() => { void run(); }, [run]);

   /** Adopts the ERP default warehouse for this box, exactly the one the ERP negotiates for presentations. */
   const alignWithErp = async () => {
      const target = erpScope.warehouseId;
      if (!target) { setNote('El ERP no informó un almacén de venta.'); return; }
      const terminal = config.terminals.find(row => row.id === terminalId);
      const scope = terminal?.config.inventoryScope;
      const warehouses = scope?.warehouses || [];
      const match = warehouses.find(warehouse => warehouse.id === target || warehouse.erpWarehouseId === target || warehouse.inventoryLocalId === target);
      if (!terminal || !scope || !match) { setNote('El almacén del ERP no está entre los almacenes autorizados de esta caja. Autorízalo en el ERP y vuelve a sincronizar.'); return; }
      const nextConfig: BusinessConfig = {
         ...config,
         terminals: config.terminals.map(row => row.id === terminalId
            ? { ...row, config: { ...row.config, inventoryScope: { ...scope, defaultSalesWarehouseId: match.id, visibleWarehouseIds: scope.visibleWarehouseIds, defaultWarehouse: match, warehouses } } }
            : row),
      };
      onUpdateConfig?.(nextConfig);
      setNote(`Almacén de venta de la caja alineado con el ERP: ${match.name || match.code || match.id}. Vuelve a intentar la presentación.`);
      setBusy(true);
      setTimeout(() => { setBusy(false); void run(); }, 400);
   };

   const copy = async () => {
      const text = rows.map(row => `${row.status} · ${row.label}: ${row.detail}`).join('\n');
      try { await navigator.clipboard.writeText(text); setNote('Diagnóstico copiado.'); } catch { setNote(text); }
   };

   const failed = rows.filter(row => row.status === 'FAIL');

   return (
      <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
         <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center gap-3">
               <button onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100"><ArrowLeft size={20} /></button>
               <div>
                  <h2 className="text-base font-black text-gray-900">Diagnóstico de presentaciones</h2>
                  <p className="text-xs text-gray-500">Sesión, ámbito de venta, ERP, caché y carrito</p>
               </div>
            </div>
            <div className="flex items-center gap-2">
               <button onClick={() => { void copy(); }} disabled={!rows.length} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 disabled:opacity-40"><ClipboardCopy size={14} /> Copiar</button>
               <button onClick={() => { void run(); }} disabled={busy} className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Repetir</button>
            </div>
         </div>

         <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!rows.length ? <p className="p-6 text-center text-sm text-gray-500">{busy ? 'Revisando la cadena de presentaciones…' : 'Sin datos.'}</p> : (
               <div className="space-y-2">
                  {rows.map(row => (
                     <div key={row.id} className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-xs font-black uppercase tracking-wide text-gray-500">{row.label}</span>
                        <span className={`max-w-full break-words rounded-lg border px-2 py-1 text-xs font-bold ${tone(row.status)}`}>{row.detail}</span>
                     </div>
                  ))}
               </div>
            )}

            {rows.some(row => row.id === 'warehouse' && row.status === 'FAIL') && (
               <div className="mt-3 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3">
                  <p className="text-xs font-bold leading-relaxed text-sky-900">La caja vende desde un almacén distinto al que el ERP usa para presentaciones (el de por defecto en la terminal). Puedes adoptar el del ERP para esta caja.</p>
                  <button onClick={() => { void alignWithErp(); }} disabled={busy} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-3 text-sm font-black text-white disabled:opacity-40">Usar el almacén del ERP</button>
               </div>
            )}
            {failed.length > 0 && (
               <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-900">
                  {failed.length} chequeo(s) en rojo. Los valores de la izquierda son de la caja y los de la derecha del ERP: alinearlos en el ERP es lo que reactiva las presentaciones.
               </p>
            )}
            {note && <p className="mt-3 whitespace-pre-wrap rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-bold text-sky-900">{note}</p>}

            <p className="mt-3 flex items-start gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[11px] font-medium leading-relaxed text-gray-500">
               <Stethoscope size={14} className="mt-0.5 shrink-0 text-gray-400" />
               Es de solo lectura: no descarga presentaciones ni emite documentos. Sirve para saber exactamente qué dato está fuera de lugar antes de tocar la caja o el ERP.
            </p>
         </div>
      </div>
   );
}
