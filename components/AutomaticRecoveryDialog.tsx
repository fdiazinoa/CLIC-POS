import React, { useSyncExternalStore } from 'react';
import { automaticRecovery } from '../services/recovery/recoveryService';

export default function AutomaticRecoveryDialog() {
  const state = useSyncExternalStore(automaticRecovery.subscribe, automaticRecovery.getSnapshot);
  if (state.phase === 'idle') return null;
  const failed = state.phase === 'error';
  const stage = state.phase === 'downloading' ? 'Descargando y verificando el respaldo…'
    : state.phase === 'restoring' ? 'Restaurando movimientos de esta terminal…'
    : state.phase === 'ready' ? 'Movimientos restaurados. Actualizando POS…' : 'No pudimos completar la recuperación.';
  return <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-slate-950/60 p-6">
    <section role="dialog" aria-modal="true" aria-labelledby="automatic-recovery-title" className="w-full max-w-lg rounded-2xl bg-white p-7 shadow-xl">
      <h2 id="automatic-recovery-title" className="text-2xl font-bold text-slate-900">Recuperando tu terminal</h2>
      <p className="mt-3 text-slate-600">Estamos recuperando los movimientos que ERP recibió antes de perder la base local.</p>
      <p role="status" aria-live="polite" className="mt-5 font-medium text-slate-900">{stage}</p>
      {!failed && <progress aria-label={stage} className="mt-4 w-full" />}
      {failed && <>
        <p className="mt-3 text-sm text-slate-600">Comprueba la conexión y reintenta. La descarga puede reanudarse.</p>
        <details className="mt-3 text-sm"><summary>Ver detalle</summary><p className="break-words">{state.error}</p></details>
        <button className="mt-5 rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white" onClick={() => void automaticRecovery.start()}>Reintentar</button>
      </>}
    </section>
  </div>;
}
