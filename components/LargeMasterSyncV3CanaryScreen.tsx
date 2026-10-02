import React, { useState } from 'react';
import { getInitialConfig } from '../constants';
import { SubVertical } from '../types';
import { bindTerminalFromErp } from '../services/setup/erpTerminalSetup';
import { readTerminalCredentialsSync } from '../services/sync/TerminalCredentialStore';
import {
  runLargeMasterSyncV3Canary,
  type LargeMasterSyncV3CanaryInput,
} from '../services/sync/LargeMasterSyncV3Canary';

const initialIdentity = (): LargeMasterSyncV3CanaryInput => {
  const credentials = readTerminalCredentialsSync();
  return {
    erpBaseUrl: localStorage.getItem('CLIC_ERP_BASE_URL') || '',
    tenantId: credentials.erpTenantId || credentials.tenantId || '',
    erpTerminalId: credentials.erpTerminalId || '',
    posDeviceId: credentials.deviceId || '',
    syncToken: credentials.syncToken || '',
  };
};

const LargeMasterSyncV3CanaryScreen: React.FC = () => {
  const [identity, setIdentity] = useState(initialIdentity);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Canario V3 sin ventas. Ninguna solicitud se envía hasta pulsar un botón.');
  const [progress, setProgress] = useState('');
  const update = (key: keyof LargeMasterSyncV3CanaryInput, value: string) => {
    setIdentity(current => ({ ...current, [key]: value }));
  };
  const register = async () => {
    setBusy(true);
    setMessage('Registrando explícitamente esta terminal en ERP...');
    try {
      const bound = await bindTerminalFromErp({
        currentConfig: getInitialConfig(SubVertical.SUPERMARKET),
        posDeviceId: identity.posDeviceId.trim(),
        terminalId: identity.erpTerminalId.trim(),
        erpTerminalId: identity.erpTerminalId.trim(),
        bindingMode: 'MASTER',
        tenantId: identity.tenantId.trim(),
        erpBaseUrl: identity.erpBaseUrl.trim(),
      });
      const token = bound.syncToken || bound.sync_token || '';
      if (!token) throw new Error('El registro ERP no devolvió syncToken. No se inició V3.');
      setIdentity(current => ({ ...current, erpTerminalId: bound.erp_terminal_id, tenantId: bound.tenant_id, syncToken: token }));
      setMessage('Registro autorizado. SyncToken disponible; pulsa “Probar descarga V3”.');
    } catch (error) {
      setMessage(`Registro detenido: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    setProgress('');
    setMessage('Solicitando configuración inicial con capability V3...');
    try {
      const result = await runLargeMasterSyncV3Canary(identity, metric => {
        setProgress(`${metric.event}${metric.progress == null ? '' : ` · ${Math.round(metric.progress * 100)}%`}`);
      });
      setMessage(result.status === 'legacy-fallback'
        ? 'ERP respondió en modo legacy o V3 no está habilitado. Fallback detectado; canario detenido sin cargar maestros legacy ni abrir ventas.'
        : `V3 activado en SQLite: versión ${result.syncVersion}, sesión ${result.syncId}. POS operativo permanece bloqueado.`);
    } catch (error) {
      setMessage(`Canario detenido sin ventas: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 flex justify-center">
      <section className="w-full max-w-xl space-y-4">
        <h1 className="text-xl font-bold">CLIC-POS · Canario Large Master Sync V3</h1>
        <p className="text-amber-300">Modo de laboratorio: ventas, cobros y operación POS deshabilitados en esta compilación.</p>
        {([
          ['erpBaseUrl', 'URL ERP'],
          ['tenantId', 'Tenant ID'],
          ['erpTerminalId', 'Terminal ERP ID'],
          ['posDeviceId', 'Device ID'],
        ] as const).map(([key, label]) => (
          <label key={key} className="block text-sm">{label}
            <input className="mt-1 w-full rounded bg-slate-800 p-2 text-white" value={identity[key]}
              onChange={event => update(key, event.target.value)} disabled={busy} autoComplete="off" />
          </label>
        ))}
        <p className="text-sm">SyncToken: {identity.syncToken ? 'disponible (oculto)' : 'no disponible; registra la terminal explícitamente'}</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={() => void register()}
            className="rounded bg-slate-700 px-4 py-2 disabled:opacity-50">Registrar terminal</button>
          <button type="button" disabled={busy || !identity.syncToken} onClick={() => void run()}
            className="rounded bg-blue-600 px-4 py-2 disabled:opacity-50">Probar descarga V3</button>
        </div>
        <p role="status" className="rounded bg-slate-800 p-3 break-words">{message}</p>
        {progress && <p className="text-xs text-slate-300">{progress}</p>}
      </section>
    </main>
  );
};

export default LargeMasterSyncV3CanaryScreen;
