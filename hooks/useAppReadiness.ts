import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppReadinessCheckResult,
  AppReadinessRequest,
  checkBackendReadiness,
} from '../services/appReadiness';

export type AppReadinessStatus = 'idle' | 'checking' | 'blocked' | 'ready';

export interface UseAppReadinessOptions {
  enabled: boolean;
  request: AppReadinessRequest | null;
  backendRequired?: boolean;
  pollIntervalMs?: number;
  validateLocal: () => Promise<AppReadinessCheckResult>;
  downloadBootstrap?: () => Promise<void>;
  onLocalReady?: (local: AppReadinessCheckResult) => void | Promise<void>;
}

export interface UseAppReadinessResult {
  status: AppReadinessStatus;
  isReady: boolean;
  isBlocking: boolean;
  isChecking: boolean;
  local: AppReadinessCheckResult | null;
  backend: AppReadinessCheckResult | null;
  message: string;
  detail?: string | null;
  retry: () => Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;

const buildMessage = (
  local: AppReadinessCheckResult | null,
  backend: AppReadinessCheckResult | null
) => {
  if (backend && !backend.ok) return backend.message;
  if (local && !local.ok) return local.message;
  return 'Preparando entorno operativo... esto puede tomar unos segundos.';
};

export const useAppReadiness = (options: UseAppReadinessOptions): UseAppReadinessResult => {
  const {
    enabled,
    request,
    backendRequired = true,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    validateLocal,
    downloadBootstrap,
    onLocalReady,
  } = options;

  const [status, setStatus] = useState<AppReadinessStatus>('idle');
  const [local, setLocal] = useState<AppReadinessCheckResult | null>(null);
  const [backend, setBackend] = useState<AppReadinessCheckResult | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runCheck = useCallback(async () => {
    if (!enabled || !request || inFlightRef.current) return;

    inFlightRef.current = true;
    setStatus((current) => current === 'ready' ? 'checking' : current === 'idle' ? 'checking' : current);

    try {
      let localResult = await validateLocal();
      let backendResult: AppReadinessCheckResult | null = backendRequired
        ? await checkBackendReadiness(request)
        : null;

      if (
        downloadBootstrap &&
        ((backendResult?.nextAction === 'download_bootstrap') || localResult.nextAction === 'download_bootstrap')
      ) {
        await downloadBootstrap();
        localResult = await validateLocal();
        backendResult = backendRequired ? await checkBackendReadiness(request) : null;
      }

      if (!mountedRef.current) return;

      setLocal(localResult);
      setBackend(backendResult);
      const ready = localResult.ok && (!backendRequired || backendResult?.ok);
      setStatus(ready ? 'ready' : 'blocked');
      if (ready) {
        void onLocalReady?.(localResult);
      }
    } catch (error: any) {
      if (!mountedRef.current) return;

      setBackend({
        ok: false,
        code: 'BACKEND_UNAVAILABLE',
        nextAction: 'retry',
        message: error?.message || 'No se pudo validar el entorno operativo.',
      });
      setStatus('blocked');
    } finally {
      inFlightRef.current = false;
    }
  }, [backendRequired, downloadBootstrap, enabled, onLocalReady, request, validateLocal]);

  useEffect(() => {
    if (!enabled || !request) {
      setStatus('idle');
      setLocal(null);
      setBackend(null);
      return;
    }

    void runCheck();
    const timer = window.setInterval(() => {
      void runCheck();
    }, pollIntervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, pollIntervalMs, request, runCheck]);

  const retry = useCallback(async () => {
    await runCheck();
  }, [runCheck]);

  const message = useMemo(() => buildMessage(local, backend), [local, backend]);
  const detail = backend?.detail || local?.detail || null;

  return {
    status,
    isReady: status === 'ready',
    isBlocking: enabled && status !== 'idle' && status !== 'ready',
    isChecking: status === 'checking',
    local,
    backend,
    message,
    detail,
    retry,
  };
};
