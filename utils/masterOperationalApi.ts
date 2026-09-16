import { Capacitor } from '@capacitor/core';

const TERMINAL_SETUP_MODE_KEY = 'clic_pos_terminal_setup_mode';
const MASTER_URL_KEY = 'CLIC_POS_MASTER_URL';
const MASTER_IP_KEY = 'pos_master_ip';
const NATIVE_MASTER_OPERATIONAL_BASE_URL = 'http://127.0.0.1:3001';

type StorageReader = Pick<Storage, 'getItem'>;
let operationalTerminalReader: (() => Record<string, any> | null) | null = null;
export const setOperationalTerminalReader = (reader: typeof operationalTerminalReader) => { operationalTerminalReader = reader; };

const getStorage = (): StorageReader | null => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

const isNativeAndroidRuntime = (): boolean => {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
};

const normalizeBaseUrl = (value: string | null): string => {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';

  try {
    const parsed = new URL(/^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`);
    const host = parsed.hostname;
    const isPrivateLanHost =
      host === 'localhost'
      || host === '127.0.0.1'
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    const protocol = isPrivateLanHost ? 'http:' : parsed.protocol;
    const port = parsed.port || '3001';
    return `${protocol}//${host}:${port}${parsed.pathname.replace(/\/api$/i, '').replace(/\/+$/, '')}`;
  } catch {
    const hostWithPort = normalized.includes(':') ? normalized : `${normalized}:3001`;
    return `http://${hostWithPort}`.replace(/\/api$/i, '');
  }
};

export const isClientTerminalMode = (storage: StorageReader | null = getStorage()): boolean => {
  if (!storage) return false;

  const setupMode = storage.getItem(TERMINAL_SETUP_MODE_KEY);
  if (setupMode === 'CLIENT' || setupMode === 'ORDER_TAKER') return true;
  if (storage === getStorage() && operationalTerminalReader) {
    const terminal = operationalTerminalReader();
    if (resolveTerminalRuntimeRole(terminal) === DeviceRole.ORDER_TAKER) return true;
    if (!setupMode && (terminal?.config?.syncConfig?.mode === 'SLAVE' || terminal?.config?.governedByMaster === true)) return true;
  }
  if (setupMode === 'SERVER_LOCAL' || setupMode === 'SERVER_ERP' || setupMode === 'SERVER') {
    return false;
  }
  if (storage.getItem('clic_sync_mode') === 'POS_SLAVE') return true;

  return Boolean(String(storage.getItem(MASTER_IP_KEY) || '').trim());
};

export const canUseLocalOperationalTableStore = (
  storage: StorageReader | null = getStorage()
): boolean => !isClientTerminalMode(storage);

export const resolveMasterOperationalBaseUrl = (
  storage: StorageReader | null = getStorage()
): string => {
  if (!isClientTerminalMode(storage) || !storage) return '';

  const storedMasterUrl = normalizeBaseUrl(storage.getItem(MASTER_URL_KEY));
  if (storedMasterUrl) return storedMasterUrl;

  return normalizeBaseUrl(storage.getItem(MASTER_IP_KEY));
};

export const resolveOperationalApiUrl = (
  path: string,
  storage: StorageReader | null = getStorage(),
  nativeAndroid: boolean = isNativeAndroidRuntime()
): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (isClientTerminalMode(storage)) {
    const validated = operationalMasterResolver?.current();
    if (!validated) throw new Error('MASTER_ENDPOINT_NOT_VALIDATED: valide la Caja Master vinculada antes de operar.');
    return `${validated}${normalizedPath}`;
  }

  // Capacitor serves the UI from https://localhost. A relative /api request is
  // therefore answered by the WebView asset server with index.html instead of
  // reaching the embedded restaurant server. Native Master terminals must use
  // the loopback listener explicitly so both Master and Client share one state.
  if (nativeAndroid) return `${NATIVE_MASTER_OPERATIONAL_BASE_URL}${normalizedPath}`;

  return normalizedPath;
};

import { isEligibleOperationalMasterConfig, resolveServingTerminalFromConfig, resolveTerminalRuntimeRole } from './masterServerEligibility';
import { DeviceRole } from '../types';

export interface OperationalMasterContract {
  erpManaged: boolean;
  terminalId: string;
  masterTerminalId: string;
  tenantId: string;
  companyId: string;
  storeId: string;
  deviceId: string;
  localIps: string[];
  terminalType?: string;
}

