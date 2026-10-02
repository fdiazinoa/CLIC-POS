import React, { useState } from 'react';
import { getInitialConfig } from '../constants';
import { SubVertical } from '../types';
import { bindTerminalFromErp } from '../services/setup/erpTerminalSetup';
import { readTerminalCredentialsSync } from '../services/sync/TerminalCredentialStore';
import {
  assertLargeMasterSyncV3CanaryEmulator,
  runLargeMasterSyncV3Canary,
  validateLargeMasterSyncV3CanaryUrl,
  type LargeMasterSyncV3CanaryInput,
} from '../services/sync/LargeMasterSyncV3Canary';

const initialIdentity = (): LargeMasterSyncV3CanaryInput => {
  const credentials = readTerminalCredentialsSync();
  return {
    erpBaseUrl: localStorage.getItem('CLIC_ERP_BASE_URL') || '',
    tenantId: credentials.erpTenantId || credentials.tenantId || '',
    erpTerminalId: credentials.erpTerminalId || '',
    posDeviceId: credentials.deviceId || '',
    syncToken: '',
  };
};

export const canaryIdentityKey = (input: LargeMasterSyncV3CanaryInput): string => (
  [validateLargeMasterSyncV3CanaryUrl(input.erpBaseUrl), input.tenantId.trim(),
    input.erpTerminalId.trim(), input.posDeviceId.trim()].join('|')
);

const LargeMasterSyncV3CanaryScreen: React.FC = () => {
  const [identity, setIdentity] = useState(initialIdentity);
  const [registeredIdentity, setRegisteredIdentity] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Canario V3 sin ventas. Ninguna solicitud se envía hasta pulsar un botón.');
  const [progress, setProgress] = useState('');
  const update = (key: keyof LargeMasterSyncV3CanaryInput, value: string) => {
    setIdentity(current => ({ ...current, [key]: value, syncToken: '' }));
    setRegisteredIdentity(null);
  };
  const register = async () => {
    setBusy(true);
    setRegisteredIdentity(null);
    setIdentity(current => ({ ...current, syncToken: '' }));
    setMessage('Registrando explícitamente esta terminal en ERP...');
    try {
      assertLargeMasterSyncV3CanaryEmulator();
      const erpBaseUrl = validateLargeMasterSyncV3CanaryUrl(identity.erpBaseUrl);
      const bound = await bindTerminalFromErp({
        currentConfig: getInitialConfig(SubVertical.SUPERMARKET),
        posDeviceId: identity.posDeviceId.trim(),
        terminalId: identity.erpTerminalId.trim(),
        erpTerminalId: identity.erpTerminalId.trim(),
        bindingMode: 'MASTER',
        tenantId: identity.tenantId.trim(),
        erpBaseUrl,
        persistCredentials: false,
      });
      const token = bound.syncToken || bound.sync_token || '';
      if (!token) throw new Error('El registro ERP no devolvió syncToken. No se inició V3.');
      const registered = { ...identity, erpBaseUrl, erpTerminalId: bound.erp_terminal_id,
        tenantId: bound.tenant_id, syncToken: token };
      setIdentity(registered);
      setRegisteredIdentity(canaryIdentityKey(registered));
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
    setMessage('Negociando descarga V3 con el ERP...');
    try {
      if (!registeredIdentity || registeredIdentity !== canaryIdentityKey(identity)) {
        throw new Error('El syncToken no corresponde a la identidad actual. Registra esta terminal de nuevo.');
      }
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
        <p className="text-sm">SyncToken: {registeredIdentity ? 'registrado en esta sesión (oculto)' : 'requiere registro explícito para este origen e identidad'}</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={() => void register()}
            className="rounded bg-slate-700 px-4 py-2 disabled:opacity-50">Registrar terminal</button>
          <button type="button" disabled={busy || !identity.syncToken || !registeredIdentity} onClick={() => void run()}
            className="rounded bg-blue-600 px-4 py-2 disabled:opacity-50">Probar descarga V3</button>
        </div>
        <p role="status" className="rounded bg-slate-800 p-3 break-words">{message}</p>
        {progress && <p className="text-xs text-slate-300">{progress}</p>}
      </section>
    </main>
  );
};

export default LargeMasterSyncV3CanaryScreen;
