import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  MapPin,
  Monitor,
  RefreshCw,
  Server,
  WifiOff,
} from 'lucide-react';
import { BusinessConfig, TerminalConfig, User as UserType } from '../types';
import { applyTerminalConfigSnapshot, extractTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';
import { buildMasterUrlCandidates, buildMasterUrlFromHost, normalizeMasterHost } from '../utils/cloudMasterRegistry';
import {
  bindTerminalFromErp,
  fetchInitialConfigFromErp,
  isTerminalOccupiedError,
  listTerminalsFromErp,
} from '../services/setup/erpTerminalSetup';

interface TerminalCard {
  id: string;
  erpTerminalId: string;
  name: string;
  location: string;
  occupied: boolean;
  currentDeviceId?: string;
  config: TerminalConfig;
}

interface TerminalSelectorResponse {
  tenant_id: string;
  erp_base_url?: string | null;
  terminals: TerminalCard[];
}

interface BindTerminalResponse {
  success: boolean;
  tenant_id: string;
  terminal_id: string;
  erp_terminal_id?: string | null;
  terminal_name?: string | null;
  company_id?: string | null;
  store_id?: string | null;
  transferred?: boolean;
  previous_device_id?: string | null;
  config: BusinessConfig;
  users?: UserType[];
}

interface InitialConfigResponse {
  success: boolean;
  tenant_id: string;
  terminal_id: string;
  erp_terminal_id?: string;
  config: BusinessConfig;
  terminal_config?: Record<string, any>;
  snapshot_meta?: {
    used_resolved?: boolean;
    used_fallback_config?: boolean;
    used_cached_snapshot?: boolean;
    resolution_error?: unknown;
    full_pull_on_pairing?: boolean;
  };
}

interface BoundTerminalPayload {
  terminalId: string;
  erpTerminalId?: string;
  terminalName?: string;
  tenantId: string;
  companyId?: string;
  storeId?: string;
  forceTakeover?: boolean;
  previousDeviceId?: string | null;
  config: BusinessConfig;
  users?: UserType[];
  masterIp?: string;
  snapshotMeta?: {
    fullPullOnPairing?: boolean;
    resolutionError?: unknown;
  };
}

interface TerminalSelectorProps {
  currentConfig: BusinessConfig;
  deviceId: string;
  bindingMode: 'MASTER' | 'SLAVE';
  tenantId?: string;
  erpBaseUrl?: string;
  masterIp?: string;
  isAlreadyBound: boolean;
  onBound: (payload: BoundTerminalPayload) => Promise<void>;
  onBack: () => void;
  onMasterIpChange?: (nextIp: string) => void;
}

const normalizeBaseUrl = (value?: string | null): string | null => {
  const raw = (value || '').trim();
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `${window.location.protocol}//${raw}`;

  try {
    const url = new URL(withProtocol);
    return url
      .toString()
      .replace(/\/api\/sync\/?$/i, '')
      .replace(/\/api\/?$/i, '')
      .replace(/\/+$/, '');
  } catch {
    return null;
  }
};

const resolveTenantId = (): string | null => {
  const candidates = [
    localStorage.getItem('active_tenant_id'),
    localStorage.getItem('clic_tenant_id'),
    localStorage.getItem('clic_erp_tenant_id'),
  ];

  return candidates.map((value) => (value || '').trim()).find(Boolean) || null;
};

const resolveTenantSlug = (): string | null => {
  return (localStorage.getItem('clic_tenant_slug') || '').trim() || null;
};

const resolveTenantEmail = (): string | null => {
  return (localStorage.getItem('clic_tenant_email') || '').trim().toLowerCase() || null;
};

const resolveErpBaseUrl = (): string | null => {
  const current = new URL(window.location.origin);
  const localErpOrigin = `${current.protocol}//${current.hostname}:4001`;

  const candidates = [
    localStorage.getItem('CLIC_ERP_BASE_URL'),
    localStorage.getItem('erp_base_url'),
    localStorage.getItem('CLIC_ERP_SYNC_URL'),
    localStorage.getItem('CLIC_ERP_API_URL'),
    (import.meta as any)?.env?.VITE_ERP_BASE_URL,
    (import.meta as any)?.env?.VITE_ERP_SYNC_API_URL,
    (import.meta as any)?.env?.VITE_SYNC_API_URL,
    localErpOrigin,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }

  return null;
};

const getSetupApiBase = (masterIp?: string): string => {
  const normalized = normalizeMasterHost(masterIp || '');
  if (!normalized) {
    return `${buildMasterUrlFromHost(window.location.hostname)}/api/setup`;
  }
  return `${buildMasterUrlFromHost(normalized)}/api/setup`;
};

const resolveReachableMasterBinding = async (masterIp?: string) => {
  const normalizedHost = normalizeMasterHost(masterIp || '');
  if (!normalizedHost) return null;

  let lastError: Error | null = null;
  for (const baseUrl of buildMasterUrlCandidates(normalizedHost)) {
    try {
      const response = await fetch(`${baseUrl}/api/sync/ping`);
      if (!response.ok) {
        throw new Error(`Ping respondió ${response.status}`);
      }

      return {
        host: new URL(baseUrl).hostname,
        baseUrl,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError) {
    console.warn('⚠️ No se pudo resolver un alias alcanzable del Master. Se usará la IP recibida.', lastError);
  }

  return {
    host: normalizedHost,
    baseUrl: buildMasterUrlFromHost(normalizedHost),
  };
};

export const TerminalSelector: React.FC<TerminalSelectorProps> = ({
  currentConfig,
  deviceId,
  bindingMode,
  tenantId: initialTenantId,
  erpBaseUrl: initialErpBaseUrl,
  masterIp = '',
  isAlreadyBound,
  onBound,
  onBack,
  onMasterIpChange,
}) => {
  const [terminals, setTerminals] = useState<TerminalCard[]>([]);
  const [tenantId, setTenantId] = useState(() => initialTenantId || resolveTenantId() || 'default-tenant');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBinding, setIsBinding] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [pendingTerminal, setPendingTerminal] = useState<TerminalCard | null>(null);
  const [masterIpInput, setMasterIpInput] = useState(masterIp);
  const [erpBaseUrl, setErpBaseUrl] = useState<string | null>(() => normalizeBaseUrl(initialErpBaseUrl) || resolveErpBaseUrl());
  const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

  useEffect(() => {
    const resolvedTenantId = (initialTenantId || '').trim();
    if (resolvedTenantId) {
      setTenantId(resolvedTenantId);
    }
  }, [initialTenantId]);

  useEffect(() => {
    const resolvedBaseUrl = normalizeBaseUrl(initialErpBaseUrl);
    if (resolvedBaseUrl) {
      setErpBaseUrl(resolvedBaseUrl);
    }
  }, [initialErpBaseUrl]);

  useEffect(() => {
    setMasterIpInput(masterIp);
  }, [masterIp]);

  const apiBase = useMemo(() => {
    if (isNativeAndroid) {
      return `${buildMasterUrlFromHost(window.location.hostname)}/api/setup`;
    }
    return getSetupApiBase(masterIpInput);
  }, [isNativeAndroid, masterIpInput]);

  const fetchTerminals = useCallback(async () => {
    if (isAlreadyBound) {
      setError('Este equipo ya está vinculado a una terminal. No es necesario volver a configurarlo.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const resolvedTenantId = (initialTenantId || '').trim() || resolveTenantId();
      const resolvedTenantSlug = resolveTenantSlug();
      const resolvedTenantEmail = resolveTenantEmail();

      if (isNativeAndroid && erpBaseUrl) {
        const data = await listTerminalsFromErp({
          currentConfig,
          posDeviceId: deviceId,
          tenantId: resolvedTenantId,
          tenantSlug: resolvedTenantSlug,
          tenantEmail: resolvedTenantEmail,
          erpBaseUrl,
        });

        setTerminals(Array.isArray(data.terminals) ? data.terminals : []);
        setTenantId(data.tenant_id || 'default-tenant');
        const resolvedBase = normalizeBaseUrl(data.erp_base_url || erpBaseUrl) || erpBaseUrl;
        setErpBaseUrl(resolvedBase);

        if (data.tenant_id) {
          localStorage.setItem('active_tenant_id', data.tenant_id);
        }

        if (resolvedBase) {
          localStorage.setItem('CLIC_ERP_BASE_URL', resolvedBase);
          localStorage.setItem('erp_base_url', resolvedBase);
        }
      } else {
        const params = new URLSearchParams({
          pos_device_id: deviceId,
        });

        if (resolvedTenantId) params.set('tenant_id', resolvedTenantId);
        if (resolvedTenantSlug) params.set('tenant_slug', resolvedTenantSlug);
        if (resolvedTenantEmail) params.set('tenant_email', resolvedTenantEmail);
        if (erpBaseUrl) params.set('erp_base_url', erpBaseUrl);

        const response = await fetch(`${apiBase}/terminals?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`No se pudieron cargar las terminales (${response.status}).`);
        }

        const data = (await response.json()) as TerminalSelectorResponse;
        setTerminals(Array.isArray(data.terminals) ? data.terminals : []);
        setTenantId(data.tenant_id || 'default-tenant');
        const resolvedBase = normalizeBaseUrl(data.erp_base_url || erpBaseUrl) || erpBaseUrl;
        setErpBaseUrl(resolvedBase);

        if (data.tenant_id) {
          localStorage.setItem('active_tenant_id', data.tenant_id);
        }

        if (resolvedBase) {
          localStorage.setItem('CLIC_ERP_BASE_URL', resolvedBase);
          localStorage.setItem('erp_base_url', resolvedBase);
        }
      }
    } catch (err) {
      console.error('Failed to fetch terminals for setup:', err);
      setError('No pudimos cargar las terminales. Verifica la conexión o valida la IP del Master local.');
      setTerminals([]);
    } finally {
      setIsLoading(false);
    }
  }, [apiBase, currentConfig, deviceId, erpBaseUrl, initialTenantId, isAlreadyBound, isNativeAndroid]);

  useEffect(() => {
    void fetchTerminals();
  }, [fetchTerminals]);

  const bindTerminal = useCallback(
    async (terminal: TerminalCard, forceTransfer: boolean) => {
      setIsBinding(true);
      setError(null);

    try {
      let data: BindTerminalResponse;

      if (isNativeAndroid && erpBaseUrl) {
        data = await bindTerminalFromErp({
          currentConfig,
          posDeviceId: deviceId,
          terminalId: terminal.id,
          erpTerminalId: terminal.erpTerminalId,
          bindingMode,
          forceTransfer,
          tenantId,
          tenantSlug: resolveTenantSlug(),
          tenantEmail: resolveTenantEmail(),
          erpBaseUrl,
        });
      } else {
        const response = await fetch(`${apiBase}/bind-terminal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenant_id: tenantId,
            tenant_slug: resolveTenantSlug(),
            tenant_email: resolveTenantEmail(),
            erp_base_url: erpBaseUrl,
            terminal_id: terminal.id,
            erp_terminal_id: terminal.erpTerminalId,
            pos_device_id: deviceId,
            binding_mode: bindingMode,
            force_transfer: forceTransfer,
          }),
        });

        if (response.status === 409) {
          setPendingTerminal(terminal);
          setShowTransferModal(true);
          return;
        }

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(detail || `No se pudo vincular la terminal (${response.status}).`);
        }

        data = (await response.json()) as BindTerminalResponse;
      }

        const initialConfigParams = new URLSearchParams({
          tenant_id: data.tenant_id || tenantId,
          pos_device_id: deviceId,
          binding_mode: bindingMode,
          local_terminal_id: data.terminal_id || terminal.id,
        });

        if (erpBaseUrl) {
          initialConfigParams.set('erp_base_url', erpBaseUrl);
        }

        let initialConfigData: InitialConfigResponse = {
          success: true,
          tenant_id: data.tenant_id || tenantId,
          terminal_id: data.terminal_id || terminal.id,
          erp_terminal_id: data.erp_terminal_id || terminal.erpTerminalId || data.terminal_id || terminal.id,
          config: data.config,
        };

        if (isNativeAndroid && erpBaseUrl) {
          const erpInitialConfigData = await fetchInitialConfigFromErp({
            erpBaseUrl,
            tenantId: data.tenant_id || tenantId,
            erpTerminalId: data.erp_terminal_id || terminal.erpTerminalId || data.terminal_id || terminal.id,
            posDeviceId: deviceId,
          });

          const snapshot = extractTerminalConfigSnapshot(erpInitialConfigData);
          if (!snapshot) {
            throw new Error('El ERP no devolvió terminal_config en la configuración inicial.');
          }

          const applied = applyTerminalConfigSnapshot(
            erpInitialConfigData.config || data.config || currentConfig,
            {
              terminalId: data.terminal_id || terminal.id,
              posDeviceId: deviceId,
              bindingMode,
              incomingSnapshot: snapshot,
            }
          );

          initialConfigData = {
            ...erpInitialConfigData,
            tenant_id: erpInitialConfigData.tenant_id || data.tenant_id || tenantId,
            terminal_id: data.terminal_id || terminal.id,
            erp_terminal_id: data.erp_terminal_id || terminal.erpTerminalId || data.terminal_id || terminal.id,
            config: applied.config,
            snapshot_meta: {
              ...(erpInitialConfigData.snapshot_meta || {}),
              used_resolved: applied.usedResolved,
              used_fallback_config: applied.usedFallbackConfig,
              used_cached_snapshot: applied.usedCachedSnapshot,
              resolution_error: snapshot.resolution_error ?? null,
              full_pull_on_pairing: applied.fullPullOnPairing ?? false,
            },
          };
        } else {
          const initialConfigResponse = await fetch(
            `${apiBase}/initial-config/${encodeURIComponent(data.erp_terminal_id || terminal.erpTerminalId || data.terminal_id || terminal.id)}?${initialConfigParams.toString()}`,
            {
              headers: {
                'X-Device-Id': deviceId,
              },
            }
          );

          if (!initialConfigResponse.ok) {
            const detail = await initialConfigResponse.text().catch(() => '');
            throw new Error(detail || `No se pudo cargar la configuración inicial (${initialConfigResponse.status}).`);
          }

          initialConfigData = (await initialConfigResponse.json()) as InitialConfigResponse;
        }

        if (data.tenant_id) {
          localStorage.setItem('active_tenant_id', data.tenant_id);
        }
        if (erpBaseUrl) {
          localStorage.setItem('CLIC_ERP_BASE_URL', erpBaseUrl);
          localStorage.setItem('erp_base_url', erpBaseUrl);
        }
        const resolvedMasterBinding =
          bindingMode === 'SLAVE'
            ? await resolveReachableMasterBinding(masterIpInput)
            : null;

        await onBound({
          terminalId: initialConfigData.terminal_id || data.terminal_id || terminal.id,
          erpTerminalId: data.erp_terminal_id || terminal.erpTerminalId || undefined,
          terminalName: data.terminal_name || terminal.name || data.terminal_id || terminal.id,
          tenantId: initialConfigData.tenant_id || data.tenant_id || tenantId,
          companyId: data.company_id || undefined,
          storeId: data.store_id || undefined,
          forceTakeover: forceTransfer || Boolean(data.transferred),
          previousDeviceId: data.previous_device_id || null,
          config: initialConfigData.config || data.config,
          users: data.users,
          masterIp: resolvedMasterBinding?.host || masterIpInput.trim() || undefined,
          snapshotMeta: {
            fullPullOnPairing: initialConfigData.snapshot_meta?.full_pull_on_pairing,
            resolutionError: initialConfigData.snapshot_meta?.resolution_error,
          },
        });
      } catch (err) {
        if (isTerminalOccupiedError(err)) {
          setPendingTerminal({
            ...terminal,
            currentDeviceId: err.currentDeviceId,
            occupied: true,
          });
          setShowTransferModal(true);
          return;
        }
        console.error('Failed to bind terminal during setup:', err);
        setError(err instanceof Error ? err.message : 'No se pudo completar la vinculación.');
      } finally {
        setIsBinding(false);
        setShowTransferModal(false);
        setPendingTerminal(null);
      }
    },
    [apiBase, bindingMode, currentConfig, deviceId, erpBaseUrl, isNativeAndroid, masterIpInput, onBound, tenantId]
  );

  const handleCardClick = useCallback(
    async (terminal: TerminalCard) => {
      if (isBinding || isAlreadyBound) return;

      if (terminal.occupied && terminal.currentDeviceId && terminal.currentDeviceId !== deviceId) {
        setPendingTerminal(terminal);
        setShowTransferModal(true);
        return;
      }

      await bindTerminal(terminal, false);
    },
    [bindTerminal, deviceId, isAlreadyBound, isBinding]
  );

  const handleRetry = async () => {
    onMasterIpChange?.(masterIpInput.trim());
    await fetchTerminals();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="rounded-[1.75rem] border border-white/60 bg-white/70 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:rounded-[2rem] sm:p-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.35em] text-slate-400">Activar Terminal</p>
            <h3 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">Selecciona la caja para este equipo</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
              El equipo quedará vinculado a una terminal operativa del tenant. Si eliges una ocupada, podrás transferirla.
            </p>
          </div>
          <div className="w-full rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-left shadow-inner sm:w-auto sm:max-w-[18rem] sm:text-right">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-400">Tenant</p>
            <p className="text-sm font-bold text-blue-700 break-all sm:break-words">{tenantId}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-[1.75rem] border border-amber-200 bg-amber-50/90 p-5 shadow-[0_12px_32px_rgba(245,158,11,0.12)]">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-white p-2 text-amber-500 shadow-sm">
              <WifiOff size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-amber-500">Conexión</p>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-amber-900">{error}</p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <div className="flex-1">
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.25em] text-amber-600">
                    IP del Master local
                  </label>
                  <input
                    type="text"
                    value={masterIpInput}
                    onChange={(e) => setMasterIpInput(e.target.value)}
                    placeholder="192.168.1.50"
                    className="w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
                  />
                </div>
                <button
                  onClick={handleRetry}
                  disabled={isLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? <RefreshCw size={16} className="animate-spin" /> : <Server size={16} />}
                  Reintentar Conexión
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAlreadyBound ? (
        <div className="rounded-[2rem] border border-emerald-200 bg-emerald-50/80 p-8 text-center shadow-[0_16px_48px_rgba(16,185,129,0.12)]">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-white text-emerald-600 shadow-md">
            <CheckCircle2 size={30} />
          </div>
          <h4 className="text-xl font-black text-slate-900">Este equipo ya está vinculado</h4>
          <p className="mt-3 text-sm font-medium leading-relaxed text-slate-500">
            La selección de terminal solo debe mostrarse en equipos nuevos o desvinculados.
          </p>
          <button
            onClick={onBack}
            className="mt-6 rounded-2xl border border-emerald-200 bg-white px-6 py-3 text-sm font-black text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50"
          >
            Volver
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {isLoading && terminals.length === 0 ? (
            Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`terminal-skeleton-${index}`}
                className="rounded-[2rem] border border-slate-200/70 bg-white/60 p-6 shadow-[0_18px_46px_rgba(15,23,42,0.08)] backdrop-blur-xl"
              >
                <div className="h-5 w-24 animate-pulse rounded-full bg-slate-200" />
                <div className="mt-5 h-4 w-40 animate-pulse rounded-full bg-slate-100" />
                <div className="mt-3 h-3 w-32 animate-pulse rounded-full bg-slate-100" />
              </div>
            ))
          ) : terminals.length > 0 ? (
            terminals.map((terminal) => {
              const occupiedByOtherDevice = Boolean(
                terminal.occupied && terminal.currentDeviceId && terminal.currentDeviceId !== deviceId
              );

              return (
                <button
                  key={terminal.id}
                  onClick={() => void handleCardClick(terminal)}
                  disabled={isBinding}
                  className={`group relative overflow-hidden rounded-[1.75rem] border p-5 text-left shadow-[0_22px_54px_rgba(15,23,42,0.08)] backdrop-blur-xl transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 sm:rounded-[2rem] sm:p-6 ${
                    occupiedByOtherDevice
                      ? 'border-amber-200 bg-white/70'
                      : 'border-white/70 bg-white/85 hover:border-blue-200'
                  }`}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-white/50 via-transparent to-slate-100/40 opacity-80" />
                  <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.1rem] shadow-inner sm:h-14 sm:w-14 sm:rounded-[1.35rem] ${
                        occupiedByOtherDevice ? 'bg-amber-50 text-amber-500' : 'bg-blue-50 text-blue-600'
                      }`}>
                        <Monitor size={22} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400 break-all sm:tracking-[0.25em]">{terminal.id.toUpperCase()}</p>
                        <h4 className="mt-1 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">{terminal.name}</h4>
                        <div className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-500">
                          <MapPin size={14} />
                          <span className="truncate">{terminal.location}</span>
                        </div>
                      </div>
                    </div>
                    <div className={`self-start rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] sm:self-auto sm:tracking-[0.28em] ${
                      occupiedByOtherDevice
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {occupiedByOtherDevice ? 'Ocupada' : 'Disponible'}
                    </div>
                  </div>

                  <div className="relative mt-6 flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white/80 px-4 py-3 shadow-inner sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-400">Operación</p>
                      <p className="mt-1 text-sm font-semibold text-slate-700">
                        {terminal.config.isPrimaryNode ? 'Servidor principal' : 'Punto de venta'}
                      </p>
                    </div>
                    {occupiedByOtherDevice ? (
                      <div className="flex w-fit items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-amber-700">
                        <Lock size={14} />
                        <span className="text-xs font-black uppercase tracking-[0.18em]">Transferible</span>
                      </div>
                    ) : (
                      <div className="w-fit rounded-full bg-blue-50 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-blue-700">
                        Vincular
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="col-span-full rounded-[2rem] border border-slate-200/70 bg-white/70 p-10 text-center shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-slate-100 text-slate-400">
                <Server size={28} />
              </div>
              <h4 className="text-xl font-black text-slate-900">No hay terminales disponibles</h4>
              <p className="mt-2 text-sm font-medium text-slate-500">
                Reintenta la conexión o valida la configuración del tenant antes de continuar.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between gap-3">
        <button
          onClick={onBack}
          className="rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-black text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
        >
          Volver
        </button>
      </div>

      {showTransferModal && pendingTerminal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-950/50 p-2 sm:items-center sm:p-4 backdrop-blur-sm">
          <div className="my-auto flex w-full max-w-[38rem] flex-col overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/95 shadow-[0_32px_96px_rgba(15,23,42,0.24)] max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] sm:rounded-[2rem]">
            <div className="overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.1rem] bg-amber-50 text-amber-500 shadow-inner sm:h-12 sm:w-12 sm:rounded-[1.25rem]">
                  <AlertTriangle size={22} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.26em] text-amber-500 sm:text-[11px] sm:tracking-[0.3em]">
                    Transferir Terminal
                  </p>
                  <h4 className="mt-2 text-lg font-black leading-tight tracking-tight text-slate-900 sm:text-xl md:text-2xl">
                    ¿Desea mover esta terminal a este equipo?
                  </h4>
                  <p className="mt-2.5 text-sm font-medium leading-relaxed text-slate-500 sm:text-[15px]">
                    Este equipo tomará el control y desvinculará al dispositivo anterior de{' '}
                    <span className="font-black text-slate-800">{pendingTerminal.name}</span>.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3.5 text-sm font-medium leading-relaxed text-amber-900 sm:mt-5 sm:px-5">
                El tenant mantendrá la misma terminal operativa, pero la identidad del equipo quedará reasignada a este dispositivo.
              </div>
            </div>

            <div className="border-t border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={() => {
                    setShowTransferModal(false);
                    setPendingTerminal(null);
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:w-auto"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void bindTerminal(pendingTerminal, true)}
                  disabled={isBinding}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-amber-500/20 transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {isBinding ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  Confirmar Traspaso
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TerminalSelector;