export const buildOperationalMasterContract = (input: {
  terminal: Record<string, any>; businessConfig: Record<string, any>; binding: Record<string, any>;
  profile: Record<string, any>; storedMasterId?: string; deviceId: string; localIps: string[];
}): OperationalMasterContract => {
  const terminal = input.terminal || {};
  const cfg = terminal.config || {};
  const binding = cfg.erpBinding || {};
  const context = input.businessConfig.masterSetupContext || {};
  const localOnly = context.erpEnabled === false;
  return {
    erpManaged: !localOnly && Boolean(context.erpEnabled === true || binding.terminalId || cfg.erpTerminalId || input.binding.terminalUuid || input.binding.terminalId),
    terminalId: binding.terminalId || cfg.erpTerminalId || terminal.erpTerminalId || input.binding.terminalUuid || input.binding.terminalId || terminal.id || '',
    masterTerminalId: cfg.masterTerminalId || cfg.master_terminal_id || terminal.masterTerminalId || terminal.master_terminal_id || input.storedMasterId || input.profile.masterTerminalId || '',
    tenantId: binding.tenantId || terminal.tenantId || input.binding.tenantId || context.tenantId || '',
    companyId: binding.companyId || terminal.companyId || input.binding.companyId || context.companyId || '',
    storeId: binding.storeId || terminal.storeId || input.binding.storeId || context.storeId || '',
    deviceId: input.deviceId,
    localIps: input.localIps,
    terminalType: resolveTerminalRuntimeRole(terminal) || cfg.syncConfig?.mode || '',
  };
};

const id = (value: unknown) => String(value || '').trim().toLowerCase();
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const scopeValue = (source: Record<string, any>, field: 'tenant' | 'company' | 'store') =>
  id(source[`${field}Id`] || source[`${field}_id`] || source[`local${field[0].toUpperCase()}${field.slice(1)}Id`]);

export const assertOperationalMasterContractReady = (contract: OperationalMasterContract): void => {
  if (contract.erpManaged && ![contract.terminalId, contract.masterTerminalId, contract.tenantId, contract.companyId, contract.storeId].every(uuid)) {
    throw new Error('MASTER_CONTRACT_MISSING: falta UUID o empresa/sucursal del vínculo ERP vigente.');
  }
};

export const validateOperationalMasterEndpoint = (
  base: string, remote: Record<string, any>, contract: OperationalMasterContract,
): string => {
  const normalized = normalizeBaseUrl(base);
  const host = new URL(normalized).hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host)
    || host === '0.0.0.0' || contract.localIps.map(id).includes(host)) {
    throw new Error('MASTER_SELF_ENDPOINT: la cliente no puede operar contra su propia dirección.');
  }
  const serving = resolveServingTerminalFromConfig(remote);
  const config = serving?.config || {};
  const binding = config.erpBinding || {};
  const servingId = id(binding.terminalId || binding.terminal_id || config.erpTerminalId || serving?.erpTerminalId || serving?.id);
  const declaredId = id(remote.runtimeTerminalId || remote.runtime_terminal_id || remote.runtime?.terminalId || remote.runtime?.terminal_id);
  const servingDevice = id(serving?.boundDeviceId || serving?.device_id || config.currentDeviceId || config.deviceId || binding.deviceId || config.deviceBindingToken);
  if ((declaredId && declaredId === id(contract.terminalId)) || (servingId && servingId === id(contract.terminalId))
    || (servingDevice && servingDevice === id(contract.deviceId))) {
    throw new Error('MASTER_SELF_IDENTITY: el servidor pertenece a esta cliente.');
  }
  const advertisedRoles = [remote, remote.runtime, remote.masterSetupContext].filter(Boolean).map(resolveTerminalRuntimeRole);
  if (!isEligibleOperationalMasterConfig(remote) || advertisedRoles.some(role => role && role !== DeviceRole.STANDARD_POS)) throw new Error('MASTER_ROLE_INVALID: el servidor no es una Caja Master operativa.');
  if (contract.erpManaged) {
    assertOperationalMasterContractReady(contract);
    if (!serving || servingId !== id(contract.masterTerminalId) || (declaredId && declaredId !== id(contract.masterTerminalId))) throw new Error('MASTER_IDENTITY_MISMATCH: UUID de master distinto del vínculo vigente.');
    const context = remote.masterSetupContext || {};
    for (const field of ['tenant', 'company', 'store'] as const) {
      const values = [binding, serving, context, remote, remote.metadata?.syncProfile].filter(Boolean)
        .map(source => scopeValue(source, field)).filter(Boolean);
      if (!values.length || values.some(value => value !== id(contract[`${field}Id`]))) throw new Error(`MASTER_SCOPE_MISMATCH: ${field} no corresponde al vínculo vigente.`);
    }
  } else if (contract.masterTerminalId && ((servingId && servingId !== id(contract.masterTerminalId)) || (declaredId && declaredId !== id(contract.masterTerminalId)))) {
    throw new Error('MASTER_IDENTITY_MISMATCH: master local distinta de la vinculada.');
  }
  return normalized;
};

