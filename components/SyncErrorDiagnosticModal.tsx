import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clipboard, RefreshCw, X } from 'lucide-react';
import type { SyncErrorDiagnostic } from '../services/sync/SyncErrorDiagnostic';

interface SyncErrorDiagnosticModalProps {
  diagnostic: SyncErrorDiagnostic | null;
  onClose: () => void;
  onRetryProducts: () => Promise<void> | void;
}

const Field: React.FC<{ label: string; value: unknown }> = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</p>
    <p className="mt-1 break-all text-sm font-bold text-slate-800">{value === undefined || value === null || value === '' ? 'N/A' : String(value)}</p>
  </div>
);

const SyncErrorDiagnosticModal: React.FC<SyncErrorDiagnosticModalProps> = ({ diagnostic, onClose, onRetryProducts }) => {
  const [copyLabel, setCopyLabel] = useState('Copiar diagnóstico');
  const [isRetrying, setIsRetrying] = useState(false);
  const diagnosticJson = useMemo(() => diagnostic ? JSON.stringify(diagnostic, null, 2) : '', [diagnostic]);

  if (!diagnostic) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticJson);
      setCopyLabel('Copiado');
      window.setTimeout(() => setCopyLabel('Copiar diagnóstico'), 1600);
    } catch {
      setCopyLabel('No se pudo copiar');
      window.setTimeout(() => setCopyLabel('Copiar diagnóstico'), 1800);
    }
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await onRetryProducts();
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-red-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div className="flex gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-600">
              <AlertTriangle size={30} />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.38em] text-red-600">Diagnóstico de sincronización</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Falló la sincronización</h2>
              <p className="mt-2 text-sm font-bold text-slate-500">
                La terminal sigue vinculada. No se limpió el binding ni se reinició el perfil de sincronización.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50"
            aria-label="Cerrar"
          >
            <X size={22} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="operation" value={diagnostic.operation} />
            <Field label="collection" value={diagnostic.collection} />
            <Field label="target.kind" value={diagnostic.resolvedTargetKind} />
            <Field label="terminalBindingStatus" value={diagnostic.terminalBindingStatus} />
            <Field label="catalogSyncStatus" value={diagnostic.catalogSyncStatus} />
            <Field label="salesPushStatus" value={diagnostic.salesPushStatus} />
            <Field label="HTTP status" value={diagnostic.httpStatus} />
            <Field label="deviceId" value={diagnostic.deviceId} />
            <Field label="terminalId" value={diagnostic.terminalId} />
            <Field label="contractSource" value={diagnostic.contractSource} />
            <Field label="profilePriority" value={diagnostic.profileSourcePriority} />
            <Field label="mismatchDetected" value={diagnostic.mismatchDetected ? 'true' : 'false'} />
            <Field label="mismatchFixed" value={diagnostic.mismatchFixed ? 'true' : 'false'} />
            <Field label="isMasterCollection" value={diagnostic.isMasterCollection === undefined ? 'N/A' : diagnostic.isMasterCollection ? 'true' : 'false'} />
            <Field label="isOperationCollection" value={diagnostic.isOperationCollection === undefined ? 'N/A' : diagnostic.isOperationCollection ? 'true' : 'false'} />
            <Field label="isCriticalMaster" value={diagnostic.isCriticalMaster === undefined ? 'N/A' : diagnostic.isCriticalMaster ? 'true' : 'false'} />
            <Field label="skippedReason" value={diagnostic.skippedReason} />
            <Field label="severity" value={diagnostic.userVisibleSeverity} />
            <Field label="auth.authorization" value={diagnostic.requestAuth?.authorizationPresent === undefined ? 'N/A' : diagnostic.requestAuth.authorizationPresent ? 'true' : 'false'} />
            <Field label="auth.syncToken" value={diagnostic.requestAuth?.syncTokenPresent === undefined ? 'N/A' : diagnostic.requestAuth.syncTokenPresent ? 'true' : 'false'} />
            <Field label="auth.tokenPreview" value={diagnostic.requestAuth?.syncTokenPreview} />
            <Field label="auth.terminalHeader" value={diagnostic.requestAuth?.terminalIdHeaderPresent === undefined ? 'N/A' : diagnostic.requestAuth.terminalIdHeaderPresent ? 'true' : 'false'} />
            <Field label="auth.deviceHeader" value={diagnostic.requestAuth?.deviceIdHeaderPresent === undefined ? 'N/A' : diagnostic.requestAuth.deviceIdHeaderPresent ? 'true' : 'false'} />
            <Field label="fetchStage" value={diagnostic.fetchStage} />
            <Field label="HTTP method" value={diagnostic.httpMethod} />
            <Field label="fetch.tokenPresent" value={diagnostic.fetchDiagnostic?.tokenPresent === undefined ? 'N/A' : diagnostic.fetchDiagnostic.tokenPresent ? 'true' : 'false'} />
            <Field label="fetch.tokenPreview" value={diagnostic.fetchDiagnostic?.tokenPreview} />
            <Field label="fetch.tokenLength" value={diagnostic.fetchDiagnostic?.tokenLength} />
            <Field label="fetch.tokenSource" value={diagnostic.fetchDiagnostic?.tokenSource} />
            <Field label="networkOnline" value={diagnostic.networkOnline === undefined || diagnostic.networkOnline === null ? 'N/A' : diagnostic.networkOnline ? 'true' : 'false'} />
            <Field label="capacitorPlatform" value={diagnostic.capacitorPlatform} />
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">endpoint</p>
            <p className="mt-2 break-all text-sm font-bold text-slate-800">{diagnostic.endpoint || 'N/A'}</p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">resolvedTarget</p>
              <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 p-4 text-xs font-semibold text-slate-100">{JSON.stringify(diagnostic.resolvedTarget, null, 2)}</pre>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">SyncProfile</p>
              <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 p-4 text-xs font-semibold text-slate-100">{JSON.stringify(diagnostic.syncProfile, null, 2)}</pre>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-2">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">requestAuth</p>
              <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 p-4 text-xs font-semibold text-slate-100">{JSON.stringify(diagnostic.requestAuth || null, null, 2)}</pre>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-2">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">fetchDiagnostic</p>
              <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 p-4 text-xs font-semibold text-slate-100">{JSON.stringify(diagnostic.fetchDiagnostic || null, null, 2)}</pre>
            </div>
          </div>

          {(diagnostic.existingProfile || diagnostic.incomingProfile) && (
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">existingProfile</p>
                <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 p-4 text-xs font-semibold text-slate-100">{JSON.stringify(diagnostic.existingProfile || null, null, 2)}</pre>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">incomingProfile</p>
                <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 p-4 text-xs font-semibold text-slate-100">{JSON.stringify(diagnostic.incomingProfile || null, null, 2)}</pre>
              </div>
            </div>
          )}

          <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-500">error.message</p>
            <p className="mt-2 whitespace-pre-wrap text-sm font-bold text-red-800">{diagnostic.errorMessage || 'N/A'}</p>
            {diagnostic.responseBody && (
              <>
                <p className="mt-4 text-[10px] font-black uppercase tracking-[0.24em] text-red-500">response body</p>
                <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs font-semibold text-red-900">{diagnostic.responseBody}</pre>
              </>
            )}
            {diagnostic.errorStack && (
              <>
                <p className="mt-4 text-[10px] font-black uppercase tracking-[0.24em] text-red-500">stack</p>
                <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs font-semibold text-red-900">{diagnostic.errorStack}</pre>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-100"
          >
            <Clipboard size={18} />
            {copyLabel}
          </button>
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
          >
            <RefreshCw size={18} className={isRetrying ? 'animate-spin' : ''} />
            {isRetrying ? 'Reintentando...' : 'Reintentar artículos'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SyncErrorDiagnosticModal;
