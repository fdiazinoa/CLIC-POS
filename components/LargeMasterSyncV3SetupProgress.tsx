import React, { useSyncExternalStore } from 'react';
import type { V3Progress } from '../services/sync/LargeMasterSyncV3Progress';

const labels: Record<string, string> = {
  negotiation: 'Preparando sincronización V3...', manifest: 'Preparando manifiesto del catálogo...',
  catalog: 'Guardando catálogo V3...', validation: 'Validando catálogo V3...', activation: 'Activando catálogo V3...',
  inventory_download: 'Descargando inventario...', inventory_save: 'Guardando inventario...',
  inventory_readback: 'Verificando inventario guardado...', runtime: 'Verificando catálogo operativo...',
  owner: 'Verificando sesión y pertenencia del catálogo...', cached: 'Catálogo existente verificado',
  verified: 'Catálogo existente verificado', config: 'Aplicando configuración y seguridad...', ready: 'Terminal lista',
};

/** Only this small subtree observes bounded progress; App/catalog/roster do not. */
export default function LargeMasterSyncV3SetupProgress({ progress }: { progress: V3Progress }) {
  const state = useSyncExternalStore(progress.subscribe, progress.getSnapshot, progress.getSnapshot);
  const numeric = state.phase === 'catalog' && state.percent !== undefined;
  const label = labels[state.phase] || 'Preparando terminal...';
  return <div className="w-80 max-w-full text-center" aria-live="polite">
    <p>{state.failed ? `Error: ${label}` : label}</p>
    <div role="progressbar" aria-label="Progreso de catálogo V3" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={numeric ? state.percent : undefined}
      aria-valuetext={state.failed ? `Error: ${label}` : numeric
        ? `Catálogo V3: ${state.appliedChunks} de ${state.totalChunks} bloques (${state.percent}%)` : label}
      className="h-3 overflow-hidden rounded bg-slate-700 mt-4">
      <div className={`h-full bg-blue-500 ${!numeric && !state.failed ? 'animate-pulse w-full' : ''}`}
        style={numeric ? { width: `${state.percent}%` } : undefined} />
    </div>
    {numeric && <p className="mt-2 text-sm">Catálogo V3: {state.appliedChunks} de {state.totalChunks} bloques ({state.percent}%)</p>}
    <p className="mt-2 text-xs text-slate-400">El catálogo completo no significa que la terminal esté lista.</p>
  </div>;
}