export const createOperationalMasterResolver = (options: {
  getContract: () => OperationalMasterContract;
  discover: () => Promise<Array<{ baseUrl: string; config: Record<string, any> }>>;
  mirror: (base: string) => void;
  isReady?: () => boolean;
}) => {
  let accepted: { key: string; base: string } | null = null;
  let pending: { key: string; work: Promise<string> } | null = null;
  let generation = 0;
  const key = ({ localIps: _localIps, ...identity }: OperationalMasterContract) => JSON.stringify(identity);
  const assertReady = () => {
    if (options.isReady && !options.isReady()) throw new Error('MASTER_ENDPOINT_NOT_READY: el vínculo todavía está cargando.');
  };
  const current = () => {
    if (options.isReady && !options.isReady()) return '';
    if (!accepted) return '';
    if (accepted.key !== key(options.getContract())) { accepted = null; return ''; }
    const host = new URL(accepted.base).hostname.toLowerCase();
    if (options.getContract().localIps.map(id).includes(host)) { invalidate(); return ''; }
    options.mirror(accepted.base);
    return accepted.base;
  };
  const invalidate = () => { accepted = null; pending = null; generation += 1; };
  const ensure = async (): Promise<string> => {
    assertReady();
    const cached = current();
    if (cached) return cached;
    const contract = options.getContract();
    assertOperationalMasterContractReady(contract);
    const contractKey = key(contract);
    if (pending?.key === contractKey) return pending.work;
    const attemptGeneration = generation;
    const assertCurrentAttempt = () => {
      if (attemptGeneration !== generation || key(options.getContract()) !== contractKey) throw new Error('MASTER_CONTRACT_CHANGED: cambió el vínculo durante la validación.');
      assertReady();
    };
    const work = (async () => {
      let candidates: Awaited<ReturnType<typeof options.discover>>;
      try { candidates = await options.discover(); }
      catch (error) { assertCurrentAttempt(); throw error; }
      assertCurrentAttempt();
      let failure: unknown = new Error('MASTER_UNAVAILABLE: no se encontró la master vinculada.');
      for (const candidate of candidates) {
        try {
          const base = validateOperationalMasterEndpoint(candidate.baseUrl, candidate.config, { ...contract, localIps: options.getContract().localIps });
          assertCurrentAttempt();
          accepted = { key: contractKey, base };
          options.mirror(base);
          return base;
        } catch (error) { failure = error; }
      }
      throw failure;
    })();
    pending = { key: contractKey, work };
    try { return await work; } finally { if (pending?.work === work) pending = null; }
  };
  // One immediate reconciliation, not a timer or retry loop. ensure retains its
  // strict superseded error for callers that do not request reconciliation.
  const ensureCurrent = async (budget = { remaining: 1 }) => {
    try { return await ensure(); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('MASTER_CONTRACT_CHANGED:')) throw error;
      if (budget.remaining <= 0) throw error;
      budget.remaining -= 1;
      return ensure();
    }
  };
  const captureAuthority = () => {
    const capturedKey = key(options.getContract());
    const capturedGeneration = generation;
    return () => (!options.isReady || options.isReady())
      && capturedGeneration === generation && capturedKey === key(options.getContract())
      && accepted?.key === capturedKey
      && !options.getContract().localIps.map(id).includes(new URL(accepted.base).hostname.toLowerCase());
  };
  return { current, ensure, ensureCurrent, captureAuthority, invalidate };
};

let operationalMasterResolver: ReturnType<typeof createOperationalMasterResolver> | null = null;
export const setOperationalMasterResolver = (resolver: ReturnType<typeof createOperationalMasterResolver> | null) => {
  operationalMasterResolver = resolver;
};
export const resolveValidatedOperationalApiUrl = async (path: string): Promise<string> => {
  if (isClientTerminalMode()) {
    if (!operationalMasterResolver) throw new Error('MASTER_ENDPOINT_NOT_READY: el vínculo todavía está cargando.');
    await operationalMasterResolver.ensureCurrent();
  }
  return resolveOperationalApiUrl(path);
};
