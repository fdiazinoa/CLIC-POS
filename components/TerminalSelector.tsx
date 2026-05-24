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
import { BusinessConfig, Product, TerminalConfig, User as UserType } from '../types';
import { applyTerminalConfigSnapshot, extractTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';
import { buildMasterUrlCandidates, buildMasterUrlFromHost, normalizeMasterHost } from '../utils/cloudMasterRegistry';
import {
  bindTerminalFromErp,
  fetchInitialConfigFromErp,
  isTerminalOccupiedError,
  listTerminalsFromErp,
  type RuntimeTerminalRecoveryState,
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
  source?: string | null;
  terminals: TerminalCard[];
}

interface BindTerminalResponse {
  success: boolean;
  source?: string | null;
  tenant_id: string;
  terminal_id: string;
  erp_terminal_id?: string | null;
  terminal_name?: string | null;
  company_id?: string | null;
  store_id?: string | null;
  transferred?: boolean;
  previous_device_id?: string | null;
  recovery_state?: RuntimeTerminalRecoveryState | null;
  config: BusinessConfig;
  users?: UserType[];
}

interface InitialConfigResponse {
  success: boolean;
  tenant_id?: string;
  terminal_id?: string;
  erp_terminal_id?: string;
  config?: BusinessConfig;
  items?: Product[];
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
  erpBaseUrl?: string;
  terminalName?: string;
  tenantId: string;
  companyId?: string;
  storeId?: string;
  forceTakeover?: boolean;
  previousDeviceId?: string | null;
  recoveryState?: RuntimeTerminalRecoveryState | null;
  config: BusinessConfig;
  users?: UserType[];
  masterIp?: string;
  snapshotItems?: Product[];
  snapshotMeta?: {
    fullPullOnPairing?: boolean;
    resolutionError?: unknown;
  };
  progress?: (update: TerminalBindingProgressUpdate) => void;
}

interface TerminalSelectorProps {
  currentConfig: BusinessConfig;
  deviceId: string;
  bindingMode: 'MASTER' | 'SLAVE';
  integrationMode: 'LOCAL_ONLY' | 'ERP_DIRECT';
  tenantId?: string;
  erpBaseUrl?: string;
  masterIp?: string;
  isAlreadyBound: boolean;
  onBound: (payload: BoundTerminalPayload) => Promise<void>;
  onBack: () => void;
  onMasterIpChange?: (nextIp: string) => void;
}

interface TerminalBindingProgressUpdate {
  stepId?: TerminalBindingProgressStepId;
  message?: string;
}

type TerminalBindingProgressStepId = 'claim' | 'config' | 'apply' | 'sync' | 'cache' | 'finish';

type TerminalBindingProgressStatus = 'pending' | 'active' | 'done' | 'error';

interface TerminalBindingProgressStep {
  id: TerminalBindingProgressStepId;
  label: string;
  detail: string;
  status: TerminalBindingProgressStatus;
}

interface TerminalBindingProgressState {
  isOpen: boolean;
  terminal?: TerminalCard;
  terminalName: string;
  activeStepId: TerminalBindingProgressStepId;
  message: string;
  error: string | null;
  steps: TerminalBindingProgressStep[];
}

const TERMINAL_BINDING_PROGRESS_TEMPLATE: Array<Omit<TerminalBindingProgressStep, 'status'>> = [
  { id: 'claim', label: 'Reasignar terminal', detail: 'Validando dispositivo y tomando control' },
  { id: 'config', label: 'Descargar configuración', detail: 'Leyendo snapshot del ERP o master' },
  { id: 'apply', label: 'Aplicar configuración', detail: 'Guardando identidad y permisos locales' },
  { id: 'sync', label: 'Sincronizar maestros', detail: 'Productos, tarifas, clientes, usuarios y series' },
  { id: 'cache', label: 'Actualizar datos locales', detail: 'Rehidratando SQLite y caches del POS' },
  { id: 'finish', label: 'Finalizar', detail: 'Preparando entrada al POS' },
];

const createProgressSteps = (
  activeStepId: TerminalBindingProgressStepId,
  errorStepId?: TerminalBindingProgressStepId
): TerminalBindingProgressStep[] => {
  const activeIndex = TERMINAL_BINDING_PROGRESS_TEMPLATE.findIndex((step) => step.id === activeStepId);
  const errorIndex = errorStepId
    ? TERMINAL_BINDING_PROGRESS_TEMPLATE.findIndex((step) => step.id === errorStepId)
    : -1;

  return TERMINAL_BINDING_PROGRESS_TEMPLATE.map((step, index) => ({
    ...step,
    status: errorIndex === index
      ? 'error'
      : index < activeIndex
        ? 'done'
        : index === activeIndex
          ? 'active'
          : 'pending',
  }));
};

const createInitialProgressState = (): TerminalBindingProgressState => ({
  isOpen: false,
  terminalName: '',
  activeStepId: 'claim',
  message: '',
  error: null,
  steps: createProgressSteps('claim'),
});

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

const persistErpBaseUrls = (value?: string | null) => {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return;

  localStorage.setItem('CLIC_ERP_BASE_URL', normalized);
  localStorage.setItem('erp_base_url', normalized);
  localStorage.setItem('CLIC_ERP_SYNC_URL', `${normalized}/api/sync`);
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

const resolveTenantDisplayName = (tenantId?: string | null): string => {
  const slug = resolveTenantSlug();
  if (slug) return slug;

  const email = resolveTenantEmail();
  if (email) return email;

  return (tenantId || '').trim() || 'Tenant no identificado';
};

const shortTerminalRef = (terminal: TerminalCard): string => {
  const candidates = [
    terminal.erpTerminalId,
    terminal.id,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  const source = candidates[0] || 'terminal';
  return source.length > 10 ? source.slice(0, 8).toUpperCase() : source.toUpperCase();
};

const DEFAULT_PUBLIC_ERP_BASE_URL = 'https://clic-erp.vercel.app';

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
    DEFAULT_PUBLIC_ERP_BASE_URL,
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

const buildAndroidEmbeddedSetupBase = (): string =>
  `${buildMasterUrlFromHost(window.location.hostname)}/api/setup`;

const describeTerminalListFailure = (
  err: unknown,
  ctx: { bindingMode: 'MASTER' | 'SLAVE'; erpDirectAndroid: boolean }
): string => {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  const isNetwork =
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    (err instanceof Error && err.name === 'TypeError');

  if (ctx.erpDirectAndroid && ctx.bindingMode === 'MASTER') {
    if (raw.includes('ERP') || lower.includes('/api/sync')) {
      return `Error al cargar terminales desde el ERP. ${raw}`;
    }
    if (isNetwork) {
      return 'No hubo respuesta del proxy local (/api/setup) ni del ERP. Revisa la URL del ERP y la conectividad.';
    }
    return `No se pudieron cargar las terminales. ${raw}`;
  }

  if (ctx.bindingMode === 'SLAVE') {
    if (isNetwork) {
      return 'No se pudo alcanzar la caja maestra en la IP indicada (red, firewall o puerto).';
    }
    return `No se pudieron listar terminales en la maestra local. ${raw}`;
  }

  if (isNetwork) {
    return 'Error de red al consultar terminales. Revisa la conexión.';
  }

  return raw || 'No pudimos cargar las terminales.';
};

export const TerminalSelector: React.FC<TerminalSelectorProps> = ({
  currentConfig,
  deviceId,
  bindingMode,
  integrationMode,
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
  const [bindingProgress, setBindingProgress] = useState<TerminalBindingProgressState>(() => createInitialProgressState());
  const [masterIpInput, setMasterIpInput] = useState(masterIp);
  const [erpBaseUrl, setErpBaseUrl] = useState<string | null>(() => normalizeBaseUrl(initialErpBaseUrl) || resolveErpBaseUrl());
  const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  const expectsErpDirect = bindingMode === 'MASTER' && integrationMode === 'ERP_DIRECT';
  const useErpDirectMasterAndroid = Boolean(isNativeAndroid && erpBaseUrl && bindingMode === 'MASTER' && expectsErpDirect);
  const usesErpDirect = expectsErpDirect && Boolean(erpBaseUrl) && !isNativeAndroid;
  const isSetupPending = localStorage.getItem('clic_pos_terminal_setup_pending') === '1';
  const shouldBlockAlreadyBound = isAlreadyBound && !isSetupPending;
  const terminalNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    terminals.forEach((terminal) => {
      const key = String(terminal.name || terminal.id || '').trim().toLowerCase();
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [terminals]);

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
    const normalizedMasterHost = normalizeMasterHost(masterIpInput);

    if (bindingMode === 'SLAVE' && normalizedMasterHost) {
      return getSetupApiBase(normalizedMasterHost);
    }

    if (isNativeAndroid) {
      return buildAndroidEmbeddedSetupBase();
    }
    return getSetupApiBase(masterIpInput);
  }, [bindingMode, isNativeAndroid, masterIpInput]);

  const startBindingProgress = useCallback((terminal: TerminalCard, message: string) => {
    setBindingProgress({
      isOpen: true,
      terminal,
      terminalName: terminal.name,
      activeStepId: 'claim',
      message,
      error: null,
      steps: createProgressSteps('claim'),
    });
  }, []);

  const updateBindingProgress = useCallback((update: TerminalBindingProgressUpdate) => {
    setBindingProgress((current) => {
      if (!current.isOpen) return current;
      const nextStepId = update.stepId || current.activeStepId;
      return {
        ...current,
        activeStepId: nextStepId,
        message: update.message || current.message,
        error: null,
        steps: createProgressSteps(nextStepId),
      };
    });
  }, []);

  const failBindingProgress = useCallback((message: string) => {
    setBindingProgress((current) => {
      if (!current.isOpen) return current;
      return {
        ...current,
        message: 'No se pudo completar el traspaso.',
        error: message,
        steps: createProgressSteps(current.activeStepId, current.activeStepId),
      };
    });
  }, []);

  const closeBindingProgress = useCallback(() => {
    setBindingProgress(createInitialProgressState());
  }, []);

  const fetchTerminals = useCallback(async () => {
    if (shouldBlockAlreadyBound) {
      setError('Este equipo ya está vinculado a una terminal. No es necesario volver a configurarlo.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const persistListMeta = (data: TerminalSelectorResponse) => {
      setTerminals(Array.isArray(data.terminals) ? data.terminals : []);
      setTenantId(data.tenant_id || 'default-tenant');
      const resolvedBase = normalizeBaseUrl(data.erp_base_url || erpBaseUrl) || erpBaseUrl;
      setErpBaseUrl(resolvedBase);

      if (data.tenant_id) {
        localStorage.setItem('active_tenant_id', data.tenant_id);
      }

      if (resolvedBase) {
        persistErpBaseUrls(resolvedBase);
      }
    };

    try {
      const resolvedTenantId = (initialTenantId || '').trim() || resolveTenantId();
      const resolvedTenantSlug = resolveTenantSlug();
      const resolvedTenantEmail = resolveTenantEmail();

      if (expectsErpDirect && !erpBaseUrl) {
        throw new Error('No encontramos la URL base del ERP para esta instalación.');
      }

      const params = new URLSearchParams({
        pos_device_id: deviceId,
      });

      if (resolvedTenantId) params.set('tenant_id', resolvedTenantId);
      if (resolvedTenantSlug) params.set('tenant_slug', resolvedTenantSlug);
      if (resolvedTenantEmail) params.set('tenant_email', resolvedTenantEmail);
      if (erpBaseUrl) params.set('erp_base_url', erpBaseUrl);

      if (useErpDirectMasterAndroid) {
        const proxyBase = buildAndroidEmbeddedSetupBase();
        try {
          const response = await fetch(`${proxyBase}/terminals?${params.toString()}`);
          if (response.ok) {
            const proxyData = (await response.json()) as TerminalSelectorResponse;
            const list = Array.isArray(proxyData.terminals) ? proxyData.terminals : [];
            if (list.length > 0) {
              persistListMeta(proxyData);
              return;
            }
          }
        } catch (proxyErr) {
          console.warn('setup proxy /terminals failed, falling back to ERP direct', proxyErr);
        }

        const erpData = await listTerminalsFromErp({
          currentConfig,
          posDeviceId: deviceId,
          tenantId: resolvedTenantId,
          tenantSlug: resolvedTenantSlug,
          tenantEmail: resolvedTenantEmail,
          erpBaseUrl: erpBaseUrl!,
        });

        persistListMeta({
          tenant_id: erpData.tenant_id,
          erp_base_url: erpData.erp_base_url || erpBaseUrl!,
          terminals: erpData.terminals as TerminalCard[],
          source: 'ERP',
        });
      } else if (usesErpDirect) {
        const data = await listTerminalsFromErp({
          currentConfig,
          posDeviceId: deviceId,
          tenantId: resolvedTenantId,
          tenantSlug: resolvedTenantSlug,
          tenantEmail: resolvedTenantEmail,
          erpBaseUrl,
        });
        persistListMeta(data);
      } else {
        const response = await fetch(`${apiBase}/terminals?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`No se pudieron cargar las terminales (${response.status}).`);
        }

        const data = (await response.json()) as TerminalSelectorResponse;
        persistListMeta(data);
      }
    } catch (err) {
      console.error('Failed to fetch terminals for setup:', err);
      setError(
        describeTerminalListFailure(err, {
          bindingMode,
          erpDirectAndroid: useErpDirectMasterAndroid,
        })
      );
      setTerminals([]);
    } finally {
      setIsLoading(false);
    }
  }, [apiBase, bindingMode, currentConfig, deviceId, erpBaseUrl, expectsErpDirect, initialTenantId, shouldBlockAlreadyBound, useErpDirectMasterAndroid, usesErpDirect]);

  useEffect(() => {
    void fetchTerminals();
  }, [fetchTerminals]);

  const bindTerminal = useCallback(
    async (terminal: TerminalCard, forceTransfer: boolean) => {
      let completed = false;
      const showProgress = forceTransfer;
      setIsBinding(true);
      setError(null);
      if (forceTransfer) {
        setShowTransferModal(false);
        setPendingTerminal(null);
        startBindingProgress(terminal, `Reasignando ${terminal.name} a este equipo...`);
      }

    try {
      let data: BindTerminalResponse | null = null;
      let dataFromCloudDirect = false;
      const shouldValidateTakeoverInCloud = Boolean(
        forceTransfer &&
        erpBaseUrl &&
        bindingMode === 'MASTER' &&
        !useErpDirectMasterAndroid
      );

      if (expectsErpDirect && !erpBaseUrl) {
        throw new Error('No encontramos la URL base del ERP para completar la vinculación.');
      }

      if (showProgress) {
        updateBindingProgress({
          stepId: 'claim',
          message: 'Validando la terminal ocupada y solicitando el traspaso...',
        });
      }

      if (shouldValidateTakeoverInCloud) {
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
          erpBaseUrl: erpBaseUrl!,
        });
        dataFromCloudDirect = true;
      } else if (useErpDirectMasterAndroid) {
        let proxyError: unknown = null;
        try {
          const response = await fetch(`${buildAndroidEmbeddedSetupBase()}/bind-terminal`, {
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

          if (response.ok) {
            data = (await response.json()) as BindTerminalResponse;
          } else {
            const detail = await response.text().catch(() => '');
            proxyError = new Error(`Proxy setup respondió ${response.status}${detail ? `: ${detail}` : ''}`);
          }
        } catch (proxyBindErr) {
          console.warn('proxy bind-terminal failed, falling back to ERP direct', proxyBindErr);
          proxyError = proxyBindErr;
        }

        if (!data) {
          if (forceTransfer && proxyError) {
            throw proxyError instanceof Error
              ? proxyError
              : new Error('No se pudo contactar el proxy local para completar el traspaso.');
          }

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
            erpBaseUrl: erpBaseUrl!,
          });
        }
      } else if (usesErpDirect) {
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
          erpBaseUrl: erpBaseUrl!,
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

        if (!data) {
          throw new Error('No se pudo vincular la terminal.');
        }

        if (showProgress) {
          updateBindingProgress({
            stepId: 'config',
            message: 'Terminal reasignada. Descargando configuración inicial y maestros...',
          });
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

        if (useErpDirectMasterAndroid) {
          const erpTerminalIdForConfig =
            data.erp_terminal_id || terminal.erpTerminalId || data.terminal_id || terminal.id;
          let erpInitialConfigData: InitialConfigResponse | null = null;

          try {
            const proxyBase = buildAndroidEmbeddedSetupBase();
            const response = await fetch(
              `${proxyBase}/initial-config/${encodeURIComponent(String(erpTerminalIdForConfig))}?${initialConfigParams.toString()}`,
              {
                headers: {
                  'X-Device-Id': deviceId,
                },
              }
            );
            if (response.ok) {
              const parsed = (await response.json()) as InitialConfigResponse;
              if (extractTerminalConfigSnapshot(parsed)) {
                erpInitialConfigData = parsed;
              }
            }
          } catch (proxyInitialConfigErr) {
            console.warn('proxy initial-config failed, falling back to ERP direct', proxyInitialConfigErr);
          }

          if (!erpInitialConfigData) {
            erpInitialConfigData = await fetchInitialConfigFromErp({
              erpBaseUrl: erpBaseUrl!,
              tenantId: data.tenant_id || tenantId,
              erpTerminalId: erpTerminalIdForConfig,
              posDeviceId: deviceId,
            });
          }

          const snapshot = extractTerminalConfigSnapshot(erpInitialConfigData);
          if (!snapshot) {
            throw new Error('El ERP no devolvió terminal_config en la configuración inicial.');
          }

          if (showProgress) {
            updateBindingProgress({
              stepId: 'apply',
              message: 'Aplicando configuración resuelta para esta terminal...',
            });
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
        } else if (usesErpDirect || dataFromCloudDirect) {
          const erpInitialConfigData = await fetchInitialConfigFromErp({
            erpBaseUrl: erpBaseUrl!,
            tenantId: data.tenant_id || tenantId,
            erpTerminalId: data.erp_terminal_id || terminal.erpTerminalId || data.terminal_id || terminal.id,
            posDeviceId: deviceId,
          });

          const snapshot = extractTerminalConfigSnapshot(erpInitialConfigData);
          if (!snapshot) {
            throw new Error('El ERP no devolvió terminal_config en la configuración inicial.');
          }

          if (showProgress) {
            updateBindingProgress({
              stepId: 'apply',
              message: 'Aplicando configuración resuelta para esta terminal...',
            });
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
          persistErpBaseUrls(erpBaseUrl);
        }
        const resolvedMasterHost =
          bindingMode === 'SLAVE'
            ? normalizeMasterHost(masterIpInput) || masterIpInput.trim() || undefined
            : undefined;

        if (showProgress) {
          updateBindingProgress({
            stepId: 'sync',
            message: 'Sincronizando maestros y preparando datos locales del POS...',
          });
        }

        await onBound({
          terminalId: initialConfigData.terminal_id || data.terminal_id || terminal.id,
          erpTerminalId: data.erp_terminal_id || terminal.erpTerminalId || undefined,
          erpBaseUrl: erpBaseUrl || undefined,
          terminalName: data.terminal_name || terminal.name || data.terminal_id || terminal.id,
          tenantId: initialConfigData.tenant_id || data.tenant_id || tenantId,
          companyId: data.company_id || undefined,
          storeId: data.store_id || undefined,
          forceTakeover: forceTransfer || Boolean(data.transferred),
          previousDeviceId: data.previous_device_id || null,
          recoveryState: data.recovery_state || null,
          config: initialConfigData.config || data.config,
          users: data.users,
          masterIp: resolvedMasterHost,
          snapshotItems: Array.isArray(initialConfigData.items)
            ? initialConfigData.items
            : (Array.isArray(initialConfigData.terminal_config?.masters?.items) ? initialConfigData.terminal_config?.masters?.items : []),
          snapshotMeta: {
            fullPullOnPairing: initialConfigData.snapshot_meta?.full_pull_on_pairing,
            resolutionError: initialConfigData.snapshot_meta?.resolution_error,
          },
          progress: showProgress ? updateBindingProgress : undefined,
        });
        completed = true;
        if (showProgress) {
          updateBindingProgress({
            stepId: 'finish',
            message: 'Terminal transferida correctamente. Abriendo el POS...',
          });
        }
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
        const message = err instanceof Error ? err.message : 'No se pudo completar la vinculación.';
        setError(message);
        if (showProgress) {
          setPendingTerminal(terminal);
          failBindingProgress(message);
        }
      } finally {
        setIsBinding(false);
        if (!showProgress || completed) {
          setShowTransferModal(false);
          setPendingTerminal(null);
        }
      }
    },
    [apiBase, bindingMode, currentConfig, deviceId, erpBaseUrl, expectsErpDirect, failBindingProgress, masterIpInput, onBound, startBindingProgress, tenantId, updateBindingProgress, useErpDirectMasterAndroid, usesErpDirect]
  );

  const handleCardClick = useCallback(
    async (terminal: TerminalCard) => {
      if (isBinding || shouldBlockAlreadyBound) return;

      if (terminal.occupied && terminal.currentDeviceId && terminal.currentDeviceId !== deviceId) {
        setPendingTerminal(terminal);
        setShowTransferModal(true);
        return;
      }

      await bindTerminal(terminal, false);
    },
    [bindTerminal, deviceId, isBinding, shouldBlockAlreadyBound]
  );

  const handleRetry = async () => {
    if (bindingMode === 'SLAVE') {
      onMasterIpChange?.(masterIpInput.trim());
    }
    await fetchTerminals();
  };

  const tenantDisplayName = useMemo(() => resolveTenantDisplayName(tenantId), [tenantId]);

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
            <p className="text-sm font-bold text-blue-700 break-all sm:break-words">{tenantDisplayName}</p>
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
                {bindingMode === 'SLAVE' && (
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
                )}
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

      {shouldBlockAlreadyBound ? (
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
            terminals.map((terminal, index) => {
              const occupiedByOtherDevice = Boolean(
                terminal.occupied && terminal.currentDeviceId && terminal.currentDeviceId !== deviceId
              );
              const terminalNameKey = String(terminal.name || terminal.id || '').trim().toLowerCase();
              const hasDuplicateName = Boolean(terminalNameKey && (terminalNameCounts.get(terminalNameKey) || 0) > 1);
              const terminalRef = shortTerminalRef(terminal);

              return (
                <button
                  key={`${terminal.erpTerminalId || terminal.id}-${index}`}
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
                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400 break-all sm:tracking-[0.25em]">
                          {terminal.id.toUpperCase()}
                          {hasDuplicateName && <span className="ml-2 text-amber-600">#{terminalRef}</span>}
                        </p>
                        <h4 className="mt-1 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
                          {terminal.name}
                        </h4>
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
                {expectsErpDirect
                  ? 'No encontramos terminales operativas en el ERP para este tenant.'
                  : bindingMode === 'SLAVE'
                    ? 'La caja maestra no devolvió terminales disponibles para vincular.'
                    : 'No encontramos terminales locales disponibles para esta instalación.'}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-3 sm:p-4 backdrop-blur-sm">
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

      {bindingProgress.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/55 p-3 sm:p-4 backdrop-blur-sm">
          <div className="my-auto w-full max-w-[34rem] overflow-hidden rounded-[1.5rem] border border-white/70 bg-white shadow-[0_32px_96px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
            <div className="px-5 py-5 sm:px-7 sm:py-7">
              <div className="flex items-start gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.25rem] shadow-inner ${
                  bindingProgress.error ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                }`}>
                  {bindingProgress.error ? (
                    <AlertTriangle size={24} />
                  ) : (
                    <RefreshCw size={24} className="animate-spin" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-[11px] font-black uppercase tracking-[0.3em] ${
                    bindingProgress.error ? 'text-red-500' : 'text-blue-500'
                  }`}>
                    {bindingProgress.error ? 'Traspaso detenido' : 'Transferencia en progreso'}
                  </p>
                  <h4 className="mt-2 text-xl font-black tracking-tight text-slate-900">
                    {bindingProgress.terminalName || 'Terminal'}
                  </h4>
                  <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-500">
                    {bindingProgress.message || 'Preparando el equipo...'}
                  </p>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    bindingProgress.error ? 'bg-red-500' : 'bg-blue-600'
                  }`}
                  style={{
                    width: `${Math.max(
                      12,
                      ((TERMINAL_BINDING_PROGRESS_TEMPLATE.findIndex((step) => step.id === bindingProgress.activeStepId) + 1)
                        / TERMINAL_BINDING_PROGRESS_TEMPLATE.length) * 100
                    )}%`,
                  }}
                />
              </div>

              <div className="mt-6 space-y-3">
                {bindingProgress.steps.map((step) => (
                  <div
                    key={step.id}
                    className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${
                      step.status === 'error'
                        ? 'border-red-100 bg-red-50'
                        : step.status === 'active'
                          ? 'border-blue-100 bg-blue-50'
                          : step.status === 'done'
                            ? 'border-emerald-100 bg-emerald-50'
                            : 'border-slate-100 bg-slate-50'
                    }`}
                  >
                    <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      step.status === 'error'
                        ? 'bg-red-100 text-red-600'
                        : step.status === 'active'
                          ? 'bg-blue-100 text-blue-600'
                          : step.status === 'done'
                            ? 'bg-emerald-100 text-emerald-600'
                            : 'bg-white text-slate-300'
                    }`}>
                      {step.status === 'done' ? (
                        <CheckCircle2 size={15} />
                      ) : step.status === 'active' ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : step.status === 'error' ? (
                        <AlertTriangle size={14} />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-current" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-black ${
                        step.status === 'error'
                          ? 'text-red-700'
                          : step.status === 'active'
                            ? 'text-blue-800'
                            : step.status === 'done'
                              ? 'text-emerald-800'
                              : 'text-slate-500'
                      }`}>
                        {step.label}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold leading-relaxed text-slate-500">{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              {bindingProgress.error && (
                <div className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold leading-relaxed text-red-700">
                  {bindingProgress.error}
                </div>
              )}
            </div>

            {bindingProgress.error && (
              <div className="border-t border-slate-100 px-5 py-4 sm:px-7">
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeBindingProgress}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:w-auto"
                  >
                    Cerrar
                  </button>
                  {bindingProgress.terminal && (
                    <button
                      type="button"
                      onClick={() => void bindTerminal(bindingProgress.terminal!, true)}
                      disabled={isBinding}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      {isBinding ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      Reintentar
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TerminalSelector;
