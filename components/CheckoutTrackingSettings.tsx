import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { BusinessConfig } from '../types';
import { getCheckoutTrackingSession, readCheckoutDiagnostics, setCheckoutTrackingEnabled } from '../services/CheckoutDiagnostics';
import { readInstalledPosApkVersion } from '../services/version/posApkUpdateService';
import { ExportUtils } from '../utils/ExportUtils';

export default function CheckoutTrackingSettings({ config, currentDeviceId, onClose }: { config: BusinessConfig; currentDeviceId?: string; onClose: () => void }) {
    const [session, setSession] = useState(getCheckoutTrackingSession);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const enabled = Boolean(session && Date.parse(session.expiresAt) > Date.now());
    const toggle = async () => {
        setBusy(true);
        setMessage('');
        try {
            const version = enabled ? null : await readInstalledPosApkVersion();
            const terminal = config.terminals?.find(candidate => currentDeviceId && candidate.config?.currentDeviceId === currentDeviceId);
            setSession(setCheckoutTrackingEnabled(!enabled, {
                versionName: version?.versionName ?? null, versionCode: version?.versionCode ?? null,
                terminalId: terminal?.id ?? null, deviceId: currentDeviceId ?? null,
            }));
        } catch { setMessage('No se pudo cambiar el seguimiento. Las ventas continúan normalmente.'); }
        finally { setBusy(false); }
    };
    const exportLog = async () => {
        setBusy(true);
        setMessage('');
        try {
            const report = await readCheckoutDiagnostics();
            const fileName = `seguimiento-pos-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            if (Capacitor.isNativePlatform()) {
                await Filesystem.writeFile({ path: `CLIC-POS/${fileName}`, directory: Directory.Documents,
                    encoding: Encoding.UTF8, data: JSON.stringify(report), recursive: true });
                setMessage(`Archivo guardado en Documents/CLIC-POS/${fileName}`);
            } else {
                ExportUtils.downloadFile(JSON.stringify(report, null, 2), fileName, 'application/json');
                setMessage('Archivo de seguimiento exportado.');
            }
        } catch { setMessage('No se pudo exportar el archivo. El seguimiento local se conserva.'); }
        finally { setBusy(false); }
    };
    return <section className="max-w-2xl mx-auto p-6 space-y-5">
        <button onClick={onClose} className="text-blue-700 font-semibold">Volver a Configuración</button>
        <h2 className="text-2xl font-bold">Log de seguimiento</h2>
        <p className="text-gray-600">Registra temporalmente el recorrido de mesas, artículos, cobros e impresión para investigar incidencias.</p>
        <label className="flex items-center justify-between gap-4 rounded-xl border p-4">
            <span className="font-semibold">Activar log de seguimiento</span>
            <input type="checkbox" checked={enabled} disabled={busy} onChange={() => void toggle()} className="h-6 w-6" />
        </label>
        <p className="text-sm text-gray-600">{enabled && session
            ? `Activo hasta ${new Date(session.expiresAt).toLocaleString()}. Sesión: ${session.id}`
            : 'Desactivado. Al activarlo, finalizará automáticamente después de 24 horas.'}</p>
        <p className="text-sm text-gray-600">Los registros se guardan localmente en segundo plano. En esta versión, el envío al ERP está pendiente de integración.</p>
        <button onClick={() => void exportLog()} disabled={busy} className="rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-50">Exportar log de seguimiento</button>
        {message && <p role="status" className="text-sm break-words">{message}</p>}
    </section>;
}
