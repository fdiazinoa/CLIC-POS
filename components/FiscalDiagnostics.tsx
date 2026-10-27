import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, ShieldCheck, ShieldAlert, Eraser, Loader2, ClipboardCopy } from 'lucide-react';
import { clicConfirm, clicPrompt, clicAlert } from '../services/dialog/ClicDialogService';
import type { RoleDefinition, User } from '../types';

type Snapshot = Awaited<ReturnType<typeof readSnapshot>>;

const readSnapshot = async () => {
   const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
   const { needsTerminalReauthorization } = await import('../services/sync/TerminalReauthorizationService');
   const diagnostics = await fiscalWorkflowV2Client.diagnostics();
   let reauthorization = { required: false, reason: '' } as { required: boolean; reason: string };
   try { reauthorization = needsTerminalReauthorization(); } catch (error) { reauthorization = { required: true, reason: error instanceof Error ? error.message : String(error) }; }
   return { ...diagnostics, reauthorization };
};

const tone = (ok: boolean) => ok ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200';

/**
 * Everything the fiscal checkout consults before charging, in one screen.
 * It is read-only except for the two recovery actions, which never touch a document.
 */
export default function FiscalDiagnostics({ onClose, users = [], roles = [], currentUser = null }: { onClose: () => void; users?: User[]; roles?: RoleDefinition[]; currentUser?: User | null }) {
   const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
   const [busy, setBusy] = useState<'refresh' | 'prepare' | 'release' | null>(null);
   const [note, setNote] = useState('');
   const [releaseOffered, setReleaseOffered] = useState(false);

   const refresh = useCallback(async () => {
      setBusy('refresh');
      try { setSnapshot(await readSnapshot()); } catch (error) { setNote(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(null); }
   }, []);

   useEffect(() => { void refresh(); }, [refresh]);

   const prepare = async () => {
      setBusy('prepare');
      try {
         const { reauthorizeTerminal } = await import('../services/sync/TerminalReauthorizationService');
         const result = await reauthorizeTerminal();
         setNote(result.message);
         setSnapshot(await readSnapshot());
      } catch (error) { setNote(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(null); }
   };

   const release = async () => {
      setBusy('release');
      try {
         setReleaseOffered(false);
         const confirmed = await clicConfirm('¿Cerrar el intento fiscal pendiente?\n\nLa caja pedirá al ERP que confirme que ese intento nunca emitió comprobante. Si el ERP tiene un documento, no se toca nada y te dirá por qué.');
         if (!confirmed) return;
         const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
         const outcome = await fiscalWorkflowV2Client.cancelUnreconcilableAttempt({});
         setNote(outcome.note);
         setReleaseOffered(!outcome.cancelled && /FISCAL_WORKFLOW_(DISABLED|UNAVAILABLE)/.test(outcome.note));
         setSnapshot(await readSnapshot());
      } catch (error) { setNote(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(null); }
   };

   /** Break-glass: only when the ERP retirement service answers DISABLED/UNAVAILABLE, the attempt
    * has no local effects and a supervisor authorizes it with their PIN. */
   const releaseWithoutErp = async () => {
      const authorized = users.filter(user => {
         const role = roles.find(item => item.id === user.role);
         return Array.isArray(role?.permissions) && role!.permissions.includes('POS_CHECKOUT' as any);
      });
      const candidates = authorized.length ? authorized : currentUser ? [currentUser] : [];
      if (!candidates.length) { setNote('Ningún usuario de esta caja puede autorizar la liberación.'); return; }
      const pin = await clicPrompt('El ERP no puede confirmar el intento. Escribe el PIN de un supervisor para liberar la caja. Verifica antes en el ERP que ese intento no tenga comprobante; la liberación queda registrada con tu nombre.', { inputType: 'password', required: true });
      if (!pin) return;
      const supervisor = candidates.find(user => String(user.pin) === String(pin).trim());
      if (!supervisor) { setNote('PIN incorrecto o sin permiso de cobro.'); return; }
      const confirmed = await clicConfirm(`Se liberará la caja del intento pendiente con la autorización de ${supervisor.name}. El intento queda registrado y no se puede reutilizar. ¿Continuar?`);
      if (!confirmed) return;
      setBusy('release');
      try {
         const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
         const outcome = await fiscalWorkflowV2Client.releasePendingAttempt(`${supervisor.name} (${supervisor.id})`);
         setNote(outcome.note);
         setReleaseOffered(false);
         setSnapshot(await readSnapshot());
         if (outcome.released) await clicAlert('Caja liberada. No se emitió ni anuló ningún comprobante. Verifica en el ERP que el intento no tenga documento antes de volver a cobrar.');
      } catch (error) { setNote(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(null); }
   };

   const copy = async () => {
      if (!snapshot) return;
      const text = [
         `Autorización: ${snapshot.authStatus}${snapshot.reauthorization.required ? ` · ${snapshot.reauthorization.reason}` : ''}`,
         `Ámbito: ${snapshot.scope}`,
         `Capacidad fiscal V2: ${snapshot.enabled ? 'sí' : 'no'}`,
         `Reserva offline: ${snapshot.readiness} · lista: ${snapshot.offlineReady ? 'sí' : 'no'}`,
         `Intento fiscal: ${snapshot.attempt}`,
         `Vinculación: ${snapshot.binding}`,
         `Autorización local: ${snapshot.lease}`,
         `Último error de preparación: ${snapshot.lastError || 'ninguno'}`,
      ].join('\n');
      try { await navigator.clipboard.writeText(text); setNote('Diagnóstico copiado.'); } catch { setNote(text); }
   };

   const rows: Array<{ label: string; value: string; ok: boolean }> = snapshot ? [
      { label: 'Autorización de la terminal', value: snapshot.reauthorization.required ? `${snapshot.authStatus} · ${snapshot.reauthorization.reason}` : snapshot.authStatus, ok: snapshot.authStatus === 'OK' && !snapshot.reauthorization.required },
      { label: 'Capacidad fiscal V2', value: snapshot.enabled ? 'Habilitada' : 'No habilitada por el ERP', ok: snapshot.enabled },
      { label: 'Reserva fiscal local', value: snapshot.readiness, ok: snapshot.offlineReady || /READY/.test(snapshot.readiness) },
      { label: 'Comprobantes locales', value: snapshot.lease, ok: !/SIN RESERVA/.test(snapshot.lease) },
      { label: 'Intento fiscal guardado', value: snapshot.attempt, ok: /NINGUNO|SIN INTENTO|COMMITTED|ACKNOWLEDGED/.test(snapshot.attempt) },
      { label: 'Vinculación', value: snapshot.binding || '—', ok: /misma vinculación|autoridad local OK/.test(snapshot.binding) },
      { label: 'Ámbito', value: snapshot.scope || '—', ok: Boolean(snapshot.scope) },
   ] : [];

   return (
      <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
         <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center gap-3">
               <button onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100"><ArrowLeft size={20} /></button>
               <div>
                  <h2 className="text-base font-black text-gray-900">Diagnóstico fiscal</h2>
                  <p className="text-xs text-gray-500">Estado real del cobro fiscal de esta caja</p>
               </div>
            </div>
            <div className="flex items-center gap-2">
               <button onClick={() => { void copy(); }} disabled={!snapshot} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 disabled:opacity-40"><ClipboardCopy size={14} /> Copiar</button>
               <button onClick={() => { void refresh(); }} disabled={busy !== null} className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{busy === 'refresh' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar</button>
            </div>
         </div>

         <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!snapshot ? <p className="p-6 text-center text-sm text-gray-500">{busy ? 'Leyendo el estado fiscal…' : 'Sin datos.'}</p> : (
               <div className="space-y-2">
                  {rows.map(row => (
                     <div key={row.label} className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-xs font-black uppercase tracking-wide text-gray-500">{row.label}</span>
                        <span className={`max-w-full break-words rounded-lg border px-2 py-1 text-xs font-bold ${tone(row.ok)}`}>{row.value}</span>
                     </div>
                  ))}
                  {snapshot.lastError && <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">Último error de preparación: {snapshot.lastError}</p>}
               </div>
            )}

            {note && <p className="mt-3 whitespace-pre-wrap rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-bold text-sky-900">{note}</p>}
            {releaseOffered && (
               <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3">
                  <p className="text-xs font-bold leading-relaxed text-rose-900">El ERP no puede confirmar ni retirar el intento (servicio deshabilitado). Si verificaste que no hay comprobante, un supervisor puede liberar la caja; queda registrado con su nombre.</p>
                  <button onClick={() => { void releaseWithoutErp(); }} disabled={busy !== null} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 py-3 text-sm font-black text-white disabled:opacity-40">{busy === 'release' ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />} Liberar con autorización</button>
               </div>
            )}

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
               <button onClick={() => { void prepare(); }} disabled={busy !== null} className="flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 text-sm font-black text-white disabled:opacity-40">{busy === 'prepare' ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Renovar reserva fiscal</button>
               <button onClick={() => { void release(); }} disabled={busy !== null} className="flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-black text-white disabled:opacity-40">{busy === 'release' ? <Loader2 size={16} className="animate-spin" /> : <Eraser size={16} />} Cerrar intento pendiente</button>
            </div>
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[11px] font-medium leading-relaxed text-gray-500">
               <ShieldAlert size={14} className="mt-0.5 shrink-0 text-gray-400" />
               «Cerrar intento pendiente» solo descarta un intento que nunca llegó a tener efecto. Si el intento ya pudo cobrar, la caja se lo dirá y habrá que verificarlo en el ERP: nunca emite ni anula comprobantes por sí solo.
            </p>
         </div>
      </div>
   );
}
