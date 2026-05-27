import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clipboard, RefreshCw, Server, X } from 'lucide-react';
import type { SyncErrorDiagnostic } from '../services/sync/SyncErrorDiagnostic';
import { requestJson } from '../services/network/httpClient';
import { persistSyncDeviceToken, resolveSyncDeviceToken } from '../services/sync/deviceToken';
import { clearStoredSyncToken, saveTerminalCredentialsSync } from '../services/sync/TerminalCredentialStore';

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
  const [isTestingNative, setIsTestingNative] = useState(false);
  const [isRotatingToken, setIsRotatingToken] = useState(false);
  const [isRepairingToken, setIsRepairingToken] = useState(false);
  const [isReauthorizingTerminal, setIsReauthorizingTerminal] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [nativeTestResult, setNativeTestResult] = useState<unknown>(null);
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

  const pickSyncToken = (payload: any): string | null => {
    const candidates = [
      payload?.token,
      payload?.syncToken,
      payload?.sync_token,
      payload?.syncAuthToken,
      payload?.sync_auth_token,
      payload?.access_token,
      payload?.session?.syncToken,
      payload?.session?.sync_token,
    ];
    const found = candidates.find((value) => typeof value === 'string' && value.trim());
    return found ? found.trim() : null;
  };

  const pickDeviceToken = (payload: any): string | null => {
    const candidates = [
      payload?.deviceToken,
      payload?.device_token,
      payload?.terminalToken,
      payload?.terminal_token,
      payload?.activationToken,
      payload?.activation_token,
      payload?.session?.deviceToken,
      payload?.session?.terminalToken,
      payload?.session?.activationToken,
      payload?.terminal_config?.deviceToken,
      payload?.terminal_config?.auth?.deviceToken,
      payload?.terminal_config?.auth?.terminalToken,
      payload?.terminal_config?.auth?.activationToken,
      payload?.terminal_config?.metadata?.deviceToken,
      payload?.terminal_config?.metadata?.syncAuth?.deviceToken,
      payload?.terminal_config?.metadata?.syncAuth?.terminalToken,
      payload?.terminal_config?.metadata?.syncAuth?.activationToken,
      payload?.auth?.deviceToken,
      payload?.auth?.terminalToken,
      payload?.auth?.activationToken,
      payload?.terminal?.config?.auth?.deviceToken,
      payload?.terminal?.config?.auth?.terminalToken,
      payload?.terminal?.config?.auth?.activationToken,
    ];
    const found = candidates.find((value) => typeof value === 'string' && value.trim());
    return found ? found.trim() : null;
  };

  const handleNativeErpTest = async () => {
    setIsTestingNative(true);
    const deviceToken = resolveSyncDeviceToken().token;
    const deviceId = diagnostic.deviceId || localStorage.getItem('pos_device_id') || localStorage.getItem('CLIC_POS_DEVICE_ID') || '';
    const terminalId = diagnostic.resolvedTarget?.terminalId || diagnostic.terminalId || '';
    const baseUrl = diagnostic.resolvedTarget?.baseUrl || diagnostic.syncProfile?.erpBaseUrl || '';
    const result: Record<string, unknown> = {
      engine: 'pending',
      baseUrl,
      terminalId,
      deviceId,
      tokenPresent: Boolean(deviceToken),
      syncTokenPresent: false,
    };

    try {
      if (!baseUrl || !terminalId || !deviceId || !deviceToken) {
        throw new Error('Faltan baseUrl, terminalId, deviceId o deviceToken para probar conexion ERP nativa.');
      }

      const auth = await requestJson<any>({
        url: `${baseUrl}/auth`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Id': terminalId,
          'X-Device-Id': deviceId,
          'X-Device-Token': deviceToken,
        },
        body: JSON.stringify({ terminalId, deviceId, deviceToken }),
        timeoutMs: 8000,
        diagnosticContext: { operation: 'NATIVE_ERP_TEST_AUTH' },
      });
      result.engine = auth.networkEngine;
      result.authStatus = auth.status;
      result.authBody = auth.text.slice(0, 1000);

      const syncToken = pickSyncToken(auth.data);
      result.syncTokenPresent = Boolean(syncToken);
      if (syncToken) {
        localStorage.setItem('clic_erp_sync_token', syncToken);
        localStorage.setItem('clic_erp_sync_token_updated_at', new Date().toISOString());
        localStorage.removeItem('clic_sync_auth_status');
        saveTerminalCredentialsSync({
          terminalId,
          deviceId,
          syncToken,
          syncTokenUpdatedAt: new Date().toISOString(),
        });
        const metadata = await requestJson<any>({
          url: `${baseUrl}/collections/products/metadata`,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${syncToken}`,
            'X-Sync-Token': syncToken,
            'X-Terminal-Id': terminalId,
            'X-Device-Id': deviceId,
          },
          timeoutMs: 8000,
          diagnosticContext: { operation: 'NATIVE_ERP_TEST_METADATA', collection: 'products' },
        });
        result.metadataStatus = metadata.status;
        result.metadataBody = metadata.text.slice(0, 1000);
      }
    } catch (error: any) {
      result.error = error?.message || String(error || '');
      result.errorDiagnostic = error?.__httpClientDiagnostic || null;
    } finally {
      setNativeTestResult(result);
      setIsTestingNative(false);
    }
  };

  const handleRotateDeviceToken = async () => {
    setIsRotatingToken(true);
    const currentDeviceToken = resolveSyncDeviceToken().token;
    const deviceId = diagnostic.deviceId || localStorage.getItem('pos_device_id') || localStorage.getItem('CLIC_POS_DEVICE_ID') || '';
    const terminalId = diagnostic.resolvedTarget?.terminalId || diagnostic.terminalId || '';
    const baseUrl = diagnostic.resolvedTarget?.baseUrl || diagnostic.syncProfile?.erpBaseUrl || '';
    const result: Record<string, unknown> = {
      action: 'ROTATE_DEVICE_TOKEN',
      baseUrl,
      terminalId,
      deviceId,
      oldTokenPresent: Boolean(currentDeviceToken),
    };

    try {
      if (!baseUrl || !terminalId || !deviceId) {
        throw new Error('Faltan baseUrl, terminalId o deviceId para renovar token de terminal.');
      }

      const rotate = await requestJson<any>({
        url: `${baseUrl}/terminals/${encodeURIComponent(terminalId)}/rotate-device-token`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Id': terminalId,
          'X-Device-Id': deviceId,
          ...(currentDeviceToken ? { 'X-Device-Token': currentDeviceToken } : {}),
        },
        body: JSON.stringify({ terminalId, deviceId, rotateDeviceToken: true }),
        timeoutMs: 8000,
        diagnosticContext: { operation: 'ROTATE_DEVICE_TOKEN' },
      });

      result.engine = rotate.networkEngine;
      result.rotateStatus = rotate.status;
      result.rotateBody = rotate.text.slice(0, 1000);

      const newDeviceToken = pickDeviceToken(rotate.data);
      result.newDeviceTokenPresent = Boolean(newDeviceToken);
      if (!rotate.ok || !newDeviceToken) {
        throw new Error(`No se pudo renovar el token de terminal (${rotate.status}).`);
      }

      persistSyncDeviceToken(newDeviceToken, 'ROTATED');
      localStorage.removeItem('clic_erp_sync_token');
      localStorage.removeItem('clic_erp_sync_token_updated_at');
      localStorage.removeItem('clic_erp_sync_token_expires_at');
      clearStoredSyncToken();
      saveTerminalCredentialsSync({
        terminalId,
        deviceId,
        deviceToken: newDeviceToken,
        deviceTokenSource: 'ROTATED',
        deviceTokenUpdatedAt: new Date().toISOString(),
      });

      const auth = await requestJson<any>({
        url: `${baseUrl}/auth`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Id': terminalId,
          'X-Device-Id': deviceId,
          'X-Device-Token': newDeviceToken,
        },
        body: JSON.stringify({ terminalId, deviceId, deviceToken: newDeviceToken }),
        timeoutMs: 8000,
        diagnosticContext: { operation: 'ROTATE_DEVICE_TOKEN_AUTH' },
      });
      result.authStatus = auth.status;
      result.authBody = auth.text.slice(0, 1000);

      const syncToken = pickSyncToken(auth.data);
      result.syncTokenPresent = Boolean(syncToken);
      if (syncToken) {
        localStorage.setItem('clic_erp_sync_token', syncToken);
        localStorage.setItem('clic_erp_sync_token_updated_at', new Date().toISOString());
        localStorage.removeItem('clic_sync_auth_status');
        saveTerminalCredentialsSync({
          terminalId,
          deviceId,
          syncToken,
          syncTokenUpdatedAt: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      result.error = error?.message || String(error || '');
      result.errorDiagnostic = error?.__httpClientDiagnostic || null;
    } finally {
      setNativeTestResult(result);
      setIsRotatingToken(false);
    }
  };

  const handleRepairTerminalCredentials = async () => {
    setIsRepairingToken(true);
    const currentDeviceToken = resolveSyncDeviceToken().token;
    const deviceId = diagnostic.deviceId || localStorage.getItem('pos_device_id') || localStorage.getItem('CLIC_POS_DEVICE_ID') || '';
    const terminalId = diagnostic.resolvedTarget?.terminalId || diagnostic.terminalId || '';
    const baseUrl = diagnostic.resolvedTarget?.baseUrl || diagnostic.syncProfile?.erpBaseUrl || '';
    const result: Record<string, unknown> = {
      action: 'REPAIR_TERMINAL_CREDENTIALS',
      baseUrl,
      terminalId,
      deviceId,
      oldTokenPresent: Boolean(currentDeviceToken),
    };

    try {
      if (!baseUrl || !terminalId || !deviceId) {
        throw new Error('Faltan baseUrl, terminalId o deviceId para reparar credenciales de terminal.');
      }

      const register = await requestJson<any>({
        url: `${baseUrl}/terminals/register`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Id': terminalId,
          'X-Device-Id': deviceId,
          ...(currentDeviceToken ? { 'X-Device-Token': currentDeviceToken } : {}),
        },
        body: JSON.stringify({
          terminalId,
          terminal_id: terminalId,
          deviceId,
          device_id: deviceId,
          rotateDeviceToken: true,
          forceIssueDeviceToken: true,
          repairCredentials: true,
        }),
        timeoutMs: 8000,
        diagnosticContext: { operation: 'REPAIR_TERMINAL_CREDENTIALS' },
      });

      result.engine = register.networkEngine;
      result.registerStatus = register.status;
      result.registerBody = register.text.slice(0, 1000);

      const repairedDeviceToken = pickDeviceToken(register.data);
      result.deviceTokenPresent = Boolean(repairedDeviceToken);
      if (!register.ok || !repairedDeviceToken) {
        throw new Error(`El ERP no devolvió deviceToken al reparar credenciales (${register.status}).`);
      }

      persistSyncDeviceToken(repairedDeviceToken, 'ERP_REGISTER');
      clearStoredSyncToken();
      saveTerminalCredentialsSync({
        terminalId,
        deviceId,
        deviceToken: repairedDeviceToken,
        deviceTokenSource: 'ERP_REGISTER',
        deviceTokenUpdatedAt: new Date().toISOString(),
      });

      const auth = await requestJson<any>({
        url: `${baseUrl}/auth`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Id': terminalId,
          'X-Device-Id': deviceId,
          'X-Device-Token': repairedDeviceToken,
        },
        body: JSON.stringify({ terminalId, deviceId, deviceToken: repairedDeviceToken }),
        timeoutMs: 8000,
        diagnosticContext: { operation: 'REPAIR_TERMINAL_CREDENTIALS_AUTH' },
      });

      result.authStatus = auth.status;
      result.authBody = auth.text.slice(0, 1000);
      const syncToken = pickSyncToken(auth.data);
      result.syncTokenPresent = Boolean(syncToken);
      if (syncToken) {
        localStorage.setItem('clic_erp_sync_token', syncToken);
        localStorage.setItem('clic_erp_sync_token_updated_at', new Date().toISOString());
        localStorage.removeItem('clic_sync_auth_status');
        saveTerminalCredentialsSync({
          terminalId,
          deviceId,
          syncToken,
          syncTokenUpdatedAt: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      result.error = error?.message || String(error || '');
      result.errorDiagnostic = error?.__httpClientDiagnostic || null;
    } finally {
      setNativeTestResult(result);
      setIsRepairingToken(false);
    }
  };

  const handleReauthorizeTerminal = async () => {
    setIsReauthorizingTerminal(true);
    const currentDeviceToken = resolveSyncDeviceToken().token;
    const deviceId = diagnostic.deviceId || localStorage.getItem('pos_device_id') || localStorage.getItem('CLIC_POS_DEVICE_ID') || '';
    const terminalId = diagnostic.resolvedTarget?.terminalId || diagnostic.terminalId || '';
    const baseUrl = diagnostic.resolvedTarget?.baseUrl || diagnostic.syncProfile?.erpBaseUrl || '';
    const result: Record<string, unknown> = {
      action: 'REAUTHORIZE_TERMINAL',
      baseUrl,
      terminalId,
      deviceId,
      oldTokenPresent: Boolean(currentDeviceToken),
      pairingCodePresent: Boolean(pairingCode.trim()),
    };

    try {
      if (!baseUrl || !terminalId || !deviceId) {
        throw new Error('Faltan baseUrl, terminalId o deviceId para reautorizar esta terminal.');
      }

      const takeover = await requestJson<any>({
        url: `${baseUrl}/terminals/${encodeURIComponent(terminalId)}/takeover`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Id': terminalId,
          'X-Device-Id': deviceId,
          ...(currentDeviceToken ? { 'X-Device-Token': currentDeviceToken } : {}),
        },
        body: JSON.stringify({
          terminalId,
          terminal_id: terminalId,
          deviceId,
          device_id: deviceId,
          takeover: true,
          rotateDeviceToken: true,
          ...(pairingCode.trim() ? { pairingCode: pairingCode.trim(), pairing_code: pairingCode.trim() } : {}),
        }),
        timeoutMs: 10000,
        diagnosticContext: { operation: 'REAUTHORIZE_TERMINAL_TAKEOVER' },
      });

      result.engine = takeover.networkEngine;
      result.takeoverStatus = takeover.status;
      result.takeoverBody = takeover.text.slice(0, 1000);

      let newDeviceToken = pickDeviceToken(takeover.data);
      if (!takeover.ok || !newDeviceToken) {
        const register = await requestJson<any>({
          url: `${baseUrl}/terminals/register`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Terminal-Id': terminalId,
            'X-Device-Id': deviceId,
            ...(currentDeviceToken ? { 'X-Device-Token': currentDeviceToken } : {}),
          },
          body: JSON.stringify({
            terminalId,
            terminal_id: terminalId,
            deviceId,
            device_id: deviceId,
            takeover: true,
            rotateDeviceToken: true,
            forceIssueDeviceToken: true,
            ...(pairingCode.trim() ? { pairingCode: pairingCode.trim(), pairing_code: pairingCode.trim() } : {}),
          }),
          timeoutMs: 10000,
          diagnosticContext: { operation: 'REAUTHORIZE_TERMINAL_REGISTER' },
        });

        result.registerFallbackStatus = register.status;
        result.registerFallbackBody = register.text.slice(0, 1000);
        newDeviceToken = pickDeviceToken(register.data);
        if (!register.ok || !newDeviceToken) {
          throw new Error(`No se pudo reautorizar la terminal (${takeover.status}/${register.status}).`);
        }
      }

      persistSyncDeviceToken(newDeviceToken, 'TAKEOVER');
      clearStoredSyncToken();
      localStorage.removeItem('clic_erp_sync_token');
      localStorage.removeItem('clic_erp_sync_token_updated_at');
      localStorage.removeItem('clic_erp_sync_token_expires_at');
      localStorage.removeItem('clic_sync_auth_status');
      localStorage.setItem('clic_terminal_binding_status', 'BOUND');
      saveTerminalCredentialsSync({
        terminalId,
        deviceId,
        deviceToken: newDeviceToken,
        deviceTokenSource: 'TAKEOVER',
        deviceTokenUpdatedAt: new Date().toISOString(),
      });

      const auth = await requestJson<any>({
        url: `${baseUrl}/auth`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Id': terminalId,
          'X-Device-Id': deviceId,
          'X-Device-Token': newDeviceToken,
        },
        body: JSON.stringify({ terminalId, deviceId, deviceToken: newDeviceToken }),
        timeoutMs: 10000,
        diagnosticContext: { operation: 'REAUTHORIZE_TERMINAL_AUTH' },
      });

      result.authStatus = auth.status;
      result.authBody = auth.text.slice(0, 1000);
      const syncToken = pickSyncToken(auth.data);
      result.syncTokenPresent = Boolean(syncToken);
      if (syncToken) {
        localStorage.setItem('clic_erp_sync_token', syncToken);
        localStorage.setItem('clic_erp_sync_token_updated_at', new Date().toISOString());
        saveTerminalCredentialsSync({
          terminalId,
          deviceId,
          syncToken,
          syncTokenUpdatedAt: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      result.error = error?.message || String(error || '');
      result.errorDiagnostic = error?.__httpClientDiagnostic || null;
    } finally {
      setNativeTestResult(result);
      setIsReauthorizingTerminal(false);
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
            <Field label="networkEngine" value={diagnostic.networkEngine || diagnostic.fetchDiagnostic?.networkEngine} />
            <Field label="authStatus" value={diagnostic.authStatus} />
            <Field label="backendCode" value={diagnostic.backendCode} />
            <Field label="canTakeover" value={diagnostic.authStatus === 'DEVICE_NOT_AUTHORIZED' || diagnostic.backendCode === 'DEVICE_NOT_AUTHORIZED' ? 'true' : 'N/A'} />
            <Field label="nextAction" value={diagnostic.nextAction} />
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
            {nativeTestResult !== null && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 lg:col-span-2">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-500">Prueba ERP nativa</p>
                <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-white p-4 text-xs font-semibold text-blue-950">{JSON.stringify(nativeTestResult, null, 2)}</pre>
              </div>
            )}
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
          <button
            type="button"
            onClick={handleNativeErpTest}
            disabled={isTestingNative}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-500 disabled:opacity-60"
          >
            <Server size={18} />
            {isTestingNative ? 'Probando...' : 'Probar conexión ERP nativa'}
          </button>
          {diagnostic.authStatus === 'DEVICE_TOKEN_INVALID' || diagnostic.backendCode === 'DEVICE_TOKEN_INVALID' ? (
            <button
              type="button"
              onClick={handleRotateDeviceToken}
              disabled={isRotatingToken}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-amber-500 disabled:opacity-60"
            >
              <RefreshCw size={18} className={isRotatingToken ? 'animate-spin' : ''} />
              {isRotatingToken ? 'Renovando...' : 'Renovar token de terminal'}
            </button>
          ) : null}
          {diagnostic.authStatus === 'DEVICE_NOT_AUTHORIZED' || diagnostic.backendCode === 'DEVICE_NOT_AUTHORIZED' ? (
            <div className="flex flex-col gap-2 sm:min-w-[18rem]">
              <input
                value={pairingCode}
                onChange={(event) => setPairingCode(event.target.value)}
                placeholder="Código de vinculación / pairing code"
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleReauthorizeTerminal}
                disabled={isReauthorizingTerminal}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-500 disabled:opacity-60"
              >
                <RefreshCw size={18} className={isReauthorizingTerminal ? 'animate-spin' : ''} />
                {isReauthorizingTerminal ? 'Reautorizando...' : 'Reautorizar esta terminal'}
              </button>
            </div>
          ) : null}
          {diagnostic.authStatus === 'DEVICE_TOKEN_MISSING_LOCAL'
            || diagnostic.authStatus === 'DEVICE_TOKEN_MISSING_FROM_REGISTER'
            || diagnostic.backendCode === 'DEVICE_TOKEN_MISSING_LOCAL'
            || diagnostic.backendCode === 'DEVICE_TOKEN_MISSING_FROM_REGISTER' ? (
            <button
              type="button"
              onClick={handleRepairTerminalCredentials}
              disabled={isRepairingToken}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-500 disabled:opacity-60"
            >
              <RefreshCw size={18} className={isRepairingToken ? 'animate-spin' : ''} />
              {isRepairingToken ? 'Reparando...' : 'Reparar credenciales de terminal'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default SyncErrorDiagnosticModal;
